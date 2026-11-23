// Conseil de classe (M4, sous-étape 3f), décision D10 §8 : chaque enseignant écrit l'appréciation de
// sa matière ; le professeur principal ou le directeur l'appréciation générale ; le directeur valide
// la mention (proposée selon les seuils de l'école) et, en fin d'année, la décision.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { authorize, can, ForbiddenError, type Principal } from "@/server/auth/permissions";
import { withSchool, type Tx } from "@/server/db/client";
import {
  academicYears,
  auditLogs,
  classes,
  classSubjects,
  levels,
  periods,
  reportCards,
  subjects,
  users,
} from "@/server/db/schema";
import { dbGuardCode } from "@/modules/settings/errors";
import { attendanceTotals, type AttendanceTotals } from "@/modules/attendance/totals";
import { closureState } from "./assessments";
import { computeAnnualResults, mentionFor, type PeriodResults } from "./averages";
import { GradingError } from "./errors";
import {
  loadClass,
  loadSetup,
  periodResults,
  resultsContext,
  type ClassRow,
  type Ctx,
  type Loaded,
} from "./results";

/** Fiche annuelle (au lieu d'une période). */
export const ANNUAL = "annee";
/** Mentions que seul le conseil peut donner (hypothèse H71). */
export const COUNCIL_ONLY_MENTIONS = ["Avertissement", "Blâme"] as const;
export const DECISIONS = ["promoted", "repeat", "excluded"] as const;
export type Decision = (typeof DECISIONS)[number];
export const COMMENT_MAX = 300;

const isUuid = (value: string) => z.uuid().safeParse(value).success;

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (dbGuardCode(error) === "GS001") throw new GradingError("yearArchived");
    throw error;
  }
}

export type PeriodRow = {
  id: string;
  label: string;
  position: number;
  startDate: string;
  endDate: string;
};

export async function yearPeriods(tx: Tx, yearId: string): Promise<PeriodRow[]> {
  return tx
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
}

/** Fiche du conseil d'un élève (créée au besoin) ; renvoie son identifiant. */
export async function ensureCard(
  tx: Tx,
  c: ClassRow,
  schoolId: string,
  enrollmentId: string,
  periodId: string | null,
): Promise<string> {
  if (periodId) {
    await tx.execute(sql`
      insert into report_cards (school_id, academic_year_id, enrollment_id, kind, period_id)
      values (${schoolId}, ${c.academicYearId}, ${enrollmentId}, 'period', ${periodId})
      on conflict (enrollment_id, period_id) where kind = 'period' do nothing`);
  } else {
    await tx.execute(sql`
      insert into report_cards (school_id, academic_year_id, enrollment_id, kind)
      values (${schoolId}, ${c.academicYearId}, ${enrollmentId}, 'annual')
      on conflict (enrollment_id) where kind = 'annual' do nothing`);
  }
  const [card] = await tx
    .select({ id: reportCards.id })
    .from(reportCards)
    .where(cardFilter(enrollmentId, periodId));
  return card.id;
}

function cardFilter(enrollmentId: string, periodId: string | null) {
  return and(
    eq(reportCards.enrollmentId, enrollmentId),
    periodId
      ? and(eq(reportCards.kind, "period"), eq(reportCards.periodId, periodId))
      : eq(reportCards.kind, "annual"),
  );
}

export type CardRow = {
  enrollmentId: string;
  subjectComments: unknown;
  generalComment: string | null;
  mention: string | null;
  decision: Decision | null;
  councilValidatedAt: Date | null;
  validatedByName: string | null;
  publishedAt: Date | null;
};

export async function loadCards(
  tx: Tx,
  enrollmentIds: string[],
  periodId: string | null,
): Promise<Map<string, CardRow>> {
  if (enrollmentIds.length === 0) return new Map();
  const rows = await tx
    .select({
      enrollmentId: reportCards.enrollmentId,
      subjectComments: reportCards.subjectComments,
      generalComment: reportCards.generalComment,
      mention: reportCards.mention,
      decision: reportCards.decision,
      councilValidatedAt: reportCards.councilValidatedAt,
      validatedByName: users.name,
      publishedAt: reportCards.publishedAt,
    })
    .from(reportCards)
    .leftJoin(users, eq(users.id, reportCards.councilValidatedBy))
    .where(
      and(
        inArray(reportCards.enrollmentId, enrollmentIds),
        periodId
          ? and(eq(reportCards.kind, "period"), eq(reportCards.periodId, periodId))
          : eq(reportCards.kind, "annual"),
      ),
    );
  return new Map(rows.map((r) => [r.enrollmentId, r]));
}

