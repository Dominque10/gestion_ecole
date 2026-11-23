// Paiement en ligne (M6, sous-étape 4c), cahier des charges §9 :
// 1. le parent choisit les échéances et son numéro ; une intention de paiement est créée ;
// 2. le prestataire demande la confirmation sur le téléphone (code secret mobile money) ;
// 3. son message de confirmation (signé) arrive : le paiement est enregistré UNE seule fois,
//    affecté aux échéances, l'inscription validée si besoin (A3), le reçu produit ;
// 4. sans message après 10 minutes, le worker interroge le statut ; une réconciliation quotidienne
//    compare le relevé du prestataire aux paiements enregistrés.
// Les écritures se font au nom du « compte caisse en ligne » de l'école (décision D20), jamais du parent.
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { t } from "@/i18n";
import { formatXAF } from "@/lib/money";
import { normalizePhone } from "@/server/auth/phone";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withAuth, withSchool, type Tx } from "@/server/db/client";
import {
  academicYears,
  auditLogs,
  enrollments,
  invoices,
  paymentAllocations,
  paymentIntents,
  payments,
  users,
} from "@/server/db/schema";
import { PAYMENTS_QUEUE, getJobQueue } from "@/server/jobs";
import {
  getPaymentProvider,
  type MobileMoneyProvider,
  type Operator,
  type PaymentEvent,
} from "@/server/payments";
import { FinanceError } from "./errors";
import { amountDue } from "./invoice-logic";
import { paidOnInvoice } from "./invoices";
import { allocateOnline } from "./payment-logic";
import { autoValidate, nextReceiptNumber, openInvoices } from "./payments";

/** Délai avant d'interroger le prestataire, puis entre deux interrogations ; abandon après 1 h. */
export const CHECK_DELAY_SECONDS = 10 * 60;
export const EXPIRY_MS = 60 * 60 * 1000;

export const OnlinePaymentSchema = z.object({
  enrollmentId: z.uuid(),
  invoiceIds: z.array(z.uuid()).min(1).max(24),
  phone: z.string().max(30),
  operator: z.enum(["airtel", "mtn"]),
});
export type OnlinePaymentInput = z.input<typeof OnlinePaymentSchema>;

/** Compte « caisse en ligne » de l'école : sans mot de passe, il ne peut pas se connecter. */
export async function onlineCashier(schoolId: string): Promise<string> {
  const email = `paiement-en-ligne+${schoolId}@systeme.invalid`;
  return withAuth(async (tx) => {
    await tx
      .insert(users)
      .values({ name: t("online.cashierName"), email })
      .onConflictDoNothing({ target: users.email });
    const [row] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
    return row.id;
  });
}

export type IntentJob = { schoolId: string; intentId: string };

async function scheduleCheck(job: IntentJob): Promise<void> {
  const boss = await getJobQueue();
  await boss.send(PAYMENTS_QUEUE, job, { startAfter: CHECK_DELAY_SECONDS });
}

/**
 * Le parent lance un paiement : échéances entières de son enfant (décision D20), au plus une demande
 * en attente à la fois. Renvoie l'intention, dont le parent suit l'état.
 */
