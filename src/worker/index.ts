// Worker des tâches de fond (CLAUDE.md §5). Lancement : pnpm worker
// Produit les documents PDF demandés par l'application (file « documents » de pg-boss).
import { existsSync } from "node:fs";
import { PgBoss } from "pg-boss";
import { closeDb } from "@/server/db/client";
import { DOCUMENTS_QUEUE, JOB_SCHEMA } from "@/server/db/setup";
import { renderDocument } from "@/modules/documents/documents";
import { closePdfBrowser } from "@/modules/documents/pdf";

if (existsSync(".env")) process.loadEnvFile(".env");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquant (voir .env.example)");
  process.exit(1);
}

/**
 * Démarrage patient : la base (ou la file d'attente, installée par « pnpm db:setup ») peut ne pas
 * être prête quand le worker démarre (démarrage du serveur, tests). On réessaie pendant 2 minutes.
 */
async function startQueue(): Promise<PgBoss> {
  for (let attempt = 1; ; attempt++) {
    // Rôle app_user : le worker est soumis à la RLS comme l'application.
    const queue = new PgBoss({
      connectionString: url,
      schema: JOB_SCHEMA,
      migrate: false,
      schedule: false,
    });
    queue.on("error", (error) => console.error("[worker] pg-boss :", error.message));
    try {
      await queue.start();
      if (await queue.getQueue(DOCUMENTS_QUEUE)) return queue;
      throw new Error(`file « ${DOCUMENTS_QUEUE} » absente`);
    } catch (error) {
      await queue.stop({ graceful: false }).catch(() => undefined);
      if (attempt >= 60) throw error;
      if (attempt === 1) {
        console.log(`[worker] base pas encore prête (${(error as Error).message}), nouvel essai…`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

console.log("[worker] démarré");
const boss = await startQueue();

await boss.work(DOCUMENTS_QUEUE, { batchSize: 1, pollingIntervalSeconds: 1 }, async ([job]) => {
  const started = Date.now();
  try {
    const result = await renderDocument(job.data);
    console.log(`[worker] document ${job.id} prêt en ${Date.now() - started} ms`);
    return result;
  } catch (error) {
    console.error(`[worker] document ${job.id} en échec :`, (error as Error).message);
    throw error;
  }
});
console.log("[worker] prêt : en attente de documents à produire");

async function shutdown() {
  console.log("[worker] arrêt…");
  await boss.stop({ graceful: true, timeout: 10_000 });
  await closePdfBrowser();
  await closeDb();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
