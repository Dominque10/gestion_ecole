// Calculs du tableau de bord de la direction (M7, sous-étape 4f). Fonctions pures, testées.
import type { PeriodResults } from "@/modules/grading/averages";

/** Pourcentage arrondi au dixième ; null quand il n'y a rien à rapporter (division par zéro). */
export function rate(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/** Réussite : moyenne au moins égale à la moitié du barème (10/20, 5/10), décision D20. */
export const passes = (average: number, scale: number) => average >= scale / 2;

/** Premier jour du mois d'une date AAAA-MM-JJ. */
export const monthStart = (day: string) => `${day.slice(0, 7)}-01`;

type PeriodLike = { id: string; startDate: string; endDate: string; position: number };

/**
 * Période affichée par défaut : celle qui contient aujourd'hui ; avant l'année, la première ; après
 * la fin de la dernière, la dernière ; entre deux périodes, la dernière commencée.
 */
export function currentPeriod<P extends PeriodLike>(
  periods: readonly P[],
  today: string,
): P | null {
  const sorted = [...periods].sort((a, b) => a.position - b.position);
  if (sorted.length === 0) return null;
  const started = sorted.filter((p) => p.startDate <= today);
  return started.at(-1) ?? sorted[0];
}

export type ClassInput = {
  classId: string;
  className: string;
  levelName: string;
  scale: number;
  results: PeriodResults;
};

export type ClassSummary = {
  classId: string;
  className: string;
  levelName: string;
  scale: number;
  /** Élèves classés (une moyenne générale) : eux seuls comptent dans le taux de réussite. */
  ranked: number;
  passed: number;
  passRate: number | null;
  average: number | null;
};

export type SubjectSummary = {
  subjectId: string;
  name: string;
  /** Élèves ayant une moyenne dans la matière, toutes classes confondues. */
  graded: number;
  passed: number;
  passRate: number | null;
};

export type ResultsSummary = {
  ranked: number;
  passed: number;
  passRate: number | null;
  classes: ClassSummary[];
  subjects: SubjectSummary[];
};

/**
 * Synthèse d'une période pour l'école : par classe (moyenne, taux de réussite) et par matière (taux
 * de réussite : part des élèves qui ont au moins la moitié du barème dans la matière). Le taux par
 * matière ne dépend pas du barème : il additionne des classes notées sur 10 et sur 20.
 */
export function summarizeResults(
  classes: readonly ClassInput[],
  subjectNames: ReadonlyMap<string, string>,
): ResultsSummary {
  const bySubject = new Map<string, { graded: number; passed: number }>();
  const classRows: ClassSummary[] = classes.map((c) => {
    let ranked = 0;
    let passed = 0;
    for (const s of c.results.students) {
      if (s.average !== null) {
        ranked++;
        if (passes(s.average, c.scale)) passed++;
      }
      for (const subject of s.subjects) {
        if (subject.average === null) continue;
        const stats = bySubject.get(subject.subjectId) ?? { graded: 0, passed: 0 };
        stats.graded++;
        if (passes(subject.average, c.scale)) stats.passed++;
        bySubject.set(subject.subjectId, stats);
      }
    }
    return {
      classId: c.classId,
      className: c.className,
      levelName: c.levelName,
      scale: c.scale,
      ranked,
      passed,
      passRate: rate(passed, ranked),
      average: c.results.classStats.average,
    };
  });
  const ranked = classRows.reduce((n, c) => n + c.ranked, 0);
  const passed = classRows.reduce((n, c) => n + c.passed, 0);
  const subjects = [...bySubject.entries()]
    .map(([subjectId, s]) => ({
      subjectId,
      name: subjectNames.get(subjectId) ?? "",
      graded: s.graded,
      passed: s.passed,
      passRate: rate(s.passed, s.graded),
    }))
    // Matières les plus en difficulté d'abord : c'est là que la direction doit regarder.
    .sort(
      (a, b) => (a.passRate ?? 101) - (b.passRate ?? 101) || a.name.localeCompare(b.name, "fr"),
    );
  return { ranked, passed, passRate: rate(passed, ranked), classes: classRows, subjects };
}
