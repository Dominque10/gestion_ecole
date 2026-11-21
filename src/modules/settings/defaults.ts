// Valeurs proposées par défaut (système scolaire congolais, CLAUDE.md §7). Toutes modifiables par l'école.
// Les listes de matières sont une hypothèse (décision D4, docs/hypotheses.md) : à revoir avec les écoles.

export const CYCLES = ["preschool", "primary", "college", "lycee"] as const;
export type Cycle = (typeof CYCLES)[number];

export const DEFAULT_LEVELS: Record<Cycle, readonly string[]> = {
  preschool: ["Petite section", "Moyenne section", "Grande section"],
  primary: ["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"],
  college: ["6e", "5e", "4e", "3e"],
  lycee: ["2nde", "1re", "Tle"],
};

const COLLEGE_SUBJECTS = [
  "Français",
  "Mathématiques",
  "Anglais",
  "Histoire-Géographie",
  "Éducation civique et morale",
  "Sciences de la vie et de la Terre",
  "Physique-Chimie",
  "Éducation physique et sportive",
] as const;

export const DEFAULT_SUBJECTS: Record<Cycle, readonly string[]> = {
  preschool: [
    "Langage",
    "Graphisme",
    "Éveil mathématique",
    "Activités artistiques",
    "Activités physiques",
  ],
  primary: [
    "Français",
    "Mathématiques",
    "Sciences d'observation",
    "Histoire-Géographie",
    "Éducation civique et morale",
    "Dessin",
    "Éducation physique et sportive",
  ],
  college: COLLEGE_SUBJECTS,
  lycee: [...COLLEGE_SUBJECTS, "Philosophie"],
};

/** Séries proposées au lycée (saisie libre possible). */
export const SUGGESTED_SERIES = ["A", "C", "D"] as const;

/** Rang d'un cycle, pour l'ordre d'affichage des niveaux. */
export const cycleRank = (c: Cycle) => CYCLES.indexOf(c);