/** Texte de l'appréciation d'une matière dans une fiche. */
export function commentOf(stored: unknown, subjectId: string): string {
  const entry = (stored as Record<string, { text?: unknown }> | null)?.[subjectId];
  return typeof entry?.text === "string" ? entry.text : "";
}

// --- Appréciations par matière (enseignant de la matière, ou directeur) ---------------------

/** Classe, sans restriction de professeur principal (l'enseignant de la matière est vérifié à part). */
async function classForCourse(
  tx: Tx,
  ctx: Ctx,
  classId: string,
  subjectId: string,
): Promise<ClassRow & { subjectName: string }> {
  if (!isUuid(classId) || !isUuid(subjectId)) throw new GradingError("courseNotFound");
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
      subjectName: subjects.name,
    })
    .from(classSubjects)
    .innerJoin(classes, eq(classes.id, classSubjects.classId))
    .innerJoin(levels, eq(levels.id, classes.levelId))
    .innerJoin(academicYears, eq(academicYears.id, classes.academicYearId))
    .innerJoin(subjects, eq(subjects.id, classSubjects.subjectId))
    .where(
      and(
        eq(classSubjects.schoolId, ctx.schoolId),
        eq(classSubjects.classId, classId),
        eq(classSubjects.subjectId, subjectId),
        ctx.director ? undefined : eq(classSubjects.teacherId, ctx.userId),
      ),
    );
  if (!row) throw new GradingError("courseNotFound");
  return row;
}

export type SubjectCommentsSheet = {
  className: string;
  subjectName: string;
  periods: { id: string; label: string }[];
  period: { id: string; label: string };
  students: {
    enrollmentId: string;
    lastName: string;
    firstNames: string;
    average: number | null;
    comment: string;
    /** Conseil validé : l'appréciation ne se modifie plus. */
    locked: boolean;
  }[];
};

export async function getSubjectComments(
  principal: Principal,
  classId: string,
  subjectId: string,
  periodId?: string,
): Promise<SubjectCommentsSheet> {
  const ctx = resultsContext(principal);
  return withSchool(ctx, async (tx) => {
    const c = await classForCourse(tx, ctx, classId, subjectId);
    const list = await yearPeriods(tx, c.academicYearId);
    const period = list.find((p) => p.id === periodId) ?? list[0];
    if (!period) throw new GradingError("periodNotFound");
    const setup = await loadSetup(tx, ctx, c);
    const results = await periodResults(tx, c, setup, period.id);
    const index = setup.subjects.findIndex((s) => s.subjectId === subjectId);
    const cards = await loadCards(
      tx,
      setup.roster.map((r) => r.enrollmentId),
      period.id,
    );
    return {
      className: c.className,
      subjectName: c.subjectName,
      periods: list.map((p) => ({ id: p.id, label: p.label })),
      period: { id: period.id, label: period.label },
      students: setup.roster.map((r) => {
        const card = cards.get(r.enrollmentId);
        const result = results.students.find((s) => s.enrollmentId === r.enrollmentId);
        return {
          enrollmentId: r.enrollmentId,
          lastName: r.lastName,
          firstNames: r.firstNames,
          average: index >= 0 ? (result?.subjects[index].average ?? null) : null,
          comment: commentOf(card?.subjectComments, subjectId),
          locked: card?.councilValidatedAt != null,
        };
      }),
    };
  });
}

