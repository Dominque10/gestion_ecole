// Import initial des élèves depuis un fichier Excel ou CSV (M2, 2g). Tout ou rien : la moindre
// erreur bloque l'import, et l'import lui-même se fait dans une seule transaction.
import ExcelJS from "exceljs";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { generateMandatoryInvoices } from "@/modules/finance/invoices";
import { todayInBrazzaville } from "@/lib/dates";
import { authorize, can, type Principal } from "@/server/auth/permissions";
import { withSchool, type Tx } from "@/server/db/client";
import {
  academicYears,
  auditLogs,
  classes,
  enrollments,
  levels,
  studentGuardians,
  students,
} from "@/server/db/schema";
import { searchKey } from "./identity";
import {
  duplicateKey,
  IMPORT_COLUMNS,
  MAX_IMPORT_ROWS,
  parseCsv,
  tableToRows,
  validateRows,
  type ImportContext,
  type ImportError,
  type ImportRow,
} from "./import-parse";
import { nextMatricule, upsertGuardian } from "./students";

/** Taille maximale d'un fichier d'import (largement assez pour 3 000 élèves). */
export const MAX_IMPORT_BYTES = 1024 * 1024;

export class ImportFileError extends Error {
  constructor(
    readonly reason: "tooLarge" | "unreadable" | "empty" | "tooManyRows" | "missingColumns",
    readonly detail = "",
  ) {
    super(`Import : ${reason}`);
    this.name = "ImportFileError";
  }
}

/** Valeur d'une cellule Excel : texte, nombre, date, résultat de formule ou texte enrichi. */
function cellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    if ("result" in value) return cellValue(value.result as ExcelJS.CellValue);
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    if ("text" in value) return value.text;
    return "";
  }
  return value;
}

/** Lit le fichier (premier onglet d'un .xlsx, ou CSV en UTF-8 ou Windows-1252) en tableau de lignes. */
export async function readImportFile(bytes: Uint8Array, fileName: string): Promise<unknown[][]> {
  if (bytes.length > MAX_IMPORT_BYTES) throw new ImportFileError("tooLarge");
  if (bytes.length === 0) throw new ImportFileError("empty");
  const isXlsx = /\.xlsx$/i.test(fileName) || (bytes[0] === 0x50 && bytes[1] === 0x4b);
  if (isXlsx) {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
    } catch {
      throw new ImportFileError("unreadable");
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new ImportFileError("empty");
    const table: unknown[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values: unknown[] = [];
      for (let col = 1; col <= sheet.columnCount; col++)
        values.push(cellValue(row.getCell(col).value));
      if (values.some((v) => String(v ?? "").trim() !== "")) table.push(values);
    });
    return table;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Excel en français enregistre souvent ses CSV en Windows-1252.
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return parseCsv(text);
}

async function loadContext(tx: Tx, schoolId: string, yearId: string): Promise<ImportContext> {
  const levelRows = await tx
    .select({ id: levels.id, name: levels.name })
    .from(levels)
    .where(eq(levels.schoolId, schoolId));
  const classRows = await tx
    .select({ id: classes.id, name: classes.name, levelId: classes.levelId })
    .from(classes)
    .where(and(eq(classes.schoolId, schoolId), eq(classes.academicYearId, yearId)));
  const existing = await tx
    .select({
      lastName: students.lastName,
      firstNames: students.firstNames,
      birthDate: students.birthDate,
    })
    .from(students)
    .where(eq(students.schoolId, schoolId));
  return {
    levels: new Map(levelRows.map((l) => [searchKey(l.name), { id: l.id }])),
    classes: new Map(classRows.map((c) => [searchKey(c.name), { id: c.id, levelId: c.levelId }])),
    existing: new Set(existing.map((s) => duplicateKey(s.lastName, s.firstNames, s.birthDate))),
  };
}

async function writableYear(tx: Tx, schoolId: string, yearId: string) {
  if (!z.uuid().safeParse(yearId).success) throw new ImportFileError("unreadable", "année");
  const [year] = await tx
    .select({ status: academicYears.status })
    .from(academicYears)
    .where(and(eq(academicYears.schoolId, schoolId), eq(academicYears.id, yearId)));
  if (!year || year.status === "archived") throw new ImportFileError("unreadable", "année");
}

export type ImportReport = { total: number; valid: number; errors: ImportError[] };

