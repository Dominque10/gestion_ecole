// Règles de calcul des moyennes, propres à chaque école (CLAUDE.md §7, décision D10).
// Les valeurs par défaut sont celles tranchées par le porteur du projet ; chaque école peut les changer.
import { z } from "zod";

/** Barème du primaire et du préscolaire ; collège et lycée sont toujours sur 20 (hypothèse H69). */
export const PRIMARY_SCALES = [10, 20] as const;
/** Moyenne d'une matière : (devoirs + composition × poids) / (1 + poids), ou toutes les notes égales. */
export const SUBJECT_AVERAGE_MODES = ["continuousAndComposition", "allEqual"] as const;
export const ROUNDING_MODES = ["hundredth", "tenth", "hundredthTruncated"] as const;
/** competition : 1, 2, 2, 4 ; dense : 1, 2, 2, 3 ; tiebreak : départage sur la moyenne non arrondie. */
export const RANKING_MODES = ["competition", "dense", "tiebreak"] as const;
export const OPTIONAL_SUBJECT_MODES = ["bonusAboveHalf", "normal", "excluded"] as const;
export const ABSENCE_MODES = ["excluded", "zero"] as const;
export const ANNUAL_AVERAGE_MODES = ["periodsMean", "lastDouble"] as const;
/** Moyenne générale calculée avec les moyennes de matière arrondies, ou exactes (décision D13). */
export const GENERAL_AVERAGE_BASES = ["roundedSubjects", "exactSubjects"] as const;
/** Pas de composition (ou pas de devoirs) dans la matière : ce qui existe, ou 0 (décision D13). */
export const MISSING_PART_MODES = ["useAvailable", "countZero"] as const;
/** Élève sans aucune note dans une matière notée : matière exclue, comptée 0, ou non classé (D13). */
export const EMPTY_SUBJECT_MODES = ["excluded", "zero", "unranked"] as const;

export const MentionSchema = z.object({
  label: z.string().trim().min(1).max(40),
  /** Seuil sur 20 (ramené à la moitié pour un barème sur 10, hypothèse H72). */
  minAverage: z.number().min(0).max(20),
});

export const GradingRulesSchema = z.object({
  primaryScale: z.union([z.literal(10), z.literal(20)]),
  subjectAverage: z.enum(SUBJECT_AVERAGE_MODES),
  /** Poids de la composition face à la moyenne des interrogations et devoirs (1 = moitié). */
  compositionWeight: z.number().int().min(1).max(3),
  rounding: z.enum(ROUNDING_MODES),
  ranking: z.enum(RANKING_MODES),
  optionalSubjects: z.enum(OPTIONAL_SUBJECT_MODES),
  absence: z.enum(ABSENCE_MODES),
  annualAverage: z.enum(ANNUAL_AVERAGE_MODES),
  generalAverageBase: z.enum(GENERAL_AVERAGE_BASES),
  missingPart: z.enum(MISSING_PART_MODES),
  emptySubject: z.enum(EMPTY_SUBJECT_MODES),
  /** Mentions automatiques, de la plus haute à la plus basse (avertissement, blâme : conseil de classe). */
  mentions: z
    .array(MentionSchema)
    .max(8)
    .refine((list) => new Set(list.map((m) => m.label.toLowerCase())).size === list.length),
});
export type GradingRules = z.infer<typeof GradingRulesSchema>;

export const DEFAULT_GRADING_RULES: GradingRules = {
  primaryScale: 20,
  subjectAverage: "continuousAndComposition",
  compositionWeight: 1,
  rounding: "hundredth",
  ranking: "competition",
  optionalSubjects: "bonusAboveHalf",
  absence: "excluded",
  annualAverage: "periodsMean",
  generalAverageBase: "roundedSubjects",
  missingPart: "useAvailable",
  emptySubject: "excluded",
  mentions: [
    { label: "Félicitations", minAverage: 16 },
    { label: "Encouragements", minAverage: 14 },
    { label: "Tableau d'honneur", minAverage: 12 },
  ],
};

/**
 * Règles enregistrées pour une école : complétées par les valeurs par défaut pour toute règle absente
 * (règles ajoutées plus tard) ; un contenu illisible donne les règles par défaut.
 */
export function readGradingRules(stored: unknown): GradingRules {
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) {
    return DEFAULT_GRADING_RULES;
  }
  const merged = { ...DEFAULT_GRADING_RULES, ...stored };
  const parsed = GradingRulesSchema.safeParse(merged);
  return parsed.success ? sortMentions(parsed.data) : DEFAULT_GRADING_RULES;
}

/** Mentions rangées du seuil le plus haut au plus bas : la première atteinte s'applique. */
export function sortMentions(rules: GradingRules): GradingRules {
  return { ...rules, mentions: [...rules.mentions].sort((a, b) => b.minAverage - a.minAverage) };
}

/** Barème de l'école pour un cycle : sur 20, ou sur 10 au primaire et au préscolaire si choisi (H69). */
export function scaleFor(
  cycle: "preschool" | "primary" | "college" | "lycee",
  rules: Pick<GradingRules, "primaryScale">,
): number {
  return cycle === "primary" || cycle === "preschool" ? rules.primaryScale : 20;
}
