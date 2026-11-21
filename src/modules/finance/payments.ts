// Caisse (M3, 2d) : encaissement, reçus numérotés, annulation par écriture inverse validée par le
// directeur (décision D7), validation automatique de l'inscription au paiement (décision A3).
import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool, type Tx } from "@/server/db/client";
import {
  academicYears,
  auditLogs,
  classes,
  enrollments,
  invoices,
  levels,
  paymentAllocations,
  paymentCancellations,
  payments,
  schools,
  students,
  users,
} from "@/server/db/schema";
import { isUniqueViolation } from "@/modules/settings/errors";
import { readContext } from "@/modules/students/students";
import { assertCashOpen } from "./closures";
import { FinanceError } from "./errors";
import { amountDue } from "./invoice-logic";
import { paidOnInvoice } from "./invoices";
import { allocate, formatReceiptNumber, OverpaymentError, type OpenInvoice } from "./payment-logic";

export const PAYMENT_METHODS = ["cash", "mobile_money", "transfer", "cheque"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PaymentSchema = z.object({
  enrollmentId: z.uuid(),
  amount: z.number().int().min(1).max(100_000_000),
  method: z.enum(PAYMENT_METHODS),
  reference: z
    .string()
    .trim()
    .max(60)
    .transform((v) => (v === "" ? null : v)),
  note: z
    .string()
    .trim()
    .max(200)
    .transform((v) => (v === "" ? null : v)),
});
export type PaymentInput = z.input<typeof PaymentSchema>;

const isUuid = (value: string) => z.uuid().safeParse(value).success;

function context(
  principal: Principal,
  action: "payments:collect" | "payments:cancel:request" | "payments:cancel:approve",
) {
  authorize(principal, action);
  return { schoolId: principal.schoolId as string, userId: principal.userId };
}

/** Lecture des paiements : pas pour un enseignant (hypothèse H53). */
function financeReadContext(principal: Principal) {
  const ctx = readContext(principal);
  if (ctx.teacherOnly) throw new FinanceError("paymentNotFound");
  return ctx;
}

/** Échéances ouvertes d'une inscription avec leur reste à payer, verrouillées pour la transaction. */
async function openInvoices(
  tx: Tx,
  enrollmentId: string,
): Promise<(OpenInvoice & { kind: string })[]> {
  const rows = await tx
    .select({ invoice: invoices, paid: paidOnInvoice })
    .from(invoices)
    .where(and(eq(invoices.enrollmentId, enrollmentId), eq(invoices.status, "open")))
    .for("update", { of: invoices });
  return rows.map(({ invoice, paid }) => ({
    id: invoice.id,
    remaining: amountDue(invoice) - paid,
    dueDate: invoice.dueDate,
    mandatory: invoice.mandatory,
    feeName: invoice.feeName,
    installmentNumber: invoice.installmentNumber,
    kind: invoice.kind,
  }));
}

/** Prochain numéro de reçu de l'année : compteur verrouillé, continu, sans trou. */
async function nextReceiptNumber(tx: Tx, schoolId: string, yearId: string): Promise<string> {
  const [counter] = await tx
    .update(academicYears)
    .set({ lastReceiptNumber: sql`${academicYears.lastReceiptNumber} + 1` })
    .where(eq(academicYears.id, yearId))
    .returning({ number: academicYears.lastReceiptNumber, startDate: academicYears.startDate });
  const [school] = await tx
    .select({ prefix: schools.matriculePrefix })
    .from(schools)
    .where(eq(schools.id, schoolId));
  return formatReceiptNumber(school.prefix, Number(counter.startDate.slice(0, 4)), counter.number);
}

/**
 * Validation automatique (décision A3) : une préinscription devient inscription dès que toutes ses
 * échéances d'inscription sont soldées. Sans frais d'inscription dans la grille, rien d'automatique.
 */
async function autoValidate(tx: Tx, schoolId: string, enrollmentId: string, userId: string) {
  const [enrollment] = await tx
    .select({ status: enrollments.status })
    .from(enrollments)
    .where(eq(enrollments.id, enrollmentId));
  if (enrollment?.status !== "pre_enrolled") return false;
  const registration = (await openInvoices(tx, enrollmentId)).filter(
    (i) => i.kind === "registration",
  );
  const [anyRegistration] = await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.enrollmentId, enrollmentId), eq(invoices.kind, "registration")))
    .limit(1);
  if (!anyRegistration || registration.some((i) => i.remaining > 0)) return false;
  await tx
    .update(enrollments)
    .set({
      status: "enrolled",
      validationMode: "payment",
      validatedAt: new Date(),
      validatedBy: userId,
      updatedAt: new Date(),
    })
    .where(eq(enrollments.id, enrollmentId));
  await tx.insert(auditLogs).values({
    schoolId,
    actorUserId: userId,
    action: "enrollment.validate",
    entityType: "enrollment",
    entityId: enrollmentId,
    after: { mode: "payment" },
  });
  return true;
}

