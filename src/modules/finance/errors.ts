/** Refus métier du module finances. Le code correspond à un texte `finance.errors.<code>` (i18n). */
export type FinanceErrorCode =
  | "enrollmentNotFound"
  | "invoiceNotFound"
  | "invoiceCancelled"
  | "yearArchived"
  | "feeNotFound"
  | "feeAlreadyInvoiced"
  | "noTuition"
  | "discountTooLarge"
  | "enrollmentLeft"
  | "hasPayments"
  | "overpayment"
  | "nothingDue"
  | "referenceRequired"
  | "duplicateReference"
  | "paymentNotFound"
  | "alreadyReversed"
  | "cancellationPending"
  | "cancellationNotFound"
  | "cashClosed"
  | "alreadyClosed"
  | "closureNotFound";

export class FinanceError extends Error {
  constructor(
    readonly code: FinanceErrorCode,
    /** Valeurs insérées dans le message (ex. le reste à payer maximal). */
    readonly params?: Record<string, string | number>,
  ) {
    super(`Finances : ${code}`);
    this.name = "FinanceError";
  }
}
