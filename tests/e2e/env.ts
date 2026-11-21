import { existsSync } from "node:fs";
import { databaseName, withDatabase } from "../../src/server/db/setup.ts";

export const E2E_ACCOUNT = {
  schoolCode: "sjb",
  phone: "+242061234567",
  phoneLocal: "06 123 45 67",
  password: "Mot-de-passe-e2e-2026",
} as const;

export function e2eDatabaseUrls(): { app: string; admin: string } {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const app = process.env.DATABASE_URL;
  const admin = process.env.DATABASE_ADMIN_URL;
  if (!app || !admin) throw new Error("DATABASE_URL et DATABASE_ADMIN_URL sont requis");
  const db = databaseName(admin).replace(/_e2e$/, "") + "_e2e";
  return { app: withDatabase(app, db), admin: withDatabase(admin, db) };
}
