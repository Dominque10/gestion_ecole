// Absences et retards à justifier (M5, sous-étape 3e) : le secrétariat (ou la direction) note le
// motif, avec une pièce justificative facultative (photo rangée avec les pièces de l'élève).
import { and, asc, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { z } from "zod";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool } from "@/server/db/client";
import {
  attendance,
  classes,
  enrollments,
  notifications,
  students,
  timeSlots,
} from "@/server/db/schema";
import { dbGuardCode } from "@/modules/settings/errors";
import { AttendanceError } from "./errors";

function justifyContext(principal: Principal) {
  authorize(principal, "attendance:justify");
  return { schoolId: principal.schoolId as string, userId: principal.userId };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export type AbsenceDay = {
  enrollmentId: string;
  studentId: string;
  lastName: string;
  firstNames: string;
  className: string | null;
  date: string;
  /** Créneaux manqués (absences et retards), dans l'ordre de la journée. */
  marks: {
    id: string;
    slotLabel: string;
    status: "absent" | "late";
    justified: boolean;
    reason: string | null;
  }[];
  /** SMS envoyé au parent pour cette journée. */
  smsSentAt: Date | null;
};

/**
 * Absences et retards d'une période (par défaut les 14 derniers jours), regroupés par élève et par
 * jour ; seulement ceux qui restent à justifier, sauf demande contraire.
 */
export async function listAbsenceDays(
  principal: Principal,
  filter: { from: string; to: string; classId?: string; includeJustified?: boolean },
): Promise<AbsenceDay[]> {
  const ctx = justifyContext(principal);
  const from = isoDate.parse(filter.from);
  const to = isoDate.parse(filter.to);
  const classId =
    filter.classId && z.uuid().safeParse(filter.classId).success ? filter.classId : null;
  return withSchool(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: attendance.id,
        enrollmentId: attendance.enrollmentId,
        studentId: students.id,
        lastName: students.lastName,
        firstNames: students.firstNames,
        className: classes.name,
        date: attendance.date,
        slotLabel: timeSlots.label,
        status: attendance.status,
        justified: attendance.justified,
        reason: attendance.justificationReason,
      })
      .from(attendance)
      .innerJoin(enrollments, eq(enrollments.id, attendance.enrollmentId))
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .innerJoin(timeSlots, eq(timeSlots.id, attendance.timeSlotId))
      .leftJoin(classes, eq(classes.id, enrollments.classId))
      .where(
        and(
          eq(attendance.schoolId, ctx.schoolId),
          ne(attendance.status, "present"),
          gte(attendance.date, from),
          lte(attendance.date, to),
          classId ? eq(enrollments.classId, classId) : undefined,
        ),
      )
      .orderBy(desc(attendance.date), asc(students.lastName), asc(timeSlots.startTime));
    const days = new Map<string, AbsenceDay>();
    for (const r of rows) {
      const key = `${r.enrollmentId}|${r.date}`;
      const day = days.get(key) ?? {
        enrollmentId: r.enrollmentId,
        studentId: r.studentId,
        lastName: r.lastName,
        firstNames: r.firstNames,
        className: r.className,
        date: r.date,
        marks: [],
        smsSentAt: null,
      };
      day.marks.push({
        id: r.id,
        slotLabel: r.slotLabel,
        status: r.status as "absent" | "late",
        justified: r.justified,
        reason: r.reason,
      });
      days.set(key, day);
    }
    const list = [...days.values()].filter(
      (d) => filter.includeJustified || d.marks.some((m) => !m.justified),
    );
    if (list.length > 0) {
      const sms = await tx
        .select({
          enrollmentId: notifications.enrollmentId,
          date: notifications.date,
          sentAt: notifications.sentAt,
        })
        .from(notifications)
        .where(
          and(
            eq(notifications.kind, "absence"),
            eq(notifications.status, "sent"),
            inArray(
              notifications.enrollmentId,
              list.map((d) => d.enrollmentId),
            ),
            gte(notifications.date, from),
            lte(notifications.date, to),
          ),
        );
      const sent = new Map(sms.map((s) => [`${s.enrollmentId}|${s.date}`, s.sentAt]));
      for (const d of list) d.smsSentAt = sent.get(`${d.enrollmentId}|${d.date}`) ?? null;
    }
    return list;
  });
}

/**
 * Justifie les absences et retards d'un élève sur une journée (tous, ou ceux donnés), avec un motif
 * et, si fournie, une pièce justificative déjà enregistrée dans les pièces de l'élève.
 */
export async function justifyDay(
  principal: Principal,
  input: { enrollmentId: string; date: string; reason: string; documentId?: string | null },
): Promise<number> {
  const ctx = justifyContext(principal);
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 200) throw new AttendanceError("reasonInvalid");
  if (!z.uuid().safeParse(input.enrollmentId).success || !isoDate.safeParse(input.date).success) {
    throw new AttendanceError("absenceNotFound");
  }
  try {
    return await withSchool(ctx, async (tx) => {
      const updated = await tx
        .update(attendance)
        .set({
          justified: true,
          justificationReason: reason,
          justificationDocumentId: input.documentId ?? null,
          justifiedBy: ctx.userId,
          justifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(attendance.enrollmentId, input.enrollmentId),
            eq(attendance.date, input.date),
            ne(attendance.status, "present"),
            eq(attendance.justified, false),
          ),
        )
        .returning({ id: attendance.id });
      if (updated.length === 0) throw new AttendanceError("absenceNotFound");
      return updated.length;
    });
  } catch (error) {
    if (dbGuardCode(error) === "GS001") throw new AttendanceError("yearArchived");
    throw error;
  }
}

/** Élève concerné par une inscription (pour ranger la pièce justificative). */
export async function studentOfEnrollment(
  principal: Principal,
  enrollmentId: string,
): Promise<string> {
  const ctx = justifyContext(principal);
  if (!z.uuid().safeParse(enrollmentId).success) throw new AttendanceError("absenceNotFound");
  return withSchool(ctx, async (tx) => {
    const [row] = await tx
      .select({ studentId: enrollments.studentId })
      .from(enrollments)
      .where(eq(enrollments.id, enrollmentId));
    if (!row) throw new AttendanceError("absenceNotFound");
    return row.studentId;
  });
}
