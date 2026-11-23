import { expect, test } from "@playwright/test";
import { E2E_ACCOUNT } from "./env";
import { seedNotes, withAdmin, type NotesData } from "./notes-data";

let data: NotesData;
let compositionId: string;

// 6e A (Mathématiques seule, coef 4) : composition du trimestre 1, ADA 14, BOB 9,5.
test.beforeEach(async () => {
  data = await seedNotes();
  compositionId = await withAdmin(async (client) => {
    const { rows } = await client.query<{ teacher: string; period: string }>(
      `select cs.teacher_id as teacher,
              (select id from periods where academic_year_id = $1 and position = 1) as period
       from class_subjects cs where cs.class_id = $2`,
      [data.year, data.classId],
    );
    const evaluation = await client.query<{ id: string }>(
      `insert into assessments (school_id, academic_year_id, period_id, class_id, subject_id, kind,
         date, max_score, created_by)
       values ($1, $2, $3, $4, $5, 'composition', '2026-12-10', 20, $6) returning id`,
      [data.school, data.year, rows[0].period, data.classId, data.subjectId, rows[0].teacher],
    );
    await client.query(
      `insert into grades (school_id, academic_year_id, assessment_id, enrollment_id, status, score,
         updated_by)
       select $1, $2, $3, e.id, 'scored', case s.last_name when 'ADA' then 14 else 9.5 end, $4
       from enrollments e join students s on s.id = e.student_id`,
      [data.school, data.year, evaluation.rows[0].id, rows[0].teacher],
    );
    return evaluation.rows[0].id;
  });
});

test("le directeur consulte les résultats de la 6e A, clôture le trimestre puis le rouvre avec un motif", async ({
  page,
}) => {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill(E2E_ACCOUNT.schoolCode);
  await page.getByLabel("Téléphone ou email").fill(E2E_ACCOUNT.phoneLocal);
  await page.getByLabel("Mot de passe").fill(E2E_ACCOUNT.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/accueil$/);

  await page.getByRole("link", { name: "Notes", exact: true }).click();
  await page.getByRole("link", { name: "Résultats de la classe et clôture des périodes" }).click();
  await page.getByRole("link", { name: "6e A" }).click();
  await expect(page.getByRole("heading", { name: "Résultats — 6e A" })).toBeVisible();

  // Rangs, moyennes, mention et chiffres de la classe.
  await expect(
    page.getByText("Moyenne de la classe : 11,75 — plus forte : 14,00 — plus faible : 9,50"),
  ).toBeVisible();
  const ada = page.locator("li", { hasText: "ADA Test" });
  await expect(ada.locator("summary")).toContainText("1er");
  await expect(ada.locator("summary")).toContainText("14,00");
  await expect(ada.locator("summary")).toContainText("Encouragements");
  await expect(page.locator("li", { hasText: "BOB Test" }).locator("summary")).toContainText("2e");

  // Clôture du trimestre 1 : la feuille de notes passe en lecture seule.
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Clôturer « Trimestre 1 » pour la 6e A" }).click();
  await expect(page.getByText(/Période close le .* par Marie Mabiala/)).toBeVisible();
  await page.goto(`/notes/evaluation/${compositionId}`);
  await expect(page.getByText(/Période close pour cette classe/)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Note de ADA Test" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Enregistrer les notes" })).toHaveCount(0);

  // Réouverture : motif obligatoire, puis la saisie redevient possible.
  await page.goto(`/notes/resultats/${data.classId}`);
  await page.getByRole("button", { name: "Rouvrir la période" }).click();
  await expect(page.getByLabel("Motif de la réouverture (obligatoire)")).toBeFocused();
  await page.getByLabel("Motif de la réouverture (obligatoire)").fill("Erreur de saisie");
  await page.getByRole("button", { name: "Rouvrir la période" }).click();
  await expect(page.getByText(/Période rouverte le .* \(motif : Erreur de saisie\)/)).toBeVisible();
  await page.goto(`/notes/evaluation/${compositionId}`);
  await expect(page.getByRole("textbox", { name: "Note de ADA Test" })).toBeEnabled();

  // Moyenne annuelle.
  await page.goto(`/notes/resultats/${data.classId}?periode=annee`);
  await expect(page.locator("li", { hasText: "ADA Test" })).toContainText(
    "Trimestre 1 : 14,00 · Trimestre 2 : — · Trimestre 3 : —",
  );
});
