// Calculs de la grille tarifaire (fonctions pures, utilisables aussi dans le navigateur).
// Montants en francs CFA entiers.
import { MAX_AMOUNT } from "@/lib/money";

export type Installment = { number: number; amount: number; dueDate: string };

/** Arrondi des tranches proposées (hypothèse : 100 FCFA). */
export const INSTALLMENT_ROUNDING = 100;
export const MAX_INSTALLMENTS = 12;

/**
 * Découpe un total en `count` tranches égales, arrondies à 100 FCFA ; le reste va sur la dernière
 * tranche, pour que la somme des tranches soit exactement le total.
 * Échéances : les dates données (ex. débuts de trimestre), la dernière répétée s'il en manque.
 */
export function proposeInstallments(
  total: number,
  count: number,
  dueDates: readonly string[],
): Installment[] {
  if (!Number.isSafeInteger(total) || total < 1) throw new Error("Total invalide");
  if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALLMENTS) {
    throw new Error("Nombre de tranches invalide");
  }
  if (dueDates.length === 0) throw new Error("Aucune échéance");
  let base = Math.floor(total / count / INSTALLMENT_ROUNDING) * INSTALLMENT_ROUNDING;
  // Petit total (ex. 250 FCFA en 3) : pas d'arrondi possible, tranches à l'unité près.
  if (base === 0) base = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    amount: i === count - 1 ? total - base * (count - 1) : base,
    dueDate: dueDates[Math.min(i, dueDates.length - 1)],
  }));
}

export type FeeProblem = "installmentsCount" | "installmentAmount" | "installmentOrder";

/**
 * Vérifie les tranches d'un frais : 1 à 12, numérotées 1…n, montants entiers positifs,
 * échéances dans l'ordre (une tranche n'arrive pas avant la précédente).
 */
export function checkInstallments(installments: readonly Installment[]): FeeProblem | null {
  const sorted = [...installments].sort((a, b) => a.number - b.number);
  if (sorted.length < 1 || sorted.length > MAX_INSTALLMENTS) return "installmentsCount";
  if (sorted.some((p, i) => p.number !== i + 1)) return "installmentsCount";
  if (
    sorted.some((p) => !Number.isSafeInteger(p.amount) || p.amount < 1 || p.amount > MAX_AMOUNT)
  ) {
    return "installmentAmount";
  }
  if (sorted.reduce((sum, p) => sum + p.amount, 0) > MAX_AMOUNT) return "installmentAmount";
  if (sorted.some((p, i) => i > 0 && p.dueDate < sorted[i - 1].dueDate)) return "installmentOrder";
  return null;
}

export const totalOf = (installments: readonly Installment[]) =>
  installments.reduce((sum, p) => sum + p.amount, 0);
