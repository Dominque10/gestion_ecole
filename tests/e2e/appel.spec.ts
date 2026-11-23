import { expect, test, type Page } from "@playwright/test";
import { E2E_ACCOUNT } from "./env";
import { seedNotes, withAdmin, type NotesData } from "./notes-data";

let data: NotesData;
let morning: string;
let afternoon: string;

// 6e A : ADA, BOB et 58 autres élèves (60 en tout) ; créneaux Matin et Après-midi.
test.beforeEach(async () => {
  data = await seedNotes();
  ({ morning, afternoon } = await withAdmin(async (client) => {
    await client.query("delete from time_slots where school_id = $1", [data.school]);
    const slot = async (label: string, start: string, end: string) =>
      (
        await client.query<{ id: string }>(
          "insert into time_slots (school_id, label, start_time, end_time) values ($1, $2, $3, $4) returning id",
          [data.school, label, start, end],
        )
      ).rows[0].id;
    const ids = {
      morning: await slot("Matin", "07:30", "12:30"),
      afternoon: await slot("Après-midi", "15:00", "18:00"),
    };
    const level = (
      await client.query<{ id: string }>("select level_id as id from classes where id = $1", [
        data.classId,
      ])
    ).rows[0].id;
    for (let i = 1; i <= 58; i++) {
      const name = `ELEVE${String(i).padStart(2, "0")}`;
      const student = (
        await client.query<{ id: string }>(
          `insert into students (school_id, matricule, last_name, first_names, sex, search_text)
           values ($1, $2, $3, 'Test', 'M', lower($3)) returning id`,
          [data.school, `SJB-26-1${String(i).padStart(4, "0")}`, name],
        )
      ).rows[0].id;
      await client.query(
        `insert into enrollments (school_id, student_id, academic_year_id, level_id, class_id, status,
           validation_mode, validated_at, entry_date)
         values ($1, $2, $3, $4, $5, 'enrolled', 'manual', now(), '2026-10-01')`,
        [data.school, student, data.year, level, data.classId],
      );
    }
    // Responsable principal d'ADA et de BOB (destinataire du SMS d'absence).
    const guardian = (
      await client.query<{ id: string }>(
        "insert into guardians (school_id, full_name, phone) values ($1, 'Parent Test', '+242065550000') returning id",
        [data.school],
      )
    ).rows[0].id;
    await client.query(
      `insert into student_guardians (school_id, student_id, guardian_id, is_primary)
       select $1, id, $2, true from students where last_name in ('ADA', 'BOB')`,
      [data.school, guardian],
    );
    return ids;
  }));
});

async function login(page: Page) {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill(E2E_ACCOUNT.schoolCode);
  await page.getByLabel("Téléphone ou email").fill(E2E_ACCOUNT.phoneLocal);
  await page.getByLabel("Mot de passe").fill(E2E_ACCOUNT.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/accueil$/);
}

const marksInDb = () =>
  withAdmin(async (client) => {
    const { rows } = await client.query<{ name: string; slot: string; status: string }>(
      `select s.last_name as name, ts.label as slot, a.status
       from attendance a join enrollments e on e.id = a.enrollment_id
       join students s on s.id = e.student_id join time_slots ts on ts.id = a.time_slot_id
       where a.status <> 'present' order by ts.start_time, s.last_name`,
    );
    return rows.map((r) => `${r.slot} ${r.name} ${r.status}`);
  });

test("appel de 60 élèves en moins d'une minute, SMS programmé, justification, puis appel sans réseau", async ({
  page,
  context,
}) => {
  await login(page);
  await page.getByRole("link", { name: "Appel", exact: true }).click();
  await page.getByRole("link", { name: "6e A" }).click();
  await page.goto(`/appel/${data.classId}?creneau=${morning}`);
  await expect(page.getByText("Appel pas encore fait pour ce créneau.")).toBeVisible();
  await expect(page.getByText("60 présent(s), 0 absent(s), 0 retard(s)")).toBeVisible();

  // L'appel : 2 absents et 1 retard, tous les autres présents par défaut.
  const started = Date.now();
  await page.getByRole("button", { name: "BOB Test absent" }).click();
  await page.getByRole("button", { name: "ELEVE17 Test absent" }).click();
  await page.getByRole("button", { name: "ELEVE42 Test en retard" }).click();
  await expect(page.getByText("57 présent(s), 2 absent(s), 1 retard(s)")).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer l'appel" }).click();
  await expect(page.locator("p[role=status]").last()).toHaveText("Appel enregistré.");
  expect(Date.now() - started).toBeLessThan(60_000);
  expect(await marksInDb()).toEqual([
    "Matin BOB absent",
    "Matin ELEVE17 absent",
    "Matin ELEVE42 late",
  ]);
  const total = await withAdmin(async (c) => (await c.query("select 1 from attendance")).rowCount);
  expect(total).toBe(60);
  // SMS du jour programmé pour chaque absent (envoi 30 min plus tard).
  const jobs = await withAdmin(
    async (c) =>
      (
        await c.query(
          `select 1 from pgboss.job where name = 'notifications' and state = 'created'
           and data->>'enrollmentId' in (select id::text from enrollments)`,
        )
      ).rowCount,
  );
  expect(jobs).toBe(2);

  // Le secrétariat (ici le directeur) justifie l'absence de BOB.
  await page.goto("/absences");
  const bob = page.locator("li", { hasText: "BOB Test" }).first();
  await expect(bob).toContainText("Matin : absent");
  await expect(bob).toContainText("Pas de SMS envoyé au parent");
  await bob.getByText("Justifier cette journée").click();
  await bob.getByLabel("Motif").fill("Maladie (certificat médical)");
  await bob.getByRole("button", { name: "Enregistrer la justification" }).click();
  await expect(page.locator("li", { hasText: "BOB Test" })).toHaveCount(0);

  // Appel de l'après-midi sans réseau : enregistré sur le téléphone, envoyé au retour.
  await page.goto(`/appel/${data.classId}?creneau=${afternoon}`);
  await page.waitForFunction(async () => {
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller !== null;
  });
  await context.setOffline(true);
  await page.goto("/appel");
  await expect(page).toHaveURL(/\/notes\/hors-ligne/);
  await page.getByRole("link", { name: "Appel — 6e A" }).click();
  await page.getByLabel("Créneau").selectOption({ label: "Après-midi" });
  await page.getByRole("button", { name: "ADA Test absent" }).click();
  await page.getByRole("button", { name: "Enregistrer l'appel" }).click();
  await expect(page.getByText("Appel enregistré sur ce téléphone")).toBeVisible();
  expect(await marksInDb()).not.toContain("Après-midi ADA absent");

  await context.setOffline(false);
  await expect.poll(marksInDb, { timeout: 15_000 }).toContain("Après-midi ADA absent");
});
