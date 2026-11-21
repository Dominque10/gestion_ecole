// M1 — création d'école par le super-admin, comptes du personnel, mot de passe provisoire.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { changePassword, login, validateSession } from "@/server/auth/core";
import { ForbiddenError, type MembershipRole, type Principal } from "@/server/auth/permissions";
import { closeDb, withPlatform } from "@/server/db/client";
import { auditLogs } from "@/server/db/schema";
import { SettingsError } from "@/modules/settings/errors";
import { createSchool, listSchools } from "@/modules/settings/schools";
import { addStaff, listStaff, removeStaff, updateStaffRoles } from "@/modules/settings/staff";
import { adminQuery, createSchoolWithDirector, createSuperadmin, resetDatabase } from "./helpers";

const TEMP_PASSWORD = "Provisoire-2026";

let platform: Principal;
const inSchool = (schoolId: string, userId: string, ...roles: MembershipRole[]): Principal => ({
  userId,
  schoolId,
  roles,
  isSuperadmin: false,
});

async function rolesOf(schoolId: string, userId: string): Promise<string | null> {
  const { rows } = await adminQuery<{ roles: string }>(
    "select roles::text as roles from memberships where school_id = $1 and user_id = $2",
    [schoolId, userId],
  );
  return rows[0]?.roles ?? null;
}

async function expectSettingsError(promise: Promise<unknown>, code: SettingsError["code"]) {
  await expect(promise).rejects.toSatisfy(
    (e: unknown) => e instanceof SettingsError && e.code === code,
  );
}

beforeAll(async () => {
  await resetDatabase();
  platform = { userId: await createSuperadmin(), schoolId: null, roles: [], isSuperadmin: true };
});

afterAll(async () => {
  await closeDb();
});

