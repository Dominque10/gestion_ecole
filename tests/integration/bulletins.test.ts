// Phase 3, sous-étape 3g — bulletins : projet, publication (photographie), PDF de toute une classe.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type Principal } from "@/server/auth/permissions";
import { closeDb } from "@/server/db/client";
import { renderDocument } from "@/modules/documents/documents";
import { closePdfBrowser } from "@/modules/documents/pdf";
import { createAssessment, saveGrades } from "@/modules/grading/assessments";
import { getBulletins, publishBulletins } from "@/modules/grading/bulletins";
import {
  ANNUAL,
  reopenCouncil,
  saveCouncil,
  saveSubjectComments,
  validateCouncil,
} from "@/modules/grading/council";
import { GradingError } from "@/modules/grading/errors";
import { closePeriod, reopenPeriod } from "@/modules/grading/results";
import { assignTeachers, createClass } from "@/modules/settings/classes";
import { addDefaultGrid, saveGrid } from "@/modules/settings/coefficients";
import { addDefaultLevels, listLevels, listSubjects } from "@/modules/settings/levels";
import { addStaff } from "@/modules/settings/staff";
import { activateYear, createYear } from "@/modules/settings/years";
import { assignClass, preEnroll, validateEnrollment } from "@/modules/students/enrollments";
import { createStudent } from "@/modules/students/students";
import { adminQuery, createSchoolWithDirector, createSuperadmin, resetDatabase } from "./helpers";

type School = { schoolId: string; directorId: string };
let a: School;
const director = (): Principal => ({
  userId: a.directorId,
  schoolId: a.schoolId,
  roles: ["director"],
  isSuperadmin: false,
});
const teacher = (userId: string): Principal => ({
  userId,
  schoolId: a.schoolId,
  roles: ["teacher"],
  isSuperadmin: false,
});

async function expectGradingError(promise: Promise<unknown>, code: GradingError["code"]) {
  await expect(promise).rejects.toSatisfy(
    (e: unknown) => e instanceof GradingError && e.code === code,
  );
}

const COUNT = 50;
let sixA: string;
let t1: string;
let headTeacher: string;
let otherTeacher: string;
let mathsComposition: string;
const subject: Record<string, string> = {};
const pupils: string[] = [];

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  a = await createSchoolWithDirector(superadminId, "bulla");
  await addDefaultLevels(director(), "college");
  const sixieme = (await listLevels(director())).find((l) => l.name === "6e")!.id;
  const year = await createYear(director(), {
    label: "2026-2027",
    startDate: "2026-10-01",
    endDate: "2027-06-30",
    periodKind: "trimester",
  });
  const key = { academicYearId: year, levelId: sixieme, series: "" };
  await addDefaultGrid(director(), key);
  for (const s of await listSubjects(director())) subject[s.name] = s.id;
  await saveGrid(director(), key, [
    { subjectId: subject["Mathématiques"], coefficient: 4 },
    { subjectId: subject["Français"], coefficient: 3 },
    { subjectId: subject["Anglais"], coefficient: 2 },
  ]);
  const staff = async (name: string, identifier: string) =>
    (
      await addStaff(director(), {
        name,
        identifier,
        password: "Provisoire-2026",
        roles: ["teacher"],
      })
    ).userId;
  headTeacher = await staff("Prof principal", "05 888 60 01");
  otherTeacher = await staff("Prof anglais", "05 888 60 02");
  sixA = await createClass(director(), year, {
    levelId: sixieme,
    series: "",
    name: "6e A",
    capacity: "",
    headTeacherId: headTeacher,
  });
  await assignTeachers(director(), sixA, [
    { subjectId: subject["Anglais"], teacherId: otherTeacher },
  ]);
  await activateYear(director(), year);
  t1 = (
    await adminQuery<{ id: string }>(
      "select id from periods where academic_year_id = $1 and position = 1",
      [year],
    )
  ).rows[0].id;
  for (let i = 0; i < COUNT; i++) {
    const s = await createStudent(director(), {
      student: {
        lastName: `ELEVE${String(i).padStart(2, "0")}`,
        firstNames: "Test",
        sex: i % 2 ? "F" : "M",
        birthDate: "2014-03-01",
        birthPlace: "",
        nationality: "",
        previousSchool: "",
      },
      guardian: {
        fullName: "Parent",
        phone: `06 71${String(i).padStart(5, "0")}`,
        otherPhone: "",
        relationship: "",
      },
    });
    const e = await preEnroll(director(), {
      studentId: s.id,
      academicYearId: year,
      levelId: sixieme,
    });
    await validateEnrollment(director(), e);
    await assignClass(director(), e, sixA);
    pupils.push(e);
  }
  for (const [name, base] of [
    ["Mathématiques", 8],
    ["Français", 9],
    ["Anglais", 10],
  ] as const) {
    const id = await createAssessment(director(), sixA, subject[name], {
      periodId: t1,
      kind: "composition",
      title: "",
      date: "2026-11-05",
      maxScore: 20,
    });
    if (name === "Mathématiques") mathsComposition = id;
    await saveGrades(
      director(),
      id,
      pupils.map((enrollmentId, i) => ({
        enrollmentId,
        expected: "",
        value: String(base + (i % 10)),
      })),
    );
  }
  await saveSubjectComments(teacher(otherTeacher), sixA, subject["Anglais"], t1, [
    { enrollmentId: pupils[0], text: "Bon trimestre." },
  ]);
  await saveCouncil(teacher(headTeacher), sixA, t1, [
    { enrollmentId: pupils[0], generalComment: "Élève sérieux." },
  ]);
}, 120_000);

