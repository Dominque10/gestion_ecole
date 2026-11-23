// Phase 3, sous-étape 3e — appel, SMS d'absence au parent, justification.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type MembershipRole, type Principal } from "@/server/auth/permissions";
import { closeDb, withSchool } from "@/server/db/client";
import { attendance } from "@/server/db/schema";
import { closeJobQueue } from "@/server/jobs";
import { FakeSmsProvider } from "@/server/sms";
import { todayInBrazzaville } from "@/lib/dates";
import { AttendanceError } from "@/modules/attendance/errors";
import { justifyDay, listAbsenceDays } from "@/modules/attendance/justify";
import {
  processAbsenceNotice,
  scheduleAbsenceNotice,
  type AbsenceNotice,
} from "@/modules/attendance/notices";
import {
  getRollCall,
  getRollSetup,
  listRollClasses,
  saveRollCall,
  type RollCallKey,
  type RollEntry,
} from "@/modules/attendance/roll";
import { assignTeachers, createClass } from "@/modules/settings/classes";
import { addDefaultGrid } from "@/modules/settings/coefficients";
import { addDefaultLevels, listLevels, listSubjects } from "@/modules/settings/levels";
import { addStaff } from "@/modules/settings/staff";
import { createTimeSlot } from "@/modules/settings/time-slots";
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
const secretary = () => as(a, "secretary");
const teacher = (userId: string): Principal => ({
  userId,
  schoolId: a.schoolId,
  roles: ["teacher"],
  isSuperadmin: false,
});

async function expectAttendanceError(promise: Promise<unknown>, code: AttendanceError["code"]) {
  await expect(promise).rejects.toSatisfy(
    (e: unknown) => e instanceof AttendanceError && e.code === code,
  );
}

let sixA: string;
let sixB: string;
let morning: string;
let afternoon: string;
let mathsTeacher: string;
let mathsCourse: string;
let frenchCourse: string;
const pupil: Record<string, string> = {};
/** SMS programmés pendant les tests (au lieu de la vraie file). */
const scheduled: AbsenceNotice[] = [];
const schedule = async (n: AbsenceNotice) => void scheduled.push(n);

const DAY = "2026-11-20";
const key = (overrides: Partial<RollCallKey> = {}): RollCallKey => ({
  classId: sixA,
  date: DAY,
  slotId: morning,
  ...overrides,
});
const all = (values: Record<string, string>, expected: Record<string, string> = {}): RollEntry[] =>
  Object.entries(values).map(([name, value]) => ({
    enrollmentId: pupil[name],
    expected: expected[name] ?? "",
    value,
  }));

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  a = await createSchoolWithDirector(superadminId, "appela");
  b = await createSchoolWithDirector(superadminId, "appelb");
  await addDefaultLevels(director(), "college");
  const sixieme = (await listLevels(director())).find((l) => l.name === "6e")!.id;
  const year = await createYear(director(), {
    label: "2026-2027",
    startDate: "2026-10-01",
    endDate: "2027-06-30",
    periodKind: "trimester",
  });
  await addDefaultGrid(director(), { academicYearId: year, levelId: sixieme, series: "" });
  // Créé dans le désordre : les créneaux se lisent dans l'ordre de la journée.
  afternoon = await createTimeSlot(director(), {
    label: "Après-midi",
    startTime: "15:00",
    endTime: "18:00",
  });
  morning = await createTimeSlot(director(), {
    label: "Matin",
    startTime: "07:30",
    endTime: "12:30",
  });
  const newClass = (name: string) =>
    createClass(director(), year, {
      levelId: sixieme,
      series: "",
      name,
      capacity: "",
      headTeacherId: "",
    });
  sixA = await newClass("6e A");
  sixB = await newClass("6e B");
  mathsTeacher = (
    await addStaff(director(), {
      name: "Prof Maths",
      identifier: "05 888 30 01",
      password: "Provisoire-2026",
      roles: ["teacher"],
    })
  ).userId;
  const subjects = await listSubjects(director());
  const maths = subjects.find((s) => s.name === "Mathématiques")!.id;
  await assignTeachers(director(), sixA, [{ subjectId: maths, teacherId: mathsTeacher }]);
  await activateYear(director(), year);
  const { rows } = await adminQuery<{ id: string; name: string }>(
    `select cs.id, s.name from class_subjects cs join subjects s on s.id = cs.subject_id
     where cs.class_id = $1`,
    [sixA],
  );
  mathsCourse = rows.find((r) => r.name === "Mathématiques")!.id;
  frenchCourse = rows.find((r) => r.name === "Français")!.id;

  const enrol = async (lastName: string, sex: "M" | "F", phone: string, classId: string) => {
    const s = await createStudent(director(), {
      student: {
        lastName,
        firstNames: "Test",
        sex,
        birthDate: "",
        birthPlace: "",
        nationality: "",
        previousSchool: "",
      },
      guardian: { fullName: `Parent ${lastName}`, phone, otherPhone: "", relationship: "" },
    });
    const e = await preEnroll(director(), {
      studentId: s.id,
      academicYearId: year,
      levelId: sixieme,
    });
    await validateEnrollment(director(), e);
    await assignClass(director(), e, classId);
    return e;
  };
  pupil.ADA = await enrol("ADA", "F", "06 700 40 01", sixA);
  pupil.BOB = await enrol("BOB", "M", "06 700 40 02", sixA);
  pupil.CHLOE = await enrol("CHLOE", "F", "06 700 40 03", sixA);
  pupil.DAVE = await enrol("DAVE", "M", "06 700 40 04", sixB);
});

