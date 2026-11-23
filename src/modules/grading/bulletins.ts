// Bulletins (M4, sous-étape 3g) : construits à partir des résultats et du conseil de classe ; publiés
// par le directeur après la validation du conseil. La publication garde une photographie de chaque
// bulletin : une correction ultérieure demande de rouvrir (tracé) puis de publier à nouveau.
import { and, eq, inArray, sql } from "drizzle-orm";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool, type Tx } from "@/server/db/client";
import {
  academicYears,
  auditLogs,
  classSubjects,
  enrollments,
  levels,
  reportCards,
  students,
  users,
} from "@/server/db/schema";
import { dbGuardCode } from "@/modules/settings/errors";
import { attendanceTotals, type AttendanceTotals } from "@/modules/attendance/totals";
import type { Stats } from "./averages";
import {
  ANNUAL,
  commentOf,
  compute,
  ensureCard,
  loadCards,
  type Computed,
  type Decision,
} from "./council";
import { GradingError } from "./errors";
import { resultsContext, type Ctx } from "./results";

export type BulletinSubject = {
  name: string;
  coefficient: number;
  optional: boolean;
  teacherName: string | null;
  average: number | null;
  points: number | null;
  classAverage: number | null;
  highest: number | null;
  lowest: number | null;
  comment: string;
};

/** Contenu d'un bulletin (aussi gardé tel quel à la publication). */
export type Bulletin = {
  version: 1;
  enrollmentId: string;
  yearLabel: string;
  className: string;
  levelName: string;
  headTeacherName: string | null;
  classSize: number;
  annual: boolean;
  periodLabel: string;
  scale: number;
  student: {
    matricule: string;
    lastName: string;
    firstNames: string;
    sex: "M" | "F";
    birthDate: string | null;
  };
  /** Bulletin de période : les matières. */
  subjects: BulletinSubject[];
  totalCoefficients: number;
  totalPoints: number;
  /** Bulletin annuel : la moyenne générale de chaque période. */
  periods: { label: string; average: number | null; rank: number | null; tied: boolean }[];
  average: number | null;
  rank: number | null;
  tied: boolean;
  mention: string;
  classStats: Stats;
  generalComment: string;
  attendance: AttendanceTotals;
  decision: Decision | null;
  councilDate: string | null;
};

export type BulletinSet = {
  className: string;
  periodLabel: string;
  annual: boolean;
  /** Tous publiés : ce sont les photographies ; sinon, un projet calculé à l'instant. */
  published: boolean;
  publishedAt: Date | null;
  councilValidated: boolean;
  bulletins: Bulletin[];
};

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (dbGuardCode(error) === "GS001") throw new GradingError("yearArchived");
    throw error;
  }
}

/** Bulletins calculés à l'instant, à partir des résultats et des fiches du conseil. */
async function build(tx: Tx, ctx: Ctx, k: Computed): Promise<Bulletin[]> {
  const ids = k.setup.roster.map((r) => r.enrollmentId);
  const periodId = k.period?.id ?? null;
  const cards = await loadCards(tx, ids, periodId);
  const totals = await attendanceTotals(tx, ids, k.from, k.to);
  const [info] = await tx
    .select({ yearLabel: academicYears.label, levelName: levels.name, headTeacherName: users.name })
    .from(academicYears)
    .innerJoin(levels, eq(levels.id, k.c.levelId))
    .leftJoin(users, k.c.headTeacherId ? eq(users.id, k.c.headTeacherId) : sql`false`)
    .where(eq(academicYears.id, k.c.academicYearId));
  const identity = new Map(
    (
      await tx
        .select({
          enrollmentId: enrollments.id,
          sex: students.sex,
          birthDate: students.birthDate,
        })
        .from(enrollments)
        .innerJoin(students, eq(students.id, enrollments.studentId))
        .where(ids.length ? inArray(enrollments.id, ids) : sql`false`)
    ).map((r) => [r.enrollmentId, r]),
  );
  const teachers = new Map(
    (
      await tx
        .select({ subjectId: classSubjects.subjectId, name: users.name })
        .from(classSubjects)
        .innerJoin(users, eq(users.id, classSubjects.teacherId))
        .where(eq(classSubjects.classId, k.c.classId))
    ).map((r) => [r.subjectId, r.name]),
  );
  const classStats = k.results
    ? k.results.classStats
    : statsOf([...k.proposals.values()].map((p) => p.average));

  return k.setup.roster.map((r) => {
    const card = cards.get(r.enrollmentId);
    const proposal = k.proposals.get(r.enrollmentId);
    const result = k.results?.students.find((s) => s.enrollmentId === r.enrollmentId);
    const who = identity.get(r.enrollmentId);
    return {
      version: 1,
      enrollmentId: r.enrollmentId,
      yearLabel: info?.yearLabel ?? "",
      className: k.c.className,
      levelName: info?.levelName ?? "",
      headTeacherName: info?.headTeacherName ?? null,
      classSize: k.setup.roster.length,
      annual: k.period === null,
      periodLabel: k.period?.label ?? "",
      scale: k.setup.scale,
      student: {
        matricule: r.matricule,
        lastName: r.lastName,
        firstNames: r.firstNames,
        sex: who?.sex ?? "M",
        birthDate: who?.birthDate ?? null,
      },
      subjects: result
        ? k.setup.subjects.map((s, i) => ({
            name: s.name,
            coefficient: s.coefficient,
            optional: s.optional,
            teacherName: teachers.get(s.subjectId) ?? null,
            average: result.subjects[i].average,
            points: result.subjects[i].points,
            classAverage: k.results!.subjectStats[i].average,
            highest: k.results!.subjectStats[i].highest,
            lowest: k.results!.subjectStats[i].lowest,
            comment: commentOf(card?.subjectComments, s.subjectId),
          }))
        : [],
      totalCoefficients: result?.totalCoefficients ?? 0,
      totalPoints: result?.totalPoints ?? 0,
      periods: k.perPeriod.map((res, i) => {
        const s = res.students.find((x) => x.enrollmentId === r.enrollmentId);
        return {
          label: k.list[i].label,
          average: s?.average ?? null,
          rank: s?.rank ?? null,
          tied: s?.tied ?? false,
        };
      }),
      average: proposal?.average ?? null,
      rank: proposal?.rank ?? null,
      tied: proposal?.tied ?? false,
      mention: card?.mention ?? proposal?.mention ?? "",
      classStats,
      generalComment: card?.generalComment ?? "",
      attendance: totals.get(r.enrollmentId)!,
      decision: card?.decision ?? null,
      councilDate: card?.councilValidatedAt ? card.councilValidatedAt.toISOString() : null,
    };
  });
}

