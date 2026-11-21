import { describe, expect, it } from "vitest";
import { ageBucket, daysLate, summarizeReceipts } from "./closure-logic";

describe("summarizeReceipts", () => {
  it("totaux par mode ; le total est toujours la somme des reçus", () => {
    const receipts = [
      { amount: 25_000, method: "cash" as const },
      { amount: 10_000, method: "mobile_money" as const },
      { amount: 5_000, method: "cash" as const },
      { amount: 50_000, method: "cheque" as const },
    ];
    expect(summarizeReceipts(receipts)).toEqual({
      receiptCount: 4,
      cashTotal: 30_000,
      mobileMoneyTotal: 10_000,
      transferTotal: 0,
      chequeTotal: 50_000,
      total: 90_000,
    });
  });

  it("journée sans reçu : tout à zéro", () => {
    expect(summarizeReceipts([])).toMatchObject({ receiptCount: 0, total: 0 });
  });
});

describe("retards", () => {
  it("compte les jours du calendrier, y compris d'une année sur l'autre", () => {
    expect(daysLate("2026-10-01", "2026-10-31")).toBe(30);
    expect(daysLate("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysLate("2026-10-01", "2026-10-01")).toBe(0);
  });

  it("tranches d'ancienneté", () => {
    expect([1, 30, 31, 60, 61, 90, 91, 400].map(ageBucket)).toEqual([
      "0-30",
      "0-30",
      "31-60",
      "31-60",
      "61-90",
      "61-90",
      "90+",
      "90+",
    ]);
  });
});
