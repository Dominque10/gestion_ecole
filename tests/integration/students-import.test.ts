// M2 (2g) — import d'élèves depuis Excel/CSV. Jalon de la phase 2 : 1 000 élèves en moins de
// 2 minutes, avec rapport d'erreurs ligne par ligne.
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type Principal } from "@/server/auth/permissions";
import { closeDb } from "@/server/db/client";
import { createClass } from "@/modules/settings/classes";
import { saveFee } from "@/modules/settings/fees";
import { addDefaultLevels, listLevels } from "@/modules/settings/levels";
import { activateYear, createYear } from "@/modules/settings/years";
import { IMPORT_COLUMNS } from "@/modules/students/import-parse";
import {
  buildImportTemplate,
  checkImport,
  readImportFile,
  runImport,
} from "@/modules/students/import";
import { adminQuery, createSchoolWithDirector, createSuperadmin, resetDatabase } from "./helpers";

let director: Principal;
let secretary: Principal;
let other: Principal;
let y1: string;

async function xlsx(rows: unknown[][]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Élèves");
  sheet.addRow(IMPORT_COLUMNS.map((c) => c.header));
  for (const row of rows) sheet.addRow(row);
  return new Uint8Array((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
}

const csv = (lines: string[]) =>
  new TextEncoder().encode([IMPORT_COLUMNS.map((c) => c.header).join(";"), ...lines].join("\r\n"));

const count = async (table: string) =>
  (
    await adminQuery<{ n: number }>(
      `select count(*)::int as n from ${table} where school_id = $1`,
      [director.schoolId],
    )
  ).rows[0].n;

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  const a = await createSchoolWithDirector(superadminId, "import");
  const b = await createSchoolWithDirector(superadminId, "importb");
  director = {
    userId: a.directorId,
    schoolId: a.schoolId,
    roles: ["director"],
    isSuperadmin: false,
  };
  secretary = { ...director, roles: ["secretary"] };
  other = { userId: b.directorId, schoolId: b.schoolId, roles: ["director"], isSuperadmin: false };
  await addDefaultLevels(director, "college");
  const levels = await listLevels(director);
  const sixieme = levels.find((l) => l.name === "6e")!.id;
  y1 = await createYear(director, {
    label: "2026-2027",
    startDate: "2026-10-01",
    endDate: "2027-06-30",
    periodKind: "trimester",
  });
  await createClass(director, y1, {
    levelId: sixieme,
    series: "",
    name: "6e A",
    capacity: "2",
    headTeacherId: "",
  });
  await createClass(director, y1, {
    levelId: sixieme,
    series: "",
    name: "6e B",
    capacity: "",
    headTeacherId: "",
  });
  await saveFee(director, y1, {
    name: "Scolarité",
    kind: "tuition",
    mandatory: true,
    levelIds: levels.map((l) => l.id),
    installments: [
      { number: 1, amount: 50_000, dueDate: "2026-10-01" },
      { number: 2, amount: 50_000, dueDate: "2027-01-04" },
    ],
  });
});

afterAll(async () => {
  await closeDb();
});

describe("Lecture des fichiers", () => {
  it("CSV en Windows-1252 (Excel en français) : accents conservés", async () => {
    const latin1 = Uint8Array.from([
      0x4e, 0x6f, 0x6d, 0x3b, 0x50, 0x72, 0xe9, 0x6e, 0x6f, 0x6d, 0x73,
    ]); // « Nom;Prénoms »
    expect(await readImportFile(latin1, "eleves.csv")).toEqual([["Nom", "Prénoms"]]);
  });

  it("fichiers refusés : trop gros, vide, illisible, colonnes obligatoires absentes", async () => {
    await expect(readImportFile(new Uint8Array(1024 * 1024 + 1), "a.csv")).rejects.toThrow();
    await expect(readImportFile(new Uint8Array(), "a.csv")).rejects.toThrow();
    await expect(readImportFile(Uint8Array.from([0x50, 0x4b, 1, 2]), "a.xlsx")).rejects.toThrow();
    await expect(
      checkImport(director, {
        bytes: new TextEncoder().encode("Nom;Prénoms\nA;B"),
        fileName: "a.csv",
        academicYearId: y1,
      }),
    ).rejects.toMatchObject({ reason: "missingColumns" });
  });

  it("le modèle Excel fourni se relit, et sa ligne d'exemple est valide", async () => {
    const template = await buildImportTemplate(director, { format: "xlsx", academicYearId: y1 });
    const report = await checkImport(director, {
      bytes: template.bytes,
      fileName: template.fileName,
      academicYearId: y1,
    });
    expect(report).toEqual({ total: 1, valid: 1, errors: [] });
    const csvTemplate = await buildImportTemplate(director, { format: "csv", academicYearId: y1 });
    expect(
      (
        await checkImport(director, {
          bytes: csvTemplate.bytes,
          fileName: "m.csv",
          academicYearId: y1,
        })
      ).valid,
    ).toBe(1);
  });
});

