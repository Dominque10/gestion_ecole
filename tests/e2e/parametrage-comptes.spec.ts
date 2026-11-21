import { expect, test, type Page } from "@playwright/test";
import { E2E_SUPERADMIN } from "./env";

async function login(page: Page, schoolCode: string, identifier: string, password: string) {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill(schoolCode);
  await page.getByLabel("Téléphone ou email").fill(identifier);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

/** Champ texte visible (Next garde les pages déjà visitées en mémoire, masquées). */
const field = (page: Page, name: string) => page.getByRole("textbox", { name, exact: true });

async function logout(page: Page) {
  await page.goto("/accueil");
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/connexion$/);
}

test("le super-admin crée une école, le directeur choisit son mot de passe puis ajoute un enseignant", async ({
  page,
}) => {
  // 1. Le super-admin crée l'école et son directeur.
  await login(page, "", E2E_SUPERADMIN.email, E2E_SUPERADMIN.password);
  await page.getByRole("link", { name: "Écoles de la plateforme" }).click();
  await field(page, "Nom de l'école").fill("Lycée Chaminade");
  await field(page, "Code de l'école").fill("chaminade");
  await field(page, "Préfixe des matricules").fill("CHM");
  await field(page, "Nom et prénom").fill("Jean Okemba");
  await field(page, "Téléphone ou email").fill("06 700 00 01");
  await field(page, "Mot de passe provisoire").fill("Provisoire-2026");
  await page.getByRole("button", { name: "Créer l'école" }).click();
  await expect(page.locator("p[role=status]")).toContainText("École « Lycée Chaminade » créée");
  await expect(page.getByText("chaminade · CHM")).toBeVisible();

  // Un code déjà pris est refusé clairement.
  await field(page, "Nom de l'école").fill("Doublon");
  await field(page, "Code de l'école").fill("Chaminade");
  await field(page, "Préfixe des matricules").fill("DBL");
  await field(page, "Nom et prénom").fill("Autre Directeur");
  await field(page, "Téléphone ou email").fill("06 700 00 09");
  await field(page, "Mot de passe provisoire").fill("Provisoire-2026");
  await page.getByRole("button", { name: "Créer l'école" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Ce code est déjà utilisé");
  await logout(page);

  // 2. Le directeur se connecte : il doit d'abord remplacer son mot de passe provisoire.
  await login(page, "chaminade", "06 700 00 01", "Provisoire-2026");
  await expect(page).toHaveURL(/\/mot-de-passe$/);
  await page.goto("/parametres/personnel");
  await expect(page).toHaveURL(/\/mot-de-passe$/);
  await page.getByLabel("Mot de passe actuel (provisoire)").fill("Provisoire-2026");
  await page.getByLabel("Nouveau mot de passe", { exact: true }).fill("Mon-mot-de-passe-2026");
  await page.getByLabel("Confirmer le nouveau mot de passe").fill("Autre-chose-2026");
  await page.getByRole("button", { name: "Enregistrer mon mot de passe" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("ne sont pas identiques");
  await page.getByLabel("Mot de passe actuel (provisoire)").fill("Provisoire-2026");
  await page.getByLabel("Nouveau mot de passe", { exact: true }).fill("Mon-mot-de-passe-2026");
  await page.getByLabel("Confirmer le nouveau mot de passe").fill("Mon-mot-de-passe-2026");
  await page.getByRole("button", { name: "Enregistrer mon mot de passe" }).click();
  await expect(page).toHaveURL(/\/accueil$/);

  // 3. Il ajoute un enseignant.
  await page.getByRole("link", { name: "Personnel de l'école" }).click();
  await field(page, "Nom et prénom").fill("Paul Nkounkou");
  await field(page, "Téléphone ou email").fill("05 700 00 02");
  await field(page, "Mot de passe provisoire").fill("Enseignant-2026");
  const addForm = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Ajouter" }) });
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(addForm.getByText("Choisissez au moins un rôle.")).toBeVisible();
  await field(page, "Mot de passe provisoire").fill("Enseignant-2026");
  await addForm.getByRole("checkbox", { name: "Enseignant" }).check();
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.locator("p[role=status]")).toContainText("Paul Nkounkou a été ajouté(e)");
  const card = page.getByRole("listitem").filter({ hasText: "Paul Nkounkou" });
  await expect(card.getByText("N'a pas encore choisi son mot de passe")).toBeVisible();
  await expect(card.getByLabel("Enseignant")).toBeChecked();
  await logout(page);

  // 4. L'enseignant se connecte, ne voit pas la gestion du personnel et n'y a pas accès.
  await login(page, "chaminade", "05 700 00 02", "Enseignant-2026");
  await expect(page).toHaveURL(/\/mot-de-passe$/);
  await page.getByLabel("Mot de passe actuel (provisoire)").fill("Enseignant-2026");
  await page.getByLabel("Nouveau mot de passe", { exact: true }).fill("Enseignant-perso-2026");
  await page.getByLabel("Confirmer le nouveau mot de passe").fill("Enseignant-perso-2026");
  await page.getByRole("button", { name: "Enregistrer mon mot de passe" }).click();
  await expect(page).toHaveURL(/\/accueil$/);
  await expect(page.getByText("Vos rôles : Enseignant")).toBeVisible();
  await expect(page.getByRole("link", { name: "Personnel de l'école" })).toHaveCount(0);
});