describe("Super-admin : créer une école et son premier directeur", () => {
  it("crée l'école, le compte du directeur (mot de passe provisoire) et le journal", async () => {
    const created = await createSchool(platform, {
      name: "  Collège Saint-Jean Bosco ",
      code: " SJB ",
      matriculePrefix: "sjb",
      directorName: "Marie Mabiala",
      directorIdentifier: "06 111 22 33",
      directorPassword: TEMP_PASSWORD,
    });
    expect(created.existingAccount).toBe(false);

    const { rows } = await adminQuery(
      `select s.name, s.code, s.matricule_prefix, u.phone, u.must_change_password, m.roles::text as roles
       from schools s join memberships m on m.school_id = s.id join users u on u.id = m.user_id
       where s.id = $1`,
      [created.schoolId],
    );
    expect(rows).toEqual([
      {
        name: "Collège Saint-Jean Bosco",
        code: "sjb",
        matricule_prefix: "SJB",
        phone: "+242061112233",
        must_change_password: true,
        roles: "{director}",
      },
    ]);

    const logs = await withPlatform(platform.userId, (tx) => tx.select().from(auditLogs));
    expect(logs).toMatchObject([
      { action: "school.create", entityId: created.schoolId, schoolId: null },
    ]);
  });

  it("le directeur se connecte avec le code école et doit changer son mot de passe", async () => {
    const result = await login({
      schoolCode: "sjb",
      identifier: "061112233",
      password: TEMP_PASSWORD,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((await validateSession(result.token))?.mustChangePassword).toBe(true);

    expect(await changePassword(result.token, "faux", "Nouveau-mot-2026")).toEqual({
      ok: false,
      reason: "wrong-password",
    });
    expect(await changePassword(result.token, TEMP_PASSWORD, "court")).toEqual({
      ok: false,
      reason: "too-short",
    });
    expect(await changePassword(result.token, TEMP_PASSWORD, TEMP_PASSWORD)).toEqual({
      ok: false,
      reason: "same-password",
    });
    expect(await changePassword(result.token, TEMP_PASSWORD, "Nouveau-mot-2026")).toEqual({
      ok: true,
    });
    expect((await validateSession(result.token))?.mustChangePassword).toBe(false);
    const again = await login({
      schoolCode: "sjb",
      identifier: "061112233",
      password: "Nouveau-mot-2026",
    });
    expect(again.ok).toBe(true);
  });

  it("changer son mot de passe ferme les autres sessions, pas celle en cours", async () => {
    const first = await login({
      schoolCode: "sjb",
      identifier: "061112233",
      password: "Nouveau-mot-2026",
    });
    const second = await login({
      schoolCode: "sjb",
      identifier: "061112233",
      password: "Nouveau-mot-2026",
    });
    if (!first.ok || !second.ok) throw new Error("connexion attendue");
    expect(await changePassword(second.token, "Nouveau-mot-2026", "Encore-un-autre-2026")).toEqual({
      ok: true,
    });
    expect(await validateSession(first.token)).toBeNull();
    expect(await validateSession(second.token)).not.toBeNull();
  });

  it("refuse un code école déjà pris (casse ignorée)", async () => {
    await expectSettingsError(
      createSchool(platform, {
        name: "Autre école",
        code: "Sjb",
        matriculePrefix: "AUT",
        directorName: "Jean Okemba",
        directorIdentifier: "06 999 88 77",
        directorPassword: TEMP_PASSWORD,
      }),
      "codeTaken",
    );
    const { rows } = await adminQuery("select 1 from users where phone = '+242069998877'");
    expect(rows).toEqual([]);
  });

  it("refuse les saisies invalides (code, préfixe, téléphone, mot de passe)", async () => {
    const valid = {
      name: "École Test",
      code: "test",
      matriculePrefix: "TST",
      directorName: "Jean Okemba",
      directorIdentifier: "06 999 88 77",
      directorPassword: TEMP_PASSWORD,
    };
    for (const invalid of [
      { code: "é-cole" },
      { code: "x" },
      { matriculePrefix: "S1" },
      { matriculePrefix: "TROPLONG" },
      { directorIdentifier: "12" },
      { directorPassword: "court" },
      { name: " " },
    ]) {
      await expect(createSchool(platform, { ...valid, ...invalid })).rejects.toThrow();
    }
  });

  it("un directeur déjà inscrit dans une autre école garde son compte et son mot de passe", async () => {
    const created = await createSchool(platform, {
      name: "Lycée Bosco 2",
      code: "sjb2",
      matriculePrefix: "SJBD",
      directorName: "Autre nom",
      directorIdentifier: "+242 06 111 22 33",
      directorPassword: "Ignore-ce-mot-2026",
    });
    expect(created.existingAccount).toBe(true);
    const result = await login({
      schoolCode: "sjb2",
      identifier: "061112233",
      password: "Encore-un-autre-2026",
    });
    expect(result.ok).toBe(true);
  });

  it("un compte de la plateforme ne peut pas devenir directeur d'une école", async () => {
    await adminQuery("update users set phone = '+242065554433' where id = $1", [platform.userId]);
    await expectSettingsError(
      createSchool(platform, {
        name: "École Piège",
        code: "piege",
        matriculePrefix: "PIE",
        directorName: "Super Admin",
        directorIdentifier: "065554433",
        directorPassword: TEMP_PASSWORD,
      }),
      "platformAccount",
    );
  });

  it("seul le super-admin, en session de plateforme, crée ou liste les écoles", async () => {
    const schools = await listSchools(platform);
    expect(schools.map((s) => s.code)).toEqual(["sjb", "sjb2"]);
    const director = inSchool(schools[0].id, "00000000-0000-4000-8000-000000000000", "director");
    await expect(listSchools(director)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createSchool({ ...platform, schoolId: schools[0].id }, {} as never),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("Directeur : comptes du personnel", () => {
  let a: { schoolId: string; directorId: string };
  let b: { schoolId: string; directorId: string };
  let director: Principal;
  let teacherId: string;

  beforeAll(async () => {
    a = await createSchoolWithDirector(platform.userId, "staffa");
    b = await createSchoolWithDirector(platform.userId, "staffb");
    director = inSchool(a.schoolId, a.directorId, "director");
  });

  it("ajoute un enseignant avec un mot de passe provisoire, tracé dans le journal", async () => {
    const added = await addStaff(director, {
      name: "Paul Nkounkou",
      identifier: "05 444 55 66",
      password: TEMP_PASSWORD,
      roles: ["teacher"],
    });
    teacherId = added.userId;
    expect(added.existingAccount).toBe(false);
    expect(await rolesOf(a.schoolId, teacherId)).toBe("{teacher}");

    const staff = await listStaff(director);
    expect(staff.map((s) => [s.name, s.roles, s.pendingPassword])).toEqual([
      ["Directeur staffa", ["director"], false],
      ["Paul Nkounkou", ["teacher"], true],
    ]);
    const { rows } = await adminQuery<{ action: string; actor_user_id: string }>(
      "select action, actor_user_id from audit_logs where school_id = $1 and entity_id = $2",
      [a.schoolId, teacherId],
    );
    expect(rows).toEqual([{ action: "staff.add", actor_user_id: a.directorId }]);

    const result = await login({
      schoolCode: "staffa",
      identifier: "054445566",
      password: TEMP_PASSWORD,
    });
    expect(result.ok && result.principal.roles).toEqual(["teacher"]);
  });

  it("refuse d'ajouter deux fois la même personne", async () => {
    await expectSettingsError(
      addStaff(director, {
        name: "Paul Nkounkou",
        identifier: "+242054445566",
        password: TEMP_PASSWORD,
        roles: ["accountant"],
      }),
      "alreadyMember",
    );
  });

  it("modifie les rôles (cumul possible), avec avant/après dans le journal", async () => {
    await updateStaffRoles(director, teacherId, ["accountant", "teacher"]);
    expect(await rolesOf(a.schoolId, teacherId)).toBe("{accountant,teacher}");
    const { rows } = await adminQuery<{ before: unknown; after: unknown }>(
      "select before, after from audit_logs where school_id = $1 and action = 'staff.roles'",
      [a.schoolId],
    );
    expect(rows).toEqual([
      { before: { roles: ["teacher"] }, after: { roles: ["accountant", "teacher"] } },
    ]);
  });

  it("refuse les rôles parent, support ou inconnus, et une liste vide", async () => {
    for (const roles of [["parent"], ["support"], ["admin"], []]) {
      await expect(updateStaffRoles(director, teacherId, roles)).rejects.toThrow();
    }
    expect(await rolesOf(a.schoolId, teacherId)).toBe("{accountant,teacher}");
  });

  it("garde toujours au moins un directeur", async () => {
    await expectSettingsError(
      updateStaffRoles(director, a.directorId, ["teacher"]),
      "lastDirector",
    );
    await updateStaffRoles(director, teacherId, ["director"]);
    await updateStaffRoles(director, a.directorId, ["teacher"]);
    expect(await rolesOf(a.schoolId, a.directorId)).toBe("{teacher}");
    await updateStaffRoles(inSchool(a.schoolId, teacherId, "director"), a.directorId, ["director"]);
    await updateStaffRoles(director, teacherId, ["teacher"]);
  });

  it("retire une personne : ses sessions dans l'école tombent, son compte reste", async () => {
    const session = await login({
      schoolCode: "staffa",
      identifier: "054445566",
      password: TEMP_PASSWORD,
    });
    if (!session.ok) throw new Error("connexion attendue");
    await expectSettingsError(removeStaff(director, a.directorId), "cannotRemoveSelf");
    await removeStaff(director, teacherId);
    expect(await rolesOf(a.schoolId, teacherId)).toBeNull();
    expect(await validateSession(session.token)).toBeNull();
    const { rows } = await adminQuery("select 1 from users where id = $1", [teacherId]);
    expect(rows).toHaveLength(1);
    await expectSettingsError(removeStaff(director, teacherId), "notMember");
  });

  it("un directeur n'agit jamais sur le personnel d'une autre école", async () => {
    await expectSettingsError(updateStaffRoles(director, b.directorId, ["teacher"]), "notMember");
    await expectSettingsError(removeStaff(director, b.directorId), "notMember");
    expect(await rolesOf(b.schoolId, b.directorId)).toBe("{director}");
    const names = (await listStaff(director)).map((s) => s.name);
    expect(names).not.toContain("Directeur staffb");
  });

  it("une personne déjà inscrite ailleurs est ajoutée sans changer son mot de passe", async () => {
    const added = await addStaff(inSchool(b.schoolId, b.directorId, "director"), {
      name: "Nom ignoré",
      identifier: "054445566",
      password: "Autre-provisoire-2026",
      roles: ["secretary"],
    });
    expect(added).toEqual({ userId: teacherId, existingAccount: true });
    const result = await login({
      schoolCode: "staffb",
      identifier: "054445566",
      password: TEMP_PASSWORD,
    });
    expect(result.ok && result.principal.roles).toEqual(["secretary"]);
  });

  it("seul le directeur gère le personnel (ni secrétaire, ni Support)", async () => {
    for (const role of ["secretary", "accountant", "teacher", "parent", "support"] as const) {
      const p = inSchool(a.schoolId, a.directorId, role);
      await expect(listStaff(p)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(removeStaff(p, teacherId)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("refuse un identifiant de compte invalide sans erreur de base", async () => {
    await expectSettingsError(removeStaff(director, "pas-un-uuid"), "notMember");
  });
});
