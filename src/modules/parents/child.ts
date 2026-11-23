// Espace parents (M6) : lectures d'un enfant. Le droit `parent:view` est vérifié ici, et la RLS
// (politiques « parent », 4a) garantit qu'un parent ne lit que ses propres enfants.
import { and, desc, eq, isNotNull, lt, ne } from "drizzle-orm";
import { z } from "zod";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool, type Tx } from "@/server/db/client";
import {
  academicYears,
  attendance,
  classes,
  enrollments,
  invoices,
  levels,
  periods,
  reportCards,
  schools,
  students,
  timeSlots,
} from "@/server/db/schema";
import { t } from "@/i18n";
import { todayInBrazzaville } from "@/lib/dates";
import { amountDue } from "@/modules/finance/invoice-logic";
import { listInvoices, paidOnInvoice, type Invoice } from "@/modules/finance/invoices";
import { listPayments, type PaymentLine } from "@/modules/finance/payments";
import type { Bulletin } from "@/modules/grading/bulletins";

export type ChildSummary = {
  enrollmentId: string;
  lastName: string;
  firstNames: string;
  matricule: string;
  className: string | null;
  levelName: string;
  yearLabel: string;
  schoolName: string;
};

/** Fiche d'en-tête d'un enfant de l'école de session ; null si ce n'est pas un enfant du parent. */
export async function getChildSummary(
  principal: Principal,
  enrollmentId: string,
): Promise<ChildSummary | null> {
  authorize(principal, "parent:view");
  if (!z.uuid().safeParse(enrollmentId).success) return null;
  const ctx = { schoolId: principal.schoolId as string, userId: principal.userId };
  return withSchool(ctx, async (tx) => {
    const [row] = await tx
      .select({
        enrollmentId: enrollments.id,
        lastName: students.lastName,
        firstNames: students.firstNames,
        matricule: students.matricule,
        className: classes.name,
        levelName: levels.name,
        yearLabel: academicYears.label,
        schoolName: schools.name,
      })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .innerJoin(levels, eq(levels.id, enrollments.levelId))
      .innerJoin(academicYears, eq(academicYears.id, enrollments.academicYearId))
      .innerJoin(schools, eq(schools.id, enrollments.schoolId))
      .leftJoin(classes, eq(classes.id, enrollments.classId))
      .where(and(eq(enrollments.schoolId, ctx.schoolId), eq(enrollments.id, enrollmentId)));
    return row ?? null;
  });
}

// --- Frais (4b) ---------------------------------------------------------------------------------

export type ChildAccount = {
  invoices: Invoice[];
  payments: PaymentLine[];
  /** Reste à payer sur les échéances ouvertes. */
  remaining: number;
  /** Dont échu (date limite passée). */
  overdue: number;
};

/** Échéances, paiements et reçus de l'enfant (lectures de la caisse, limitées par la RLS « parent »). */
export async function getChildAccount(
  principal: Principal,
  enrollmentId: string,
): Promise<ChildAccount> {
  authorize(principal, "parent:view");
  const [list, paid] = await Promise.all([
    listInvoices(principal, enrollmentId),
    listPayments(principal, enrollmentId),
  ]);
  const today = todayInBrazzaville();
  const open = list.filter((i) => i.status === "open" && i.remaining > 0);
  return {
    invoices: list.filter((i) => i.status === "open"),
    payments: paid,
    remaining: open.reduce((sum, i) => sum + i.remaining, 0),
    overdue: open.filter((i) => i.dueDate < today).reduce((sum, i) => sum + i.remaining, 0),
  };
}

// --- Bulletins publiés (4b) -----------------------------------------------------------------------

export type ChildBulletin = { reportCardId: string; label: string; publishedAt: Date };

export type ChildBulletins = {
  bulletins: ChildBulletin[];
  /** Option B7 de l'école active et échéance échue impayée : bulletins cachés au parent. */
  blocked: boolean;
};

/** Option de blocage active et échéance obligatoire échue impayée ? */
async function bulletinsBlocked(tx: Tx, schoolId: string, enrollmentId: string): Promise<boolean> {
  const [school] = await tx
    .select({ enabled: schools.blockBulletinsIfOverdue })
    .from(schools)
    .where(eq(schools.id, schoolId));
  if (!school?.enabled) return false;
  const rows = await tx
    .select({ invoice: invoices, paid: paidOnInvoice })
    .from(invoices)
    .where(
      and(
        eq(invoices.enrollmentId, enrollmentId),
        eq(invoices.status, "open"),
        eq(invoices.mandatory, true),
        lt(invoices.dueDate, todayInBrazzaville()),
      ),
    );
  return rows.some((r) => amountDue(r.invoice) - r.paid > 0);
}