/** Enregistre les appréciations d'une matière ; une appréciation vide est retirée. */
export async function saveSubjectComments(
  principal: Principal,
  classId: string,
  subjectId: string,
  periodId: string,
  entries: readonly { enrollmentId: string; text: string }[],
): Promise<void> {
  const ctx = resultsContext(principal);
  if (entries.some((e) => e.text.trim().length > COMMENT_MAX)) {
    throw new GradingError("commentTooLong");
  }
  await guarded(() =>
    withSchool(ctx, async (tx) => {
      const c = await classForCourse(tx, ctx, classId, subjectId);
      if (!(await yearPeriods(tx, c.academicYearId)).some((p) => p.id === periodId)) {
        throw new GradingError("periodNotFound");
      }
      const roster = new Set((await loadSetup(tx, ctx, c)).roster.map((r) => r.enrollmentId));
      for (const entry of entries) {
        if (!roster.has(entry.enrollmentId)) throw new GradingError("studentNotInClass");
        const cardId = await ensureCard(tx, c, ctx.schoolId, entry.enrollmentId, periodId);
        const text = entry.text.trim();
        // Mise à jour d'une seule matière, atomique : deux enseignants peuvent écrire en même temps.
        const updated = await tx
          .update(reportCards)
          .set({
            subjectComments:
              text === ""
                ? sql`${reportCards.subjectComments} - ${subjectId}::text`
                : sql`jsonb_set(${reportCards.subjectComments}, array[${subjectId}::text], jsonb_build_object('text', ${text}::text, 'by', ${ctx.userId}::text, 'at', now()))`,
            updatedAt: new Date(),
          })
          .where(and(eq(reportCards.id, cardId), sql`${reportCards.councilValidatedAt} is null`))
          .returning({ id: reportCards.id });
        if (updated.length === 0) throw new GradingError("councilValidated");
      }
    }),
  );
}

// --- Conseil de classe (directeur ou professeur principal) ----------------------------------

export type CouncilStudent = {
  enrollmentId: string;
  lastName: string;
  firstNames: string;
  average: number | null;
  rank: number | null;
  tied: boolean;
  /** Mention proposée selon les seuils de l'école. */
  proposedMention: string | null;
  /** Mention retenue par le conseil (null : la proposée ; « » : aucune). */
  mention: string | null;
  generalComment: string;
  decision: Decision | null;
  subjectComments: Record<string, string>;
  attendance: AttendanceTotals;
};

export type CouncilSheet = {
  classId: string;
  className: string;
  periodKey: string;
  periodLabel: string;
  periods: { id: string; label: string }[];
  annual: boolean;
  subjects: { subjectId: string; name: string }[];
  /** La période (ou la dernière, pour l'année) est close : le conseil peut être validé. */
  closed: boolean;
  validatedAt: Date | null;
  validatedByName: string | null;
  /** Bulletins publiés (3g). */
  publishedAt: Date | null;
  /** Mentions possibles : celles de l'école, puis celles du seul conseil. */
  mentionChoices: string[];
  students: CouncilStudent[];
};

export type Computed = {
  c: ClassRow;
  setup: Loaded;
  list: PeriodRow[];
  period: PeriodRow | null;
  /** Moyenne, rang et mention proposée par élève. */
  proposals: Map<
    string,
    { average: number | null; rank: number | null; tied: boolean; mention: string | null }
  >;
  closed: boolean;
  from: string;
  to: string;
  /** Résultats détaillés de la période (vide pour l'année). */
  results: PeriodResults | null;
  /** Résultats de chaque période (fiche annuelle seulement). */
  perPeriod: PeriodResults[];
};

/** Résultats sur lesquels porte le conseil (période ou année). */
export async function compute(
  tx: Tx,
  ctx: Ctx,
  classId: string,
  periodKey: string | undefined,
): Promise<Computed> {
  const c = await loadClass(tx, ctx, classId);
  const list = await yearPeriods(tx, c.academicYearId);
  if (list.length === 0) throw new GradingError("periodNotFound");
  const setup = await loadSetup(tx, ctx, c);
  const proposals: Computed["proposals"] = new Map();
  if (periodKey === ANNUAL) {
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
    for (const s of annual.students) proposals.set(s.enrollmentId, s);
    const last = list[list.length - 1];
    return {
      c,
      setup,
      list,
      period: null,
      proposals,
      closed: (await closureState(tx, last.id, c.classId)) === "closed",
      from: list[0].startDate,
      to: last.endDate,
      results: null,
      perPeriod,
    };
  }
  const period = list.find((p) => p.id === periodKey) ?? list[0];
  const results = await periodResults(tx, c, setup, period.id);
  for (const s of results.students) {
    proposals.set(s.enrollmentId, {
      average: s.average,
      rank: s.rank,
      tied: s.tied,
      mention: mentionFor(setup.rules, setup.scale, s.average),
    });
  }
  return {
    c,
    setup,
    list,
    period,
    proposals,
    closed: (await closureState(tx, period.id, c.classId)) === "closed",
    from: period.startDate,
    to: period.endDate,
    results,
    perPeriod: [],
  };
}

