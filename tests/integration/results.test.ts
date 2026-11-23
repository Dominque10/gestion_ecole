// Phase 3, sous-étape 3d — moyennes, rangs, clôture des périodes par classe.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type MembershipRole, type Principal } from "@/server/auth/permissions";
import { closeDb, withSchool } from "@/server/db/client";
import { grades } from "@/server/db/schema";
import {
  createAssessment,
  getCourse,
  getGradeSheet,
  saveGrades,
} from "@/modules/grading/assessments";
import { GradingError } from "@/modules/grading/errors";
import {
  closePeriod,
  getAnnualResults,
  getClassResults,
  listResultClasses,
  reopenPeriod,
} from "@/modules/grading/results";
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
let b: School;
const as = (school: School, ...roles: MembershipRole[]): Principal => ({
  userId: school.directorId,
  schoolId: school.schoolId,
  roles,
  isSuperadmin: false,
});
const director = () => as(a, "director");
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

let year: string;
let sixieme: string;
let sixA: string;
let t1: string;
let t2: string;
let headTeacher: string;
let otherTeacher: string;
const subject: Record<string, string> = {};
const pupil: Record<string, string> = {};
/** Évaluations du trimestre 1, par code. */
const ev: Record<string, string> = {};

async function enrolled(lastName: string, phone: string) {
  const student = await createStudent(director(), {
    student: {
      lastName,
      firstNames: "Test",
      sex: "F",
      birthDate: "",
      birthPlace: "",
      nationality: "",
      previousSchool: "",
    },
    guardian: { fullName: "Parent", phone, otherPhone: "", relationship: "" },
  });
  const enrollment = await preEnroll(director(), {
    studentId: student.id,
    academicYearId: year,
    levelId: sixieme,
  });
  await validateEnrollment(director(), enrollment);
  await assignClass(director(), enrollment, sixA);
  return enrollment;
}

/** Évaluation du trimestre 1 notée d'un coup (cases : élève → valeur saisie). */
async function evaluate(
  code: string,
  subjectName: string,
  kind: string,
  maxScore: number,
  values: Record<string, string>,
  periodId = t1,
) {
  ev[code] = await createAssessment(director(), sixA, subject[subjectName], {
    periodId,
    kind,
    title: code,
    date: periodId === t1 ? "2026-11-05" : "2027-02-05",
    maxScore,
  });
  await saveGrades(
    director(),
    ev[code],
    Object.entries(values).map(([name, value]) => ({
      enrollmentId: pupil[name],
      expected: "",
      value,
    })),
  );
}

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  a = await createSchoolWithDirector(superadminId, "resula");
  b = await createSchoolWithDirector(superadminId, "resulb");
  await addDefaultLevels(director(), "college");
  sixieme = (await listLevels(director())).find((l) => l.name === "6e")!.id;
  year = await createYear(director(), {
    label: "2026-2027",
    startDate: "2026-10-01",
    endDate: "2027-06-30",
    periodKind: "trimester",
  });
  const key = { academicYearId: year, levelId: sixieme, series: "" };
  await addDefaultGrid(director(), key);
  for (const s of await listSubjects(director())) subject[s.name] = s.id;
  // Maths 4, Français 3, Anglais 2 ; EPS facultative coef 1 (comme le dessin du cas construit).
  await saveGrid(director(), key, [
    { subjectId: subject["Mathématiques"], coefficient: 4 },
    { subjectId: subject["Français"], coefficient: 3 },
    { subjectId: subject["Anglais"], coefficient: 2 },
    { subjectId: subject["Éducation physique et sportive"], coefficient: 1, optional: true },
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
  headTeacher = await staff("Prof principal", "05 888 20 01");
  otherTeacher = await staff("Autre prof", "05 888 20 02");
  sixA = await createClass(director(), year, {
    levelId: sixieme,
    series: "",
    name: "6e A",
    capacity: "",
    headTeacherId: headTeacher,
  });
  await assignTeachers(director(), sixA, [
    { subjectId: subject["Mathématiques"], teacherId: otherTeacher },
  ]);
  await activateYear(director(), year);
  const { rows } = await adminQuery<{ id: string; position: number }>(
    "select id, position from periods where academic_year_id = $1 order by position",
    [year],
  );
  [t1, t2] = rows.map((r) => r.id);
  pupil.ADA = await enrolled("ADA", "06 700 30 01");
  pupil.BOB = await enrolled("BOB", "06 700 30 02");
  pupil.CHLOE = await enrolled("CHLOE", "06 700 30 03");

  // Cas de référence construit (voir src/modules/grading/averages.test.ts), saisi par l'application.
  await evaluate("m-i1", "Mathématiques", "quiz", 20, { ADA: "14", BOB: "a", CHLOE: "13" });
  await evaluate("m-d1", "Mathématiques", "homework", 10, { ADA: "7", BOB: "5", CHLOE: "6,5" });
  await evaluate("m-c", "Mathématiques", "composition", 20, { ADA: "11", BOB: "9", CHLOE: "12,5" });
  await evaluate("f-d1", "Français", "homework", 20, { ADA: "12", BOB: "d", CHLOE: "13" });
  await evaluate("f-c", "Français", "composition", 40, { ADA: "26", BOB: "30", CHLOE: "24,5" });
  await evaluate("an-i1", "Anglais", "quiz", 20, { ADA: "15", BOB: "11", CHLOE: "a" });
  await evaluate("eps", "Éducation physique et sportive", "homework", 20, { ADA: "16", BOB: "6" });
});

