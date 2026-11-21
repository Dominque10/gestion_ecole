import { eq, sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, withPlatform, withSchool } from "@/server/db/client";
import { auditLogs, memberships, schools, users } from "@/server/db/schema";
import { adminQuery, createSchoolWithDirector, createSuperadmin, resetDatabase } from "./helpers";

/** Tables autorisées SANS school_id. Toute autre table doit avoir school_id + RLS. */
const TABLES_WITHOUT_SCHOOL_ID = new Set([
  "schools", // l'école elle-même (RLS sur id)
  "users", // compte commun à la plateforme (cahier des charges §8)
]);

/** Politiques autorisées à ne PAS dépendre de l'école de session (justifiées une par une). */
const POLICIES_WITHOUT_SCHOOL = new Set([
  "schools_insert", // seule la plateforme crée une école : il n'existe pas encore d'école de session
]);

/** Vérifie qu'une erreur PostgreSQL (éventuellement enveloppée par Drizzle) correspond au motif. */
async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "une erreur de la base était attendue").not.toBeNull();
  const e = error as { message?: string; cause?: { message?: string } };
  expect(`${e.message ?? ""} ${e.cause?.message ?? ""}`).toMatch(pattern);
}

const RLS_DENIED = /row-level security/;
const PERMISSION_DENIED = /permission denied/;

describe("Garde-fou générique : structure de la base", () => {
  it("le rôle applicatif n'est ni superutilisateur ni dispensé de RLS", async () => {
    const { rows } = await adminQuery<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "select rolsuper, rolbypassrls from pg_roles where rolname = 'app_user'",
    );
    expect(rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
  });

  it("le rôle applicatif n'est propriétaire d'aucune table (sinon la RLS ne s'appliquerait pas)", async () => {
    const { rows } = await adminQuery(
      "select tablename from pg_tables where schemaname = 'public' and tableowner = 'app_user'",
    );
    expect(rows).toEqual([]);
  });

  it("toute table sans school_id figure dans la liste autorisée", async () => {
    const { rows } = await adminQuery<{ table_name: string }>(`
      select t.table_name from information_schema.tables t
      where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
        and not exists (
          select 1 from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = 'school_id')`);
    const unexpected = rows
      .map((r) => r.table_name)
      .filter((t) => !TABLES_WITHOUT_SCHOOL_ID.has(t));
    expect(unexpected, "tables sans school_id non autorisées").toEqual([]);
  });

  it("toute table avec school_id a la RLS activée, forcée, et des politiques fondées sur l'école", async () => {
    const { rows } = await adminQuery<{
      table_name: string;
      rls: boolean;
      forced: boolean;
      policies: number;
      policies_without_school: number;
    }>(
      `
      select c.relname as table_name, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
        (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies,
        (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
           and p.policyname <> all($1::text[])
           and coalesce(p.qual, '') || coalesce(p.with_check, '') not like '%current_school_id()%') as policies_without_school
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where c.relkind = 'r'
        and (c.relname = 'schools' or exists (
          select 1 from information_schema.columns col
          where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'school_id'))`,
      [[...POLICIES_WITHOUT_SCHOOL]],
    );
    expect(rows.length).toBeGreaterThan(0);
    const problems = rows
      .filter((r) => !r.rls || !r.forced || r.policies === 0 || r.policies_without_school > 0)
      .map((r) => r.table_name);
    expect(problems, "tables mal protégées").toEqual([]);
  });
});

