// Phase 4, sous-étape 4a — connexion des parents par code SMS, enfants toutes écoles confondues (A2),
// isolation : un parent ne voit que ses enfants.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/server/auth/permissions";
import { validateSession } from "@/server/auth/core";
import {
  listChildren,
  requestParentCode,
  selectChild,
  verifyParentCode,
} from "@/server/auth/parent";
import { closeDb, withSchool } from "@/server/db/client";
import { attendance, grades, guardians, invoices, reportCards, students } from "@/server/db/schema";
import { FakeSmsProvider } from "@/server/sms";
import { addDefaultLevels, listLevels } from "@/modules/settings/levels";
import { addStaff } from "@/modules/settings/staff";
import { createYear, activateYear } from "@/modules/settings/years";
import { preEnroll } from "@/modules/students/enrollments";
import { createStudent } from "@/modules/students/students";
import { adminQuery, createSchoolWithDirector, createSuperadmin, resetDatabase } from "./helpers";

type School = { schoolId: string; directorId: string };
let a: School;
let b: School;
const director = (s: School): Principal => ({
  userId: s.directorId,
  schoolId: s.schoolId,
  roles: ["director"],
  isSuperadmin: false,
});

const PARENT = "06 600 70 01";
const PARENT_E164 = "+242066007001";
const OTHER = "06 600 70 02";
const TEACHER_PARENT = "05 600 70 03";
const kids: Record<string, string> = {}; // nom → inscription

async function enrol(school: School, lastName: string, phone: string) {
  await addDefaultLevels(director(school), "college").catch(() => undefined);
  const level = (await listLevels(director(school)))[0].id;
  let year = (
    await adminQuery<{ id: string }>("select id from academic_years where school_id = $1", [
      school.schoolId,
    ])
  ).rows[0]?.id;
  if (!year) {
    year = await createYear(director(school), {
      label: "2026-2027",
      startDate: "2026-10-01",
      endDate: "2027-06-30",
      periodKind: "trimester",
    });
    await activateYear(director(school), year);
  }
  const s = await createStudent(director(school), {
    student: {
      lastName,
      firstNames: "Test",
      sex: "F",
      birthDate: "",
      birthPlace: "",
      nationality: "",
      previousSchool: "",
    },
    guardian: { fullName: `Parent de ${lastName}`, phone, otherPhone: "", relationship: "Mère" },
  });
  kids[lastName] = await preEnroll(director(school), {
    studentId: s.id,
    academicYearId: year,
    levelId: level,
  });
}

/** Dernier code reçu par SMS pour un numéro. */
const lastCode = (sms: FakeSmsProvider) => sms.sent.at(-1)!.body.match(/\d{6}/)![0];

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  // Noms choisis pour l'ordre alphabétique des écoles : « École parenta » avant « École parentb ».
  a = await createSchoolWithDirector(superadminId, "parenta");
  b = await createSchoolWithDirector(superadminId, "parentb");
  await enrol(a, "ADA", PARENT);
  await enrol(a, "BOB", OTHER);
  await enrol(b, "CHLOE", PARENT);
  // Un enseignant de l'école A, qui est aussi parent d'un élève de A.
  await addStaff(director(a), {
    name: "Prof parent",
    identifier: TEACHER_PARENT,
    password: "Provisoire-2026",
    roles: ["teacher"],
  });
  await enrol(a, "DAVE", TEACHER_PARENT);
});

afterAll(async () => {
  await closeDb();
});

describe("Code de connexion par SMS", () => {
  it("même réponse pour un numéro inconnu ; seul un responsable reçoit un code, une fois par minute", async () => {
    const sms = new FakeSmsProvider();
    expect(await requestParentCode("06 999 99 99", sms)).toEqual({ ok: true });
    expect(sms.sent).toHaveLength(0);
    expect(await requestParentCode("pas un numéro", sms)).toEqual({ ok: false, reason: "phone" });
    const t0 = new Date("2026-11-23T08:00:00Z");
    expect(await requestParentCode(PARENT, sms, t0)).toEqual({ ok: true });
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0]).toMatchObject({ to: PARENT_E164 });
    expect(sms.sent[0].body).toMatch(/\d{6}/);
    await requestParentCode(PARENT, sms, new Date(t0.getTime() + 30_000));
    expect(sms.sent).toHaveLength(1);
    await requestParentCode(PARENT, sms, new Date(t0.getTime() + 61_000));
    expect(sms.sent).toHaveLength(2);
    // Le code n'est jamais gardé en clair.
    const { rows } = await adminQuery<{ otp_hash: string }>(
      "select otp_hash from users where phone = $1",
      [PARENT_E164],
    );
    expect(rows[0].otp_hash).not.toContain(lastCode(sms));
  });

  it("5 codes faux : blocage 15 minutes", async () => {
    const sms = new FakeSmsProvider();
    const t0 = new Date("2026-11-23T09:00:00Z");
    await requestParentCode(OTHER, sms, t0);
    const good = lastCode(sms);
    const wrong = good === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) {
      expect(await verifyParentCode(OTHER, wrong, t0)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(await verifyParentCode(OTHER, wrong, t0)).toMatchObject({ ok: false, reason: "locked" });
    // Même le bon code est refusé pendant le blocage (et il a été effacé).
    expect((await verifyParentCode(OTHER, good, t0)).ok).toBe(false);
  });

  it("code juste : compte relié aux fiches de responsable des deux écoles, session sur l'école du premier enfant", async () => {
    const sms = new FakeSmsProvider();
    const t0 = new Date("2026-11-23T10:00:00Z");
    await requestParentCode(PARENT, sms, t0);
    const result = await verifyParentCode(PARENT, lastCode(sms), t0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.principal).toMatchObject({ schoolId: a.schoolId, roles: ["parent"] });
    expect(result.expiresAt.getTime() - t0.getTime()).toBe(30 * 24 * 3600 * 1000);
    // Un code ne sert qu'une fois.
    expect((await verifyParentCode(PARENT, lastCode(sms), t0)).ok).toBe(false);

    const children = await listChildren(result.principal);
    expect(children.map((c) => [c.schoolName, c.lastName])).toEqual([
      ["École parenta", "ADA"],
      ["École parentb", "CHLOE"],
    ]);
    const { rows } = await adminQuery<{ school_id: string; roles: string[] }>(
      "select m.school_id, m.roles::text[] as roles from memberships m join users u on u.id = m.user_id where u.phone = $1 order by m.school_id = $2 desc",
      [PARENT_E164, a.schoolId],
    );
    expect(rows.map((r) => r.roles)).toEqual([["parent"], ["parent"]]);

    // Choisir l'enfant de l'autre école bascule la session ; un enfant d'un autre parent : refusé.
    expect(await selectChild(result.token, result.principal, kids.BOB)).toBeNull();
    const chloe = await selectChild(result.token, result.principal, kids.CHLOE);
    expect(chloe?.schoolId).toBe(b.schoolId);
    expect((await validateSession(result.token, t0))?.principal).toMatchObject({
      schoolId: b.schoolId,
      roles: ["parent"],
    });
  });

  it("un enseignant qui est aussi parent garde son rôle d'enseignant et gagne le rôle parent", async () => {
    const sms = new FakeSmsProvider();
    const t0 = new Date("2026-11-23T11:00:00Z");
    await requestParentCode(TEACHER_PARENT, sms, t0);
    const result = await verifyParentCode(TEACHER_PARENT, lastCode(sms), t0);
    expect(result.ok).toBe(true);
    const { rows } = await adminQuery<{ roles: string[] }>(
      "select m.roles::text[] as roles from memberships m join users u on u.id = m.user_id where u.phone = '+242056007003'",
    );
    expect(rows[0].roles.sort()).toEqual(["parent", "teacher"]);
  });
});