/**
 * Encaisse un paiement au guichet. Affecté aux échéances les plus anciennes ; trop-perçu refusé ;
 * référence obligatoire hors espèces et jamais saisie deux fois. Tout dans une seule transaction.
 */
export async function collectPayment(
  principal: Principal,
  input: PaymentInput,
): Promise<{ paymentId: string; receiptNumber: string; autoValidated: boolean }> {
  const ctx = context(principal, "payments:collect");
  const data = PaymentSchema.parse(input);
  if (data.method !== "cash" && !data.reference) throw new FinanceError("referenceRequired");
  const reference = data.method === "cash" ? null : data.reference;
  try {
    return await withSchool(ctx, async (tx) => {
      const [enrollment] = await tx
        .select({
          id: enrollments.id,
          yearId: enrollments.academicYearId,
          yearStatus: academicYears.status,
        })
        .from(enrollments)
        .innerJoin(academicYears, eq(academicYears.id, enrollments.academicYearId))
        .where(and(eq(enrollments.schoolId, ctx.schoolId), eq(enrollments.id, data.enrollmentId)))
        .for("update", { of: enrollments });
      if (!enrollment) throw new FinanceError("enrollmentNotFound");
      if (enrollment.yearStatus === "archived") throw new FinanceError("yearArchived");
      // Caisse ouverte aujourd'hui (et verrou partagé avec la clôture du jour).
      await assertCashOpen(tx, ctx.schoolId, ctx.userId);

      const open = await openInvoices(tx, enrollment.id);
      if (open.every((i) => i.remaining <= 0)) throw new FinanceError("nothingDue");
      let parts: { invoiceId: string; amount: number }[];
      try {
        parts = allocate(data.amount, open);
      } catch (error) {
        if (error instanceof OverpaymentError) {
          throw new FinanceError("overpayment", { maximum: error.maximum.toLocaleString("fr-FR") });
        }
        throw error;
      }

      const receiptNumber = await nextReceiptNumber(tx, ctx.schoolId, enrollment.yearId);
      const [payment] = await tx
        .insert(payments)
        .values({
          schoolId: ctx.schoolId,
          academicYearId: enrollment.yearId,
          enrollmentId: enrollment.id,
          amount: data.amount,
          method: data.method,
          reference,
          receiptNumber,
          cashierId: ctx.userId,
          note: data.note,
        })
        .returning({ id: payments.id });
      await tx
        .insert(paymentAllocations)
        .values(parts.map((p) => ({ schoolId: ctx.schoolId, paymentId: payment.id, ...p })));
      await tx.insert(auditLogs).values({
        schoolId: ctx.schoolId,
        actorUserId: ctx.userId,
        action: "payment.collect",
        entityType: "payment",
        entityId: payment.id,
        after: {
          receiptNumber,
          amount: data.amount,
          method: data.method,
          reference,
          allocations: parts,
        },
      });
      const autoValidated = await autoValidate(tx, ctx.schoolId, enrollment.id, ctx.userId);
      return { paymentId: payment.id, receiptNumber, autoValidated };
    });
  } catch (error) {
    if (isUniqueViolation(error, "payments_reference"))
      throw new FinanceError("duplicateReference");
    throw error;
  }
}

