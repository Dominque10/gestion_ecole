import { expect, test, type Page } from "@playwright/test";
import { hash } from "@node-rs/argon2";
import pg from "pg";
import { e2eDatabaseUrls, E2E_ACCOUNT, E2E_ACCOUNTANT } from "./env";

let studentId: string;

// 2026-2027, 6e : inscription 25 000 + scolarité 2 × 50 000. NGOMA Paul préinscrit avec ses échéances.
// Un comptable existe dans l'école (créé ici s'il manque).
test.beforeEach(async () => {
  const client = new pg.Client({ connectionString: e2eDatabaseUrls().admin });
  await client.connect();
  try {
    await client.query(
      "truncate students, guardians, levels, subjects, academic_years, cash_closures cascade",
    );
    const school = (
      await client.query<{ id: string }>("select id from schools where code = $1", [
        E2E_ACCOUNT.schoolCode,
      ])
    ).rows[0].id;
    const accountant = (
      await client.query<{ id: string }>(
        `insert into users (name, phone, password_hash) values ($1, $2, $3)
         on conflict (phone) do update set password_hash = excluded.password_hash returning id`,
        [E2E_ACCOUNTANT.name, E2E_ACCOUNTANT.phone, await hash(E2E_ACCOUNTANT.password)],
      )
    ).rows[0].id;
    await client.query(
      `insert into memberships (school_id, user_id, roles) values ($1, $2, '{accountant}')
       on conflict (school_id, user_id) do update set roles = '{accountant}'`,
      [school, accountant],
    );
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
    studentId = (
      await client.query<{ id: string }>(
        `insert into students (school_id, matricule, last_name, first_names, sex, search_text)
         values ($1, 'SJB-26-00001', 'NGOMA', 'Paul', 'M', 'ngoma paul sjb-26-00001') returning id`,
        [school],
      )
    ).rows[0].id;
    const enrollment = (
      await client.query<{ id: string }>(
        `insert into enrollments (school_id, student_id, academic_year_id, level_id, entry_date)
         values ($1, $2, $3, $4, '2026-10-01') returning id`,
        [school, studentId, year, level],
      )
    ).rows[0].id;
    await client.query(
      `insert into invoices (school_id, academic_year_id, enrollment_id, fee_name, kind, mandatory,
         installment_number, installment_count, amount, due_date) values
         ($1, $2, $3, 'Frais d''inscription', 'registration', true, 1, 1, 25000, '2026-09-15'),
         ($1, $2, $3, 'Scolarité', 'tuition', true, 1, 2, 50000, '2026-10-01'),
         ($1, $2, $3, 'Scolarité', 'tuition', true, 2, 2, 50000, '2027-01-04')`,
      [school, year, enrollment],
    );
  } finally {
    await client.end();
  }
});

async function login(page: Page, phoneLocal: string, password: string) {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill(E2E_ACCOUNT.schoolCode);
  await page.getByLabel("Téléphone ou email").fill(phoneLocal);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/accueil$/);
}

