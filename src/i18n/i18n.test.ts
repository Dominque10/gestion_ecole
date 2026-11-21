import { describe, expect, it } from "vitest";
import { t } from "./index";

describe("t (textes de l'interface)", () => {
  it("renvoie le texte français d'une clé", () => {
    expect(t("app.name")).toBe("Gestion scolaire");
  });

  it("lève une erreur explicite pour une clé inconnue", () => {
    // @ts-expect-error clé volontairement inexistante
    expect(() => t("app.inexistant")).toThrow("Texte introuvable : app.inexistant");
  });
});
