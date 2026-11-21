// Gabarit du reçu de paiement (A5 ou ticket 80 mm), avec QR code de vérification.
import type { Receipt } from "@/modules/finance/payments";
import { escapeHtml, htmlDocument, money, type PageFormat } from "./html";

const METHODS: Record<Receipt["method"], string> = {
  cash: "Espèces",
  mobile_money: "Mobile money",
  transfer: "Virement",
  cheque: "Chèque",
};

function dateTime(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Brazzaville",
  }).format(date);
}

export function receiptHtml(
  receipt: Receipt,
  options: {
    format: Extract<PageFormat, "A5" | "ticket">;
    qrSvg: string;
    logoDataUri: string | null;
  },
): string {
  const r = receipt;
  const place = r.student.className
    ? `Classe : ${escapeHtml(r.student.className)}`
    : `Niveau : ${escapeHtml(r.student.level)}`;
  const lines = r.allocations
    .map((a) => `<tr><td>${escapeHtml(a.label)}</td><td class="right">${money(a.amount)}</td></tr>`)
    .join("");
  const body = `
<div class="center">
  ${options.logoDataUri ? `<img src="${options.logoDataUri}" alt="" style="max-height:48px">` : ""}
  <div class="big">${escapeHtml(r.school.name)}</div>
  ${r.school.address ? `<div>${escapeHtml(r.school.address)}</div>` : ""}
  ${r.school.phone ? `<div>${escapeHtml(r.school.phone)}</div>` : ""}
</div>
<div class="rule"></div>
<h1 class="center">Reçu n° ${escapeHtml(r.receiptNumber)}</h1>
${r.reversed ? '<p class="cancelled">PAIEMENT ANNULÉ</p>' : ""}
<p>Date : ${dateTime(r.paidAt)}<br>
Élève : ${escapeHtml(r.student.name)} (${escapeHtml(r.student.matricule)})<br>
${place} · Année ${escapeHtml(r.student.year)}</p>
<div class="rule"></div>
<p class="big">Montant reçu : ${money(r.amount)}</p>
<p>Mode : ${METHODS[r.method]}${r.reference ? `<br>Référence : ${escapeHtml(r.reference)}` : ""}</p>
<table><thead><tr><th>Affecté à</th><th class="right">Montant</th></tr></thead><tbody>${lines}</tbody></table>
<div class="rule"></div>
<p>Reste à payer après ce paiement : <strong>${money(r.remainingAfter)}</strong><br>
Encaissé par : ${escapeHtml(r.cashierName)}</p>
<div class="center">
  <div style="width:${options.format === "ticket" ? "28mm" : "32mm"};margin:4px auto">${options.qrSvg}</div>
  <div class="muted">Scannez pour vérifier ce reçu</div>
</div>`;
  return htmlDocument(`Reçu ${r.receiptNumber}`, options.format, body);
}
