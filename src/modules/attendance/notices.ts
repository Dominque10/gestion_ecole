// SMS d'absence au parent (décision D15) : un seul par élève et par jour, au responsable principal,
// 30 minutes après l'appel (le temps de corriger une erreur) ; rien ne part si l'absence a été
// corrigée ou justifiée entre-temps. Les retards ne sont pas signalés.
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { t } from "@/i18n";
import { withSchool } from "@/server/db/client";
import {
  attendance,
  classes,
  enrollments,
  guardians,
  notifications,
  schools,
  studentGuardians,
  students,
  timeSlots,
} from "@/server/db/schema";
import { NOTIFICATIONS_QUEUE, getJobQueue } from "@/server/jobs";
import { getSmsProvider, type SmsProvider } from "@/server/sms";

/** Délai entre l'appel et le SMS (décision D15). */
export const NOTICE_DELAY_SECONDS = 30 * 60;

export const AbsenceNoticeSchema = z.object({
  schoolId: z.uuid(),
  /** Compte qui a fait l'appel (le worker agit en son nom, sous la RLS de l'école). */
  userId: z.uuid(),
  enrollmentId: z.uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type AbsenceNotice = z.infer<typeof AbsenceNoticeSchema>;

/** Programme le SMS du jour (une seule tâche en attente par élève et par jour). */
export async function scheduleAbsenceNotice(notice: AbsenceNotice): Promise<void> {
  const boss = await getJobQueue();
  await boss.send(NOTIFICATIONS_QUEUE, notice, {
    singletonKey: `${notice.enrollmentId}:${notice.date}`,
    startAfter: NOTICE_DELAY_SECONDS,
  });
}

/** « 2026-11-24 » → « 24/11/2026 ». */
const frenchDate = (day: string) => day.split("-").reverse().join("/");

export type NoticeOutcome = "sent" | "nothingToSend" | "alreadySent" | "noPhone";

/**
 * Tâche du worker : envoie le SMS du jour s'il reste des absences non justifiées et qu'aucun SMS n'est
 * déjà parti. Si le prestataire échoue, l'échec est noté et l'erreur relancée (nouvel essai).
 */
export async function processAbsenceNotice(
  input: unknown,
  provider: SmsProvider = getSmsProvider(),
): Promise<NoticeOutcome> {
  const notice = AbsenceNoticeSchema.parse(input);
  const ctx = { schoolId: notice.schoolId, userId: notice.userId };
  const prepared = await withSchool(ctx, async (tx) => {
    const [previous] = await tx
      .select({ status: notifications.status, attempts: notifications.attempts })
      .from(notifications)
      .where(
        and(
          eq(notifications.enrollmentId, notice.enrollmentId),
          eq(notifications.kind, "absence"),
          eq(notifications.date, notice.date),
        ),
      );
    if (previous?.status === "sent") return "alreadySent" as const;
    const missed = await tx
      .select({ label: timeSlots.label })
      .from(attendance)
      .innerJoin(timeSlots, eq(timeSlots.id, attendance.timeSlotId))
      .where(
        and(
          eq(attendance.enrollmentId, notice.enrollmentId),
          eq(attendance.date, notice.date),
          eq(attendance.status, "absent"),
          eq(attendance.justified, false),
        ),
      )
      .orderBy(asc(timeSlots.startTime));
    if (missed.length === 0) return "nothingToSend" as const;
    const [who] = await tx
      .select({
        lastName: students.lastName,
        firstNames: students.firstNames,
        sex: students.sex,
        className: classes.name,
        schoolName: schools.name,
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
      .where(eq(enrollments.id, notice.enrollmentId));
    if (!who?.phone) return "noPhone" as const;
    return {
      guardianId: who.guardianId,
      phone: who.phone,
      attempts: previous?.attempts ?? 0,
      body: t(who.sex === "F" ? "attendance.smsF" : "attendance.smsM", {
        ecole: who.schoolName,
        eleve: `${who.lastName} ${who.firstNames}`,
        classe: who.className ?? "",
        date: frenchDate(notice.date),
        creneaux: missed.map((m) => m.label).join(", "),
      }),
    };
  });
  if (typeof prepared === "string") return prepared;

  const record = (values: { status: "sent" | "failed"; providerRef?: string; error?: string }) =>
    withSchool(ctx, (tx) =>
      tx
        .insert(notifications)
        .values({
          schoolId: notice.schoolId,
          kind: "absence",
          enrollmentId: notice.enrollmentId,
          date: notice.date,
          guardianId: prepared.guardianId,
          phone: prepared.phone,
          body: prepared.body,
          sentAt: values.status === "sent" ? new Date() : null,
          ...values,
        })
        .onConflictDoUpdate({
          target: [notifications.enrollmentId, notifications.kind, notifications.date],
          set: {
            status: values.status,
            providerRef: values.providerRef ?? null,
            error: values.error ?? null,
            body: prepared.body,
            sentAt: values.status === "sent" ? new Date() : null,
            attempts: prepared.attempts + 1,
          },
        }),
    );

  let ref: string;
  try {
    ({ ref } = await provider.send(prepared.phone, prepared.body));
  } catch (error) {
    await record({ status: "failed", error: (error as Error).message.slice(0, 300) });
    throw error;
  }
  await record({ status: "sent", providerRef: ref });
  return "sent";
}
