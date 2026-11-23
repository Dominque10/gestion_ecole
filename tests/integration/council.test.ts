// Phase 3, sous-étape 3f — conseil de classe : appréciations, mention, décision, validation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type MembershipRole, type Principal } from "@/server/auth/permissions";
import { closeDb } from "@/server/db/client";
import { saveRollCall } from "@/modules/attendance/roll";
import { createAssessment, saveGrades } from "@/modules/grading/assessments";
import {
  ANNUAL,
  getCouncil,
  getSubjectComments,
  reopenCouncil,
  saveCouncil,
  saveSubjectComments,
  validateCouncil,
} from "@/modules/grading/council";
import { GradingError } from "@/modules/grading/errors";
import { closePeriod } from "@/modules/grading/results";
import { assignTeachers, createClass } from "@/modules/settings/classes";
import { addDefaultGrid, saveGrid } from "@/modules/settings/coefficients";
import { addDefaultLevels, listLevels, listSubjects } from "@/modules/settings/levels";
import { addStaff } from "@/modules/settings/staff";
import { createTimeSlot } from "@/modules/settings/time-slots";
import { activateYear, createYear } from "@/modules/settings/years";
import { assignClass, preEnroll, validateEnrollment } from "@/modules/students/enrollments";
import { createStudent } from "@/modules/students/students";
import { adminQuery, createSchoolWithDirector, createSuperadmin, resetDatabase } from "./helpers";

type School = { schoolId: string; directorId: string };
let a: School;
const as = (...roles: MembershipRole[]): Principal => ({
  userId: a.directorId,
  schoolId: a.schoolId,
  roles,
  isSuperadmin: false,
});
const director = () => as("director");
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

let sixA: string;
let t1: string;
let lastPeriod: string;
let headTeacher: string;
let mathsTeacher: string;
const subject: Record<string, string> = {};
const pupil: Record<string, string> = {};

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  a = await createSchoolWithDirector(superadminId, "consa");
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
  headTeacher = await staff("Prof principal", "05 888 50 01");
  mathsTeacher = await staff("Prof maths", "05 888 50 02");
  sixA = await createClass(director(), year, {
    levelId: sixieme,
    series: "",
    name: "6e A",
    capacity: "",
    headTeacherId: headTeacher,
  });
  await assignTeachers(director(), sixA, [
    { subjectId: subject["Mathématiques"], teacherId: mathsTeacher },
  ]);
  await activateYear(director(), year);
  const { rows } = await adminQuery<{ id: string }>(
    "select id from periods where academic_year_id = $1 order by position",
    [year],
  );
  t1 = rows[0].id;
  lastPeriod = rows[rows.length - 1].id;
  for (const [name, phone] of [
    ["ADA", "06 700 50 01"],
    ["BOB", "06 700 50 02"],
  ]) {
    const s = await createStudent(director(), {
      student: {
        lastName: name,
        firstNames: "Test",
        sex: "F",
        birthDate: "",
        birthPlace: "",
        nationality: "",
        previousSchool: "",
      },
      guardian: { fullName: "Parent", phone, otherPhone: "", relationship: "" },
    });
    const e = await preEnroll(director(), {
      studentId: s.id,
      academicYearId: year,
      levelId: sixieme,
    });
    await validateEnrollment(director(), e);
    await assignClass(director(), e, sixA);
    pupil[name] = e;
  }
  // Trimestre 1 : maths ADA 16, BOB 9 ; français ADA 15, BOB 10.
  for (const [subjectName, values] of [
    ["Mathématiques", { ADA: "16", BOB: "9" }],
    ["Français", { ADA: "15", BOB: "10" }],
  ] as const) {
    const id = await createAssessment(director(), sixA, subject[subjectName], {
      periodId: t1,
      kind: "composition",
      title: "",
      date: "2026-11-05",
      maxScore: 20,
    });
    await saveGrades(
      director(),
      id,
      Object.entries(values).map(([n, value]) => ({ enrollmentId: pupil[n], expected: "", value })),
    );
  }
  // Appel : BOB absent deux créneaux (un justifié ensuite à la main), ADA en retard une fois.
  const morning = await createTimeSlot(director(), {
    label: "Matin",
    startTime: "07:30",
    endTime: "12:30",
  });
  const afternoon = await createTimeSlot(director(), {
    label: "Soir",
    startTime: "15:00",
    endTime: "18:00",
  });
  const noop = async () => undefined;
  for (const slotId of [morning, afternoon]) {
    await saveRollCall(
      director(),
      { classId: sixA, date: "2026-11-10", slotId },
      [
        { enrollmentId: pupil.ADA, expected: "", value: slotId === morning ? "late" : "present" },
        { enrollmentId: pupil.BOB, expected: "", value: "absent" },
      ],
      noop,
    );
  }
  await adminQuery(
    "update attendance set justified = true, justification_reason = 'Maladie', justified_by = $1, justified_at = now() where time_slot_id = $2 and status = 'absent'",
    [a.directorId, morning],
  );
});

