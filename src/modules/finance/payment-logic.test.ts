import { describe, expect, it } from "vitest";
import { allocate, formatReceiptNumber, OverpaymentError, type OpenInvoice } from "./payment-logic";

const inv = (
  id: string,
  remaining: number,
  dueDate: string,
  extra: Partial<OpenInvoice> = {},
): OpenInvoice => ({
  id,
  remaining,
  dueDate,
  mandatory: true,
  feeName: "Scolarité",
  installmentNumber: 1,
  ...extra,
});

const OPEN = [
  inv("t2", 50_000, "2027-01-04", { installmentNumber: 2 }),
  inv("insc", 25_000, "2026-09-15", { feeName: "Frais d'inscription" }),
  inv("tenue", 12_500, "2026-10-01", { mandatory: false, feeName: "Tenue" }),
  inv("t1", 50_000, "2026-10-01"),
];

describe("allocate", () => {
  it("échéance la plus ancienne d'abord ; à date égale, obligatoire avant facultatif", () => {
    expect(allocate(100_000, OPEN)).toEqual([
      { invoiceId: "insc", amount: 25_000 },
      { invoiceId: "t1", amount: 50_000 },
      { invoiceId: "tenue", amount: 12_500 },
      { invoiceId: "t2", amount: 12_500 },
    ]);
  });

  it("paiement partiel : s'arrête au milieu d'une échéance", () => {
    expect(allocate(30_000, OPEN)).toEqual([
      { invoiceId: "insc", amount: 25_000 },
      { invoiceId: "t1", amount: 5_000 },
    ]);
  });

  it("la somme répartie est toujours exactement le montant payé", () => {
    for (const amount of [1, 999, 25_000, 25_001, 87_500, 137_500]) {
      expect(allocate(amount, OPEN).reduce((s, a) => s + a.amount, 0)).toBe(amount);
    }
  });

  it("ignore les échéances déjà soldées", () => {
    expect(
      allocate(1_000, [inv("soldee", 0, "2026-01-01"), inv("t1", 5_000, "2026-10-01")]),
    ).toEqual([{ invoiceId: "t1", amount: 1_000 }]);
  });

  it("refuse le trop-perçu en indiquant le maximum", () => {
    expect(() => allocate(137_501, OPEN)).toThrow(OverpaymentError);
    try {
      allocate(200_000, OPEN);
    } catch (e) {
      expect((e as OverpaymentError).maximum).toBe(137_500);
    }
  });

  it("refuse un montant nul, négatif ou décimal", () => {
    for (const amount of [0, -100, 10.5]) expect(() => allocate(amount, OPEN)).toThrow();
  });
});

describe("formatReceiptNumber", () => {
  it("SJB-2026-00001", () => {
    expect(formatReceiptNumber("SJB", 2026, 1)).toBe("SJB-2026-00001");
    expect(formatReceiptNumber("SJB", 2026, 123456)).toBe("SJB-2026-123456");
    expect(() => formatReceiptNumber("SJB", 2026, 0)).toThrow();
  });
});
