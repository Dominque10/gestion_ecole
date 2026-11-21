import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { e2eDatabaseUrls, E2E_ACCOUNT } from "./env";

// Le test crée ses propres années : on repart d'une école sans année (TRUNCATE contourne les
// garde-fous d'archivage, voulu ici).
test.beforeEach(async () => {
  const client = new pg.Client({ connectionString: e2eDatabaseUrls().admin });
  await client.connect();
  try {
    await client.query("truncate academic_years cascade");
  } finally {
    await client.end();
  }
});

/** Champ visible (Next garde les pages déjà visitées en mémoire, masquées). */
const field = (page: Page, label: string) =>
  page.getByLabel(label, { exact: true }).filter({ visible: true });

test("le directeur prépare l'année, ajuste les trimestres, l'active, puis passe à l'année suivante", async ({
  page,
}) => {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill(E2E_ACCOUNT.schoolCode);
  await page.getByLabel("Téléphone ou email").fill(E2E_ACCOUNT.phoneLocal);
  await page.getByLabel("Mot de passe").fill(E2E_ACCOUNT.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/accueil$/);

  // 1. Création : l'année et les dates sont proposées, 3 trimestres sont calculés.
  await page.getByRole("link", { name: "Années scolaires" }).click();
  await expect(page.getByRole("heading", { name: "Préparer une nouvelle année" })).toBeVisible();
  await field(page, "Nom de l'année").fill("2026-2027");
  await field(page, "Date de rentrée").fill("2026-10-01");
  await field(page, "Date de fin d'année").fill("2027-06-30");
  await page.getByRole("button", { name: "Créer l'année" }).click();
  await expect(page.getByRole("heading", { name: "Année 2026-2027" })).toBeVisible();
  await expect(
    page.getByText("En préparation", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(field(page, "Fin de la période 1")).toHaveValue("2026-12-31");

  // 2. Ajustement : un chevauchement est refusé, puis des vacances sont ménagées.
  await field(page, "Fin de la période 1").fill("2027-01-10");
  await page.getByRole("button", { name: "Enregistrer les périodes" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Deux périodes se chevauchent" }),
  ).toBeVisible();
  await field(page, "Fin de la période 1").fill("2026-12-18");
  await field(page, "Début de la période 2").fill("2027-01-04");
  await page.getByRole("button", { name: "Enregistrer les périodes" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Périodes enregistrées." }),
  ).toBeVisible();
  await page.reload();
  await expect(field(page, "Début de la période 2")).toHaveValue("2027-01-04");

  // 3. Activation de la première année (pas d'année précédente à archiver).
  await page.getByRole("button", { name: "Activer l'année" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "est maintenant l'année en cours" }),
  ).toBeVisible();
  await expect(
    page.getByText("Année en cours", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Supprimer cette année" })).toHaveCount(0);

  // 4. Année suivante : son activation archive 2026-2027, après confirmation.
  await page.getByRole("link", { name: "Toutes les années" }).click();
  // Attendre la liste : la page de l'année a aussi des champs « Nom de l'année » et « Date de rentrée ».
  await expect(page.getByRole("heading", { name: "Préparer une nouvelle année" })).toBeVisible();
  await field(page, "Nom de l'année").fill("2027-2028");
  await field(page, "Date de rentrée").fill("2027-10-01");
  await field(page, "Date de fin d'année").fill("2028-06-30");
  await page.getByRole("button", { name: "Créer l'année" }).click();
  await expect(page.getByRole("heading", { name: "Année 2027-2028" })).toBeVisible();
  await expect(page.getByText("L'année en cours (2026-2027) sera archivée")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Activer l'année" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "2027-2028 est maintenant" }),
  ).toBeVisible();

  // 5. L'année archivée se consulte, mais ne se modifie plus.
  await page.goto("/parametres/annees");
  const archived = page.getByRole("link").filter({ hasText: "2026-2027" });
  await expect(archived.getByText("Archivée")).toBeVisible();
  await archived.click();
  await expect(page.getByText("Année archivée : consultation seulement.")).toBeVisible();
  await expect(field(page, "Fin de la période 1")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Enregistrer les périodes" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Activer l'année" })).toHaveCount(0);
});
