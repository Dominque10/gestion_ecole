import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  hashToken,
  LOCK_DURATION_MS,
  login,
  logout,
  MAX_FAILED_LOGINS,
  SESSION_DURATION_MS,
  validateSession,
} from "@/server/auth/core";
import { hashPassword } from "@/server/auth/password";
import type { Principal } from "@/server/auth/permissions";
import { ForbiddenError } from "@/server/auth/permissions";
import {
  grantSupportAccess,
  recordSupportRead,
  revokeSupportAccess,
  SupportGrantError,
} from "@/server/auth/support";
import { closeDb, withSchool } from "@/server/db/client";
import { auditLogs } from "@/server/db/schema";
import { adminQuery, createSchoolWithDirector, createSuperadmin, resetDatabase } from "./helpers";

const PASSWORD = "Bonjour-Brazza-2026";

let superadminId: string;
let a: { schoolId: string; directorId: string };
let b: { schoolId: string; directorId: string };
let directorPhone: string;

async function setCredentials(userId: string, fields: { email?: string; password?: string }) {
  if (fields.email)
    await adminQuery("update users set email = $2 where id = $1", [userId, fields.email]);
  if (fields.password) {
    await adminQuery("update users set password_hash = $2 where id = $1", [
      userId,
      await hashPassword(fields.password),
    ]);
  }
}

async function unlock(userId: string) {
  await adminQuery("update users set failed_login_count = 0, locked_until = null where id = $1", [
    userId,
  ]);
}

beforeAll(async () => {
  await resetDatabase();
  superadminId = await createSuperadmin();
  await setCredentials(superadminId, { email: "support@plateforme.cg", password: PASSWORD });
  a = await createSchoolWithDirector(superadminId, "sjb");
  b = await createSchoolWithDirector(superadminId, "autre");
  await setCredentials(a.directorId, { password: PASSWORD });
  const { rows } = await adminQuery<{ phone: string }>("select phone from users where id = $1", [
    a.directorId,
  ]);
  directorPhone = rows[0].phone;
});

afterAll(async () => {
  await closeDb();
});

