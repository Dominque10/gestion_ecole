import pg from "pg";
import { e2eDatabaseUrls, E2E_ACCOUNT } from "./env";

export type NotesData = { school: string; year: string; classId: string; subjectId: string };

/**
 * 2026-2027 (en cours, 3 trimestres) : 6e A avec ADA et BOB ; Mathématiques enseignées par le compte
 * de test (directeur et enseignant).
 */
export async function seedNotes(): Promise<NotesData> {
  return withAdmin(async (client) => {
    await client.query("truncate students, guardians, levels, subjects, academic_years cascade");
    const school = (
      await client.query<{ id: string }>("select id from schools where code = $1", [
        E2E_ACCOUNT.schoolCode,
      ])
    ).rows[0].id;
    const teacher = (
      await client.query<{ id: string }>("select id from users where phone = $1", [
        E2E_ACCOUNT.phone,
      ])
    ).rows[0].id;
    const year = (
      await client.query<{ id: string }>(
        `insert into academic_years (school_id, label, start_date, end_date)
         values ($1, '2026-2027', '2026-10-01', '2027-06-30') returning id`,
        [school],
      )
    ).rows[0].id;
    await client.query(
      `insert into periods (school_id, academic_year_id, position, label, start_date, end_date) values
         ($1, $2, 1, 'Trimestre 1', '2026-10-01', '2026-12-31'),
         ($1, $2, 2, 'Trimestre 2', '2027-01-01', '2027-03-31'),
         ($1, $2, 3, 'Trimestre 3', '2027-04-01', '2027-06-30')`,
      [school, year],
    );
    await client.query("update academic_years set status = 'active' where id = $1", [year]);
    const level = (
      await client.query<{ id: string }>(
        "insert into levels (school_id, cycle, name, position) values ($1, 'college', '6e', 1) returning id",
        [school],
      )
    ).rows[0].id;
    const subjectId = (
      await client.query<{ id: string }>(
        "insert into subjects (school_id, name) values ($1, 'Mathématiques') returning id",
        [school],
      )
    ).rows[0].id;
    await client.query(
      `insert into level_subjects (school_id, academic_year_id, level_id, subject_id, coefficient)
       values ($1, $2, $3, $4, 4)`,
      [school, year, level, subjectId],
    );
    const classId = (
      await client.query<{ id: string }>(
        "insert into classes (school_id, academic_year_id, level_id, name) values ($1, $2, $3, '6e A') returning id",
        [school, year, level],
      )
    ).rows[0].id;
    await client.query(
      `insert into class_subjects (school_id, academic_year_id, class_id, subject_id, teacher_id)
       values ($1, $2, $3, $4, $5)`,
      [school, year, classId, subjectId, teacher],
    );
    for (const [i, name] of ["ADA", "BOB"].entries()) {
      const student = (
        await client.query<{ id: string }>(
          `insert into students (school_id, matricule, last_name, first_names, sex, search_text)
           values ($1, $2, $3, 'Test', 'F', lower($3)) returning id`,
          [school, `SJB-26-0000${i + 1}`, name],
        )
      ).rows[0].id;
      await client.query(
        `insert into enrollments (school_id, student_id, academic_year_id, level_id, class_id, status,
           validation_mode, validated_at, entry_date)
         values ($1, $2, $3, $4, $5, 'enrolled', 'manual', now(), '2026-10-01')`,
        [school, student, year, level, classId],
      );
    }
    return { school, year, classId, subjectId };
  });
}

/** Requêtes de contrôle sur la base de test (compte administrateur). */
export async function withAdmin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: e2eDatabaseUrls().admin });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
