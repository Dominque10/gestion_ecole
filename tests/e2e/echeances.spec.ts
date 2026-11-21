import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { e2eDatabaseUrls, E2E_ACCOUNT } from "./env";

const ids: { first: string; second: string } = { first: "", second: "" };

// Année 2026-2027, 6e : inscription 25 000 + scolarité 3 × 50 000 ; fratrie 10 % ;
// deux enfants d'un même parent, pas encore inscrits.
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
    await client.query("update schools set sibling_discount_percent = 10 where id = $1", [school]);
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
      `insert into fee_items (school_id, academic_year_id, level_id, kind, name, installment_number, amount, due_date) values
         ($1, $2, $3, 'registration', 'Frais d''inscription', 1, 25000, '2026-09-15'),
         ($1, $2, $3, 'tuition', 'Scolarité', 1, 50000, '2026-10-01'),
         ($1, $2, $3, 'tuition', 'Scolarité', 2, 50000, '2027-01-04'),
         ($1, $2, $3, 'tuition', 'Scolarité', 3, 50000, '2027-04-12')`,
      [school, year, level],
    );
    const guardian = (
      await client.query<{ id: string }>(
        "insert into guardians (school_id, full_name, phone) values ($1, 'Awa Ngoma', '+242065551122') returning id",
        [school],
      )
    ).rows[0].id;
    for (const [key, name, n] of [
      ["first", "Bénédicte", 1],
      ["second", "Paul", 2],
    ] as const) {
      ids[key] = (
        await client.query<{ id: string }>(
          `insert into students (school_id, matricule, last_name, first_names, sex, search_text)
           values ($1, $2, 'NGOMA', $3, 'M', 'ngoma') returning id`,
          [school, `SJB-26-0000${n}`, name],
        )
      ).rows[0].id;
      await client.query(
        "insert into student_guardians (school_id, student_id, guardian_id, is_primary) values ($1, $2, $3, true)",
        [school, ids[key], guardian],
      );
    }
  } finally {
    await client.end();
  }
});

async function preEnroll(page: Page, studentId: string) {
  await page.goto(`/eleves/${studentId}`);
  await page.getByLabel("Niveau demandé").selectOption({ label: "6e" });
  await page.getByRole("button", { name: "Préinscrire" }).click();
  return page.getByRole("article").filter({ hasText: "2026-2027 · 6e" });
}

test("échéances créées à la préinscription, fratrie, bourse et remise du directeur", async ({
  page,
}) => {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill(E2E_ACCOUNT.schoolCode);
  await page.getByLabel("Téléphone ou email").fill(E2E_ACCOUNT.phoneLocal);
  await page.getByLabel("Mot de passe").fill(E2E_ACCOUNT.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/accueil$/);

  // Aînée : aucune réduction, 175 000 FCFA.
  let card = await preEnroll(page, ids.first);
  await expect(card).toContainText("Scolarité — tranche 3/3");
  await expect(card).toContainText("Total à payer : 175 000 FCFA");

  // Cadet : fratrie 10 % sur la scolarité (3 × 5 000), 160 000 FCFA.
  card = await preEnroll(page, ids.second);
  await expect(card).toContainText("Réduction : 5 000 FCFA (Fratrie 10 %)");
  await expect(card).toContainText("Total à payer : 160 000 FCFA");

  // Bourse de 50 % : 25 000 + 3 × 20 000 = 85 000 FCFA.
  await card.getByText("Accorder une bourse (directeur)").click();
  await card.getByRole("spinbutton", { name: "Pourcentage de la scolarité" }).fill("50");
  await card.getByRole("textbox", { name: "Motif" }).fill("Excellents résultats");
  await card.getByRole("button", { name: "Accorder la bourse" }).click();
  await expect(
    card.getByRole("status").filter({ hasText: "Bourse accordée sur 3 échéance(s)." }),
  ).toBeVisible();
  await expect(card).toContainText("Total à payer : 85 000 FCFA");

  // Remise exceptionnelle de 5 000 sur l'inscription : 80 000 FCFA.
  await card.getByText("Remise exceptionnelle (directeur)").click();
  await card.getByLabel("Échéance").selectOption({ label: "Frais d'inscription — 25 000 FCFA" });
  await card.getByRole("textbox", { name: "Montant de la remise (FCFA)" }).fill("5 000");
  await card.getByRole("textbox", { name: "Motif" }).last().fill("Famille en difficulté");
  await card.getByRole("button", { name: "Accorder la remise" }).click();
  await expect(card).toContainText("Total à payer : 80 000 FCFA");
});