export async function startOnlinePayment(
  principal: Principal,
  input: OnlinePaymentInput,
  provider: MobileMoneyProvider = getPaymentProvider(),
  schedule: (job: IntentJob) => Promise<void> = scheduleCheck,
): Promise<string> {
  authorize(principal, "payments:pay-online");
  const parsed = OnlinePaymentSchema.safeParse(input);
  if (!parsed.success) throw new FinanceError("onlineInvalid");
  const data = parsed.data;
  const phone = normalizePhone(data.phone);
  if (!phone) throw new FinanceError("onlinePhone");
  const schoolId = principal.schoolId as string;

  // Lecture en tant que parent : la RLS garantit qu'il s'agit bien de son enfant.
  const plan = await withSchool({ schoolId, userId: principal.userId }, async (tx) => {
    const [enrollment] = await tx
      .select({
        id: enrollments.id,
        yearId: enrollments.academicYearId,
        yearStatus: academicYears.status,
      })
      .from(enrollments)
      .innerJoin(academicYears, eq(academicYears.id, enrollments.academicYearId))
      .where(eq(enrollments.id, data.enrollmentId));
    if (!enrollment) throw new FinanceError("enrollmentNotFound");
    if (enrollment.yearStatus === "archived") throw new FinanceError("yearArchived");
    const chosen = await tx
      .select({ invoice: invoices, paid: paidOnInvoice })
      .from(invoices)
      .where(
        and(
          eq(invoices.enrollmentId, enrollment.id),
          eq(invoices.status, "open"),
          inArray(invoices.id, data.invoiceIds),
        ),
      );
    const remaining = chosen.map((r) => amountDue(r.invoice) - r.paid);
    if (chosen.length !== new Set(data.invoiceIds).size || remaining.some((r) => r <= 0)) {
      throw new FinanceError("onlineInvalid");
    }
    const [waiting] = await tx
      .select({ id: paymentIntents.id })
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.enrollmentId, enrollment.id),
          eq(paymentIntents.status, "pending"),
          sql`${paymentIntents.createdAt} > now() - interval '10 minutes'`,
        ),
      );
    if (waiting) throw new FinanceError("onlinePending");
    return { yearId: enrollment.yearId, amount: remaining.reduce((a, b) => a + b, 0) };
  });

  const cashier = await onlineCashier(schoolId);
  const service = { schoolId, userId: cashier };
  const [intent] = await withSchool(service, (tx) =>
    tx
      .insert(paymentIntents)
      .values({
        schoolId,
        academicYearId: plan.yearId,
        enrollmentId: data.enrollmentId,
        invoiceIds: data.invoiceIds,
        amount: plan.amount,
        phone,
        operator: data.operator,
        provider: provider.name,
        createdBy: principal.userId,
      })
      .returning({ id: paymentIntents.id }),
  );

  let providerRef: string;
  try {
    ({ providerRef } = await provider.requestPayment({
      intentId: intent.id,
      amount: plan.amount,
      phone,
      operator: data.operator,
      description: t("online.description"),
    }));
  } catch {
    await withSchool(service, (tx) =>
      tx
        .update(paymentIntents)
        .set({ status: "failed", failureReason: t("online.providerDown"), updatedAt: new Date() })
        .where(eq(paymentIntents.id, intent.id)),
    );
    throw new FinanceError("onlineProviderDown");
  }
  await withSchool(service, (tx) =>
    tx
      .update(paymentIntents)
      .set({ providerRef, updatedAt: new Date() })
      .where(eq(paymentIntents.id, intent.id)),
  );
  await schedule({ schoolId, intentId: intent.id }).catch((error: unknown) =>
    console.error("Interrogation du paiement non programmée :", (error as Error).message),
  );
  return intent.id;
}

export type IntentView = {
  id: string;
  enrollmentId: string;
  status: "pending" | "succeeded" | "failed" | "expired";
  amount: number;
  operator: Operator;
  phone: string;
  failureReason: string | null;
  paymentId: string | null;
  receiptNumber: string | null;
};

/** État d'une intention (parent : les siennes seulement, par la RLS). */
export async function getIntent(
  principal: Principal,
  intentId: string,
): Promise<IntentView | null> {
  authorize(principal, "payments:pay-online");
  if (!z.uuid().safeParse(intentId).success) return null;
  const schoolId = principal.schoolId as string;
  const [row] = await withSchool({ schoolId, userId: principal.userId }, (tx) =>
    tx
      .select({
        id: paymentIntents.id,
        enrollmentId: paymentIntents.enrollmentId,
        status: paymentIntents.status,
        amount: paymentIntents.amount,
        operator: paymentIntents.operator,
        phone: paymentIntents.phone,
        failureReason: paymentIntents.failureReason,
        paymentId: paymentIntents.paymentId,
        receiptNumber: payments.receiptNumber,
      })
      .from(paymentIntents)
      .leftJoin(payments, eq(payments.id, paymentIntents.paymentId))
      .where(eq(paymentIntents.id, intentId)),
  );
  return row ?? null;
}

