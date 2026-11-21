import { defineConfig, devices } from "@playwright/test";
import { e2eDatabaseUrls } from "./tests/e2e/env";

const port = 3100;
const db = e2eDatabaseUrls();

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
  webServer: {
    command: `pnpm build && pnpm start --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 180_000,
    // Fichiers envoyés pendant les tests : dossier jetable, ignoré par Git.
    env: { DATABASE_URL: db.app, STORAGE_DIR: "test-results/e2e-storage" },
  },
});
