// Résultats d'une classe (moyennes, rangs, mentions) et clôture des périodes (M4, sous-étape 3d).
// Les calculs eux-mêmes sont dans `averages.ts` (fonctions pures, testées) ; ici, la lecture des
// données, les droits et la clôture.
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool, type Tx } from "@/server/db/client";
import {
  academicYears,
  assessments,
  auditLogs,
  classes,
  classSubjects,
  enrollments,
  grades,
  levels,
  levelSubjects,
  periodClosures,
  periods,
  students,
  subjects,
  users,
} from "@/server/db/schema";
import { dbGuardCode } from "@/modules/settings/errors";
import {
  computeAnnualResults,
  computePeriodResults,
  type PeriodResults,
  type Stats,
  type StudentResult,
} from "./averages";
import { GradingError } from "./errors";
import { gradeValueOf, type GradeValue } from "./grade-input";
import { scaleFor, type GradingRules } from "./rules";
import { loadGradingRules } from "./settings";

const isUuid = (value: string) => z.uuid().safeParse(value).success;

type Ctx = { schoolId: string; userId: string; director: boolean };

/** Résultats : le directeur pour toute l'école, le professeur principal pour sa classe (H86). */
function resultsContext(principal: Principal): Ctx {
  authorize(principal, "grades:write");
  return {
    schoolId: principal.schoolId as string,
    userId: principal.userId,
    director: principal.roles.includes("director"),
  };
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (dbGuardCode(error) === "GS001") throw new GradingError("yearArchived");
    throw error;
  }
}

export type ResultClass = { classId: string; className: string; levelName: string };

/** Classes de l'année active dont le lecteur peut voir les résultats. */
export async function listResultClasses(principal: Principal): Promise<ResultClass[]> {
  const ctx = resultsContext(principal);
  return withSchool(ctx, (tx) =>
    tx
      .select({ classId: classes.id, className: classes.name, levelName: levels.name })
      .from(classes)
      .innerJoin(levels, eq(levels.id, classes.levelId))
      .innerJoin(academicYears, eq(academicYears.id, classes.academicYearId))
      .where(
        and(
          eq(classes.schoolId, ctx.schoolId),
          eq(academicYears.status, "active"),
          ctx.director ? undefined : eq(classes.headTeacherId, ctx.userId),
        ),
      )
      .orderBy(asc(levels.position), asc(classes.name)),
  );
}

type ClassRow = {
  classId: string;
  className: string;
  levelId: string;
  series: string;
  academicYearId: string;
  yearStatus: "upcoming" | "active" | "archived";
  cycle: "preschool" | "primary" | "college" | "lycee";
  headTeacherId: string | null;
};

async function loadClass(tx: Tx, ctx: Ctx, classId: string): Promise<ClassRow> {
  if (!isUuid(classId)) throw new GradingError("classNotFound");
  const [row] = await tx
    .select({
      classId: classes.id,
      className: classes.name,
      levelId: classes.levelId,
      series: classes.series,
      academicYearId: classes.academicYearId,
      yearStatus: academicYears.status,
      cycle: levels.cycle,
      headTeacherId: classes.headTeacherId,
    })
    .from(classes)
    .innerJoin(levels, eq(levels.id, classes.levelId))
    .innerJoin(academicYears, eq(academicYears.id, classes.academicYearId))
    .where(and(eq(classes.schoolId, ctx.schoolId), eq(classes.id, classId)));
  if (!row || (!ctx.director && row.headTeacherId !== ctx.userId)) {
    throw new GradingError("classNotFound");
  }
  return row;
}

export type PeriodInfo = { id: string; label: string; position: number };

async function loadPeriods(tx: Tx, yearId: string): Promise<PeriodInfo[]> {
  return tx
    .select({ id: periods.id, label: periods.label, position: periods.position })
    .from(periods)
    .where(eq(periods.academicYearId, yearId))
    .orderBy(asc(periods.position));
}

type Loaded = {
  rules: GradingRules;
  scale: number;
  subjects: { subjectId: string; name: string; coefficient: number; optional: boolean }[];
  roster: { enrollmentId: string; matricule: string; lastName: string; firstNames: string }[];
};

/** Règles, matières de la classe (coefficients de la grille) et élèves inscrits. */
async function loadSetup(tx: Tx, ctx: Ctx, c: ClassRow): Promise<Loaded> {
  const rules = await loadGradingRules(tx, ctx.schoolId);
  const subjectRows = await tx
    .select({
      subjectId: subjects.id,
      name: subjects.name,
      coefficient: levelSubjects.coefficient,
      optional: levelSubjects.optional,
    })
    .from(classSubjects)
    .innerJoin(subjects, eq(subjects.id, classSubjects.subjectId))
    .innerJoin(
      levelSubjects,
      and(
        eq(levelSubjects.academicYearId, c.academicYearId),
        eq(levelSubjects.levelId, c.levelId),
        eq(levelSubjects.series, c.series),
        eq(levelSubjects.subjectId, classSubjects.subjectId),
      ),
    )
    .where(eq(classSubjects.classId, c.classId))
    // Matières facultatives à la fin, puis par coefficient décroissant et par nom.
    .orderBy(asc(levelSubjects.optional), desc(levelSubjects.coefficient), asc(subjects.name));
  const roster = await tx
    .select({
      enrollmentId: enrollments.id,
      matricule: students.matricule,
      lastName: students.lastName,
      firstNames: students.firstNames,
    })
    .from(enrollments)
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .where(and(eq(enrollments.classId, c.classId), eq(enrollments.status, "enrolled")))
    .orderBy(asc(students.lastName), asc(students.firstNames));
  return { rules, scale: scaleFor(c.cycle, rules), subjects: subjectRows, roster };
}

