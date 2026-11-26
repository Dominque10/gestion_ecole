// Garde-fous de production (mise en service, sous-étape Sb) : réglages vérifiés au démarrage de
// l'application (src/instrumentation.ts) et du worker. En production, un réglage manquant ou dangereux
// empêche le démarrage, avec la liste des problèmes : mieux vaut un service arrêté qu'un parent qui
// « paie » sans que l'argent arrive (faux prestataire) ou des liens de reçus signés avec un secret faible.
// Hors production (développement, tests), rien n'est exigé.
import path from "node:path";
import { z } from "zod";

/** Prestataires disponibles aujourd'hui : uniquement les faux (choix B4, B5 à venir). */
const KNOWN_PROVIDERS = ["fake"] as const;

const EnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  AUTH_SECRET: z.string().optional(),
  APP_URL: z.string().optional(),
  STORAGE_DIR: z.string().optional(),
  DEMO_MODE: z.string().optional(),
  DEMO_SITE: z.string().optional(),
  PAYMENT_PROVIDER: z.string().optional(),
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),
  SMS_PROVIDER: z.string().optional(),
  WHATSAPP_PROVIDER: z.string().optional(),
});

type Env = Record<string, string | undefined>;

/** Mode démonstration : faux prestataires acceptés en production, bandeau visible sur chaque page. */
export function isDemoMode(env: Env = process.env): boolean {
  return env.DEMO_MODE === "true";
}

/**
 * Site de démonstration public (Sg, décision D38) : école fictive remise à neuf chaque nuit, comptes
 * affichés sur la page de connexion, code des parents affiché à l'écran. Exige aussi DEMO_MODE=true.
 * Distinct de DEMO_MODE : une vraie école peut tourner en mode démonstration (faux prestataires, en
 * attendant B4 et B5) sans jamais exposer ses comptes ni perdre ses données (hypothèse H159).
 */
export function isDemoSite(env: Env = process.env): boolean {
  return env.DEMO_SITE === "true" && isDemoMode(env);
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Liste des problèmes de configuration (vide = démarrage autorisé). Fonction pure, testée.
 * Les messages s'adressent à la personne qui installe le serveur (journal), pas aux utilisateurs.
 */
export function productionEnvProblems(input: Env = process.env): string[] {
  const env = EnvSchema.parse(input);
  if (env.NODE_ENV !== "production") return [];
  const problems: string[] = [];
  const demo = isDemoMode(input);

  if (
    env.DEMO_MODE !== undefined &&
    env.DEMO_MODE !== "" &&
    !["true", "false"].includes(env.DEMO_MODE)
  ) {
    problems.push(`DEMO_MODE doit valoir « true » ou « false » (reçu : « ${env.DEMO_MODE} »)`);
  }

  if (
    env.DEMO_SITE !== undefined &&
    env.DEMO_SITE !== "" &&
    !["true", "false"].includes(env.DEMO_SITE)
  ) {
    problems.push(`DEMO_SITE doit valoir « true » ou « false » (reçu : « ${env.DEMO_SITE} »)`);
  } else if (env.DEMO_SITE === "true" && !demo) {
    problems.push(
      "DEMO_SITE=true exige DEMO_MODE=true (site de démonstration : faux prestataires)",
    );
  }

  if (!env.DATABASE_URL) {
    problems.push("DATABASE_URL manquant");
  } else if (!/^postgres(ql)?:\/\//.test(env.DATABASE_URL)) {
    problems.push("DATABASE_URL doit commencer par postgres://");
  } else if (/^postgres(ql)?:\/\/postgres[:@]/.test(env.DATABASE_URL)) {
    // L'application doit tourner avec app_user, soumis à la RLS (CLAUDE.md §6).
    problems.push("DATABASE_URL utilise le compte administrateur : utiliser app_user");
  }

  if (!env.AUTH_SECRET) {
    problems.push("AUTH_SECRET manquant (générer : openssl rand -base64 32)");
  } else if (env.AUTH_SECRET.length < 32) {
    problems.push("AUTH_SECRET trop court : 32 caractères au moins (openssl rand -base64 32)");
  }

  if (!env.APP_URL) {
    problems.push("APP_URL manquant (adresse publique, ex. https://ecole.exemple.cg)");
  } else {
    const url = URL.parse(env.APP_URL);
    if (!url) problems.push(`APP_URL invalide : « ${env.APP_URL} »`);
    else if (url.protocol !== "https:" && !isLocalHost(url.hostname)) {
      problems.push("APP_URL doit commencer par https:// (mots de passe et codes SMS chiffrés)");
    }
  }

  // Fichiers : chemin absolu, monté sur un volume sauvegardé (pas un dossier relatif au code).
  if (!env.STORAGE_DIR) {
    problems.push("STORAGE_DIR manquant (dossier des fichiers, ex. /app/storage)");
  } else if (!path.isAbsolute(env.STORAGE_DIR)) {
    problems.push("STORAGE_DIR doit être un chemin absolu (ex. /app/storage)");
  }

  const providers = [
    { variable: "PAYMENT_PROVIDER", label: "paiement mobile", value: env.PAYMENT_PROVIDER },
    { variable: "SMS_PROVIDER", label: "SMS", value: env.SMS_PROVIDER },
    { variable: "WHATSAPP_PROVIDER", label: "WhatsApp", value: env.WHATSAPP_PROVIDER },
  ];
  for (const { variable, label, value } of providers) {
    const name = value || "fake";
    if (!(KNOWN_PROVIDERS as readonly string[]).includes(name)) {
      problems.push(`${variable} : prestataire de ${label} inconnu (« ${name} »)`);
    } else if (name === "fake" && !demo) {
      problems.push(
        `${variable} : faux prestataire de ${label} refusé en production ` +
          "(brancher le vrai prestataire, ou DEMO_MODE=true pour une démonstration)",
      );
    }
  }

  if (!demo && (env.PAYMENT_WEBHOOK_SECRET ?? "").length < 32) {
    problems.push("PAYMENT_WEBHOOK_SECRET manquant ou trop court (32 caractères au moins)");
  }

  return problems;
}

/** Au démarrage : en production, arrête le processus si la configuration n'est pas sûre. */
export function enforceProductionEnv(service: string, env: Env = process.env): void {
  const problems = productionEnvProblems(env);
  if (problems.length === 0) {
    if (env.NODE_ENV === "production" && isDemoMode(env)) {
      console.warn(`[${service}] MODE DÉMONSTRATION : aucun paiement ni message réel`);
      if (isDemoSite(env)) {
        console.warn(`[${service}] SITE DE DÉMONSTRATION : données fictives effacées chaque nuit`);
      }
    }
    return;
  }
  console.error(
    `[${service}] démarrage refusé, configuration de production incomplète :\n` +
      problems.map((p) => `  - ${p}`).join("\n"),
  );
  process.exit(1);
}
