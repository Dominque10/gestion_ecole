// Calcul des moyennes, rangs et mentions (M4, sous-étape 3d). Fonctions pures, sans base de données,
// couvertes par des tests (CLAUDE.md §7). Toutes les règles viennent des réglages de l'école.
import type { AssessmentKind, GradeValue } from "./grade-input";
import type { GradingRules } from "./rules";

export type SubjectSetup = { subjectId: string; coefficient: number; optional: boolean };
export type AssessmentInfo = {
  id: string;
  subjectId: string;
  kind: AssessmentKind;
  maxScore: number;
};
export type StudentGrades = {
  enrollmentId: string;
  /** Valeur de chaque évaluation notée pour cet élève (absente = pas de note). */
  grades: Record<string, GradeValue>;
};

export type SubjectResult = {
  subjectId: string;
  /** Moyenne arrondie selon la règle de l'école ; null = non notée. */
  average: number | null;
  /** Moyenne exacte (avant arrondi). */
  exact: number | null;
  /** Points apportés à la moyenne générale (moyenne × coefficient, ou bonus d'une facultative). */
  points: number | null;
};

export type StudentResult = {
  enrollmentId: string;
  subjects: SubjectResult[];
  totalPoints: number;
  totalCoefficients: number;
  /** Moyenne générale arrondie ; null = non classé. */
  average: number | null;
  exact: number | null;
  rank: number | null;
  /** Même rang qu'un autre élève (ex æquo). */
  tied: boolean;
  mention: string | null;
};

export type Stats = { average: number | null; highest: number | null; lowest: number | null };

export type PeriodResults = {
  students: StudentResult[];
  /** Moyenne de la classe, plus forte et plus faible moyenne générale. */
  classStats: Stats;
  subjectStats: (Stats & { subjectId: string })[];
};

/** Arrondi d'une moyenne selon la règle de l'école (12,345 → 12,35 au centième). */
export function roundAverage(value: number, mode: GradingRules["rounding"]): number {
  // toPrecision corrige les erreurs de virgule flottante (1,005 × 100 = 100,49999…).
  const scaled = (factor: number) => Number((value * factor).toPrecision(12));
  switch (mode) {
    case "hundredth":
      return Math.round(scaled(100)) / 100;
    case "tenth":
      return Math.round(scaled(10)) / 10;
    case "hundredthTruncated":
      return Math.floor(scaled(100)) / 100;
  }
}

const mean = (values: readonly number[]) =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

/**
 * Moyenne exacte d'un élève dans une matière, sur le barème de l'école.
 * - chaque note est ramenée au barème de l'école (8 sur 10 → 16 sur 20) ;
 * - absent : non compté ou 0 (règle de l'école) ; dispensé : jamais compté ;
 * - « devoirs + composition » : (moyenne des interrogations et devoirs + poids × composition) / (1 + poids) ;
 *   si la classe n'a pas eu de composition (ou pas de devoir), ce qui existe, ou 0 (règle de l'école) ;
 *   si seul l'élève n'a pas la note (absent non compté…), ce qui existe pour lui.
 */
export function subjectAverage(
  rules: GradingRules,
  scale: number,
  assessments: readonly AssessmentInfo[],
  grades: Record<string, GradeValue>,
): number | null {
  const onScale = (a: AssessmentInfo): number | null => {
    const g = grades[a.id];
    if (!g || g.status === "empty" || g.status === "excused") return null;
    if (g.status === "absent") return rules.absence === "zero" ? 0 : null;
    return (g.score / a.maxScore) * scale;
  };
  const values = (list: readonly AssessmentInfo[]) =>
    list.map(onScale).filter((v): v is number => v !== null);

  if (rules.subjectAverage === "allEqual") return mean(values(assessments));

  const continuous = assessments.filter((a) => a.kind !== "composition");
  const compositions = assessments.filter((a) => a.kind === "composition");
  const c = mean(values(continuous));
  const x = mean(values(compositions));
  const w = rules.compositionWeight;
  const zero = rules.missingPart === "countZero";
  if (c !== null && x !== null) return (c + w * x) / (1 + w);
  if (c !== null) return compositions.length === 0 && zero ? c / (1 + w) : c;
  if (x !== null) return continuous.length === 0 && zero ? (w * x) / (1 + w) : x;
  return null;
}

/** Mention atteinte (seuils sur 20, ramenés au barème de l'école). */
export function mentionFor(rules: GradingRules, scale: number, average: number | null) {
  if (average === null) return null;
  const sorted = [...rules.mentions].sort((a, b) => b.minAverage - a.minAverage);
  return sorted.find((m) => average >= (m.minAverage * scale) / 20)?.label ?? null;
}

/**
 * Rangs selon la règle de l'école, sur la moyenne arrondie :
 * competition 1, 2, 2, 4 ; dense 1, 2, 2, 3 ; tiebreak : départage par la moyenne exacte.
 */
export function rankAverages<K>(
  items: readonly { key: K; average: number | null; exact: number | null }[],
  mode: GradingRules["ranking"],
): Map<K, { rank: number; tied: boolean }> {
  const ranked = items.filter((i) => i.average !== null);
  const compare = (a: (typeof ranked)[number], b: (typeof ranked)[number]) => {
    const byAverage = (b.average as number) - (a.average as number);
    if (byAverage !== 0 || mode !== "tiebreak") return byAverage;
    return (b.exact ?? 0) - (a.exact ?? 0);
  };
  const result = new Map<K, { rank: number; tied: boolean }>();
  for (const item of ranked) {
    const better = ranked.filter((o) => compare(o, item) < 0);
    const rank =
      mode === "dense" ? new Set(better.map((o) => o.average)).size + 1 : better.length + 1;
    const tied = ranked.some((o) => o !== item && compare(o, item) === 0);
    result.set(item.key, { rank, tied });
  }
  return result;
}

