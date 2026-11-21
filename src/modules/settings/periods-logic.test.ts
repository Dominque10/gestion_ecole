import { describe, expect, it } from "vitest";
import {
  checkPeriods,
  defaultPeriodLabel,
  isValidDate,
  proposePeriods,
  proposeYear,
  type PeriodDraft,
} from "./periods-logic";

const YEAR = { startDate: "2026-10-01", endDate: "2027-06-30", periodKind: "trimester" as const };
const T: PeriodDraft[] = [
  { position: 1, label: "1er trimestre", startDate: "2026-10-01", endDate: "2026-12-18" },
  { position: 2, label: "2e trimestre", startDate: "2027-01-04", endDate: "2027-03-26" },
  { position: 3, label: "3e trimestre", startDate: "2027-04-12", endDate: "2027-06-30" },
];

describe("isValidDate", () => {
  it("accepte une vraie date, refuse le reste", () => {
    expect(isValidDate("2027-02-28")).toBe(true);
    expect(isValidDate("2028-02-29")).toBe(true);
    for (const bad of ["2027-02-29", "2027-13-01", "01/10/2026", "2026-1-1", ""]) {
      expect(isValidDate(bad), bad).toBe(false);
    }
  });
});

describe("proposePeriods (découpage par défaut)", () => {
  it("3 trimestres contigus couvrant toute l'année", () => {
    expect(proposePeriods("trimester", "2026-10-01", "2027-06-30")).toEqual([
      { position: 1, label: "1er trimestre", startDate: "2026-10-01", endDate: "2026-12-31" },
      { position: 2, label: "2e trimestre", startDate: "2027-01-01", endDate: "2027-03-31" },
      { position: 3, label: "3e trimestre", startDate: "2027-04-01", endDate: "2027-06-30" },
    ]);
  });

  it("2 semestres en mois entiers (9 mois : 4 + 5)", () => {
    expect(proposePeriods("semester", "2026-10-01", "2027-06-30")).toEqual([
      { position: 1, label: "1er semestre", startDate: "2026-10-01", endDate: "2027-01-31" },
      { position: 2, label: "2e semestre", startDate: "2027-02-01", endDate: "2027-06-30" },
    ]);
  });

  it("dates quelconques : durées égales au jour près, sans trou", () => {
    expect(proposePeriods("trimester", "2026-09-15", "2027-07-10")).toEqual([
      { position: 1, label: "1er trimestre", startDate: "2026-09-15", endDate: "2026-12-22" },
      { position: 2, label: "2e trimestre", startDate: "2026-12-23", endDate: "2027-04-01" },
      { position: 3, label: "3e trimestre", startDate: "2027-04-02", endDate: "2027-07-10" },
    ]);
  });

  it("la proposition passe toujours les vérifications", () => {
    for (const kind of ["trimester", "semester"] as const) {
      const year = { startDate: "2026-09-15", endDate: "2027-07-10", periodKind: kind };
      expect(checkPeriods(year, proposePeriods(kind, year.startDate, year.endDate))).toBeNull();
    }
  });

  it("libellés par défaut", () => {
    expect(defaultPeriodLabel("trimester", 1)).toBe("1er trimestre");
    expect(defaultPeriodLabel("semester", 2)).toBe("2e semestre");
  });
});

describe("proposeYear (hypothèse : 1er octobre → 30 juin)", () => {
  it("à partir de juillet, propose l'année qui commence à l'automne", () => {
    expect(proposeYear("2026-11-21")).toEqual({
      label: "2026-2027",
      startDate: "2026-10-01",
      endDate: "2027-06-30",
    });
    expect(proposeYear("2027-07-01").label).toBe("2027-2028");
  });

  it("avant juillet, propose l'année en cours", () => {
    expect(proposeYear("2027-03-10").label).toBe("2026-2027");
  });
});

describe("checkPeriods", () => {
  it("accepte des trimestres avec vacances entre eux", () => {
    expect(checkPeriods(YEAR, T)).toBeNull();
  });

  it("l'ordre de saisie n'a pas d'importance", () => {
    expect(checkPeriods(YEAR, [T[2], T[0], T[1]])).toBeNull();
  });

  it("refuse un mauvais nombre de périodes ou une numérotation trouée", () => {
    expect(checkPeriods(YEAR, T.slice(0, 2))).toBe("periodsCount");
    expect(checkPeriods({ ...YEAR, periodKind: "semester" }, T)).toBe("periodsCount");
    expect(checkPeriods(YEAR, [T[0], T[1], { ...T[2], position: 4 }])).toBe("periodsCount");
  });

  it("refuse un libellé vide", () => {
    expect(checkPeriods(YEAR, [T[0], { ...T[1], label: "  " }, T[2]])).toBe("periodLabel");
  });

  it("refuse une date invalide ou une fin avant le début", () => {
    expect(checkPeriods(YEAR, [{ ...T[0], endDate: "2026-02-30" }, T[1], T[2]])).toBe(
      "periodDates",
    );
    expect(checkPeriods(YEAR, [{ ...T[0], endDate: "2026-09-30" }, T[1], T[2]])).toBe(
      "periodDates",
    );
  });

  it("refuse une période qui déborde de l'année", () => {
    expect(checkPeriods(YEAR, [{ ...T[0], startDate: "2026-09-30" }, T[1], T[2]])).toBe(
      "periodsOutsideYear",
    );
    expect(checkPeriods(YEAR, [T[0], T[1], { ...T[2], endDate: "2027-07-01" }])).toBe(
      "periodsOutsideYear",
    );
  });

  it("refuse deux périodes qui se chevauchent (même d'un jour)", () => {
    expect(checkPeriods(YEAR, [T[0], { ...T[1], startDate: "2026-12-18" }, T[2]])).toBe(
      "periodsOverlap",
    );
  });
});
