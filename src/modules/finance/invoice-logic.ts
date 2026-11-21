// Calcul des échéances et des réductions (fonctions pures). Montants en francs CFA entiers.

export type FeeTranche = {
  feeName: string;
  kind: "registration" | "tuition" | "other";
  mandatory: boolean;
  installmentNumber: number;
  installmentCount: number;
  amount: number;
  dueDate: string;
};

export type InvoiceDraft = FeeTranche & { discountAmount: number; discountNote: string | null };

/** Réduction en pourcentage, arrondie au franc inférieur (hypothèse H49). */
export function percentOf(amount: number, percent: number): number {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100)
    throw new Error("Pourcentage invalide");
  return Math.floor((amount * percent) / 100);
}

/** Ajoute une réduction à une échéance sans jamais dépasser son montant. */
export function addDiscount(
  invoice: { amount: number; discountAmount: number; discountNote: string | null },
  extra: number,
  label: string,
): { discountAmount: number; discountNote: string } {
  if (!Number.isSafeInteger(extra) || extra < 0) throw new Error("Réduction invalide");
  return {
    discountAmount: Math.min(invoice.amount, invoice.discountAmount + extra),
    discountNote: invoice.discountNote ? `${invoice.discountNote} ; ${label}` : label,
  };
}

/**
 * Échéances d'un élève à partir des tranches de la grille de son niveau. La réduction fratrie
 * s'applique à la scolarité seulement, si l'élève n'est pas le premier enfant inscrit (décision D6).
 */
export function buildInvoices(
  tranches: readonly FeeTranche[],
  sibling: { percent: number; applies: boolean },
): InvoiceDraft[] {
  return tranches.map((tranche) => {
    const base = { ...tranche, discountAmount: 0, discountNote: null };
    if (!sibling.applies || sibling.percent === 0 || tranche.kind !== "tuition") return base;
    return {
      ...tranche,
      ...addDiscount(
        base,
        percentOf(tranche.amount, sibling.percent),
        `Fratrie ${sibling.percent} %`,
      ),
    };
  });
}

export const amountDue = (invoice: { amount: number; discountAmount: number }) =>
  invoice.amount - invoice.discountAmount;
