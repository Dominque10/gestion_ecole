// État de santé du service (mise en service, Sb), pour /api/v1/health et la surveillance externe (Se).
// Réponse publique : uniquement « ok » / « en panne » par élément, aucune donnée ni message d'erreur.
// Éléments : base, file d'attente, worker (dernier passage), dossier des fichiers (écriture possible),
// place libre sur le disque. Interrogée toutes les 5 min par UptimeRobot (Se), qui envoie les alertes.
import "server-only";
import { statfs } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { withPublic } from "@/server/db/client";
import { DOCUMENTS_QUEUE, NOTIFICATIONS_QUEUE, PAYMENTS_QUEUE, getJobQueue } from "@/server/jobs";
import { LocalDiskStorage, storageRoot } from "@/server/storage";

/** Le worker signale son passage toutes les 30 s ; au-delà de 3 min sans nouvelles, il est en panne. */
export const WORKER_HEARTBEAT_SECONDS = 30;
export const WORKER_STALE_SECONDS = 180;

/**
 * Disque : en panne sous 10 % de place libre. Le volume des fichiers est sur le même disque que la
 * base et les journaux (volumes Docker du serveur) : sa place libre vaut pour tout le serveur.
 */
export const MIN_FREE_DISK_RATIO = 0.1;

export type CheckStatus = "ok" | "down";
export type HealthReport = {
  status: "ok" | "degraded";
  checks: {
    database: CheckStatus;
    queue: CheckStatus;
    worker: CheckStatus;
    storage: CheckStatus;
    disk: CheckStatus;
  };
};

/** Une vérification trop lente compte comme une panne (la surveillance ne doit pas rester bloquée). */
async function check(fn: () => Promise<boolean>, timeoutMs = 5000): Promise<CheckStatus> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return (await Promise.race([fn(), timeout])) ? "ok" : "down";
  } catch (error) {
    console.error("[health]", (error as Error).message);
    return "down";
  } finally {
    clearTimeout(timer);
  }
}

/** Le worker est vivant si son dernier passage date de moins de WORKER_STALE_SECONDS. Testée. */
export function workerIsAlive(lastSeen: Date | null, now: Date = new Date()): boolean {
  if (!lastSeen) return false;
  return now.getTime() - lastSeen.getTime() <= WORKER_STALE_SECONDS * 1000;
}

/** Assez de place libre sur le disque ? Testée. */
export function diskHasRoom(stats: { bavail: number; blocks: number }): boolean {
  if (stats.blocks <= 0) return false;
  return stats.bavail / stats.blocks >= MIN_FREE_DISK_RATIO;
}

async function workerLastSeen(): Promise<Date | null> {
  const rows = await withPublic((tx) =>
    tx.execute<{ last_seen: string | Date | null }>(
      sql`select app.worker_last_seen() as last_seen`,
    ),
  );
  const value = rows.rows[0]?.last_seen;
  return value ? new Date(value) : null;
}

export async function healthReport(): Promise<HealthReport> {
  const [database, queue, worker, storage, disk] = await Promise.all([
    check(async () => {
      await withPublic((tx) => tx.execute(sql`select 1`));
      return true;
    }),
    check(async () => {
      const boss = await getJobQueue();
      for (const name of [DOCUMENTS_QUEUE, NOTIFICATIONS_QUEUE, PAYMENTS_QUEUE]) {
        if (!(await boss.getQueue(name))) return false;
      }
      return true;
    }),
    check(async () => workerIsAlive(await workerLastSeen())),
    // Dossier des fichiers inscriptible (volume monté, disque pas plein, droits corrects).
    check(async () => {
      await new LocalDiskStorage(storageRoot()).probe();
      return true;
    }),
    check(async () => diskHasRoom(await statfs(storageRoot()))),
  ]);
  const checks = { database, queue, worker, storage, disk };
  return {
    status: Object.values(checks).every((s) => s === "ok") ? "ok" : "degraded",
    checks,
  };
}

/** Appelé par le worker toutes les WORKER_HEARTBEAT_SECONDS. */
export async function recordWorkerHeartbeat(): Promise<void> {
  await withPublic((tx) => tx.execute(sql`select app.record_worker_heartbeat()`));
}
