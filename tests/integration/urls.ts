// URLs de la base de TEST (<base>_test), dérivées de DATABASE_URL / DATABASE_ADMIN_URL.
// Les tests ne touchent jamais la base de développement.
import { existsSync } from "node:fs";
import { databaseName, withDatabase } from "../../src/server/db/setup.ts";

export function testDatabaseUrls(): { app: string; admin: string } {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const app = process.env.DATABASE_URL;
  const admin = process.env.DATABASE_ADMIN_URL;
  if (!app || !admin) {
    throw new Error("DATABASE_URL et DATABASE_ADMIN_URL sont requis pour les tests d'intégration");
  }
  const testDb = databaseName(admin).replace(/_test$/, "") + "_test";
  return { app: withDatabase(app, testDb), admin: withDatabase(admin, testDb) };
}
