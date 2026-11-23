import { describe, expect, it } from "vitest";
import {
  annualAverage,
  computeAnnualResults,
  computePeriodResults,
  mentionFor,
  rankAverages,
  roundAverage,
  subjectAverage,
  type AssessmentInfo,
  type StudentGrades,
} from "./averages";
import type { GradeValue } from "./grade-input";
import { DEFAULT_GRADING_RULES, type GradingRules } from "./rules";

const rules = (overrides: Partial<GradingRules> = {}): GradingRules => ({
  ...DEFAULT_GRADING_RULES,
  ...overrides,
});
const s = (score: number): GradeValue => ({ status: "scored", score });
const ABSENT: GradeValue = { status: "absent" };
const EXCUSED: GradeValue = { status: "excused" };
const a = (
  id: string,
  kind: AssessmentInfo["kind"],
  maxScore = 20,
  subjectId = "m",
): AssessmentInfo => ({
  id,
  subjectId,
  kind,
  maxScore,
});

describe("Arrondi", () => {
  it("au centième, au dixième, ou tronqué ; sans erreur de virgule flottante", () => {
    expect(roundAverage(12.345, "hundredth")).toBe(12.35);
    expect(roundAverage(1.005, "hundredth")).toBe(1.01);
    expect(roundAverage(12.344, "hundredth")).toBe(12.34);
    expect(roundAverage(12.35, "tenth")).toBe(12.4);
    expect(roundAverage(12.349, "hundredthTruncated")).toBe(12.34);
    expect(roundAverage(13.7222, "hundredth")).toBe(13.72);
  });
});

describe("Moyenne d'une matière", () => {
  const list = [a("i1", "quiz"), a("d1", "homework", 10), a("c1", "composition")];

  it("(moyenne des interrogations et devoirs + composition) / 2 ; notes ramenées sur 20", () => {
    // 14 et 7/10 (= 14) → 14 ; composition 11 → (14 + 11) / 2 = 12,5
    expect(subjectAverage(rules(), 20, list, { i1: s(14), d1: s(7), c1: s(11) })).toBe(12.5);
  });

  it("poids de la composition réglable", () => {
    // (14 + 2 × 11) / 3 = 12
    expect(
      subjectAverage(rules({ compositionWeight: 2 }), 20, list, { i1: s(14), d1: s(7), c1: s(11) }),
    ).toBe(12);
  });

  it("absent : non compté, ou 0 selon la règle ; dispensé : jamais compté", () => {
    const grades = { i1: ABSENT, d1: s(5), c1: s(9) }; // devoirs : 10 seul
    expect(subjectAverage(rules(), 20, list, grades)).toBe(9.5);
    expect(subjectAverage(rules({ absence: "zero" }), 20, list, grades)).toBe(7);
    expect(
      subjectAverage(rules({ absence: "zero" }), 20, list, { i1: EXCUSED, d1: s(5), c1: s(9) }),
    ).toBe(9.5);
  });

  it("élève sans la composition (absent non compté) : ses devoirs seuls", () => {
    expect(subjectAverage(rules(), 20, list, { i1: s(12), d1: s(8), c1: ABSENT })).toBe(14);
  });

  it("classe sans composition : ce qui existe, ou la partie manquante à 0 (règle de l'école)", () => {
    const noComposition = [a("i1", "quiz")];
    expect(subjectAverage(rules(), 20, noComposition, { i1: s(15) })).toBe(15);
    expect(
      subjectAverage(rules({ missingPart: "countZero" }), 20, noComposition, { i1: s(15) }),
    ).toBe(7.5);
    const onlyComposition = [a("c1", "composition")];
    expect(
      subjectAverage(rules({ missingPart: "countZero" }), 20, onlyComposition, { c1: s(15) }),
    ).toBe(7.5);
  });

  it("toutes les notes comptent autant (règle de l'école)", () => {
    expect(
      subjectAverage(rules({ subjectAverage: "allEqual" }), 20, list, {
        i1: s(14),
        d1: s(7),
        c1: s(11),
      }),
    ).toBe(13);
  });

  it("aucune note : non notée", () => {
    expect(subjectAverage(rules(), 20, list, { i1: ABSENT, c1: EXCUSED })).toBeNull();
  });

  it("barème de l'école sur 10 (primaire)", () => {
    expect(subjectAverage(rules(), 10, [a("c1", "composition")], { c1: s(15) })).toBe(7.5);
  });
});