export type PaymentLine = {
  id: string;
  kind: "payment" | "reversal";
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  receiptNumber: string | null;
  paidAt: Date;
  cashierName: string;
  reversed: boolean;
  pendingCancellation: boolean;
};

const paymentLineFields = {
  id: payments.id,
  kind: payments.kind,
  amount: payments.amount,
  method: payments.method,
  reference: payments.reference,
  receiptNumber: payments.receiptNumber,
  paidAt: payments.paidAt,
  cashierName: users.name,
  reversed: sql<boolean>`exists (select 1 from payments r where r.reverses_id = "payments"."id")`,
  pendingCancellation: sql<boolean>`exists (select 1 from payment_cancellations c
    where c.payment_id = "payments"."id" and c.status = 'pending')`,
};

/** Paiements et annulations d'une inscription, du plus récent au plus ancien. */
export async function listPayments(
  principal: Principal,
  enrollmentId: string,
): Promise<PaymentLine[]> {
  const ctx = financeReadContext(principal);
  if (!isUuid(enrollmentId)) return [];
  return withSchool(ctx, (tx) =>
    tx
      .select(paymentLineFields)
      .from(payments)
      .innerJoin(users, eq(users.id, payments.cashierId))
      .where(and(eq(payments.schoolId, ctx.schoolId), eq(payments.enrollmentId, enrollmentId)))
      .orderBy(desc(payments.paidAt)),
  );
}

/** Encaissements d'un caissier sur une journée (bornes en UTC, calculées par l'appelant). */
export async function listCashierPayments(
  principal: Principal,
  range: { from: Date; to: Date },
): Promise<(PaymentLine & { studentName: string })[]> {
  const ctx = context(principal, "payments:collect");
  return withSchool(ctx, (tx) =>
    tx
      .select({
        ...paymentLineFields,
        studentName: sql<string>`${students.lastName} || ' ' || ${students.firstNames}`,
      })
      .from(payments)
      .innerJoin(users, eq(users.id, payments.cashierId))
      .innerJoin(enrollments, eq(enrollments.id, payments.enrollmentId))
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(
        and(
          eq(payments.schoolId, ctx.schoolId),
          eq(payments.cashierId, ctx.userId),
          gte(payments.paidAt, range.from),
          lt(payments.paidAt, range.to),
        ),
      )
      .orderBy(desc(payments.paidAt)),
  );
}

export type Receipt = {
  paymentId: string;
  receiptNumber: string;
  paidAt: Date;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  cashierName: string;
  school: { name: string; address: string | null; phone: string | null; logoKey: string | null };
  student: {
    matricule: string;
    name: string;
    level: string;
    className: string | null;
    year: string;
  };
  allocations: { label: string; amount: number }[];
  remainingAfter: number;
  reversed: boolean;
};

