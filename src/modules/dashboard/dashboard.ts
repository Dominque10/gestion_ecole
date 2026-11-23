// Tableau de bord de la direction (M7, sous-étape 4f) : effectifs, encaissements et recouvrement,
// résultats scolaires, absentéisme, paiements en ligne. Requêtes agrégées sur l'année active ;
// critère d'acceptation : moins de 3 secondes pour une école de 2 000 élèves.
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { brazzavilleDayRange, todayInBrazzaville } from "@/lib/dates";
import { computePeriodResults } from "@/modules/grading/averages";
import { gradeValueOf, type GradeValue } from "@/modules/grading/grade-input";
import { scaleFor } from "@/modules/grading/rules";
import { loadGradingRules } from "@/modules/grading/settings";
import { authorize, can, ForbiddenError, type Principal } from "@/server/auth/permissions";
import { withSchool, type Tx } from "@/server/db/client";
import {
  academicYears,
  assessments,
  attendance,
  auditLogs,
  classes,
  classSubjects,
  enrollments,
  grades,
  levels,
  levelSubjects,
  payments,
  paymentIntents,
  periods,
  subjects,
} from "@/server/db/schema";
import {
  currentPeriod,
  monthStart,
  rate,
  summarizeResults,
  type ClassInput,
  type ResultsSummary,
} from "./dashboard-logic";

const num = (v: unknown) => Number(v ?? 0);

export type HeadcountRow = {
  levelName: string;
  className: string | null;
  enrolled: number;
  girls: number;
  boys: number;
};

export type Headcount = {
  enrolled: number;
  girls: number;
  boys: number;
  /** Préinscrits en attente de validation. */
  preEnrolled: number;
  /** Inscrits sans inscription dans une année précédente de l'école. */
  newStudents: number;
  returning: number;
  validatedThisMonth: number;
  left: number;
  leftThisMonth: number;
  leftByReason: { transfer: number; dropout: number; expulsion: number };
  /** Inscrits par niveau et par classe (classe vide : pas encore affecté). */
  rows: HeadcountRow[];
};

export type Finance = {
  today: number;
  month: number;
  year: number;
  receiptsToday: number;
  /** Montant attendu sur l'année (échéances non annulées, remises déduites). */
  expected: number;
  paid: number;
  /** Échu : échéances dont la date limite est passée. */
  dueToDate: number;
  paidOnDue: number;
  recoveryRate: number | null;
  arrears: number;
  arrearsStudents: number;
};

export type Attendance = {
  month: { recorded: number; absences: number; lates: number; rate: number | null };
  year: { recorded: number; absences: number; lates: number; rate: number | null };
  /** Classes les plus touchées sur le mois (taux d'absence décroissant). */
  classes: { className: string; recorded: number; absences: number; rate: number | null }[];
};

export type OnlinePayments = {
  succeeded: number;
  succeededAmount: number;
  pending: number;
  /** En attente depuis plus d'une heure : la vérification automatique aurait dû les trancher. */
  stuck: number;
  failed: number;
  expired: number;
  /** Paiements rattrapés par la réconciliation quotidienne (message de l'opérateur perdu). */
  recovered: number;
};

export type Results = {
  periods: { id: string; label: string; ranked: number; passed: number; passRate: number | null }[];
  period: { id: string; label: string } | null;
  summary: ResultsSummary | null;
};

export type Dashboard = {
  year: { id: string; label: string } | null;
  today: string;
  headcount: Headcount | null;
  finance: Finance | null;
  results: Results | null;
  attendance: Attendance | null;
  online: OnlinePayments | null;
};

/**
 * Le directeur voit tout ; le comptable, la partie finances (droit « tableau de bord finances »).
 * La période des résultats se choisit ; par défaut, celle en cours.
 */