afterAll(async () => {
  await closeDb();
});

describe("Appréciations par matière", () => {
  it("l'enseignant écrit celles de sa matière, pas d'une autre ; le directeur, toutes", async () => {
    const sheet = await getSubjectComments(
      teacher(mathsTeacher),
      sixA,
      subject["Mathématiques"],
      t1,
    );
    expect(sheet.students.map((s) => [s.lastName, s.average, s.comment])).toEqual([
      ["ADA", 16, ""],
      ["BOB", 9, ""],
    ]);
    await saveSubjectComments(teacher(mathsTeacher), sixA, subject["Mathématiques"], t1, [
      { enrollmentId: pupil.ADA, text: "Excellent travail." },
      { enrollmentId: pupil.BOB, text: "Doit revoir les fractions." },
    ]);
    await expectGradingError(
      saveSubjectComments(teacher(mathsTeacher), sixA, subject["Français"], t1, [
        { enrollmentId: pupil.ADA, text: "Bien." },
      ]),
      "courseNotFound",
    );
    await saveSubjectComments(director(), sixA, subject["Français"], t1, [
      { enrollmentId: pupil.ADA, text: "Très bonne expression." },
    ]);
    await expectGradingError(
      saveSubjectComments(director(), sixA, subject["Français"], t1, [
        { enrollmentId: pupil.ADA, text: "x".repeat(301) },
      ]),
      "commentTooLong",
    );
    const after = await getSubjectComments(
      teacher(mathsTeacher),
      sixA,
      subject["Mathématiques"],
      t1,
    );
    expect(after.students.map((s) => s.comment)).toEqual([
      "Excellent travail.",
      "Doit revoir les fractions.",
    ]);
  });
});

