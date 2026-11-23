// Les listes exportables (4g) : élèves, classes, impayés, encaissements, absences, résultats. Chaque
// liste applique les droits de l'écran correspondant : on n'exporte que ce qu'on peut déjà voir.
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { t } from "@/i18n";
import { brazzavilleDayRange, formatTime } from "@/lib/dates";
import { listAbsenceDays } from "@/modules/attendance/justify";
import { listArrears } from "@/modules/finance/arrears";
import { getAnnualResults, getClassResults } from "@/modules/grading/results";
import { readContext, teacherStudentsFilter } from "@/modules/students/students";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool } from "@/server/db/client";
import {
  academicYears,
  classes,
  enrollments,
  levels,
  payments,
  periods,
  students,
  users,
} from "@/server/db/schema";
import { fileSlug, frenchDate, type Cell, type ExportTable } from "./table";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Plage de dates d'un export : au plus un an (une année scolaire). */
const DateRange = z
  .object({ from: isoDate, to: isoDate })
  .refine((r) => r.from <= r.to, { message: "order" })
  .refine((r) => Date.parse(r.to) - Date.parse(r.from) <= 366 * 86_400_000, { message: "range" });

export const ExportRequestSchema = z.discriminatedUnion("list", [
  z.object({
    list: z.literal("students"),
    yearId: z.uuid(),
    status: z.enum(["all", "enrolled", "pre_enrolled", "left"]).default("all"),
    classId: z.uuid().optional(),
  }),
  z.object({ list: z.literal("classes"), yearId: z.uuid() }),
  z.object({ list: z.literal("arrears"), yearId: z.uuid(), classId: z.uuid().optional() }),
  z.object({ list: z.literal("payments"), from: isoDate, to: isoDate }),
  z.object({
    list: z.literal("absences"),
    from: isoDate,
    to: isoDate,
    classId: z.uuid().optional(),
  }),
  z.object({
    list: z.literal("results"),
    classId: z.uuid(),
    periodKey: z.union([z.uuid(), z.literal("annee")]),
  }),
]);
export type ExportRequest = z.infer<typeof ExportRequestSchema>;
export type ExportList = ExportRequest["list"];

export class ExportError extends Error {
  constructor(readonly code: "notFound" | "dateRange") {
    super(code);
  }
}

/** Construit le tableau demandé (droits vérifiés par chaque liste). */
export async function buildExport(principal: Principal, raw: unknown): Promise<ExportTable> {
  const request = ExportRequestSchema.parse(raw);
  switch (request.list) {
    case "students":
      return studentsTable(principal, request);
    case "classes":
      return classesTable(principal, request.yearId);
    case "arrears":
      return arrearsTable(principal, request);
    case "payments":
      return paymentsTable(principal, checkRange(request));
    case "absences":
      return absencesTable(principal, { ...checkRange(request), classId: request.classId });
    case "results":
      return resultsTable(principal, request.classId, request.periodKey);
  }
}

function checkRange(r: { from: string; to: string }) {
  if (!DateRange.safeParse(r).success) throw new ExportError("dateRange");
  return { from: r.from, to: r.to };
}

const ctxOf = (p: Principal) => ({ schoolId: p.schoolId as string, userId: p.userId });

async function yearLabel(principal: Principal, yearId: string): Promise<string> {
  const ctx = ctxOf(principal);
  const [row] = await withSchool(ctx, (tx) =>
    tx
      .select({ label: academicYears.label })
      .from(academicYears)
      .where(and(eq(academicYears.schoolId, ctx.schoolId), eq(academicYears.id, yearId))),
  );
  if (!row) throw new ExportError("notFound");
  return row.label;
}

const sexLabel = (s: "M" | "F") => (s === "F" ? "F" : "G");