function statsOf(values: (number | null)[]): Stats {
  const known = values.filter((v): v is number => v !== null);
  if (known.length === 0) return { average: null, highest: null, lowest: null };
  const avg = known.reduce((a, b) => a + b, 0) / known.length;
  return {
    average: Math.round(Number((avg * 100).toPrecision(12))) / 100,
    highest: Math.max(...known),
    lowest: Math.min(...known),
  };
}

/**
 * Bulletins d'une classe (directeur, professeur principal) : les photographies s'ils sont publiés,
 * sinon un projet calculé à l'instant (imprimé avec la mention « Projet »).
 */
export async function getBulletins(
  principal: Principal,
  classId: string,
  periodKey: string,
): Promise<BulletinSet> {
  const ctx = resultsContext(principal);
  return withSchool(ctx, async (tx) => {
    const k = await compute(tx, ctx, classId, periodKey);
    const periodId = k.period?.id ?? null;
    const ids = k.setup.roster.map((r) => r.enrollmentId);
    const rows = ids.length
      ? await tx
          .select({
            enrollmentId: reportCards.enrollmentId,
            publishedAt: reportCards.publishedAt,
            snapshot: reportCards.snapshot,
            councilValidatedAt: reportCards.councilValidatedAt,
          })
          .from(reportCards)
          .where(and(inArray(reportCards.enrollmentId, ids), kindFilter(periodId)))
      : [];
    const byId = new Map(rows.map((r) => [r.enrollmentId, r]));
    const published = ids.length > 0 && ids.every((id) => byId.get(id)?.publishedAt);
    const councilValidated = ids.length > 0 && ids.every((id) => byId.get(id)?.councilValidatedAt);
    const bulletins = published
      ? ids.map((id) => byId.get(id)!.snapshot as Bulletin)
      : await build(tx, ctx, k);
    return {
      className: k.c.className,
      periodLabel: k.period?.label ?? "",
      annual: k.period === null,
      published,
      publishedAt: published ? (byId.get(ids[0])!.publishedAt as Date) : null,
      councilValidated,
      bulletins,
    };
  });
}

function kindFilter(periodId: string | null) {
  return periodId
    ? and(eq(reportCards.kind, "period"), eq(reportCards.periodId, periodId))
    : eq(reportCards.kind, "annual");
}

/**
 * Publie les bulletins de la classe (directeur), une fois le conseil validé : chaque bulletin est
 * photographié tel qu'il est à cet instant. Ils deviennent disponibles pour l'espace parents (M6).
 */
export async function publishBulletins(
  principal: Principal,
  classId: string,
  periodKey: string,
): Promise<number> {
  authorize(principal, "reportcards:publish");
  const ctx = resultsContext(principal);
  return guarded(() =>
    withSchool(ctx, async (tx) => {
      const k = await compute(tx, ctx, classId, periodKey);
      const periodId = k.period?.id ?? null;
      const ids = k.setup.roster.map((r) => r.enrollmentId);
      for (const id of ids) await ensureCard(tx, k.c, ctx.schoolId, id, periodId);
      const cards = await loadCards(tx, ids, periodId);
      if (ids.length === 0 || ids.some((id) => !cards.get(id)?.councilValidatedAt)) {
        throw new GradingError("councilNotValidated");
      }
      const bulletins = await build(tx, ctx, k);
      const now = new Date();
      for (const b of bulletins) {
        await tx
          .update(reportCards)
          .set({ snapshot: b, publishedAt: now, publishedBy: ctx.userId, updatedAt: now })
          .where(and(eq(reportCards.enrollmentId, b.enrollmentId), kindFilter(periodId)));
      }
      await tx.insert(auditLogs).values({
        schoolId: ctx.schoolId,
        actorUserId: ctx.userId,
        action: "bulletins.publish",
        entityType: "class",
        entityId: classId,
        before: null,
        after: { periodKey: periodId ?? ANNUAL, bulletins: bulletins.length },
      });
      return bulletins.length;
    }),
  );
}