describe("Connexion", () => {
  beforeEach(async () => {
    await unlock(a.directorId);
  });

  it("réussit avec code école + téléphone (format local accepté) + mot de passe", async () => {
    const local = directorPhone.slice(4); // +242061234567 → 061234567
    const result = await login({ schoolCode: "SJB", identifier: local, password: PASSWORD });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.principal).toEqual({
      userId: a.directorId,
      schoolId: a.schoolId,
      roles: ["director"],
      isSuperadmin: false,
    });
  });

  it("ne stocke que l'empreinte du jeton, jamais le jeton lui-même", async () => {
    const result = await login({
      schoolCode: "sjb",
      identifier: directorPhone,
      password: PASSWORD,
    });
    if (!result.ok) throw new Error("connexion attendue");
    const { rows } = await adminQuery<{ token_hash: string }>(
      "select token_hash from sessions where token_hash = $1",
      [hashToken(result.token)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(result.token);
  });

  it("donne la même réponse pour un mauvais mot de passe, un compte inconnu ou une autre école", async () => {
    const wrongPassword = await login({
      schoolCode: "sjb",
      identifier: directorPhone,
      password: "x",
    });
    const unknown = await login({ schoolCode: "sjb", identifier: "069999999", password: PASSWORD });
    const otherSchool = await login({
      schoolCode: "autre",
      identifier: directorPhone,
      password: PASSWORD,
    });
    const badCode = await login({
      schoolCode: "nexiste",
      identifier: directorPhone,
      password: PASSWORD,
    });
    for (const r of [wrongPassword, unknown, otherSchool, badCode]) {
      expect(r).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("exige un code école pour un compte qui n'est pas super-admin", async () => {
    const r = await login({ schoolCode: "", identifier: directorPhone, password: PASSWORD });
    expect(r).toEqual({ ok: false, reason: "invalid" });
  });

  it(`verrouille le compte après ${MAX_FAILED_LOGINS} échecs, même avec le bon mot de passe ensuite`, async () => {
    const now = new Date("2026-11-21T08:00:00Z");
    for (let i = 1; i < MAX_FAILED_LOGINS; i++) {
      expect(
        await login({ schoolCode: "sjb", identifier: directorPhone, password: "faux" }, now),
      ).toEqual({ ok: false, reason: "invalid" });
    }
    const fifth = await login(
      { schoolCode: "sjb", identifier: directorPhone, password: "faux" },
      now,
    );
    expect(fifth).toEqual({
      ok: false,
      reason: "locked",
      lockedUntil: new Date(now.getTime() + LOCK_DURATION_MS),
    });
    const stillLocked = await login(
      { schoolCode: "sjb", identifier: directorPhone, password: PASSWORD },
      new Date(now.getTime() + LOCK_DURATION_MS - 1000),
    );
    expect(stillLocked.ok).toBe(false);

    const afterLock = await login(
      { schoolCode: "sjb", identifier: directorPhone, password: PASSWORD },
      new Date(now.getTime() + LOCK_DURATION_MS + 1000),
    );
    expect(afterLock.ok).toBe(true);
  });

  it("une connexion réussie remet le compteur d'échecs à zéro", async () => {
    await login({ schoolCode: "sjb", identifier: directorPhone, password: "faux" });
    await login({ schoolCode: "sjb", identifier: directorPhone, password: PASSWORD });
    const { rows } = await adminQuery<{ failed_login_count: number }>(
      "select failed_login_count from users where id = $1",
      [a.directorId],
    );
    expect(rows[0].failed_login_count).toBe(0);
  });

  it("refuse un compte désactivé", async () => {
    await adminQuery("update users set status = 'disabled' where id = $1", [a.directorId]);
    try {
      const r = await login({ schoolCode: "sjb", identifier: directorPhone, password: PASSWORD });
      expect(r).toEqual({ ok: false, reason: "invalid" });
    } finally {
      await adminQuery("update users set status = 'active' where id = $1", [a.directorId]);
    }
  });

  it("le super-admin se connecte sans code école, en session de plateforme", async () => {
    const r = await login({
      schoolCode: "",
      identifier: "Support@Plateforme.cg",
      password: PASSWORD,
    });
    expect(r.ok && r.principal).toEqual({
      userId: superadminId,
      schoolId: null,
      roles: [],
      isSuperadmin: true,
    });
  });
});

describe("Sessions", () => {
  it("une session valide redonne l'utilisateur, l'école et les rôles", async () => {
    const now = new Date();
    const r = await login(
      { schoolCode: "sjb", identifier: directorPhone, password: PASSWORD },
      now,
    );
    if (!r.ok) throw new Error("connexion attendue");
    const session = await validateSession(r.token, now);
    expect(session?.principal).toEqual(r.principal);
    expect(session?.expiresAt).toEqual(new Date(now.getTime() + SESSION_DURATION_MS));
  });

  it("une session expirée est refusée et supprimée", async () => {
    const now = new Date();
    const r = await login(
      { schoolCode: "sjb", identifier: directorPhone, password: PASSWORD },
      now,
    );
    if (!r.ok) throw new Error("connexion attendue");
    expect(
      await validateSession(r.token, new Date(now.getTime() + SESSION_DURATION_MS + 1)),
    ).toBeNull();
    const { rowCount } = await adminQuery("select 1 from sessions where token_hash = $1", [
      hashToken(r.token),
    ]);
    expect(rowCount).toBe(0);
  });

  it("un jeton inconnu ou absent est refusé", async () => {
    expect(await validateSession("jeton-invente")).toBeNull();
    expect(await validateSession(undefined)).toBeNull();
  });

  it("après déconnexion, le jeton ne fonctionne plus", async () => {
    const r = await login({ schoolCode: "sjb", identifier: directorPhone, password: PASSWORD });
    if (!r.ok) throw new Error("connexion attendue");
    await logout(r.token);
    expect(await validateSession(r.token)).toBeNull();
  });

  it("un rôle retiré prend effet immédiatement sur les sessions ouvertes", async () => {
    const r = await login({ schoolCode: "sjb", identifier: directorPhone, password: PASSWORD });
    if (!r.ok) throw new Error("connexion attendue");
    await adminQuery("update memberships set roles = '{teacher}' where user_id = $1", [
      a.directorId,
    ]);
    try {
      expect((await validateSession(r.token))?.principal.roles).toEqual(["teacher"]);
    } finally {
      await adminQuery("update memberships set roles = '{director}' where user_id = $1", [
        a.directorId,
      ]);
    }
  });
});

describe("Accès Support (décision A7)", () => {
  const director = (): Principal => ({
    userId: a.directorId,
    schoolId: a.schoolId,
    roles: ["director"],
    isSuperadmin: false,
  });

  it("sans autorisation du directeur, le super-admin ne peut pas entrer dans l'école", async () => {
    const r = await login({
      schoolCode: "sjb",
      identifier: "support@plateforme.cg",
      password: PASSWORD,
    });
    expect(r).toEqual({ ok: false, reason: "invalid" });
  });

  it("après autorisation : lecture seule, pour la durée accordée, et tracée", async () => {
    const now = new Date();
    const expiresAt = await grantSupportAccess(director(), superadminId, 24, now);
    expect(expiresAt).toEqual(new Date(now.getTime() + 24 * 3600 * 1000));

    const r = await login(
      { schoolCode: "sjb", identifier: "support@plateforme.cg", password: PASSWORD },
      now,
    );
    if (!r.ok) throw new Error("connexion Support attendue");
    expect(r.principal.roles).toEqual(["support"]);

    await recordSupportRead(r.principal, "students");
    const logs = await withSchool({ schoolId: a.schoolId, userId: a.directorId }, (tx) =>
      tx
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(eq(auditLogs.schoolId, a.schoolId)),
    );
    expect(logs.map((l) => l.action)).toEqual(
      expect.arrayContaining(["support.grant", "support.read"]),
    );

    // Expiré : la session ouverte tombe d'elle-même.
    expect(await validateSession(r.token, new Date(expiresAt.getTime() + 1000))).toBeNull();
  });

  it("le directeur peut mettre fin à l'accès immédiatement", async () => {
    await grantSupportAccess(director(), superadminId);
    const r = await login({
      schoolCode: "sjb",
      identifier: "support@plateforme.cg",
      password: PASSWORD,
    });
    if (!r.ok) throw new Error("connexion Support attendue");
    await revokeSupportAccess(director(), superadminId);
    expect(await validateSession(r.token)).toBeNull();
  });

  it("seul un directeur accorde l'accès, et seulement à un compte super-admin", async () => {
    await expect(
      grantSupportAccess({ ...director(), roles: ["secretary"] }, superadminId),
    ).rejects.toThrow(ForbiddenError);
    await expect(grantSupportAccess(director(), b.directorId)).rejects.toThrow(SupportGrantError);
  });

  it("un directeur ne peut pas accorder l'accès à une autre école que la sienne", async () => {
    await grantSupportAccess(director(), superadminId);
    const r = await login({
      schoolCode: "autre",
      identifier: "support@plateforme.cg",
      password: PASSWORD,
    });
    expect(r).toEqual({ ok: false, reason: "invalid" });
  });
});