export async function getCouncil(
  principal: Principal,
  classId: string,
  periodKey?: string,
): Promise<CouncilSheet> {
  const ctx = resultsContext(principal);
  return withSchool(ctx, async (tx) => {
    const k = await compute(tx, ctx, classId, periodKey);
    const ids = k.setup.roster.map((r) => r.enrollmentId);
    const cards = await loadCards(tx, ids, k.period?.id ?? null);
    const totals = await attendanceTotals(tx, ids, k.from, k.to);
    const validated = [...cards.values()].find((card) => card.councilValidatedAt);
    return {
      classId: k.c.classId,
      className: k.c.className,
      periodKey: k.period?.id ?? ANNUAL,
      periodLabel: k.period?.label ?? "",
      periods: k.list.map((p) => ({ id: p.id, label: p.label })),
      annual: k.period === null,
      subjects: k.setup.subjects.map((s) => ({ subjectId: s.subjectId, name: s.name })),
      closed: k.closed,
      validatedAt: validated?.councilValidatedAt ?? null,
      validatedByName: validated?.validatedByName ?? null,
      publishedAt:
        ids.length > 0 && ids.every((id) => cards.get(id)?.publishedAt)
          ? (cards.get(ids[0])!.publishedAt as Date)
          : null,
      mentionChoices: [...k.setup.rules.mentions.map((m) => m.label), ...COUNCIL_ONLY_MENTIONS],
      students: k.setup.roster.map((r) => {
        const card = cards.get(r.enrollmentId);
        const p = k.proposals.get(r.enrollmentId);
        return {
          enrollmentId: r.enrollmentId,
          lastName: r.lastName,
          firstNames: r.firstNames,
          average: p?.average ?? null,
          rank: p?.rank ?? null,
          tied: p?.tied ?? false,
          proposedMention: p?.mention ?? null,
          mention: card?.mention ?? null,
          generalComment: card?.generalComment ?? "",
          decision: card?.decision ?? null,
          subjectComments: Object.fromEntries(
            k.setup.subjects.map((s) => [
              s.subjectId,
              commentOf(card?.subjectComments, s.subjectId),
            ]),
          ),
          attendance: totals.get(r.enrollmentId)!,
        };
      }),
    };
  });
}

export type CouncilEntry = {
  enrollmentId: string;
  generalComment?: string;
  /** null : la mention proposée ; « » : aucune ; sinon une mention de l'école ou du conseil. */
  mention?: string | null;
  decision?: Decision | null;
};

/**
 * Enregistre les saisies du conseil. Appréciation générale : professeur principal ou directeur ;
 * mention et décision : directeur seul. Plus rien ne change une fois le conseil validé.
 */
