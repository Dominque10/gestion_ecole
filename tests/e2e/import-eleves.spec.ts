import { expect, test } from "@playwright/test";
import pg from "pg";
import { e2eDatabaseUrls, E2E_ACCOUNT } from "./env";

const HEADERS =
  "Nom;Prénoms;Sexe (F ou M);Date de naissance (JJ/MM/AAAA);Lieu de naissance;Nationalité;École d'origine;Nom du responsable;Téléphone du responsable;Lien avec l'élève;Autre téléphone;Niveau;Classe";

const file = (lines: string[]) => ({
  name: "eleves.csv",
  mimeType: "text/csv",
  buffer: Buffer.from(`﻿${[HEADERS, ...lines].join("\r\n")}`, "utf-8"),
});

// École avec une année en préparation et le niveau 6e, sans élève.
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
    await client.query("update schools set last_matricule_number = 0 where id = $1", [school]);
    await client.query(
      `insert into academic_years (school_id, label, start_date, end_date)
       values ($1, '2026-2027', '2026-10-01', '2027-06-30')`,
      [school],
    );
    await client.query(
      "insert into levels (school_id, cycle, name, position) values ($1, 'college', '6e', 1)",
      [school],
    );
  } finally {
    await client.end();
  }
});

test("le directeur vérifie un fichier, corrige l'erreur signalée, puis importe les élèves", async ({
  page,
}) => {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill(E2E_ACCOUNT.schoolCode);
  await page.getByLabel("Téléphone ou email").fill(E2E_ACCOUNT.phoneLocal);
  await page.getByLabel("Mot de passe").fill(E2E_ACCOUNT.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/accueil$/);

  await page.getByRole("link", { name: "Élèves", exact: true }).click();
  await page.getByRole("link", { name: "Importer depuis Excel" }).click();

  // Le modèle Excel se télécharge.
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Télécharger le modèle Excel" }).click();
  expect((await download).suggestedFilename()).toBe("modele-import-eleves.xlsx");

  // 1. Vérification : une erreur à la ligne 3 (téléphone).
  await page
    .getByLabel("Fichier rempli (.xlsx ou .csv)")
    .setInputFiles(
      file([
        "NGOMA;Paul;M;12/03/2014;Brazzaville;;;Awa Ngoma;06 555 11 22;Mère;;6e;",
        "MABIALA;Ève;F;05/09/2014;;;;Jean Mabiala;12;Père;;6e;",
      ]),
    );
  await page.getByRole("button", { name: "Vérifier le fichier" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "1 erreur(s) sur 2 ligne(s)" }),
  ).toBeVisible();
  await expect(page.getByText("Ligne 3, colonne « Téléphone du responsable » :")).toBeVisible();

  // 2. Import refusé tant que l'erreur reste.
  await page.getByRole("button", { name: "Importer" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Rien n'a été importé" })).toBeVisible();

  // 3. Fichier corrigé : importé.
  await page
    .getByLabel("Fichier rempli (.xlsx ou .csv)")
    .setInputFiles(
      file([
        "NGOMA;Paul;M;12/03/2014;Brazzaville;;;Awa Ngoma;06 555 11 22;Mère;;6e;",
        "MABIALA;Ève;F;05/09/2014;;;;Jean Mabiala;05 444 33 22;Père;;6e;",
      ]),
    );
  await page.getByRole("button", { name: "Importer" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "2 élève(s) importé(s)." }),
  ).toBeVisible();

  await page.goto("/eleves");
  await expect(page.getByRole("link", { name: /MABIALA Ève/ })).toContainText(/SJB-26-0000\d/);
});
