import { createHmac } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { seedNotes, withAdmin } from "./notes-data";

const OUTBOX = "test-results/sms-outbox.jsonl";
const PARENT_PHONE = "+242067770003";
const SECRET = "secret-e2e-des-paiements";

// ADA : responsable 06 777 00 03 ; échéance échue de 50 000 (scolarité T1), une autre de 50 000 à venir.
test.beforeEach(async () => {
  const data = await seedNotes();
  if (existsSync(OUTBOX)) rmSync(OUTBOX);
  await withAdmin(async (client) => {
    await client.query("delete from users where phone = $1", [PARENT_PHONE]);
    const ada = (
      await client.query<{ enrollment: string; student: string }>(
        `select e.id as enrollment, s.id as student from enrollments e
         join students s on s.id = e.student_id where s.last_name = 'ADA'`,
      )
    ).rows[0];
    const guardian = (
      await client.query<{ id: string }>(
        "insert into guardians (school_id, full_name, phone) values ($1, 'Père d''Ada', $2) returning id",
        [data.school, PARENT_PHONE],
      )
    ).rows[0].id;
    await client.query(
      "insert into student_guardians (school_id, student_id, guardian_id, is_primary) values ($1, $2, $3, true)",
      [data.school, ada.student, guardian],
    );
    for (const [fee, due] of [
      ["Scolarité T1", "2026-10-15"],
      ["Scolarité T2", "2027-01-15"],
    ]) {
      await client.query(
        `insert into invoices (school_id, academic_year_id, enrollment_id, fee_name, kind, mandatory,
           installment_number, installment_count, amount, due_date)
         values ($1, $2, $3, $4, 'tuition', true, 1, 1, 50000, $5)`,
        [data.school, data.year, ada.enrollment, fee, due],
      );
    }
  });
});

function lastCode(): string {
  const lines = readFileSync(OUTBOX, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  return lines
    .filter((l) => l.to === PARENT_PHONE)
    .at(-1)
    .body.match(/\d{6}/)[0];
}

test("le parent paie l'échéance en retard ; la confirmation signée de l'opérateur l'enregistre une seule fois", async ({
  page,
  request,
}) => {
  await page.goto("/parent/connexion");
  await page.getByLabel("Votre numéro de téléphone").fill("06 777 00 03");
  await page.getByRole("button", { name: "Recevoir mon code" }).click();
  await expect(page.getByText(/un code vient de vous être envoyé/)).toBeVisible();
  await page.getByLabel("Code reçu par SMS (6 chiffres)").fill(lastCode());
  await page.getByRole("button", { name: "Entrer" }).click();
  await page.getByRole("button", { name: /ADA Test/ }).click();

  await page.getByRole("link", { name: "Payer en ligne (Airtel Money, MTN MoMo)" }).click();
  // L'échéance en retard est cochée d'office ; l'autre non.
  await expect(page.getByRole("checkbox", { name: /Scolarité T1/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Scolarité T2/ })).not.toBeChecked();
  await expect(page.getByText("Total à payer : 50 000 FCFA")).toBeVisible();
  await expect(page.getByLabel("Numéro mobile money qui paie")).toHaveValue("06 777 00 03");
  await page.getByRole("radio", { name: "MTN MoMo" }).check();
  await page.getByRole("button", { name: "Payer 50 000 FCFA" }).click();

  await expect(page).toHaveURL(/\/paiement\//);
  await expect(
    page.getByText(/Confirmez le paiement de 50 000 FCFA sur votre téléphone \(MTN MoMo/),
  ).toBeVisible();

  // Le prestataire confirme (message signé). Un message mal signé est rejeté.
  const providerRef = await withAdmin(
    async (c) =>
      (await c.query<{ ref: string }>("select provider_ref as ref from payment_intents")).rows[0]
        .ref,
  );
  const body = JSON.stringify({ providerRef, status: "succeeded", operatorRef: "MTN-555" });
  const forged = await request.post("/api/v1/payments/webhook", {
    data: body,
    headers: { "content-type": "application/json", "x-signature": "00".repeat(32) },
  });
  expect(forged.status()).toBe(401);
  const signature = createHmac("sha256", SECRET).update(body).digest("hex");
  for (let i = 0; i < 2; i++) {
    const response = await request.post("/api/v1/payments/webhook", {
      data: body,
      headers: { "content-type": "application/json", "x-signature": signature },
    });
    expect(response.status()).toBe(200);
  }

  // La page se met à jour toute seule : paiement reçu, reçu disponible.
  await expect(page.getByText("Paiement reçu. Merci !")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Reçu n° SJB-2026-\d{5}/)).toBeVisible();
  const payments = await withAdmin(
    async (c) =>
      (
        await c.query<{ amount: number; reference: string }>(
          "select amount, reference from payments",
        )
      ).rows,
  );
  expect(payments).toEqual([{ amount: 50000, reference: "MTN-555" }]);

  await page.getByRole("link", { name: "Retour à la page de mon enfant" }).click();
  await expect(page.getByText("Reste à payer")).toBeVisible();
  await expect(page.getByText("50 000 FCFA", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/en retard/)).toHaveCount(0);
});
