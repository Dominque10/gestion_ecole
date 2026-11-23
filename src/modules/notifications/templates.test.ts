import { describe, expect, it } from "vitest";
import {
  checkTemplate,
  DEFAULT_TEMPLATES,
  readTemplates,
  renderTemplate,
  TEMPLATE_KINDS,
} from "./templates";

describe("Modèles de messages", () => {
  it("les modèles par défaut sont valides", () => {
    for (const kind of TEMPLATE_KINDS)
      expect(checkTemplate(kind, DEFAULT_TEMPLATES[kind])).toBeNull();
  });

  it("refuse un modèle vide, trop long, ou avec un champ inconnu pour ce message", () => {
    expect(checkTemplate("absence", "  ")).toEqual({ problem: "empty" });
    expect(checkTemplate("absence", "x".repeat(321))).toEqual({ problem: "tooLong" });
    expect(checkTemplate("bulletin", "Bulletin de {eleve} : {montant}")).toEqual({
      problem: "unknownField",
      field: "montant",
    });
    expect(checkTemplate("receipt", "Reçu {numero} de {montant} pour {eleve}")).toBeNull();
  });

  it("un modèle enregistré invalide est remplacé par celui par défaut", () => {
    const templates = readTemplates({
      bulletin: "Bulletin {eleve} {inconnu}",
      receipt: "Payé : {montant}",
    });
    expect(templates.bulletin).toBe(DEFAULT_TEMPLATES.bulletin);
    expect(templates.receipt).toBe("Payé : {montant}");
    expect(readTemplates(null)).toEqual(DEFAULT_TEMPLATES);
  });

  it("remplit les champs ; un champ sans valeur reste vide", () => {
    expect(
      renderTemplate(DEFAULT_TEMPLATES.absence, {
        ecole: "École Saint-Jean",
        eleve: "NGOMA Paul",
        classe: "6e A",
        absent: "absent",
        date: "24/11/2026",
        creneaux: "Matin",
      }),
    ).toBe(
      "École Saint-Jean : votre enfant NGOMA Paul (6e A) est absent le 24/11/2026 (Matin). Merci de justifier l'absence auprès du secrétariat.",
    );
    expect(renderTemplate("{ecole} : {message}", { ecole: "École" })).toBe("École :");
  });
});
