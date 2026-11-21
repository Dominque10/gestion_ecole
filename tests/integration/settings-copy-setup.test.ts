// M1 — copie de structure d'une année à l'autre, et état de l'assistant de démarrage.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type MembershipRole, type Principal } from "@/server/auth/permissions";
import { closeDb } from "@/server/db/client";
import { assignTeachers, createClass, getClass, listClasses } from "@/modules/settings/classes";
import { getGrid, saveGrid } from "@/modules/settings/coefficients";
import { SettingsError } from "@/modules/settings/errors";
import { listFees, saveFee } from "@/modules/settings/fees";
import { addDefaultLevels, createSubject, listLevels } from "@/modules/settings/levels";
import { updateSchoolProfile } from "@/modules/settings/school-profile";
import { getSetupStatus } from "@/modules/settings/setup-status";
import { addStaff, updateStaffRoles } from "@/modules/settings/staff";
import { copyStructure } from "@/modules/settings/structure-copy";
import { createTimeSlot } from "@/modules/settings/time-slots";
import { activateYear, createYear } from "@/modules/settings/years";
import { adminQuery, createSchoolWithDirector, createSuperadmin, resetDatabase } from "./helpers";

type School = { schoolId: string; directorId: string };
let a: School;
let b: School;
const as = (school: School, ...roles: MembershipRole[]): Principal => ({
  userId: school.directorId,
  schoolId: school.schoolId,
  roles,
  isSuperadmin: false,
});
const director = () => as(a, "director");

async function expectSettingsError(promise: Promise<unknown>, code: SettingsError["code"]) {
  await expect(promise).rejects.toSatisfy(
    (e: unknown) => e instanceof SettingsError && e.code === code,
  );
}

const year = (label: string, start: number) => ({
  label,
  startDate: `${start}-10-01`,
  endDate: `${start + 1}-06-30`,
  periodKind: "trimester" as const,
});

let y1: string;
let y2: string;
let sixieme: string;
let maths: string;
let stayingTeacher: string;
let leavingTeacher: string;

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  a = await createSchoolWithDirector(superadminId, "copiea");
  b = await createSchoolWithDirector(superadminId, "copieb");
});

afterAll(async () => {
  await closeDb();
});

