// Modèles de messages aux parents (4d), en français, modifiables par chaque école. Fonctions pures.

export const TEMPLATE_KINDS = ["absence", "receipt", "bulletin", "announcement"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

/** Champs utilisables dans chaque modèle, écrits entre accolades : {eleve}, {montant}… */
export const PLACEHOLDERS: Record<TemplateKind, readonly string[]> = {
  absence: ["ecole", "eleve", "classe", "date", "creneaux", "absent"],
  receipt: ["ecole", "eleve", "classe", "montant", "numero", "reste"],
  bulletin: ["ecole", "eleve", "classe", "periode"],
  announcement: ["ecole", "message"],
};

export const DEFAULT_TEMPLATES: Record<TemplateKind, string> = {
  absence:
    "{ecole} : votre enfant {eleve} ({classe}) est {absent} le {date} ({creneaux}). Merci de justifier l'absence auprès du secrétariat.",
  receipt:
    "{ecole} : paiement de {montant} reçu pour {eleve}, reçu n° {numero}. Reste à payer : {reste}. Merci.",
  bulletin: "{ecole} : le bulletin de {eleve} ({periode}) est disponible dans l'espace parents.",
  announcement: "{ecole} : {message}",
};

/** Au plus deux SMS (hypothèse H121). */
export const TEMPLATE_MAX_LENGTH = 320;

export type TemplateProblem =
  { problem: "empty" } | { problem: "tooLong" } | { problem: "unknownField"; field: string };

/** Vérifie un modèle : non vide, pas trop long, seulement des champs connus pour ce message. */
export function checkTemplate(kind: TemplateKind, text: string): TemplateProblem | null {
  const value = text.trim();
  if (value === "") return { problem: "empty" };
  if (value.length > TEMPLATE_MAX_LENGTH) return { problem: "tooLong" };
  for (const match of value.matchAll(/\{([^{}]*)\}/g)) {
    if (!PLACEHOLDERS[kind].includes(match[1])) return { problem: "unknownField", field: match[1] };
  }
  return null;
}

/** Modèles de l'école : ceux qu'elle a enregistrés (s'ils sont valides), sinon ceux par défaut. */
export function readTemplates(stored: unknown): Record<TemplateKind, string> {
  const result = { ...DEFAULT_TEMPLATES };
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    for (const kind of TEMPLATE_KINDS) {
      const value = (stored as Record<string, unknown>)[kind];
      if (typeof value === "string" && checkTemplate(kind, value) === null)
        result[kind] = value.trim();
    }
  }
  return result;
}

/** Remplit un modèle ; un champ sans valeur est laissé vide. */
export function renderTemplate(text: string, values: Record<string, string>): string {
  return text
    .replace(/\{([a-z]+)\}/g, (_, name: string) => values[name] ?? "")
    .replace(/\s+/g, " ")
    .trim();
}
