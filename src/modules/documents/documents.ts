// Documents PDF (M2/M3, 2f) : demande déposée dans la file d'attente par l'application, PDF produit
// par le worker, récupéré par la même personne. Les droits sont vérifiés à la demande ET dans le
// worker (qui relit les rôles en base : le contenu de la tâche n'est jamais cru sur parole).
import { and, eq } from "drizzle-orm";
import QRCode from "qrcode";
import { z } from "zod";
import { getReceipt } from "@/modules/finance/payments";
import type { MembershipRole, Principal } from "@/server/auth/permissions";
import { withSchool } from "@/server/db/client";
import { memberships, schools } from "@/server/db/schema";
import { todayInBrazzaville } from "@/lib/dates";
import { authorize } from "@/server/auth/permissions";
import { StudentError } from "@/modules/students/errors";
import {
  getCertificateData,
  getClassRoster,
  type CertificateData,
} from "@/modules/students/enrollments";
import {
  certificateHtml,
  classListHtml,
  studentCardsHtml,
  type SchoolHeader,
} from "./school-templates";
import { getStorage } from "@/server/storage";
import { imageTypeFromKey } from "@/server/storage/images";
import { htmlToPdf } from "./pdf";
import { receiptHtml } from "./receipt-template";
import { receiptVerifyUrl } from "./verification";

export const DocumentRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("receipt"), paymentId: z.uuid(), format: z.enum(["A5", "ticket"]) }),
  z.object({ kind: z.literal("class_list"), classId: z.uuid() }),
  z.object({ kind: z.literal("student_cards"), classId: z.uuid() }),
  z.object({
    kind: z.literal("certificate"),
    enrollmentId: z.uuid(),
    type: z.enum(["schooling", "radiation"]),
  }),
]);
export type DocumentRequest = z.infer<typeof DocumentRequestSchema>;

/** Contenu d'une tâche « document » : qui demande, pour quelle école, quel document. */
export const DocumentJobSchema = z.object({
  schoolId: z.uuid(),
  userId: z.uuid(),
  request: DocumentRequestSchema,
});
export type DocumentJob = z.infer<typeof DocumentJobSchema>;

export type RenderedDocument = { fileName: string; pdfBase64: string };

/**
 * Vérifie les droits et l'existence du document AVANT de déposer la tâche (réponse immédiate à
 * l'utilisateur si le document n'est pas accessible). Renvoie le nom du fichier.
 */
export async function checkDocumentRequest(
  principal: Principal,
  request: DocumentRequest,
): Promise<string> {
  const data = DocumentRequestSchema.parse(request);
  switch (data.kind) {
    case "receipt": {
      const receipt = await getReceipt(principal, data.paymentId);
      return `recu-${receipt.receiptNumber}.pdf`;
    }
    case "class_list":
      return `liste-${slug((await getClassRoster(principal, data.classId)).className)}.pdf`;
    case "student_cards":
      authorize(principal, "students:write");
      return `cartes-${slug((await getClassRoster(principal, data.classId)).className)}.pdf`;
    case "certificate": {
      const certificate = await getCertificateData(principal, data.enrollmentId);
      assertCertificateType(certificate, data.type);
      return certificateFileName(certificate, data.type);
    }
  }
}

/** Nom de fichier sûr : lettres et chiffres sans accents, tirets. */
function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Certificat de scolarité : élève inscrit. Certificat de radiation : élève parti. */
function assertCertificateType(data: CertificateData, type: "schooling" | "radiation"): void {
  const ok = type === "schooling" ? data.status === "enrolled" : data.status === "left";
  if (!ok) throw new StudentError(type === "schooling" ? "notEnrolled" : "notLeft");
}

function certificateFileName(data: CertificateData, type: "schooling" | "radiation"): string {
  return `${type === "schooling" ? "certificat-scolarite" : "certificat-radiation"}-${data.student.matricule}.pdf`;
}