/** Données d'un reçu (affichage, impression ; PDF en sous-étape 2f). */
export async function getReceipt(principal: Principal, paymentId: string): Promise<Receipt> {
  const ctx = financeReadContext(principal);
  if (!isUuid(paymentId)) throw new FinanceError("paymentNotFound");
  return withSchool(ctx, async (tx) => {
    const [row] = await tx
      .select({
        payment: payments,
        cashierName: users.name,
        schoolName: schools.name,
        schoolAddress: schools.address,
        schoolPhone: schools.phone,
        logoKey: schools.logoKey,
        matricule: students.matricule,
        studentName: sql<string>`${students.lastName} || ' ' || ${students.firstNames}`,
        level: levels.name,
        className: classes.name,
        year: academicYears.label,
      })
      .from(payments)
      .innerJoin(users, eq(users.id, payments.cashierId))
      .innerJoin(schools, eq(schools.id, payments.schoolId))
      .innerJoin(enrollments, eq(enrollments.id, payments.enrollmentId))
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .innerJoin(levels, eq(levels.id, enrollments.levelId))
      .innerJoin(academicYears, eq(academicYears.id, enrollments.academicYearId))
      .leftJoin(classes, eq(classes.id, enrollments.classId))
      .where(
        and(
          eq(payments.schoolId, ctx.schoolId),
          eq(payments.id, paymentId),
          eq(payments.kind, "payment"),
        ),
      );
    if (!row) throw new FinanceError("paymentNotFound");
    const allocations = await tx
      .select({
        feeName: invoices.feeName,
        n: invoices.installmentNumber,
        count: invoices.installmentCount,
        amount: paymentAllocations.amount,
      })
      .from(paymentAllocations)
      .innerJoin(invoices, eq(invoices.id, paymentAllocations.invoiceId))
      .where(eq(paymentAllocations.paymentId, paymentId))
      .orderBy(asc(invoices.dueDate));
    const remaining = await tx
      .select({ invoice: invoices, paid: paidOnInvoice })
      .from(invoices)
      .where(and(eq(invoices.enrollmentId, row.payment.enrollmentId), eq(invoices.status, "open")));
    const [reversal] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.reversesId, paymentId));
    return {
      paymentId,
      receiptNumber: row.payment.receiptNumber as string,
      paidAt: row.payment.paidAt,
      amount: row.payment.amount,
      method: row.payment.method,
      reference: row.payment.reference,
      note: row.payment.note,
      cashierName: row.cashierName,
      school: {
        name: row.schoolName,
        address: row.schoolAddress,
        phone: row.schoolPhone,
        logoKey: row.logoKey,
      },
      student: {
        matricule: row.matricule,
        name: row.studentName,
        level: row.level,
        className: row.className,
        year: row.year,
      },
      allocations: allocations.map((a) => ({
        label: a.count > 1 ? `${a.feeName} — tranche ${a.n}/${a.count}` : a.feeName,
        amount: a.amount,
      })),
      remainingAfter: remaining.reduce((sum, r) => sum + amountDue(r.invoice) - r.paid, 0),
      reversed: Boolean(reversal),
    };
  });
}

// --- Annulation (décision D7) -------------------------------------------------------------------

const ReasonSchema = z.string().trim().min(3).max(300);

/** Le comptable demande l'annulation d'un paiement, avec un motif. */
export async function requestCancellation(
  principal: Principal,
  paymentId: string,
  reason: string,
): Promise<string> {
  const ctx = context(principal, "payments:cancel:request");
  const text = ReasonSchema.parse(reason);
  if (!isUuid(paymentId)) throw new FinanceError("paymentNotFound");
  try {
    return await withSchool(ctx, async (tx) => {
      const [payment] = await tx
        .select({ id: payments.id, kind: payments.kind, yearStatus: academicYears.status })
        .from(payments)
        .innerJoin(academicYears, eq(academicYears.id, payments.academicYearId))
        .where(and(eq(payments.schoolId, ctx.schoolId), eq(payments.id, paymentId)));
      if (!payment || payment.kind !== "payment") throw new FinanceError("paymentNotFound");
      if (payment.yearStatus === "archived") throw new FinanceError("yearArchived");
      const [reversal] = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(eq(payments.reversesId, paymentId));
      if (reversal) throw new FinanceError("alreadyReversed");
      const [request] = await tx
        .insert(paymentCancellations)
        .values({ schoolId: ctx.schoolId, paymentId, reason: text, requestedBy: ctx.userId })
        .returning({ id: paymentCancellations.id });
      await tx.insert(auditLogs).values({
        schoolId: ctx.schoolId,
        actorUserId: ctx.userId,
        action: "payment.cancel_request",
        entityType: "payment",
        entityId: paymentId,
        after: { reason: text },
      });
      return request.id;
    });
  } catch (error) {
    if (isUniqueViolation(error, "payment_cancellations_one_pending")) {
      throw new FinanceError("cancellationPending");
    }
    throw error;
  }
}

export type PendingCancellation = {
  id: string;
  paymentId: string;
  receiptNumber: string;
  amount: number;
  paidAt: Date;
  studentName: string;
  reason: string;
  requestedByName: string;
  requestedAt: Date;
};