async function analyse(
  tx: Tx,
  schoolId: string,
  input: { bytes: Uint8Array; fileName: string; academicYearId: string },
): Promise<{ report: ImportReport; rows: ImportRow[] }> {
  await writableYear(tx, schoolId, input.academicYearId);
  const table = await readImportFile(input.bytes, input.fileName);
  const { rows, missingColumns } = tableToRows(table);
  if (missingColumns.length > 0)
    throw new ImportFileError("missingColumns", missingColumns.join(", "));
  if (rows.length === 0) throw new ImportFileError("empty");
  if (rows.length > MAX_IMPORT_ROWS)
    throw new ImportFileError("tooManyRows", String(MAX_IMPORT_ROWS));
  const { valid, errors } = validateRows(
    rows,
    await loadContext(tx, schoolId, input.academicYearId),
  );
  return { report: { total: rows.length, valid: valid.length, errors }, rows: valid };
}

function context(principal: Principal) {
  authorize(principal, "students:write");
  return { schoolId: principal.schoolId as string, userId: principal.userId };
}

/** Vérification seule : rapport d'erreurs ligne par ligne, rien n'est enregistré. */
export async function checkImport(
  principal: Principal,
  input: { bytes: Uint8Array; fileName: string; academicYearId: string },
): Promise<ImportReport> {
  const ctx = context(principal);
  return withSchool(ctx, async (tx) => (await analyse(tx, ctx.schoolId, input)).report);
}

/**
 * Importe le fichier s'il ne contient aucune erreur : fiches, responsables, préinscriptions et
 * échéances, dans une seule transaction. `validated` (directeur seul) : inscriptions validées et
 * classes affectées d'emblée, chaque validation tracée.
 */
export async function runImport(
  principal: Principal,
  input: { bytes: Uint8Array; fileName: string; academicYearId: string; validated: boolean },
): Promise<ImportReport & { imported: number }> {
  const ctx = context(principal);
  if (input.validated) authorize(principal, "enrollments:validate");
  return withSchool(ctx, async (tx) => {
    const { report, rows } = await analyse(tx, ctx.schoolId, input);
    if (report.errors.length > 0) return { ...report, imported: 0 };
    const placed = input.validated
      ? await checkSeats(tx, ctx.schoolId, input.academicYearId, rows)
      : null;
    if (placed && placed.errors.length > 0) {
      return {
        ...report,
        valid: report.valid - placed.errors.length,
        errors: placed.errors,
        imported: 0,
      };
    }

    const today = todayInBrazzaville();
    let imported = 0;
    for (const row of rows) {
      const matricule = await nextMatricule(tx, ctx.schoolId);
      const [student] = await tx
        .insert(students)
        .values({
          schoolId: ctx.schoolId,
          matricule,
          lastName: row.lastName,
          firstNames: row.firstNames,
          sex: row.sex,
          birthDate: row.birthDate,
          birthPlace: row.birthPlace,
          nationality: row.nationality,
          previousSchool: row.previousSchool,
          searchText: searchKey(row.lastName, row.firstNames, matricule),
        })
        .returning({ id: students.id });
      const guardianId = await upsertGuardian(tx, ctx.schoolId, {
        fullName: row.guardianName,
        phone: row.guardianPhone,
        otherPhone: row.otherPhone,
        relationship: row.relationship,
      });
      await tx
        .insert(studentGuardians)
        .values({ schoolId: ctx.schoolId, studentId: student.id, guardianId, isPrimary: true });

      if (row.levelId) {
        const [enrollment] = await tx
          .insert(enrollments)
          .values({
            schoolId: ctx.schoolId,
            studentId: student.id,
            academicYearId: input.academicYearId,
            levelId: row.levelId,
            classId: input.validated ? row.classId : null,
            entryDate: today,
            ...(input.validated
              ? {
                  status: "enrolled" as const,
                  validationMode: "manual" as const,
                  validatedAt: new Date(),
                  validatedBy: ctx.userId,
                }
              : {}),
          })
          .returning({ id: enrollments.id });
        await generateMandatoryInvoices(tx, ctx.schoolId, enrollment.id);
        if (input.validated) {
          await tx.insert(auditLogs).values({
            schoolId: ctx.schoolId,
            actorUserId: ctx.userId,
            action: "enrollment.validate",
            entityType: "enrollment",
            entityId: enrollment.id,
            after: { mode: "manual", source: "import" },
          });
        }
      }
      imported++;
    }
    await tx.insert(auditLogs).values({
      schoolId: ctx.schoolId,
      actorUserId: ctx.userId,
      action: "students.import",
      entityType: "academic_year",
      entityId: input.academicYearId,
      after: { fileName: input.fileName, imported, validated: input.validated },
    });
    return { ...report, imported };
  });
}

/**
 * Classes affectées d'emblée : vérifie, avant toute écriture, que chaque classe a assez de places
 * (effectif maximal) pour les élèves du fichier.
 */
