import { expect, test } from "@playwright/test";
import { E2E_ACCOUNT } from "./env";
import { seedNotes } from "./notes-data";

test.beforeEach(async () => {
  await seedNotes();
});

test("le directeur ouvre le tableau de bord depuis l'accueil et y lit les chiffres de l'école", async ({
  page,
}) => {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill(E2E_ACCOUNT.schoolCode);
  await page.getByLabel("Téléphone ou email").fill(E2E_ACCOUNT.phoneLocal);
  await page.getByLabel("Mot de passe").fill(E2E_ACCOUNT.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.getByRole("link", { name: "Tableau de bord" }).click();

  await expect(page.getByRole("heading", { name: "Tableau de bord", level: 1 })).toBeVisible();
  const headcount = page.getByRole("region", { name: "Effectifs" });
  await expect(headcount.getByText("Élèves inscrits")).toBeVisible();
  await expect(headcount.getByText("2 filles, 0 garçons")).toBeVisible();
  await expect(headcount.getByText("2 élèves · 2 F, 0 G")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Encaissements et recouvrement" }).getByText("Aujourd'hui"),
  ).toBeVisible();

  // Résultats : changement de période par le sélecteur.
  const results = page.getByRole("region", { name: "Résultats scolaires" });
  await expect(results.getByText("Par classe · Trimestre 1")).toBeVisible();
  await results.getByLabel("Période").selectOption({ label: "Trimestre 2" });
  await results.getByRole("button", { name: "Afficher" }).click();
  await expect(results.getByText("Par classe · Trimestre 2")).toBeVisible();
  await expect(page.getByRole("region", { name: "Absentéisme" })).toContainText(
    "Aucun appel enregistré.",
  );
});
