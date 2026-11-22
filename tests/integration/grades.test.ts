// Phase 3, sous-étape 3b — évaluations et saisie des notes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type MembershipRole, type Principal } from "@/server/auth/permissions";
import { closeDb, withSchool } from "@/server/db/client";
import { grades } from "@/server/db/schema";
import { todayInBrazzaville } from "@/lib/dates";
import {
  createAssessment,
  deleteAssessment,
  getCourse,
  getGradeSheet,
  listCourses,
  saveGrades,
  updateAssessment,
} from "@/modules/grading/assessments";
import { GradingError } from "@/modules/grading/errors";
import { assignTeachers, createClass } from "@/modules/settings/classes";
import { addDefaultGrid, getGrid, saveGrid } from "@/modules/settings/coefficients";
import { SettingsError } from "@/modules/settings/errors";
import { addDefaultLevels, listLevels, listSubjects } from "@/modules/settings/levels";
import { addStaff } from "@/modules/settings/staff";
import { activateYear, createYear } from "@/modules/settings/years";
import {
  assignClass,
  preEnroll,
  recordDeparture,
  validateEnrollment,
} from "@/modules/students/enrollments";
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

let year1: string;
let year2: string;
let sixieme: string;
let sixA: string;
let sixB: string;
let maths: string;
let french: string;
let mathsTeacher: string;
let frenchTeacher: string;
let period1: string;
let otherYearPeriod: string;
/** Inscriptions en 6e A (ordre alphabétique : BATSIMBA, KOUBA, NGOMA). */
const pupils: string[] = [];
let outsider: string;

async function enrolledStudent(lastName: string, phone: string, classId: string) {
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
    academicYearId: year1,
    levelId: sixieme,
  });
  await validateEnrollment(director(), enrollment);
  await assignClass(director(), enrollment, classId);
  return enrollment;
}

const quiz = (overrides: Record<string, unknown> = {}) => ({
  periodId: period1,
  kind: "quiz",
  title: "Fractions",
  date: "2026-11-05",
  maxScore: 20,
  ...overrides,
});

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  a = await createSchoolWithDirector(superadminId, "notesa");
  b = await createSchoolWithDirector(superadminId, "notesb");
  await addDefaultLevels(director(), "college");
  sixieme = (await listLevels(director())).find((l) => l.name === "6e")!.id;
  year1 = await createYear(director(), {
    label: "2026-2027",
    startDate: "2026-10-01",
    endDate: "2027-06-30",
    periodKind: "trimester",
  });
  await addDefaultGrid(director(), { academicYearId: year1, levelId: sixieme, series: "" });
  const subjects = await listSubjects(director());
  maths = subjects.find((s) => s.name === "Mathématiques")!.id;
  french = subjects.find((s) => s.name === "Français")!.id;
  const newClass = (name: string) =>
    createClass(director(), year1, {
      levelId: sixieme,
      series: "",
      name,
      capacity: "",
      headTeacherId: "",
    });
  sixA = await newClass("6e A");
  sixB = await newClass("6e B");
  const newTeacher = async (name: string, identifier: string) =>
    (
      await addStaff(director(), {
        name,
        identifier,
        password: "Provisoire-2026",
        roles: ["teacher"],
      })
    ).userId;
  mathsTeacher = await newTeacher("Prof Maths", "05 888 10 01");
  frenchTeacher = await newTeacher("Prof Français", "05 888 10 02");
  await assignTeachers(director(), sixA, [
    { subjectId: maths, teacherId: mathsTeacher },
    { subjectId: french, teacherId: frenchTeacher },
  ]);
  await activateYear(director(), year1);
  year2 = await createYear(director(), {
    label: "2027-2028",
    startDate: "2027-10-01",
    endDate: "2028-06-30",
    periodKind: "trimester",
  });
  const { rows } = await adminQuery<{ id: string; year: string }>(
    "select id, academic_year_id as year from periods where school_id = $1 and position = 1",
    [a.schoolId],
  );
  period1 = rows.find((r) => r.year === year1)!.id;
  otherYearPeriod = rows.find((r) => r.year === year2)!.id;
  pupils.push(await enrolledStudent("NGOMA", "06 700 20 01", sixA));
  pupils.push(await enrolledStudent("BATSIMBA", "06 700 20 02", sixA));
  pupils.push(await enrolledStudent("KOUBA", "06 700 20 03", sixA));
  pupils.sort(); // l'ordre exact importe peu : les tests relisent par inscription
  outsider = await enrolledStudent("MOUKALA", "06 700 20 04", sixB);
});