/** Bulletins publiés de l'enfant, du plus récent au plus ancien (la RLS ne montre que les publiés). */
export async function getChildBulletins(
  principal: Principal,
  enrollmentId: string,
): Promise<ChildBulletins> {
  authorize(principal, "parent:view");
  if (!z.uuid().safeParse(enrollmentId).success) return { bulletins: [], blocked: false };
  const ctx = { schoolId: principal.schoolId as string, userId: principal.userId };
  return withSchool(ctx, async (tx) => {
    const rows = await tx
      .select({
        reportCardId: reportCards.id,
        kind: reportCards.kind,
        periodLabel: periods.label,
        publishedAt: reportCards.publishedAt,
      })
      .from(reportCards)
      .leftJoin(periods, eq(periods.id, reportCards.periodId))
      .where(and(eq(reportCards.enrollmentId, enrollmentId), isNotNull(reportCards.publishedAt)))
      .orderBy(desc(reportCards.publishedAt));
    const blocked = rows.length > 0 && (await bulletinsBlocked(tx, ctx.schoolId, enrollmentId));
    return {
      blocked,
      bulletins: blocked
        ? []
        : rows.map((r) => ({
            reportCardId: r.reportCardId,
            label: r.kind === "annual" ? t("parentSpace.annualBulletin") : (r.periodLabel ?? ""),
            publishedAt: r.publishedAt as Date,
          })),
    };
  });
}

/** Bulletin publié (photographie) pour le PDF ; null s'il n'est pas visible par ce parent. */
export async function getPublishedBulletin(
  principal: Principal,
  reportCardId: string,
): Promise<{ bulletin: Bulletin; publishedAt: Date } | null> {
  authorize(principal, "parent:view");
  if (!z.uuid().safeParse(reportCardId).success) return null;
  const ctx = { schoolId: principal.schoolId as string, userId: principal.userId };
  return withSchool(ctx, async (tx) => {
    const [row] = await tx
      .select({
        enrollmentId: reportCards.enrollmentId,
        snapshot: reportCards.snapshot,
        publishedAt: reportCards.publishedAt,
      })
      .from(reportCards)
      .where(and(eq(reportCards.id, reportCardId), isNotNull(reportCards.publishedAt)));
    if (!row?.snapshot || !row.publishedAt) return null;
    if (await bulletinsBlocked(tx, ctx.schoolId, row.enrollmentId)) return null;
    return { bulletin: row.snapshot as Bulletin, publishedAt: row.publishedAt };
  });
}

// --- Absences (4b) --------------------------------------------------------------------------------

export type ChildAttendance = {
  absences: number;
  unjustified: number;
  lates: number;
  /** Dernières absences et retards, du plus récent au plus ancien. */
  recent: {
    date: string;
    slotLabel: string;
    status: "absent" | "late";
    justified: boolean;
    reason: string | null;
  }[];
};

export async function getChildAttendance(
  principal: Principal,
  enrollmentId: string,
): Promise<ChildAttendance> {
  authorize(principal, "parent:view");
  const empty: ChildAttendance = { absences: 0, unjustified: 0, lates: 0, recent: [] };
  if (!z.uuid().safeParse(enrollmentId).success) return empty;
  const ctx = { schoolId: principal.schoolId as string, userId: principal.userId };
  return withSchool(ctx, async (tx) => {
    const rows = await tx
      .select({
        date: attendance.date,
        slotLabel: timeSlots.label,
        status: attendance.status,
        justified: attendance.justified,
        reason: attendance.justificationReason,
      })
      .from(attendance)
      .innerJoin(timeSlots, eq(timeSlots.id, attendance.timeSlotId))
      .where(and(eq(attendance.enrollmentId, enrollmentId), ne(attendance.status, "present")))
      .orderBy(desc(attendance.date), desc(timeSlots.startTime));
    return {
      absences: rows.filter((r) => r.status === "absent").length,
      unjustified: rows.filter((r) => r.status === "absent" && !r.justified).length,
      lates: rows.filter((r) => r.status === "late").length,
      recent: rows.slice(0, 15).map((r) => ({ ...r, status: r.status as "absent" | "late" })),
    };
  });
}
