import { expect, test } from "@playwright/test";
import { E2E_ACCOUNT } from "./env";
import { seedNotes, withAdmin, type NotesData } from "./notes-data";

let data: NotesData;

// 6e A (Mathématiques seule) : composition du trimestre 1, ADA 16, BOB 9 ; le compte de test est
// directeur et professeur de mathématiques.
test.beforeEach(async () => {
  data = await seedNotes();
  await withAdmin(async (client) => {
    const { rows } = await client.query<{ teacher: string; period: string }>(
      `select cs.teacher_id as teacher,
              (select id from periods where academic_year_id = $1 and position = 1) as period
       from class_subjects cs where cs.class_id = $2`,
      [data.year, data.classId],
    );
    const evaluation = await client.query<{ id: string }>(
      `insert into assessments (school_id, academic_year_id, period_id, class_id, subject_id, kind,
         date, max_score, created_by)
       values ($1, $2, $3, $4, $5, 'composition', '2026-11-05', 20, $6) returning id`,
      [data.school, data.year, rows[0].period, data.classId, data.subjectId, rows[0].teacher],
    );
    await client.query(
      `insert into grades (school_id, academic_year_id, assessment_id, enrollment_id, status, score,
         updated_by)
       select $1, $2, $3, e.id, 'scored', case s.last_name when 'ADA' then 16 else 9 end, $4
       from enrollments e join students s on s.id = e.student_id`,
      [data.school, data.year, evaluation.rows[0].id, rows[0].teacher],
    );
  });
});

test("appréciations de la matière, conseil de classe, clôture puis validation par le directeur", async ({
  page,
}) => {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill(E2E_ACCOUNT.schoolCode);
  await page.getByLabel("Téléphone ou email").fill(E2E_ACCOUNT.phoneLocal);
  await page.getByLabel("Mot de passe").fill(E2E_ACCOUNT.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/accueil$/);

  // 1. L'enseignant de mathématiques écrit ses appréciations.
  await page.goto(`/notes/${data.classId}/${data.subjectId}`);
  await page.getByRole("link", { name: "Appréciations de la période" }).click();
  await expect(
    page.getByRole("heading", { name: "Appréciations — Mathématiques — 6e A" }),
  ).toBeVisible();
  await page.getByLabel(/ADA Test/).fill("Excellent travail.");
  await page.getByLabel(/BOB Test/).fill("Doit revoir les fractions.");
  await page.getByRole("button", { name: "Enregistrer les appréciations" }).click();
  await expect(page.getByText("Appréciations enregistrées.")).toBeVisible();

  // 2. Conseil : appréciation générale, mention « Avertissement » pour BOB.
  await page.goto(`/notes/resultats/${data.classId}`);
  await page.getByRole("link", { name: "Conseil de classe de la période" }).click();
  await expect(
    page.getByRole("heading", { name: "Conseil de classe — 6e A — Trimestre 1" }),
  ).toBeVisible();
  const ada = page.locator("li", { hasText: "ADA Test" }).first();
  const bob = page.locator("li", { hasText: "BOB Test" }).first();
  await expect(ada).toContainText("Appréciations des matières (1 sur 1)");
  await expect(ada.getByLabel("Mention")).toHaveValue("proposee");
  await expect(ada.getByLabel("Mention").locator("option:checked")).toHaveText(
    "Proposée selon les seuils : Félicitations",
  );
  await ada.getByLabel("Appréciation générale").fill("Excellent trimestre.");
  await bob.getByLabel("Appréciation générale").fill("Doit se ressaisir.");
  await bob.getByLabel("Mention").selectOption("Avertissement");
  await page.getByRole("button", { name: "Enregistrer le conseil" }).click();
  await expect(page.getByText("Conseil enregistré.")).toBeVisible();

  // 3. Validation impossible tant que la période n'est pas close.
  await expect(
    page.getByText(/Le directeur pourra valider le conseil une fois la période close/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Valider le conseil de classe" })).toHaveCount(0);
  await page.getByRole("link", { name: "Retour aux résultats" }).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Clôturer « Trimestre 1 » pour la 6e A" }).click();
  await expect(page.getByText(/Période close le/)).toBeVisible();

  // 4. Validation : tout est figé.
  await page.getByRole("link", { name: "Conseil de classe de la période" }).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Valider le conseil de classe" }).click();
  await expect(page.getByText(/Conseil validé le .* par Marie Mabiala/)).toBeVisible();
  await expect(page.locator("li", { hasText: "ADA Test" }).first()).toContainText("Félicitations");
  await expect(page.locator("li", { hasText: "BOB Test" }).first()).toContainText("Avertissement");
  await expect(page.getByRole("button", { name: "Enregistrer le conseil" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rouvrir le conseil" })).toBeVisible();
});
