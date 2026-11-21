import { expect, test } from "@playwright/test";
import pg from "pg";
import { e2eDatabaseUrls, E2E_ACCOUNT } from "./env";

let classId: string;

// 2026-2027 (en cours) : 6e A avec ADA et BOB inscrits ; 2027-2028 en préparation ; niveaux 6e, 5e.
test.beforeEach(async () => {
  const client = new pg.Client({ connectionString: e2eDatabaseUrls().admin });
  await client.connect();
  try {
    await client.query("truncate students, guardians, levels, subjects, academic_years cascade");
    const school = (
      await client.query<{ id: string }>("select id from schools where code = $1", [
        E2E_ACCOUNT.schoolCode,
      ])
    ).rows[0].id;
    const insertYear = async (label: string, start: number) =>
      (
        await client.query<{ id: string }>(
          `insert into academic_years (school_id, label, start_date, end_date)
           values ($1, $2, $3, $4) returning id`,
          [school, label, `${start}-10-01`, `${start + 1}-06-30`],
        )
      ).rows[0].id;
    const y1 = await insertYear("2026-2027", 2026);
    await client.query("update academic_years set status = 'active' where id = $1", [y1]);
    await insertYear("2027-2028", 2027);
    const level = async (name: string, position: number) =>
      (
        await client.query<{ id: string }>(
          "insert into levels (school_id, cycle, name, position) values ($1, 'college', $2, $3) returning id",
          [school, name, position],
        )
      ).rows[0].id;
    const sixieme = await level("6e", 1);
    await level("5e", 2);
    classId = (
      await client.query<{ id: string }>(
        "insert into classes (school_id, academic_year_id, level_id, name) values ($1, $2, $3, '6e A') returning id",
        [school, y1, sixieme],
      )
    ).rows[0].id;
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
        [school, student, y1, sixieme, classId],
      );
    }
  } finally {
    await client.end();
  }
});

test("la 6e A de 2026-2027 est réinscrite en 2027-2028 : ADA passe, BOB redouble", async ({
  page,
}) => {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill(E2E_ACCOUNT.schoolCode);
  await page.getByLabel("Téléphone ou email").fill(E2E_ACCOUNT.phoneLocal);
  await page.getByLabel("Mot de passe").fill(E2E_ACCOUNT.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/accueil$/);

  // La liste de la classe montre ses deux élèves.
  await page.goto(`/parametres/classes/${classId}`);
  await expect(page.getByRole("heading", { name: "Élèves de la classe (2)" })).toBeVisible();

  await page.goto("/inscriptions/reinscription");
  await page
    .getByLabel("Année où réinscrire")
    .selectOption({ label: "2027-2028 (En préparation)" });
  await page.getByLabel("Classe d'origine").selectOption({ label: "2026-2027 · 6e A" });
  await page.getByRole("button", { name: "Afficher les élèves" }).click();

  await expect(page.getByLabel("Décision pour ADA Test")).toHaveValue(/.+/);
  await expect(page.getByLabel("Décision pour ADA Test").locator("option:checked")).toHaveText(
    "Passe en 5e",
  );
  await page.getByLabel("Décision pour BOB Test").selectOption({ label: "Redouble (6e)" });
  await page.getByRole("button", { name: "Préinscrire ces élèves" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "2 élève(s) préinscrit(s). 0 déjà inscrit(s)" }),
  ).toBeVisible();

  await page.goto("/inscriptions");
  await page.getByLabel("Année").selectOption({ label: "2027-2028 (En préparation)" });
  await page.getByRole("button", { name: "Afficher" }).click();
  await expect(page.getByRole("link", { name: "À valider (2)" })).toBeVisible();
  await expect(page.getByRole("link", { name: /ADA Test/ })).toContainText("5e");
  await expect(page.getByRole("link", { name: /BOB Test/ })).toContainText("6e");
});
