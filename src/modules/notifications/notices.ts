// Messages aux parents (M6, sous-étape 4d) : par le canal de l'école (SMS ou WhatsApp), selon ses
// modèles, au responsable principal ; chaque envoi est journalisé avec son coût, et un plafond mensuel
// peut l'arrêter. Absence (D15 : un par jour, 30 min après l'appel), reçu de paiement, bulletin publié.
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { t } from "@/i18n";
import { formatXAF } from "@/lib/money";
import { todayInBrazzaville } from "@/lib/dates";
import { withSchool, type Tx } from "@/server/db/client";
import {
  attendance,
  classes,
  enrollments,
  guardians,
  invoices,
  notifications,
  payments,
  periods,
  reportCards,
  schools,
  studentGuardians,
  students,
  timeSlots,
} from "@/server/db/schema";
import { NOTIFICATIONS_QUEUE, getJobQueue } from "@/server/jobs";
import { getMessageProvider, type Channel, type SmsProvider } from "@/server/sms";
import { amountDue } from "@/modules/finance/invoice-logic";
import { paidOnInvoice } from "@/modules/finance/invoices";
import { readTemplates, renderTemplate, type TemplateKind } from "./templates";

/** Délai entre l'appel et le message d'absence (décision D15). */
export const ABSENCE_DELAY_SECONDS = 30 * 60;

const base = { schoolId: z.uuid(), userId: z.uuid(), enrollmentId: z.uuid() };
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Tâche « notifications » ; une ancienne tâche d'absence (sans `type`) reste comprise. */
export const NoticeJobSchema = z.union([
  z.object({ type: z.literal("receipt"), ...base, paymentId: z.uuid() }),
  z.object({ type: z.literal("bulletin"), ...base, reportCardId: z.uuid() }),
  z.object({ type: z.literal("absence").optional(), ...base, date: isoDate }),
]);
export type NoticeJob = z.infer<typeof NoticeJobSchema>;

/**
 * Programme un message. Chaque tâche a sa clé : la file ne garde qu'une tâche en attente par clé
 * (un message d'absence par élève et par jour ; un par reçu ; un par bulletin).
 */
export async function scheduleNotice(job: NoticeJob): Promise<void> {
  const boss = await getJobQueue();
  const key =
    job.type === "receipt"
      ? `receipt:${job.paymentId}`
      : job.type === "bulletin"
        ? `bulletin:${job.reportCardId}:${job.enrollmentId}`
        : `${job.enrollmentId}:${job.date}`;
  await boss.send(NOTIFICATIONS_QUEUE, job, {
    singletonKey: key,
    startAfter: job.type === "receipt" || job.type === "bulletin" ? 0 : ABSENCE_DELAY_SECONDS,
  });
}

export type NoticeOutcome = "sent" | "nothingToSend" | "alreadySent" | "noPhone" | "capReached";

type Delivery = {
  schoolId: string;
  userId: string;
  enrollmentId: string;
  kind: TemplateKind;
  /** Jour concerné. */
  date: string;
  /** Objet concerné (paiement, fiche de bulletin) ; null pour l'absence du jour. */
  referenceId: string | null;
  values: Record<string, string>;
};

/** « 2026-11-24 » → « 24/11/2026 ». */
const frenchDate = (day: string) => day.split("-").reverse().join("/");

function sameMessage(d: Delivery) {
  return d.referenceId
    ? and(
        eq(notifications.kind, d.kind),
        eq(notifications.referenceId, d.referenceId),
        eq(notifications.enrollmentId, d.enrollmentId),
      )
    : and(
        eq(notifications.kind, "absence"),
        eq(notifications.enrollmentId, d.enrollmentId),
        eq(notifications.date, d.date),
      );
}

/**
 * Envoie un message s'il n'est pas déjà parti : modèle de l'école, canal de l'école, plafond mensuel.
 * Échec du prestataire : noté, puis erreur relancée (la file réessaie).
 */
