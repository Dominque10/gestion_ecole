import { describe, expect, it } from "vitest";
import { DEFAULT_GRADING_RULES, readGradingRules } from "./rules";
import { gradingRulesFromForm } from "./rules-form";

const formFields = (overrides: Record<string, string> = {}) => ({
  primaryScale: "20",
  subjectAverage: "continuousAndComposition",
  compositionWeight: "1",
  rounding: "hundredth",
  ranking: "competition",
  optionalSubjects: "bonusAboveHalf",
  absence: "excluded",
  annualAverage: "periodsMean",
  "mention-0": "Félicitations",
  "seuil-0": "16",
  "mention-1": "Encouragements",
  "seuil-1": "14",
  "mention-2": "Tableau d'honneur",
  "seuil-2": "12",
  ...overrides,
});

describe("Règles par défaut (décision D10)", () => {
  it("sont celles choisies par le porteur du projet", () => {
    expect(DEFAULT_GRADING_RULES).toMatchObject({
      primaryScale: 20,
      subjectAverage: "continuousAndComposition",
      compositionWeight: 1,
      rounding: "hundredth",
      ranking: "competition",
      optionalSubjects: "bonusAboveHalf",
      absence: "excluded",
      annualAverage: "periodsMean",
    });
    expect(DEFAULT_GRADING_RULES.mentions.map((m) => m.minAverage)).toEqual([16, 14, 12]);
  });
});

describe("readGradingRules", () => {
  it("rien d'enregistré ou contenu illisible : règles par défaut", () => {
    expect(readGradingRules(null)).toEqual(DEFAULT_GRADING_RULES);
    expect(readGradingRules("n'importe quoi")).toEqual(DEFAULT_GRADING_RULES);
    expect(readGradingRules({ rounding: "au hasard" })).toEqual(DEFAULT_GRADING_RULES);
  });

  it("une règle absente (ajoutée plus tard) prend sa valeur par défaut", () => {
    expect(readGradingRules({ rounding: "tenth", ranking: "dense" })).toEqual({
      ...DEFAULT_GRADING_RULES,
      rounding: "tenth",
      ranking: "dense",
    });
  });

  it("range les mentions du seuil le plus haut au plus bas", () => {
    const rules = readGradingRules({
      mentions: [
        { label: "Tableau d'honneur", minAverage: 12 },
        { label: "Félicitations", minAverage: 16 },
      ],
    });
    expect(rules.mentions.map((m) => m.label)).toEqual(["Félicitations", "Tableau d'honneur"]);
  });
});

describe("gradingRulesFromForm", () => {
  it("lit les choix et les mentions ; seuil avec virgule ; lignes vides ignorées", () => {
    const rules = gradingRulesFromForm(
      formFields({
        primaryScale: "10",
        compositionWeight: "2",
        "mention-2": "",
        "seuil-2": "",
        "mention-4": "Tableau d'honneur",
        "seuil-4": "12,5",
      }),
    );
    expect(rules).toMatchObject({ primaryScale: 10, compositionWeight: 2 });
    expect(rules?.mentions).toEqual([
      { label: "Félicitations", minAverage: 16 },
      { label: "Encouragements", minAverage: 14 },
      { label: "Tableau d'honneur", minAverage: 12.5 },
    ]);
  });

  it("aucune mention : accepté", () => {
    const empty = { "mention-0": "", "seuil-0": "", "mention-1": "", "seuil-1": "" };
    const rules = gradingRulesFromForm(formFields({ ...empty, "mention-2": "", "seuil-2": "" }));
    expect(rules?.mentions).toEqual([]);
  });

  it.each([
    ["choix inconnu", { rounding: "au hasard" }],
    ["barème hors 10/20", { primaryScale: "15" }],
    ["poids de composition hors 1-3", { compositionWeight: "4" }],
    ["mention sans seuil", { "seuil-0": "" }],
    ["seuil sans mention", { "mention-0": "" }],
    ["seuil au-dessus de 20", { "seuil-0": "21" }],
    ["seuil illisible", { "seuil-0": "seize" }],
    ["deux mentions du même nom", { "mention-1": "félicitations" }],
  ])("refuse : %s", (_label, overrides) => {
    expect(gradingRulesFromForm(formFields(overrides))).toBeNull();
  });
});
