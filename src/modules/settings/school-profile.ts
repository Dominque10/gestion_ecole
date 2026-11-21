// Fiche de l'école (M1) : coordonnées, logo, cachet et signature (utilisés sur reçus et bulletins).
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { authorize, can, type Principal } from "@/server/auth/permissions";
import { withSchool } from "@/server/db/client";
import { auditLogs, schools } from "@/server/db/schema";
import { getStorage } from "@/server/storage";
import {
  detectImageType,
  imageExtension,
  imageTypeFromKey,
  MAX_IMAGE_BYTES,
  type ImageType,
} from "@/server/storage/images";
import { SettingsError } from "./errors";
import { SchoolProfileSchema, type SchoolProfileInput } from "./schemas";

export const SCHOOL_IMAGE_KINDS = ["logo", "stamp", "signature"] as const;
export type SchoolImageKind = (typeof SCHOOL_IMAGE_KINDS)[number];

const IMAGE_COLUMNS = {
  logo: schools.logoKey,
  stamp: schools.stampKey,
  signature: schools.signatureKey,
} as const;
const IMAGE_FIELDS = { logo: "logoKey", stamp: "stampKey", signature: "signatureKey" } as const;

export function isSchoolImageKind(value: string): value is SchoolImageKind {
  return (SCHOOL_IMAGE_KINDS as readonly string[]).includes(value);
}

function context(principal: Principal) {
  // Appelé après authorize : une action d'école garantit une école de session.
  return { schoolId: principal.schoolId as string, userId: principal.userId };
}

export type SchoolProfile = {
  name: string;
  code: string;
  matriculePrefix: string;
  address: string | null;
  phone: string | null;
  /** Clé du fichier (change à chaque remplacement : sert aussi à éviter les images périmées en cache). */
  images: Record<SchoolImageKind, string | null>;
};

export async function getSchoolProfile(principal: Principal): Promise<SchoolProfile> {
  authorize(principal, "settings:read");
  const ctx = context(principal);
  const [row] = await withSchool(ctx, (tx) =>
    tx.select().from(schools).where(eq(schools.id, ctx.schoolId)),
  );
  if (!row) throw new SettingsError("notFound");
  return {
    name: row.name,
    code: row.code,
    matriculePrefix: row.matriculePrefix,
    address: row.address,
    phone: row.phone,
    images: { logo: row.logoKey, stamp: row.stampKey, signature: row.signatureKey },
  };
}

/** Le code école et le préfixe des matricules ne se modifient pas ici (connexion, décision A6). */
export async function updateSchoolProfile(
  principal: Principal,
  input: SchoolProfileInput,
): Promise<void> {
  authorize(principal, "settings:write");
  const ctx = context(principal);
  const data = SchoolProfileSchema.parse(input);
  await withSchool(ctx, async (tx) => {
    const [before] = await tx
      .select({ name: schools.name, address: schools.address, phone: schools.phone })
      .from(schools)
      .where(eq(schools.id, ctx.schoolId));
    await tx
      .update(schools)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schools.id, ctx.schoolId));
    await tx.insert(auditLogs).values({
      schoolId: ctx.schoolId,
      actorUserId: principal.userId,
      action: "school.profile",
      entityType: "school",
      entityId: ctx.schoolId,
      before,
      after: data,
    });
  });
}

/**
 * Remplace (ou ajoute) une image de l'école. Le contenu est vérifié (PNG, JPEG ou WebP, 500 Ko au plus).
 * Le cachet et la signature servent à authentifier reçus et bulletins : chaque changement est tracé.
 */
export async function setSchoolImage(
  principal: Principal,
  kind: SchoolImageKind,
  bytes: Uint8Array,
): Promise<void> {
  authorize(principal, "settings:write");
  const ctx = context(principal);
  if (bytes.length === 0) throw new SettingsError("imageMissing");
  if (bytes.length > MAX_IMAGE_BYTES) throw new SettingsError("imageTooLarge");
  const type = detectImageType(bytes);
  if (!type) throw new SettingsError("imageType");

  const storage = getStorage();
  const key = `schools/${ctx.schoolId}/${kind}-${randomUUID()}.${imageExtension(type)}`;
  await storage.put(key, bytes);
  let previous: string | null = null;
  try {
    previous = await withSchool(ctx, async (tx) => {
      const [row] = await tx
        .select({ key: IMAGE_COLUMNS[kind] })
        .from(schools)
        .where(eq(schools.id, ctx.schoolId))
        .for("update");
      await tx
        .update(schools)
        .set({ [IMAGE_FIELDS[kind]]: key, updatedAt: new Date() })
        .where(eq(schools.id, ctx.schoolId));
      await tx.insert(auditLogs).values({
        schoolId: ctx.schoolId,
        actorUserId: principal.userId,
        action: "school.image",
        entityType: "school",
        entityId: ctx.schoolId,
        before: { kind, key: row?.key ?? null },
        after: { kind, key },
      });
      return row?.key ?? null;
    });
  } catch (error) {
    await storage.delete(key);
    throw error;
  }
  // L'ancien fichier n'est supprimé qu'une fois la base à jour.
  if (previous) await storage.delete(previous);
}

export async function removeSchoolImage(
  principal: Principal,
  kind: SchoolImageKind,
): Promise<void> {
  authorize(principal, "settings:write");
  const ctx = context(principal);
  const previous = await withSchool(ctx, async (tx) => {
    const [row] = await tx
      .select({ key: IMAGE_COLUMNS[kind] })
      .from(schools)
      .where(eq(schools.id, ctx.schoolId))
      .for("update");
    if (!row?.key) return null;
    await tx
      .update(schools)
      .set({ [IMAGE_FIELDS[kind]]: null, updatedAt: new Date() })
      .where(eq(schools.id, ctx.schoolId));
    await tx.insert(auditLogs).values({
      schoolId: ctx.schoolId,
      actorUserId: principal.userId,
      action: "school.image",
      entityType: "school",
      entityId: ctx.schoolId,
      before: { kind, key: row.key },
      after: { kind, key: null },
    });
    return row.key;
  });
  if (previous) await getStorage().delete(previous);
}

/**
 * Lit une image de l'école de session. Le logo est visible de tout le personnel ; le cachet et la
 * signature (risque de falsification) seulement de ceux qui lisent le paramétrage.
 */
export async function readSchoolImage(
  principal: Principal,
  kind: SchoolImageKind,
): Promise<{ bytes: Uint8Array; type: ImageType } | null> {
  if (!principal.schoolId || principal.roles.length === 0) return null;
  if (kind !== "logo" && !can(principal, "settings:read")) return null;
  const ctx = context(principal);
  const [row] = await withSchool(ctx, (tx) =>
    tx.select({ key: IMAGE_COLUMNS[kind] }).from(schools).where(eq(schools.id, ctx.schoolId)),
  );
  if (!row?.key) return null;
  const type = imageTypeFromKey(row.key);
  const bytes = await getStorage().get(row.key);
  return type && bytes ? { bytes, type } : null;
}
