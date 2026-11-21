// Génère des exemples de documents PDF (données fictives) pour vérifier leur rendu à l'œil.
// Usage : node --import tsx scripts/sample-documents.mts <dossier>
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import { closePdfBrowser, htmlToPdf } from "../src/modules/documents/pdf.ts";
import { receiptHtml } from "../src/modules/documents/receipt-template.ts";
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

const docs: [string, string, "A4" | "A5" | "ticket"][] = [
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