describe("Assistant de démarrage", () => {
  it("une école neuve : rien n'est fait, on commence par la fiche", async () => {
    const status = await getSetupStatus(director());
    expect(status.next).toBe("profile");
    expect(status.steps.every((s) => !s.done)).toBe(true);
  });

  it("chaque étape passe à « fait » au fil du paramétrage, dans l'ordre", async () => {
    await updateSchoolProfile(director(), { name: "École A", address: "Brazzaville", phone: "" });
    expect((await getSetupStatus(director())).next).toBe("year");

    y1 = await createYear(director(), year("2026-2027", 2026));
    await addDefaultLevels(director(), "college");
    sixieme = (await listLevels(director())).find((l) => l.name === "6e")!.id;
    maths = await createSubject(director(), "Mathématiques");
    expect((await getSetupStatus(director())).next).toBe("coefficients");

    await saveGrid(director(), { academicYearId: y1, levelId: sixieme, series: "" }, [
      { subjectId: maths, coefficient: 4, optional: true },
    ]);
    stayingTeacher = (
      await addStaff(director(), {
        name: "Reste",
        identifier: "05 222 33 01",
        password: "Provisoire-2026",
        roles: ["teacher"],
      })
    ).userId;
    leavingTeacher = (
      await addStaff(director(), {
        name: "Part",
        identifier: "05 222 33 02",
        password: "Provisoire-2026",
        roles: ["teacher"],
      })
    ).userId;
    const sixA = await createClass(director(), y1, {
      levelId: sixieme,
      series: "",
      name: "6e A",
      capacity: "50",
      headTeacherId: leavingTeacher,
    });
    await createClass(director(), y1, {
      levelId: sixieme,
      series: "",
      name: "6e B",
      capacity: "",
      headTeacherId: stayingTeacher,
    });
    await assignTeachers(director(), sixA, [{ subjectId: maths, teacherId: stayingTeacher }]);
    await createTimeSlot(director(), { label: "Matin", startTime: "07:30", endTime: "12:00" });
    await saveFee(director(), y1, {
      name: "Scolarité",
      kind: "tuition",
      mandatory: true,
      levelIds: [sixieme],
      installments: [
        { number: 1, amount: 60_000, dueDate: "2026-10-01" },
        { number: 2, amount: 60_000, dueDate: "2027-01-04" },
      ],
    });
    const status = await getSetupStatus(director());
    expect(status.next).toBeNull();
    expect(status.steps.every((s) => s.done)).toBe(true);
  });

  it("le Support peut voir l'état ; les autres rôles non", async () => {
    await expect(getSetupStatus(as(a, "support"))).resolves.toMatchObject({ next: null });
    await expect(getSetupStatus(as(a, "teacher"))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("Copie de structure", () => {
  it("copie classes, grille et frais dans l'année suivante, échéances décalées d'un an", async () => {
    await activateYear(director(), y1);
    y2 = await createYear(director(), year("2027-2028", 2027));
    await updateStaffRoles(director(), leavingTeacher, ["secretary"]);

    expect(await copyStructure(director(), y1, y2)).toEqual({
      classes: 2,
      gridRows: 1,
      feeRows: 2,
    });

    expect(await getGrid(director(), { academicYearId: y2, levelId: sixieme, series: "" })).toEqual(
      [{ subjectId: maths, coefficient: 4, optional: true }],
    );
    const copied = await listClasses(director(), y2);
    expect(copied.map((c) => [c.name, c.capacity, c.subjectCount])).toEqual([
      ["6e A", 50, 1],
      ["6e B", null, 1],
    ]);
    // Le professeur principal parti n'est pas repris ; l'enseignant resté l'est.
    expect(copied.find((c) => c.name === "6e A")?.headTeacherId).toBeNull();
    expect(copied.find((c) => c.name === "6e B")?.headTeacherId).toBe(stayingTeacher);
    const sixA = await getClass(director(), copied.find((c) => c.name === "6e A")!.id);
    expect(sixA.subjects).toEqual([
      { subjectId: maths, subjectName: "Mathématiques", coefficient: 4, teacherId: stayingTeacher },
    ]);

    const fees = await listFees(director(), y2);
    expect(fees).toHaveLength(1);
    expect(fees[0].installments.map((p) => [p.amount, p.dueDate])).toEqual([
      [60_000, "2027-10-01"],
      [60_000, "2028-01-04"],
    ]);

    // L'année source n'a pas bougé.
    expect(await listClasses(director(), y1)).toHaveLength(2);
    const { rows } = await adminQuery<{ after: { classes: number } }>(
      "select after from audit_logs where school_id = $1 and action = 'year.copy_structure'",
      [a.schoolId],
    );
    expect(rows[0].after.classes).toBe(2);
  });

  it("refuse une année cible déjà remplie, active ou identique", async () => {
    await expectSettingsError(copyStructure(director(), y1, y2), "copyTargetNotEmpty");
    await expectSettingsError(copyStructure(director(), y2, y1), "yearNotUpcoming");
    await expectSettingsError(copyStructure(director(), y2, y2), "copySameYear");
  });

  it("depuis une année archivée, la copie fonctionne (lecture seule de la source)", async () => {
    await activateYear(director(), y2);
    const y3 = await createYear(director(), year("2028-2029", 2028));
    const result = await copyStructure(director(), y1, y3);
    expect(result.classes).toBe(2);
    const fees = await listFees(director(), y3);
    expect(fees[0].installments[0].dueDate).toBe("2028-10-01");
  });

  it("seul le directeur copie ; une école ne copie pas les années d'une autre", async () => {
    const target = await createYear(as(b, "director"), year("2027-2028", 2027));
    for (const role of ["secretary", "accountant", "teacher", "support"] as const) {
      await expect(copyStructure(as(a, role), y1, target)).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expectSettingsError(copyStructure(as(b, "director"), y1, target), "yearNotFound");
    expect(await listClasses(as(b, "director"), target)).toEqual([]);
  });
});
