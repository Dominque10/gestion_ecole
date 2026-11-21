// M2 (2b) — inscriptions : préinscription → validée → classe ; effectif ; départs ; vue enseignant.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type MembershipRole, type Principal } from "@/server/auth/permissions";
import { closeDb, withSchool } from "@/server/db/client";
import { enrollments } from "@/server/db/schema";
import { assignTeachers, createClass, getClass, updateClass } from "@/modules/settings/classes";
import { addDefaultGrid } from "@/modules/settings/coefficients";
import { addDefaultLevels, listLevels } from "@/modules/settings/levels";
import { addStaff } from "@/modules/settings/staff";
import { activateYear, createYear } from "@/modules/settings/years";
import {
  assignClass,
  changeEnrollmentLevel,
  classOptions,
  listStudentEnrollments,
  preEnroll,
  recordDeparture,
  validateEnrollment,
} from "@/modules/students/enrollments";
import { StudentError } from "@/modules/students/errors";
import { createStudent, getStudent, searchStudents } from "@/modules/students/students";
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

async function expectStudentError(promise: Promise<unknown>, code: StudentError["code"]) {
  await expect(promise).rejects.toSatisfy(
    (e: unknown) => e instanceof StudentError && e.code === code,
  );
}

const year = (label: string, start: number) => ({
  label,
  startDate: `${start}-10-01`,
  endDate: `${start + 1}-06-30`,
  periodKind: "trimester" as const,
});

let y1: string;
let sixieme: string;
let cinquieme: string;
let sixA: string;
let sixB: string;
let teacherId: string;
const kids: string[] = [];

async function newStudent(name: string, phone: string) {
  const s = await createStudent(director(), {
    student: {
      lastName: name,
      firstNames: "Test",
      sex: "M",
      birthDate: "",
      birthPlace: "",
      nationality: "",
      previousSchool: "",
    },
    guardian: { fullName: "Parent", phone, otherPhone: "", relationship: "" },
  });
  return s.id;
}

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  a = await createSchoolWithDirector(superadminId, "inscra");
  b = await createSchoolWithDirector(superadminId, "inscrb");
  await addDefaultLevels(director(), "college");
  const levels = await listLevels(director());
  sixieme = levels.find((l) => l.name === "6e")!.id;
  cinquieme = levels.find((l) => l.name === "5e")!.id;
  y1 = await createYear(director(), year("2026-2027", 2026));
  await addDefaultGrid(director(), { academicYearId: y1, levelId: sixieme, series: "" });
  teacherId = (
    await addStaff(director(), {
      name: "Enseignant",
      identifier: "05 888 00 01",
      password: "Provisoire-2026",
      roles: ["teacher"],
    })
  ).userId;
  sixA = await createClass(director(), y1, {
    levelId: sixieme,
    series: "",
    name: "6e A",
    capacity: "2",
    headTeacherId: "",
  });
  sixB = await createClass(director(), y1, {
    levelId: sixieme,
    series: "",
    name: "6e B",
    capacity: "",
    headTeacherId: "",
  });
  for (let i = 0; i < 4; i++) kids.push(await newStudent(`ELEVE${i}`, `06 700 10 0${i}`));
});

afterAll(async () => {
  await closeDb();
});

