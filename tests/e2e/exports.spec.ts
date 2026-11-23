import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { expect, test } from "@playwright/test";
import { E2E_ACCOUNT } from "./env";
import { seedNotes } from "./notes-data";

test.beforeEach(async () => {
  await seedNotes();
});

test("le directeur télécharge la liste des élèves en Excel et celle des classes en PDF", async ({
  page,
}) => {
  await page.goto("/connexion");
  await page.getByLabel("Code de l'école").fill(E2E_ACCOUNT.schoolCode);
  await page.getByLabel("Téléphone ou email").fill(E2E_ACCOUNT.phoneLocal);
  await page.getByLabel("Mot de passe").fill(E2E_ACCOUNT.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.getByRole("link", { name: "Exports Excel et PDF" }).click();
  await expect(page.getByRole("heading", { name: "Exports Excel et PDF" })).toBeVisible();

  // Excel : téléchargé tout de suite, relu pour vérifier son contenu.
  const students = page.getByRole("region", { name: "Liste des élèves" });
  await students.getByLabel("Classe").selectOption({ label: "6e A" });
  const excel = page.waitForEvent("download");
  await students.getByRole("link", { name: "Excel" }).click();
  const file = await excel;
  expect(file.suggestedFilename()).toBe("eleves-2026-2027-6e-a.xlsx");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    readFileSync(await file.path()) as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const names = workbook.worksheets[0]
    .getColumn(2)
    .values.filter((v): v is string => typeof v === "string");
  expect(names).toEqual(["Nom", "ADA", "BOB"]);

  // PDF : préparé par le worker, puis téléchargé.
  const classes = page.getByRole("region", { name: "Liste des classes" });
  const pdf = page.waitForEvent("download", { timeout: 60_000 });
  await classes.getByRole("button", { name: "PDF" }).click();
  const pdfFile = await pdf;
  expect(pdfFile.suggestedFilename()).toBe("classes-2026-2027.pdf");
  expect(readFileSync(await pdfFile.path()).subarray(0, 4).toString()).toBe("%PDF");
});