export async function getDashboard(
  principal: Principal,
  options: { periodId?: string; today?: string } = {},
): Promise<Dashboard> {
  const school = can(principal, "dashboard:school");
  const finance = can(principal, "dashboard:finance");
  if (!school && !finance) authorize(principal, "dashboard:school");
  if (!principal.schoolId) throw new ForbiddenError("dashboard:school");
  const schoolId = principal.schoolId;
  const today = options.today ?? todayInBrazzaville();
  return withSchool({ schoolId, userId: principal.userId }, async (tx) => {
    const [year] = await tx
      .select({
        id: academicYears.id,
        label: academicYears.label,
        startDate: academicYears.startDate,
      })
      .from(academicYears)
      .where(and(eq(academicYears.schoolId, schoolId), eq(academicYears.status, "active")));
    const empty: Dashboard = {
      year: null,
      today,
      headcount: null,
      finance: null,
      results: null,
      attendance: null,
      online: null,
    };
    if (!year) return empty;
    const ctx = { tx, schoolId, yearId: year.id, yearStart: year.startDate, today };
    return {
      ...empty,
      year: { id: year.id, label: year.label },
      headcount: school ? await loadHeadcount(ctx) : null,
      finance: finance ? await loadFinance(ctx) : null,
      results: school ? await loadResults(ctx, options.periodId) : null,
      attendance: school ? await loadAttendance(ctx) : null,
      online: finance ? await loadOnline(ctx) : null,
    };
  });
}

type Ctx = { tx: Tx; schoolId: string; yearId: string; yearStart: string; today: string };

async function loadHeadcount({ tx, schoolId, yearId, yearStart, today }: Ctx): Promise<Headcount> {
  const monthFrom = brazzavilleDayRange(monthStart(today)).from;
  const rows = await tx.execute<{
    level_name: string;
    class_name: string | null;
    enrolled: string;
    girls: string;
    boys: string;
    pre_enrolled: string;
    new_students: string;
    validated_month: string;
    left_total: string;
    left_month: string;
    transfer: string;
    dropout: string;
    expulsion: string;
  }>(sql`
    select l.name as level_name, c.name as class_name,
      count(*) filter (where e.status = 'enrolled') as enrolled,
      count(*) filter (where e.status = 'enrolled' and s.sex = 'F') as girls,
      count(*) filter (where e.status = 'enrolled' and s.sex = 'M') as boys,
      count(*) filter (where e.status = 'pre_enrolled') as pre_enrolled,
      count(*) filter (where e.status = 'enrolled' and not exists (
        select 1 from enrollments p join academic_years py on py.id = p.academic_year_id
        where p.student_id = e.student_id and py.start_date < ${yearStart})) as new_students,
      count(*) filter (where e.status <> 'pre_enrolled' and e.validated_at >= ${monthFrom}) as validated_month,
      count(*) filter (where e.status = 'left') as left_total,
      count(*) filter (where e.status = 'left' and e.exit_date >= ${monthStart(today)}) as left_month,
      count(*) filter (where e.status = 'left' and e.exit_reason = 'transfer') as transfer,
      count(*) filter (where e.status = 'left' and e.exit_reason = 'dropout') as dropout,
      count(*) filter (where e.status = 'left' and e.exit_reason = 'expulsion') as expulsion
    from enrollments e
    join students s on s.id = e.student_id
    join levels l on l.id = e.level_id
    left join classes c on c.id = e.class_id
    where e.school_id = ${schoolId} and e.academic_year_id = ${yearId}
    group by l.position, l.name, c.name
    order by l.position, c.name nulls last`);
  const total = (key: keyof (typeof rows.rows)[number]) =>
    rows.rows.reduce((n, r) => n + num(r[key]), 0);
  const enrolled = total("enrolled");
  const newStudents = total("new_students");
  return {
    enrolled,
    girls: total("girls"),
    boys: total("boys"),
    preEnrolled: total("pre_enrolled"),
    newStudents,
    returning: enrolled - newStudents,
    validatedThisMonth: total("validated_month"),
    left: total("left_total"),
    leftThisMonth: total("left_month"),
    leftByReason: {
      transfer: total("transfer"),
      dropout: total("dropout"),
      expulsion: total("expulsion"),
    },
    rows: rows.rows
      .filter((r) => num(r.enrolled) > 0)
      .map((r) => ({
        levelName: r.level_name,
        className: r.class_name,
        enrolled: num(r.enrolled),
        girls: num(r.girls),
        boys: num(r.boys),
      })),
  };
}

