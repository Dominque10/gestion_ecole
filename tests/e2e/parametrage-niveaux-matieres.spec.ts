import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { e2eDatabaseUrls, E2E_ACCOUNT } from "./env";

// Le test repart d'une école sans structure pédagogique (TRUNCATE contourne les garde-fous, voulu ici).
test.beforeEach(async () => {
  const client = new pg.Client({ connectionString: e2eDatabaseUrls().admin });
  await client.connect();
  try {
    await client.query("truncate levels, subjects, academic_years cascade");
  } finally {
    await client.end();
  }
});

async function loginAsDirector(page: Page) {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill(E2E_ACCOUNT.schoolCode);
  await page.getByLabel("Téléphone ou email").fill(E2E_ACCOUNT.phoneLocal);
  await page.getByLabel("Mot de passe").fill(E2E_ACCOUNT.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/accueil$/);
}

test("le directeur ajoute les niveaux du collège et ses matières", async ({ page }) => {
  await loginAsDirector(page);

  // Niveaux : un clic pour le collège, puis un niveau renommé.
  await page.getByRole("link", { name: "Niveaux" }).click();
  await page.getByRole("button", { name: "Ajouter les niveaux du collège" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "4 niveau(x) ajouté(s)." }),
  ).toBeVisible();
  const college = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Collège" }) });
  await expect(college.getByRole("listitem")).toHaveText([/6e/, /5e/, /4e/, /3e/]);

  const sixieme = college.getByRole("listitem").filter({ hasText: "6e" });
  await sixieme.getByRole("button", { name: "Renommer" }).click();
  await sixieme.getByLabel("Nouveau nom pour 6e").fill("Sixième");
  await sixieme.getByRole("button", { name: "Enregistrer" }).click();
  await expect(college.getByText("Sixième", { exact: true })).toBeVisible();

  // Matières : ajout, doublon refusé, suppression après confirmation.
  await page.goto("/parametres/matieres");
  await page.getByRole("textbox", { name: "Nom de la matière" }).fill("Mathématiques");
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Matière ajoutée." })).toBeVisible();
  await page.getByRole("textbox", { name: "Nom de la matière" }).fill("Mathématiques");
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Une matière porte déjà ce nom." }),
  ).toBeVisible();

  const maths = page.getByRole("listitem").filter({ hasText: "Mathématiques" });
  page.once("dialog", (dialog) => dialog.accept());
  await maths.getByRole("button", { name: "Supprimer" }).click();
  await expect(page.getByText("Aucune matière pour l'instant.", { exact: false })).toBeVisible();
});