/** Demandes en attente, pour le directeur. */
export async function listPendingCancellations(
  principal: Principal,
): Promise<PendingCancellation[]> {
  const ctx = context(principal, "payments:cancel:approve");
  return withSchool(ctx, (tx) =>
    tx
      .select({
        id: paymentCancellations.id,
        paymentId: payments.id,
        receiptNumber: sql<string>`${payments.receiptNumber}`,
        amount: payments.amount,
        paidAt: payments.paidAt,
        studentName: sql<string>`${students.lastName} || ' ' || ${students.firstNames}`,
        reason: paymentCancellations.reason,
        requestedByName: users.name,
        requestedAt: paymentCancellations.requestedAt,
      })
      .from(paymentCancellations)
      .innerJoin(payments, eq(payments.id, paymentCancellations.paymentId))
      .innerJoin(enrollments, eq(enrollments.id, payments.enrollmentId))
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .innerJoin(users, eq(users.id, paymentCancellations.requestedBy))
      .where(
        and(
          eq(paymentCancellations.schoolId, ctx.schoolId),
          eq(paymentCancellations.status, "pending"),
        ),
      )
      .orderBy(asc(paymentCancellations.requestedAt)),
  );
}

/**
 * Le directeur décide. Validation = écriture inverse (montant opposé, mêmes échéances), tracée ;
 * le paiement d'origine reste visible, marqué annulé. Refus = la demande est close avec une note.
 */
export async function decideCancellation(
  principal: Principal,
  cancellationId: string,
  decision: { approve: boolean; note: string },
): Promise<void> {
  const ctx = context(principal, "payments:cancel:approve");
  if (!isUuid(cancellationId)) throw new FinanceError("cancellationNotFound");
  const note = z.string().trim().max(300).parse(decision.note) || null;
  await withSchool(ctx, async (tx) => {
    const [request] = await tx
      .select()
      .from(paymentCancellations)
      .where(
        and(
          eq(paymentCancellations.schoolId, ctx.schoolId),
          eq(paymentCancellations.id, cancellationId),
        ),
      )
      .for("update");
    if (!request || request.status !== "pending") throw new FinanceError("cancellationNotFound");
    let reversalId: string | null = null;
    if (decision.approve) {
      const [original] = await tx.select().from(payments).where(eq(payments.id, request.paymentId));
      const allocations = await tx
        .select({ invoiceId: paymentAllocations.invoiceId, amount: paymentAllocations.amount })
        .from(paymentAllocations)
        .where(eq(paymentAllocations.paymentId, original.id));
      const [reversal] = await tx
        .insert(payments)
        .values({
          schoolId: ctx.schoolId,
          academicYearId: original.academicYearId,
          enrollmentId: original.enrollmentId,
          kind: "reversal",
          amount: -original.amount,
          method: original.method,
          reversesId: original.id,
          cashierId: ctx.userId,
          note: `Annulation du reçu ${original.receiptNumber} : ${request.reason}`,
        })
        .returning({ id: payments.id });
      await tx.insert(paymentAllocations).values(
        allocations.map((a) => ({
          schoolId: ctx.schoolId,
          paymentId: reversal.id,
          invoiceId: a.invoiceId,
          amount: -a.amount,
        })),
      );
      reversalId = reversal.id;
    }
    await tx
      .update(paymentCancellations)
      .set({
        status: decision.approve ? "approved" : "rejected",
        decidedBy: ctx.userId,
        decidedAt: new Date(),
        decisionNote: note,
        reversalId,
      })
      .where(eq(paymentCancellations.id, cancellationId));
    await tx.insert(auditLogs).values({
      schoolId: ctx.schoolId,
      actorUserId: ctx.userId,
      action: decision.approve ? "payment.cancel_approve" : "payment.cancel_reject",
      entityType: "payment",
      entityId: request.paymentId,
      after: { reason: request.reason, note, reversalId },
    });
  });
}
