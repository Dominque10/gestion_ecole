// M2 (2b) — liste des inscriptions d'une année et réinscription groupée.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type Principal } from "@/server/auth/permissions";
import { closeDb } from "@/server/db/client";
import { createClass } from "@/modules/settings/classes";
import { addDefaultLevels, listLevels } from "@/modules/settings/levels";
import { activateYear, createYear } from "@/modules/settings/years";
import {
  assignClass,
  countEnrollments,
  listEnrollments,
  preEnroll,
  recordDeparture,
  reEnrollClass,
  validateEnrollment,
} from "@/modules/students/enrollments";
import { StudentError } from "@/modules/students/errors";
import { createStudent } from "@/modules/students/students";
import { createSchoolWithDirector, createSuperadmin, resetDatabase } from "./helpers";

let director: Principal;
let other: Principal;
let y1: string;
let y2: string;
let sixieme: string;
let cinquieme: string;
let sixA: string;
const enrollmentOf: Record<string, string> = {};

const year = (label: string, start: number) => ({
  label,
  startDate: `${start}-10-01`,
  endDate: `${start + 1}-06-30`,
  periodKind: "trimester" as const,
});

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  const a = await createSchoolWithDirector(superadminId, "listea");
  const b = await createSchoolWithDirector(superadminId, "listeb");
  director = {
    userId: a.directorId,
    schoolId: a.schoolId,
    roles: ["director"],
    isSuperadmin: false,
  };
  other = { userId: b.directorId, schoolId: b.schoolId, roles: ["director"], isSuperadmin: false };
  await addDefaultLevels(director, "college");
  const levels = await listLevels(director);
  sixieme = levels.find((l) => l.name === "6e")!.id;
  cinquieme = levels.find((l) => l.name === "5e")!.id;
  y1 = await createYear(director, year("2026-2027", 2026));
  sixA = await createClass(director, y1, {
    levelId: sixieme,
    series: "",
    name: "6e A",
    capacity: "",
    headTeacherId: "",
  });
  for (const [i, name] of ["ADA", "BOB", "CHLOE", "DAVID"].entries()) {
    const s = await createStudent(director, {
      student: {
        lastName: name,
        firstNames: "Test",
        sex: "F",
        birthDate: "",
        birthPlace: "",
        nationality: "",
        previousSchool: "",
      },
      guardian: { fullName: "Parent", phone: `06 710 00 0${i}`, otherPhone: "", relationship: "" },
    });
    enrollmentOf[name] = await preEnroll(director, {
      studentId: s.id,
      academicYearId: y1,
      levelId: sixieme,
    });
  }
  // ADA, BOB, CHLOE validés ; ADA et BOB en 6e A ; DAVID reste préinscrit ; CHLOE part.
  for (const name of ["ADA", "BOB", "CHLOE"])
    await validateEnrollment(director, enrollmentOf[name]);
  await assignClass(director, enrollmentOf.ADA, sixA);
  await assignClass(director, enrollmentOf.BOB, sixA);
});

afterAll(async () => {
  await closeDb();
});

describe("Liste des inscriptions", () => {
  it("compte par état et filtre (préinscrits, sans classe, par classe)", async () => {
    await recordDeparture(director, enrollmentOf.CHLOE, {
      reason: "dropout",
      date: "2099-01-01",
      note: "",
    });
    expect(await countEnrollments(director, y1)).toEqual({
      pre_enrolled: 1,
      enrolled: 2,
      withoutClass: 0,
      left: 1,
    });
    const names = async (f: Parameters<typeof listEnrollments>[2]) =>
      (await listEnrollments(director, y1, f)).map((r) => r.lastName);
    expect(await names({ status: "pre_enrolled" })).toEqual(["DAVID"]);
    expect(await names({ classId: sixA })).toEqual(["ADA", "BOB"]);
    expect(await names({})).toEqual(["ADA", "BOB", "CHLOE", "DAVID"]);
  });

  it("un enseignant sans classe ne voit aucune inscription ; une autre école non plus", async () => {
    expect(await listEnrollments({ ...director, roles: ["teacher"] }, y1)).toEqual([]);
    expect(await listEnrollments(other, y1)).toEqual([]);
  });
});

describe("Réinscription groupée", () => {
  it("ADA passe en 5e, BOB redouble : préinscriptions dans l'année suivante", async () => {
    y2 = await createYear(director, year("2027-2028", 2027));
    const result = await reEnrollClass(director, {
      toYearId: y2,
      decisions: [
        { enrollmentId: enrollmentOf.ADA, levelId: cinquieme },
        { enrollmentId: enrollmentOf.BOB, levelId: sixieme },
        { enrollmentId: enrollmentOf.CHLOE, levelId: cinquieme },
        { enrollmentId: enrollmentOf.DAVID, levelId: null },
      ],
    });
    // CHLOE est partie : elle n'est pas réinscrite ; DAVID « ne revient pas ».
    expect(result).toEqual({ created: 2, alreadyEnrolled: 0 });
    const rows = await listEnrollments(director, y2);
    expect(rows.map((r) => [r.lastName, r.levelName, r.status])).toEqual([
      ["ADA", "5e", "pre_enrolled"],
      ["BOB", "6e", "pre_enrolled"],
    ]);
  });

  it("relancer la réinscription n'inscrit personne deux fois", async () => {
    const again = await reEnrollClass(director, {
      toYearId: y2,
      decisions: [{ enrollmentId: enrollmentOf.ADA, levelId: cinquieme }],
    });
    expect(again).toEqual({ created: 0, alreadyEnrolled: 1 });
  });

  it("refuse une année cible archivée, une inscription d'une autre école, un rôle sans droit", async () => {
    await activateYear(director, y1);
    await activateYear(director, y2);
    await expect(
      reEnrollClass(director, {
        toYearId: y1,
        decisions: [{ enrollmentId: enrollmentOf.ADA, levelId: sixieme }],
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof StudentError && e.code === "yearArchived");
    const y3Other = await createYear(other, year("2027-2028", 2027));
    await expect(
      reEnrollClass(other, {
        toYearId: y3Other,
        decisions: [{ enrollmentId: enrollmentOf.ADA, levelId: sixieme }],
      }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof StudentError && e.code === "enrollmentNotFound",
    );
    await expect(
      reEnrollClass({ ...director, roles: ["accountant"] }, { toYearId: y2, decisions: [] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
