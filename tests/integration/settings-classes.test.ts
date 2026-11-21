// M1 — classes d'une année, matières reprises de la grille, affectation des enseignants.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type MembershipRole, type Principal } from "@/server/auth/permissions";
import { closeDb } from "@/server/db/client";
import { SettingsError } from "@/modules/settings/errors";
import {
  assignTeachers,
  createClass,
  deleteClass,
  getClass,
  listClasses,
  listTeachers,
  updateClass,
} from "@/modules/settings/classes";
import { addDefaultGrid, saveGrid } from "@/modules/settings/coefficients";
import { addDefaultLevels, listLevels, listSubjects } from "@/modules/settings/levels";
import { addStaff, updateStaffRoles } from "@/modules/settings/staff";
import { activateYear, createYear } from "@/modules/settings/years";
import { createSchoolWithDirector, createSuperadmin, resetDatabase } from "./helpers";

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

let yearId: string;
let premiere: string;
let sixieme: string;
let teacherId: string;
let accountantId: string;
let classId: string;
const subjectId = async (name: string) =>
  (await listSubjects(director())).find((s) => s.name === name)!.id;
const base = { capacity: "", headTeacherId: "" };

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  a = await createSchoolWithDirector(superadminId, "classea");
  b = await createSchoolWithDirector(superadminId, "classeb");
  await addDefaultLevels(director(), "college");
  await addDefaultLevels(director(), "lycee");
  const levels = await listLevels(director());
  premiere = levels.find((l) => l.name === "1re")!.id;
  sixieme = levels.find((l) => l.name === "6e")!.id;
  yearId = await createYear(director(), {
    label: "2026-2027",
    startDate: "2026-10-01",
    endDate: "2027-06-30",
    periodKind: "trimester",
  });
  const key = { academicYearId: yearId, levelId: premiere, series: "C" };
  await addDefaultGrid(director(), key);
  teacherId = (
    await addStaff(director(), {
      name: "Paul Nkounkou",
      identifier: "05 111 22 33",
      password: "Provisoire-2026",
      roles: ["teacher"],
    })
  ).userId;
  accountantId = (
    await addStaff(director(), {
      name: "Comptable",
      identifier: "05 111 22 44",
      password: "Provisoire-2026",
      roles: ["accountant"],
    })
  ).userId;
});

afterAll(async () => {
  await closeDb();
});

