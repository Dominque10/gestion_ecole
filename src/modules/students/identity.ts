// Fonctions pures de la fiche élève (testées unitairement).

/**
 * Matricule CODE-AA-NNNNN (décision A6) : préfixe de l'école, deux chiffres de l'année, numéro d'ordre
 * sur 5 chiffres (plus si l'école dépasse 99 999 élèves).
 */
export function formatMatricule(prefix: string, year: number, number: number): string {
  if (!Number.isInteger(number) || number < 1) throw new Error("Numéro de matricule invalide");
  const yy = String(year % 100).padStart(2, "0");
  return `${prefix}-${yy}-${String(number).padStart(5, "0")}`;
}

/** Texte de recherche : minuscules, sans accents, espaces simples (« Ngoma Bénédicte » → « ngoma benedicte »). */
export function searchKey(...parts: (string | null | undefined)[]): string {
  return parts
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, " ")
    .trim();
}

/** Nom de famille en majuscules, prénoms avec initiales en majuscule (usage des écoles congolaises). */
export function formatLastName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleUpperCase("fr-FR");
}

export function formatFirstNames(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("fr-FR")
    .replace(
      /(^|[\s-])(\p{L})/gu,
      (_, sep: string, letter: string) => sep + letter.toLocaleUpperCase("fr-FR"),
    );
}
