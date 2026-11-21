import { describe, expect, it } from "vitest";
import { checkInstallments, proposeInstallments, totalOf, type Installment } from "./fees-logic";

const TERMS = ["2026-10-01", "2027-01-01", "2027-04-01"];

describe("proposeInstallments", () => {
  it("150 000 FCFA en 3 tranches, aux débuts de trimestre", () => {
    expect(proposeInstallments(150_000, 3, TERMS)).toEqual([
      { number: 1, amount: 50_000, dueDate: "2026-10-01" },
      { number: 2, amount: 50_000, dueDate: "2027-01-01" },
      { number: 3, amount: 50_000, dueDate: "2027-04-01" },
    ]);
  });

  it("arrondit à 100 FCFA et met le reste sur la dernière tranche", () => {
    const parts = proposeInstallments(100_000, 3, TERMS);
    expect(parts.map((p) => p.amount)).toEqual([33_300, 33_300, 33_400]);
    expect(totalOf(parts)).toBe(100_000);
  });

  it("la somme des tranches vaut toujours exactement le total", () => {
    for (const total of [1, 99, 250, 12_345, 85_550, 999_999, 1_000_000]) {
      for (let count = 1; count <= 12; count++) {
        if (count > total) continue;
        const parts = proposeInstallments(total, count, TERMS);
        expect(totalOf(parts), `${total} en ${count}`).toBe(total);
        expect(parts.every((p) => Number.isInteger(p.amount) && p.amount >= 1)).toBe(true);
      }
    }
  });

  it("répète la dernière échéance s'il y a plus de tranches que de dates", () => {
    const parts = proposeInstallments(60_000, 4, TERMS);
    expect(parts.map((p) => p.dueDate)).toEqual([...TERMS, "2027-04-01"]);
  });

  it("une seule tranche (frais d'inscription)", () => {
    expect(proposeInstallments(25_000, 1, ["2026-09-15"])).toEqual([
      { number: 1, amount: 25_000, dueDate: "2026-09-15" },
    ]);
  });

  it("refuse un total ou un nombre de tranches invalide", () => {
    expect(() => proposeInstallments(0, 3, TERMS)).toThrow();
    expect(() => proposeInstallments(1000.5, 3, TERMS)).toThrow();
    expect(() => proposeInstallments(1000, 0, TERMS)).toThrow();
    expect(() => proposeInstallments(1000, 13, TERMS)).toThrow();
    expect(() => proposeInstallments(1000, 2, [])).toThrow();
  });
});

describe("checkInstallments", () => {
  const ok: Installment[] = proposeInstallments(150_000, 3, TERMS);

  it("accepte des tranches cohérentes, même saisies dans le désordre", () => {
    expect(checkInstallments(ok)).toBeNull();
    expect(checkInstallments([ok[2], ok[0], ok[1]])).toBeNull();
  });

  it("refuse aucune tranche, plus de 12, une numérotation trouée", () => {
    expect(checkInstallments([])).toBe("installmentsCount");
    expect(checkInstallments([ok[0], { ...ok[2], number: 4 }])).toBe("installmentsCount");
    const many = Array.from({ length: 13 }, (_, i) => ({ ...ok[0], number: i + 1 }));
    expect(checkInstallments(many)).toBe("installmentsCount");
  });

  it("refuse un montant nul, négatif, décimal ou énorme", () => {
    for (const amount of [0, -100, 10.5, 100_000_001]) {
      expect(checkInstallments([{ ...ok[0], amount }, ok[1], ok[2]]), String(amount)).toBe(
        "installmentAmount",
      );
    }
  });

  it("refuse une échéance antérieure à la précédente", () => {
    expect(checkInstallments([ok[0], { ...ok[1], dueDate: "2026-09-01" }, ok[2]])).toBe(
      "installmentOrder",
    );
  });
});
