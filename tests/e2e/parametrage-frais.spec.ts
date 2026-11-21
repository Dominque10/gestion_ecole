import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { e2eDatabaseUrls, E2E_ACCOUNT } from "./env";

// École préparée en base : année 2026-2027 en 3 trimestres, niveaux 6e et 5e, aucun créneau.
test.beforeEach(async () => {
  const client = new pg.Client({ connectionString: e2eDatabaseUrls().admin });
  await client.connect();
  try {
    await client.query("truncate levels, subjects, academic_years, time_slots cascade");
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
    await client.query(
      `insert into periods (school_id, academic_year_id, position, label, start_date, end_date) values
         ($1, $2, 1, '1er trimestre', '2026-10-01', '2026-12-31'),
         ($1, $2, 2, '2e trimestre', '2027-01-01', '2027-03-31'),
         ($1, $2, 3, '3e trimestre', '2027-04-01', '2027-06-30')`,
      [school, year],
    );
    await client.query(
      `insert into levels (school_id, cycle, name, position)
       values ($1, 'college', '6e', 1), ($1, 'college', '5e', 2)`,
      [school],
    );
  } finally {
    await client.end();
  }
});

async function loginAsDirector(page: Page) {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill(E2E_ACCOUNT.schoolCode);
  await page.getByLabel("Téléphone ou email").fill(E2E_ACCOUNT.phoneLocal);
  await page.getByLabel("Mot de passe").fill(E2E_ACCOUNT.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/accueil$/);
}

test("le directeur définit les créneaux de la journée", async ({ page }) => {
  await loginAsDirector(page);
  await page.getByRole("link", { name: "Créneaux" }).click();
  await page.getByRole("textbox", { name: "Nom du créneau" }).fill("Matin");
  await page.getByLabel("Début").fill("07:30");
  await page.getByLabel("Fin").fill("12:00");
  await page.getByRole("button", { name: "Ajouter le créneau" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Créneau « Matin » ajouté." }),
  ).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Matin" })).toContainText(
    "07:30 – 12:00",
  );

  // Fin avant le début : refusé.
  await page.getByRole("textbox", { name: "Nom du créneau" }).fill("Soir");
  await page.getByLabel("Début").fill("18:00");
  await page.getByLabel("Fin").fill("17:00");
  await page.getByRole("button", { name: "Ajouter le créneau" }).click();
  await expect(page.getByText("L'heure de fin doit être après l'heure de début.")).toBeVisible();
});

test("le directeur fixe la scolarité du collège en 3 tranches", async ({ page }) => {
  await loginAsDirector(page);
  await page.getByRole("link", { name: "Frais de scolarité" }).click();
  await expect(page.getByText("Aucun frais pour ce niveau.")).toHaveCount(2);

  await page.getByRole("textbox", { name: "Nom du frais" }).fill("Scolarité");
  await page.getByRole("checkbox", { name: "6e" }).check();
  await page.getByRole("checkbox", { name: "5e" }).check();
  await page.getByRole("textbox", { name: "Montant total (FCFA)" }).fill("100 000");
  await page.getByLabel("Nombre de tranches").selectOption("3");
  await page.getByRole("button", { name: "Calculer les tranches" }).click();

  // Arrondi à 100 FCFA, reste sur la dernière tranche, échéances aux débuts de trimestre.
  await expect(page.getByLabel("Montant de la tranche 1 (FCFA)")).toHaveValue("33 300");
  await expect(page.getByLabel("Montant de la tranche 3 (FCFA)")).toHaveValue("33 400");
  await expect(page.getByLabel("Date limite de la tranche 2")).toHaveValue("2027-01-01");
  await expect(page.getByText("Somme des tranches : 100 000 FCFA")).toBeVisible();

  // Un montant invalide est refusé, sans perdre le nom ni les niveaux cochés.
  await page.getByLabel("Montant de la tranche 2 (FCFA)").fill("33 300,50");
  await page.getByRole("button", { name: "Enregistrer le frais" }).click();
  await expect(page.getByText("Montant de tranche invalide")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Nom du frais" })).toHaveValue("Scolarité");
  await expect(page.getByRole("checkbox", { name: "6e" })).toBeChecked();

  await page.getByLabel("Montant de la tranche 2 (FCFA)").fill("33 300");
  await page.getByRole("button", { name: "Enregistrer le frais" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Frais « Scolarité » enregistré." }),
  ).toBeVisible();

  const sixieme = page.getByRole("region", { name: "6e" });
  await expect(sixieme).toContainText("Total obligatoire : 100 000 FCFA");
  await expect(sixieme).toContainText("Tranche 3 : 33 400 FCFA, au plus tard le 1 avr. 2027");

  // Modification pour la 6e seulement : 120 000 FCFA en 2 tranches.
  await sixieme.getByRole("link", { name: "Modifier" }).click();
  await expect(page.getByRole("heading", { name: "Modifier « Scolarité » (6e)" })).toBeVisible();
  await page.getByRole("textbox", { name: "Montant total (FCFA)" }).fill("120000");
  await page.getByLabel("Nombre de tranches").selectOption("2");
  await page.getByRole("button", { name: "Calculer les tranches" }).click();
  await page.getByRole("button", { name: "Enregistrer le frais" }).click();
  await expect(page.getByRole("region", { name: "6e" })).toContainText("120 000 FCFA");
  await expect(page.getByRole("region", { name: "5e" })).toContainText("100 000 FCFA");
});
