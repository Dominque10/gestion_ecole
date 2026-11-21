import { describe, expect, it } from "vitest";
import { addDiscount, amountDue, buildInvoices, percentOf, type FeeTranche } from "./invoice-logic";

const tranche = (overrides: Partial<FeeTranche>): FeeTranche => ({
  feeName: "Scolarité",
  kind: "tuition",
  mandatory: true,
  installmentNumber: 1,
  installmentCount: 3,
  amount: 50_000,
  dueDate: "2026-10-01",
  ...overrides,
});

const GRID: FeeTranche[] = [
  tranche({
    feeName: "Frais d'inscription",
    kind: "registration",
    installmentCount: 1,
    amount: 25_000,
  }),
  tranche({ installmentNumber: 1 }),
  tranche({ installmentNumber: 2, dueDate: "2027-01-01" }),
  tranche({ installmentNumber: 3, amount: 33_335, dueDate: "2027-04-01" }),
];

describe("percentOf", () => {
  it("arrondit au franc inférieur", () => {
    expect(percentOf(50_000, 10)).toBe(5_000);
    expect(percentOf(33_335, 10)).toBe(3_333);
    expect(percentOf(33_335, 0)).toBe(0);
    expect(percentOf(33_335, 100)).toBe(33_335);
  });

  it("refuse un pourcentage hors 0-100 ou décimal", () => {
    for (const p of [-1, 101, 12.5]) expect(() => percentOf(1000, p)).toThrow();
  });
});

describe("buildInvoices", () => {
  it("premier enfant : aucune réduction", () => {
    const invoices = buildInvoices(GRID, { percent: 10, applies: false });
    expect(invoices.map((i) => i.discountAmount)).toEqual([0, 0, 0, 0]);
  });

  it("frère ou sœur : réduction fratrie sur la scolarité seulement", () => {
    const invoices = buildInvoices(GRID, { percent: 10, applies: true });
    expect(invoices.map((i) => [i.feeName, i.discountAmount, i.discountNote])).toEqual([
      ["Frais d'inscription", 0, null],
      ["Scolarité", 5_000, "Fratrie 10 %"],
      ["Scolarité", 5_000, "Fratrie 10 %"],
      ["Scolarité", 3_333, "Fratrie 10 %"],
    ]);
    expect(invoices.reduce((s, i) => s + amountDue(i), 0)).toBe(25_000 + 45_000 + 45_000 + 30_002);
  });

  it("taux 0 % : comme le premier enfant", () => {
    expect(
      buildInvoices(GRID, { percent: 0, applies: true }).every((i) => i.discountNote === null),
    ).toBe(true);
  });
});

describe("addDiscount", () => {
  it("cumule les réductions et leur motif", () => {
    const after = addDiscount(
      { amount: 50_000, discountAmount: 5_000, discountNote: "Fratrie 10 %" },
      25_000,
      "Bourse 50 %",
    );
    expect(after).toEqual({ discountAmount: 30_000, discountNote: "Fratrie 10 % ; Bourse 50 %" });
  });

  it("ne dépasse jamais le montant de l'échéance", () => {
    expect(
      addDiscount({ amount: 50_000, discountAmount: 40_000, discountNote: null }, 20_000, "Remise")
        .discountAmount,
    ).toBe(50_000);
  });

  it("refuse une réduction négative ou décimale", () => {
    expect(() =>
      addDiscount({ amount: 1, discountAmount: 0, discountNote: null }, -1, "x"),
    ).toThrow();
    expect(() =>
      addDiscount({ amount: 1, discountAmount: 0, discountNote: null }, 0.5, "x"),
    ).toThrow();
  });
});