afterAll(async () => {
  await closeDb();
});

describe("Résultats d'une période", () => {
  it("moyennes, rangs et mentions du cas de référence, calculés depuis la base", async () => {
    const results = await getClassResults(director(), sixA, t1);
    expect(results.period.id).toBe(t1);
    expect(results.subjects.map((s) => [s.coefficient, s.optional])).toEqual([
      [4, false],
      [3, false],
      [2, false],
      [1, true],
    ]);
    expect(
      results.students.map((s) => [
        s.lastName,
        s.average,
        s.rank,
        s.mention,
        s.subjects.map((x) => x.average),
      ]),
    ).toEqual([
      ["ADA", 13.72, 1, "Tableau d'honneur", [12.5, 12.5, 15, 16]],
      ["BOB", 11.67, 3, null, [9.5, 15, 11, 6]],
      ["CHLOE", 12.7, 2, "Tableau d'honneur", [12.75, 12.63, null, null]],
    ]);
    expect(results.classStats).toEqual({ average: 12.7, highest: 13.72, lowest: 11.67 });
    expect(results.closure.state).toBe("open");
  });

  it("le professeur principal voit sa classe ; un autre enseignant, le secrétariat, une autre école non", async () => {
    expect(await listResultClasses(teacher(headTeacher))).toEqual([
      { classId: sixA, className: "6e A", levelName: "6e" },
    ]);
    expect(await listResultClasses(teacher(otherTeacher))).toEqual([]);
    await expect(getClassResults(teacher(headTeacher), sixA, t1)).resolves.toBeDefined();
    await expectGradingError(getClassResults(teacher(otherTeacher), sixA, t1), "classNotFound");
    await expect(getClassResults(as(a, "secretary"), sixA, t1)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expectGradingError(getClassResults(as(b, "director"), sixA, t1), "classNotFound");
  });

  it("moyenne annuelle : à partir des trimestres ayant une moyenne", async () => {
    await evaluate("m-c2", "Mathématiques", "composition", 20, { ADA: "15", BOB: "8" }, t2);
    const annual = await getAnnualResults(director(), sixA);
    expect(
      annual.students.map((s) => [s.lastName, s.periods.slice(0, 2), s.average, s.rank]),
    ).toEqual([
      ["ADA", [13.72, 15], 14.36, 1],
      ["BOB", [11.67, 8], 9.84, 3],
      ["CHLOE", [12.7, null], 12.7, 2],
    ]);
  });
});

describe("Clôture d'une période pour une classe", () => {
  it("réservée au directeur ; une fois close, plus aucune note ne change (garanti par la base)", async () => {
    await expect(closePeriod(as(a, "secretary"), sixA, t1)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(closePeriod(teacher(headTeacher), sixA, t1)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await closePeriod(director(), sixA, t1);
    await closePeriod(director(), sixA, t1); // déjà close : sans effet
    const { rows } = await adminQuery("select 1 from audit_logs where action = 'period.close'");
    expect(rows).toHaveLength(1);

    expect((await getClassResults(director(), sixA, t1)).closure).toMatchObject({
      state: "closed",
      closedByName: "Directeur resula",
    });
    expect((await getCourse(director(), sixA, subject["Mathématiques"])).closedPeriodIds).toEqual([
      t1,
    ]);
    expect((await getGradeSheet(director(), ev["m-c"])).closed).toBe(true);
    await expectGradingError(
      saveGrades(director(), ev["m-c"], [{ enrollmentId: pupil.ADA, expected: "11", value: "12" }]),
      "periodClosed",
    );
    await expectGradingError(
      createAssessment(director(), sixA, subject["Anglais"], {
        periodId: t1,
        kind: "quiz",
        title: "",
        date: "2026-11-20",
        maxScore: 20,
      }),
      "periodClosed",
    );
    // Même en contournant l'application, la base refuse.
    await expect(
      withSchool({ schoolId: a.schoolId, userId: a.directorId }, (tx) =>
        tx.update(grades).set({ score: 20 }),
      ),
    ).rejects.toSatisfy((e: unknown) => {
      const err = e as { code?: string; cause?: { code?: string } };
      return (err.cause?.code ?? err.code) === "GS008";
    });
    // Le trimestre 2 reste ouvert.
    await expect(
      saveGrades(director(), ev["m-c2"], [
        { enrollmentId: pupil.CHLOE, expected: "", value: "10" },
      ]),
    ).resolves.toMatchObject({ saved: 1 });
  });

  it("réouverture par le directeur, motif obligatoire ; ensuite chaque modification est tracée", async () => {
    await expectGradingError(reopenPeriod(director(), sixA, t1, " "), "reopenReason");
    await expect(
      reopenPeriod(teacher(headTeacher), sixA, t1, "Erreur de saisie"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await reopenPeriod(director(), sixA, t1, "Erreur de saisie en maths");
    await expectGradingError(reopenPeriod(director(), sixA, t1, "Encore"), "periodNotClosed");
    expect((await getClassResults(director(), sixA, t1)).closure).toMatchObject({
      state: "reopened",
      reopenReason: "Erreur de saisie en maths",
    });

    await saveGrades(teacher(otherTeacher), ev["m-c"], [
      { enrollmentId: pupil.ADA, expected: "11", value: "12" },
    ]);
    const { rows } = await adminQuery<{ action: string; before: unknown; after: unknown }>(
      `select action, before, after from audit_logs
       where action in ('period.reopen', 'grade.change_after_close') order by created_at`,
    );
    expect(rows.map((r) => r.action)).toEqual(["period.reopen", "grade.change_after_close"]);
    expect(rows[1]).toMatchObject({ before: { value: "11" }, after: { value: "12" } });

    // Nouvelle moyenne d'ADA en maths : (14 + 12) / 2 = 13.
    const results = await getClassResults(director(), sixA, t1);
    expect(results.students.find((s) => s.lastName === "ADA")?.subjects[0].average).toBe(13);

    // Nouvelle clôture possible.
    await closePeriod(director(), sixA, t1);
    expect((await getClassResults(director(), sixA, t1)).closure.state).toBe("closed");
  });
});