afterAll(async () => {
  await closeJobQueue();
  await closeDb();
});

describe("Qui fait l'appel de quelle classe", () => {
  it("l'enseignant : ses classes ; la direction et le secrétariat : toutes ; la comptabilité : non", async () => {
    expect((await listRollClasses(teacher(mathsTeacher))).map((c) => c.className)).toEqual([
      "6e A",
    ]);
    expect((await listRollClasses(secretary())).map((c) => c.className)).toEqual(["6e A", "6e B"]);
    await expect(listRollClasses(as(a, "accountant"))).rejects.toBeInstanceOf(ForbiddenError);
    await expectAttendanceError(getRollSetup(teacher(mathsTeacher), sixB), "classNotFound");
  });

  it("de quoi faire l'appel : créneaux dans l'ordre, ses cours, les élèves", async () => {
    const setup = await getRollSetup(teacher(mathsTeacher), sixA);
    expect(setup.slots.map((s) => s.label)).toEqual(["Matin", "Après-midi"]);
    expect(setup.subjects.map((s) => s.name)).toEqual(["Mathématiques"]);
    expect(setup.students.map((s) => s.lastName)).toEqual(["ADA", "BOB", "CHLOE"]);
    expect((await getRollSetup(director(), sixA)).subjects.length).toBeGreaterThan(1);
  });
});

