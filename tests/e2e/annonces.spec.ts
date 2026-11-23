import { existsSync, readFileSync, rmSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { E2E_ACCOUNT } from "./env";
import { seedNotes, withAdmin } from "./notes-data";

const OUTBOX = "test-results/sms-outbox.jsonl";
const PARENT_PHONE = "+242067770004";

// ADA (6e A) : responsable principal 06 777 00 04.
test.beforeEach(async () => {
  const data = await seedNotes();
  if (existsSync(OUTBOX)) rmSync(OUTBOX);
  await withAdmin(async (client) => {
    await client.query("delete from users where phone = $1", [PARENT_PHONE]);
    const guardian = (
      await client.query<{ id: string }>(
        "insert into guardians (school_id, full_name, phone) values ($1, 'Mère d''Ada', $2) returning id",
        [data.school, PARENT_PHONE],
      )
    ).rows[0].id;
    await client.query(
      `insert into student_guardians (school_id, student_id, guardian_id, is_primary)
       select $1, id, $2, true from students where last_name = 'ADA'`,
      [data.school, guardian],
    );
  });
});

function outbox(): { to: string; body: string }[] {
  if (!existsSync(OUTBOX)) return [];
  return readFileSync(OUTBOX, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

test("le directeur publie une annonce ; le parent la reçoit par SMS et la lit dans son espace", async ({
  page,
}) => {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill(E2E_ACCOUNT.schoolCode);
  await page.getByLabel("Téléphone ou email").fill(E2E_ACCOUNT.phoneLocal);
  await page.getByLabel("Mot de passe").fill(E2E_ACCOUNT.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.getByRole("link", { name: "Annonces aux parents" }).click();

  await page.getByRole("radio", { name: "Une classe" }).check();
  await page.getByLabel("Classe", { exact: true }).selectOption({ label: "6e A" });
  await page.getByLabel("Titre", { exact: true }).fill("Sortie au musée");
  await page.getByLabel("Texte de l'annonce").fill("Jeudi 10 décembre, prévoir 1 000 FCFA.");
  await expect(page.getByText("38 / 300 caractères")).toBeVisible();
  await page.getByRole("button", { name: "Publier l'annonce" }).click();
  await expect(
    page.getByText("Annonce publiée ; 1 message(s) en cours d'envoi aux familles."),
  ).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Sortie au musée" })).toContainText(
    "6e A",
  );

  // Le worker envoie le message (faux prestataire : fichier de sortie).
  await expect
    .poll(() => outbox().find((m) => m.to === PARENT_PHONE)?.body, { timeout: 20_000 })
    .toBe("École Saint-Jean : Sortie au musée : Jeudi 10 décembre, prévoir 1 000 FCFA.");

  // Le parent se connecte et lit l'annonce sur la page de son enfant.
  await page.getByRole("link", { name: "Accueil" }).click();
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await page.goto("/parent/connexion");
  await page.getByLabel("Votre numéro de téléphone").fill("06 777 00 04");
  await page.getByRole("button", { name: "Recevoir mon code" }).click();
  await expect(page.getByText(/un code vient de vous être envoyé/)).toBeVisible();
  const code = outbox()
    .filter((m) => m.to === PARENT_PHONE && /code de connexion/.test(m.body))
    .at(-1)!
    .body.match(/\d{6}/)![0];
  await page.getByLabel("Code reçu par SMS (6 chiffres)").fill(code);
  await page.getByRole("button", { name: "Entrer" }).click();
  await page.getByRole("button", { name: /ADA Test/ }).click();
  await expect(page.getByRole("heading", { name: "Annonces de l'école" })).toBeVisible();
  await expect(page.getByText("Sortie au musée")).toBeVisible();
});