async function deliver(
  d: Delivery,
  providers: (channel: Channel) => SmsProvider,
): Promise<NoticeOutcome> {
  const ctx = { schoolId: d.schoolId, userId: d.userId };
  const prepared = await withSchool(ctx, async (tx) => {
    const [previous] = await tx
      .select({ status: notifications.status, attempts: notifications.attempts })
      .from(notifications)
      .where(sameMessage(d));
    if (previous && previous.status !== "failed") return "alreadySent" as const;
    const [who] = await tx
      .select({
        lastName: students.lastName,
        firstNames: students.firstNames,
        sex: students.sex,
        className: classes.name,
        schoolName: schools.name,
        channel: schools.notificationChannel,
        templates: schools.notificationTemplates,
        cap: schools.notificationMonthlyCap,
        guardianId: guardians.id,
        phone: guardians.phone,
      })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .innerJoin(schools, eq(schools.id, enrollments.schoolId))
      .leftJoin(classes, eq(classes.id, enrollments.classId))
      .leftJoin(
        studentGuardians,
        and(eq(studentGuardians.studentId, students.id), eq(studentGuardians.isPrimary, true)),
      )
      .leftJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
      .where(eq(enrollments.id, d.enrollmentId));
    if (!who?.phone) return "noPhone" as const;
    const channel: Channel = who.channel === "whatsapp" ? "whatsapp" : "sms";
    const body = renderTemplate(readTemplates(who.templates)[d.kind], {
      ...d.values,
      ecole: who.schoolName,
      eleve: `${who.lastName} ${who.firstNames}`,
      classe: who.className ?? "",
      absent: who.sex === "F" ? "absente" : "absent",
    });
    const monthStart = `${todayInBrazzaville().slice(0, 8)}01`;
    const [spent] = await tx
      .select({ total: sql<number>`coalesce(sum(${notifications.cost}), 0)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.status, "sent"),
          gte(notifications.createdAt, sql`(${monthStart}::date)::timestamptz`),
        ),
      );
    return {
      guardianId: who.guardianId,
      phone: who.phone,
      channel,
      body,
      attempts: previous?.attempts ?? 0,
      capReached: who.cap !== null && spent.total + providers(channel).unitCost > who.cap,
    };
  });
  if (typeof prepared === "string") return prepared;

  const record = (values: {
    status: "sent" | "failed" | "skipped";
    providerRef?: string;
    error?: string;
    cost?: number;
  }) =>
    withSchool(ctx, async (tx) => {
      const set = {
        status: values.status,
        channel: prepared.channel,
        cost: values.cost ?? 0,
        providerRef: values.providerRef ?? null,
        error: values.error ?? null,
        body: prepared.body,
        sentAt: values.status === "sent" ? new Date() : null,
      };
      const [existing] = await tx
        .select({ id: notifications.id })
        .from(notifications)
        .where(sameMessage(d))
        .for("update");
      if (existing) {
        await tx
          .update(notifications)
          .set({ ...set, attempts: prepared.attempts + 1 })
          .where(eq(notifications.id, existing.id));
      } else {
        await tx.insert(notifications).values({
          ...set,
          schoolId: d.schoolId,
          kind: d.kind,
          enrollmentId: d.enrollmentId,
          date: d.date,
          referenceId: d.referenceId,
          guardianId: prepared.guardianId,
          phone: prepared.phone,
        });
      }
    });

  if (prepared.capReached) {
    await record({ status: "skipped", error: t("notifications.capReached") });
    return "capReached";
  }
  let sent: { ref: string; cost: number };
  try {
    sent = await providers(prepared.channel).send(prepared.phone, prepared.body);
  } catch (error) {
    await record({ status: "failed", error: (error as Error).message.slice(0, 300) });
    throw error;
  }
  await record({ status: "sent", providerRef: sent.ref, cost: sent.cost });
  return "sent";
}

/** Créneaux d'absence non justifiés d'un élève un jour donné. */
async function missedSlots(tx: Tx, enrollmentId: string, date: string): Promise<string[]> {
  const rows = await tx
    .select({ label: timeSlots.label })
    .from(attendance)
    .innerJoin(timeSlots, eq(timeSlots.id, attendance.timeSlotId))
    .where(
      and(
        eq(attendance.enrollmentId, enrollmentId),
        eq(attendance.date, date),
        eq(attendance.status, "absent"),
        eq(attendance.justified, false),
      ),
    )
    .orderBy(asc(timeSlots.startTime));
  return rows.map((r) => r.label);
}

/** Tâche du worker : prépare et envoie le message demandé. */
export async function processNotice(
  input: unknown,
  providers: (channel: Channel) => SmsProvider = getMessageProvider,
): Promise<NoticeOutcome> {
  const job = NoticeJobSchema.parse(input);
  const ctx = { schoolId: job.schoolId, userId: job.userId };
  const common = { schoolId: job.schoolId, userId: job.userId, enrollmentId: job.enrollmentId };

  if (job.type === "receipt") {
    const info = await withSchool(ctx, async (tx) => {
      const [p] = await tx
        .select({
          amount: payments.amount,
          receipt: payments.receiptNumber,
          paidAt: payments.paidAt,
        })
        .from(payments)
        .where(and(eq(payments.id, job.paymentId), eq(payments.kind, "payment")));
      if (!p) return null;
      const open = await tx
        .select({ invoice: invoices, paid: paidOnInvoice })
        .from(invoices)
        .where(and(eq(invoices.enrollmentId, job.enrollmentId), eq(invoices.status, "open")));
      return { ...p, remaining: open.reduce((s, r) => s + amountDue(r.invoice) - r.paid, 0) };
    });
    if (!info) return "nothingToSend";
    return deliver(
      {
        ...common,
        kind: "receipt",
        date: todayInBrazzaville(info.paidAt),
        referenceId: job.paymentId,
        values: {
          montant: formatXAF(info.amount),
          numero: info.receipt ?? "",
          reste: formatXAF(Math.max(0, info.remaining)),
        },
      },
      providers,
    );
  }

  if (job.type === "bulletin") {
    const card = await withSchool(ctx, async (tx) => {
      const [row] = await tx
        .select({
          kind: reportCards.kind,
          periodLabel: periods.label,
          publishedAt: reportCards.publishedAt,
        })
        .from(reportCards)
        .leftJoin(periods, eq(periods.id, reportCards.periodId))
        .where(eq(reportCards.id, job.reportCardId));
      return row?.publishedAt ? row : null;
    });
    if (!card) return "nothingToSend";
    return deliver(
      {
        ...common,
        kind: "bulletin",
        date: todayInBrazzaville(card.publishedAt as Date),
        referenceId: job.reportCardId,
        values: {
          periode: card.kind === "annual" ? t("notifications.annual") : (card.periodLabel ?? ""),
        },
      },
      providers,
    );
  }

  // Absence du jour : rien si elle a été corrigée ou justifiée entre-temps.
  const missed = await withSchool(ctx, (tx) => missedSlots(tx, job.enrollmentId, job.date));
  if (missed.length === 0) return "nothingToSend";
  return deliver(
    {
      ...common,
      kind: "absence",
      date: job.date,
      referenceId: null,
      values: { date: frenchDate(job.date), creneaux: missed.join(", ") },
    },
    providers,
  );
}
