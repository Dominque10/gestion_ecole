// Calculs de clôture et d'impayés (fonctions pures). Montants en francs CFA entiers.

export type ReceiptLine = {
  amount: number;
  method: "cash" | "mobile_money" | "transfer" | "cheque";
};

export type DayTotals = {
  receiptCount: number;
  cashTotal: number;
  mobileMoneyTotal: number;
  transferTotal: number;
  chequeTotal: number;
  total: number;
};

/** Totaux d'une journée de caisse par mode de paiement : le total est la somme des reçus. */
export function summarizeReceipts(receipts: readonly ReceiptLine[]): DayTotals {
  const by = (method: ReceiptLine["method"]) =>
    receipts.filter((r) => r.method === method).reduce((sum, r) => sum + r.amount, 0);
  const totals = {
    receiptCount: receipts.length,
    cashTotal: by("cash"),
    mobileMoneyTotal: by("mobile_money"),
    transferTotal: by("transfer"),
    chequeTotal: by("cheque"),
  };
  return {
    ...totals,
    total: totals.cashTotal + totals.mobileMoneyTotal + totals.transferTotal + totals.chequeTotal,
  };
}

export const AGE_BUCKETS = ["0-30", "31-60", "61-90", "90+"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Jours de retard entre la date limite et aujourd'hui (jours du calendrier). */
export function daysLate(dueDate: string, today: string): number {
  return Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / DAY_MS,
  );
}

/** Tranche d'ancienneté d'un impayé (hypothèse H59). */
export function ageBucket(days: number): AgeBucket {
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}