describe("Appel", () => {
  it("présents, absent, retard ; seule l'absence programme le SMS du jour", async () => {
    const result = await saveRollCall(
      teacher(mathsTeacher),
      key({ classSubjectId: mathsCourse }),
      all({ ADA: "present", BOB: "absent", CHLOE: "late" }),
      schedule,
    );
    expect(result).toEqual({ saved: 3, conflicts: [] });
    expect(scheduled).toEqual([
      { schoolId: a.schoolId, userId: mathsTeacher, enrollmentId: pupil.BOB, date: DAY },
    ]);
    const call = await getRollCall(director(), key());
    expect(call).toMatchObject({
      values: { [pupil.ADA]: "present", [pupil.BOB]: "absent", [pupil.CHLOE]: "late" },
      recordedByName: "Prof Maths",
      classSubjectId: mathsCourse,
    });
    expect((await getRollCall(director(), key({ slotId: afternoon }))).values).toEqual({});
  });

  it("refuse une date future, un créneau ou un cours qui ne sont pas les siens, un élève d'une autre classe", async () => {
    const t = teacher(mathsTeacher);
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await expectAttendanceError(
      saveRollCall(t, key({ date: tomorrow }), all({ ADA: "present" }), schedule),
      "dateInvalid",
    );
    await expectAttendanceError(
      saveRollCall(t, key({ date: "2026-09-01" }), all({ ADA: "present" }), schedule),
      "dateInvalid",
    );
    await expectAttendanceError(
      saveRollCall(t, key({ slotId: crypto.randomUUID() }), all({ ADA: "present" }), schedule),
      "slotNotFound",
    );
    await expectAttendanceError(
      saveRollCall(t, key({ classSubjectId: frenchCourse }), all({ ADA: "present" }), schedule),
      "subjectNotFound",
    );
    await expectAttendanceError(
      saveRollCall(t, key(), all({ DAVE: "present" }), schedule),
      "studentNotInClass",
    );
    await expectAttendanceError(
      saveRollCall(t, key(), all({ ADA: "malade" }), schedule),
      "statusInvalid",
    );
  });

  it("une ligne changée entre-temps par quelqu'un d'autre n'est pas écrasée", async () => {
    // Le secrétariat corrige : BOB est finalement arrivé.
    await saveRollCall(secretary(), key(), all({ BOB: "present" }, { BOB: "absent" }), schedule);
    const result = await saveRollCall(
      teacher(mathsTeacher),
      key(),
      all({ BOB: "late", CHLOE: "absent" }, { BOB: "absent", CHLOE: "late" }),
      schedule,
    );
    expect(result).toEqual({
      saved: 1,
      conflicts: [{ enrollmentId: pupil.BOB, current: "present" }],
    });
    expect((await getRollCall(director(), key())).values[pupil.BOB]).toBe("present");
  });

  it("isolation : une autre école ne voit pas l'appel", async () => {
    const seen = await withSchool({ schoolId: b.schoolId, userId: b.directorId }, (tx) =>
      tx.select().from(attendance),
    );
    expect(seen).toHaveLength(0);
  });
});

describe("SMS d'absence (décision D15)", () => {
  const D2 = "2026-11-19";
  const notice = (name: string, date = D2): AbsenceNotice => ({
    schoolId: a.schoolId,
    userId: a.directorId,
    enrollmentId: pupil[name],
    date,
  });

  it("un seul SMS par jour, au responsable principal, avec les créneaux manqués", async () => {
    await saveRollCall(
      director(),
      key({ date: D2 }),
      all({ ADA: "absent", BOB: "present", CHLOE: "late" }),
      schedule,
    );
    await saveRollCall(
      director(),
      key({ date: D2, slotId: afternoon }),
      all({ ADA: "absent" }),
      schedule,
    );
    const sms = new FakeSmsProvider();
    expect(await processAbsenceNotice(notice("ADA"), sms)).toBe("sent");
    expect(sms.sent).toEqual([
      {
        to: "+242067004001",
        body: "École appela : votre enfant ADA Test (6e A) est absente le 19/11/2026 (Matin, Après-midi). Merci de justifier l'absence auprès du secrétariat.",
        ref: expect.stringMatching(/^fake-/),
      },
    ]);
    expect(await processAbsenceNotice(notice("ADA"), sms)).toBe("alreadySent");
    expect(sms.sent).toHaveLength(1);
    // Retard seul : rien.
    expect(await processAbsenceNotice(notice("CHLOE"), sms)).toBe("nothingToSend");
  });

  it("absence corrigée ou justifiée avant l'envoi : rien ne part", async () => {
    const D3 = "2026-11-18";
    await saveRollCall(
      director(),
      key({ date: D3 }),
      all({ ADA: "present", BOB: "absent", CHLOE: "absent" }),
      schedule,
    );
    await saveRollCall(
      director(),
      key({ date: D3 }),
      all({ BOB: "present" }, { BOB: "absent" }),
      schedule,
    );
    await justifyDay(secretary(), { enrollmentId: pupil.CHLOE, date: D3, reason: "Maladie" });
    const sms = new FakeSmsProvider();
    expect(await processAbsenceNotice(notice("BOB", D3), sms)).toBe("nothingToSend");
    expect(await processAbsenceNotice(notice("CHLOE", D3), sms)).toBe("nothingToSend");
    expect(sms.sent).toHaveLength(0);
  });

  it("prestataire en panne : échec noté, nouvel essai réussi", async () => {
    const D4 = "2026-11-17";
    await saveRollCall(director(), key({ date: D4 }), all({ BOB: "absent" }), schedule);
    const sms = new FakeSmsProvider();
    sms.failNext = true;
    await expect(processAbsenceNotice(notice("BOB", D4), sms)).rejects.toThrow(/indisponible/);
    let { rows } = await adminQuery<{ status: string; attempts: number }>(
      "select status, attempts from notifications where enrollment_id = $1 and date = $2",
      [pupil.BOB, D4],
    );
    expect(rows).toEqual([{ status: "failed", attempts: 1 }]);
    expect(await processAbsenceNotice(notice("BOB", D4), sms)).toBe("sent");
    ({ rows } = await adminQuery<{ status: string; attempts: number }>(
      "select status, attempts from notifications where enrollment_id = $1 and date = $2",
      [pupil.BOB, D4],
    ));
    expect(rows).toEqual([{ status: "sent", attempts: 2 }]);
  });

  it("la file ne garde qu'une tâche en attente par élève et par jour, partant 30 min plus tard", async () => {
    const day = todayInBrazzaville();
    await scheduleAbsenceNotice(notice("DAVE", day));
    await scheduleAbsenceNotice(notice("DAVE", day));
    const { rows } = await adminQuery<{ delay: number }>(
      `select extract(epoch from start_after - created_on)::int as delay from pgboss.job
       where name = 'notifications' and singleton_key = $1`,
      [`${pupil.DAVE}:${day}`],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].delay).toBeGreaterThanOrEqual(1790);
  });
});

