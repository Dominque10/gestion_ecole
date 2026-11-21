import pg from "pg";
import { withPlatform } from "@/server/db/client";
import { memberships, schools, users } from "@/server/db/schema";

/** Connexion administrateur à la base de test (nettoyage, inspection du catalogue). */
export async function adminQuery<T extends pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await client.connect();
  try {
    return await client.query<T>(text, values);
  } finally {
    await client.end();
  }
}

/** Vide toutes les tables de l'application (TRUNCATE contourne le déclencheur d'audit, voulu ici). */
export async function resetDatabase(): Promise<void> {
  const { rows } = await adminQuery<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  if (rows.length === 0) return;
  await adminQuery(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} cascade`);
}

/** Crée un super-admin directement (comme le ferait le script d'amorçage de la plateforme). */
export async function createSuperadmin(): Promise<string> {
  const { rows } = await adminQuery<{ id: string }>(
    "insert into users (name, email, is_superadmin) values ('Super Admin', $1, true) returning id",
    [`admin-${crypto.randomUUID()}@test.local`],
  );
  return rows[0].id;
}

/** Crée une école et son directeur via le contexte plateforme. */
export async function createSchoolWithDirector(
  superadminId: string,
  code: string,
): Promise<{ schoolId: string; directorId: string }> {
  return withPlatform(superadminId, async (tx) => {
    const [school] = await tx
      .insert(schools)
      .values({ name: `École ${code}`, code, matriculePrefix: code.toUpperCase() })
      .returning({ id: schools.id });
    const [director] = await tx
      .insert(users)
      .values({
        name: `Directeur ${code}`,
        phone: `+24206${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
      })
      .returning({ id: users.id });
    await tx
      .insert(memberships)
      .values({ schoolId: school.id, userId: director.id, roles: ["director"] });
    return { schoolId: school.id, directorId: director.id };
  });
}
