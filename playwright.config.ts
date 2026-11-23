import { defineConfig, devices } from "@playwright/test";
import { e2eDatabaseUrls } from "./tests/e2e/env";

const port = 3100;
const db = e2eDatabaseUrls();
// Valeurs propres aux tests de bout en bout (jamais celles du .env de développement).
const secrets = {
  AUTH_SECRET: "secret-de-test-e2e-assez-long-pour-signer",
  APP_URL: `http://localhost:${port}`,
  // Faux prestataire SMS : les messages vont dans ce fichier (codes de connexion des parents).
  SMS_FAKE_OUTBOX: "test-results/sms-outbox.jsonl",
  // Faux prestataire de paiement : secret des messages de confirmation signés.
  PAYMENT_WEBHOOK_SECRET: "secret-e2e-des-paiements",
};

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // Les tests partagent une base : exécution en série pour ne pas déclencher le verrouillage.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    locale: "fr-FR",
    timezoneId: "Africa/Brazzaville",
    trace: "on-first-retry",
  },
  // Téléphone Android d'entrée de gamme (écran 360 px), cible principale.
  projects: [
    {
      name: "android",
      use: { ...devices["Galaxy S9+"], viewport: { width: 360, height: 740 } },
    },
  ],
  webServer: [
    {
      command: `pnpm build && pnpm start --port ${port}`,
      url: `http://localhost:${port}`,
      reuseExistingServer: false,
      timeout: 180_000,
      // Fichiers envoyés pendant les tests : dossier jetable, ignoré par Git.
      env: { DATABASE_URL: db.app, STORAGE_DIR: "test-results/e2e-storage", ...secrets },
    },
    {
      // Worker des tâches de fond (documents PDF), sur la même base de test.
      command: "pnpm worker",
      // Playwright lance les serveurs avant de préparer la base de test : on attend seulement le
      // démarrage, le worker se branche sur la file dès qu'elle est installée.
      wait: { stdout: /\[worker\] démarré/ },
      reuseExistingServer: false,
      timeout: 60_000,
      env: { DATABASE_URL: db.app, STORAGE_DIR: "test-results/e2e-storage", ...secrets },
    },
  ],
});
