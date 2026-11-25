// Mise en service, sous-étape Sb — état de santé : base, file d'attente, dernier passage du worker.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db/client";
import {
  WORKER_STALE_SECONDS,
  diskHasRoom,
  healthReport,
  recordWorkerHeartbeat,
  workerIsAlive,
} from "@/server/health";
import { closeJobQueue } from "@/server/jobs";
import { adminQuery } from "./helpers";

afterAll(async () => {
  await closeJobQueue();
  await closeDb();
});

beforeEach(async () => {
  await adminQuery("delete from app.worker_heartbeat");
});

describe("workerIsAlive", () => {
  const now = new Date("2026-11-25T10:00:00Z");
  it("vivant si le dernier passage date de moins de 3 minutes", () => {
    expect(workerIsAlive(new Date(now.getTime() - 10_000), now)).toBe(true);
    expect(workerIsAlive(new Date(now.getTime() - WORKER_STALE_SECONDS * 1000), now)).toBe(true);
  });
  it("en panne au-delà, ou s'il n'est jamais passé", () => {
    expect(workerIsAlive(new Date(now.getTime() - WORKER_STALE_SECONDS * 1000 - 1), now)).toBe(
      false,
    );
    expect(workerIsAlive(null, now)).toBe(false);
  });
});

describe("diskHasRoom", () => {
  it("en panne sous 10 % de place libre", () => {
    expect(diskHasRoom({ bavail: 100, blocks: 1000 })).toBe(true);
    expect(diskHasRoom({ bavail: 99, blocks: 1000 })).toBe(false);
    expect(diskHasRoom({ bavail: 0, blocks: 0 })).toBe(false);
  });
});

describe("healthReport", () => {
  it("signale le worker en panne tant qu'il n'est jamais passé", async () => {
    expect(await healthReport()).toEqual({
      status: "degraded",
      checks: { database: "ok", queue: "ok", worker: "down", storage: "ok", disk: "ok" },
    });
  });

  it("tout est au vert après un passage du worker", async () => {
    await recordWorkerHeartbeat();
    await recordWorkerHeartbeat(); // une seule ligne, mise à jour
    const { rows } = await adminQuery<{ n: number }>(
      "select count(*)::int as n from app.worker_heartbeat",
    );
    expect(rows[0].n).toBe(1);
    expect(await healthReport()).toEqual({
      status: "ok",
      checks: { database: "ok", queue: "ok", worker: "ok", storage: "ok", disk: "ok" },
    });
  });

  it("le worker redevient en panne si son dernier passage est trop ancien", async () => {
    await recordWorkerHeartbeat();
    await adminQuery(
      `update app.worker_heartbeat set last_seen_at = now() - interval '${WORKER_STALE_SECONDS + 60} seconds'`,
    );
    expect((await healthReport()).checks.worker).toBe("down");
  });
});

describe("dossier des fichiers", () => {
  it("signalé en panne s'il n'accepte pas l'écriture (volume mal monté)", async () => {
    const previous = process.env.STORAGE_DIR;
    // Un fichier existant à la place du dossier.
    process.env.STORAGE_DIR = "package.json";
    try {
      expect((await healthReport()).checks.storage).toBe("down");
    } finally {
      if (previous === undefined) delete process.env.STORAGE_DIR;
      else process.env.STORAGE_DIR = previous;
    }
  });
});

describe("droits de app_user sur la table du worker", () => {
  it("aucun accès direct : uniquement par les deux fonctions", async () => {
    const { rows } = await adminQuery<{ select: boolean; update: boolean }>(
      `select has_table_privilege('app_user', 'app.worker_heartbeat', 'SELECT') as select,
              has_table_privilege('app_user', 'app.worker_heartbeat', 'UPDATE') as update`,
    );
    expect(rows[0]).toEqual({ select: false, update: false });
  });
});
