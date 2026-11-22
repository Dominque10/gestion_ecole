// Lecture d'une case de la grille de saisie des notes (sous-étape 3b). Fonctions pures, testées.
//
// Une case contient : une note (virgule ou point, deux décimales au plus), « a » pour absent,
// « d » pour dispensé, ou rien (pas encore de note).

/** Types d'évaluation (hypothèse H70). */
export const ASSESSMENT_KINDS = ["quiz", "homework", "composition"] as const;
export type AssessmentKind = (typeof ASSESSMENT_KINDS)[number];

export const GRADE_STATUSES = ["scored", "absent", "excused"] as const;
export type GradeStatus = (typeof GRADE_STATUSES)[number];

/** Valeur d'une case : note sur le barème de l'évaluation, absence, dispense, ou case vide. */
export type GradeValue =
  | { status: "scored"; score: number }
  | { status: "absent" }
  | { status: "excused" }
  | { status: "empty" };

export type GradeInputProblem = "unreadable" | "outOfRange";

export type ParsedGradeInput =
  { ok: true; value: GradeValue } | { ok: false; problem: GradeInputProblem };

const ABSENT = new Set(["a", "abs", "absent", "absente"]);
const EXCUSED = new Set(["d", "disp", "dispense", "dispensé", "dispensée"]);
const NUMBER = /^\d{1,3}([.,]\d{1,2})?$/;

/** Lit le texte d'une case pour une évaluation notée sur `maxScore`. */
export function parseGradeInput(raw: string, maxScore: number): ParsedGradeInput {
  const text = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (text === "") return { ok: true, value: { status: "empty" } };
  if (ABSENT.has(text)) return { ok: true, value: { status: "absent" } };
  if (EXCUSED.has(text)) return { ok: true, value: { status: "excused" } };
  if (!NUMBER.test(text)) return { ok: false, problem: "unreadable" };
  const score = Number(text.replace(",", "."));
  if (score < 0 || score > maxScore) return { ok: false, problem: "outOfRange" };
  return { ok: true, value: { status: "scored", score } };
}

/** Texte d'une case : 12,5 ; « a » ; « d » ; vide. Inverse de `parseGradeInput`. */
export function formatGradeValue(value: GradeValue): string {
  switch (value.status) {
    case "scored":
      return String(value.score).replace(".", ",");
    case "absent":
      return "a";
    case "excused":
      return "d";
    case "empty":
      return "";
  }
}

/** Valeur d'une note enregistrée (ou de son absence). */
export function gradeValueOf(
  row: { status: GradeStatus; score: number | null } | undefined,
): GradeValue {
  if (!row) return { status: "empty" };
  if (row.status === "scored") return { status: "scored", score: row.score as number };
  return { status: row.status };
}

export function sameGradeValue(a: GradeValue, b: GradeValue): boolean {
  if (a.status !== b.status) return false;
  return a.status !== "scored" || a.score === (b as { score: number }).score;
}
