// Mise en service, sous-étape Sc — la vérification du stockage lit bien toutes les colonnes de fichiers.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db/client";
import { FILE_KEY_QUERY } from "@/server/storage/check";
import { adminQuery, createSchoolWithDirector, createSuperadmin, resetDatabase } from "./helpers";

let schoolId: string;

beforeAll(async () => {
  await resetDatabase();
  ({ schoolId } = await createSchoolWithDirector(await createSuperadmin(), "stk"));
});

afterAll(async () => {
  await closeDb();
});

describe("FILE_KEY_QUERY", () => {
  it("renvoie les fichiers de l'école (logo, cachet, signature)", async () => {
    await adminQuery(
      "update schools set logo_key = $2, stamp_key = $3, signature_key = null where id = $1",
      [schoolId, `schools/${schoolId}/logo-1.png`, `schools/${schoolId}/stamp-1.png`],
    );
    const { rows } = await adminQuery<{ key: string }>(FILE_KEY_QUERY);
    expect(rows.map((r) => r.key).sort()).toEqual([
      `schools/${schoolId}/logo-1.png`,
      `schools/${schoolId}/stamp-1.png`,
    ]);
  });

  it("couvre toutes les colonnes de la base qui désignent un fichier", async () => {
    // Toute nouvelle colonne « *_key » doit être ajoutée à FILE_KEY_QUERY (sinon : faux orphelins).
    const { rows } = await adminQuery<{ col: string }>(
      `select table_name || '.' || column_name as col from information_schema.columns
       where table_schema = 'public' and column_name like '%\\_key' order by 1`,
    );
    expect(rows.map((r) => r.col)).toEqual([
      "schools.logo_key",
      "schools.signature_key",
      "schools.stamp_key",
      "student_documents.file_key",
      "students.photo_key",
    ]);
  });
});
