// Test de fumée d'une installation de production (mise en service, Sa) : HTTPS, base, migrations,
// mots de passe (Argon2), sessions sécurisées. Le super-admin est créé par le script d'installation.
import { expect, test, type Page } from "@playwright/test";

const SUPERADMIN = {
  email: process.env.SMOKE_SUPERADMIN_EMAIL ?? "admin@exemple.cg",
  password: process.env.SMOKE_SUPERADMIN_PASSWORD ?? "",
};

async function login(page: Page, schoolCode: string, identifier: string, password: string) {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill(schoolCode);
  await page.getByLabel("Téléphone ou email").fill(identifier);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

const field = (page: Page, name: string) => page.getByRole("textbox", { name, exact: true });

test("installation : le super-admin crée une école, son directeur se connecte en HTTPS", async ({
  page,
  context,
}) => {
  await login(page, "", SUPERADMIN.email, SUPERADMIN.password);
  await page.getByRole("link", { name: "Écoles de la plateforme" }).click();
  await field(page, "Nom de l'école").fill("École de vérification");
  await field(page, "Code de l'école").fill("verif");
  await field(page, "Préfixe des matricules").fill("VRF");
  await field(page, "Nom et prénom").fill("Directeur Vérification");
  await field(page, "Téléphone ou email").fill("06 700 99 01");
  await field(page, "Mot de passe provisoire").fill("Provisoire-2026");
  await page.getByRole("button", { name: "Créer l'école" }).click();
  await expect(page.locator("p[role=status]")).toContainText("créée");

  // Cookie de session marqué « secure » (production derrière HTTPS).
  const session = (await context.cookies()).find((c) => c.name === "gs_session");
  expect(session?.secure).toBe(true);
  expect(session?.httpOnly).toBe(true);

  await page.goto("/accueil");
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await login(page, "verif", "06 700 99 01", "Provisoire-2026");
  await expect(page).toHaveURL(/\/mot-de-passe$/);
  await page.getByLabel("Mot de passe actuel (provisoire)").fill("Provisoire-2026");
  await page.getByLabel("Nouveau mot de passe", { exact: true }).fill("Verification-2026!");
  await page.getByLabel("Confirmer le nouveau mot de passe").fill("Verification-2026!");
  await page.getByRole("button", { name: "Enregistrer mon mot de passe" }).click();
  await expect(page).toHaveURL(/\/accueil$/);
  await expect(page.getByRole("link", { name: "Démarrage" })).toBeVisible();
});
