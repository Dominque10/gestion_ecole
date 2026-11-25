import { describe, expect, it } from "vitest";
import { isDemoMode, productionEnvProblems } from "./env";

/** Configuration de production complète, avec un vrai prestataire imaginaire remplacé par « fake ». */
const demo = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://app_user:mdp@db:5432/gestion_scolaire",
  AUTH_SECRET: "a".repeat(44),
  APP_URL: "https://ecole.exemple.cg",
  DEMO_MODE: "true",
};

describe("productionEnvProblems", () => {
  it("n'exige rien hors production (développement, tests)", () => {
    expect(productionEnvProblems({})).toEqual([]);
    expect(productionEnvProblems({ NODE_ENV: "development" })).toEqual([]);
    expect(productionEnvProblems({ NODE_ENV: "test", PAYMENT_PROVIDER: "fake" })).toEqual([]);
  });

  it("accepte une démonstration complète avec les faux prestataires", () => {
    expect(productionEnvProblems(demo)).toEqual([]);
    expect(
      productionEnvProblems({ ...demo, PAYMENT_PROVIDER: "fake", SMS_PROVIDER: "fake" }),
    ).toEqual([]);
  });

  it("refuse les faux prestataires en production hors démonstration", () => {
    const problems = productionEnvProblems({
      ...demo,
      DEMO_MODE: undefined,
      PAYMENT_WEBHOOK_SECRET: "s".repeat(32),
    });
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/^PAYMENT_PROVIDER : faux prestataire de paiement mobile refusé/);
    expect(problems[1]).toMatch(/^SMS_PROVIDER : faux prestataire de SMS refusé/);
    expect(problems[2]).toMatch(/^WHATSAPP_PROVIDER : faux prestataire de WhatsApp refusé/);
    expect(productionEnvProblems({ ...demo, DEMO_MODE: "false" }).join("\n")).toMatch(
      /faux prestataire/,
    );
  });

  it("refuse un prestataire inconnu, même en démonstration", () => {
    expect(productionEnvProblems({ ...demo, SMS_PROVIDER: "twilio" })).toEqual([
      "SMS_PROVIDER : prestataire de SMS inconnu (« twilio »)",
    ]);
  });

  it("exige le secret des confirmations de paiement hors démonstration", () => {
    const base = { ...demo, DEMO_MODE: undefined };
    expect(productionEnvProblems(base).join("\n")).toMatch(/PAYMENT_WEBHOOK_SECRET manquant/);
    expect(productionEnvProblems({ ...base, PAYMENT_WEBHOOK_SECRET: "court" }).join("\n")).toMatch(
      /PAYMENT_WEBHOOK_SECRET manquant ou trop court/,
    );
    expect(
      productionEnvProblems({ ...base, PAYMENT_WEBHOOK_SECRET: "s".repeat(32) }).join("\n"),
    ).not.toMatch(/PAYMENT_WEBHOOK_SECRET/);
  });

  it("exige la base avec le compte app_user", () => {
    expect(productionEnvProblems({ ...demo, DATABASE_URL: undefined })).toEqual([
      "DATABASE_URL manquant",
    ]);
    expect(productionEnvProblems({ ...demo, DATABASE_URL: "mysql://x" })).toEqual([
      "DATABASE_URL doit commencer par postgres://",
    ]);
    expect(
      productionEnvProblems({
        ...demo,
        DATABASE_URL: "postgres://postgres:mdp@db/gestion_scolaire",
      }),
    ).toEqual(["DATABASE_URL utilise le compte administrateur : utiliser app_user"]);
  });

  it("exige un secret de signature d'au moins 32 caractères", () => {
    expect(productionEnvProblems({ ...demo, AUTH_SECRET: undefined })[0]).toMatch(
      /^AUTH_SECRET manquant/,
    );
    expect(productionEnvProblems({ ...demo, AUTH_SECRET: "x".repeat(31) })[0]).toMatch(
      /^AUTH_SECRET trop court/,
    );
    expect(productionEnvProblems({ ...demo, AUTH_SECRET: "x".repeat(32) })).toEqual([]);
  });

  it("exige une adresse publique en HTTPS (sauf sur la machine elle-même)", () => {
    expect(productionEnvProblems({ ...demo, APP_URL: undefined })[0]).toMatch(/^APP_URL manquant/);
    expect(productionEnvProblems({ ...demo, APP_URL: "pas une adresse" })[0]).toMatch(
      /^APP_URL invalide/,
    );
    expect(productionEnvProblems({ ...demo, APP_URL: "http://ecole.exemple.cg" })[0]).toMatch(
      /^APP_URL doit commencer par https/,
    );
    expect(productionEnvProblems({ ...demo, APP_URL: "http://localhost:3100" })).toEqual([]);
  });

  it("refuse une valeur ambiguë pour DEMO_MODE", () => {
    expect(productionEnvProblems({ ...demo, DEMO_MODE: "oui" })[0]).toMatch(
      /^DEMO_MODE doit valoir « true » ou « false »/,
    );
  });
});

describe("isDemoMode", () => {
  it("n'est actif qu'avec la valeur exacte « true »", () => {
    expect(isDemoMode({ DEMO_MODE: "true" })).toBe(true);
    expect(isDemoMode({ DEMO_MODE: "false" })).toBe(false);
    expect(isDemoMode({ DEMO_MODE: "1" })).toBe(false);
    expect(isDemoMode({})).toBe(false);
  });
});
