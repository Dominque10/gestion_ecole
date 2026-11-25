// Worker des tâches de fond (CLAUDE.md §5). Lancement : pnpm worker
// Produit les documents PDF demandés par l'application (file « documents » de pg-boss) et envoie
// les SMS d'absence aux parents (file « notifications », décision D15).
import { existsSync } from "node:fs";
import { PgBoss } from "pg-boss";
import { closeDb } from "@/server/db/client";
import {
  DOCUMENTS_QUEUE,
  JOB_SCHEMA,
  NOTIFICATIONS_QUEUE,
  PAYMENTS_QUEUE,
} from "@/server/db/setup";
import { checkIntent, reconcileDay } from "@/modules/finance/online";
import { todayInBrazzaville } from "@/lib/dates";
import { processNotice } from "@/modules/notifications/notices";
import { renderDocument } from "@/modules/documents/documents";
import { closePdfBrowser } from "@/modules/documents/pdf";
import { enforceProductionEnv } from "@/server/env";
import { enforceWritableStorage } from "@/server/storage";
import { WORKER_HEARTBEAT_SECONDS, recordWorkerHeartbeat } from "@/server/health";

if (existsSync(".env")) process.loadEnvFile(".env");
enforceProductionEnv("worker");
await enforceWritableStorage("worker");

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
      for (const name of [DOCUMENTS_QUEUE, NOTIFICATIONS_QUEUE, PAYMENTS_QUEUE]) {
        if (!(await queue.getQueue(name))) throw new Error(`file « ${name} » absente`);
      }
      return queue;
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
await boss.work(NOTIFICATIONS_QUEUE, { batchSize: 1, pollingIntervalSeconds: 5 }, async ([job]) => {
  try {
    const outcome = await processNotice(job.data);
    console.log(`[worker] message aux parents ${job.id} : ${outcome}`);
    return { outcome };
  } catch (error) {
    console.error(`[worker] message aux parents ${job.id} en échec :`, (error as Error).message);
    throw error;
  }
});
await boss.work(PAYMENTS_QUEUE, { batchSize: 1, pollingIntervalSeconds: 5 }, async ([job]) => {
  const outcome = await checkIntent(job.data);
  console.log(`[worker] paiement en ligne ${job.id} : ${outcome}`);
  return { outcome };
});

// Réconciliation quotidienne du paiement en ligne : la veille, une fois par jour (vérifié chaque heure).
let reconciledDay = "";
async function reconcileYesterday() {
  const yesterday = todayInBrazzaville(new Date(Date.now() - 24 * 3600 * 1000));
  if (reconciledDay === yesterday) return;
  try {
    const result = await reconcileDay(yesterday);
    reconciledDay = yesterday;
    console.log(
      `[worker] réconciliation du ${yesterday} : ${result.checked} transaction(s), ${result.recovered} rattrapée(s)`,
    );
  } catch (error) {
    console.error("[worker] réconciliation en échec :", (error as Error).message);
  }
}
const reconcileTimer = setInterval(() => void reconcileYesterday(), 3600 * 1000);
void reconcileYesterday();

// Signal de vie, lu par /api/v1/health (mise en service, Sb).
async function heartbeat() {
  try {
    await recordWorkerHeartbeat();
  } catch (error) {
    console.error("[worker] signal de vie en échec :", (error as Error).message);
  }
}
const heartbeatTimer = setInterval(() => void heartbeat(), WORKER_HEARTBEAT_SECONDS * 1000);
await heartbeat();

console.log("[worker] prêt : documents, SMS et paiements en ligne");

async function shutdown() {
  console.log("[worker] arrêt…");
  clearInterval(reconcileTimer);
  clearInterval(heartbeatTimer);
  await boss.stop({ graceful: true, timeout: 10_000 });
  await closePdfBrowser();
  await closeDb();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