/** Calcul d'une période à partir de la base. */
async function periodResults(
  tx: Tx,
  c: ClassRow,
  setup: Loaded,
  periodId: string,
): Promise<PeriodResults> {
  const list = await tx
    .select({
      id: assessments.id,
      subjectId: assessments.subjectId,
      kind: assessments.kind,
      maxScore: assessments.maxScore,
    })
    .from(assessments)
    .where(and(eq(assessments.classId, c.classId), eq(assessments.periodId, periodId)));
  const stored = list.length
    ? await tx
        .select({
          assessmentId: grades.assessmentId,
          enrollmentId: grades.enrollmentId,
          status: grades.status,
          score: grades.score,
        })
        .from(grades)
        .where(
          inArray(
            grades.assessmentId,
            list.map((a) => a.id),
          ),
        )
    : [];
  const byStudent = new Map<string, Record<string, GradeValue>>();
  for (const g of stored) {
    const record = byStudent.get(g.enrollmentId) ?? {};
    record[g.assessmentId] = gradeValueOf(g);
    byStudent.set(g.enrollmentId, record);
  }
  return computePeriodResults({
    rules: setup.rules,
    scale: setup.scale,
    subjects: setup.subjects,
    assessments: list,
    students: setup.roster.map((r) => ({
      enrollmentId: r.enrollmentId,
      grades: byStudent.get(r.enrollmentId) ?? {},
    })),
  });
}

export type Closure = {
  state: "open" | "closed" | "reopened";
  closedAt: Date | null;
  closedByName: string | null;
  reopenedAt: Date | null;
  reopenReason: string | null;
};

async function loadClosure(tx: Tx, periodId: string, classId: string): Promise<Closure> {
  const [row] = await tx
    .select({
      closed: periodClosures.closed,
      closedAt: periodClosures.closedAt,
      closedByName: users.name,
      reopenedAt: periodClosures.reopenedAt,
      reopenReason: periodClosures.reopenReason,
    })
    .from(periodClosures)
    .innerJoin(users, eq(users.id, periodClosures.closedBy))
    .where(and(eq(periodClosures.periodId, periodId), eq(periodClosures.classId, classId)));
  if (!row) {
    return {
      state: "open",
      closedAt: null,
      closedByName: null,
      reopenedAt: null,
      reopenReason: null,
    };
  }
  return { ...row, state: row.closed ? "closed" : "reopened" };
}

type StudentIdentity = { matricule: string; lastName: string; firstNames: string };

export type ClassResults = {
  classId: string;
  className: string;
  yearStatus: "upcoming" | "active" | "archived";
  scale: number;
  periods: PeriodInfo[];
  period: PeriodInfo;
  closure: Closure;
  subjects: { subjectId: string; name: string; coefficient: number; optional: boolean }[];
  students: (StudentResult & StudentIdentity)[];
  classStats: Stats;
  subjectStats: PeriodResults["subjectStats"];
};

/** Résultats d'une classe sur une période (par défaut la première). */
export async function getClassResults(
  principal: Principal,
  classId: string,
  periodId?: string,
): Promise<ClassResults> {
  const ctx = resultsContext(principal);
  return withSchool(ctx, async (tx) => {
    const c = await loadClass(tx, ctx, classId);
    const list = await loadPeriods(tx, c.academicYearId);
    const period = list.find((p) => p.id === periodId) ?? list[0];
    if (!period) throw new GradingError("periodNotFound");
    const setup = await loadSetup(tx, ctx, c);
    const results = await periodResults(tx, c, setup, period.id);
    const identity = new Map(setup.roster.map((r) => [r.enrollmentId, r]));
    return {
      classId: c.classId,
      className: c.className,
      yearStatus: c.yearStatus,
      scale: setup.scale,
      periods: list,
      period,
      closure: await loadClosure(tx, period.id, c.classId),
      subjects: setup.subjects,
      students: results.students.map((s) => {
        const who = identity.get(s.enrollmentId)!;
        return {
          ...s,
          matricule: who.matricule,
          lastName: who.lastName,
          firstNames: who.firstNames,
        };
      }),
      classStats: results.classStats,
      subjectStats: results.subjectStats,
    };
  });
}