test("le comptable encaisse et édite le reçu ; le directeur valide une annulation", async ({
  page,
}) => {
  // 1. Le comptable retrouve l'élève et encaisse 30 000 FCFA en espèces.
  await login(page, E2E_ACCOUNTANT.phoneLocal, E2E_ACCOUNTANT.password);
  await page.getByRole("link", { name: "Caisse", exact: true }).click();
  await page.getByRole("searchbox", { name: "Rechercher l'élève" }).fill("ngoma");
  await page.getByRole("button", { name: "Rechercher" }).click();
  await page.getByRole("link", { name: "Encaisser" }).click();
  await expect(page.getByText("Reste à payer : 125 000 FCFA")).toBeVisible();

  // Trop-perçu refusé.
  await page.getByRole("textbox", { name: "Montant reçu (FCFA)" }).fill("130 000");
  await page.getByRole("button", { name: "Encaisser et éditer le reçu" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "il reste 125" })).toBeVisible();

  await page.getByRole("textbox", { name: "Montant reçu (FCFA)" }).fill("30 000");
  await page.getByRole("button", { name: "Encaisser et éditer le reçu" }).click();

  // 2. Reçu : numéro, détail, reste à payer ; l'inscription est validée par le paiement.
  await expect(page.getByRole("heading", { name: "Reçu n° SJB-2026-00001" })).toBeVisible();
  await expect(page.getByText("Montant reçu : 30 000 FCFA")).toBeVisible();
  await expect(page.getByText("Reste à payer après ce paiement : 95 000 FCFA")).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "l'inscription est validée" }),
  ).toBeVisible();

  // PDF du reçu, produit par le worker, puis téléchargé.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Télécharger le reçu (PDF)" }).click();
  expect((await download).suggestedFilename()).toBe("recu-SJB-2026-00001.pdf");

  // 3. Le comptable demande l'annulation depuis la fiche de l'élève.
  await page.goto(`/eleves/${studentId}`);
  const card = page.getByRole("article").filter({ hasText: "2026-2027 · 6e" });
  await expect(card).toContainText("Validée au paiement");
  await card.getByText("Demander l'annulation").click();
  await card.getByRole("textbox", { name: "Motif de l'annulation" }).fill("Erreur d'élève");
  await card.getByRole("button", { name: "Envoyer la demande au directeur" }).click();
  await expect(card.getByText("Annulation demandée")).toBeVisible();
  await page.goto("/accueil");
  await page.getByRole("button", { name: "Se déconnecter" }).click();

  // 4. Le directeur valide l'annulation : écriture inverse, le reste à payer revient à 125 000.
  await login(page, E2E_ACCOUNT.phoneLocal, E2E_ACCOUNT.password);
  await page.getByRole("link", { name: "Annulations à décider" }).click();
  await expect(
    page.getByRole("heading", { name: "Demandes d'annulation à décider (1)" }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Valider l'annulation" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Annulation validée." })).toBeVisible();

  await page.goto(`/eleves/${studentId}`);
  const after = page.getByRole("article").filter({ hasText: "2026-2027 · 6e" });
  await expect(after.getByText("Annulé", { exact: true })).toBeVisible();
  await expect(after).toContainText("Reste à payer : 125 000 FCFA");
});

test("clôture de caisse avec écart, encaissement bloqué, réouverture par le directeur ; impayés", async ({
  page,
}) => {
  await login(page, E2E_ACCOUNTANT.phoneLocal, E2E_ACCOUNTANT.password);
  await page.goto(`/caisse?eleve=${studentId}`);
  await page.getByRole("textbox", { name: "Montant reçu (FCFA)" }).fill("30 000");
  await page.getByRole("button", { name: "Encaisser et éditer le reçu" }).click();
  await expect(page.getByRole("heading", { name: /Reçu n° SJB-2026-/ })).toBeVisible();

  // Clôture : 30 000 attendus en espèces, 29 500 comptés → écart de −500.
  await page.goto("/caisse/cloture");
  await expect(page.getByText("Total des reçus : 30 000 FCFA")).toBeVisible();
  await expect(page.getByText("Espèces attendues dans la caisse : 30 000 FCFA")).toBeVisible();
  await page.getByRole("textbox", { name: "Espèces comptées (FCFA)" }).fill("29 500");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Clôturer la caisse" }).click();
  await expect(page.getByText("Clôturée", { exact: true })).toBeVisible();
  await expect(page.getByText("Écart : -500 FCFA").first()).toBeVisible();

  // Plus d'encaissement aujourd'hui.
  await page.goto(`/caisse?eleve=${studentId}`);
  await page.getByRole("textbox", { name: "Montant reçu (FCFA)" }).fill("1 000");
  await page.getByRole("button", { name: "Encaisser et éditer le reçu" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "clôturée pour aujourd'hui" }),
  ).toBeVisible();
  await page.goto("/accueil");
  await page.getByRole("button", { name: "Se déconnecter" }).click();

  // Le directeur voit la clôture et la rouvre, avec un motif ; il consulte les impayés.
  await login(page, E2E_ACCOUNT.phoneLocal, E2E_ACCOUNT.password);
  await page.getByRole("link", { name: "Clôtures de caisse" }).click();
  await expect(page.getByText(/· Jean Comptable/)).toBeVisible();
  await page.getByText("Rouvrir cette caisse").click();
  await page.getByRole("textbox", { name: "Motif de la réouverture" }).fill("Encaissement oublié");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Rouvrir" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Caisse rouverte." })).toBeVisible();

  await page.getByRole("link", { name: "Accueil" }).click();
  await page.getByRole("link", { name: "Impayés" }).click();
  // Inscription soldée, 1re tranche (due le 1er octobre) : 45 000 restant en retard.
  await expect(page.getByText("Total en retard : 45 000 FCFA (1 élève(s))")).toBeVisible();
  await expect(page.getByRole("link", { name: "NGOMA Paul" })).toBeVisible();
});
