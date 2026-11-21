import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { testDatabaseUrls } from "./tests/integration/urls.ts";

// Le paquet « server-only » lève une erreur hors de Next.js : neutralisé dans les tests.
const serverOnlyStub = fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url));

export default defineConfig({
  resolve: { tsconfigPaths: true, alias: { "server-only": serverOnlyStub } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          // Les tests partagent une même base : un fichier à la fois.
          fileParallelism: false,
          env: (() => {
            const { app, admin } = testDatabaseUrls();
            return {
              DATABASE_URL: app,
              DATABASE_ADMIN_URL: admin,
              // Valeurs propres aux tests (jamais celles du .env de développement).
              AUTH_SECRET: "secret-de-test-integration-assez-long",
              APP_URL: "https://ecole.test",
            };
          })(),
        },
      },
    ],
  },
});
