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
  | "enrollmentLeft";

export class FinanceError extends Error {
  constructor(readonly code: FinanceErrorCode) {
    super(`Finances : ${code}`);
    this.name = "FinanceError";
  }
}
