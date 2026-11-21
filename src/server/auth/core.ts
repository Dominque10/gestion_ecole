// Cœur de l'authentification, indépendant de Next.js (testable directement).
import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { setSchoolContext, withAuth, type Tx } from "@/server/db/client";
import { memberships, sessions, users } from "@/server/db/schema";
import { verifyDummyPassword, verifyPassword } from "./password";
import type { MembershipRole, Principal } from "./permissions";
import { parseIdentifier } from "./phone";

/** Verrouillage après 5 échecs (cahier des charges §6). Durée : hypothèse, 15 minutes. */
export const MAX_FAILED_LOGINS = 5;
export const LOCK_DURATION_MS = 15 * 60 * 1000;
/** Durée de vie d'une session : hypothèse, 12 heures (PC partagés au secrétariat). */
export const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

export type LoginInput = { schoolCode: string; identifier: string; password: string };

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date; principal: Principal }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "locked"; lockedUntil: Date };

export type SessionInfo = { principal: Principal; userName: string; expiresAt: Date };

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Rôles valides d'un utilisateur dans l'école de session (accès Support expiré = aucun rôle). */
async function activeRoles(
  tx: Tx,
  schoolId: string,
  userId: string,
  now: Date,
): Promise<MembershipRole[]> {
  await setSchoolContext(tx, { schoolId, userId });
  const [m] = await tx
    .select({ roles: memberships.roles, expiresAt: memberships.expiresAt })
    .from(memberships)
    .where(and(eq(memberships.schoolId, schoolId), eq(memberships.userId, userId)));
  if (!m) return [];
  if (m.expiresAt && m.expiresAt <= now) return [];
  return m.roles;
}

/**
 * Connexion par code école + téléphone ou email + mot de passe.
 * Message volontairement identique pour « compte inconnu », « mauvais mot de passe » et
 * « pas membre de cette école » : on ne révèle pas quels comptes existent.
 * Le super-admin se connecte sans code école (session de plateforme).
 */
export async function login(input: LoginInput, now = new Date()): Promise<LoginResult> {
  const identifier = parseIdentifier(input.identifier);
  if (!identifier) {
    await verifyDummyPassword(input.password);
    return { ok: false, reason: "invalid" };
  }

  return withAuth(async (tx) => {
    const column = identifier.kind === "email" ? users.email : users.phone;
    const [user] = await tx.select().from(users).where(eq(column, identifier.value)).for("update");

    if (!user || !user.passwordHash || user.status !== "active") {
      await verifyDummyPassword(input.password);
      return { ok: false, reason: "invalid" } as const;
    }
    if (user.lockedUntil && user.lockedUntil > now) {
      return { ok: false, reason: "locked", lockedUntil: user.lockedUntil } as const;
    }

    if (!(await verifyPassword(user.passwordHash, input.password))) {
      const failures = user.failedLoginCount + 1;
      if (failures >= MAX_FAILED_LOGINS) {
        const lockedUntil = new Date(now.getTime() + LOCK_DURATION_MS);
        await tx
          .update(users)
          .set({ failedLoginCount: 0, lockedUntil })
          .where(eq(users.id, user.id));
        return { ok: false, reason: "locked", lockedUntil } as const;
      }
      await tx.update(users).set({ failedLoginCount: failures }).where(eq(users.id, user.id));
      return { ok: false, reason: "invalid" } as const;
    }

    await tx
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now })
      .where(eq(users.id, user.id));

    let schoolId: string | null = null;
    let roles: MembershipRole[] = [];
    const code = input.schoolCode.trim();
    if (code === "") {
      if (!user.isSuperadmin) return { ok: false, reason: "invalid" } as const;
    } else {
      const found = await tx.execute<{ id: string | null }>(
        sql`select app.school_id_by_code(${code}) as id`,
      );
      schoolId = found.rows[0]?.id ?? null;
      if (!schoolId) return { ok: false, reason: "invalid" } as const;
      roles = await activeRoles(tx, schoolId, user.id, now);
      if (roles.length === 0) return { ok: false, reason: "invalid" } as const;
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
    await tx
      .insert(sessions)
      .values({ tokenHash: hashToken(token), userId: user.id, schoolId, expiresAt });

    return {
      ok: true,
      token,
      expiresAt,
      principal: { userId: user.id, schoolId, roles, isSuperadmin: user.isSuperadmin },
    } as const;
  });
}

/**
 * Vérifie un jeton de session. Les rôles sont relus à chaque fois : un rôle retiré ou un accès
 * Support expiré prend effet immédiatement.
 */
export async function validateSession(
  token: string | undefined,
  now = new Date(),
): Promise<SessionInfo | null> {
  if (!token) return null;
  return withAuth(async (tx) => {
    const [row] = await tx
      .select({
        sessionId: sessions.id,
        schoolId: sessions.schoolId,
        expiresAt: sessions.expiresAt,
        userId: users.id,
        userName: users.name,
        status: users.status,
        isSuperadmin: users.isSuperadmin,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, hashToken(token)));

    if (!row || row.expiresAt <= now || row.status !== "active") {
      if (row) await tx.delete(sessions).where(eq(sessions.id, row.sessionId));
      return null;
    }

    let roles: MembershipRole[] = [];
    if (row.schoolId) {
      roles = await activeRoles(tx, row.schoolId, row.userId, now);
      if (roles.length === 0) {
        await tx.delete(sessions).where(eq(sessions.id, row.sessionId));
        return null;
      }
    } else if (!row.isSuperadmin) {
      return null;
    }

    return {
      principal: {
        userId: row.userId,
        schoolId: row.schoolId,
        roles,
        isSuperadmin: row.isSuperadmin,
      },
      userName: row.userName,
      expiresAt: row.expiresAt,
    };
  });
}

/** Déconnexion : la session est supprimée en base (le cookie seul ne suffit plus). */
export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  await withAuth((tx) => tx.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))));
}