describe("Parcours d'inscription", () => {
  let enrollment: string;

  it("préinscription au niveau demandé, puis changement de niveau tant qu'elle n'est pas validée", async () => {
    enrollment = await preEnroll(director(), {
      studentId: kids[0],
      academicYearId: y1,
      levelId: cinquieme,
    });
    await changeEnrollmentLevel(director(), enrollment, sixieme);
    const [e] = await listStudentEnrollments(director(), kids[0]);
    expect(e).toMatchObject({
      status: "pre_enrolled",
      levelName: "6e",
      className: null,
      validationMode: null,
    });
  });

  it("une seule inscription par élève et par année", async () => {
    await expectStudentError(
      preEnroll(director(), { studentId: kids[0], academicYearId: y1, levelId: sixieme }),
      "alreadyEnrolled",
    );
  });

  it("pas de classe avant la validation ; validation manuelle tracée", async () => {
    await expectStudentError(assignClass(director(), enrollment, sixA), "notEnrolled");
    // Validation manuelle : exception réservée au directeur depuis la caisse (décision A3).
    await expect(
      validateEnrollment({ ...director(), roles: ["secretary"] }, enrollment),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await validateEnrollment(director(), enrollment);
    await expectStudentError(
      changeEnrollmentLevel(director(), enrollment, cinquieme),
      "notPreEnrolled",
    );
    await expectStudentError(validateEnrollment(director(), enrollment), "notPreEnrolled");
    const [e] = await listStudentEnrollments(director(), kids[0]);
    expect(e).toMatchObject({ status: "enrolled", validationMode: "manual" });
    const { rows } = await adminQuery(
      "select 1 from audit_logs where action = 'enrollment.validate' and entity_id = $1",
      [enrollment],
    );
    expect(rows).toHaveLength(1);
  });

  it("affectation en classe du bon niveau ; effectif maximal respecté", async () => {
    await assignClass(director(), enrollment, sixA);
    const others: string[] = [];
    for (const kid of kids.slice(1, 3)) {
      const id = await preEnroll(director(), {
        studentId: kid,
        academicYearId: y1,
        levelId: sixieme,
      });
      await validateEnrollment(director(), id);
      others.push(id);
    }
    await assignClass(director(), others[0], sixA);
    await expectStudentError(assignClass(director(), others[1], sixA), "classFull");
    await assignClass(director(), others[1], sixB);
    expect(
      (await classOptions(director(), y1, sixieme)).map((c) => [c.name, c.enrolled, c.capacity]),
    ).toEqual([
      ["6e A", 2, 2],
      ["6e B", 1, null],
    ]);
    // Rester dans sa propre classe ne compte pas comme une place de plus.
    await assignClass(director(), others[0], sixA);
  });

  it("refuse une classe d'un autre niveau ou d'une autre année", async () => {
    const id = await preEnroll(director(), {
      studentId: kids[3],
      academicYearId: y1,
      levelId: cinquieme,
    });
    await validateEnrollment(director(), id);
    await expectStudentError(assignClass(director(), id, sixB), "classWrongLevel");
    await expect(
      withSchool({ schoolId: a.schoolId, userId: a.directorId }, (tx) =>
        tx.insert(enrollments).values({
          schoolId: b.schoolId,
          studentId: kids[3],
          academicYearId: y1,
          levelId: sixieme,
          entryDate: "2026-10-01",
        }),
      ),
    ).rejects.toThrow();
  });

  it("départ (exclusion) : motif et date, tracé ; la classe reste dans l'historique et libère la place", async () => {
    await expectStudentError(
      recordDeparture(director(), enrollment, {
        reason: "expulsion",
        date: "2020-01-01",
        note: "",
      }),
      "exitBeforeEntry",
    );
    await recordDeparture(director(), enrollment, {
      reason: "expulsion",
      date: "2099-01-15",
      note: "Conseil de discipline",
    });
    const [e] = await listStudentEnrollments(director(), kids[0]);
    expect(e).toMatchObject({
      status: "left",
      exitReason: "expulsion",
      className: "6e A",
      exitNote: "Conseil de discipline",
    });
    await expectStudentError(
      recordDeparture(director(), enrollment, { reason: "dropout", date: "2099-01-16", note: "" }),
      "alreadyLeft",
    );
    expect((await classOptions(director(), y1, sixieme))[0].enrolled).toBe(1);
  });

  it("une préinscription peut partir sans avoir été validée", async () => {
    const y2 = await createYear(director(), year("2027-2028", 2027));
    const id = await preEnroll(director(), {
      studentId: kids[1],
      academicYearId: y2,
      levelId: cinquieme,
    });
    await recordDeparture(director(), id, { reason: "transfer", date: "2099-09-01", note: "" });
    const rows = await listStudentEnrollments(director(), kids[1]);
    expect(rows.map((r) => [r.yearLabel, r.status, r.validationMode])).toEqual([
      ["2027-2028", "left", null],
      ["2026-2027", "enrolled", "manual"],
    ]);
  });

  it("les inscriptions ne se suppriment jamais (la base l'interdit)", async () => {
    await expect(
      withSchool({ schoolId: a.schoolId, userId: a.directorId }, (tx) => tx.delete(enrollments)),
    ).rejects.toThrow();
  });
});

describe("Vue de l'enseignant (ses classes seulement)", () => {
  const teacher = (): Principal => ({
    userId: teacherId,
    schoolId: a.schoolId,
    roles: ["teacher"],
    isSuperadmin: false,
  });

  it("sans affectation, il ne voit personne ; affecté en 6e B, il voit l'élève de la 6e B", async () => {
    expect(await searchStudents(teacher(), "")).toEqual([]);
    const sixBClass = await getClass(director(), sixB);
    await assignTeachers(director(), sixB, [
      { subjectId: sixBClass.subjects[0].subjectId, teacherId },
    ]);
    const visible = await searchStudents(teacher(), "");
    expect(visible.map((s) => s.lastName)).toEqual(["ELEVE2"]);
    await expect(getStudent(teacher(), kids[2])).resolves.toMatchObject({ lastName: "ELEVE2" });
    await expectStudentError(getStudent(teacher(), kids[1]), "notFound");
    await expectStudentError(listStudentEnrollments(teacher(), kids[1]), "notFound");
  });

  it("professeur principal de la 6e A, il voit aussi ses élèves ; plus rien quand l'année est archivée", async () => {
    await updateClass(director(), sixA, {
      levelId: sixieme,
      series: "",
      name: "6e A",
      capacity: "2",
      headTeacherId: teacherId,
    });
    expect((await searchStudents(teacher(), "")).map((s) => s.lastName).sort()).toEqual([
      "ELEVE1",
      "ELEVE2",
    ]);
    await activateYear(director(), y1);
    const years = await adminQuery<{ id: string }>(
      "select id from academic_years where label = '2027-2028' and school_id = $1",
      [a.schoolId],
    );
    await activateYear(director(), years.rows[0].id);
    expect(await searchStudents(teacher(), "")).toEqual([]);
  });
});

describe("Droits et isolation", () => {
  it("seuls direction et secrétariat préinscrivent et valident", async () => {
    for (const role of ["accountant", "teacher", "parent", "support"] as const) {
      await expect(
        preEnroll(as(a, role), { studentId: kids[3], academicYearId: y1, levelId: sixieme }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("une école ne voit ni ne modifie les inscriptions d'une autre", async () => {
    await expectStudentError(listStudentEnrollments(as(b, "director"), kids[0]), "notFound");
    await expectStudentError(
      preEnroll(as(b, "director"), { studentId: kids[3], academicYearId: y1, levelId: sixieme }),
      "notFound",
    );
    expect(await classOptions(as(b, "director"), y1, sixieme)).toEqual([]);
  });
});