export async function saveCouncil(
  principal: Principal,
  classId: string,
  periodKey: string,
  entries: readonly CouncilEntry[],
): Promise<void> {
  const ctx = resultsContext(principal);
  const decides = entries.some((e) => e.mention !== undefined || e.decision !== undefined);
  if (decides && !can(principal, "reportcards:council"))
    throw new ForbiddenError("reportcards:council");
  if (entries.some((e) => (e.generalComment ?? "").trim().length > COMMENT_MAX)) {
    throw new GradingError("commentTooLong");
  }
  await guarded(() =>
    withSchool(ctx, async (tx) => {
      const c = await loadClass(tx, ctx, classId);
      const list = await yearPeriods(tx, c.academicYearId);
      const periodId =
        periodKey === ANNUAL ? null : (list.find((p) => p.id === periodKey)?.id ?? "");
      if (periodId === "") throw new GradingError("periodNotFound");
      const setup = await loadSetup(tx, ctx, c);
      const roster = new Set(setup.roster.map((r) => r.enrollmentId));
      const allowed = new Set<string>([
        ...setup.rules.mentions.map((m) => m.label),
        ...COUNCIL_ONLY_MENTIONS,
      ]);
      for (const e of entries) {
        if (!roster.has(e.enrollmentId)) throw new GradingError("studentNotInClass");
        if (e.mention != null && e.mention !== "" && !allowed.has(e.mention)) {
          throw new GradingError("mentionInvalid");
        }
        if (e.decision != null && (periodId !== null || !DECISIONS.includes(e.decision))) {
          throw new GradingError("decisionInvalid");
        }
        const cardId = await ensureCard(tx, c, ctx.schoolId, e.enrollmentId, periodId);
        const updated = await tx
          .update(reportCards)
          .set({
            ...(e.generalComment !== undefined
              ? { generalComment: e.generalComment.trim() || null, generalCommentBy: ctx.userId }
              : {}),
            ...(e.mention !== undefined ? { mention: e.mention } : {}),
            ...(e.decision !== undefined ? { decision: e.decision } : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(reportCards.id, cardId), sql`${reportCards.councilValidatedAt} is null`))
          .returning({ id: reportCards.id });
        if (updated.length === 0) throw new GradingError("councilValidated");
      }
    }),
  );
}

/**
 * Valide le conseil (directeur) : il faut que la période soit close pour la classe (pour l'année : la
 * dernière période) et, en fin d'année, une décision pour chaque élève. La mention proposée est
 * retenue quand le conseil n'en a pas choisi.
 */
export async function validateCouncil(
  principal: Principal,
  classId: string,
  periodKey: string,
): Promise<void> {
  authorize(principal, "reportcards:council");
  const ctx = resultsContext(principal);
  await guarded(() =>
    withSchool(ctx, async (tx) => {
      const k = await compute(tx, ctx, classId, periodKey);
      if (!k.closed) throw new GradingError("councilNotClosed");
      const periodId = k.period?.id ?? null;
      const ids = k.setup.roster.map((r) => r.enrollmentId);
      for (const id of ids) await ensureCard(tx, k.c, ctx.schoolId, id, periodId);
      const cards = await loadCards(tx, ids, periodId);
      if (periodId === null && ids.some((id) => !cards.get(id)?.decision)) {
        throw new GradingError("decisionMissing");
      }
      for (const id of ids) {
        const card = cards.get(id)!;
        await tx
          .update(reportCards)
          .set({
            mention: card.mention ?? k.proposals.get(id)?.mention ?? "",
            councilValidatedAt: new Date(),
            councilValidatedBy: ctx.userId,
            updatedAt: new Date(),
          })
          .where(cardFilter(id, periodId));
      }
      await tx.insert(auditLogs).values({
        schoolId: ctx.schoolId,
        actorUserId: ctx.userId,
        action: "council.validate",
        entityType: "class",
        entityId: classId,
        before: null,
        after: { periodKey: periodId ?? ANNUAL, students: ids.length },
      });
    }),
  );
}

/**
 * Rouvre le conseil (directeur) : appréciations, mention et décision redeviennent modifiables. Si
 * les bulletins étaient publiés, la publication est retirée (à refaire après correction).
 */
export async function reopenCouncil(
  principal: Principal,
  classId: string,
  periodKey: string,
): Promise<void> {
  authorize(principal, "reportcards:council");
  const ctx = resultsContext(principal);
  await guarded(() =>
    withSchool(ctx, async (tx) => {
      const c = await loadClass(tx, ctx, classId);
      const list = await yearPeriods(tx, c.academicYearId);
      const periodId =
        periodKey === ANNUAL ? null : (list.find((p) => p.id === periodKey)?.id ?? "");
      if (periodId === "") throw new GradingError("periodNotFound");
      const ids = (await loadSetup(tx, ctx, c)).roster.map((r) => r.enrollmentId);
      if (ids.length === 0) return;
      // Bulletins publiés : la publication est retirée (la photographie reste jusqu'à la prochaine).
      const withdrawn = await tx
        .update(reportCards)
        .set({ publishedAt: null, publishedBy: null })
        .where(
          and(
            inArray(reportCards.enrollmentId, ids),
            periodId
              ? and(eq(reportCards.kind, "period"), eq(reportCards.periodId, periodId))
              : eq(reportCards.kind, "annual"),
            sql`${reportCards.publishedAt} is not null`,
          ),
        )
        .returning({ id: reportCards.id });
      await tx
        .update(reportCards)
        .set({ councilValidatedAt: null, councilValidatedBy: null, updatedAt: new Date() })
        .where(
          and(
            inArray(reportCards.enrollmentId, ids),
            periodId
              ? and(eq(reportCards.kind, "period"), eq(reportCards.periodId, periodId))
              : eq(reportCards.kind, "annual"),
          ),
        );
      await tx.insert(auditLogs).values({
        schoolId: ctx.schoolId,
        actorUserId: ctx.userId,
        action: "council.reopen",
        entityType: "class",
        entityId: classId,
        before: { periodKey: periodId ?? ANNUAL, publishedWithdrawn: withdrawn.length },
        after: null,
      });
    }),
  );
}