describe("Isolation entre deux écoles", () => {
  let superadminId: string;
  let a: { schoolId: string; directorId: string };
  let b: { schoolId: string; directorId: string };
  const ctxA = () => ({ schoolId: a.schoolId, userId: a.directorId });

  beforeAll(async () => {
    await resetDatabase();
    superadminId = await createSuperadmin();
    a = await createSchoolWithDirector(superadminId, "ecolea");
    b = await createSchoolWithDirector(superadminId, "ecoleb");
    await withSchool({ schoolId: b.schoolId, userId: b.directorId }, (tx) =>
      tx.insert(auditLogs).values({
        schoolId: b.schoolId,
        actorUserId: b.directorId,
        action: "test",
        entityType: "school",
      }),
    );
  });

  afterAll(async () => {
    await closeDb();
  });

  it("une école ne voit que sa propre fiche", async () => {
    const rows = await withSchool(ctxA(), (tx) => tx.select({ id: schools.id }).from(schools));
    expect(rows).toEqual([{ id: a.schoolId }]);
  });

  it("une école ne voit que ses propres appartenances", async () => {
    const rows = await withSchool(ctxA(), (tx) =>
      tx.select({ schoolId: memberships.schoolId }).from(memberships),
    );
    expect(rows).toEqual([{ schoolId: a.schoolId }]);
  });

  it("une école ne peut ni modifier ni supprimer les données d'une autre", async () => {
    const updated = await withSchool(ctxA(), (tx) =>
      tx
        .update(memberships)
        .set({ roles: ["teacher"] })
        .where(eq(memberships.schoolId, b.schoolId))
        .returning(),
    );
    const deleted = await withSchool(ctxA(), (tx) =>
      tx.delete(memberships).where(eq(memberships.schoolId, b.schoolId)).returning(),
    );
    const renamed = await withSchool(ctxA(), (tx) =>
      tx.update(schools).set({ name: "Piratée" }).where(eq(schools.id, b.schoolId)).returning(),
    );
    expect([updated, deleted, renamed]).toEqual([[], [], []]);

    const { rows } = await adminQuery<{ roles: string; name: string }>(
      "select m.roles::text as roles, s.name from memberships m join schools s on s.id = m.school_id where s.id = $1",
      [b.schoolId],
    );
    expect(rows).toEqual([{ roles: "{director}", name: "École ecoleb" }]);
  });

  it("une école ne peut pas écrire une ligne au nom d'une autre", async () => {
    await expectDbError(
      withSchool(ctxA(), (tx) =>
        tx
          .insert(memberships)
          .values({ schoolId: b.schoolId, userId: a.directorId, roles: ["teacher"] }),
      ),
      RLS_DENIED,
    );
  });

  it("une école ne peut pas créer d'établissement", async () => {
    await expectDbError(
      withSchool(ctxA(), (tx) =>
        tx.insert(schools).values({ name: "Clone", code: "clone", matriculePrefix: "CLO" }),
      ),
      RLS_DENIED,
    );
  });

  it("sans école de session, aucune donnée d'école n'est visible", async () => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const m = await client.query("select count(*)::int as n from memberships");
      const s = await client.query("select count(*)::int as n from schools");
      const l = await client.query("select count(*)::int as n from audit_logs");
      expect([m.rows[0].n, s.rows[0].n, l.rows[0].n]).toEqual([0, 0, 0]);
    } finally {
      await client.end();
    }
  });

  it("la plateforme ne lit pas le journal d'audit des écoles", async () => {
    const rows = await withPlatform(superadminId, (tx) => tx.select().from(auditLogs));
    expect(rows).toEqual([]);
  });

  it("une école ne voit pas le journal d'audit d'une autre", async () => {
    const rows = await withSchool(ctxA(), (tx) => tx.select().from(auditLogs));
    expect(rows).toEqual([]);
  });

  it("le journal d'audit est en ajout seul", async () => {
    await withSchool(ctxA(), (tx) =>
      tx.insert(auditLogs).values({
        schoolId: a.schoolId,
        actorUserId: a.directorId,
        action: "test",
        entityType: "school",
      }),
    );
    await expectDbError(
      withSchool(ctxA(), (tx) => tx.update(auditLogs).set({ action: "falsifié" })),
      PERMISSION_DENIED,
    );
    await expectDbError(
      withSchool(ctxA(), (tx) => tx.delete(auditLogs)),
      PERMISSION_DENIED,
    );
    // Même le compte administrateur ne peut pas modifier le journal (déclencheur).
    await expectDbError(adminQuery("update audit_logs set action = 'falsifié'"), /ajout seul/);
  });

  it("le contexte d'école est bien local à la transaction", async () => {
    await withSchool(ctxA(), async () => undefined);
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query("select app.current_school_id() as id");
      expect(rows[0].id).toBeNull();
    } finally {
      await client.end();
    }
  });

  it("refuse un identifiant d'école invalide avant toute requête", async () => {
    await expect(
      withSchool({ schoolId: "x' or 1=1 --", userId: a.directorId }, async (tx) =>
        tx.execute(sql`select 1`),
      ),
    ).rejects.toThrow();
  });

  it("les utilisateurs (table commune) restent lisibles pour la connexion", async () => {
    const rows = await withSchool(ctxA(), (tx) =>
      tx.select({ id: users.id }).from(users).where(eq(users.id, b.directorId)),
    );
    expect(rows).toHaveLength(1);
  });
});