async function studentsTable(
  principal: Principal,
  r: Extract<ExportRequest, { list: "students" }>,
): Promise<ExportTable> {
  const ctx = readContext(principal);
  const label = await yearLabel(principal, r.yearId);
  const rows = await withSchool(ctx, (tx) =>
    tx
      .select({
        matricule: students.matricule,
        lastName: students.lastName,
        firstNames: students.firstNames,
        sex: students.sex,
        birthDate: students.birthDate,
        levelName: levels.name,
        className: classes.name,
        status: enrollments.status,
        guardianName: sql<string | null>`(select g.full_name from student_guardians sg
          join guardians g on g.id = sg.guardian_id
          where sg.student_id = "students"."id" and sg.is_primary limit 1)`,
        guardianPhone: sql<string | null>`(select g.phone from student_guardians sg
          join guardians g on g.id = sg.guardian_id
          where sg.student_id = "students"."id" and sg.is_primary limit 1)`,
      })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .innerJoin(levels, eq(levels.id, enrollments.levelId))
      .leftJoin(classes, eq(classes.id, enrollments.classId))
      .where(
        and(
          eq(enrollments.schoolId, ctx.schoolId),
          eq(enrollments.academicYearId, r.yearId),
          r.status !== "all" ? eq(enrollments.status, r.status) : undefined,
          r.classId ? eq(enrollments.classId, r.classId) : undefined,
          ctx.teacherOnly ? teacherStudentsFilter(ctx.userId) : undefined,
        ),
      )
      .orderBy(
        asc(levels.position),
        asc(classes.name),
        asc(students.lastName),
        asc(students.firstNames),
      ),
  );
  const className = r.classId ? (rows[0]?.className ?? null) : null;
  return {
    title: t("exports.lists.students"),
    subtitle: [
      t("exports.year", { annee: label }),
      ...(className ? [t("exports.class", { classe: className })] : []),
      ...(r.status !== "all" ? [t(`enrollments.status.${r.status}`)] : []),
      t("exports.count", { n: rows.length }),
    ],
    columns: [
      { header: "Matricule", kind: "text", width: 16 },
      { header: "Nom", kind: "text", width: 20 },
      { header: "Prénoms", kind: "text", width: 24 },
      { header: "Sexe", kind: "text", width: 6 },
      { header: "Né(e) le", kind: "date", width: 12 },
      { header: "Niveau", kind: "text", width: 10 },
      { header: "Classe", kind: "text", width: 10 },
      { header: "État", kind: "text", width: 11 },
      { header: "Responsable", kind: "text", width: 24 },
      { header: "Téléphone", kind: "text", width: 16 },
    ],
    rows: rows.map((s) => [
      s.matricule,
      s.lastName,
      s.firstNames,
      sexLabel(s.sex),
      s.birthDate ? frenchDate(s.birthDate) : null,
      s.levelName,
      s.className,
      t(`enrollments.status.${s.status}`),
      s.guardianName,
      s.guardianPhone,
    ]),
    fileName: `eleves-${fileSlug(label)}${className ? `-${fileSlug(className)}` : ""}`,
    landscape: true,
  };
}

