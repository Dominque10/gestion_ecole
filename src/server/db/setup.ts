// Préparation de la base : création de la base, du rôle applicatif et application des migrations.
// Utilisé par scripts/db-*.ts et par les tests d'intégration. Pas d'alias « @/ » ici :
// ce fichier est aussi exécuté directement par Node.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/** Nom imposé du rôle applicatif : les migrations lui accordent les droits. */
export const APP_ROLE = "app_user";

function databaseName(url: string): string {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name) throw new Error(`Nom de base absent de l'URL : ${url}`);
  return decodeURIComponent(name);
}

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(database)}`;
  return u.toString();
}

/**
 * Crée la base (si besoin) et le rôle applicatif app_user, sans super-pouvoirs :
 * ni superutilisateur, ni BYPASSRLS. Idempotent.
 */
export async function ensureDatabase(adminUrl: string, appUrl: string): Promise<void> {
  const app = new URL(appUrl);
  const role = decodeURIComponent(app.username);
  const password = decodeURIComponent(app.password);
  if (role !== APP_ROLE) {
    throw new Error(`DATABASE_URL doit utiliser le rôle « ${APP_ROLE} » (reçu « ${role} »)`);
  }
  if (!password) throw new Error("DATABASE_URL doit contenir un mot de passe");
  const dbName = databaseName(adminUrl);

  const client = new pg.Client({ connectionString: withDatabase(adminUrl, "postgres") });
  await client.connect();
  try {
    const exists = await client.query("select 1 from pg_database where datname = $1", [dbName]);
    if (exists.rowCount === 0) {
      await client.query(`create database ${client.escapeIdentifier(dbName)}`);
    }
    const roleExists = await client.query("select 1 from pg_roles where rolname = $1", [role]);
    const verb = roleExists.rowCount === 0 ? "create" : "alter";
    await client.query(
      `${verb} role ${client.escapeIdentifier(role)} login nosuperuser nobypassrls nocreatedb nocreaterole password ${client.escapeLiteral(password)}`,
    );
    await client.query(
      `grant connect on database ${client.escapeIdentifier(dbName)} to ${client.escapeIdentifier(role)}`,
    );
  } finally {
    await client.end();
  }
}

/** Applique les migrations du dossier drizzle/ avec le compte administrateur. */
export async function runMigrations(adminUrl: string, migrationsFolder = "drizzle"): Promise<void> {
  const pool = new pg.Pool({ connectionString: adminUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

export { databaseName, withDatabase };

/** File d'attente des tâches de fond (pg-boss) : schéma « pgboss », dans la même base. */
export const JOB_SCHEMA = "pgboss";
export const DOCUMENTS_QUEUE = "documents";
/** Messages aux parents (SMS d'absence, décision D15). */
export const NOTIFICATIONS_QUEUE = "notifications";
/** Paiement en ligne : interrogation du prestataire quand la confirmation tarde (4c). */
export const PAYMENTS_QUEUE = "payments";

/**
 * Installe ou met à jour la file d'attente pg-boss avec le compte administrateur, puis donne au rôle
 * applicatif les seuls droits d'usage (il n'est propriétaire de rien, comme pour les tables métier).
 */
export async function setupJobQueue(adminUrl: string): Promise<void> {
  const { PgBoss } = await import("pg-boss");
  const boss = new PgBoss({
    connectionString: adminUrl,
    schema: JOB_SCHEMA,
    migrate: true,
    supervise: false,
    schedule: false,
  });
  boss.on("error", () => undefined);
  await boss.start();
  try {
    if (!(await boss.getQueue(DOCUMENTS_QUEUE))) {
      // Le PDF produit voyage dans le résultat de la tâche, effacé 1 h après : aucun document
      // concernant des mineurs ne s'accumule sur le serveur. Rendu bloqué : abandonné après 2 min ;
      // demande non prise par le worker en 10 min : abandonnée.
      await boss.createQueue(DOCUMENTS_QUEUE, {
        retryLimit: 1,
        expireInSeconds: 120,
        retentionSeconds: 600,
        deleteAfterSeconds: 3600,
      });
    }
    if (!(await boss.getQueue(NOTIFICATIONS_QUEUE))) {
      // Prestataire SMS indisponible : 3 nouveaux essais, espacés de 5 min, le jour même.
      // Une seule tâche en attente par élève et par jour (clé « inscription:jour »).
      await boss.createQueue(NOTIFICATIONS_QUEUE, {
        policy: "short",
        retryLimit: 3,
        retryDelay: 300,
        expireInSeconds: 120,
        retentionSeconds: 24 * 3600,
        deleteAfterSeconds: 7 * 24 * 3600,
      });
    }
    if (!(await boss.getQueue(PAYMENTS_QUEUE))) {
      await boss.createQueue(PAYMENTS_QUEUE, {
        retryLimit: 3,
        retryDelay: 120,
        expireInSeconds: 120,
        retentionSeconds: 24 * 3600,
        deleteAfterSeconds: 30 * 24 * 3600,
      });
    }
  } finally {
    await boss.stop({ graceful: false });
  }
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const role = client.escapeIdentifier(APP_ROLE);
    const schema = client.escapeIdentifier(JOB_SCHEMA);
    await client.query(`grant usage on schema ${schema} to ${role}`);
    await client.query(
      `grant select, insert, update, delete on all tables in schema ${schema} to ${role}`,
    );
    await client.query(`grant usage, select on all sequences in schema ${schema} to ${role}`);
    await client.query(`grant execute on all functions in schema ${schema} to ${role}`);
  } finally {
    await client.end();
  }
}
