import { defineConfig, devices } from "@playwright/test";

const port = 3100;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
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
    { name: "android", use: { ...devices["Galaxy S9+"], viewport: { width: 360, height: 740 } } },
  ],
  webServer: {
    command: `pnpm build && pnpm start --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
