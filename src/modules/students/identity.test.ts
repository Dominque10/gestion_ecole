import { describe, expect, it } from "vitest";
import { formatFirstNames, formatLastName, formatMatricule, searchKey } from "./identity";

describe("formatMatricule (décision A6)", () => {
  it("CODE-AA-NNNNN", () => {
    expect(formatMatricule("SJB", 2026, 42)).toBe("SJB-26-00042");
    expect(formatMatricule("SJB", 2030, 1)).toBe("SJB-30-00001");
    expect(formatMatricule("LYC", 2100, 99999)).toBe("LYC-00-99999");
  });

  it("au-delà de 99 999, le numéro s'allonge (jamais tronqué)", () => {
    expect(formatMatricule("SJB", 2026, 123456)).toBe("SJB-26-123456");
  });

  it("refuse un numéro nul ou négatif", () => {
    expect(() => formatMatricule("SJB", 2026, 0)).toThrow();
  });
});

describe("searchKey", () => {
  it("minuscules, sans accents, ponctuation retirée", () => {
    expect(searchKey("NGOMA", "Bénédicte Ève", "SJB-26-00042")).toBe(
      "ngoma benedicte eve sjb-26-00042",
    );
    expect(searchKey("  Mampouya ", null, "Jean-Noël")).toBe("mampouya jean-noel");
  });
});

describe("mise en forme des noms", () => {
  it("nom en majuscules, prénoms avec initiales", () => {
    expect(formatLastName("  ngoma  mabiala ")).toBe("NGOMA MABIALA");
    expect(formatFirstNames("bénédicte  ÈVE")).toBe("Bénédicte Ève");
    expect(formatFirstNames("jean-noël")).toBe("Jean-Noël");
  });
});
