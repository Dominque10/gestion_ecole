import { existsSync, readFileSync, rmSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { seedNotes, withAdmin } from "./notes-data";

const OUTBOX = "test-results/sms-outbox.jsonl";
const PARENT_PHONE = "+242067770001";

// 6e A : ADA a pour responsable principal le numéro 06 777 00 01 (BOB a un autre responsable).
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

/** Dernier code envoyé par le faux prestataire SMS à ce numéro. */
function lastCode(): string {
  const lines = readFileSync(OUTBOX, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  const sms = lines.filter((l) => l.to === PARENT_PHONE).at(-1);
  return sms.body.match(/\d{6}/)[0];
}

test("un parent entre avec un code reçu par SMS et voit son enfant, et seulement lui", async ({
  page,
}) => {
  await page.goto("/connexion");
  await page.getByRole("link", { name: "Vous êtes parent ? Entrez avec un code SMS" }).click();
  await expect(page.getByRole("heading", { name: "Espace parents" })).toBeVisible();

  await page.getByLabel("Votre numéro de téléphone").fill("06 777 00 01");
  await page.getByRole("button", { name: "Recevoir mon code" }).click();
  await expect(page.getByText(/un code vient de vous être envoyé par SMS/)).toBeVisible();

  // Code faux, puis code juste.
  await page
    .getByLabel("Code reçu par SMS (6 chiffres)")
    .fill(lastCode() === "000000" ? "111111" : "000000");
  await page.getByRole("button", { name: "Entrer" }).click();
  await expect(page.getByText("Code incorrect ou expiré.", { exact: false })).toBeVisible();
  await page.getByLabel("Code reçu par SMS (6 chiffres)").fill(lastCode());
  await page.getByRole("button", { name: "Entrer" }).click();

  await expect(page).toHaveURL(/\/parent$/);
  await expect(page.getByRole("heading", { name: "Mes enfants" })).toBeVisible();
  await expect(page.getByRole("button", { name: /ADA Test/ })).toContainText(
    "6e A — École Saint-Jean",
  );
  await expect(page.getByRole("button", { name: /BOB Test/ })).toHaveCount(0);

  await page.getByRole("button", { name: /ADA Test/ }).click();
  await expect(page).toHaveURL(/\/parent\/enfant\//);
  await expect(page.getByRole("heading", { name: "ADA Test" })).toBeVisible();

  // Les pages du personnel lui sont fermées.
  await page.goto("/eleves");
  await expect(page.getByText("ADA Test", { exact: true })).toHaveCount(0);
  await page.goto("/accueil");
  await expect(page).toHaveURL(/\/parent$/);
});
