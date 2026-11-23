// Exports (4g) : un tableau commun (titre, colonnes typées, lignes, totaux), rendu en Excel ici et en
// PDF par le worker (gabarit `export-template.ts`). Les montants restent des nombres dans Excel (on
// peut les additionner), avec le format « 150 000 ».
import ExcelJS from "exceljs";

export type ColumnKind = "text" | "number" | "money" | "percent" | "date";
export type Cell = string | number | null;

export type ExportTable = {
  title: string;
  /** Précisions sous le titre : année, classe, période, dates… */
  subtitle: string[];
  columns: { header: string; kind: ColumnKind; width?: number }[];
  rows: Cell[][];
  /** Ligne de total facultative (même nombre de cases que les colonnes). */
  totals?: Cell[];
  /** Base du nom de fichier (sans extension), déjà sûre. */
  fileName: string;
  /** Tableau large : PDF en paysage. */
  landscape?: boolean;
};

const NUMBER_FORMATS: Partial<Record<ColumnKind, string>> = {
  number: "# ##0.##",
  money: '# ##0" FCFA"',
  percent: '0.0" %"',
};

/** Date AAAA-MM-JJ → JJ/MM/AAAA (lisible dans Excel comme à l'écran). */
export function frenchDate(value: string): string {
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y}`;
}

/** Nom de fichier sûr : lettres et chiffres sans accents, tirets. */
export function fileSlug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

/**
 * Cellule venant d'un utilisateur : une formule (« =… », « +… », « -… », « @… ») serait exécutée par
 * Excel à l'ouverture. On la neutralise par une apostrophe (injection de formules).
 */
export function safeText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export async function tableToXlsx(table: ExportTable): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Gestion scolaire";
  const sheet = workbook.addWorksheet(table.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
  sheet.addRow([table.title]).font = { bold: true, size: 14 };
  for (const line of table.subtitle) sheet.addRow([line]);
  sheet.addRow([]);
  const headerRow = sheet.addRow(table.columns.map((c) => c.header));
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4E4E7" } };
    cell.border = { bottom: { style: "thin" } };
  });
  const firstDataRow = headerRow.number + 1;
  const write = (row: Cell[]) =>
    sheet.addRow(
      row.map((value, i) =>
        typeof value === "string" && table.columns[i]?.kind === "text" ? safeText(value) : value,
      ),
    );
  for (const row of table.rows) write(row);
  if (table.totals) write(table.totals).font = { bold: true };
  table.columns.forEach((c, i) => {
    const column = sheet.getColumn(i + 1);
    column.width = c.width ?? Math.max(10, Math.min(40, c.header.length + 4));
    const format = NUMBER_FORMATS[c.kind];
    if (format) {
      column.eachCell((cell, rowNumber) => {
        if (rowNumber >= firstDataRow) cell.numFmt = format;
      });
    }
  });
  // L'en-tête du tableau reste visible au défilement.
  sheet.views = [{ state: "frozen", ySplit: headerRow.number }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
