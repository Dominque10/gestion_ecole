import { expect, test, type Page } from "@playwright/test";
import { E2E_ACCOUNT } from "./env";
import { seedNotes, withAdmin, type NotesData } from "./notes-data";

let data: NotesData;
let quizId: string;

// En plus des données communes : une interrogation du 5 novembre où ADA a 10.
test.beforeEach(async () => {
  data = await seedNotes();
  quizId = await withAdmin(async (client) => {
    const { rows } = await client.query<{ id: string; teacher: string; period: string }>(
      `select cs.teacher_id as teacher,
              (select id from periods where academic_year_id = $1 and position = 1) as period
       from class_subjects cs where cs.class_id = $2`,
      [data.year, data.classId],
    );
    const quiz = await client.query<{ id: string }>(
      `insert into assessments (school_id, academic_year_id, period_id, class_id, subject_id, kind,
         date, max_score, created_by)
       values ($1, $2, $3, $4, $5, 'quiz', '2026-11-05', 20, $6) returning id`,
      [data.school, data.year, rows[0].period, data.classId, data.subjectId, rows[0].teacher],
    );
    await client.query(
      `insert into grades (school_id, academic_year_id, assessment_id, enrollment_id, status, score,
         updated_by)
       select $1, $2, $3, e.id, 'scored', 10, $4
       from enrollments e join students s on s.id = e.student_id where s.last_name = 'ADA'`,
      [data.school, data.year, quiz.rows[0].id, rows[0].teacher],
    );
    return quiz.rows[0].id;
  });
});

/** Le téléphone a gardé au moins une matière (base IndexedDB de l'application). */
async function courseCopied(page: Page) {
  await page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        const request = indexedDB.open("gestion-ecole-notes");
        request.onerror = () => resolve(false);
        request.onsuccess = () => {
          try {
            const count = request.result.transaction("courses").objectStore("courses").count();
            count.onsuccess = () => resolve(count.result > 0);
            count.onerror = () => resolve(false);
          } catch {
            resolve(false);
          }
        };
      }),
  );
}

const gradesInDb = () =>
  withAdmin(async (client) => {
    const { rows } = await client.query<{
      kind: string;
      name: string;
      status: string;
      score: string | null;
    }>(
      `select a.kind, s.last_name as name, g.status, g.score::text as score
       from grades g join assessments a on a.id = g.assessment_id
       join enrollments e on e.id = g.enrollment_id join students s on s.id = e.student_id
       order by a.kind::text, s.last_name`,
    );
    return rows.map((r) => `${r.kind} ${r.name} ${r.status} ${r.score ?? ""}`.trim());
  });

test("sans réseau, l'enseignant crée une composition et note ; tout part au retour du réseau, sans écraser une correction", async ({
  page,
  context,
}) => {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill(E2E_ACCOUNT.schoolCode);
  await page.getByLabel("Téléphone ou email").fill(E2E_ACCOUNT.phoneLocal);
  await page.getByLabel("Mot de passe").fill(E2E_ACCOUNT.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/accueil$/);

  // Avec du réseau : la matière est ouverte une fois (copie sur le téléphone), le service worker installé.
  await page.goto(`/notes/${data.classId}/${data.subjectId}`);
  await expect(page.getByText("Cette matière est gardée sur ce téléphone.")).toBeVisible();
  await courseCopied(page);
  await page.waitForFunction(async () => {
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller !== null;
  });

  // Plus de réseau : la page demandée est remplacée par la saisie hors connexion.
  await context.setOffline(true);
  await page.goto("/notes");
  await expect(page).toHaveURL(/\/notes\/hors-ligne/);
  await page.getByRole("link", { name: /Mathématiques — 6e A/ }).click();

  // a) L'interrogation existante : ADA passe de 10 à 12.
  await page.getByRole("link", { name: /Interrogation — 5 nov\. 2026/ }).click();
  const ada = page.getByRole("textbox", { name: "Note de ADA Test" });
  await expect(ada).toHaveValue("10");
  await ada.fill("12");
  await page.getByRole("button", { name: "Enregistrer les notes" }).click();
  await expect(page.locator("p[role=status]").last()).toContainText(
    "1 note(s) enregistrée(s) sur ce téléphone",
  );
  await expect(page.getByText("Enregistrée sur le téléphone, en attente d'envoi")).toBeVisible();

  // b) Une composition créée sur le téléphone, notée tout de suite.
  await page.getByRole("link", { name: "Retour aux évaluations" }).click();
  await page.getByRole("radio", { name: "Composition" }).check();
  await page.getByLabel("Date", { exact: true }).fill("2026-11-20");
  await page.getByRole("button", { name: "Créer et saisir les notes" }).click();
  await expect(page.getByText(/Évaluation créée sur ce téléphone/)).toBeVisible();
  await page.getByRole("textbox", { name: "Note de ADA Test" }).fill("15,5");
  await page.getByRole("button", { name: "Marquer BOB Test dispensé" }).click();
  await page.getByRole("button", { name: "Enregistrer les notes" }).click();
  await expect(page.getByText(/Pas de réseau : 4 saisie\(s\) gardée\(s\)/)).toBeVisible();
  expect(await gradesInDb()).toEqual(["quiz ADA scored 10.00"]);

  // Pendant ce temps, le directeur corrige ADA à 14 sur le serveur.
  await withAdmin((client) =>
    client.query("update grades set score = 14 where assessment_id = $1", [quizId]),
  );

  // Retour du réseau : tout part tout seul, sauf la note corrigée entre-temps.
  await context.setOffline(false);
  await expect
    .poll(gradesInDb, { timeout: 15_000 })
    .toEqual(["composition ADA scored 15.50", "composition BOB excused", "quiz ADA scored 14.00"]);
  await expect(page.getByText("1 note(s) à vérifier : voir les cases signalées.")).toBeVisible();

  // L'enseignant voit le conflit sur l'interrogation et garde sa note.
  await page.getByRole("link", { name: "Retour aux évaluations" }).click();
  await page.getByRole("link", { name: /Interrogation — 5 nov\. 2026/ }).click();
  await expect(
    page.getByText(
      "Changée sur le serveur pendant votre saisie. Votre note : 12 ; note actuelle : 14.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Garder ma note (12)" }).click();
  await expect.poll(gradesInDb, { timeout: 15_000 }).toContain("quiz ADA scored 12.00");
  await expect(page.getByText(/à vérifier|en attente/)).toHaveCount(0);
});