async function loadFinance({ tx, schoolId, yearId, today }: Ctx): Promise<Finance> {
  const day = brazzavilleDayRange(today);
  const monthFrom = brazzavilleDayRange(monthStart(today)).from;
  // Les annulations (lignes négatives) sont déduites du jour où elles sont faites.
  const [cash] = await tx
    .select({
      today: sql<string>`coalesce(sum(${payments.amount}) filter (where ${payments.paidAt} >= ${day.from} and ${payments.paidAt} < ${day.to}), 0)`,
      month: sql<string>`coalesce(sum(${payments.amount}) filter (where ${payments.paidAt} >= ${monthFrom} and ${payments.paidAt} < ${day.to}), 0)`,
      year: sql<string>`coalesce(sum(${payments.amount}), 0)`,
      receiptsToday: sql<string>`count(*) filter (where ${payments.kind} = 'payment' and ${payments.paidAt} >= ${day.from} and ${payments.paidAt} < ${day.to})`,
    })
    .from(payments)
    .where(and(eq(payments.schoolId, schoolId), eq(payments.academicYearId, yearId)));
  const recovery = await tx.execute<{
    expected: string;
    paid: string;
    due_to_date: string;
    paid_on_due: string;
    arrears: string;
    arrears_students: string;
  }>(sql`
    with paid as (
      select invoice_id, sum(amount) as paid from payment_allocations
      where school_id = ${schoolId} group by invoice_id),
    inv as (
      select i.enrollment_id, i.due_date, i.amount - i.discount_amount as due,
        coalesce(p.paid, 0) as paid
      from invoices i left join paid p on p.invoice_id = i.id
      where i.school_id = ${schoolId} and i.academic_year_id = ${yearId} and i.status = 'open')
    select coalesce(sum(due), 0) as expected,
      coalesce(sum(paid), 0) as paid,
      coalesce(sum(due) filter (where due_date < ${today}), 0) as due_to_date,
      coalesce(sum(least(paid, due)) filter (where due_date < ${today}), 0) as paid_on_due,
      coalesce(sum(due - paid) filter (where due_date < ${today} and due > paid), 0) as arrears,
      count(distinct enrollment_id) filter (where due_date < ${today} and due > paid) as arrears_students
    from inv`);
  const r = recovery.rows[0];
  const dueToDate = num(r.due_to_date);
  const paidOnDue = num(r.paid_on_due);
  return {
    today: num(cash.today),
    month: num(cash.month),
    year: num(cash.year),
    receiptsToday: num(cash.receiptsToday),
    expected: num(r.expected),
    paid: num(r.paid),
    dueToDate,
    paidOnDue,
    recoveryRate: rate(paidOnDue, dueToDate),
    arrears: num(r.arrears),
    arrearsStudents: num(r.arrears_students),
  };
}