describe("Rang", () => {
  const items = [
    { key: "a", average: 15, exact: 15 },
    { key: "b", average: 12, exact: 12.004 },
    { key: "c", average: 12, exact: 11.996 },
    { key: "d", average: 10, exact: 10 },
    { key: "e", average: null, exact: null },
  ];
  const ranks = (mode: GradingRules["ranking"]) =>
    Object.fromEntries(
      [...rankAverages(items, mode)].map(([k, v]) => [k, `${v.rank}${v.tied ? " ex" : ""}`]),
    );

  it("ex æquo : 1er, 2e ex, 2e ex, 4e (décision D10) ; un non classé n'a pas de rang", () => {
    expect(ranks("competition")).toEqual({ a: "1", b: "2 ex", c: "2 ex", d: "4" });
  });
  it("variante 1, 2, 2, 3", () => {
    expect(ranks("dense")).toEqual({ a: "1", b: "2 ex", c: "2 ex", d: "3" });
  });
  it("variante : départage par la moyenne exacte", () => {
    expect(ranks("tiebreak")).toEqual({ a: "1", b: "2", c: "3", d: "4" });
  });
});

describe("Mentions", () => {
  it("seuils sur 20, divisés par 2 pour un barème sur 10 (hypothèse H72)", () => {
    expect(mentionFor(rules(), 20, 16)).toBe("Félicitations");
    expect(mentionFor(rules(), 20, 13.99)).toBe("Tableau d'honneur");
    expect(mentionFor(rules(), 20, 11.99)).toBeNull();
    expect(mentionFor(rules(), 10, 7)).toBe("Encouragements");
    expect(mentionFor(rules(), 20, null)).toBeNull();
  });
});