function stats(values: readonly (number | null)[], rounding: GradingRules["rounding"]): Stats {
  const known = values.filter((v): v is number => v !== null);
  const avg = mean(known);
  return {
    average: avg === null ? null : roundAverage(avg, rounding),
    highest: known.length ? Math.max(...known) : null,
    lowest: known.length ? Math.min(...known) : null,
  };
}

/** Résultats d'une classe sur une période. */
export function computePeriodResults(input: {
  rules: GradingRules;
  /** Barème de l'école pour cette classe (20, ou 10 au primaire si choisi). */
  scale: number;
  subjects: readonly SubjectSetup[];
  assessments: readonly AssessmentInfo[];
  students: readonly StudentGrades[];
}): PeriodResults {
  const { rules, scale, subjects, assessments } = input;
  const round = (v: number) => roundAverage(v, rules.rounding);

  const students = input.students.map((student) => {
    let points = 0;
    let coefficients = 0;
    let unranked = false;
    const results: SubjectResult[] = subjects.map((subject) => {
      const list = assessments.filter((a) => a.subjectId === subject.subjectId);
      const exact = list.length ? subjectAverage(rules, scale, list, student.grades) : null;
      const average = exact === null ? null : round(exact);
      // Matière jamais évaluée dans la classe sur la période : ignorée par tous.
      if (list.length === 0) return { subjectId: subject.subjectId, average, exact, points: null };
      const base = rules.generalAverageBase === "roundedSubjects" ? average : exact;
      const coef = subject.coefficient;

      if (subject.optional && rules.optionalSubjects !== "normal") {
        if (rules.optionalSubjects === "excluded" || base === null) {
          return { subjectId: subject.subjectId, average, exact, points: null };
        }
        // Seuls les points au-dessus de la moitié du barème s'ajoutent (décision D10).
        const bonus = Math.max(0, base - scale / 2) * coef;
        points += bonus;
        return { subjectId: subject.subjectId, average, exact, points: bonus };
      }
      if (base === null) {
        if (rules.emptySubject === "zero") coefficients += coef;
        if (rules.emptySubject === "unranked") unranked = true;
        return {
          subjectId: subject.subjectId,
          average,
          exact,
          points: rules.emptySubject === "zero" ? 0 : null,
        };
      }
      points += base * coef;
      coefficients += coef;
      return { subjectId: subject.subjectId, average, exact, points: base * coef };
    });
    const exact = unranked || coefficients === 0 ? null : points / coefficients;
    return {
      enrollmentId: student.enrollmentId,
      subjects: results,
      totalPoints: points,
      totalCoefficients: coefficients,
      average: exact === null ? null : round(exact),
      exact,
    };
  });

  const ranks = rankAverages(
    students.map((s) => ({ key: s.enrollmentId, average: s.average, exact: s.exact })),
    rules.ranking,
  );
  return {
    students: students.map((s) => ({
      ...s,
      rank: ranks.get(s.enrollmentId)?.rank ?? null,
      tied: ranks.get(s.enrollmentId)?.tied ?? false,
      mention: mentionFor(rules, scale, s.average),
    })),
    classStats: stats(
      students.map((s) => s.average),
      rules.rounding,
    ),
    subjectStats: subjects.map((subject, i) => ({
      subjectId: subject.subjectId,
      ...stats(
        students.map((s) => s.subjects[i].average),
        rules.rounding,
      ),
    })),
  };
}

export type AnnualStudentResult = {
  enrollmentId: string;
  /** Moyenne générale de chaque période, dans l'ordre (null = non classé sur la période). */
  periods: (number | null)[];
  average: number | null;
  exact: number | null;
  rank: number | null;
  tied: boolean;
  mention: string | null;
};

/**
 * Moyenne annuelle à partir des moyennes générales (arrondies) des périodes : chacune pèse autant, ou
 * la dernière compte double (règle de l'école). Une période sans moyenne est laissée de côté.
 */
export function annualAverage(
  rules: GradingRules,
  periods: readonly (number | null)[],
): number | null {
  let sum = 0;
  let weights = 0;
  periods.forEach((value, i) => {
    if (value === null) return;
    const weight = rules.annualAverage === "lastDouble" && i === periods.length - 1 ? 2 : 1;
    sum += value * weight;
    weights += weight;
  });
  return weights === 0 ? null : sum / weights;
}

export function computeAnnualResults(input: {
  rules: GradingRules;
  scale: number;
  students: readonly { enrollmentId: string; periods: (number | null)[] }[];
}): { students: AnnualStudentResult[]; classStats: Stats } {
  const { rules, scale } = input;
  const students = input.students.map((s) => {
    const exact = annualAverage(rules, s.periods);
    return {
      enrollmentId: s.enrollmentId,
      periods: s.periods,
      exact,
      average: exact === null ? null : roundAverage(exact, rules.rounding),
    };
  });
  const ranks = rankAverages(
    students.map((s) => ({ key: s.enrollmentId, average: s.average, exact: s.exact })),
    rules.ranking,
  );
  return {
    students: students.map((s) => ({
      ...s,
      rank: ranks.get(s.enrollmentId)?.rank ?? null,
      tied: ranks.get(s.enrollmentId)?.tied ?? false,
      mention: mentionFor(rules, scale, s.average),
    })),
    classStats: stats(
      students.map((s) => s.average),
      rules.rounding,
    ),
  };
}
