import { expect, test } from "@playwright/test";
import { E2E_ACCOUNT } from "./env";

// Image PNG valide de 1 × 1 pixel (réduite puis convertie par le navigateur avant l'envoi).
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
);

test("le directeur complète la fiche de l'école et envoie le logo", async ({ page }) => {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill(E2E_ACCOUNT.schoolCode);
  await page.getByLabel("Téléphone ou email").fill(E2E_ACCOUNT.phoneLocal);
  await page.getByLabel("Mot de passe").fill(E2E_ACCOUNT.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/accueil$/);

  await page.getByRole("link", { name: "Fiche de l'école" }).click();
  await expect(page.getByText("Code de connexion : sjb")).toBeVisible();

  // Coordonnées : un téléphone invalide est refusé, puis la fiche est enregistrée.
  await page
    .getByRole("textbox", { name: "Adresse", exact: true })
    .fill("12 avenue de la Paix, Brazzaville");
  await page.getByRole("textbox", { name: "Téléphone de l'école" }).fill("123");
  await page.getByRole("button", { name: "Enregistrer la fiche" }).click();
  await expect(page.getByText("Numéro de téléphone invalide")).toBeVisible();
  await page.getByRole("textbox", { name: "Téléphone de l'école" }).fill("06 222 33 44");
  await page.getByRole("button", { name: "Enregistrer la fiche" }).click();
  await expect(page.locator("p[role=status]")).toContainText("Fiche enregistrée.");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Téléphone de l'école" })).toHaveValue(
    "+242062223344",
  );

  // Logo : envoi, affichage, puis retrait.
  const logo = page.locator("section").filter({ has: page.getByRole("heading", { name: "Logo" }) });
  await expect(logo.getByText("Aucune image pour l'instant.")).toBeVisible();
  await logo.getByLabel("Choisir une image").setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: PNG_1PX,
  });
  await logo.getByRole("button", { name: "Envoyer" }).click();
  await expect(logo.locator("p[role=status]")).toContainText("Image enregistrée.");
  const img = logo.getByRole("img", { name: "Logo" });
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);

  // Un fichier qui n'est pas une image est refusé.
  await logo.getByLabel("Choisir une image").setInputFiles({
    name: "faux.png",
    mimeType: "image/png",
    buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
  });
  await logo.getByRole("button", { name: "Envoyer" }).click();
  await expect(logo.locator("p[role=alert]")).toContainText("Impossible de lire cette image");

  await logo.getByRole("button", { name: "Retirer l'image" }).click();
  await expect(logo.getByText("Aucune image pour l'instant.")).toBeVisible();
});

test("sans session, les images de l'école ne sont pas accessibles", async ({ request }) => {
  const response = await request.get("/api/v1/school/images/stamp");
  expect(response.status()).toBe(401);
});