afterAll(async () => {
  await closeDb();
});

const valueOf = async (principal: Principal, assessmentId: string, enrollmentId: string) =>
  (await getGradeSheet(principal, assessmentId)).rows.find((r) => r.enrollmentId === enrollmentId)
    ?.value;

describe("Matières à noter", () => {
  it("un enseignant ne voit que ses matières ; le directeur toutes ; le secrétariat rien", async () => {
    const own = await listCourses(teacher(mathsTeacher));
    expect(own.map((c) => [c.className, c.subjectName])).toEqual([["6e A", "Mathématiques"]]);
    const all = await listCourses(director());
    expect(all.length).toBeGreaterThan(10);
    expect(all.filter((c) => c.className === "6e B").every((c) => c.teacherName === null)).toBe(
      true,
    );
    await expect(listCourses(as(a, "secretary"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listCourses(as(a, "support"))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("détail : barème proposé sur 20 au collège, périodes de l'année, effectif", async () => {
    const course = await getCourse(teacher(mathsTeacher), sixA, maths);
    expect(course).toMatchObject({
      className: "6e A",
      subjectName: "Mathématiques",
      defaultMaxScore: 20,
      studentCount: 3,
      yearStatus: "active",
    });
    expect(course.periods).toHaveLength(3);
    await expectGradingError(getCourse(teacher(mathsTeacher), sixA, french), "courseNotFound");
    await expectGradingError(getCourse(teacher(mathsTeacher), sixB, maths), "courseNotFound");
  });
});

describe("Évaluations", () => {
  let assessment: string;

  it("l'enseignant crée une évaluation dans sa matière, pas dans celle d'un collègue", async () => {
    assessment = await createAssessment(teacher(mathsTeacher), sixA, maths, quiz());
    const course = await getCourse(teacher(mathsTeacher), sixA, maths);
    expect(course.assessments).toEqual([
      {
        id: assessment,
        periodId: period1,
        kind: "quiz",
        title: "Fractions",
        date: "2026-11-05",
        maxScore: 20,
        filled: 0,
      },
    ]);
    await expectGradingError(
      createAssessment(teacher(mathsTeacher), sixA, french, quiz()),
      "courseNotFound",
    );
    await expectGradingError(
      getGradeSheet(teacher(frenchTeacher), assessment),
      "assessmentNotFound",
    );
  });

  it("refuse un barème, une date ou une période invalides", async () => {
    const t = teacher(mathsTeacher);
    await expectGradingError(
      createAssessment(t, sixA, maths, quiz({ maxScore: 0 })),
      "assessmentInvalid",
    );
    await expectGradingError(
      createAssessment(t, sixA, maths, quiz({ kind: "oral" })),
      "assessmentInvalid",
    );
    await expectGradingError(
      createAssessment(t, sixA, maths, quiz({ date: "2027-08-01" })),
      "dateOutsideYear",
    );
    await expectGradingError(
      createAssessment(t, sixA, maths, quiz({ periodId: otherYearPeriod })),
      "periodNotFound",
    );
  });

  it("renvoyer la même évaluation (même identifiant) ne la crée qu'une fois", async () => {
    const id = crypto.randomUUID();
    await createAssessment(director(), sixA, maths, quiz({ kind: "homework" }), id);
    await createAssessment(director(), sixA, maths, quiz({ kind: "homework" }), id);
    const { rows } = await adminQuery("select 1 from assessments where id = $1", [id]);
    expect(rows).toHaveLength(1);
    await deleteAssessment(director(), id);
  });

  describe("Saisie des notes", () => {
    it("note, absent, dispensé ; feuille relue par ordre alphabétique", async () => {
      const result = await saveGrades(teacher(mathsTeacher), assessment, [
        { enrollmentId: pupils[0], expected: "", value: "12,5" },
        { enrollmentId: pupils[1], expected: "", value: "a" },
        { enrollmentId: pupils[2], expected: "", value: "D" },
      ]);
      expect(result).toEqual({ saved: 3, problems: [], conflicts: [] });
      const sheet = await getGradeSheet(teacher(mathsTeacher), assessment);
      expect(sheet.rows.map((r) => r.lastName)).toEqual(["BATSIMBA", "KOUBA", "NGOMA"]);
      expect(Object.fromEntries(sheet.rows.map((r) => [r.enrollmentId, r.value]))).toEqual({
        [pupils[0]]: "12,5",
        [pupils[1]]: "a",
        [pupils[2]]: "d",
      });
      expect(sheet.rows.every((r) => r.editable)).toBe(true);
      expect((await getCourse(director(), sixA, maths)).assessments[0].filled).toBe(3);
    });

    it("une case illisible ou au-dessus du barème : rien n'est enregistré", async () => {
      const result = await saveGrades(teacher(mathsTeacher), assessment, [
        { enrollmentId: pupils[0], expected: "12,5", value: "15" },
        { enrollmentId: pupils[1], expected: "a", value: "21" },
        { enrollmentId: pupils[2], expected: "d", value: "quinze" },
      ]);
      expect(result.saved).toBe(0);
      expect(result.problems).toEqual([
        { enrollmentId: pupils[1], problem: "outOfRange" },
        { enrollmentId: pupils[2], problem: "unreadable" },
      ]);
      expect(await valueOf(director(), assessment, pupils[0])).toBe("12,5");
    });

    it("une note changée entre-temps n'est jamais écrasée : le conflit est rendu", async () => {
      // Le directeur corrige pendant que l'enseignant a la grille ouverte.
      await saveGrades(director(), assessment, [
        { enrollmentId: pupils[0], expected: "12,5", value: "14" },
      ]);
      const result = await saveGrades(teacher(mathsTeacher), assessment, [
        { enrollmentId: pupils[0], expected: "12,5", value: "13" },
        { enrollmentId: pupils[1], expected: "a", value: "9,75" },
      ]);
      expect(result).toEqual({
        saved: 1,
        problems: [],
        conflicts: [{ enrollmentId: pupils[0], current: "14" }],
      });
      expect(await valueOf(director(), assessment, pupils[0])).toBe("14");
      expect(await valueOf(director(), assessment, pupils[1])).toBe("9,75");
      // En connaissance de cause (valeur actuelle renvoyée), la saisie passe.
      const retry = await saveGrades(teacher(mathsTeacher), assessment, [
        { enrollmentId: pupils[0], expected: "14", value: "13" },
      ]);
      expect(retry.saved).toBe(1);
      // Même valeur déjà en base : rien à faire, pas de conflit.
      const same = await saveGrades(director(), assessment, [
        { enrollmentId: pupils[0], expected: "12", value: "13" },
      ]);
      expect(same).toEqual({ saved: 0, problems: [], conflicts: [] });
    });

    it("vider une case retire la note", async () => {
      await saveGrades(teacher(mathsTeacher), assessment, [
        { enrollmentId: pupils[2], expected: "d", value: "" },
      ]);
      expect(await valueOf(director(), assessment, pupils[2])).toBe("");
    });

    it("refuse un élève d'une autre classe", async () => {
      await expectGradingError(
        saveGrades(director(), assessment, [{ enrollmentId: outsider, expected: "", value: "10" }]),
        "studentNotInClass",
      );
    });

    it("le barème ne descend pas sous une note saisie ; la base refuse une note trop haute", async () => {
      await expectGradingError(
        updateAssessment(teacher(mathsTeacher), assessment, quiz({ maxScore: 10 })),
        "scoreAboveMax",
      );
      await updateAssessment(teacher(mathsTeacher), assessment, quiz({ maxScore: 15, title: "" }));
      const sheet = await getGradeSheet(director(), assessment);
      expect(sheet).toMatchObject({ maxScore: 15, title: null });
      await expect(
        withSchool({ schoolId: a.schoolId, userId: a.directorId }, (tx) =>
          tx.insert(grades).values({
            schoolId: a.schoolId,
            academicYearId: year1,
            assessmentId: assessment,
            enrollmentId: pupils[2],
            status: "scored",
            score: 16,
            updatedBy: a.directorId,
          }),
        ),
      ).rejects.toSatisfy((e: unknown) => {
        const err = e as { code?: string; cause?: { code?: string } };
        return (err.cause?.code ?? err.code) === "GS007";
      });
    });

    it("un élève parti garde sa note, visible mais plus modifiable", async () => {
      await recordDeparture(director(), pupils[1], {
        reason: "transfer",
        date: todayInBrazzaville(),
        note: "",
      });
      const row = (await getGradeSheet(director(), assessment)).rows.find(
        (r) => r.enrollmentId === pupils[1],
      );
      expect(row).toMatchObject({ value: "9,75", editable: false });
      await expectGradingError(
        saveGrades(director(), assessment, [
          { enrollmentId: pupils[1], expected: "9,75", value: "10" },
        ]),
        "studentNotInClass",
      );
    });

    it("une matière qui a des évaluations ne peut pas être retirée de la grille", async () => {
      const key = { academicYearId: year1, levelId: sixieme, series: "" };
      const grid = await getGrid(director(), key);
      await expect(
        saveGrid(
          director(),
          key,
          grid.filter((g) => g.subjectId !== maths),
        ),
      ).rejects.toSatisfy(
        (e: unknown) => e instanceof SettingsError && e.code === "subjectHasAssessments",
      );
    });

    it("isolation : une autre école ne voit ni l'évaluation ni les notes", async () => {
      await expectGradingError(getGradeSheet(as(b, "director"), assessment), "assessmentNotFound");
      const seen = await withSchool({ schoolId: b.schoolId, userId: b.directorId }, (tx) =>
        tx.select().from(grades),
      );
      expect(seen).toHaveLength(0);
    });

    it("supprimer une évaluation notée retire ses notes et laisse une trace", async () => {
      const other = await createAssessment(teacher(mathsTeacher), sixA, maths, quiz());
      await saveGrades(teacher(mathsTeacher), other, [
        { enrollmentId: pupils[0], expected: "", value: "8" },
      ]);
      await expect(deleteAssessment(as(a, "secretary"), other)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await deleteAssessment(teacher(mathsTeacher), other);
      const { rows } = await adminQuery<{ before: { grades: number } }>(
        "select before from audit_logs where action = 'assessment.delete' and entity_id = $1",
        [other],
      );
      expect(rows.map((r) => r.before.grades)).toEqual([1]);
      const left = await adminQuery("select 1 from grades where assessment_id = $1", [other]);
      expect(left.rows).toHaveLength(0);
    });

    it("année archivée : notes en lecture seule, plus de nouvelle évaluation", async () => {
      await activateYear(director(), year2);
      await expectGradingError(
        saveGrades(director(), assessment, [
          { enrollmentId: pupils[0], expected: "13", value: "12" },
        ]),
        "yearArchived",
      );
      await expectGradingError(createAssessment(director(), sixA, maths, quiz()), "yearNotActive");
      expect((await getGradeSheet(director(), assessment)).yearStatus).toBe("archived");
      expect(await listCourses(teacher(mathsTeacher))).toEqual([]);
    });
  });
});
