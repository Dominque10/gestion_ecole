import { expect, test } from "@playwright/test";
import pg from "pg";
import { e2eDatabaseUrls, E2E_ACCOUNT } from "./env";

// Règles par défaut au départ de chaque essai.
test.beforeEach(async () => {
  const client = new pg.Client({ connectionString: e2eDatabaseUrls().admin });
  await client.connect();
  try {
    await client.query("update schools set grading_rules = null where code = $1", [
      E2E_ACCOUNT.schoolCode,
    ]);
  } finally {
    await client.end();
  }
});

test("le directeur change les règles de calcul ; une mention invalide est refusée", async ({
  page,
}) => {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill(E2E_ACCOUNT.schoolCode);
  await page.getByLabel("Téléphone ou email").fill(E2E_ACCOUNT.phoneLocal);
  await page.getByLabel("Mot de passe").fill(E2E_ACCOUNT.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/accueil$/);

  await page.getByRole("link", { name: "Règles de calcul" }).click();
  await expect(page.getByRole("radio", { name: "Au centième (12,345 → 12,35)" })).toBeChecked();
  await expect(page.getByRole("textbox", { name: "Mention 1", exact: true })).toHaveValue(
    "Félicitations",
  );

  // Seuil illisible : refusé, la saisie reste.
  await page.getByRole("textbox", { name: "Seuil de la mention 3" }).fill("douze");
  await page.getByRole("button", { name: "Enregistrer les règles" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Règles de calcul invalides");
  await expect(page.getByRole("textbox", { name: "Seuil de la mention 3" })).toHaveValue("douze");

  // Correction et nouveaux choix : enregistrés et relus après rechargement.
  await page.getByRole("textbox", { name: "Seuil de la mention 3" }).fill("12,5");
  await page.getByRole("radio", { name: "Au dixième (12,35 → 12,4)" }).check();
  await page.getByRole("radio", { name: "Sur 10" }).check();
  await page.getByRole("button", { name: "Enregistrer les règles" }).click();
  await expect(page.locator("p[role=status]")).toContainText("Règles de calcul enregistrées.");
  await page.reload();
  await expect(page.getByRole("radio", { name: "Au dixième (12,35 → 12,4)" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Sur 10" })).toBeChecked();
  await expect(page.getByRole("textbox", { name: "Seuil de la mention 3" })).toHaveValue("12,5");
});