describe("Classes", () => {
  it("crée une 1re C : elle reprend les 9 matières de la grille, avec leur coefficient", async () => {
    classId = await createClass(director(), yearId, {
      ...base,
      levelId: premiere,
      series: "c",
      name: " 1re C1 ",
      capacity: "45",
      headTeacherId: teacherId,
    });
    const created = await getClass(director(), classId);
    expect(created).toMatchObject({
      name: "1re C1",
      series: "C",
      capacity: 45,
      headTeacherName: "Paul Nkounkou",
      subjectCount: 9,
    });
    expect(created.subjects.every((s) => s.coefficient === 1 && s.teacherId === null)).toBe(true);
  });

  it("suit la grille : coefficient modifié, matière retirée, pour toutes les classes du niveau + série", async () => {
    const second = await createClass(director(), yearId, {
      ...base,
      levelId: premiere,
      series: "C",
      name: "1re C2",
    });
    const maths = await subjectId("Mathématiques");
    const physique = await subjectId("Physique-Chimie");
    await saveGrid(director(), { academicYearId: yearId, levelId: premiere, series: "C" }, [
      { subjectId: maths, coefficient: 5 },
      { subjectId: physique, coefficient: 4 },
    ]);
    for (const id of [classId, second]) {
      const c = await getClass(director(), id);
      expect(c.subjects.map((s) => [s.subjectName, s.coefficient])).toEqual([
        ["Mathématiques", 5],
        ["Physique-Chimie", 4],
      ]);
    }
    await deleteClass(director(), second);
  });

  it("affecte un enseignant par matière ; refuse quelqu'un qui n'a pas le rôle Enseignant", async () => {
    const maths = await subjectId("Mathématiques");
    expect(await listTeachers(director())).toEqual([{ id: teacherId, name: "Paul Nkounkou" }]);
    await assignTeachers(director(), classId, [{ subjectId: maths, teacherId }]);
    const c = await getClass(director(), classId);
    expect(c.subjects.find((s) => s.subjectId === maths)?.teacherId).toBe(teacherId);

    await expectSettingsError(
      assignTeachers(director(), classId, [{ subjectId: maths, teacherId: accountantId }]),
      "notTeacher",
    );
    await expectSettingsError(
      updateClass(director(), classId, {
        ...base,
        levelId: premiere,
        series: "C",
        name: "1re C1",
        headTeacherId: accountantId,
      }),
      "notTeacher",
    );
    const francais = await subjectId("Français");
    await expectSettingsError(
      assignTeachers(director(), classId, [{ subjectId: francais, teacherId }]),
      "subjectNotFound",
    );
  });

  it("garde les affectations des matières qui restent dans la grille", async () => {
    const maths = await subjectId("Mathématiques");
    await saveGrid(director(), { academicYearId: yearId, levelId: premiere, series: "C" }, [
      { subjectId: maths, coefficient: 6 },
    ]);
    const c = await getClass(director(), classId);
    expect(c.subjects).toEqual([
      { subjectId: maths, subjectName: "Mathématiques", coefficient: 6, teacherId },
    ]);
  });

  it("retirer le rôle Enseignant libère ses affectations (année en cours)", async () => {
    const other = (
      await addStaff(director(), {
        name: "Awa Moukala",
        identifier: "05 111 22 55",
        password: "Provisoire-2026",
        roles: ["teacher"],
      })
    ).userId;
    const maths = await subjectId("Mathématiques");
    const tmp = await createClass(director(), yearId, {
      ...base,
      levelId: premiere,
      series: "C",
      name: "1re C9",
      headTeacherId: other,
    });
    await assignTeachers(director(), tmp, [{ subjectId: maths, teacherId: other }]);
    await updateStaffRoles(director(), other, ["secretary"]);
    const c = await getClass(director(), tmp);
    expect(c.headTeacherId).toBeNull();
    expect(c.subjects[0].teacherId).toBeNull();
    await deleteClass(director(), tmp);
  });

  it("refuse un nom en double dans l'année, une série hors lycée, une capacité invalide", async () => {
    await expectSettingsError(
      createClass(director(), yearId, { ...base, levelId: premiere, series: "C", name: "1re C1" }),
      "classNameTaken",
    );
    await expectSettingsError(
      createClass(director(), yearId, { ...base, levelId: sixieme, series: "A", name: "6e A" }),
      "seriesInvalid",
    );
    await expect(
      createClass(director(), yearId, {
        ...base,
        levelId: sixieme,
        series: "",
        name: "6e B",
        capacity: "0",
      }),
    ).rejects.toThrow();
  });

  it("changer de niveau fait suivre la nouvelle grille (vide ici)", async () => {
    const id = await createClass(director(), yearId, {
      ...base,
      levelId: premiere,
      series: "C",
      name: "Temporaire",
    });
    await updateClass(director(), id, { ...base, levelId: sixieme, series: "", name: "6e A" });
    expect(await getClass(director(), id)).toMatchObject({ levelName: "6e", subjectCount: 0 });
    const names = (await listClasses(director(), yearId)).map((c) => c.name);
    expect(names).toEqual(["6e A", "1re C1"]);
  });

  it("les classes d'une année archivée ne se modifient plus", async () => {
    await activateYear(director(), yearId);
    const next = await createYear(director(), {
      label: "2027-2028",
      startDate: "2027-10-01",
      endDate: "2028-06-30",
      periodKind: "trimester",
    });
    await activateYear(director(), next);
    await expectSettingsError(
      createClass(director(), yearId, { ...base, levelId: sixieme, series: "", name: "6e Z" }),
      "yearArchived",
    );
    await expectSettingsError(deleteClass(director(), classId), "yearArchived");
    await expectSettingsError(
      assignTeachers(director(), classId, [
        { subjectId: await subjectId("Mathématiques"), teacherId: null },
      ]),
      "yearArchived",
    );
    expect(await getClass(director(), classId)).toMatchObject({ name: "1re C1" });
  });
});

describe("Droits et isolation", () => {
  it("seul le directeur gère les classes ; le Support consulte", async () => {
    await expect(listClasses(as(a, "support"), yearId)).resolves.toHaveLength(2);
    for (const role of ["secretary", "accountant", "teacher", "parent", "support"] as const) {
      await expect(
        createClass(as(a, role), yearId, { ...base, levelId: sixieme, series: "", name: "X" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("une école ne voit ni ne modifie les classes d'une autre", async () => {
    expect(await listClasses(as(b, "director"), yearId)).toEqual([]);
    await expectSettingsError(getClass(as(b, "director"), classId), "classNotFound");
    await expectSettingsError(deleteClass(as(b, "director"), classId), "classNotFound");
    await expectSettingsError(
      createClass(as(b, "director"), yearId, { ...base, levelId: sixieme, series: "", name: "X" }),
      "yearNotFound",
    );
    // Un enseignant d'une autre école ne peut pas être affecté.
    expect(await listTeachers(as(b, "director"))).toEqual([]);
  });
});
