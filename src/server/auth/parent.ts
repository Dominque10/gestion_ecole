// Connexion des parents (4a) : téléphone + code reçu par SMS, sans mot de passe. Le compte est créé à
// la première connexion si le numéro est celui d'un responsable enregistré par une école (décision
// D20). Ensuite, sélecteur d'enfant toutes écoles confondues (décision A2) ; choisir un enfant d'une
// autre école bascule la session sur cette école, et tout passe par la RLS.
import { randomBytes, randomInt } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { t } from "@/i18n";
import { withAuth } from "@/server/db/client";
import { sessions, users } from "@/server/db/schema";
import { getSmsProvider, type SmsProvider } from "@/server/sms";
import { hashToken, LOCK_DURATION_MS, MAX_FAILED_LOGINS } from "./core";
import type { Principal } from "./permissions";
import { normalizePhone } from "./phone";

/** Hypothèses H107 : code à 6 chiffres valable 10 min ; un envoi par minute ; session de 30 jours. */
export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_RESEND_MS = 60 * 1000;
export const PARENT_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export type CodeRequestResult = { ok: true } | { ok: false; reason: "phone" | "sending" };

const codeHash = (userId: string, code: string) => hashToken(`${userId}:${code}`);

/**
 * Demande d'un code. La réponse est la même que le numéro soit connu ou non (on ne révèle pas qui
 * est parent) ; seul un numéro de responsable reçoit un SMS, au plus un par minute.
 */
export async function requestParentCode(
  rawPhone: string,
  provider: SmsProvider = getSmsProvider(),
  now = new Date(),
): Promise<CodeRequestResult> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, reason: "phone" };
  const toSend = await withAuth(async (tx) => {
    const found = await tx.execute<{ name: string | null }>(
      sql`select app.guardian_name_by_phone(${phone}) as name`,
    );
    const name = found.rows[0]?.name;
    if (!name) return null;
    await tx.insert(users).values({ name, phone }).onConflictDoNothing({ target: users.phone });
    const [user] = await tx.select().from(users).where(eq(users.phone, phone)).for("update");
    if (!user || user.status !== "active") return null;
    if (user.lockedUntil && user.lockedUntil > now) return null;
    if (user.otpSentAt && now.getTime() - user.otpSentAt.getTime() < CODE_RESEND_MS) return null;
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await tx
      .update(users)
      .set({
        otpHash: codeHash(user.id, code),
        otpExpiresAt: new Date(now.getTime() + CODE_TTL_MS),
        otpAttempts: 0,
        otpSentAt: now,
      })
      .where(eq(users.id, user.id));
    return code;
  });
  if (toSend) {
    try {
      await provider.send(phone, t("parent.codeSms", { code: toSend }));
    } catch {
      return { ok: false, reason: "sending" };
    }
  }
  return { ok: true };
}

export type CodeVerifyResult =
  | { ok: true; token: string; expiresAt: Date; principal: Principal }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "locked"; lockedUntil: Date };

export type Child = {
  schoolId: string;
  schoolName: string;
  enrollmentId: string;
  lastName: string;
  firstNames: string;
  className: string | null;
  levelName: string;
  yearLabel: string;
};

type ChildRow = {
  school_id: string;
  school_name: string;
  enrollment_id: string;
  last_name: string;
  first_names: string;
  class_name: string | null;
  level_name: string;
  year_label: string;
};

/** Enfants du compte, toutes écoles confondues (fonction A2, seule lecture inter-écoles). */
async function childrenOf(
  tx: Parameters<Parameters<typeof withAuth>[0]>[0],
  userId: string,
): Promise<Child[]> {
  await tx.execute(sql`select set_config('app.current_user_id', ${userId}, true)`);
  const { rows } = await tx.execute<ChildRow>(sql`select * from app.parent_children()`);
  return rows.map((r) => ({
    schoolId: r.school_id,
    schoolName: r.school_name,
    enrollmentId: r.enrollment_id,
    lastName: r.last_name,
    firstNames: r.first_names,
    className: r.class_name,
    levelName: r.level_name,
    yearLabel: r.year_label,
  }));
}

