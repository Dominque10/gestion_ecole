import { existsSync } from "node:fs";
import { databaseName, withDatabase } from "../../src/server/db/setup.ts";

export const E2E_ACCOUNT = {
  schoolCode: "sjb",
  phone: "+242061234567",
  phoneLocal: "06 123 45 67",
  password: "Mot-de-passe-e2e-2026",
} as const;

/** Comptable de l'école de test (seul rôle qui encaisse). */
export const E2E_ACCOUNTANT = {
  name: "Jean Comptable",
  phone: "+242061112299",
  phoneLocal: "06 111 22 99",
  password: "Comptable-e2e-2026",
} as const;

/** Super-admin de la plateforme (connexion sans code école). */
export const E2E_SUPERADMIN = {
  email: "admin@plateforme.test",
  password: "Super-admin-e2e-2026",
} as const;

export function e2eDatabaseUrls(): { app: string; admin: string } {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const app = process.env.DATABASE_URL;
  const admin = process.env.DATABASE_ADMIN_URL;
  if (!app || !admin) throw new Error("DATABASE_URL et DATABASE_ADMIN_URL sont requis");
  const db = databaseName(admin).replace(/_e2e$/, "") + "_e2e";
  return { app: withDatabase(app, db), admin: withDatabase(admin, db) };
}
