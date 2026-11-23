import { expect, test } from "@playwright/test";
import { E2E_ACCOUNT } from "./env";
import { seedNotes } from "./notes-data";

test.beforeEach(async () => {
  await seedNotes();
});

test("l'enseignant crée un devoir et saisit les notes au clavier ; une note invalide est signalée", async ({
  page,
}) => {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill(E2E_ACCOUNT.schoolCode);
  await page.getByLabel("Téléphone ou email").fill(E2E_ACCOUNT.phoneLocal);
  await page.getByLabel("Mot de passe").fill(E2E_ACCOUNT.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/accueil$/);

  await page.getByRole("link", { name: "Notes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "6e A" })).toBeVisible();
  await page.getByRole("link", { name: /Mathématiques/ }).click();
  await expect(page.getByRole("heading", { name: "Mathématiques — 6e A" })).toBeVisible();
  await expect(page.getByText("Aucune évaluation pour cette période.")).toBeVisible();

  // Nouvelle évaluation : un devoir noté sur 20 (barème proposé).
  await expect(page.getByLabel("Noté sur")).toHaveValue("20");
  await page.getByRole("radio", { name: "Devoir" }).check();
  await page.getByLabel("Date").fill("2026-11-10");
  await page.getByLabel("Intitulé (facultatif)").fill("Fractions");
  await page.getByRole("button", { name: "Créer et saisir les notes" }).click();
  await expect(page).toHaveURL(/\/notes\/evaluation\//);
  await expect(page.getByRole("heading", { name: "Devoir du 10 nov. 2026" })).toBeVisible();

  // Saisie au clavier : Entrée passe à l'élève suivant ; 25 dépasse le barème.
  const ada = page.getByRole("textbox", { name: "Note de ADA Test" });
  const bob = page.getByRole("textbox", { name: "Note de BOB Test" });
  await ada.fill("12,5");
  await ada.press("Enter");
  await expect(bob).toBeFocused();
  await bob.fill("25");
  await expect(page.getByText("Note au-dessus du barème")).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer les notes" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Corrigez les cases signalées");

  // BOB est marqué absent avec le bouton ; enregistrement, puis relecture après rechargement.
  await page.getByRole("button", { name: "Marquer BOB Test absent" }).click();
  await expect(bob).toHaveValue("a");
  await page.getByRole("button", { name: "Enregistrer les notes" }).click();
  await expect(page.locator("p[role=status]")).toContainText("2 note(s) enregistrée(s).");
  await page.reload();
  await expect(ada).toHaveValue("12,5");
  await expect(bob).toHaveValue("a");
  await expect(page.getByText("2 sur 2 saisies")).toBeVisible();

  // La liste des évaluations de la période montre le devoir.
  await page.getByRole("link", { name: "Retour aux évaluations" }).click();
  await expect(page.getByRole("link", { name: /Devoir — 10 nov\. 2026/ })).toContainText(
    "2 sur 2 saisies",
  );
});
