import { expect, test } from "@playwright/test";
import pg from "pg";
import { e2eDatabaseUrls, E2E_ACCOUNT } from "./env";

// École préparée en base : année, niveaux du lycée, grille de la 1re C (Maths 5, Physique 4),
// un enseignant.
test.beforeEach(async () => {
  const client = new pg.Client({ connectionString: e2eDatabaseUrls().admin });
  await client.connect();
  try {
    await client.query("truncate levels, subjects, academic_years cascade");
    await client.query(
      "delete from memberships where user_id in (select id from users where phone = '+242057000099')",
    );
    await client.query("delete from users where phone = '+242057000099'");
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
    const premiere = (
      await client.query<{ id: string }>(
        `insert into levels (school_id, cycle, name, position) values ($1, 'lycee', '1re', 2) returning id`,
        [school],
      )
    ).rows[0].id;
    for (const [name, coefficient] of [
      ["Mathématiques", 5],
      ["Physique-Chimie", 4],
    ] as const) {
      const subject = (
        await client.query<{ id: string }>(
          "insert into subjects (school_id, name) values ($1, $2) returning id",
          [school, name],
        )
      ).rows[0].id;
      await client.query(
        `insert into level_subjects (school_id, academic_year_id, level_id, series, subject_id, coefficient)
         values ($1, $2, $3, 'C', $4, $5)`,
        [school, year, premiere, subject, coefficient],
      );
    }
    const teacher = (
      await client.query<{ id: string }>(
        "insert into users (name, phone) values ('Paul Nkounkou', '+242057000099') returning id",
      )
    ).rows[0].id;
    await client.query(
      "insert into memberships (school_id, user_id, roles) values ($1, $2, '{teacher}')",
      [school, teacher],
    );
  } finally {
    await client.end();
  }
});

test("le directeur crée la 1re C1 et affecte les enseignants", async ({ page }) => {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill(E2E_ACCOUNT.schoolCode);
  await page.getByLabel("Téléphone ou email").fill(E2E_ACCOUNT.phoneLocal);
  await page.getByLabel("Mot de passe").fill(E2E_ACCOUNT.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/accueil$/);

  await page.getByRole("link", { name: "Classes" }).click();
  await expect(page.getByText("Aucune classe pour cette année.")).toBeVisible();
  await page.getByLabel("Niveau", { exact: true }).selectOption({ label: "1re" });
  await page.getByRole("textbox", { name: "Série (lycée)" }).fill("C");
  await page.getByRole("textbox", { name: "Nom de la classe" }).fill("1re C1");
  await page.getByRole("spinbutton", { name: "Effectif maximal" }).fill("45");
  await page.getByLabel("Professeur principal").selectOption({ label: "Paul Nkounkou" });
  await page.getByRole("button", { name: "Créer la classe" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Classe « 1re C1 » créée." }),
  ).toBeVisible();

  const card = page.getByRole("link").filter({ hasText: "1re C1" });
  await expect(card).toContainText("1re C · 2 matière(s) · 45 places max.");
  await expect(card).toContainText("Prof. principal : Paul Nkounkou");
  await card.click();

  await expect(page.getByRole("heading", { name: "Classe 1re C1" })).toBeVisible();
  await page.getByLabel("Mathématiques (coef. 5)").selectOption({ label: "Paul Nkounkou" });
  await page.getByRole("button", { name: "Enregistrer les enseignants" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Enseignants enregistrés." }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Mathématiques (coef. 5)")).toHaveValue(/.+/);
  await expect(page.getByLabel("Physique-Chimie (coef. 4)")).toHaveValue("");

  // Suppression, après confirmation : retour à la liste vide.
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Supprimer la classe" }).click();
  await expect(page.getByText("Aucune classe pour cette année.")).toBeVisible();
});
