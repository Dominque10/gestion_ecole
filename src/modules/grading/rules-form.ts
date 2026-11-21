// Lecture du formulaire « Règles de calcul » (champs texte) en règles validées.
import { GradingRulesSchema, sortMentions, type GradingRules } from "./rules";

/** Nombre de lignes de mention proposées à l'écran. */
export const MENTION_ROWS = 6;

/** Seuil saisi « 12 », « 12,5 » ou « 12.5 » ; null si illisible. */
function parseThreshold(text: string): number | null {
  const normalized = text.trim().replace(",", ".");
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(normalized)) return null;
  return Number(normalized);
}

/** Règles lues dans les champs du formulaire, ou null si un choix ou une mention est invalide. */
export function gradingRulesFromForm(fields: Record<string, string>): GradingRules | null {
  const mentions: { label: string; minAverage: number }[] = [];
  for (let i = 0; i < MENTION_ROWS; i++) {
    const label = (fields[`mention-${i}`] ?? "").trim();
    const threshold = (fields[`seuil-${i}`] ?? "").trim();
    if (label === "" && threshold === "") continue;
    const minAverage = parseThreshold(threshold);
    if (label === "" || minAverage === null) return null;
    mentions.push({ label, minAverage });
  }
  const parsed = GradingRulesSchema.safeParse({
    primaryScale: Number(fields.primaryScale),
    subjectAverage: fields.subjectAverage,
    compositionWeight: Number(fields.compositionWeight),
    rounding: fields.rounding,
    ranking: fields.ranking,
    optionalSubjects: fields.optionalSubjects,
    absence: fields.absence,
    annualAverage: fields.annualAverage,
    mentions,
  });
  return parsed.success ? sortMentions(parsed.data) : null;
}