async function classesTable(principal: Principal, yearId: string): Promise<ExportTable> {
  const ctx = readContext(principal);
  const label = await yearLabel(principal, yearId);
  const rows = await withSchool(ctx, (tx) =>
    tx
      .select({
        name: classes.name,
        levelName: levels.name,
        capacity: classes.capacity,
        headTeacher: users.name,
        enrolled: sql<number>`(select count(*)::int from enrollments e
          where e.class_id = "classes"."id" and e.status = 'enrolled')`,
        girls: sql<number>`(select count(*)::int from enrollments e join students s on s.id = e.student_id
          where e.class_id = "classes"."id" and e.status = 'enrolled' and s.sex = 'F')`,
      })
      .from(classes)
      .innerJoin(levels, eq(levels.id, classes.levelId))
      .leftJoin(users, eq(users.id, classes.headTeacherId))
      .where(
        and(
          eq(classes.schoolId, ctx.schoolId),
          eq(classes.academicYearId, yearId),
          ctx.teacherOnly
            ? sql`("classes"."head_teacher_id" = ${ctx.userId} or "classes"."id" in (
                select cs.class_id from class_subjects cs where cs.teacher_id = ${ctx.userId}))`
            : undefined,
        ),
      )
      .orderBy(asc(levels.position), asc(classes.name)),
  );
  const total = rows.reduce((n, c) => n + c.enrolled, 0);
  const girls = rows.reduce((n, c) => n + c.girls, 0);
  return {
    title: t("exports.lists.classes"),
    subtitle: [t("exports.year", { annee: label }), t("exports.classCount", { n: rows.length })],
    columns: [
      { header: "Classe", kind: "text", width: 12 },
      { header: "Niveau", kind: "text", width: 10 },
      { header: "Professeur principal", kind: "text", width: 26 },
      { header: "Capacité", kind: "number" },
      { header: "Inscrits", kind: "number" },
      { header: "Filles", kind: "number" },
      { header: "Garçons", kind: "number" },
    ],
    rows: rows.map((c) => [
      c.name,
      c.levelName,
      c.headTeacher,
      c.capacity,
      c.enrolled,
      c.girls,
      c.enrolled - c.girls,
    ]),
    totals: ["Total", null, null, null, total, girls, total - girls],
    fileName: `classes-${fileSlug(label)}`,
  };
}

async function arrearsTable(
  principal: Principal,
  r: Extract<ExportRequest, { list: "arrears" }>,
): Promise<ExportTable> {
  const rows = await listArrears(principal, { academicYearId: r.yearId, classId: r.classId });
  const label = await yearLabel(principal, r.yearId);
  const className = r.classId ? (rows[0]?.className ?? null) : null;
  return {
    title: t("exports.lists.arrears"),
    subtitle: [
      t("exports.year", { annee: label }),
      ...(className ? [t("exports.class", { classe: className })] : []),
      t("exports.count", { n: rows.length }),
    ],
    columns: [
      { header: "Matricule", kind: "text", width: 16 },
      { header: "Élève", kind: "text", width: 30 },
      { header: "Classe", kind: "text", width: 10 },
      { header: "Téléphone du responsable", kind: "text", width: 18 },
      { header: "Plus ancienne échéance", kind: "date", width: 14 },
      { header: "Jours de retard", kind: "number" },
      { header: "Montant en retard", kind: "money", width: 18 },
    ],
    rows: rows.map((a) => [
      a.matricule,
      a.studentName,
      a.className ?? a.levelName,
      a.guardianPhone,
      frenchDate(a.oldestDueDate),
      a.daysLate,
      a.overdue,
    ]),
    totals: ["Total", null, null, null, null, null, rows.reduce((n, a) => n + a.overdue, 0)],
    fileName: `impayes-${fileSlug(label)}${className ? `-${fileSlug(className)}` : ""}`,
  };
}

