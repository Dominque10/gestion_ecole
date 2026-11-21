// Liste des impayés (M3, 2e) : élèves avec des échéances en retard, par classe et par ancienneté.
import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { todayInBrazzaville } from "@/lib/dates";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool } from "@/server/db/client";
import {
  academicYears,
  classes,
  enrollments,
  invoices,
  levels,
  students,
} from "@/server/db/schema";
import { ageBucket, daysLate, type AgeBucket } from "./closure-logic";
import { amountDue } from "./invoice-logic";
import { paidOnInvoice } from "./invoices";

export type ArrearsRow = {
  enrollmentId: string;
  studentId: string;
  matricule: string;
  studentName: string;
  levelName: string;
  className: string | null;
  guardianPhone: string | null;
  overdue: number;
  oldestDueDate: string;
  daysLate: number;
  bucket: AgeBucket;
};

/**
 * Impayés d'une année au jour donné : pour chaque inscription, la somme des restes dus des échéances
 * dont la date limite est dépassée. Triés du plus gros montant au plus petit.
 */
export async function listArrears(
  principal: Principal,
  input: { academicYearId: string; classId?: string; today?: string },
): Promise<ArrearsRow[]> {
  authorize(principal, "dashboard:finance");
  const schoolId = principal.schoolId as string;
  if (!z.uuid().safeParse(input.academicYearId).success) return [];
  if (input.classId !== undefined && !z.uuid().safeParse(input.classId).success) return [];
  const today = input.today ?? todayInBrazzaville();
  const rows = await withSchool({ schoolId, userId: principal.userId }, (tx) =>
    tx
      .select({
        invoice: invoices,
        paid: paidOnInvoice,
        studentId: students.id,
        matricule: students.matricule,
        studentName: sql<string>`${students.lastName} || ' ' || ${students.firstNames}`,
        levelName: levels.name,
        className: classes.name,
        guardianPhone: sql<string | null>`(
          select g.phone from student_guardians sg join guardians g on g.id = sg.guardian_id
          where sg.student_id = "students"."id" and sg.is_primary limit 1)`,
      })
      .from(invoices)
      .innerJoin(enrollments, eq(enrollments.id, invoices.enrollmentId))
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .innerJoin(levels, eq(levels.id, enrollments.levelId))
      .leftJoin(classes, eq(classes.id, enrollments.classId))
      .where(
        and(
          eq(invoices.schoolId, schoolId),
          eq(invoices.academicYearId, input.academicYearId),
          eq(invoices.status, "open"),
          lt(invoices.dueDate, today),
          input.classId ? eq(enrollments.classId, input.classId) : undefined,
        ),
      )
      .orderBy(asc(invoices.dueDate)),
  );

  const byEnrollment = new Map<string, ArrearsRow>();
  for (const r of rows) {
    const remaining = amountDue(r.invoice) - r.paid;
    if (remaining <= 0) continue;
    const existing = byEnrollment.get(r.invoice.enrollmentId);
    if (existing) {
      existing.overdue += remaining;
      continue;
    }
    const late = daysLate(r.invoice.dueDate, today);
    byEnrollment.set(r.invoice.enrollmentId, {
      enrollmentId: r.invoice.enrollmentId,
      studentId: r.studentId,
      matricule: r.matricule,
      studentName: r.studentName,
      levelName: r.levelName,
      className: r.className,
      guardianPhone: r.guardianPhone,
      overdue: remaining,
      oldestDueDate: r.invoice.dueDate,
      daysLate: late,
      bucket: ageBucket(late),
    });
  }
  return [...byEnrollment.values()].sort(
    (a, b) => b.overdue - a.overdue || a.studentName.localeCompare(b.studentName, "fr"),
  );
}

/** Années et classes proposées dans les filtres des impayés (droit « tableau de bord finances »). */
export async function arrearsFilters(
  principal: Principal,
  academicYearId?: string,
): Promise<{
  years: { id: string; label: string; status: "upcoming" | "active" | "archived" }[];
  classes: { id: string; name: string }[];
}> {
  authorize(principal, "dashboard:finance");
  const schoolId = principal.schoolId as string;
  return withSchool({ schoolId, userId: principal.userId }, async (tx) => {
    const years = await tx
      .select({ id: academicYears.id, label: academicYears.label, status: academicYears.status })
      .from(academicYears)
      .where(eq(academicYears.schoolId, schoolId))
      .orderBy(desc(academicYears.startDate));
    const yearId =
      academicYearId && years.some((y) => y.id === academicYearId) ? academicYearId : null;
    const classRows = yearId
      ? await tx
          .select({ id: classes.id, name: classes.name })
          .from(classes)
          .where(and(eq(classes.schoolId, schoolId), eq(classes.academicYearId, yearId)))
          .orderBy(asc(classes.name))
      : [];
    return { years, classes: classRows };
  });
}
