// Gabarit du bulletin de notes (A4, une page par élève) : en-tête de l'école, identité de l'élève,
// tableau des matières, résultats, appréciations, absences, cachet et signature (hypothèse B2 : format
// à ajuster dès qu'une école fournira son modèle).
import type { Bulletin } from "@/modules/grading/bulletins";
import { escapeHtml, htmlDocument } from "./html";
import type { SchoolHeader } from "./school-templates";

const num = (value: number | null) => (value === null ? "—" : value.toFixed(2).replace(".", ","));
const rank = (value: number | null, tied: boolean) =>
  value === null ? "Non classé" : `${value}${value === 1 ? "er" : "e"}${tied ? " ex æquo" : ""}`;

const DECISIONS: Record<string, { M: string; F: string }> = {
  promoted: { M: "Admis en classe supérieure", F: "Admise en classe supérieure" },
  repeat: { M: "Redouble", F: "Redouble" },
  excluded: { M: "Exclu", F: "Exclue" },
};

function day(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Brazzaville",
  })
    .format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso))
    .replace(/^1 /, "1er ");
}

function head(school: SchoolHeader, b: Bulletin): string {
  const logo = school.logo
    ? `<td style="width:64px"><img src="${school.logo}" alt="" style="max-height:60px;max-width:60px"></td>`
    : "";
  const title = b.annual ? "Bulletin annuel" : `Bulletin de notes — ${escapeHtml(b.periodLabel)}`;
  return `<table><tr>${logo}
  <td><div class="big">${escapeHtml(school.name)}</div>
  ${school.address ? `<div>${escapeHtml(school.address)}</div>` : ""}
  ${school.phone ? `<div>Tél. ${escapeHtml(school.phone)}</div>` : ""}</td>
  <td class="right"><div class="big">${title}</div><div>Année scolaire ${escapeHtml(b.yearLabel)}</div></td>
</tr></table><div class="rule"></div>`;
}

function identity(b: Bulletin): string {
  const born = b.student.birthDate
    ? ` · Né${b.student.sex === "F" ? "e" : ""} le ${day(b.student.birthDate)}`
    : "";
  return `<table class="ident"><tr>
  <td><strong>${escapeHtml(b.student.lastName)}</strong> ${escapeHtml(b.student.firstNames)}<br>
  Matricule ${escapeHtml(b.student.matricule)}${born}</td>
  <td class="right">Classe : <strong>${escapeHtml(b.className)}</strong> (${escapeHtml(b.levelName)}) · Effectif : ${b.classSize}<br>
  ${b.headTeacherName ? `Professeur principal : ${escapeHtml(b.headTeacherName)}` : ""}</td>
</tr></table>`;
}

function subjectsTable(b: Bulletin): string {
  const rows = b.subjects
    .map(
      (s) => `<tr>
  <td><strong>${escapeHtml(s.name)}</strong>${s.optional ? ' <span class="muted">(facultative)</span>' : ""}
  ${s.teacherName ? `<div class="muted small">${escapeHtml(s.teacherName)}</div>` : ""}</td>
  <td class="center">${s.coefficient}</td>
  <td class="center"><strong>${s.average === null ? "Non noté" : num(s.average)}</strong></td>
  <td class="center">${num(s.points)}</td>
  <td class="center small">${num(s.classAverage)}</td>
  <td class="center small">${num(s.highest)} / ${num(s.lowest)}</td>
  <td class="small">${escapeHtml(s.comment)}</td>
</tr>`,
    )
    .join("");
  return `<table class="grid">
<thead><tr><th>Matière</th><th class="center">Coef.</th><th class="center">Moy. /${b.scale}</th><th class="center">Points</th><th class="center">Moy. classe</th><th class="center">+ forte / + faible</th><th>Appréciation</th></tr></thead>
<tbody>${rows}
<tr class="total"><td>Total</td><td class="center">${b.totalCoefficients}</td><td></td><td class="center">${num(b.totalPoints)}</td><td colspan="3"></td></tr>
</tbody></table>`;
}