describe("Justification par le secrétariat", () => {
  const D2 = "2026-11-19";

  it("liste des journées à justifier, avec le SMS envoyé ; réservée à la direction et au secrétariat", async () => {
    const days = await listAbsenceDays(secretary(), { from: "2026-11-01", to: "2026-11-30" });
    const ada = days.find((d) => d.lastName === "ADA" && d.date === D2)!;
    expect(ada.marks.map((m) => [m.slotLabel, m.status, m.justified])).toEqual([
      ["Matin", "absent", false],
      ["Après-midi", "absent", false],
    ]);
    expect(ada.smsSentAt).toBeInstanceOf(Date);
    await expect(
      listAbsenceDays(teacher(mathsTeacher), { from: "2026-11-01", to: "2026-11-30" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("motif obligatoire ; la journée justifiée sort de la liste ; un élève finalement présent n'a plus rien à justifier", async () => {
    await expectAttendanceError(
      justifyDay(secretary(), { enrollmentId: pupil.ADA, date: D2, reason: " " }),
      "reasonInvalid",
    );
    expect(
      await justifyDay(secretary(), {
        enrollmentId: pupil.ADA,
        date: D2,
        reason: "Certificat médical",
      }),
    ).toBe(2);
    await expectAttendanceError(
      justifyDay(secretary(), { enrollmentId: pupil.ADA, date: D2, reason: "Encore" }),
      "absenceNotFound",
    );
    const open = await listAbsenceDays(secretary(), { from: D2, to: D2 });
    expect(open.find((d) => d.lastName === "ADA")).toBeUndefined();
    const withJustified = await listAbsenceDays(secretary(), {
      from: D2,
      to: D2,
      includeJustified: true,
    });
    expect(withJustified.find((d) => d.lastName === "ADA")?.marks[0]).toMatchObject({
      justified: true,
      reason: "Certificat médical",
    });

    // ADA était en fait présente le matin : la justification de cette ligne disparaît.
    await saveRollCall(
      director(),
      key({ date: D2 }),
      all({ ADA: "present" }, { ADA: "absent" }),
      schedule,
    );
    const { rows } = await adminQuery<{ justified: boolean; reason: string | null }>(
      `select justified, justification_reason as reason from attendance
       where enrollment_id = $1 and date = $2 and time_slot_id = $3`,
      [pupil.ADA, D2, morning],
    );
    expect(rows).toEqual([{ justified: false, reason: null }]);
  });
});
