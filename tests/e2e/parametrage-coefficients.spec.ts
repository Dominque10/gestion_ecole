import { expect, test } from "@playwright/test";
import pg from "pg";
import { e2eDatabaseUrls, E2E_ACCOUNT } from "./env";

// École préparée directement en base : une année en préparation et les niveaux du lycée.
test.beforeEach(async () => {
  const client = new pg.Client({ connectionString: e2eDatabaseUrls().admin });
  await client.connect();
  try {
    await client.query("truncate levels, subjects, academic_years cascade");
    const { rows } = await client.query<{ id: string }>("select id from schools where code = $1", [
      E2E_ACCOUNT.schoolCode,
    ]);
    const schoolId = rows[0].id;
    await client.query(
      `insert into academic_years (school_id, label, start_date, end_date)
       values ($1, '2026-2027', '2026-10-01', '2027-06-30')`,
      [schoolId],
    );
    await client.query(
      `insert into levels (school_id, cycle, name, position)
       values ($1, 'lycee', '2nde', 1), ($1, 'lycee', '1re', 2), ($1, 'lycee', 'Tle', 3)`,
      [schoolId],
    );
  } finally {
    await client.end();
  }
});

test("le directeur règle la grille des coefficients de la 1re C", async ({ page }) => {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill(E2E_ACCOUNT.schoolCode);
  await page.getByLabel("Téléphone ou email").fill(E2E_ACCOUNT.phoneLocal);
  await page.getByLabel("Mot de passe").fill(E2E_ACCOUNT.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/accueil$/);

  await page.getByRole("link", { name: "Coefficients" }).click();
  await page.getByLabel("Niveau", { exact: true }).selectOption({ label: "1re" });
  await page.getByRole("combobox", { name: "Série" }).fill("c");
  await page.getByRole("button", { name: "Afficher la grille" }).click();
  await expect(page.getByRole("heading", { name: "Grille : 1re série C" })).toBeVisible();

  // Matières courantes du lycée, coefficient 1.
  await page
    .getByRole("button", { name: "Ajouter les matières courantes (coefficient 1)" })
    .click();
  await expect(page.getByText("9 matière(s) ajoutée(s) à la grille.")).toBeVisible();
  await expect(page.getByLabel("Philosophie enseignée")).toBeChecked();

  // Coefficients de la série C, EPS retirée.
  await page.getByLabel("Coefficient de Mathématiques").fill("5");
  await page.getByLabel("Coefficient de Physique-Chimie").fill("4");
  await page.getByLabel("Éducation physique et sportive enseignée").uncheck();
  await page.getByRole("button", { name: "Enregistrer la grille" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Grille enregistrée." })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Coefficient de Mathématiques")).toHaveValue("5");
  await expect(page.getByLabel("Éducation physique et sportive enseignée")).not.toBeChecked();
  await expect(page.getByText("8 matière(s) dans la grille")).toBeVisible();

  // Un coefficient hors limites est refusé.
  await page.getByLabel("Coefficient de Mathématiques").fill("25");
  await page.getByRole("button", { name: "Enregistrer la grille" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Grille invalide" })).toBeVisible();
});
