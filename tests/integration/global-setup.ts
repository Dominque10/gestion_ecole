import { ensureDatabase, runMigrations, setupJobQueue } from "../../src/server/db/setup.ts";
import { testDatabaseUrls } from "./urls.ts";

/** Avant les tests d'intégration : base de test créée, rôle app_user en place, migrations à jour. */
export default async function setup(): Promise<void> {
  const { app, admin } = testDatabaseUrls();
  await ensureDatabase(admin, app);
  await runMigrations(admin);
  await setupJobQueue(admin);
}
