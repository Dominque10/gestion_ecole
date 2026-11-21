import "server-only";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { z } from "zod";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { __db?: Db; __pool?: pg.Pool };

/** Connexion de l'application, avec le rôle app_user (soumis à la RLS). */
function getDb(): Db {
  if (globalForDb.__db) return globalForDb.__db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL manquant (voir .env.example)");
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  globalForDb.__pool = pool;
  globalForDb.__db = drizzle(pool, { schema });
  return globalForDb.__db;
}

const uuid = z.uuid();

export type SchoolContext = { schoolId: string; userId: string };

/**
 * Seul point d'entrée pour toute donnée d'une école.
 * Ouvre une transaction et fixe l'école et l'utilisateur de la session (équivalent de SET LOCAL) :
 * la RLS de PostgreSQL ne laisse alors voir que les lignes de cette école.
 */
export async function withSchool<T>(ctx: SchoolContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const schoolId = uuid.parse(ctx.schoolId);
  const userId = uuid.parse(ctx.userId);
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_school_id', ${schoolId}, true), set_config('app.current_user_id', ${userId}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Actions de plateforme du super-admin (créer une école, son premier directeur).
 * Ne donne accès à AUCUNE donnée métier d'une école : les tables métier exigent une école de session.
 */
export async function withPlatform<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const id = uuid.parse(userId);
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.platform', 'on', true), set_config('app.current_user_id', ${id}, true)`,
    );
    return fn(tx);
  });
}

/** Fermeture du pool (tests, arrêt propre du worker). */
export async function closeDb(): Promise<void> {
  await globalForDb.__pool?.end();
  globalForDb.__pool = undefined;
  globalForDb.__db = undefined;
}
