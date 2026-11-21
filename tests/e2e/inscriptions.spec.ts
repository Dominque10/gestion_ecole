import { expect, test } from "@playwright/test";
import pg from "pg";
import { e2eDatabaseUrls, E2E_ACCOUNT } from "./env";

let studentId: string;

// École préparée : année 2026-2027, niveau 6e, classe « 6e A » (1 place), un élève.
test.beforeEach(async () => {
  const client = new pg.Client({ connectionString: e2eDatabaseUrls().admin });
  await client.connect();
  try {
    await client.query("truncate students, guardians, levels, subjects, academic_years cascade");
    const school = (
      await client.query<{ id: string }>("select id from schools where code = $1", [
        E2E_ACCOUNT.schoolCode,
      ])
    ).rows[0].id;
    const year = (
      await client.query<{ id: string }>(
        `insert into academic_years (school_id, label, start_date, end_date)
         values ($1, '2026-2027', '2026-10-01', '2027-06-30') returning id`,
        [school],
      )
    ).rows[0].id;
    const level = (
      await client.query<{ id: string }>(
        "insert into levels (school_id, cycle, name, position) values ($1, 'college', '6e', 1) returning id",
        [school],
      )
    ).rows[0].id;
    await client.query(
      "insert into classes (school_id, academic_year_id, level_id, name, capacity) values ($1, $2, $3, '6e A', 1)",
      [school, year, level],
    );
    studentId = (
      await client.query<{ id: string }>(
        `insert into students (school_id, matricule, last_name, first_names, sex, search_text)
         values ($1, 'SJB-26-00001', 'NGOMA', 'Paul', 'M', 'ngoma paul sjb-26-00001') returning id`,
        [school],
      )
    ).rows[0].id;
    const guardian = (
      await client.query<{ id: string }>(
        "insert into guardians (school_id, full_name, phone) values ($1, 'Awa Ngoma', '+242065551122') returning id",
        [school],
      )
    ).rows[0].id;
    await client.query(
      "insert into student_guardians (school_id, student_id, guardian_id, is_primary) values ($1, $2, $3, true)",
      [school, studentId, guardian],
    );
  } finally {
    await client.end();
  }
});

test("préinscription, validation, affectation en classe puis départ", async ({ page }) => {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill(E2E_ACCOUNT.schoolCode);
  await page.getByLabel("Téléphone ou email").fill(E2E_ACCOUNT.phoneLocal);
  await page.getByLabel("Mot de passe").fill(E2E_ACCOUNT.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/accueil$/);

  await page.goto(`/eleves/${studentId}`);
  await expect(page.getByText("Pas encore d'inscription.")).toBeVisible();

  // 1. Préinscription en 6e pour 2026-2027.
  await page.getByLabel("Niveau demandé").selectOption({ label: "6e" });
  await page.getByRole("button", { name: "Préinscrire" }).click();
  const card = page.getByRole("article").filter({ hasText: "2026-2027 · 6e" });
  await expect(card.getByText("Préinscrit", { exact: true })).toBeVisible();

  // 2. Validation manuelle.
  await card.getByRole("button", { name: "Valider l'inscription" }).click();
  await expect(card.getByText("Inscrit", { exact: true })).toBeVisible();
  await expect(card).toContainText("Validée à la main");

  // 3. Affectation en 6e A (1 place libre).
  await card.getByLabel("Classe").selectOption({ label: "6e A (1 place(s) libre(s))" });
  await card.getByRole("button", { name: "Enregistrer la classe" }).click();
  await expect(card).toContainText("Classe : 6e A");

  // 4. Départ (transfert), après confirmation.
  await card.getByText("Enregistrer un départ").click();
  await card.getByLabel("Motif").selectOption({ label: "Transfert" });
  await card.getByLabel("Date de départ").fill("2099-02-10");
  await card.getByRole("textbox", { name: "Précision" }).fill("École Saint-Michel");
  page.once("dialog", (dialog) => dialog.accept());
  await card.getByRole("button", { name: "Enregistrer le départ" }).click();
  await expect(card.getByText("Parti", { exact: true })).toBeVisible();
  await expect(card).toContainText("Transfert le 10 févr. 2099 · École Saint-Michel");
  await expect(card).toContainText("Classe : 6e A");
});