async function paymentsTable(
  principal: Principal,
  range: { from: string; to: string },
): Promise<ExportTable> {
  authorize(principal, "dashboard:finance");
  const ctx = ctxOf(principal);
  const from = brazzavilleDayRange(range.from).from;
  const to = brazzavilleDayRange(range.to).to;
  const rows = await withSchool(ctx, (tx) =>
    tx
      .select({
        paidAt: payments.paidAt,
        kind: payments.kind,
        receiptNumber: payments.receiptNumber,
        reversedReceipt: sql<string | null>`(select o.receipt_number from payments o
          where o.id = "payments"."reverses_id")`,
        matricule: students.matricule,
        studentName: sql<string>`${students.lastName} || ' ' || ${students.firstNames}`,
        className: classes.name,
        method: payments.method,
        reference: payments.reference,
        cashierName: users.name,
        amount: payments.amount,
      })
      .from(payments)
      .innerJoin(enrollments, eq(enrollments.id, payments.enrollmentId))
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .leftJoin(classes, eq(classes.id, enrollments.classId))
      .innerJoin(users, eq(users.id, payments.cashierId))
      .where(
        and(
          eq(payments.schoolId, ctx.schoolId),
          gte(payments.paidAt, from),
          lt(payments.paidAt, to),
        ),
      )
      .orderBy(asc(payments.paidAt)),
  );
  const dayOf = (d: Date) =>
    new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Brazzaville" }).format(d);
  return {
    title: t("exports.lists.payments"),
    subtitle: [
      t("exports.dates", { du: frenchDate(range.from), au: frenchDate(range.to) }),
      t("exports.count", { n: rows.length }),
    ],
    columns: [
      { header: "Date", kind: "date", width: 12 },
      { header: "Heure", kind: "text", width: 7 },
      { header: "Reçu", kind: "text", width: 18 },
      { header: "Matricule", kind: "text", width: 16 },
      { header: "Élève", kind: "text", width: 28 },
      { header: "Classe", kind: "text", width: 10 },
      { header: "Mode", kind: "text", width: 14 },
      { header: "Référence", kind: "text", width: 16 },
      { header: "Caissier", kind: "text", width: 20 },
      { header: "Montant", kind: "money", width: 16 },
    ],
    rows: rows.map((p): Cell[] => [
      dayOf(p.paidAt),
      formatTime(p.paidAt),
      p.kind === "reversal"
        ? t("exports.reversal", { numero: p.reversedReceipt ?? "" })
        : p.receiptNumber,
      p.matricule,
      p.studentName,
      p.className,
      t(`finance.methods.${p.method}`),
      p.reference,
      p.cashierName,
      p.amount,
    ]),
    totals: [
      "Total",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      rows.reduce((n, p) => n + p.amount, 0),
    ],
    fileName: `encaissements-${range.from}-${range.to}`,
    landscape: true,
  };
}

async function absencesTable(
  principal: Principal,
  r: { from: string; to: string; classId?: string },
): Promise<ExportTable> {
  const days = await listAbsenceDays(principal, { ...r, includeJustified: true });
  const rows: Cell[][] = [];
  // Ordre chronologique, puis par élève (l'écran montre le plus récent d'abord).
  const ordered = [...days].sort(
    (x, y) =>
      x.date.localeCompare(y.date) ||
      `${x.lastName} ${x.firstNames}`.localeCompare(`${y.lastName} ${y.firstNames}`, "fr"),
  );
  for (const d of ordered) {
    for (const m of d.marks) {
      rows.push([
        frenchDate(d.date),
        `${d.lastName} ${d.firstNames}`,
        d.className,
        m.slotLabel,
        m.status === "absent" ? "Absence" : "Retard",
        m.justified ? "Oui" : "Non",
        m.reason,
      ]);
    }
  }
  const className = r.classId ? (days[0]?.className ?? null) : null;
  return {
    title: t("exports.lists.absences"),
    subtitle: [
      t("exports.dates", { du: frenchDate(r.from), au: frenchDate(r.to) }),
      ...(className ? [t("exports.class", { classe: className })] : []),
      t("exports.count", { n: rows.length }),
    ],
    columns: [
      { header: "Date", kind: "date", width: 12 },
      { header: "Élève", kind: "text", width: 30 },
      { header: "Classe", kind: "text", width: 10 },
      { header: "Créneau", kind: "text", width: 14 },
      { header: "Type", kind: "text", width: 10 },
      { header: "Justifiée", kind: "text", width: 10 },
      { header: "Motif", kind: "text", width: 30 },
    ],
    rows,
    fileName: `absences-${r.from}-${r.to}${className ? `-${fileSlug(className)}` : ""}`,
  };
}

