// M1 — niveaux et matières de l'école.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type MembershipRole, type Principal } from "@/server/auth/permissions";
import { closeDb, withSchool } from "@/server/db/client";
import { levelSubjects } from "@/server/db/schema";
import { SettingsError } from "@/modules/settings/errors";
import {
  addDefaultLevels,
  createLevel,
  createSubject,
  deleteLevel,
  deleteSubject,
  listLevels,
  listSubjects,
  renameLevel,
  renameSubject,
} from "@/modules/settings/levels";
import { createYear } from "@/modules/settings/years";
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

async function expectSettingsError(promise: Promise<unknown>, code: SettingsError["code"]) {
  await expect(promise).rejects.toSatisfy(
    (e: unknown) => e instanceof SettingsError && e.code === code,
  );
}

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  a = await createSchoolWithDirector(superadminId, "niveaua");
  b = await createSchoolWithDirector(superadminId, "niveaub");
});

afterAll(async () => {
  await closeDb();
});

describe("Niveaux", () => {
  it("ajoute les niveaux congolais d'un cycle, dans l'ordre, sans doublon", async () => {
    expect(await addDefaultLevels(as(a, "director"), "college")).toBe(4);
    expect(await addDefaultLevels(as(a, "director"), "primary")).toBe(6);
    expect(await addDefaultLevels(as(a, "director"), "college")).toBe(0);
    const names = (await listLevels(as(a, "director"))).map((l) => l.name);
    expect(names).toEqual(["CP1", "CP2", "CE1", "CE2", "CM1", "CM2", "6e", "5e", "4e", "3e"]);
  });

  it("ajoute un niveau personnalisé à la fin de son cycle", async () => {
    await createLevel(as(a, "director"), { cycle: "primary", name: " CM2 bis " });
    const primary = (await listLevels(as(a, "director"))).filter((l) => l.cycle === "primary");
    expect(primary.at(-1)?.name).toBe("CM2 bis");
  });

  it("refuse un nom de niveau en double, et ne recrée pas un niveau renommé en minuscules", async () => {
    await expectSettingsError(
      createLevel(as(a, "director"), { cycle: "lycee", name: "6e" }),
      "levelNameTaken",
    );
    const [cp1] = await listLevels(as(a, "director"));
    await expectSettingsError(renameLevel(as(a, "director"), cp1.id, "CP2"), "levelNameTaken");
    await renameLevel(as(a, "director"), cp1.id, "cp1");
    expect(await addDefaultLevels(as(a, "director"), "primary")).toBe(0);
    await renameLevel(as(a, "director"), cp1.id, "CP1");
  });

  it("supprime un niveau inutilisé, refuse s'il a une grille de coefficients", async () => {
    const levels = await listLevels(as(a, "director"));
    const bis = levels.find((l) => l.name === "CM2 bis")!;
    await deleteLevel(as(a, "director"), bis.id);
    await expectSettingsError(deleteLevel(as(a, "director"), bis.id), "levelNotFound");

    const sixieme = levels.find((l) => l.name === "6e")!;
    const yearId = await createYear(as(a, "director"), {
      label: "2026-2027",
      startDate: "2026-10-01",
      endDate: "2027-06-30",
      periodKind: "trimester",
    });
    const subjectId = await createSubject(as(a, "director"), "Mathématiques");
    await withSchool({ schoolId: a.schoolId, userId: a.directorId }, (tx) =>
      tx.insert(levelSubjects).values({
        schoolId: a.schoolId,
        academicYearId: yearId,
        levelId: sixieme.id,
        subjectId,
        coefficient: 4,
      }),
    );
    await expectSettingsError(deleteLevel(as(a, "director"), sixieme.id), "levelInUse");
    await expectSettingsError(deleteSubject(as(a, "director"), subjectId), "subjectInUse");
  });
});

describe("Matières", () => {
  it("crée, renomme et supprime une matière ; refuse les doublons", async () => {
    const id = await createSubject(as(a, "director"), "  Anglais ");
    await expectSettingsError(createSubject(as(a, "director"), "Anglais"), "subjectNameTaken");
    await renameSubject(as(a, "director"), id, "Langue anglaise");
    expect((await listSubjects(as(a, "director"))).map((s) => s.name)).toEqual([
      "Langue anglaise",
      "Mathématiques",
    ]);
    await deleteSubject(as(a, "director"), id);
    await expectSettingsError(renameSubject(as(a, "director"), id, "X"), "subjectNotFound");
    await expect(createSubject(as(a, "director"), "  ")).rejects.toThrow();
  });
});

describe("Droits et isolation", () => {
  it("seul le directeur modifie ; le Support consulte", async () => {
    await expect(listLevels(as(a, "support"))).resolves.not.toHaveLength(0);
    for (const role of ["secretary", "accountant", "teacher", "parent", "support"] as const) {
      await expect(addDefaultLevels(as(a, role), "lycee")).rejects.toBeInstanceOf(ForbiddenError);
      await expect(createSubject(as(a, role), "Musique")).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("une école ne voit ni ne modifie les niveaux et matières d'une autre", async () => {
    expect(await listLevels(as(b, "director"))).toEqual([]);
    expect(await listSubjects(as(b, "director"))).toEqual([]);
    const [levelA] = await listLevels(as(a, "director"));
    const [subjectA] = await listSubjects(as(a, "director"));
    await expectSettingsError(renameLevel(as(b, "director"), levelA.id, "Piraté"), "levelNotFound");
    await expectSettingsError(deleteLevel(as(b, "director"), levelA.id), "levelNotFound");
    await expectSettingsError(deleteSubject(as(b, "director"), subjectA.id), "subjectNotFound");
    // Les mêmes noms restent libres dans une autre école.
    await expect(addDefaultLevels(as(b, "director"), "college")).resolves.toBe(4);
  });
});