describe("Conseil de classe d'une période", () => {
  it("le professeur principal voit moyennes, rang, mention proposée, appréciations et absences", async () => {
    const council = await getCouncil(teacher(headTeacher), sixA, t1);
    expect(council.closed).toBe(false);
    const [ada, bob] = council.students;
    // ADA (16×4 + 15×3)/7 = 15,57 ; BOB (9×4 + 10×3)/7 = 9,43.
    expect([ada.average, ada.rank, ada.proposedMention, ada.mention]).toEqual([
      15.57,
      1,
      "Encouragements",
      null,
    ]);
    expect([bob.average, bob.rank, bob.proposedMention]).toEqual([9.43, 2, null]);
    expect(ada.subjectComments).toEqual({
      [subject["Mathématiques"]]: "Excellent travail.",
      [subject["Français"]]: "Très bonne expression.",
    });
    expect(ada.attendance).toEqual({ absences: 0, unjustified: 0, lates: 1 });
    expect(bob.attendance).toEqual({ absences: 2, unjustified: 1, lates: 0 });
    expect(council.mentionChoices).toEqual([
      "Félicitations",
      "Encouragements",
      "Tableau d'honneur",
      "Avertissement",
      "Blâme",
    ]);
    await expectGradingError(getCouncil(teacher(mathsTeacher), sixA, t1), "classNotFound");
  });

  it("appréciation générale : professeur principal ; mention : directeur seul", async () => {
    await saveCouncil(teacher(headTeacher), sixA, t1, [
      { enrollmentId: pupil.ADA, generalComment: "Excellent trimestre." },
      { enrollmentId: pupil.BOB, generalComment: "Doit se ressaisir." },
    ]);
    await expect(
      saveCouncil(teacher(headTeacher), sixA, t1, [
        { enrollmentId: pupil.BOB, mention: "Avertissement" },
      ]),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await saveCouncil(director(), sixA, t1, [
      { enrollmentId: pupil.BOB, mention: "Avertissement" },
    ]);
    await expectGradingError(
      saveCouncil(director(), sixA, t1, [{ enrollmentId: pupil.BOB, mention: "Super" }]),
      "mentionInvalid",
    );
    await expectGradingError(
      saveCouncil(director(), sixA, t1, [{ enrollmentId: pupil.BOB, decision: "repeat" }]),
      "decisionInvalid",
    );
    const council = await getCouncil(director(), sixA, t1);
    expect(council.students.map((s) => [s.generalComment, s.mention])).toEqual([
      ["Excellent trimestre.", null],
      ["Doit se ressaisir.", "Avertissement"],
    ]);
  });

  it("validation : période close d'abord ; ensuite tout est figé, sauf réouverture par le directeur", async () => {
    await expect(validateCouncil(teacher(headTeacher), sixA, t1)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expectGradingError(validateCouncil(director(), sixA, t1), "councilNotClosed");
    await closePeriod(director(), sixA, t1);
    await validateCouncil(director(), sixA, t1);

    const council = await getCouncil(director(), sixA, t1);
    expect(council.validatedByName).toBe("Directeur consa");
    // La mention proposée est retenue pour ADA ; celle du conseil pour BOB.
    expect(council.students.map((s) => s.mention)).toEqual(["Encouragements", "Avertissement"]);
    const { rows } = await adminQuery("select 1 from audit_logs where action = 'council.validate'");
    expect(rows).toHaveLength(1);

    await expectGradingError(
      saveSubjectComments(teacher(mathsTeacher), sixA, subject["Mathématiques"], t1, [
        { enrollmentId: pupil.ADA, text: "Modifié" },
      ]),
      "councilValidated",
    );
    await expectGradingError(
      saveCouncil(teacher(headTeacher), sixA, t1, [
        { enrollmentId: pupil.ADA, generalComment: "Modifié" },
      ]),
      "councilValidated",
    );
    await reopenCouncil(director(), sixA, t1);
    await saveCouncil(teacher(headTeacher), sixA, t1, [
      { enrollmentId: pupil.ADA, generalComment: "Excellent trimestre, bravo." },
    ]);
    expect((await getCouncil(director(), sixA, t1)).validatedAt).toBeNull();
  });
});

describe("Conseil de fin d'année", () => {
  it("une décision par élève, après la clôture de la dernière période", async () => {
    const council = await getCouncil(director(), sixA, ANNUAL);
    expect(council.annual).toBe(true);
    expect(council.students.map((s) => [s.average, s.proposedMention])).toEqual([
      [15.57, "Encouragements"],
      [9.43, null],
    ]);
    await saveCouncil(director(), sixA, ANNUAL, [
      { enrollmentId: pupil.ADA, decision: "promoted" },
    ]);
    await closePeriod(director(), sixA, lastPeriod);
    await expectGradingError(validateCouncil(director(), sixA, ANNUAL), "decisionMissing");
    await saveCouncil(director(), sixA, ANNUAL, [{ enrollmentId: pupil.BOB, decision: "repeat" }]);
    await validateCouncil(director(), sixA, ANNUAL);
    const done = await getCouncil(director(), sixA, ANNUAL);
    expect(done.students.map((s) => [s.decision, s.mention])).toEqual([
      ["promoted", "Encouragements"],
      ["repeat", ""],
    ]);
  });
});