afterAll(async () => {
  await closePdfBrowser();
  await closeDb();
});

describe("Projet de bulletins", () => {
  it("calculé à l'instant, avec matières, appréciations, rang et chiffres de la classe", async () => {
    const set = await getBulletins(teacher(headTeacher), sixA, t1);
    expect(set).toMatchObject({ published: false, councilValidated: false, className: "6e A" });
    expect(set.bulletins).toHaveLength(COUNT);
    const first = set.bulletins[0];
    // ELEVE00 : maths 8, français 9, anglais 10 → (32 + 27 + 20) / 9 = 8,78.
    expect(first).toMatchObject({
      className: "6e A",
      classSize: COUNT,
      periodLabel: "1er trimestre",
      average: 8.78,
      generalComment: "Élève sérieux.",
      headTeacherName: "Prof principal",
      student: { lastName: "ELEVE00", sex: "M", birthDate: "2014-03-01" },
    });
    expect(first.subjects.map((s) => [s.name, s.coefficient, s.average, s.comment])).toEqual([
      ["Mathématiques", 4, 8, ""],
      ["Français", 3, 9, ""],
      ["Anglais", 2, 10, "Bon trimestre."],
    ]);
    expect(first.subjects[2].teacherName).toBe("Prof anglais");
    await expectGradingError(getBulletins(teacher(otherTeacher), sixA, t1), "classNotFound");
  });
});

describe("Publication", () => {
  it("après la validation du conseil seulement, par le directeur", async () => {
    await expectGradingError(publishBulletins(director(), sixA, t1), "councilNotValidated");
    await closePeriod(director(), sixA, t1);
    await validateCouncil(director(), sixA, t1);
    await expect(publishBulletins(teacher(headTeacher), sixA, t1)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await publishBulletins(director(), sixA, t1)).toBe(COUNT);
    const set = await getBulletins(director(), sixA, t1);
    expect(set.published).toBe(true);
    expect(set.publishedAt).toBeInstanceOf(Date);
    const { rows } = await adminQuery(
      "select 1 from audit_logs where action = 'bulletins.publish'",
    );
    expect(rows).toHaveLength(1);
  });

  it("un bulletin publié garde ses moyennes ; corriger demande de rouvrir puis de republier", async () => {
    // Correction d'une note après réouverture de la période (tracée).
    await reopenPeriod(director(), sixA, t1, "Erreur de saisie");
    await saveGrades(director(), mathsComposition, [
      { enrollmentId: pupils[0], expected: "8", value: "18" },
    ]);
    const still = await getBulletins(director(), sixA, t1);
    expect(still.published).toBe(true);
    expect(still.bulletins[0].average).toBe(8.78);

    await reopenCouncil(director(), sixA, t1);
    const draft = await getBulletins(director(), sixA, t1);
    expect(draft.published).toBe(false);
    // (72 + 27 + 20) / 9 = 13,22
    expect(draft.bulletins[0].average).toBe(13.22);
    const { rows } = await adminQuery<{ before: { publishedWithdrawn: number } }>(
      "select before from audit_logs where action = 'council.reopen'",
    );
    expect(rows[0].before.publishedWithdrawn).toBe(COUNT);

    await closePeriod(director(), sixA, t1);
    await validateCouncil(director(), sixA, t1);
    await publishBulletins(director(), sixA, t1);
    expect((await getBulletins(director(), sixA, t1)).bulletins[0].average).toBe(13.22);
  });
});

describe("PDF de toute la classe", () => {
  it(`${COUNT} bulletins en moins de 30 secondes`, async () => {
    const started = Date.now();
    const pdf = await renderDocument({
      schoolId: a.schoolId,
      userId: a.directorId,
      request: { kind: "bulletins", classId: sixA, periodKey: t1 },
    });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(30_000);
    console.log(`${COUNT} bulletins en ${elapsed} ms`);
    expect(pdf.fileName).toBe("bulletins-6e-A-1er-trimestre.pdf");
    const bytes = Buffer.from(pdf.pdfBase64, "base64");
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    const pages = bytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pages.length).toBe(COUNT);
  }, 60_000);

  it("bulletin annuel : projet tant que le conseil de fin d'année n'est pas validé", async () => {
    const set = await getBulletins(director(), sixA, ANNUAL);
    expect(set.annual).toBe(true);
    expect(set.bulletins[0].periods.map((p) => [p.label, p.average])).toEqual([
      ["1er trimestre", 13.22],
      ["2e trimestre", null],
      ["3e trimestre", null],
    ]);
    const pdf = await renderDocument({
      schoolId: a.schoolId,
      userId: a.directorId,
      request: { kind: "bulletins", classId: sixA, periodKey: ANNUAL },
    });
    expect(pdf.fileName).toBe("bulletins-6e-A-annuel-projet.pdf");
  }, 60_000);
});
