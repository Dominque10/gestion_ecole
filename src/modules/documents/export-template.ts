// Gabarit PDF des exports (4g) : en-tête de l'école, titre, précisions, tableau (en-tête répété sur
// chaque page), totaux. A4 en portrait, ou en paysage pour les tableaux larges.
import type { Cell, ExportTable } from "@/modules/exports/table";
import { escapeHtml, htmlDocument, money } from "./html";
import { header, type SchoolHeader } from "./school-templates";

function cellHtml(value: Cell, kind: ExportTable["columns"][number]["kind"]): string {
  if (value === null || value === "") return "";
  if (typeof value === "number") {
    if (kind === "money") return money(value);
    const text = String(value).replace(".", ",");
    return kind === "percent" ? `${text} %` : text;
  }
  return escapeHtml(value);
}

export function exportHtml(school: SchoolHeader, table: ExportTable, printedOn: string): string {
  const numeric = table.columns.map((c) => c.kind !== "text" && c.kind !== "date");
  const row = (cells: Cell[], tag: "td" | "th" = "td") =>
    `<tr>${cells
      .map(
        (v, i) =>
          `<${tag}${numeric[i] ? ' class="right"' : ""}>${cellHtml(v, table.columns[i].kind)}</${tag}>`,
      )
      .join("")}</tr>`;
  const body = `${header(school)}
<h1>${escapeHtml(table.title)}</h1>
<p>${table.subtitle.map(escapeHtml).join(" · ")}<br><span class="muted">Édité le ${escapeHtml(printedOn)}</span></p>
<table class="grid">
<thead><tr>${table.columns
    .map((c, i) => `<th${numeric[i] ? ' class="right"' : ""}>${escapeHtml(c.header)}</th>`)
    .join("")}</tr></thead>
<tbody>${table.rows.map((r) => row(r)).join("")}</tbody>
${table.totals ? `<tfoot>${row(table.totals, "th")}</tfoot>` : ""}
</table>`;
  return htmlDocument(
    table.title,
    "A4",
    body,
    `${table.landscape ? "@page { size: A4 landscape; margin: 12mm; }" : ""}
.grid { font-size: 10px; }
.grid th, .grid td { border: 1px solid #999; }
.grid thead { display: table-header-group; background: #eee; }
.grid tfoot { display: table-row-group; }
.grid tr { page-break-inside: avoid; }`,
  );
}
