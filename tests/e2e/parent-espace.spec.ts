import { existsSync, readFileSync, rmSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { seedNotes, withAdmin } from "./notes-data";

const OUTBOX = "test-results/sms-outbox.jsonl";
const PARENT_PHONE = "+242067770002";

// ADA (6e A) : responsable 06 777 00 02 ; une échéance échue de 50 000 dont 20 000 payés, un bulletin
// publié du 1er trimestre, une absence non justifiée.
test.beforeEach(async () => {
  const data = await seedNotes();
  if (existsSync(OUTBOX)) rmSync(OUTBOX);
  await withAdmin(async (client) => {
    await client.query("delete from users where phone = $1", [PARENT_PHONE]);
    const ada = (
      await client.query<{ enrollment: string; student: string; teacher: string }>(
        `select e.id as enrollment, s.id as student,
                (select user_id from memberships where school_id = $1 limit 1) as teacher
         from enrollments e join students s on s.id = e.student_id where s.last_name = 'ADA'`,
        [data.school],
      )
    ).rows[0];
    const guardian = (
      await client.query<{ id: string }>(
        "insert into guardians (school_id, full_name, phone) values ($1, 'Mère d''Ada', $2) returning id",
        [data.school, PARENT_PHONE],
      )
    ).rows[0].id;
    await client.query(
      "insert into student_guardians (school_id, student_id, guardian_id, is_primary) values ($1, $2, $3, true)",
      [data.school, ada.student, guardian],
    );
    const invoice = (
      await client.query<{ id: string }>(
        `insert into invoices (school_id, academic_year_id, enrollment_id, fee_name, kind, mandatory,
           installment_number, installment_count, amount, due_date)
         values ($1, $2, $3, 'Scolarité', 'tuition', true, 1, 1, 50000, '2026-10-15') returning id`,
        [data.school, data.year, ada.enrollment],
      )
    ).rows[0].id;
    const payment = (
      await client.query<{ id: string }>(
        `insert into payments (school_id, academic_year_id, enrollment_id, amount, method, receipt_number, cashier_id)
         values ($1, $2, $3, 20000, 'cash', 'SJB-2026-00001', $4) returning id`,
        [data.school, data.year, ada.enrollment, ada.teacher],
      )
    ).rows[0].id;
    await client.query(
      "insert into payment_allocations (school_id, payment_id, invoice_id, amount) values ($1, $2, $3, 20000)",
      [data.school, payment, invoice],
    );
    const period = (
      await client.query<{ id: string }>(
        "select id from periods where academic_year_id = $1 and position = 1",
        [data.year],
      )
    ).rows[0].id;
    const snapshot = {
      version: 1,
      enrollmentId: ada.enrollment,
      yearLabel: "2026-2027",
      className: "6e A",
      levelName: "6e",
      headTeacherName: null,
      classSize: 2,
      annual: false,
      periodLabel: "Trimestre 1",
      scale: 20,
      student: {
        matricule: "SJB-26-00001",
        lastName: "ADA",
        firstNames: "Test",
        sex: "F",
        birthDate: null,
      },
      subjects: [],
      totalCoefficients: 0,
      totalPoints: 0,
      periods: [],
      average: 14,
      rank: 1,
      tied: false,
      mention: "Encouragements",
      classStats: { average: 12, highest: 14, lowest: 10 },
      generalComment: "Très bon trimestre.",
      attendance: { absences: 1, unjustified: 1, lates: 0 },
      decision: null,
      councilDate: null,
    };
    await client.query(
      `insert into report_cards (school_id, academic_year_id, enrollment_id, kind, period_id,
         council_validated_at, council_validated_by, published_at, published_by, snapshot)
       values ($1, $2, $3, 'period', $4, now(), $5, now(), $5, $6)`,
      [data.school, data.year, ada.enrollment, period, ada.teacher, snapshot],
    );
    const slot = (
      await client.query<{ id: string }>(
        "insert into time_slots (school_id, label, start_time, end_time) values ($1, 'Matin', '07:30', '12:30') returning id",
        [data.school],
      )
    ).rows[0].id;
    await client.query(
      `insert into attendance (school_id, academic_year_id, enrollment_id, date, time_slot_id, status, recorded_by)
       values ($1, $2, $3, '2026-11-10', $4, 'absent', $5)`,
      [data.school, data.year, ada.enrollment, slot, ada.teacher],
    );
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

test("le parent voit les frais, le bulletin et les absences de son enfant, sur une page légère", async ({
  page,
}) => {
  // Première page de l'espace parents (connexion), première visite : moins de 300 Ko.
  const first = await page.context().newCDPSession(page);
  await first.send("Network.enable");
  let firstBytes = 0;
  first.on("Network.loadingFinished", (event) => {
    firstBytes += event.encodedDataLength;
  });
  await page.goto("/parent/connexion", { waitUntil: "networkidle" });
  console.log(`page de connexion des parents : ${Math.round(firstBytes / 1024)} Ko transférés`);
  expect(firstBytes).toBeLessThan(300 * 1024);
  await first.detach();

  await page.getByLabel("Votre numéro de téléphone").fill("06 777 00 02");
  await page.getByRole("button", { name: "Recevoir mon code" }).click();
  await expect(page.getByText(/un code vient de vous être envoyé/)).toBeVisible();
  await page.getByLabel("Code reçu par SMS (6 chiffres)").fill(lastCode());
  await page.getByRole("button", { name: "Entrer" }).click();
  await page.getByRole("button", { name: /ADA Test/ }).click();
  await expect(page).toHaveURL(/\/parent\/enfant\//);
  const childUrl = page.url();

  // Poids de la page d'un enfant, chargée sans cache (critère : moins de 300 Ko transférés).
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  // Sans le service worker (qui servirait les fichiers depuis son cache) : poids d'une première visite.
  await cdp.send("Network.setBypassServiceWorker", { bypass: true });
  let bytes = 0;
  cdp.on("Network.loadingFinished", (event) => {
    bytes += event.encodedDataLength;
  });
  await page.goto(childUrl, { waitUntil: "networkidle" });
  console.log(`page d'un enfant : ${Math.round(bytes / 1024)} Ko transférés`);
  expect(bytes).toBeLessThan(300 * 1024);

  // Frais : reste à payer, dont en retard ; le reçu.
  await expect(page.getByText("Reste à payer")).toBeVisible();
  await expect(page.getByText(/Dont 30\s000 FCFA en retard/)).toBeVisible();
  await page.getByText("Mes reçus (1)").click();
  await expect(page.getByText(/Reçu SJB-2026-00001/)).toBeVisible();

  // Bulletin publié : téléchargement.
  await expect(page.getByText("Bulletin — Trimestre 1")).toBeVisible();
  const download = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: "Télécharger le bulletin" }).click();
  expect((await download).suggestedFilename()).toBe("bulletin-SJB-26-00001-Trimestre-1.pdf");

  // Absences.
  await expect(page.getByText(/1 absence\(s\) dont 1 non justifiée\(s\)/)).toBeVisible();
  await expect(page.getByText("Non justifiée", { exact: true })).toBeVisible();
});
