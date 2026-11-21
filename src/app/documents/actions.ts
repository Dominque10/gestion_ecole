"use server";

import { DocumentRequestSchema } from "@/modules/documents/documents";
import { requestDocument } from "@/modules/documents/requests";
import { requireSession } from "@/server/auth/session";
import { refusalMessage } from "@/server/forms";

/** Dépose une demande de document ; renvoie l'identifiant à suivre, ou un message d'erreur. */
export async function requestDocumentAction(
  raw: unknown,
): Promise<{ jobId: string } | { error: string }> {
  const { principal } = await requireSession();
  const request = DocumentRequestSchema.safeParse(raw);
  if (!request.success) return { error: "Demande invalide." };
  try {
    return { jobId: await requestDocument(principal, request.data) };
  } catch (error) {
    return { error: refusalMessage(error) };
  }
}