async function checkSeats(
  tx: Tx,
  schoolId: string,
  yearId: string,
  rows: ImportRow[],
): Promise<{ errors: ImportError[] }> {
  const capacities = await tx
    .select({
      id: classes.id,
      capacity: classes.capacity,
      used: sql<number>`(select count(*)::int from enrollments e
        where e.class_id = "classes"."id" and e.status = 'enrolled')`,
    })
    .from(classes)
    .where(and(eq(classes.schoolId, schoolId), eq(classes.academicYearId, yearId)))
    .for("update", { of: classes });
  const left = new Map(
    capacities.map((c) => [c.id, c.capacity === null ? null : c.capacity - c.used]),
  );
  const errors: ImportError[] = [];
  for (const row of rows) {
    if (!row.classId || !row.levelId) continue;
    const seats = left.get(row.classId);
    if (seats === null || seats === undefined) continue;
    if (seats <= 0) {
      errors.push({
        line: row.line,
        column: "Classe",
        message: "Classe complète (effectif maximal atteint).",
      });
    } else left.set(row.classId, seats - 1);
  }
  return { errors };
}

/** Peut cocher « inscriptions déjà validées » (directeur). */
export const canImportValidated = (principal: Principal) => can(principal, "enrollments:validate");

const EXAMPLE = [
  "NGOMA",
  "Bénédicte Ève",
  "F",
  "12/03/2014",
  "Brazzaville",
  "Congolaise",
  "École Saint-Michel",
  "Awa Ngoma",
  "06 123 45 67",
  "Mère",
  "",
  "6e",
  "6e A",
];

/**
 * Modèle d'import à remplir : en-têtes, une ligne d'exemple, et (Excel) un onglet « Aide » avec les
 * niveaux et classes de l'école pour l'année choisie.
 */
export async function buildImportTemplate(
  principal: Principal,
  input: { format: "xlsx" | "csv"; academicYearId: string | null },
): Promise<{ bytes: Uint8Array; fileName: string; contentType: string }> {
  const ctx = context(principal);
  const { levelNames, classNames } = await withSchool(ctx, async (tx) => {
    const levelRows = await tx
      .select({ name: levels.name })
      .from(levels)
      .where(eq(levels.schoolId, ctx.schoolId))
      .orderBy(levels.cycle, levels.position);
    const classRows =
      input.academicYearId && z.uuid().safeParse(input.academicYearId).success
        ? await tx
            .select({ name: classes.name })
            .from(classes)
            .where(
              and(
                eq(classes.schoolId, ctx.schoolId),
                eq(classes.academicYearId, input.academicYearId),
              ),
            )
            .orderBy(classes.name)
        : [];
    return { levelNames: levelRows.map((l) => l.name), classNames: classRows.map((c) => c.name) };
  });
  const headers = IMPORT_COLUMNS.map((c) => c.header);
  if (input.format === "csv") {
    const quote = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    // BOM UTF-8 : Excel ouvre alors le fichier avec les accents corrects.
    const csv = `﻿${headers.map(quote).join(";")}\r\n${EXAMPLE.map(quote).join(";")}\r\n`;
    return {
      bytes: new TextEncoder().encode(csv),
      fileName: "modele-import-eleves.csv",
      contentType: "text/csv; charset=utf-8",
    };
  }
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Élèves");
  sheet.addRow(headers);
  sheet.addRow(EXAMPLE);
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((column, i) => {
    column.width = Math.max(14, headers[i].length + 2);
    // Téléphones et dates en texte : Excel n'effacera ni le 0 initial ni le format JJ/MM/AAAA.
    column.numFmt = "@";
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  const help = workbook.addWorksheet("Aide");
  help.addRow(["Colonnes obligatoires : Nom, Prénoms, Sexe, Nom et téléphone du responsable."]);
  help.addRow(["Supprimez la ligne d'exemple avant l'import. Une ligne par élève."]);
  help.addRow([]);
  help.addRow(["Niveaux de l'école", "Classes de l'année"]);
  help.getRow(4).font = { bold: true };
  for (let i = 0; i < Math.max(levelNames.length, classNames.length); i++) {
    help.addRow([levelNames[i] ?? "", classNames[i] ?? ""]);
  }
  help.columns.forEach((column) => (column.width = 32));
  const buffer = await workbook.xlsx.writeBuffer();
  return {
    bytes: new Uint8Array(buffer as ArrayBuffer),
    fileName: "modele-import-eleves.xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

/** Années ouvertes où importer (direction et secrétariat), de la plus récente à la plus ancienne. */
export async function importYears(
  principal: Principal,
): Promise<{ id: string; label: string; status: "upcoming" | "active" | "archived" }[]> {
  const ctx = context(principal);
  return withSchool(ctx, (tx) =>
    tx
      .select({ id: academicYears.id, label: academicYears.label, status: academicYears.status })
      .from(academicYears)
      .where(
        and(eq(academicYears.schoolId, ctx.schoolId), sql`${academicYears.status} <> 'archived'`),
      )
      .orderBy(sql`${academicYears.startDate} desc`),
  );
}
