// Montants en francs CFA (XAF) : toujours des entiers, jamais de nombre à virgule (CLAUDE.md §6).

/** Plafond d'un montant saisi (100 millions FCFA), garde-fou contre les fautes de frappe. */
export const MAX_AMOUNT = 100_000_000;

/** « 150 000 FCFA » (espaces insécables fines remplacées par des espaces simples, plus lisibles partout). */
export function formatXAF(amount: number): string {
  const digits = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(amount);
  return `${digits.replace(/\s/g, " ")} FCFA`;
}

/**
 * Lit un montant saisi : « 150000 », « 150 000 », « 150.000 », « 150 000 FCFA ».
 * Renvoie null pour une saisie vide, négative, décimale (« 150,50 ») ou hors plafond.
 */
export function parseXAF(input: string): number | null {
  const cleaned = input
    .trim()
    .replace(/\s*(f\s*cfa|fcfa|xaf|f)$/i, "")
    .replace(/[\s  ]/g, "");
  if (!/^\d{1,3}(\.\d{3})+$|^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned.replace(/\./g, ""));
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_AMOUNT ? value : null;
}
