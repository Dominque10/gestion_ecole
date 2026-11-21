// M1 — grille des coefficients par année, niveau et série (décision D4).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type MembershipRole, type Principal } from "@/server/auth/permissions";
import { closeDb } from "@/server/db/client";
import { SettingsError } from "@/modules/settings/errors";
import { addDefaultGrid, getGrid, listSeries, saveGrid } from "@/modules/settings/coefficients";
import { addDefaultLevels, listLevels, listSubjects } from "@/modules/settings/levels";
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
const subjectId = async (name: string) =>
  (await listSubjects(director())).find((s) => s.name === name)!.id;

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  a = await createSchoolWithDirector(superadminId, "coefa");
  b = await createSchoolWithDirector(superadminId, "coefb");
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
});

afterAll(async () => {
  await closeDb();
});

describe("Grille des coefficients", () => {
  it("propose les matières courantes du lycée en 1re C, coefficient 1, en créant les matières", async () => {
    const key = { academicYearId: yearId, levelId: premiere, series: " c " };
    expect(await addDefaultGrid(director(), key)).toBe(9);
    expect(await addDefaultGrid(director(), key)).toBe(0);
    const grid = await getGrid(director(), { ...key, series: "C" });
    expect(grid).toHaveLength(9);
    expect(grid.every((r) => r.coefficient === 1)).toBe(true);
    expect((await listSubjects(director())).map((s) => s.name)).toContain("Philosophie");
    expect(await listSeries(director(), yearId, premiere)).toEqual(["C"]);
  });

  it("enregistre les coefficients et retire les matières décochées", async () => {
    const key = { academicYearId: yearId, levelId: premiere, series: "C" };
    const maths = await subjectId("Mathématiques");
    const physique = await subjectId("Physique-Chimie");
    const francais = await subjectId("Français");
    await saveGrid(director(), key, [
      { subjectId: maths, coefficient: 5 },
      { subjectId: physique, coefficient: "4" as unknown as number },
      { subjectId: francais, coefficient: 2 },
    ]);
    const grid = await getGrid(director(), key);
    expect(Object.fromEntries(grid.map((r) => [r.subjectId, r.coefficient]))).toEqual({
      [maths]: 5,
      [physique]: 4,
      [francais]: 2,
    });
  });

  it("chaque série a sa propre grille (1re A différente de 1re C)", async () => {
    const keyA = { academicYearId: yearId, levelId: premiere, series: "A" };
    await saveGrid(director(), keyA, [{ subjectId: await subjectId("Français"), coefficient: 5 }]);
    expect(await getGrid(director(), keyA)).toHaveLength(1);
    expect(await getGrid(director(), { ...keyA, series: "C" })).toHaveLength(3);
    expect(await listSeries(director(), yearId, premiere)).toEqual(["A", "C"]);
  });

  it("refuse une série hors lycée, un coefficient hors 1-20, une matière en double", async () => {
    const maths = await subjectId("Mathématiques");
    await expectSettingsError(
      saveGrid(director(), { academicYearId: yearId, levelId: sixieme, series: "C" }, []),
      "seriesInvalid",
    );
    const key = { academicYearId: yearId, levelId: sixieme, series: "" };
    await expect(
      saveGrid(director(), key, [{ subjectId: maths, coefficient: 0 }]),
    ).rejects.toThrow();
    await expect(
      saveGrid(director(), key, [{ subjectId: maths, coefficient: 21 }]),
    ).rejects.toThrow();
    await expect(
      saveGrid(director(), key, [{ subjectId: maths, coefficient: 2.5 }]),
    ).rejects.toThrow();
    await expectSettingsError(
      saveGrid(director(), key, [
        { subjectId: maths, coefficient: 2 },
        { subjectId: maths, coefficient: 3 },
      ]),
      "gridInvalid",
    );
  });

  it("une grille d'année archivée ne se modifie plus", async () => {
    await activateYear(director(), yearId);
    const next = await createYear(director(), {
      label: "2027-2028",
      startDate: "2027-10-01",
      endDate: "2028-06-30",
      periodKind: "trimester",
    });
    await activateYear(director(), next);
    const key = { academicYearId: yearId, levelId: premiere, series: "C" };
    expect(await getGrid(director(), key)).toHaveLength(3);
    await expectSettingsError(saveGrid(director(), key, []), "yearArchived");
    await expectSettingsError(addDefaultGrid(director(), key), "yearArchived");
  });
});

describe("Droits et isolation", () => {
  it("seul le directeur modifie la grille ; le Support la consulte", async () => {
    const key = { academicYearId: yearId, levelId: premiere, series: "C" };
    await expect(getGrid(as(a, "support"), key)).resolves.toHaveLength(3);
    for (const role of ["secretary", "accountant", "teacher", "parent", "support"] as const) {
      await expect(saveGrid(as(a, role), key, [])).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("une école ne lit ni n'écrit la grille d'une autre (année et niveau inconnus pour elle)", async () => {
    const key = { academicYearId: yearId, levelId: premiere, series: "C" };
    await expectSettingsError(getGrid(as(b, "director"), key), "yearNotFound");
    await expectSettingsError(saveGrid(as(b, "director"), key, []), "yearNotFound");
    expect(await listSeries(as(b, "director"), yearId, premiere)).toEqual([]);
  });
});
