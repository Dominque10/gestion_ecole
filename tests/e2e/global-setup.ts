// Base dédiée aux tests de bout en bout (<base>_e2e) : migrée, vidée, puis préremplie.
import { hash } from "@node-rs/argon2";
import pg from "pg";
import { ensureDatabase, runMigrations, setupJobQueue } from "../../src/server/db/setup.ts";
import { e2eDatabaseUrls, E2E_ACCOUNT, E2E_SUPERADMIN } from "./env.ts";

export default async function setup(): Promise<void> {
  const { app, admin } = e2eDatabaseUrls();
  await ensureDatabase(admin, app);
  await runMigrations(admin);
  await setupJobQueue(admin);

  const client = new pg.Client({ connectionString: admin });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public'",
    );
    await client.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} cascade`);
    const passwordHash = await hash(E2E_ACCOUNT.password);
    const school = await client.query<{ id: string }>(
      "insert into schools (name, code, matricule_prefix) values ('École Saint-Jean', $1, 'SJB') returning id",
      [E2E_ACCOUNT.schoolCode],
    );
    const user = await client.query<{ id: string }>(
      "insert into users (name, phone, password_hash) values ('Marie Mabiala', $1, $2) returning id",
      [E2E_ACCOUNT.phone, passwordHash],
    );
    await client.query(
      "insert into memberships (school_id, user_id, roles) values ($1, $2, '{director,teacher}')",
      [school.rows[0].id, user.rows[0].id],
    );
    await client.query(
      "insert into users (name, email, is_superadmin, password_hash) values ('Admin Plateforme', $1, true, $2)",
      [E2E_SUPERADMIN.email, await hash(E2E_SUPERADMIN.password)],
    );
  } finally {
    await client.end();
  }
}
