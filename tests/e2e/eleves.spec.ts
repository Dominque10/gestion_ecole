import { expect, test } from "@playwright/test";
import pg from "pg";
import { e2eDatabaseUrls, E2E_ACCOUNT } from "./env";

// Image PNG valide de 1 × 1 pixel (réduite puis convertie par le navigateur avant l'envoi).
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
);

// Aucun élève au départ, compteur de matricules remis à zéro (TRUNCATE, voulu ici).
test.beforeEach(async () => {
  const client = new pg.Client({ connectionString: e2eDatabaseUrls().admin });
  await client.connect();
  try {
    await client.query("truncate students, guardians, academic_years cascade");
    await client.query("update schools set last_matricule_number = 0 where code = $1", [
      E2E_ACCOUNT.schoolCode,
    ]);
  } finally {
    await client.end();
  }
});

test("le directeur crée la fiche d'un élève, puis celle de son frère, et les retrouve", async ({
  page,
}) => {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill(E2E_ACCOUNT.schoolCode);
  await page.getByLabel("Téléphone ou email").fill(E2E_ACCOUNT.phoneLocal);
  await page.getByLabel("Mot de passe").fill(E2E_ACCOUNT.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/accueil$/);

  // 1. Première fiche : matricule attribué automatiquement.
  await page.getByRole("link", { name: "Élèves", exact: true }).click();
  await page.getByRole("link", { name: "Nouvel élève" }).click();
  await page.getByRole("textbox", { name: "Nom", exact: true }).fill("ngoma");
  await page.getByRole("textbox", { name: "Prénoms" }).fill("bénédicte");
  await page.getByRole("radio", { name: "Fille" }).check();
  await page.getByRole("textbox", { name: "Nom et prénom du responsable" }).fill("Awa Ngoma");
  await page.getByRole("textbox", { name: "Téléphone du responsable" }).fill("06 555 11 22");
  await page.getByRole("textbox", { name: "Lien avec l'élève" }).fill("Mère");
  await page.getByRole("button", { name: "Créer la fiche" }).click();

  await expect(page.getByRole("heading", { name: "NGOMA Bénédicte" })).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: /Fiche créée : matricule SJB-\d{2}-00001/ }),
  ).toBeVisible();
  await expect(page.getByText("Awa Ngoma · Mère")).toBeVisible();

  // 2. Données médicales : visibles pour le directeur.
  await page.getByRole("textbox", { name: "Allergies" }).fill("Arachides");
  await page.getByRole("button", { name: "Enregistrer" }).last().click();
  await expect(
    page.getByRole("status").filter({ hasText: "Informations médicales enregistrées." }),
  ).toBeVisible();

  // 3. Photo envoyée depuis le téléphone.
  await page.getByLabel("Choisir ou prendre une photo", { exact: true }).setInputFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: PNG_1PX,
  });
  await page.getByRole("button", { name: "Envoyer la photo" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Photo enregistrée." })).toBeVisible();
  await expect(page.getByRole("img", { name: "Photo" })).toBeVisible();

  // 4. Le frère : le parent est retrouvé par son numéro.
  await page.goto("/eleves/nouveau");
  await page.getByRole("textbox", { name: "Nom", exact: true }).fill("Ngoma");
  await page.getByRole("textbox", { name: "Prénoms" }).fill("Paul");
  await page.getByRole("radio", { name: "Garçon" }).check();
  await page.getByRole("textbox", { name: "Nom et prénom du responsable" }).fill("Awa N.");
  await page.getByRole("textbox", { name: "Téléphone du responsable" }).fill("065551122");
  await page.getByRole("button", { name: "Créer la fiche" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Le responsable était déjà connu de l'école" }),
  ).toBeVisible();

  // 5. Recherche par le téléphone du parent : les deux enfants.
  await page.goto("/eleves");
  await page.getByRole("searchbox", { name: "Rechercher un élève" }).fill("06 555 11 22");
  await page.getByRole("button", { name: "Rechercher" }).click();
  await expect(page.getByText("2 résultat(s)")).toBeVisible();
  await expect(page.getByRole("link", { name: /NGOMA Paul/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /NGOMA Bénédicte/ })).toBeVisible();
});