async function loadResults(
  { tx, schoolId, yearId, today }: Ctx,
  periodId?: string,
): Promise<Results> {
  const periodRows = await tx
    .select({
      id: periods.id,
      label: periods.label,
      position: periods.position,
      startDate: periods.startDate,
      endDate: periods.endDate,
    })
    .from(periods)
    .where(eq(periods.academicYearId, yearId))
    .orderBy(asc(periods.position));
  const selected = periodRows.find((p) => p.id === periodId) ?? currentPeriod(periodRows, today);
  if (!selected) return { periods: [], period: null, summary: null };

  const rules = await loadGradingRules(tx, schoolId);
  const classRows = await tx
    .select({
      classId: classes.id,
      className: classes.name,
      levelId: classes.levelId,
      series: classes.series,
      levelName: levels.name,
      cycle: levels.cycle,
    })
    .from(classes)
    .innerJoin(levels, eq(levels.id, classes.levelId))
    .where(and(eq(classes.schoolId, schoolId), eq(classes.academicYearId, yearId)))
    .orderBy(asc(levels.position), asc(classes.name));
  const subjectRows = await tx
    .select({
      classId: classSubjects.classId,
      subjectId: classSubjects.subjectId,
      name: subjects.name,
      coefficient: levelSubjects.coefficient,
      optional: levelSubjects.optional,
    })
    .from(classSubjects)
    .innerJoin(classes, eq(classes.id, classSubjects.classId))
    .innerJoin(subjects, eq(subjects.id, classSubjects.subjectId))
    .innerJoin(
      levelSubjects,
      and(
        eq(levelSubjects.academicYearId, classes.academicYearId),
        eq(levelSubjects.levelId, classes.levelId),
        eq(levelSubjects.series, classes.series),
        eq(levelSubjects.subjectId, classSubjects.subjectId),
      ),
    )
    .where(and(eq(classes.schoolId, schoolId), eq(classes.academicYearId, yearId)));
  const roster = await tx
    .select({ classId: enrollments.classId, enrollmentId: enrollments.id })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.academicYearId, yearId),
        eq(enrollments.status, "enrolled"),
      ),
    );
  const assessmentRows = await tx
    .select({
      id: assessments.id,
      classId: assessments.classId,
      periodId: assessments.periodId,
      subjectId: assessments.subjectId,
      kind: assessments.kind,
      maxScore: assessments.maxScore,
    })
    .from(assessments)
    .where(and(eq(assessments.schoolId, schoolId), eq(assessments.academicYearId, yearId)));
  const gradeRows = assessmentRows.length
    ? await tx
        .select({
          assessmentId: grades.assessmentId,
          enrollmentId: grades.enrollmentId,
          status: grades.status,
          score: grades.score,
        })
        .from(grades)
        .where(and(eq(grades.schoolId, schoolId), eq(grades.academicYearId, yearId)))
    : [];

  const group = <T, K>(list: readonly T[], key: (x: T) => K) => {
    const map = new Map<K, T[]>();
    for (const x of list) {
      const k = key(x);
      const bucket = map.get(k);
      if (bucket) bucket.push(x);
      else map.set(k, [x]);
    }
    return map;
  };
  const subjectsByClass = group(subjectRows, (s) => s.classId);
  const rosterByClass = group(roster, (r) => r.classId);
  const assessmentsByKey = group(assessmentRows, (a) => `${a.classId}:${a.periodId}`);
  const gradesByStudent = new Map<string, Record<string, GradeValue>>();
  for (const g of gradeRows) {
    const record = gradesByStudent.get(g.enrollmentId) ?? {};
    record[g.assessmentId] = gradeValueOf(g);
    gradesByStudent.set(g.enrollmentId, record);
  }
  const subjectNames = new Map(subjectRows.map((s) => [s.subjectId, s.name]));

  // Les notes de toutes les périodes sont chargées en une fois : le taux par période en découle.
  const summarize = (pid: string) => {
    const inputs: ClassInput[] = classRows.map((c) => {
      const scale = scaleFor(c.cycle, rules);
      return {
        classId: c.classId,
        className: c.className,
        levelName: c.levelName,
        scale,
        results: computePeriodResults({
          rules,
          scale,
          subjects: subjectsByClass.get(c.classId) ?? [],
          assessments: assessmentsByKey.get(`${c.classId}:${pid}`) ?? [],
          students: (rosterByClass.get(c.classId) ?? []).map((r) => ({
            enrollmentId: r.enrollmentId,
            grades: gradesByStudent.get(r.enrollmentId) ?? {},
          })),
        }),
      };
    });
    return summarizeResults(inputs, subjectNames);
  };
  const byPeriod = new Map(periodRows.map((p) => [p.id, summarize(p.id)]));
  return {
    periods: periodRows.map((p) => {
      const s = byPeriod.get(p.id)!;
      return { id: p.id, label: p.label, ranked: s.ranked, passed: s.passed, passRate: s.passRate };
    }),
    period: { id: selected.id, label: selected.label },
    summary: byPeriod.get(selected.id)!,
  };
}

