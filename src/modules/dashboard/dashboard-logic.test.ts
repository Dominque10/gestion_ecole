import { describe, expect, it } from "vitest";
import type { PeriodResults, StudentResult } from "@/modules/grading/averages";
import { currentPeriod, monthStart, passes, rate, summarizeResults } from "./dashboard-logic";

describe("rate", () => {
  it("donne un pourcentage au dixième, rien quand il n'y a pas de base", () => {
    expect(rate(1, 3)).toBe(33.3);
    expect(rate(2, 3)).toBe(66.7);
    expect(rate(5, 5)).toBe(100);
    expect(rate(0, 0)).toBeNull();
  });
});

describe("passes", () => {
  it("réussite à la moitié du barème, quel que soit le barème", () => {
    expect(passes(10, 20)).toBe(true);
    expect(passes(9.99, 20)).toBe(false);
    expect(passes(5, 10)).toBe(true);
    expect(passes(4.5, 10)).toBe(false);
  });
});

describe("monthStart", () => {
  it("premier jour du mois", () => {
    expect(monthStart("2026-11-23")).toBe("2026-11-01");
  });
});

describe("currentPeriod", () => {
  const periods = [
    { id: "t2", position: 2, startDate: "2027-01-04", endDate: "2027-03-31" },
    { id: "t1", position: 1, startDate: "2026-10-01", endDate: "2026-12-20" },
    { id: "t3", position: 3, startDate: "2027-04-12", endDate: "2027-06-30" },
  ];
  it("la période en cours, la première avant l'année, la dernière commencée entre deux", () => {
    expect(currentPeriod(periods, "2026-11-23")?.id).toBe("t1");
    expect(currentPeriod(periods, "2026-09-01")?.id).toBe("t1");
    expect(currentPeriod(periods, "2026-12-28")?.id).toBe("t1");
    expect(currentPeriod(periods, "2027-02-01")?.id).toBe("t2");
    expect(currentPeriod(periods, "2027-08-01")?.id).toBe("t3");
    expect(currentPeriod([], "2027-08-01")).toBeNull();
  });
});

describe("summarizeResults", () => {
  const student = (
    id: string,
    average: number | null,
    subjects: [string, number | null][],
  ): StudentResult => ({
    enrollmentId: id,
    subjects: subjects.map(([subjectId, avg]) => ({
      subjectId,
      average: avg,
      exact: avg,
      points: avg,
    })),
    totalPoints: 0,
    totalCoefficients: 0,
    average,
    exact: average,
    rank: null,
    tied: false,
    mention: null,
  });
  const results = (students: StudentResult[], average: number | null): PeriodResults => ({
    students,
    classStats: { average, highest: null, lowest: null },
    subjectStats: [],
  });

  it("taux de réussite par classe (élèves classés seulement) et par matière, barèmes mêlés", () => {
    const summary = summarizeResults(
      [
        {
          classId: "c1",
          className: "6e A",
          levelName: "6e",
          scale: 20,
          results: results(
            [
              student("a", 12, [
                ["maths", 8],
                ["fr", 14],
              ]),
              student("b", 9, [
                ["maths", 9],
                ["fr", 10],
              ]),
              // Non classé : ne compte pas dans le taux de la classe, compte en français.
              student("c", null, [
                ["maths", null],
                ["fr", 11],
              ]),
            ],
            10.5,
          ),
        },
        {
          classId: "c2",
          className: "CM2",
          levelName: "CM2",
          scale: 10,
          results: results([student("d", 6, [["maths", 7]])], 6),
        },
      ],
      new Map([
        ["maths", "Mathématiques"],
        ["fr", "Français"],
      ]),
    );
    expect(summary.classes.map((c) => [c.className, c.ranked, c.passed, c.passRate])).toEqual([
      ["6e A", 2, 1, 50],
      ["CM2", 1, 1, 100],
    ]);
    expect([summary.ranked, summary.passed, summary.passRate]).toEqual([3, 2, 66.7]);
    // Les matières en difficulté d'abord.
    expect(summary.subjects.map((s) => [s.name, s.graded, s.passed, s.passRate])).toEqual([
      ["Mathématiques", 3, 1, 33.3],
      ["Français", 3, 3, 100],
    ]);
  });

  it("aucune note : taux vides, pas d'erreur", () => {
    const summary = summarizeResults(
      [
        {
          classId: "c1",
          className: "6e A",
          levelName: "6e",
          scale: 20,
          results: results([], null),
        },
      ],
      new Map(),
    );
    expect(summary.passRate).toBeNull();
    expect(summary.classes[0].passRate).toBeNull();
    expect(summary.subjects).toEqual([]);
  });
});
