// 2f — listes de classe, cartes scolaires, certificats : droits et production.
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type Principal } from "@/server/auth/permissions";
import { closeDb } from "@/server/db/client";
import { DOCUMENTS_QUEUE, JOB_SCHEMA } from "@/server/db/setup";
import { closeJobQueue } from "@/server/jobs";
import { renderDocument } from "@/modules/documents/documents";
import { closePdfBrowser } from "@/modules/documents/pdf";
import { documentFile, documentStatus, requestDocument } from "@/modules/documents/requests";
import { assignTeachers, createClass, getClass } from "@/modules/settings/classes";
import { addDefaultGrid } from "@/modules/settings/coefficients";
import { addDefaultLevels, listLevels } from "@/modules/settings/levels";
import { addStaff } from "@/modules/settings/staff";
import { createYear } from "@/modules/settings/years";
import {
  assignClass,
  getClassRoster,
  preEnroll,
  recordDeparture,
  validateEnrollment,
  visibleClasses,
} from "@/modules/students/enrollments";
import { createStudent } from "@/modules/students/students";
import { createSchoolWithDirector, createSuperadmin, resetDatabase, setEntryDate } from "./helpers";

let director: Principal;
let secretary: Principal;
let teacher: Principal;
let sixA: string;
let sixB: string;
let enrolledId: string;
let leftId: string;
let worker: PgBoss;

async function produce(principal: Principal, request: Parameters<typeof requestDocument>[1]) {
  const jobId = await requestDocument(principal, request);
  for (let i = 0; i < 60; i++) {
    const status = await documentStatus(principal, jobId);
    if (status?.state === "ready") return documentFile(principal, jobId);
    if (status?.state === "failed") throw new Error("échec du document");
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("document jamais prêt");
}

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  const a = await createSchoolWithDirector(superadminId, "listedoc");
  director = {
    userId: a.directorId,
    schoolId: a.schoolId,
    roles: ["director"],
    isSuperadmin: false,
  };
  secretary = { ...director, roles: ["secretary"] };
  const teacherId = (
    await addStaff(director, {
      name: "Enseignant",
      identifier: "05 760 00 01",
      password: "Provisoire-2026",
      roles: ["teacher"],
    })
  ).userId;
  teacher = { userId: teacherId, schoolId: a.schoolId, roles: ["teacher"], isSuperadmin: false };
  await addDefaultLevels(director, "college");
  const sixieme = (await listLevels(director)).find((l) => l.name === "6e")!.id;
  const y1 = await createYear(director, {
    label: "2026-2027",
    startDate: "2026-10-01",
    endDate: "2027-06-30",
    periodKind: "trimester",
  });
  await addDefaultGrid(director, { academicYearId: y1, levelId: sixieme, series: "" });
  sixA = await createClass(director, y1, {
    levelId: sixieme,
    series: "",
    name: "6e A",
    capacity: "",
    headTeacherId: "",
  });
  sixB = await createClass(director, y1, {
    levelId: sixieme,
    series: "",
    name: "6e B",
    capacity: "",
    headTeacherId: "",
  });
  const [firstSubject] = (await getClass(director, sixA)).subjects;
  await assignTeachers(director, sixA, [{ subjectId: firstSubject.subjectId, teacherId }]);
  const ids: string[] = [];
  for (const [i, name] of ["ADA", "BOB", "CHLOE"].entries()) {
    const s = await createStudent(director, {
      student: {
        lastName: name,
        firstNames: "Test",
        sex: i === 1 ? "M" : "F",
        birthDate: "2014-03-12",
        birthPlace: "Brazzaville",
        nationality: "",
        previousSchool: "",
      },
      guardian: { fullName: "Parent", phone: `06 760 10 0${i}`, otherPhone: "", relationship: "" },
    });
    const e = await preEnroll(director, { studentId: s.id, academicYearId: y1, levelId: sixieme });
    await validateEnrollment(director, e);
    await assignClass(director, e, i < 2 ? sixA : sixB);
    ids.push(e);
  }
  enrolledId = ids[0];
  leftId = ids[2];
  await setEntryDate(leftId, "2026-10-01");
  await recordDeparture(director, leftId, { reason: "transfer", date: "2026-12-20", note: "" });

  worker = new PgBoss({
    connectionString: process.env.DATABASE_URL!,
    schema: JOB_SCHEMA,
    migrate: false,
    schedule: false,
  });
  worker.on("error", () => undefined);
  await worker.start();
  await worker.work(DOCUMENTS_QUEUE, { batchSize: 1, pollingIntervalSeconds: 0.5 }, async ([job]) =>
    renderDocument(job.data),
  );
}, 60_000);

afterAll(async () => {
  await worker?.stop({ graceful: false });
  await closeJobQueue();
  await closePdfBrowser();
  await closeDb();
});

describe("Classes visibles et listes", () => {
  it("la direction voit toutes les classes avec élèves ; l'enseignant les siennes", async () => {
    expect((await visibleClasses(secretary)).map((c) => [c.name, c.count])).toEqual([["6e A", 2]]);
    expect((await visibleClasses(teacher)).map((c) => c.name)).toEqual(["6e A"]);
    expect((await getClassRoster(teacher, sixA)).students.map((s) => s.lastName)).toEqual([
      "ADA",
      "BOB",
    ]);
    await expect(getClassRoster(teacher, sixB)).rejects.toThrow();
  });

  it("liste de classe en PDF, pour l'enseignant de la classe", async () => {
    const file = await produce(teacher, { kind: "class_list", classId: sixA });
    expect(file?.fileName).toBe("liste-6e-A.pdf");
    expect(file?.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    await expect(requestDocument(teacher, { kind: "class_list", classId: sixB })).rejects.toThrow();
  }, 60_000);

  it("cartes scolaires : secrétariat oui, enseignant non", async () => {
    const file = await produce(secretary, { kind: "student_cards", classId: sixA });
    expect(file?.fileName).toBe("cartes-6e-A.pdf");
    await expect(
      requestDocument(teacher, { kind: "student_cards", classId: sixA }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  }, 60_000);
});

describe("Certificats", () => {
  it("scolarité pour un inscrit, radiation pour un élève parti ; pas l'inverse", async () => {
    const schooling = await produce(secretary, {
      kind: "certificate",
      enrollmentId: enrolledId,
      type: "schooling",
    });
    expect(schooling?.fileName).toMatch(/^certificat-scolarite-LISTEDOC-\d{2}-00001\.pdf$/);
    const radiation = await produce(director, {
      kind: "certificate",
      enrollmentId: leftId,
      type: "radiation",
    });
    expect(radiation?.fileName).toMatch(/^certificat-radiation-/);
    await expect(
      requestDocument(director, {
        kind: "certificate",
        enrollmentId: enrolledId,
        type: "radiation",
      }),
    ).rejects.toThrow();
    await expect(
      requestDocument(director, { kind: "certificate", enrollmentId: leftId, type: "schooling" }),
    ).rejects.toThrow();
  }, 60_000);

  it("ni l'enseignant ni la comptabilité ne délivrent de certificat", async () => {
    for (const p of [teacher, { ...director, roles: ["accountant"] } as Principal]) {
      await expect(
        requestDocument(p, { kind: "certificate", enrollmentId: enrolledId, type: "schooling" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});
