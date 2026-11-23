import { defineConfig, devices } from "@playwright/test";

// Test de fumée contre une installation réelle (conteneurs de production, derrière le proxy HTTPS).
// Lancé par la CI (job « docker ») : SMOKE_URL=https://localhost pnpm exec playwright test -c playwright.smoke.config.ts
export default defineConfig({
  testDir: "./tests/smoke",
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.SMOKE_URL ?? "https://localhost",
    // En CI, Caddy sert « localhost » avec son autorité de certification interne.
    ignoreHTTPSErrors: true,
    locale: "fr-FR",
    timezoneId: "Africa/Brazzaville",
  },
  projects: [
    { name: "android", use: { ...devices["Galaxy S9+"], viewport: { width: 360, height: 740 } } },
  ],
});
