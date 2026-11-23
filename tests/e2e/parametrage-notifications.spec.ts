import { expect, test } from "@playwright/test";
import { E2E_ACCOUNT } from "./env";
import { withAdmin } from "./notes-data";

test.beforeEach(async () => {
  await withAdmin((client) =>
    client.query(
      "update schools set notification_channel = 'sms', notification_templates = null, notification_monthly_cap = null where code = $1",
      [E2E_ACCOUNT.schoolCode],
    ),
  );
});

test("le directeur choisit WhatsApp, un plafond et modifie un modèle ; un champ inconnu est refusé", async ({
  page,
}) => {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill(E2E_ACCOUNT.schoolCode);
  await page.getByLabel("Téléphone ou email").fill(E2E_ACCOUNT.phoneLocal);
  await page.getByLabel("Mot de passe").fill(E2E_ACCOUNT.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.getByRole("link", { name: "Messages aux parents" }).click();

  await expect(page.getByRole("radio", { name: /^SMS/ })).toBeChecked();
  await expect(
    page.getByText("Champs utilisables : {ecole}, {eleve}, {classe}, {montant}, {numero}, {reste}"),
  ).toBeVisible();

  await page.getByRole("radio", { name: /^WhatsApp/ }).check();
  await page.getByLabel("Plafond mensuel (FCFA)").fill("20000");
  const receipt = page.getByLabel("Reçu de paiement");
  await receipt.fill("{ecole} : {montant} reçus, merci ! Total dû : {total}");
  await page.getByRole("button", { name: "Enregistrer les réglages" }).click();
  await expect(page.locator("p[role=alert]")).toContainText(
    "Le modèle « Reçu de paiement » contient un champ inconnu : {total}.",
  );
  await expect(receipt).toHaveValue("{ecole} : {montant} reçus, merci ! Total dû : {total}");

  await receipt.fill("{ecole} : {montant} reçus pour {eleve}, merci ! Reste : {reste}");
  await page.getByRole("button", { name: "Enregistrer les réglages" }).click();
  await expect(page.locator("p[role=status]").first()).toContainText(
    "Réglages des messages enregistrés.",
  );
  await page.reload();
  await expect(page.getByRole("radio", { name: /^WhatsApp/ })).toBeChecked();
  await expect(page.getByLabel("Plafond mensuel (FCFA)")).toHaveValue("20000");
  await expect(page.getByLabel("Reçu de paiement")).toHaveValue(
    "{ecole} : {montant} reçus pour {eleve}, merci ! Reste : {reste}",
  );
});