export type SettleOutcome = "recorded" | "alreadyRecorded" | "failed" | "stillPending" | "ignored";

/**
 * Applique un événement du prestataire à une intention, dans une transaction, de façon idempotente :
 * un même événement reçu deux fois n'enregistre qu'un paiement. Une réussite arrivée après un échec
 * ou une expiration est quand même enregistrée (l'argent a été pris au parent).
 */
export async function settleIntent(
  schoolId: string,
  intentId: string,
  event: PaymentEvent,
): Promise<SettleOutcome> {
  const cashier = await onlineCashier(schoolId);
  return withSchool({ schoolId, userId: cashier }, async (tx) => {
    const [intent] = await tx
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .for("update");
    if (!intent || intent.providerRef !== event.providerRef) return "ignored" as const;
    if (intent.status === "succeeded") return "alreadyRecorded" as const;
    if (event.status === "pending") {
      await tx
        .update(paymentIntents)
        .set({ lastCheckedAt: new Date() })
        .where(eq(paymentIntents.id, intentId));
      return "stillPending" as const;
    }
    if (event.status === "failed") {
      if (intent.status === "pending") {
        await tx
          .update(paymentIntents)
          .set({
            status: "failed",
            failureReason: event.failureReason ?? t("online.refused"),
            lastCheckedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(paymentIntents.id, intentId));
      }
      return "failed" as const;
    }
    return recordPayment(tx, schoolId, cashier, intent, event);
  });
}

async function recordPayment(
  tx: Tx,
  schoolId: string,
  cashier: string,
  intent: typeof paymentIntents.$inferSelect,
  event: PaymentEvent,
): Promise<SettleOutcome> {
  // Montant réellement reçu (celui du prestataire s'il le donne).
  const amount = event.amount ?? intent.amount;
  const open = await openInvoices(tx, intent.enrollmentId);
  const { parts, excess } = allocateOnline(amount, open, intent.invoiceIds);
  const receiptNumber = await nextReceiptNumber(tx, schoolId, intent.academicYearId);
  const reference = event.operatorRef ?? intent.providerRef;
  const operatorName = t(intent.operator === "airtel" ? "online.airtel" : "online.mtn");
  const [payment] = await tx
    .insert(payments)
    .values({
      schoolId,
      academicYearId: intent.academicYearId,
      enrollmentId: intent.enrollmentId,
      amount,
      method: "mobile_money",
      reference,
      receiptNumber,
      cashierId: cashier,
      note:
        excess > 0
          ? t("online.noteExcess", {
              operateur: operatorName,
              montant: formatXAF(excess),
            })
          : t("online.note", { operateur: operatorName }),
    })
    .returning({ id: payments.id });
  if (parts.length > 0) {
    await tx
      .insert(paymentAllocations)
      .values(parts.map((p) => ({ schoolId, paymentId: payment.id, ...p })));
  }
  await tx
    .update(paymentIntents)
    .set({
      status: "succeeded",
      paymentId: payment.id,
      operatorRef: event.operatorRef ?? null,
      failureReason: null,
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(paymentIntents.id, intent.id));
  await tx.insert(auditLogs).values({
    schoolId,
    actorUserId: cashier,
    action: "payment.online",
    entityType: "payment",
    entityId: payment.id,
    after: {
      receiptNumber,
      amount,
      operator: intent.operator,
      providerRef: intent.providerRef,
      operatorRef: event.operatorRef ?? null,
      allocations: parts,
      excess,
      parent: intent.createdBy,
    },
  });
  await autoValidate(tx, schoolId, intent.enrollmentId, cashier);
  return "recorded";
}

/** École et intention d'une référence du prestataire (message reçu sans école de session). */
async function locate(provider: string, providerRef: string): Promise<IntentJob | null> {
  const { rows } = await withAuth((tx) =>
    tx.execute<{ school_id: string; intent_id: string }>(
      sql`select * from app.intent_by_provider_ref(${provider}, ${providerRef})`,
    ),
  );
  return rows[0] ? { schoolId: rows[0].school_id, intentId: rows[0].intent_id } : null;
}

export type WebhookResult = { status: 200 | 401 | 404; outcome?: SettleOutcome };

/** Message de confirmation du prestataire : signature vérifiée, puis application idempotente. */
export async function handlePaymentWebhook(
  rawBody: string,
  signature: string | null,
  provider: MobileMoneyProvider = getPaymentProvider(),
): Promise<WebhookResult> {
  const event = provider.parseWebhook(rawBody, signature);
  if (!event) return { status: 401 };
  const found = await locate(provider.name, event.providerRef);
  if (!found) return { status: 404 };
  return { status: 200, outcome: await settleIntent(found.schoolId, found.intentId, event) };
}

/**
 * Tâche du worker, 10 minutes après la demande (puis toutes les 10 minutes) : interroge le prestataire
 * si aucun message n'est arrivé ; au bout d'une heure sans réponse, l'intention expire.
 */
export async function checkIntent(
  input: unknown,
  provider: MobileMoneyProvider = getPaymentProvider(),
  schedule: (job: IntentJob) => Promise<void> = scheduleCheck,
  now = new Date(),
): Promise<SettleOutcome | "expired"> {
  const job = z.object({ schoolId: z.uuid(), intentId: z.uuid() }).parse(input);
  const cashier = await onlineCashier(job.schoolId);
  const [intent] = await withSchool({ schoolId: job.schoolId, userId: cashier }, (tx) =>
    tx.select().from(paymentIntents).where(eq(paymentIntents.id, job.intentId)),
  );
  if (!intent || intent.status !== "pending" || !intent.providerRef) return "ignored";
  const outcome = await settleIntent(
    job.schoolId,
    job.intentId,
    await provider.getStatus(intent.providerRef),
  );
  if (outcome !== "stillPending") return outcome;
  if (now.getTime() - intent.createdAt.getTime() >= EXPIRY_MS) {
    await withSchool({ schoolId: job.schoolId, userId: cashier }, (tx) =>
      tx
        .update(paymentIntents)
        .set({ status: "expired", failureReason: t("online.expired"), updatedAt: new Date() })
        .where(and(eq(paymentIntents.id, job.intentId), eq(paymentIntents.status, "pending"))),
    );
    return "expired";
  }
  await schedule(job);
  return "stillPending";
}

export type Reconciliation = {
  day: string;
  checked: number;
  /** Réussies chez le prestataire mais pas encore enregistrées : enregistrées maintenant. */
  recovered: number;
  /** Transactions du relevé inconnues de la plateforme (à examiner). */
  unknown: string[];
};

/**
 * Réconciliation d'un jour : chaque transaction réussie du relevé doit correspondre à un paiement
 * enregistré ; un oubli (message perdu) est rattrapé, une transaction inconnue est signalée.
 */
export async function reconcileDay(
  day: string,
  provider: MobileMoneyProvider = getPaymentProvider(),
): Promise<Reconciliation> {
  const statement = await provider.listTransactions(day);
  const result: Reconciliation = { day, checked: statement.length, recovered: 0, unknown: [] };
  const schools = new Map<string, { recovered: number; checked: number }>();
  for (const event of statement) {
    const found = await locate(provider.name, event.providerRef);
    if (!found) {
      if (event.status === "succeeded") result.unknown.push(event.providerRef);
      continue;
    }
    const stats = schools.get(found.schoolId) ?? { recovered: 0, checked: 0 };
    stats.checked++;
    if (event.status === "succeeded") {
      const outcome = await settleIntent(found.schoolId, found.intentId, event);
      if (outcome === "recorded") {
        result.recovered++;
        stats.recovered++;
      }
    }
    schools.set(found.schoolId, stats);
  }
  for (const [schoolId, stats] of schools) {
    const cashier = await onlineCashier(schoolId);
    await withSchool({ schoolId, userId: cashier }, (tx) =>
      tx.insert(auditLogs).values({
        schoolId,
        actorUserId: cashier,
        action: "payments.reconcile",
        entityType: "school",
        entityId: schoolId,
        after: { day, ...stats },
      }),
    );
  }
  if (result.unknown.length > 0) {
    console.error(`Réconciliation du ${day} : transactions inconnues`, result.unknown);
  }
  return result;
}
