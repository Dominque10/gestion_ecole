import { expect, test } from "@playwright/test";
import pg from "pg";
import { e2eDatabaseUrls, E2E_ACCOUNT } from "./env";

// 2026-2027 (en cours, 3 trimestres) : 6e A avec ADA et BOB ; Mathématiques enseignées par le compte
// de test (directeur et enseignant).
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
    const subject = (
      await client.query<{ id: string }>(
        "insert into subjects (school_id, name) values ($1, 'Mathématiques') returning id",
        [school],
      )
    ).rows[0].id;
    await client.query(
      `insert into level_subjects (school_id, academic_year_id, level_id, subject_id, coefficient)
       values ($1, $2, $3, $4, 4)`,
      [school, year, level, subject],
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
      [school, year, classId, subject, teacher],
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
  } finally {
    await client.end();
  }
});

test("l'enseignant crée un devoir et saisit les notes au clavier ; une note invalide est signalée", async ({
  page,
}) => {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill(E2E_ACCOUNT.schoolCode);
  await page.getByLabel("Téléphone ou email").fill(E2E_ACCOUNT.phoneLocal);
  await page.getByLabel("Mot de passe").fill(E2E_ACCOUNT.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/accueil$/);

  await page.getByRole("link", { name: "Notes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "6e A" })).toBeVisible();
  await page.getByRole("link", { name: /Mathématiques/ }).click();
  await expect(page.getByRole("heading", { name: "Mathématiques — 6e A" })).toBeVisible();
  await expect(page.getByText("Aucune évaluation pour cette période.")).toBeVisible();

  // Nouvelle évaluation : un devoir noté sur 20 (barème proposé).
  await expect(page.getByLabel("Noté sur")).toHaveValue("20");
  await page.getByRole("radio", { name: "Devoir" }).check();
  await page.getByLabel("Date").fill("2026-11-10");
  await page.getByLabel("Intitulé (facultatif)").fill("Fractions");
  await page.getByRole("button", { name: "Créer et saisir les notes" }).click();
  await expect(page).toHaveURL(/\/notes\/evaluation\//);
  await expect(page.getByRole("heading", { name: "Devoir du 10 nov. 2026" })).toBeVisible();

  // Saisie au clavier : Entrée passe à l'élève suivant ; 25 dépasse le barème.
  const ada = page.getByRole("textbox", { name: "Note de ADA Test" });
  const bob = page.getByRole("textbox", { name: "Note de BOB Test" });
  await ada.fill("12,5");
  await ada.press("Enter");
  await expect(bob).toBeFocused();
  await bob.fill("25");
  await expect(page.getByText("Note au-dessus du barème")).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer les notes" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Corrigez les cases signalées");

  // BOB est marqué absent avec le bouton ; enregistrement, puis relecture après rechargement.
  await page.getByRole("button", { name: "Marquer BOB Test absent" }).click();
  await expect(bob).toHaveValue("a");
  await page.getByRole("button", { name: "Enregistrer les notes" }).click();
  await expect(page.locator("p[role=status]")).toContainText("2 note(s) enregistrée(s).");
  await page.reload();
  await expect(ada).toHaveValue("12,5");
  await expect(bob).toHaveValue("a");
  await expect(page.getByText("2 sur 2 saisies")).toBeVisible();

  // La liste des évaluations de la période montre le devoir.
  await page.getByRole("link", { name: "Retour aux évaluations" }).click();
  await expect(page.getByRole("link", { name: /Devoir — 10 nov\. 2026/ })).toContainText(
    "2 sur 2 saisies",
  );
});