describe("Isolation : un parent ne voit que ses enfants", () => {
  async function parentId() {
    const { rows } = await adminQuery<{ id: string }>("select id from users where phone = $1", [
      PARENT_E164,
    ]);
    return rows[0].id;
  }

  it("dans l'école A : sa fille seulement, ses échéances, aucune note isolée ni bulletin non publié", async () => {
    const ctx = { schoolId: a.schoolId, userId: await parentId() };
    const seen = await withSchool(ctx, async (tx) => ({
      students: (await tx.select({ name: students.lastName }).from(students)).map((s) => s.name),
      guardians: (await tx.select().from(guardians)).length,
      invoices: await tx.select({ e: invoices.enrollmentId }).from(invoices),
      grades: (await tx.select().from(grades)).length,
      reportCards: (await tx.select().from(reportCards)).length,
    }));
    expect(seen.students).toEqual(["ADA"]);
    expect(seen.guardians).toBe(1);
    expect(seen.invoices.every((i) => i.e === kids.ADA)).toBe(true);
    expect(seen.grades).toBe(0);
    expect(seen.reportCards).toBe(0);
  });

  it("aucune écriture, même en contournant l'application", async () => {
    const ctx = { schoolId: a.schoolId, userId: await parentId() };
    await expect(
      withSchool(ctx, (tx) => tx.update(students).set({ lastName: "PIRATE" })),
    ).resolves.toBeDefined(); // aucune ligne modifiable : 0 ligne touchée
    const { rows } = await adminQuery("select 1 from students where last_name = 'PIRATE'");
    expect(rows).toHaveLength(0);
    await expect(
      withSchool(ctx, (tx) =>
        tx.insert(attendance).values({
          schoolId: a.schoolId,
          academicYearId: crypto.randomUUID(),
          enrollmentId: kids.ADA,
          date: "2026-11-20",
          timeSlotId: crypto.randomUUID(),
          status: "present",
          recordedBy: ctx.userId,
        }),
      ),
    ).rejects.toThrow();
  });

  it("dans une école où il n'a pas d'enfant : rien", async () => {
    const director = (
      await adminQuery<{ id: string }>("select id from schools where code = 'parentb'")
    ).rows[0];
    void director;
    const { rows } = await adminQuery<{ n: number }>(
      "select count(*)::int as n from memberships m join users u on u.id = m.user_id where u.phone = $1",
      [PARENT_E164],
    );
    expect(rows[0].n).toBe(2); // écoles A et B seulement
  });

  it("chaque table d'école a une règle « parent » (lecture et écriture)", async () => {
    const { rows } = await adminQuery<{ table_name: string }>(
      `select c.table_name from information_schema.columns c
       join information_schema.tables t using (table_schema, table_name)
       where c.table_schema = 'public' and c.column_name = 'school_id' and t.table_type = 'BASE TABLE'
         and c.table_name <> 'sessions'
         and not exists (select 1 from pg_policies p where p.tablename = c.table_name
                         and p.policyname = c.table_name || '_parent_read')`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([]);
  });

  it("la règle « parent » est calculée une fois par requête, pas à chaque ligne (performance)", async () => {
    // Forme attendue : (SELECT app.current_user_is_parent_only()), migration 0042.
    const { rows } = await adminQuery<{ policyname: string }>(
      `select policyname from pg_policies
       where schemaname = 'public'
         and regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
               '\\( SELECT app\\.current_user_is_parent_only\\(\\) AS current_user_is_parent_only\\)', '', 'g')
             like '%current_user_is_parent_only%'`,
    );
    expect(rows.map((r) => r.policyname)).toEqual([]);
  });
});