function periodsTable(b: Bulletin): string {
  const rows = b.periods
    .map(
      (p) =>
        `<tr><td>${escapeHtml(p.label)}</td><td class="center">${num(p.average)}</td><td class="center">${rank(p.rank, p.tied)}</td></tr>`,
    )
    .join("");
  return `<table class="grid"><thead><tr><th>Période</th><th class="center">Moyenne générale /${b.scale}</th><th class="center">Rang</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function summary(b: Bulletin): string {
  const decision = b.decision ? DECISIONS[b.decision][b.student.sex] : null;
  return `<table class="summary"><tr>
  <td><div>Moyenne ${b.annual ? "annuelle" : "générale"}</div><div class="avg">${num(b.average)} / ${b.scale}</div></td>
  <td><div>Rang</div><div class="avg">${rank(b.rank, b.tied)}</div><div class="small">sur ${b.classSize}</div></td>
  <td class="small">Moyenne de la classe : ${num(b.classStats.average)}<br>Plus forte : ${num(b.classStats.highest)}<br>Plus faible : ${num(b.classStats.lowest)}</td>
  <td class="small">Absences : ${b.attendance.absences} créneau(x), dont ${b.attendance.unjustified} non justifié(s)<br>Retards : ${b.attendance.lates}</td>
</tr></table>
<table class="council"><tr>
  <td><strong>Mention :</strong> ${b.mention ? escapeHtml(b.mention) : "—"}
  ${decision ? `<br><strong>Décision du conseil :</strong> ${escapeHtml(decision)}` : ""}</td>
</tr><tr><td><strong>Appréciation générale :</strong> ${escapeHtml(b.generalComment) || "—"}</td></tr></table>`;
}

function signature(school: SchoolHeader, b: Bulletin, printedOn: string): string {
  return `<table class="sign"><tr>
  <td class="small">${b.councilDate ? `Conseil de classe du ${day(b.councilDate)}` : ""}
  <div class="visa">Visa des parents</div></td>
  <td class="right">Fait le ${day(printedOn)}<br>Le directeur<br>
  <span class="stamp">${school.stamp ? `<img src="${school.stamp}" alt="" style="max-height:70px">` : ""}
  ${school.signature ? `<img src="${school.signature}" alt="" style="max-height:50px">` : ""}</span></td>
</tr></table>`;
}

/** Bulletins d'une classe ; `draft` : bulletins non publiés, marqués « Projet ». */
export function bulletinsHtml(
  school: SchoolHeader,
  bulletins: readonly Bulletin[],
  options: { draft: boolean; printedOn: string },
): string {
  const pages = bulletins
    .map(
      (b) => `<section class="page">
${options.draft ? `<div class="draft">Projet — bulletin non publié</div>` : ""}
${head(school, b)}${identity(b)}
${b.annual ? periodsTable(b) : subjectsTable(b)}
${summary(b)}
${signature(school, b, options.printedOn)}
</section>`,
    )
    .join("");
  const first = bulletins[0];
  return htmlDocument(
    first ? `Bulletins ${first.className}` : "Bulletins",
    "A4",
    pages,
    `.page { page-break-after: always; position: relative; }
.page:last-child { page-break-after: auto; }
.small { font-size: 10px; }
.ident td { padding: 6px 4px; }
.grid { margin-top: 6px; }
.grid th, .grid td { border: 1px solid #999; }
.grid thead th { background: #eef2ff; }
.grid tr { page-break-inside: avoid; }
.total td { font-weight: bold; background: #f4f4f5; }
.summary { margin-top: 8px; border: 2px solid #1d4ed8; }
.summary td { padding: 6px; width: 25%; }
.avg { font-size: 18px; font-weight: bold; }
.council { margin-top: 8px; }
.council td { border: 1px solid #999; padding: 6px; }
.sign { margin-top: 14px; }
.stamp img { margin-left: 8px; vertical-align: middle; }
.visa { margin-top: 10px; width: 55mm; height: 22mm; border: 1px solid #999; padding: 3px; font-size: 10px; color: #555; }
.draft { position: absolute; top: 40%; left: 0; right: 0; text-align: center; font-size: 34px; color: rgba(185, 28, 28, 0.25); transform: rotate(-20deg); font-weight: bold; }`,
  );
}
