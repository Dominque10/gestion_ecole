// Photo de l'élève et pièces jointes (photos de documents prises au téléphone, hypothèse H44).
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool, type Tx } from "@/server/db/client";
import { studentDocuments, students } from "@/server/db/schema";
import { getStorage } from "@/server/storage";
import {
  detectImageType,
  imageExtension,
  imageTypeFromKey,
  type ImageType,
} from "@/server/storage/images";
import { StudentError } from "./errors";
import { seesAllStudents } from "./students";

/** Photo d'identité : petite. Document : plus grand, pour rester lisible (acte de naissance). */
export const MAX_PHOTO_BYTES = 300 * 1024;
export const MAX_DOCUMENT_BYTES = 700 * 1024;

export const DOCUMENT_KINDS = ["birth_certificate", "report_card", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export type StudentDocument = {
  id: string;
  kind: DocumentKind;
  label: string | null;
  createdAt: Date;
};

function checkImage(bytes: Uint8Array, max: number): ImageType {
  if (bytes.length === 0) throw new StudentError("imageMissing");
  if (bytes.length > max) throw new StudentError("imageTooLarge");
  const type = detectImageType(bytes);
  if (!type) throw new StudentError("imageType");
  return type;
}

async function assertStudent(tx: Tx, schoolId: string, studentId: string) {
  if (!z.uuid().safeParse(studentId).success) throw new StudentError("notFound");
  const [row] = await tx
    .select({ id: students.id, photoKey: students.photoKey })
    .from(students)
    .where(and(eq(students.schoolId, schoolId), eq(students.id, studentId)))
    .for("update");
  if (!row) throw new StudentError("notFound");
  return row;
}

function writeContext(principal: Principal) {
  authorize(principal, "students:write");
  return { schoolId: principal.schoolId as string, userId: principal.userId };
}

function readContext(principal: Principal) {
  authorize(principal, "students:read");
  if (!seesAllStudents(principal)) throw new StudentError("notFound");
  return { schoolId: principal.schoolId as string, userId: principal.userId };
}

export async function setStudentPhoto(
  principal: Principal,
  studentId: string,
  bytes: Uint8Array,
): Promise<void> {
  const ctx = writeContext(principal);
  const type = checkImage(bytes, MAX_PHOTO_BYTES);
  const key = `schools/${ctx.schoolId}/students/${studentId}/photo-${randomUUID()}.${imageExtension(type)}`;
  const storage = getStorage();
  let previous: string | null = null;
  // Vérifie l'élève avant d'écrire le fichier (identifiant contrôlé, clé de fichier sûre).
  await withSchool(ctx, (tx) => assertStudent(tx, ctx.schoolId, studentId));
  await storage.put(key, bytes);
  try {
    previous = await withSchool(ctx, async (tx) => {
      const current = await assertStudent(tx, ctx.schoolId, studentId);
      await tx
        .update(students)
        .set({ photoKey: key, updatedAt: new Date() })
        .where(eq(students.id, studentId));
      return current.photoKey;
    });
  } catch (error) {
    await storage.delete(key);
    throw error;
  }
  if (previous) await storage.delete(previous);
}

export async function readStudentPhoto(
  principal: Principal,
  studentId: string,
): Promise<{ bytes: Uint8Array; type: ImageType } | null> {
  const ctx = readContext(principal);
  if (!z.uuid().safeParse(studentId).success) return null;
  const [row] = await withSchool(ctx, (tx) =>
    tx
      .select({ key: students.photoKey })
      .from(students)
      .where(and(eq(students.schoolId, ctx.schoolId), eq(students.id, studentId))),
  );
  if (!row?.key) return null;
  const type = imageTypeFromKey(row.key);
  const bytes = await getStorage().get(row.key);
  return type && bytes ? { bytes, type } : null;
}

export async function addStudentDocument(
  principal: Principal,
  studentId: string,
  input: { kind: DocumentKind; label: string; bytes: Uint8Array },
): Promise<string> {
  const ctx = writeContext(principal);
  const kind = z.enum(DOCUMENT_KINDS).parse(input.kind);
  const label = z.string().trim().max(80).parse(input.label) || null;
  const type = checkImage(input.bytes, MAX_DOCUMENT_BYTES);
  await withSchool(ctx, (tx) => assertStudent(tx, ctx.schoolId, studentId));
  const key = `schools/${ctx.schoolId}/students/${studentId}/doc-${randomUUID()}.${imageExtension(type)}`;
  const storage = getStorage();
  await storage.put(key, input.bytes);
  try {
    return await withSchool(ctx, async (tx) => {
      await assertStudent(tx, ctx.schoolId, studentId);
      const [row] = await tx
        .insert(studentDocuments)
        .values({
          schoolId: ctx.schoolId,
          studentId,
          kind,
          label,
          fileKey: key,
          uploadedBy: ctx.userId,
        })
        .returning({ id: studentDocuments.id });
      return row.id;
    });
  } catch (error) {
    await storage.delete(key);
    throw error;
  }
}

export async function listStudentDocuments(
  principal: Principal,
  studentId: string,
): Promise<StudentDocument[]> {
  const ctx = readContext(principal);
  if (!z.uuid().safeParse(studentId).success) throw new StudentError("notFound");
  return withSchool(ctx, (tx) =>
    tx
      .select({
        id: studentDocuments.id,
        kind: studentDocuments.kind,
        label: studentDocuments.label,
        createdAt: studentDocuments.createdAt,
      })
      .from(studentDocuments)
      .where(
        and(eq(studentDocuments.schoolId, ctx.schoolId), eq(studentDocuments.studentId, studentId)),
      )
      .orderBy(desc(studentDocuments.createdAt)),
  );
}

export async function readStudentDocument(
  principal: Principal,
  documentId: string,
): Promise<{ bytes: Uint8Array; type: ImageType } | null> {
  const ctx = readContext(principal);
  if (!z.uuid().safeParse(documentId).success) return null;
  const [row] = await withSchool(ctx, (tx) =>
    tx
      .select({ key: studentDocuments.fileKey })
      .from(studentDocuments)
      .where(and(eq(studentDocuments.schoolId, ctx.schoolId), eq(studentDocuments.id, documentId))),
  );
  if (!row) return null;
  const type = imageTypeFromKey(row.key);
  const bytes = await getStorage().get(row.key);
  return type && bytes ? { bytes, type } : null;
}

/** Supprime une pièce jointe (erreur de photo, document remplacé). */
export async function deleteStudentDocument(
  principal: Principal,
  documentId: string,
): Promise<void> {
  const ctx = writeContext(principal);
  if (!z.uuid().safeParse(documentId).success) throw new StudentError("documentNotFound");
  const key = await withSchool(ctx, async (tx) => {
    const [row] = await tx
      .delete(studentDocuments)
      .where(and(eq(studentDocuments.schoolId, ctx.schoolId), eq(studentDocuments.id, documentId)))
      .returning({ key: studentDocuments.fileKey });
    if (!row) throw new StudentError("documentNotFound");
    return row.key;
  });
  await getStorage().delete(key);
}
