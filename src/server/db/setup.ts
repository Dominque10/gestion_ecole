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