describe("Moyenne générale", () => {
  // Maths 12,345 (coef 4) et Français 10,005 (coef 3), toutes notes égales.
  const subjects = [
    { subjectId: "m", coefficient: 4, optional: false },
    { subjectId: "f", coefficient: 3, optional: false },
  ];
  const assessments = [
    a("m1", "quiz"),
    a("m2", "quiz"),
    a("f1", "quiz", 20, "f"),
    a("f2", "quiz", 20, "f"),
  ];
  const student = {
    enrollmentId: "x",
    grades: { m1: s(12.34), m2: s(12.35), f1: s(10), f2: s(10.01) },
  };
  const compute = (r: GradingRules) =>
    computePeriodResults({ rules: r, scale: 20, subjects, assessments, students: [student] })
      .students[0];

  it("à partir des moyennes de matière arrondies (décision D13) : 79,43 / 7 = 11,35", () => {
    const result = compute(rules({ subjectAverage: "allEqual" }));
    expect(result.subjects.map((x) => x.average)).toEqual([12.35, 10.01]);
    expect(result.totalPoints).toBeCloseTo(79.43, 10);
    expect(result.totalCoefficients).toBe(7);
    expect(result.average).toBe(11.35);
  });

  it("ou des moyennes exactes (réglage) : 79,395 / 7 = 11,34", () => {
    expect(
      compute(rules({ subjectAverage: "allEqual", generalAverageBase: "exactSubjects" })).average,
    ).toBe(11.34);
  });

  describe("matière facultative", () => {
    const withOptional = [...subjects, { subjectId: "d", coefficient: 2, optional: true }];
    const base = [
      a("m1", "composition"),
      a("f1", "composition", 20, "f"),
      a("d1", "composition", 20, "d"),
    ];
    const grades = (drawing: number) => ({
      enrollmentId: "x",
      grades: { m1: s(12), f1: s(10), d1: s(drawing) },
    });
    const run = (r: GradingRules, drawing: number) =>
      computePeriodResults({
        rules: r,
        scale: 20,
        subjects: withOptional,
        assessments: base,
        students: [grades(drawing)],
      }).students[0];

    it("seuls les points au-dessus de 10 s'ajoutent ; elle ne fait jamais baisser la moyenne (D10)", () => {
      // (48 + 30 + (14 − 10) × 2) / 7 = 86 / 7 = 12,29
      expect(run(rules(), 14).average).toBe(12.29);
      expect(run(rules(), 14).subjects[2].points).toBe(8);
      // Dessin 6 : aucun point, aucune baisse : 78 / 7 = 11,14
      expect(run(rules(), 6).average).toBe(11.14);
    });
    it("variantes : comptée normalement, ou hors moyenne", () => {
      expect(run(rules({ optionalSubjects: "normal" }), 6).average).toBe(10); // (48 + 30 + 12) / 9
      expect(run(rules({ optionalSubjects: "excluded" }), 18).average).toBe(11.14);
    });
  });

  describe("élève sans aucune note dans une matière notée", () => {
    const list = [a("m1", "composition"), a("f1", "composition", 20, "f")];
    const pupils: StudentGrades[] = [
      { enrollmentId: "x", grades: { m1: s(12) } },
      { enrollmentId: "y", grades: { m1: s(10), f1: s(10) } },
    ];
    const run = (mode: GradingRules["emptySubject"]) =>
      computePeriodResults({
        rules: rules({ emptySubject: mode }),
        scale: 20,
        subjects,
        assessments: list,
        students: pupils,
      }).students[0];

    it("matière exclue (décision D13) : 12, et l'élève reste classé", () => {
      expect(run("excluded")).toMatchObject({ average: 12, rank: 1 });
      expect(run("excluded").subjects[1]).toMatchObject({ average: null, points: null });
    });
    it("variantes : comptée 0, ou non classé", () => {
      expect(run("zero").average).toBe(6.86); // 48 / 7
      expect(run("unranked")).toMatchObject({ average: null, rank: null, mention: null });
    });
    it("une matière jamais évaluée dans la classe est ignorée pour tous", () => {
      const onlyMaths = [a("m1", "composition")];
      const result = computePeriodResults({
        rules: rules({ emptySubject: "zero" }),
        scale: 20,
        subjects,
        assessments: onlyMaths,
        students: [{ enrollmentId: "x", grades: { m1: s(12) } }],
      });
      expect(result.students[0]).toMatchObject({ average: 12, totalCoefficients: 4 });
    });
  });
});

