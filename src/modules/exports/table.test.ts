import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { exportHtml } from "@/modules/documents/export-template";
import { excelHref, exportRequestFromParams } from "./params";
import { fileSlug, frenchDate, safeText, tableToXlsx, type ExportTable } from "./table";

const table: ExportTable = {
  title: "Impayés",
  subtitle: ["Année 2026-2027", "2 ligne(s)"],
  columns: [
    { header: "Élève", kind: "text" },
    { header: "Échéance", kind: "date" },
    { header: "Montant", kind: "money" },
  ],
  rows: [
    ["ADA Test", "15/10/2026", 40000],
    ['=HYPERLINK("http://x")', null, 2500],
  ],
  totals: ["Total", null, 42500],
  fileName: "impayes-2026-2027",
};

describe("petites fonctions", () => {
  it("date française, nom de fichier sûr", () => {
    expect(frenchDate("2026-10-05")).toBe("05/10/2026");
    expect(fileSlug("6e A — Équipe")).toBe("6e-a-equipe");
  });
  it("une formule saisie par un utilisateur est neutralisée", () => {
    expect(safeText("=1+1")).toBe("'=1+1");
    expect(safeText("+242 06")).toBe("'+242 06");
    expect(safeText("-5")).toBe("'-5");
    expect(safeText("@SUM")).toBe("'@SUM");
    expect(safeText("ADA")).toBe("ADA");
  });
});

describe("tableToXlsx", () => {
  it("titre, précisions, en-tête, lignes, total ; les montants restent des nombres", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      (await tableToXlsx(table)) as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const sheet = workbook.worksheets[0];
    const values = (n: number) => (sheet.getRow(n).values as unknown[]).slice(1);
    expect(values(1)).toEqual(["Impayés"]);
    expect(values(2)).toEqual(["Année 2026-2027"]);
    expect(values(5)).toEqual(["Élève", "Échéance", "Montant"]);
    expect(values(6)).toEqual(["ADA Test", "15/10/2026", 40000]);
    expect(values(7)[0]).toBe('\'=HYPERLINK("http://x")');
    expect(values(8)).toEqual(["Total", undefined, 42500]);
    expect(sheet.getCell("C6").numFmt).toBe('# ##0" FCFA"');
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 5 });
  });
});

describe("exportHtml", () => {
  it("échappe les textes, formate les montants, répète l'en-tête", () => {
    const html = exportHtml(
      {
        name: "École <Saint-Jean>",
        address: null,
        phone: null,
        logo: null,
        stamp: null,
        signature: null,
      },
      { ...table, rows: [["<script>x</script>", null, 40000]] },
      "23/11/2026 10:00",
    );
    expect(html).toContain("École &lt;Saint-Jean&gt;");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("40 000 FCFA");
    expect(html).toContain("<thead>");
    expect(html).not.toContain("landscape");
    expect(
      exportHtml(
        { name: "É", address: null, phone: null, logo: null, stamp: null, signature: null },
        { ...table, landscape: true },
        "x",
      ),
    ).toContain("A4 landscape");
  });
});

describe("paramètres d'URL", () => {
  it("aller-retour d'une demande, champs vides omis", () => {
    const href = excelHref({
      list: "absences",
      from: "2026-11-01",
      to: "2026-11-23",
      classId: undefined,
    });
    expect(href).toBe("/api/v1/exports?liste=absences&du=2026-11-01&au=2026-11-23");
    expect(exportRequestFromParams(new URL(href, "https://x").searchParams)).toEqual({
      list: "absences",
      from: "2026-11-01",
      to: "2026-11-23",
    });
  });
});