describe("Vérification et import", () => {
  it("rapport ligne par ligne ; avec une erreur, rien n'est importé (tout ou rien)", async () => {
    const file = csv([
      "OKEMBA;Jean;M;01/02/2014;;;;Papa Okemba;06 999 00 01;;;6e;",
      "MOUKALA;Awa;X;31/02/2014;;;;Maman;12;;;CM9;",
    ]);
    const check = await checkImport(secretary, {
      bytes: file,
      fileName: "a.csv",
      academicYearId: y1,
    });
    expect(check.total).toBe(2);
    expect(check.valid).toBe(1);
    expect(check.errors.map((e) => `${e.line} ${e.column}`)).toEqual([
      "3 Sexe (F ou M)",
      "3 Date de naissance (JJ/MM/AAAA)",
      "3 Téléphone du responsable",
      "3 Niveau",
    ]);
    const before = await count("students");
    const result = await runImport(secretary, {
      bytes: file,
      fileName: "a.csv",
      academicYearId: y1,
      validated: false,
    });
    expect(result.imported).toBe(0);
    expect(await count("students")).toBe(before);
  });

  it("import : fiches, responsables (frères et sœurs regroupés), préinscriptions et échéances", async () => {
    const file = csv([
      "OKEMBA;Jean;M;01/02/2014;Brazzaville;;;Papa Okemba;06 999 00 01;Père;;6e;",
      "OKEMBA;Marie;F;05/09/2015;Brazzaville;;;Papa Okemba;069990001;Père;;5e;",
      "LOEMBA;Paul;garçon;;;;;Tante Loemba;05 999 00 02;Tante;;;",
    ]);
    const result = await runImport(secretary, {
      bytes: file,
      fileName: "a.csv",
      academicYearId: y1,
      validated: false,
    });
    expect(result).toMatchObject({ total: 3, valid: 3, imported: 3, errors: [] });
    const { rows } = await adminQuery<{
      matricule: string;
      last_name: string;
      status: string | null;
      invoices: number;
    }>(
      `select s.matricule, s.last_name, e.status,
         (select count(*)::int from invoices i where i.enrollment_id = e.id) as invoices
       from students s left join enrollments e on e.student_id = s.id
       where s.school_id = $1 order by s.matricule`,
      [director.schoolId],
    );
    expect(rows.map((r) => [r.matricule.slice(-5), r.last_name, r.status, r.invoices])).toEqual([
      ["00001", "OKEMBA", "pre_enrolled", 2],
      ["00002", "OKEMBA", "pre_enrolled", 2],
      ["00003", "LOEMBA", null, 0],
    ]);
    expect(await count("guardians")).toBe(2);
    const { rows: logs } = await adminQuery(
      "select 1 from audit_logs where action = 'students.import' and school_id = $1",
      [director.schoolId],
    );
    expect(logs).toHaveLength(1);
  });

  it("refuse de réimporter les mêmes élèves", async () => {
    const file = csv(["OKEMBA;Jean;M;01/02/2014;;;;Papa Okemba;06 999 00 01;;;6e;"]);
    const report = await checkImport(director, {
      bytes: file,
      fileName: "a.csv",
      academicYearId: y1,
    });
    expect(report.errors.map((e) => e.message)).toEqual(["Cet élève est déjà dans l'école."]);
  });

  it("inscriptions déjà validées (directeur) : classes affectées, effectif maximal respecté, tracé", async () => {
    const full = csv([
      "A1;X;F;01/01/2014;;;;P1;06 999 10 01;;;6e;6e A",
      "A2;X;F;01/01/2014;;;;P2;06 999 10 02;;;6e;6e A",
      "A3;X;F;01/01/2014;;;;P3;06 999 10 03;;;6e;6e A",
    ]);
    const refused = await runImport(director, {
      bytes: full,
      fileName: "a.csv",
      academicYearId: y1,
      validated: true,
    });
    expect(refused.imported).toBe(0);
    expect(refused.errors).toEqual([
      { line: 4, column: "Classe", message: "Classe complète (effectif maximal atteint)." },
    ]);
    await expect(
      runImport(secretary, { bytes: full, fileName: "a.csv", academicYearId: y1, validated: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const fits = csv([
      "A1;X;F;01/01/2014;;;;P1;06 999 10 01;;;6e;6e A",
      "A2;X;F;01/01/2014;;;;P2;06 999 10 02;;;6e;6e B",
    ]);
    const done = await runImport(director, {
      bytes: fits,
      fileName: "a.csv",
      academicYearId: y1,
      validated: true,
    });
    expect(done.imported).toBe(2);
    const { rows } = await adminQuery<{ status: string; mode: string; cls: string }>(
      `select e.status, e.validation_mode as mode, c.name as cls from enrollments e join classes c on c.id = e.class_id
       join students s on s.id = e.student_id where s.last_name in ('A1', 'A2') order by s.last_name`,
    );
    expect(rows).toEqual([
      { status: "enrolled", mode: "manual", cls: "6e A" },
      { status: "enrolled", mode: "manual", cls: "6e B" },
    ]);
  });

  it("droits et isolation : comptabilité refusée ; une autre école ne connaît pas l'année", async () => {
    const file = csv(["ZZ;Z;F;;;;;P;06 999 20 01;;;;"]);
    await expect(
      checkImport(
        { ...director, roles: ["accountant"] },
        { bytes: file, fileName: "a.csv", academicYearId: y1 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      checkImport(other, { bytes: file, fileName: "a.csv", academicYearId: y1 }),
    ).rejects.toThrow();
  });
});

describe("JALON : 1 000 élèves en moins de 2 minutes", () => {
  it("importe un fichier Excel de 1 000 élèves, avec niveau, échéances et frères et sœurs", async () => {
    const levels = ["6e", "5e", "4e", "3e"];
    const rows = Array.from({ length: 1000 }, (_, i) => [
      `ELEVE${String(i).padStart(4, "0")}`,
      i % 2 ? "Paul" : "Bénédicte",
      i % 2 ? "M" : "F",
      `${String((i % 28) + 1).padStart(2, "0")}/0${(i % 9) + 1}/2013`,
      "Brazzaville",
      "Congolaise",
      "",
      `Parent ${Math.floor(i / 2)}`,
      // Deux enfants par parent ; numéro saisi comme un nombre (Excel efface le 0 initial).
      61_000_000 + Math.floor(i / 2),
      "Parent",
      "",
      levels[i % 4],
      "",
    ]);
    const bytes = await xlsx(rows);
    const started = Date.now();
    const result = await runImport(director, {
      bytes,
      fileName: "eleves.xlsx",
      academicYearId: y1,
      validated: false,
    });
    const seconds = (Date.now() - started) / 1000;
    expect(result.errors).toEqual([]);
    expect(result.imported).toBe(1000);
    expect(seconds).toBeLessThan(120);
    console.log(`[jalon] 1 000 élèves importés en ${seconds.toFixed(1)} s`);
    const { rows: stats } = await adminQuery<{
      students: number;
      invoices: number;
      guardians: number;
    }>(
      `select (select count(*)::int from students where school_id = $1 and last_name like 'ELEVE%') as students,
              (select count(*)::int from invoices i join enrollments e on e.id = i.enrollment_id
                 join students s on s.id = e.student_id where s.last_name like 'ELEVE%') as invoices,
              (select count(*)::int from guardians where school_id = $1 and full_name like 'Parent %') as guardians`,
      [director.schoolId],
    );
    expect(stats[0]).toEqual({ students: 1000, invoices: 2000, guardians: 500 });
  }, 180_000);

  it("après l'import, l'année archivée n'accepte plus d'import", async () => {
    await activateYear(director, y1);
    const y2 = await createYear(director, {
      label: "2027-2028",
      startDate: "2027-10-01",
      endDate: "2028-06-30",
      periodKind: "trimester",
    });
    await activateYear(director, y2);
    const file = csv(["ZZ;Z;F;;;;;P;06 999 30 01;;;;"]);
    await expect(
      checkImport(director, { bytes: file, fileName: "a.csv", academicYearId: y1 }),
    ).rejects.toThrow();
  });
});
