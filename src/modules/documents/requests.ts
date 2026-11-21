// Côté application : déposer une demande de document et en suivre l'état. Seule la personne qui a
// demandé le document, dans la même école, peut le récupérer.
import { z } from "zod";
import type { Principal } from "@/server/auth/permissions";
import { DOCUMENTS_QUEUE, getJobQueue } from "@/server/jobs";
import {
  checkDocumentRequest,
  DocumentJobSchema,
  type DocumentRequest,
  type RenderedDocument,
} from "./documents";

export type DocumentStatus =
  { state: "pending" } | { state: "ready"; fileName: string } | { state: "failed" };

export async function requestDocument(
  principal: Principal,
  request: DocumentRequest,
): Promise<string> {
  await checkDocumentRequest(principal, request);
  const boss = await getJobQueue();
  const id = await boss.send(DOCUMENTS_QUEUE, {
    schoolId: principal.schoolId as string,
    userId: principal.userId,
    request,
  });
  if (!id) throw new Error("La demande de document n'a pas pu être déposée");
  return id;
}

async function ownJob(principal: Principal, jobId: string) {
  if (!z.uuid().safeParse(jobId).success) return null;
  const boss = await getJobQueue();
  const job = await boss.getJobById<unknown>(DOCUMENTS_QUEUE, jobId);
  if (!job) return null;
  const data = DocumentJobSchema.safeParse(job.data);
  if (
    !data.success ||
    data.data.schoolId !== principal.schoolId ||
    data.data.userId !== principal.userId
  ) {
    return null;
  }
  return job;
}

export async function documentStatus(
  principal: Principal,
  jobId: string,
): Promise<DocumentStatus | null> {
  const job = await ownJob(principal, jobId);
  if (!job) return null;
  if (job.state === "completed") {
    return { state: "ready", fileName: (job.output as RenderedDocument).fileName };
  }
  if (job.state === "failed" || job.state === "cancelled") return { state: "failed" };
  return { state: "pending" };
}

export async function documentFile(
  principal: Principal,
  jobId: string,
): Promise<{ fileName: string; bytes: Buffer } | null> {
  const job = await ownJob(principal, jobId);
  if (!job || job.state !== "completed") return null;
  const output = job.output as RenderedDocument;
  return { fileName: output.fileName, bytes: Buffer.from(output.pdfBase64, "base64") };
}