/**
 * Vérification du code. Après 5 codes faux, blocage 15 minutes (comme les mots de passe). Un code
 * juste relie le compte aux fiches de responsable de ce numéro et ouvre une session sur l'école du
 * premier enfant.
 */
export async function verifyParentCode(
  rawPhone: string,
  rawCode: string,
  now = new Date(),
): Promise<CodeVerifyResult> {
  const phone = normalizePhone(rawPhone);
  const code = rawCode.replace(/\s/g, "");
  if (!phone || !/^\d{6}$/.test(code)) return { ok: false, reason: "invalid" };
  return withAuth(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.phone, phone)).for("update");
    if (!user || user.status !== "active" || !user.otpHash || !user.otpExpiresAt) {
      return { ok: false, reason: "invalid" } as const;
    }
    if (user.lockedUntil && user.lockedUntil > now) {
      return { ok: false, reason: "locked", lockedUntil: user.lockedUntil } as const;
    }
    if (user.otpExpiresAt <= now || user.otpHash !== codeHash(user.id, code)) {
      const attempts = user.otpAttempts + 1;
      if (attempts >= MAX_FAILED_LOGINS) {
        const lockedUntil = new Date(now.getTime() + LOCK_DURATION_MS);
        await tx
          .update(users)
          .set({ otpHash: null, otpExpiresAt: null, otpAttempts: 0, lockedUntil })
          .where(eq(users.id, user.id));
        return { ok: false, reason: "locked", lockedUntil } as const;
      }
      await tx.update(users).set({ otpAttempts: attempts }).where(eq(users.id, user.id));
      return { ok: false, reason: "invalid" } as const;
    }
    await tx
      .update(users)
      .set({
        otpHash: null,
        otpExpiresAt: null,
        otpAttempts: 0,
        lockedUntil: null,
        lastLoginAt: now,
      })
      .where(eq(users.id, user.id));
    await tx.execute(sql`select app.attach_parent(${user.id}, ${phone})`);
    const children = await childrenOf(tx, user.id);
    if (children.length === 0) return { ok: false, reason: "invalid" } as const;
    const schoolId = children[0].schoolId;
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + PARENT_SESSION_MS);
    await tx
      .insert(sessions)
      .values({ tokenHash: hashToken(token), userId: user.id, schoolId, expiresAt });
    return {
      ok: true,
      token,
      expiresAt,
      principal: { userId: user.id, schoolId, roles: ["parent"], isSuperadmin: false },
    } as const;
  });
}

/** Enfants du parent connecté, toutes écoles confondues. */
export async function listChildren(principal: Principal): Promise<Child[]> {
  return withAuth((tx) => childrenOf(tx, principal.userId));
}

/**
 * Choix d'un enfant : si son école n'est pas celle de la session, la session bascule sur elle.
 * Refusé (null) si l'inscription n'est pas celle d'un enfant du compte.
 */
export async function selectChild(
  token: string | undefined,
  principal: Principal,
  enrollmentId: string,
): Promise<Child | null> {
  if (!token) return null;
  return withAuth(async (tx) => {
    const child = (await childrenOf(tx, principal.userId)).find(
      (c) => c.enrollmentId === enrollmentId,
    );
    if (!child) return null;
    if (child.schoolId !== principal.schoolId) {
      await tx
        .update(sessions)
        .set({ schoolId: child.schoolId })
        .where(
          and(eq(sessions.tokenHash, hashToken(token)), eq(sessions.userId, principal.userId)),
        );
    }
    return child;
  });
}

/** Numéro du compte, au format local (« 06 620 00 01 »), pour préremplir le paiement en ligne. */
export async function getUserPhone(userId: string): Promise<string | null> {
  const [row] = await withAuth((tx) =>
    tx.select({ phone: users.phone }).from(users).where(eq(users.id, userId)),
  );
  const phone = row?.phone;
  if (!phone) return null;
  const local = phone.startsWith("+242") ? phone.slice(4) : phone;
  return /^0\d{8}$/.test(local)
    ? `${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5, 7)} ${local.slice(7)}`
    : phone;
}
