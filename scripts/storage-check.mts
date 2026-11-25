// Vérifie que les fichiers stockés correspondent à la base (mise en service, Sc). Usage :
//   pnpm storage:check                    rapport : fichiers manquants, fichiers orphelins
//   pnpm storage:check --delete-orphans   supprime aussi les orphelins de plus de 24 h
// En production : docker compose ... run --rm app node scripts/storage-check.mts
// Code de sortie 1 s'il manque des fichiers (après une restauration : sauvegarde des fichiers incomplète).
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import pg from "pg";
import {
  compareStorage,
  FILE_KEY_QUERY,
  ORPHAN_MIN_AGE_HOURS,
} from "../src/server/storage/check.ts";
import { LocalDiskStorage, storageRoot } from "../src/server/storage/index.ts";

if (existsSync(".env")) process.loadEnvFile(".env");

const { values } = parseArgs({
  options: { "delete-orphans": { type: "boolean", default: false } },
});
const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) {
  console.error("DATABASE_ADMIN_URL manquant (voir .env.example)");
  process.exit(1);
}

const root = storageRoot();
const storage = new LocalDiskStorage(root);
const client = new pg.Client({ connectionString: adminUrl });
await client.connect();
let keys: string[];
try {
  keys = (await client.query<{ key: string }>(FILE_KEY_QUERY)).rows.map((r) => r.key);
} finally {
  await client.end();
}

const report = compareStorage(keys, await storage.list());
console.log(`Dossier de stockage : ${root}`);
console.log(`Fichiers présents et référencés : ${report.ok}`);
console.log(`Fichiers manquants : ${report.missing.length}`);
for (const key of report.missing) console.log(`  - ${key}`);
console.log(`Fichiers orphelins (plus de ${ORPHAN_MIN_AGE_HOURS} h) : ${report.orphans.length}`);
for (const key of report.orphans) console.log(`  - ${key}`);
if (report.recentOrphans.length > 0) {
  console.log(
    `Fichiers orphelins récents, laissés en place (envoi peut-être en cours) : ${report.recentOrphans.length}`,
  );
}

if (values["delete-orphans"] && report.orphans.length > 0) {
  for (const key of report.orphans) await storage.delete(key);
  console.log(`${report.orphans.length} fichier(s) orphelin(s) supprimé(s).`);
} else if (report.orphans.length > 0) {
  console.log("Pour les supprimer : pnpm storage:check --delete-orphans");
}

process.exit(report.missing.length > 0 ? 1 : 0);
