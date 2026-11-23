// Calculs de caisse (fonctions pures). Montants en francs CFA entiers.

export type OpenInvoice = {
  id: string;
  /** Reste à payer (montant − remise − déjà payé). */
  remaining: number;
  dueDate: string;
  mandatory: boolean;
  feeName: string;
  installmentNumber: number;
};

/**
 * Ordre d'affectation (hypothèse H39) : échéance la plus ancienne d'abord ; à date égale, obligatoire
 * avant facultatif, puis par nom de frais et numéro de tranche (ordre stable).
 */
export function allocationOrder(a: OpenInvoice, b: OpenInvoice): number {
  return (
    a.dueDate.localeCompare(b.dueDate) ||
    Number(b.mandatory) - Number(a.mandatory) ||
    a.feeName.localeCompare(b.feeName, "fr") ||
    a.installmentNumber - b.installmentNumber
  );
}

export class OverpaymentError extends Error {
  constructor(readonly maximum: number) {
    super(`Montant supérieur au reste à payer (${maximum})`);
    this.name = "OverpaymentError";
  }
}

/** Répartit un paiement sur les échéances ouvertes ; refuse tout trop-perçu (décision D6). */
export function allocate(
  amount: number,
  open: readonly OpenInvoice[],
): { invoiceId: string; amount: number }[] {
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error("Montant invalide");
  const candidates = open.filter((i) => i.remaining > 0).sort(allocationOrder);
  const maximum = candidates.reduce((sum, i) => sum + i.remaining, 0);
  if (amount > maximum) throw new OverpaymentError(maximum);
  const result: { invoiceId: string; amount: number }[] = [];
  let left = amount;
  for (const invoice of candidates) {
    if (left === 0) break;
    const part = Math.min(left, invoice.remaining);
    result.push({ invoiceId: invoice.id, amount: part });
    left -= part;
  }
  return result;
}

/** Numéro de reçu : préfixe de l'école, année de rentrée, numéro sur 5 chiffres (SJB-2026-00001). */
export function formatReceiptNumber(prefix: string, yearStart: number, number: number): string {
  if (!Number.isInteger(number) || number < 1) throw new Error("Numéro de reçu invalide");
  return `${prefix}-${yearStart}-${String(number).padStart(5, "0")}`;
}

/**
 * Paiement en ligne (4c) : l'argent est déjà reçu, on ne peut pas le refuser. Il va d'abord aux
 * échéances choisies par le parent, puis aux autres ; ce qui dépasse le reste dû (une échéance réglée
 * au guichet entre-temps) est un trop-perçu, signalé à la direction.
 */
export function allocateOnline(
  amount: number,
  open: readonly OpenInvoice[],
  selectedIds: readonly string[],
): { parts: { invoiceId: string; amount: number }[]; excess: number } {
  const selected = open.filter((i) => selectedIds.includes(i.id));
  const others = open.filter((i) => !selectedIds.includes(i.id));
  const parts: { invoiceId: string; amount: number }[] = [];
  let left = amount;
  for (const group of [selected, others]) {
    const room = group.reduce((sum, i) => sum + Math.max(0, i.remaining), 0);
    const share = Math.min(left, room);
    if (share > 0) {
      parts.push(...allocate(share, group));
      left -= share;
    }
  }
  return { parts, excess: left };
}