/** Rôles actuels de l'utilisateur dans l'école, relus en base (accès Support expiré = aucun). */
async function currentPrincipal(job: DocumentJob): Promise<Principal> {
  const [row] = await withSchool({ schoolId: job.schoolId, userId: job.userId }, (tx) =>
    tx
      .select({ roles: memberships.roles, expiresAt: memberships.expiresAt })
      .from(memberships)
      .where(and(eq(memberships.schoolId, job.schoolId), eq(memberships.userId, job.userId))),
  );
  const roles: MembershipRole[] =
    row && (!row.expiresAt || row.expiresAt > new Date()) ? row.roles : [];
  return { userId: job.userId, schoolId: job.schoolId, roles, isSuperadmin: false };
}

async function logoDataUri(key: string | null): Promise<string | null> {
  if (!key) return null;
  const type = imageTypeFromKey(key);
  const bytes = await getStorage().get(key);
  return type && bytes ? `data:${type};base64,${Buffer.from(bytes).toString("base64")}` : null;
}

/** En-tête de l'école (nom, coordonnées, logo, cachet, signature) pour les documents officiels. */
async function schoolHeader(principal: Principal): Promise<SchoolHeader> {
  const schoolId = principal.schoolId as string;
  const [row] = await withSchool({ schoolId, userId: principal.userId }, (tx) =>
    tx.select().from(schools).where(eq(schools.id, schoolId)),
  );
  return {
    name: row.name,
    address: row.address,
    phone: row.phone,
    logo: await logoDataUri(row.logoKey),
    stamp: await logoDataUri(row.stampKey),
    signature: await logoDataUri(row.signatureKey),
  };
}

const pdfResult = async (fileName: string, html: string): Promise<RenderedDocument> => ({
  fileName,
  pdfBase64: Buffer.from(await htmlToPdf(html, "A4")).toString("base64"),
});

/** Produit le PDF d'une tâche (appelé par le worker). Les droits sont revérifiés ici. */
export async function renderDocument(raw: unknown): Promise<RenderedDocument> {
  const job = DocumentJobSchema.parse(raw);
  const principal = await currentPrincipal(job);
  switch (job.request.kind) {
    case "receipt": {
      const receipt = await getReceipt(principal, job.request.paymentId);
      const qrSvg = await QRCode.toString(receiptVerifyUrl(receipt.paymentId), {
        type: "svg",
        margin: 0,
        errorCorrectionLevel: "M",
      });
      const html = receiptHtml(receipt, {
        format: job.request.format,
        qrSvg,
        logoDataUri: await logoDataUri(receipt.school.logoKey),
      });
      const pdf = await htmlToPdf(html, job.request.format);
      return {
        fileName: `recu-${receipt.receiptNumber}.pdf`,
        pdfBase64: Buffer.from(pdf).toString("base64"),
      };
    }
    case "class_list": {
      const roster = await getClassRoster(principal, job.request.classId);
      const html = classListHtml(await schoolHeader(principal), roster, todayInBrazzaville());
      return pdfResult(`liste-${slug(roster.className)}.pdf`, html);
    }
    case "student_cards": {
      authorize(principal, "students:write");
      const roster = await getClassRoster(principal, job.request.classId);
      const photos = new Map<string, string>();
      for (const s of roster.students) {
        const uri = await logoDataUri(s.photoKey);
        if (uri) photos.set(s.studentId, uri);
      }
      const html = studentCardsHtml(await schoolHeader(principal), roster, photos);
      return pdfResult(`cartes-${slug(roster.className)}.pdf`, html);
    }
    case "certificate": {
      const data = await getCertificateData(principal, job.request.enrollmentId);
      assertCertificateType(data, job.request.type);
      const html = certificateHtml(
        await schoolHeader(principal),
        data,
        job.request.type,
        todayInBrazzaville(),
      );
      return pdfResult(certificateFileName(data, job.request.type), html);
    }
  }
}
