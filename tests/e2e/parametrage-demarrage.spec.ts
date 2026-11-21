import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { e2eDatabaseUrls, E2E_ACCOUNT } from "./env";

async function withAdmin<T>(fn: (client: pg.Client, schoolId: string) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: e2eDatabaseUrls().admin });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>("select id from schools where code = $1", [
      E2E_ACCOUNT.schoolCode,
    ]);
    return await fn(client, rows[0].id);
  } finally {
    await client.end();
  }
}

// Chaque test repart d'une école sans paramétrage (TRUNCATE contourne les garde-fous, voulu ici).
test.beforeEach(async () => {
  await withAdmin(async (client, schoolId) => {
    await client.query("truncate levels, subjects, academic_years, time_slots cascade");
    await client.query("update schools set address = null, phone = null where id = $1", [schoolId]);
    // Seul le directeur reste membre de l'école (d'autres tests y ajoutent du personnel).
    await client.query(
      "delete from memberships where school_id = $1 and user_id <> (select id from users where phone = $2)",
      [schoolId, E2E_ACCOUNT.phone],
    );
  });
});

async function loginAsDirector(page: Page) {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill(E2E_ACCOUNT.schoolCode);
  await page.getByLabel("Téléphone ou email").fill(E2E_ACCOUNT.phoneLocal);
  await page.getByLabel("Mot de passe").fill(E2E_ACCOUNT.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/accueil$/);
}

test("l'assistant de démarrage guide le directeur étape par étape", async ({ page }) => {
  await loginAsDirector(page);
  await expect(page.getByText("Paramétrage en cours : 0 étape(s) sur 9.")).toBeVisible();
  await page.getByRole("link", { name: "Reprendre le démarrage" }).click();

  await expect(page.getByText("0 étape(s) sur 9 terminée(s)")).toBeVisible();
  await page
    .getByRole("link", { name: "Continuer : Fiche de l'école (adresse, téléphone, logo)" })
    .click();
  await expect(page.getByRole("heading", { name: "Fiche de l'école" })).toBeVisible();
  await page.getByRole("textbox", { name: "Adresse", exact: true }).fill("Moungali, Brazzaville");
  await page.getByRole("button", { name: "Enregistrer la fiche" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Fiche enregistrée." })).toBeVisible();

  await page.goto("/parametres/demarrage");
  await expect(page.getByText("1 étape(s) sur 9 terminée(s)")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Continuer : Année scolaire et trimestres" }),
  ).toBeVisible();
  const first = page.getByRole("listitem").filter({ hasText: "1. Fiche de l'école" });
  await expect(first.getByText("Fait")).toBeVisible();
});

test("le directeur reprend la structure de l'année en cours pour préparer la suivante", async ({
  page,
}) => {
  await withAdmin(async (client, school) => {
    const y1 = (
      await client.query<{ id: string }>(
        `insert into academic_years (school_id, label, start_date, end_date)
         values ($1, '2026-2027', '2026-10-01', '2027-06-30') returning id`,
        [school],
      )
    ).rows[0].id;
    await client.query(
      `insert into academic_years (school_id, label, start_date, end_date)
       values ($1, '2027-2028', '2027-10-01', '2028-06-30')`,
      [school],
    );
    const level = (
      await client.query<{ id: string }>(
        `insert into levels (school_id, cycle, name, position) values ($1, 'college', '6e', 1) returning id`,
        [school],
      )
    ).rows[0].id;
    await client.query(
      `insert into classes (school_id, academic_year_id, level_id, name) values ($1, $2, $3, '6e A')`,
      [school, y1, level],
    );
    await client.query(
      `insert into fee_items (school_id, academic_year_id, level_id, kind, name, installment_number, amount, due_date)
       values ($1, $2, $3, 'tuition', 'Scolarité', 1, 90000, '2026-10-01')`,
      [school, y1, level],
    );
  });

  await loginAsDirector(page);
  await page.goto("/parametres/annees");
  await page.getByRole("link").filter({ hasText: "2027-2028" }).click();
  await expect(
    page.getByRole("heading", { name: "Reprendre la structure d'une autre année" }),
  ).toBeVisible();
  await page.getByLabel("Année à copier").selectOption({ label: "2026-2027" });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Copier dans 2027-2028" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Structure copiée : 1 classe(s), 0 coefficient(s), 1 tranche(s)" }),
  ).toBeVisible();

  // Une seconde copie est refusée : l'année n'est plus vide.
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Copier dans 2027-2028" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "la copie est réservée à une année vide" }),
  ).toBeVisible();

  await page.goto("/parametres/frais");
  await page.getByLabel("Année").selectOption({ label: "2027-2028 (En préparation)" });
  await page.getByRole("button", { name: "Afficher" }).click();
  await expect(page.getByRole("region", { name: "6e" })).toContainText(
    "Tranche 1 : 90 000 FCFA, au plus tard le 1 oct. 2027",
  );
});