export type AnnualResults = {
  classId: string;
  className: string;
  periods: PeriodInfo[];
  scale: number;
  students: (ReturnType<typeof computeAnnualResults>["students"][number] & StudentIdentity)[];
  classStats: Stats;
};

/** Moyennes annuelles d'une classe (à partir des moyennes générales de chaque période). */
export async function getAnnualResults(
  principal: Principal,
  classId: string,
): Promise<AnnualResults> {
  const ctx = resultsContext(principal);
  return withSchool(ctx, async (tx) => {
    const c = await loadClass(tx, ctx, classId);
    const list = await loadPeriods(tx, c.academicYearId);
    const setup = await loadSetup(tx, ctx, c);
    const perPeriod: PeriodResults[] = [];
    for (const p of list) perPeriod.push(await periodResults(tx, c, setup, p.id));
    const annual = computeAnnualResults({
      rules: setup.rules,
      scale: setup.scale,
      students: setup.roster.map((r) => ({
        enrollmentId: r.enrollmentId,
        periods: perPeriod.map(
          (res) => res.students.find((s) => s.enrollmentId === r.enrollmentId)?.average ?? null,
        ),
      })),
    });
    const identity = new Map(setup.roster.map((r) => [r.enrollmentId, r]));
    return {
      classId: c.classId,
      className: c.className,
      periods: list,
      scale: setup.scale,
      students: annual.students.map((s) => {
        const who = identity.get(s.enrollmentId)!;
        return {
          ...s,
          matricule: who.matricule,
          lastName: who.lastName,
          firstNames: who.firstNames,
        };
      }),
      classStats: annual.classStats,
    };
  });
}

// --- Clôture -------------------------------------------------------------------------------

function directorContext(principal: Principal, action: "periods:close" | "grades:unlock"): Ctx {
  authorize(principal, action);
  return { schoolId: principal.schoolId as string, userId: principal.userId, director: true };
}

async function loadPeriodOfClass(tx: Tx, c: ClassRow, periodId: string) {
  if (!isUuid(periodId)) throw new GradingError("periodNotFound");
  const [p] = await tx
    .select({ id: periods.id })
    .from(periods)
    .where(and(eq(periods.id, periodId), eq(periods.academicYearId, c.academicYearId)));
  if (!p) throw new GradingError("periodNotFound");
}

/** Clôture la période pour la classe : ses notes sont verrouillées (garanti par la base). */
export async function closePeriod(
  principal: Principal,
  classId: string,
  periodId: string,
): Promise<void> {
  const ctx = directorContext(principal, "periods:close");
  await guarded(() =>
    withSchool(ctx, async (tx) => {
      const c = await loadClass(tx, ctx, classId);
      if (c.yearStatus === "archived") throw new GradingError("yearArchived");
      await loadPeriodOfClass(tx, c, periodId);
      const updated = await tx
        .insert(periodClosures)
        .values({
          schoolId: ctx.schoolId,
          academicYearId: c.academicYearId,
          periodId,
          classId,
          closedBy: ctx.userId,
        })
        .onConflictDoUpdate({
          target: [periodClosures.periodId, periodClosures.classId],
          set: { closed: true, closedAt: new Date(), closedBy: ctx.userId },
          // Déjà close : rien ne change.
          setWhere: ne(periodClosures.closed, true),
        })
        .returning({ id: periodClosures.id });
      if (updated.length === 0) return;
      await tx.insert(auditLogs).values({
        schoolId: ctx.schoolId,
        actorUserId: ctx.userId,
        action: "period.close",
        entityType: "period_closure",
        entityId: updated[0].id,
        before: null,
        after: { periodId, classId },
      });
    }),
  );
}

/** Rouvre la période pour la classe (motif obligatoire) ; les modifications suivantes sont tracées. */
export async function reopenPeriod(
  principal: Principal,
  classId: string,
  periodId: string,
  reason: string,
): Promise<void> {
  const ctx = directorContext(principal, "grades:unlock");
  const motive = reason.trim();
  if (motive.length < 3 || motive.length > 300) throw new GradingError("reopenReason");
  await guarded(() =>
    withSchool(ctx, async (tx) => {
      const c = await loadClass(tx, ctx, classId);
      await loadPeriodOfClass(tx, c, periodId);
      const updated = await tx
        .update(periodClosures)
        .set({
          closed: false,
          reopenedAt: new Date(),
          reopenedBy: ctx.userId,
          reopenReason: motive,
        })
        .where(
          and(
            eq(periodClosures.periodId, periodId),
            eq(periodClosures.classId, classId),
            eq(periodClosures.closed, true),
          ),
        )
        .returning({ id: periodClosures.id });
      if (updated.length === 0) throw new GradingError("periodNotClosed");
      await tx.insert(auditLogs).values({
        schoolId: ctx.schoolId,
        actorUserId: ctx.userId,
        action: "period.reopen",
        entityType: "period_closure",
        entityId: updated[0].id,
        before: { closed: true },
        after: { closed: false, reason: motive },
      });
    }),
  );
}