describe("Cas de référence construit (en attendant ceux du porteur du projet)", () => {
  // 6e, règles par défaut. Maths coef 4 ; Français coef 3 ; Anglais coef 2 ; Dessin facultatif coef 1.
  const subjects = [
    { subjectId: "maths", coefficient: 4, optional: false },
    { subjectId: "francais", coefficient: 3, optional: false },
    { subjectId: "anglais", coefficient: 2, optional: false },
    { subjectId: "dessin", coefficient: 1, optional: true },
  ];
  const assessments = [
    a("m-i1", "quiz", 20, "maths"),
    a("m-d1", "homework", 10, "maths"),
    a("m-c", "composition", 20, "maths"),
    a("f-d1", "homework", 20, "francais"),
    a("f-c", "composition", 40, "francais"),
    a("an-i1", "quiz", 20, "anglais"),
    a("de-d1", "homework", 20, "dessin"),
  ];
  const students: StudentGrades[] = [
    {
      // Maths (14 + 14)/2 = 14 → (14 + 11)/2 = 12,5 ; Français (12 + 13)/2 = 12,5 ; Anglais 15 ;
      // Dessin 16 → +6 points. (50 + 37,5 + 30 + 6) / 9 = 13,72
      enrollmentId: "ADA",
      grades: {
        "m-i1": s(14),
        "m-d1": s(7),
        "m-c": s(11),
        "f-d1": s(12),
        "f-c": s(26),
        "an-i1": s(15),
        "de-d1": s(16),
      },
    },
    {
      // Maths : absent à l'interrogation → 10 → (10 + 9)/2 = 9,5 ; Français : dispensé du devoir → 15 ;
      // Anglais 11 ; Dessin 6 → 0 point. (38 + 45 + 22) / 9 = 11,67
      enrollmentId: "BOB",
      grades: {
        "m-i1": ABSENT,
        "m-d1": s(5),
        "m-c": s(9),
        "f-d1": EXCUSED,
        "f-c": s(30),
        "an-i1": s(11),
        "de-d1": s(6),
      },
    },
    {
      // Maths (13 + 13)/2 = 13 → (13 + 12,5)/2 = 12,75 ; Français (13 + 12,25)/2 = 12,625 → 12,63 ;
      // Anglais : absente → non notée, exclue. (51 + 37,89) / 7 = 12,70
      enrollmentId: "CHLOE",
      grades: {
        "m-i1": s(13),
        "m-d1": s(6.5),
        "m-c": s(12.5),
        "f-d1": s(13),
        "f-c": s(24.5),
        "an-i1": ABSENT,
      },
    },
  ];
  const results = computePeriodResults({
    rules: rules(),
    scale: 20,
    subjects,
    assessments,
    students,
  });
  const by = (id: string) => results.students.find((r) => r.enrollmentId === id)!;

  it("moyennes par matière", () => {
    expect(by("ADA").subjects.map((x) => x.average)).toEqual([12.5, 12.5, 15, 16]);
    expect(by("BOB").subjects.map((x) => x.average)).toEqual([9.5, 15, 11, 6]);
    expect(by("CHLOE").subjects.map((x) => x.average)).toEqual([12.75, 12.63, null, null]);
  });

  it("moyennes générales, rangs et mentions", () => {
    expect(results.students.map((r) => [r.enrollmentId, r.average, r.rank, r.mention])).toEqual([
      ["ADA", 13.72, 1, "Tableau d'honneur"],
      ["BOB", 11.67, 3, null],
      ["CHLOE", 12.7, 2, "Tableau d'honneur"],
    ]);
  });

  it("moyenne de la classe, plus forte et plus faible ; statistiques par matière", () => {
    expect(results.classStats).toEqual({ average: 12.7, highest: 13.72, lowest: 11.67 });
    expect(results.subjectStats[0]).toEqual({
      subjectId: "maths",
      average: 11.58,
      highest: 12.75,
      lowest: 9.5,
    });
    expect(results.subjectStats[2]).toEqual({
      subjectId: "anglais",
      average: 13,
      highest: 15,
      lowest: 11,
    });
  });
});

describe("Moyenne annuelle", () => {
  it("moyenne des trimestres, chacun pèse autant (D10) ; un trimestre sans moyenne est laissé de côté", () => {
    expect(annualAverage(rules(), [12, 14, 13])).toBe(13);
    expect(annualAverage(rules(), [12, null, 13])).toBe(12.5);
    expect(annualAverage(rules(), [null, null])).toBeNull();
  });
  it("variante : le dernier compte double", () => {
    expect(annualAverage(rules({ annualAverage: "lastDouble" }), [12, 14, 13])).toBe(13);
    expect(annualAverage(rules({ annualAverage: "lastDouble" }), [10, 10, 16])).toBe(13);
  });
  it("rang et mention annuels", () => {
    const result = computeAnnualResults({
      rules: rules(),
      scale: 20,
      students: [
        { enrollmentId: "x", periods: [13.72, 14.1, 12.5] },
        { enrollmentId: "y", periods: [11.67, 12, 12.01] },
      ],
    });
    expect(result.students.map((r) => [r.average, r.rank, r.mention])).toEqual([
      [13.44, 1, "Tableau d'honneur"],
      [11.89, 2, null],
    ]);
    expect(result.classStats).toEqual({ average: 12.67, highest: 13.44, lowest: 11.89 });
  });
});