async function loadAttendance({ tx, schoolId, yearId, today }: Ctx): Promise<Attendance> {
  const from = monthStart(today);
  const [totals] = await tx
    .select({
      recorded: sql<string>`count(*)`,
      absences: sql<string>`count(*) filter (where ${attendance.status} = 'absent')`,
      lates: sql<string>`count(*) filter (where ${attendance.status} = 'late')`,
      monthRecorded: sql<string>`count(*) filter (where ${attendance.date} >= ${from})`,
      monthAbsences: sql<string>`count(*) filter (where ${attendance.date} >= ${from} and ${attendance.status} = 'absent')`,
      monthLates: sql<string>`count(*) filter (where ${attendance.date} >= ${from} and ${attendance.status} = 'late')`,
    })
    .from(attendance)
    .where(and(eq(attendance.schoolId, schoolId), eq(attendance.academicYearId, yearId)));
  const byClass = await tx
    .select({
      className: classes.name,
      recorded: sql<string>`count(*)`,
      absences: sql<string>`count(*) filter (where ${attendance.status} = 'absent')`,
    })
    .from(attendance)
    .innerJoin(enrollments, eq(enrollments.id, attendance.enrollmentId))
    .innerJoin(classes, eq(classes.id, enrollments.classId))
    .where(
      and(
        eq(attendance.schoolId, schoolId),
        eq(attendance.academicYearId, yearId),
        gte(attendance.date, from),
      ),
    )
    .groupBy(classes.name);
  const line = (recorded: unknown, absences: unknown, lates: unknown) => ({
    recorded: num(recorded),
    absences: num(absences),
    lates: num(lates),
    rate: rate(num(absences), num(recorded)),
  });
  return {
    month: line(totals.monthRecorded, totals.monthAbsences, totals.monthLates),
    year: line(totals.recorded, totals.absences, totals.lates),
    classes: byClass
      .map((c) => ({
        className: c.className,
        recorded: num(c.recorded),
        absences: num(c.absences),
        rate: rate(num(c.absences), num(c.recorded)),
      }))
      .filter((c) => c.absences > 0)
      .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0) || a.className.localeCompare(b.className, "fr"))
      .slice(0, 5),
  };
}

async function loadOnline({ tx, schoolId, today }: Ctx): Promise<OnlinePayments> {
  const monthFrom = brazzavilleDayRange(monthStart(today)).from;
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [row] = await tx
    .select({
      succeeded: sql<string>`count(*) filter (where ${paymentIntents.status} = 'succeeded')`,
      succeededAmount: sql<string>`coalesce(sum(${paymentIntents.amount}) filter (where ${paymentIntents.status} = 'succeeded'), 0)`,
      pending: sql<string>`count(*) filter (where ${paymentIntents.status} = 'pending')`,
      stuck: sql<string>`count(*) filter (where ${paymentIntents.status} = 'pending' and ${paymentIntents.createdAt} < ${oneHourAgo})`,
      failed: sql<string>`count(*) filter (where ${paymentIntents.status} = 'failed')`,
      expired: sql<string>`count(*) filter (where ${paymentIntents.status} = 'expired')`,
    })
    .from(paymentIntents)
    .where(and(eq(paymentIntents.schoolId, schoolId), gte(paymentIntents.createdAt, monthFrom)));
  // Un paiement en attente d'un mois précédent reste à surveiller.
  const [older] = await tx
    .select({ n: sql<string>`count(*)` })
    .from(paymentIntents)
    .where(
      and(
        eq(paymentIntents.schoolId, schoolId),
        eq(paymentIntents.status, "pending"),
        lt(paymentIntents.createdAt, monthFrom),
      ),
    );
  const [recovered] = await tx
    .select({ n: sql<string>`coalesce(sum((${auditLogs.after} ->> 'recovered')::int), 0)` })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.schoolId, schoolId),
        eq(auditLogs.action, "payments.reconcile"),
        gte(auditLogs.createdAt, monthFrom),
      ),
    );
  return {
    succeeded: num(row.succeeded),
    succeededAmount: num(row.succeededAmount),
    pending: num(row.pending) + num(older.n),
    stuck: num(row.stuck) + num(older.n),
    failed: num(row.failed),
    expired: num(row.expired),
    recovered: num(recovered.n),
  };
}
