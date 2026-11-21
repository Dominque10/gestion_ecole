// Gabarits : liste de classe (A4), cartes scolaires (8 par page A4), certificats (A4).
import type { CertificateData, ClassRoster } from "@/modules/students/enrollments";
import { escapeHtml, htmlDocument } from "./html";

export type SchoolHeader = {
  name: string;
  address: string | null;
  phone: string | null;
  logo: string | null;
  stamp: string | null;
  signature: string | null;
};

function day(date: string | null): string {
  if (!date) return "—";
  const text = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
  // Usage français : « 1er octobre », pas « 1 octobre ».
  return text.replace(/^1 /, "1er ");
}

function header(school: SchoolHeader): string {
  const logo = school.logo
    ? `<td style="width:60px"><img src="${school.logo}" alt="" style="max-height:56px;max-width:56px"></td>`
    : "";
  return `<table><tr>${logo}
  <td><div class="big">${escapeHtml(school.name)}</div>
  ${school.address ? `<div>${escapeHtml(school.address)}</div>` : ""}
  ${school.phone ? `<div>Tél. ${escapeHtml(school.phone)}</div>` : ""}</td>
</tr></table><div class="rule"></div>`;
}

export function classListHtml(
  school: SchoolHeader,
  roster: ClassRoster,
  printedOn: string,
): string {
  const rows = roster.students
    .map(
      (s, i) => `<tr>
  <td class="right">${i + 1}</td><td>${escapeHtml(s.matricule)}</td>
  <td><strong>${escapeHtml(s.lastName)}</strong> ${escapeHtml(s.firstNames)}</td>
  <td class="center">${s.sex}</td><td>${s.birthDate ? day(s.birthDate) : ""}</td><td style="width:25%"></td>
</tr>`,
    )
    .join("");
  const boys = roster.students.filter((s) => s.sex === "M").length;
  const body = `${header(school)}
<h1>Liste de la classe ${escapeHtml(roster.className)} — ${escapeHtml(roster.yearLabel)}</h1>
<p>Niveau : ${escapeHtml(roster.levelName)}${roster.headTeacherName ? ` · Professeur principal : ${escapeHtml(roster.headTeacherName)}` : ""}<br>
Effectif : ${roster.students.length} (${boys} garçon(s), ${roster.students.length - boys} fille(s)) · Imprimée le ${day(printedOn)}</p>
<table class="grid">
<thead><tr><th class="right">N°</th><th>Matricule</th><th>Nom et prénoms</th><th class="center">Sexe</th><th>Né(e) le</th><th>Observations</th></tr></thead>
<tbody>${rows}</tbody></table>`;
  return htmlDocument(
    `Liste ${roster.className}`,
    "A4",
    body,
    ".grid th, .grid td { border: 1px solid #999; } .grid thead { display: table-header-group; } .grid tr { page-break-inside: avoid; }",
  );
}

export function studentCardsHtml(
  school: SchoolHeader,
  roster: ClassRoster,
  photos: Map<string, string>,
): string {
  const cards = roster.students
    .map((s) => {
      const photo = photos.get(s.studentId);
      return `<div class="card">
  <div class="card-head">${school.logo ? `<img src="${school.logo}" alt="">` : ""}<span>${escapeHtml(school.name)}</span></div>
  <div class="card-body">
    <div class="photo">${photo ? `<img src="${photo}" alt="">` : "Photo"}</div>
    <div><div class="label">Carte scolaire ${escapeHtml(roster.yearLabel)}</div>
      <div class="name">${escapeHtml(s.lastName)}<br>${escapeHtml(s.firstNames)}</div>
      <div>Classe : ${escapeHtml(roster.className)}</div>
      <div>Matricule : ${escapeHtml(s.matricule)}</div>
      ${s.birthDate ? `<div>Né(e) le ${day(s.birthDate)}</div>` : ""}</div>
  </div>
</div>`;
    })
    .join("");
  // Format carte bancaire : 85,6 × 54 mm ; 2 colonnes × 4 lignes par page A4.
  const css = `
.sheet { display: grid; grid-template-columns: 85.6mm 85.6mm; gap: 6mm; justify-content: center; }
.card { width: 85.6mm; height: 54mm; border: 1px solid #333; border-radius: 3mm; padding: 2.5mm; overflow: hidden; page-break-inside: avoid; font-size: 9px; }
.card-head { display: flex; align-items: center; gap: 2mm; font-weight: bold; font-size: 10px; border-bottom: 1px solid #999; padding-bottom: 1mm; }
.card-head img { height: 7mm; }
.card-body { display: flex; gap: 2.5mm; margin-top: 2mm; }
.photo { width: 22mm; height: 28mm; border: 1px solid #999; display: flex; align-items: center; justify-content: center; color: #999; flex-shrink: 0; }
.photo img { width: 100%; height: 100%; object-fit: cover; }
.label { font-weight: bold; color: #1d4ed8; }
.name { font-size: 11px; font-weight: bold; margin: 1mm 0; }`;
  return htmlDocument(`Cartes ${roster.className}`, "A4", `<div class="sheet">${cards}</div>`, css);
}

const EXIT_REASONS: Record<NonNullable<CertificateData["exitReason"]>, string> = {
  transfer: "transfert vers un autre établissement",
  dropout: "abandon",
  expulsion: "exclusion",
};

export function certificateHtml(
  school: SchoolHeader,
  data: CertificateData,
  type: "schooling" | "radiation",
  issuedOn: string,
): string {
  const s = data.student;
  const female = s.sex === "F";
  const born = female ? "née" : "né";
  const e = female ? "e" : "";
  const identity = `<strong>${escapeHtml(s.lastName)} ${escapeHtml(s.firstNames)}</strong>, ${born} le ${day(s.birthDate)}${
    s.birthPlace ? ` à ${escapeHtml(s.birthPlace)}` : ""
  }, matricule ${escapeHtml(s.matricule)}`;
  const place = data.className
    ? `en classe de <strong>${escapeHtml(data.className)}</strong>`
    : `au niveau <strong>${escapeHtml(data.levelName)}</strong>`;
  const title = type === "schooling" ? "Certificat de scolarité" : "Certificat de radiation";
  const text =
    type === "schooling"
      ? `<p>Le chef d'établissement soussigné certifie que l'élève ${identity}, est régulièrement inscrit${e} ${place} pour l'année scolaire ${escapeHtml(data.yearLabel)}, depuis le ${day(data.entryDate)}.</p>`
      : `<p>Le chef d'établissement soussigné certifie que l'élève ${identity}, inscrit${e} ${place} pour l'année scolaire ${escapeHtml(data.yearLabel)}, a quitté l'établissement le ${day(data.exitDate)}${
          data.exitReason ? ` (motif : ${EXIT_REASONS[data.exitReason]})` : ""
        }, et a été radié${e} des effectifs à cette date.</p>`;
  const body = `${header(school)}
<h1 class="center" style="margin:24px 0;font-size:20px;text-transform:uppercase">${title}</h1>
<div style="font-size:14px;line-height:1.7">${text}
<p>En foi de quoi, le présent certificat lui est délivré pour servir et valoir ce que de droit.</p></div>
<p style="margin-top:32px;text-align:right">Fait le ${day(issuedOn)}.<br>Le chef d'établissement</p>
<div style="display:flex;justify-content:flex-end;gap:12px;margin-top:8px">
  ${school.stamp ? `<img src="${school.stamp}" alt="" style="max-height:90px">` : ""}
  ${school.signature ? `<img src="${school.signature}" alt="" style="max-height:70px">` : ""}
</div>`;
  return htmlDocument(title, "A4", body);
}
