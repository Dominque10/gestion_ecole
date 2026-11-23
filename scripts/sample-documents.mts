// Génère des exemples de documents PDF (données fictives) pour vérifier leur rendu à l'œil.
// Usage : node --import tsx scripts/sample-documents.mts <dossier>
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import { closePdfBrowser, htmlToPdf } from "../src/modules/documents/pdf.ts";
import { receiptHtml } from "../src/modules/documents/receipt-template.ts";
import { bulletinsHtml } from "../src/modules/documents/bulletin-template.ts";
import type { Bulletin } from "../src/modules/grading/bulletins.ts";
import {
  certificateHtml,
  classListHtml,
  studentCardsHtml,
} from "../src/modules/documents/school-templates.ts";

const out = process.argv[2];
if (!out) {
  console.error("Usage : node --import tsx scripts/sample-documents.mts <dossier>");
  process.exit(1);
}
await mkdir(out, { recursive: true });

const school = {
  name: "Collège Saint-Jean Bosco",
  address: "12 avenue de la Paix, Moungali, Brazzaville",
  phone: "+242 06 123 45 67",
  logo: null,
  stamp: null,
  signature: null,
};
const names = ["NGOMA", "MABIALA", "OKEMBA", "MOUKALA", "NKOUNKOU", "MAMPOUYA", "BATCHI", "LOEMBA"];
const roster = {
  classId: "x",
  className: "6e A",
  levelName: "6e",
  yearLabel: "2026-2027",
  headTeacherName: "M. Jean Okemba",
  students: names.map((n, i) => ({
    studentId: String(i),
    matricule: `SJB-26-${String(i + 1).padStart(5, "0")}`,
    lastName: n,
    firstNames: i % 2 ? "Paul Arsène" : "Bénédicte Ève",
    sex: (i % 2 ? "M" : "F") as "M" | "F",
    birthDate: "2014-03-12",
    photoKey: null,
  })),
};
const qrSvg = await QRCode.toString("https://ecole.example/verifier/demo", {
  type: "svg",
  margin: 0,
});
const receipt = {
  paymentId: "x",
  receiptNumber: "SJB-2026-00042",
  paidAt: new Date("2026-11-21T13:05:00Z"),
  amount: 30_000,
  method: "mobile_money" as const,
  reference: "MP261121.1305.A12345",
  note: null,
  cashierName: "Jean Comptable",
  school: { name: school.name, address: school.address, phone: school.phone, logoKey: null },
  student: {
    matricule: "SJB-26-00001",
    name: "NGOMA Bénédicte Ève",
    level: "6e",
    className: "6e A",
    year: "2026-2027",
  },
  allocations: [
    { label: "Frais d'inscription", amount: 25_000 },
    { label: "Scolarité — tranche 1/3", amount: 5_000 },
  ],
  remainingAfter: 145_000,
  reversed: false,
};
const certificate = {
  status: "enrolled" as const,
  student: { ...roster.students[0], birthPlace: "Brazzaville" },
  yearLabel: "2026-2027",
  levelName: "6e",
  className: "6e A",
  entryDate: "2026-10-01",
  exitDate: null,
  exitReason: null,
};

const subjects: [string, number, number | null, string][] = [
  ["Mathématiques", 4, 13.5, "Bon travail, continue ainsi."],
  ["Français", 3, 11.25, "Des progrès en expression écrite."],
  ["Anglais", 2, 15, "Très bonne participation."],
  ["Histoire-Géographie", 2, 9.75, "Doit apprendre ses leçons."],
  ["Sciences de la vie et de la Terre", 2, 12, ""],
  ["Physique-Chimie", 2, null, ""],
  ["Éducation physique et sportive", 1, 16, "Excellent."],
];
const bulletin: Bulletin = {
  version: 1,
  enrollmentId: "x",
  yearLabel: "2026-2027",
  className: "6e A",
  levelName: "6e",
  headTeacherName: "M. Jean Okemba",
  classSize: 48,
  annual: false,
  periodLabel: "1er trimestre",
  scale: 20,
  student: {
    matricule: "SJB-26-00042",
    lastName: "NGOMA",
    firstNames: "Bénédicte Ève",
    sex: "F",
    birthDate: "2014-05-12",
  },
  subjects: subjects.map(([name, coefficient, average, comment], i) => ({
    name,
    coefficient,
    optional: i === 6,
    teacherName: i % 2 ? "Mme Mabiala" : "M. Okemba",
    average,
    points:
      average === null ? null : i === 6 ? (average - 10) * coefficient : average * coefficient,
    classAverage: 10.8 + i / 10,
    highest: 17.5,
    lowest: 4.25,
    comment,
  })),
  totalCoefficients: 15,
  totalPoints: 179.5,
  periods: [],
  average: 11.97,
  rank: 12,
  tied: true,
  mention: "",
  classStats: { average: 10.84, highest: 16.2, lowest: 5.1 },
  generalComment: "Trimestre encourageant. Doit fournir plus d'efforts en histoire-géographie.",
  attendance: { absences: 3, unjustified: 1, lates: 2 },
  decision: null,
  councilDate: "2026-12-18T10:00:00Z",
};

const docs: [string, string, "A4" | "A5" | "ticket"][] = [
  [
    "bulletin.pdf",
    bulletinsHtml(school, [bulletin], { draft: false, printedOn: "2026-12-19" }),
    "A4",
  ],
  [
    "bulletin-projet.pdf",
    bulletinsHtml(school, [bulletin], { draft: true, printedOn: "2026-12-19" }),
    "A4",
  ],
  ["recu-a5.pdf", receiptHtml(receipt, { format: "A5", qrSvg, logoDataUri: null }), "A5"],
  [
    "recu-ticket.pdf",
    receiptHtml(receipt, { format: "ticket", qrSvg, logoDataUri: null }),
    "ticket",
  ],
  ["liste.pdf", classListHtml(school, roster, "2026-11-21"), "A4"],
  ["cartes.pdf", studentCardsHtml(school, roster, new Map()), "A4"],
  ["certificat.pdf", certificateHtml(school, certificate, "schooling", "2026-11-21"), "A4"],
];
for (const [name, html, format] of docs) {
  await writeFile(path.join(out, name), await htmlToPdf(html, format));
  console.log(path.join(out, name));
}
await closePdfBrowser();
