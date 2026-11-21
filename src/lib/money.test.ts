import { describe, expect, it } from "vitest";
import { formatXAF, parseXAF } from "./money";

describe("formatXAF", () => {
  it("sépare les milliers et ajoute FCFA", () => {
    expect(formatXAF(150000)).toBe("150 000 FCFA");
    expect(formatXAF(2500)).toBe("2 500 FCFA");
    expect(formatXAF(0)).toBe("0 FCFA");
  });
});

describe("parseXAF", () => {
  it("accepte les écritures courantes", () => {
    for (const input of [
      "150000",
      "150 000",
      " 150 000 FCFA",
      "150.000",
      "150 000 F",
      "1.500.000",
    ]) {
      expect(parseXAF(input), input).toBe(input.includes("1.500") ? 1_500_000 : 150_000);
    }
  });

  it("refuse vide, zéro, négatif, décimal, texte, hors plafond", () => {
    for (const input of ["", "0", "-5000", "150,50", "15.5", "cent", "100000001", "1.50.000"]) {
      expect(parseXAF(input), input).toBeNull();
    }
  });
});