async function resultsTable(
  principal: Principal,
  classId: string,
  periodKey: string,
): Promise<ExportTable> {
  if (periodKey === "annee") {
    const a = await getAnnualResults(principal, classId);
    return {
      title: t("exports.lists.results"),
      subtitle: [t("exports.class", { classe: a.className }), t("exports.annual")],
      columns: [
        { header: "Rang", kind: "text", width: 6 },
        { header: "Matricule", kind: "text", width: 16 },
        { header: "Nom et prénoms", kind: "text", width: 30 },
        ...a.periods.map((p) => ({ header: p.label, kind: "number" as const, width: 14 })),
        { header: `Moyenne annuelle /${a.scale}`, kind: "number", width: 16 },
        { header: "Mention", kind: "text", width: 16 },
      ],
      rows: a.students.map((s) => [
        rankText(s.rank, s.tied),
        s.matricule,
        `${s.lastName} ${s.firstNames}`,
        ...s.periods,
        s.average,
        s.mention,
      ]),
      fileName: `resultats-${fileSlug(a.className)}-annuel`,
      landscape: a.periods.length > 2,
    };
  }
  const r = await getClassResults(principal, classId, periodKey);
  if (r.period.id !== periodKey) throw new ExportError("notFound");
  return {
    title: t("exports.lists.results"),
    subtitle: [t("exports.class", { classe: r.className }), r.period.label],
    columns: [
      { header: "Rang", kind: "text", width: 6 },
      { header: "Matricule", kind: "text", width: 16 },
      { header: "Nom et prénoms", kind: "text", width: 30 },
      ...r.subjects.map((s) => ({
        header: `${s.name} (coef. ${s.coefficient})`,
        kind: "number" as const,
        width: 14,
      })),
      { header: `Moyenne /${r.scale}`, kind: "number", width: 12 },
      { header: "Mention", kind: "text", width: 16 },
    ],
    rows: [...r.students]
      .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity))
      .map((s) => [
        rankText(s.rank, s.tied),
        s.matricule,
        `${s.lastName} ${s.firstNames}`,
        ...r.subjects.map(
          (sub) => s.subjects.find((x) => x.subjectId === sub.subjectId)?.average ?? null,
        ),
        s.average,
        s.mention,
      ]),
    fileName: `resultats-${fileSlug(r.className)}-${fileSlug(r.period.label)}`,
    landscape: true,
  };
}

/** Rang écrit comme sur le bulletin : « 1er », « 2e », « 3e ex », vide pour un non classé. */
function rankText(rank: number | null, tied: boolean): string | null {
  if (rank === null) return null;
  return `${rank === 1 ? "1er" : `${rank}e`}${tied ? " ex" : ""}`;
}

export type ExportChoices = {
  years: { id: string; label: string; status: "upcoming" | "active" | "archived" }[];
  yearId: string | null;
  /** Classes de l'année choisie que le lecteur peut voir (les siennes pour un enseignant). */
  classes: { id: string; name: string }[];
  periods: { id: string; label: string }[];
};

/** Années, classes et périodes proposées dans les filtres des exports. */
export async function exportChoices(principal: Principal, yearId?: string): Promise<ExportChoices> {
  const ctx = readContext(principal);
  return withSchool(ctx, async (tx) => {
    const years = await tx
      .select({ id: academicYears.id, label: academicYears.label, status: academicYears.status })
      .from(academicYears)
      .where(eq(academicYears.schoolId, ctx.schoolId))
      .orderBy(sql`${academicYears.startDate} desc`);
    const year =
      years.find((y) => y.id === yearId) ??
      years.find((y) => y.status === "active") ??
      years.find((y) => y.status === "upcoming") ??
      years[0];
    if (!year) return { years, yearId: null, classes: [], periods: [] };
    const classRows = await tx
      .select({ id: classes.id, name: classes.name })
      .from(classes)
      .innerJoin(levels, eq(levels.id, classes.levelId))
      .where(
        and(
          eq(classes.schoolId, ctx.schoolId),
          eq(classes.academicYearId, year.id),
          ctx.teacherOnly
            ? sql`("classes"."head_teacher_id" = ${ctx.userId} or "classes"."id" in (
                select cs.class_id from class_subjects cs where cs.teacher_id = ${ctx.userId}))`
            : undefined,
        ),
      )
      .orderBy(asc(levels.position), asc(classes.name));
    const periodRows = await tx
      .select({ id: periods.id, label: periods.label })
      .from(periods)
      .where(eq(periods.academicYearId, year.id))
      .orderBy(asc(periods.position));
    return { years, yearId: year.id, classes: classRows, periods: periodRows };
  });
}
