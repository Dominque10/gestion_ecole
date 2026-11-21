// Crée la base et le rôle app_user, puis applique les migrations. Usage : pnpm db:setup
import { existsSync } from "node:fs";
import { ensureDatabase, runMigrations } from "../src/server/db/setup.ts";

if (existsSync(".env")) process.loadEnvFile(".env");

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
if (!adminUrl || !appUrl) {
  console.error("DATABASE_ADMIN_URL et DATABASE_URL sont requis (voir .env.example).");
  process.exit(1);
}

await ensureDatabase(adminUrl, appUrl);
await runMigrations(adminUrl);
console.log("Base prête : rôle app_user en place, migrations appliquées.");
