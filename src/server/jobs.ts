import "server-only";
import { PgBoss } from "pg-boss";
import {
  DOCUMENTS_QUEUE,
  JOB_SCHEMA,
  NOTIFICATIONS_QUEUE,
  PAYMENTS_QUEUE,
} from "@/server/db/setup";

export { DOCUMENTS_QUEUE, NOTIFICATIONS_QUEUE, PAYMENTS_QUEUE };

const globalForJobs = globalThis as unknown as { __boss?: Promise<PgBoss> };

/**
 * File d'attente côté application (rôle app_user) : sert à déposer des tâches et à lire leur état.
 * Ni migration, ni maintenance ici : la préparation de la base et le worker s'en chargent.
 */
export function getJobQueue(): Promise<PgBoss> {
  globalForJobs.__boss ??= (async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL manquant (voir .env.example)");
    const boss = new PgBoss({
      connectionString: url,
      schema: JOB_SCHEMA,
      migrate: false,
      supervise: false,
      schedule: false,
      max: 2,
    });
    boss.on("error", (error) => console.error("pg-boss", error));
    await boss.start();
    return boss;
  })();
  return globalForJobs.__boss;
}

/** Arrêt propre (tests). */
export async function closeJobQueue(): Promise<void> {
  const boss = await globalForJobs.__boss;
  globalForJobs.__boss = undefined;
  await boss?.stop({ graceful: false });
}
