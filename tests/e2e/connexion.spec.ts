import { expect, test } from "@playwright/test";
import { E2E_ACCOUNT } from "./env";

test("un directeur se connecte avec le code école et son téléphone, puis se déconnecte", async ({
  page,
}) => {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill("SJB");
  await page.getByLabel("Téléphone ou email").fill(E2E_ACCOUNT.phoneLocal);
  await page.getByLabel("Mot de passe").fill(E2E_ACCOUNT.password);
  await page.getByRole("button", { name: "Se connecter" }).click();

  await expect(page).toHaveURL(/\/accueil$/);
  await expect(page.getByRole("heading", { name: "Bonjour Marie Mabiala" })).toBeVisible();
  await expect(page.getByText("Vos rôles : Directeur, Enseignant")).toBeVisible();

  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/connexion$/);

  // La session est bien détruite : l'accueil renvoie à la connexion.
  await page.goto("/accueil");
  await expect(page).toHaveURL(/\/connexion$/);
});

test("un mauvais mot de passe affiche un message clair, sans dire ce qui est faux", async ({
  page,
}) => {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill("sjb");
  await page.getByLabel("Téléphone ou email").fill(E2E_ACCOUNT.phoneLocal);
  await page.getByLabel("Mot de passe").fill("mauvais");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Code de l'école, téléphone ou mot de passe incorrect." }),
  ).toBeVisible();
});

test("l'accueil sans session renvoie à la connexion", async ({ page }) => {
  await page.goto("/accueil");
  await expect(page).toHaveURL(/\/connexion$/);
});
