// Phase 4, sous-étape 4g — exports Excel et PDF des listes : contenu de chaque liste, droits (on
// n'exporte que ce qu'on peut voir à l'écran), PDF produit par le worker.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type MembershipRole, type Principal } from "@/server/auth/permissions";
import { closeDb } from "@/server/db/client";
import { checkDocumentRequest, renderDocument } from "@/modules/documents/documents";
import { closePdfBrowser } from "@/modules/documents/pdf";
import { buildExport, ExportError, exportChoices } from "@/modules/exports/lists";
import { createAssessment, saveGrades } from "@/modules/grading/assessments";
import { GradingError } from "@/modules/grading/errors";
import { createClass } from "@/modules/settings/classes";
import { addDefaultGrid, saveGrid } from "@/modules/settings/coefficients";
import { addDefaultLevels, listLevels, listSubjects } from "@/modules/settings/levels";
import { addStaff } from "@/modules/settings/staff";
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
let teacher: Principal;
let year: string;
const level: Record<string, string> = {};
const cls: Record<string, string> = {};
const subject: Record<string, string> = {};
const kid: Record<string, string> = {};
const period: string[] = [];

async function expectError(promise: Promise<unknown>, check: (e: unknown) => boolean) {
  await expect(promise).rejects.toSatisfy(check);
}

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  a = await createSchoolWithDirector(superadminId, "export");
  await addDefaultLevels(director(), "college");
  for (const l of await listLevels(director())) level[l.name] = l.id;
  year = await createYear(director(), {
    label: "2026-2027",
    startDate: "2026-10-01",
    endDate: "2027-06-30",
    periodKind: "trimester",
  });
  for (const lvl of ["6e", "5e"]) {
    await addDefaultGrid(director(), { academicYearId: year, levelId: level[lvl], series: "" });
  }
  for (const s of await listSubjects(director())) subject[s.name] = s.id;
  await saveGrid(director(), { academicYearId: year, levelId: level["6e"], series: "" }, [
    { subjectId: subject["Mathématiques"], coefficient: 4 },
    { subjectId: subject["Français"], coefficient: 3 },
  ]);
  const teacherId = (
    await addStaff(director(), {
      name: "Prof principal",
      identifier: "05 888 40 01",
      password: "Provisoire-2026",
      roles: ["teacher"],
    })
  ).userId;
  teacher = { userId: teacherId, schoolId: a.schoolId, roles: ["teacher"], isSuperadmin: false };
  for (const [name, lvl, head] of [
    ["6e A", "6e", ""],
    ["5e A", "5e", teacherId],
  ]) {
    cls[name] = await createClass(director(), year, {
      levelId: level[lvl],
      series: "",
      name,
      capacity: "40",
      headTeacherId: head,
    });
  }
  await activateYear(director(), year);
  const ids = await adminQuery<{ id: string }>(
    "select id from periods where academic_year_id = $1 order by position",
    [year],
  );
  period.push(...ids.rows.map((r) => r.id));
  for (const [name, sex, lvl, className, phone] of [
    ["ADA", "F", "6e", "6e A", "06 660 00 01"],
    ["BOB", "M", "6e", "6e A", "06 660 00 02"],
    ["CHLOE", "F", "5e", "5e A", "06 660 00 03"],
  ] as const) {
    const s = await createStudent(director(), {
      student: {
        lastName: name,
        firstNames: "Test",
        sex,
        birthDate: "2014-03-02",
        birthPlace: "",
        nationality: "",
        previousSchool: "",
      },
      guardian: { fullName: `Parent ${name}`, phone, otherPhone: "", relationship: "" },
    });
    const e = await preEnroll(director(), {
      studentId: s.id,
      academicYearId: year,
      levelId: level[lvl],
    });
    await validateEnrollment(director(), e);
    await assignClass(director(), e, cls[className]);
    kid[name] = e;
  }

  // Finances : une échéance en retard pour BOB, un paiement et son annulation.
  const invoice = async (who: string, amount: number, due: string) =>
    (
      await adminQuery<{ id: string }>(
        `insert into invoices (school_id, academic_year_id, enrollment_id, fee_name, kind, mandatory,
           installment_number, installment_count, amount, due_date)
         values ($1, $2, $3, 'Scolarité', 'tuition', true, 1, 1, $4, $5) returning id`,
        [a.schoolId, year, kid[who], amount, due],
      )
    ).rows[0].id;
  const adaInvoice = await invoice("ADA", 50000, "2026-10-15");
  await invoice("BOB", 50000, "2026-10-15");
  const pay = async (
    amount: number,
    paidAt: string,
    receipt: string | null,
    reverses: string | null,
  ) =>
    (
      await adminQuery<{ id: string }>(
        `insert into payments (school_id, academic_year_id, enrollment_id, kind, amount, method,
           receipt_number, reverses_id, cashier_id, paid_at, reference)
         values ($1, $2, $3, $4, $5, 'mobile_money', $6, $7, $8, $9::timestamptz, 'MP-' || md5($9::text)) returning id`,
        [
          a.schoolId,
          year,
          kid.ADA,
          reverses ? "reversal" : "payment",
          amount,
          receipt,
          reverses,
          a.directorId,
          paidAt,
        ],
      )
    ).rows[0].id;
  const p1 = await pay(50000, "2026-11-05T09:00:00Z", "EX-0001", null);
  await adminQuery(
    "insert into payment_allocations (school_id, payment_id, invoice_id, amount) values ($1, $2, $3, 50000)",
    [a.schoolId, p1, adaInvoice],
  );
  const p2 = await pay(10000, "2026-11-06T09:00:00Z", "EX-0002", null);
  await pay(-10000, "2026-11-07T09:00:00Z", null, p2);

  // Absences.
  const slot = (
    await adminQuery<{ id: string }>(
      "insert into time_slots (school_id, label, start_time, end_time) values ($1, 'Matin', '07:30', '12:00') returning id",
      [a.schoolId],
    )
  ).rows[0].id;
  for (const [who, date, status, justified] of [
    ["ADA", "2026-11-20", "absent", false],
    ["BOB", "2026-11-20", "late", false],
    ["CHLOE", "2026-11-19", "absent", true],
    ["BOB", "2026-11-18", "present", false],
  ] as const) {
    await adminQuery(
      `insert into attendance (school_id, academic_year_id, enrollment_id, date, time_slot_id, status,
         recorded_by, justified, justification_reason, justified_by, justified_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, case when $8 then $7::uuid end,
         case when $8 then now() end)`,
      [
        a.schoolId,
        year,
        kid[who],
        date,
        slot,
        status,
        a.directorId,
        justified,
        justified ? "Malade" : null,
      ],
    );
  }

  // Résultats : 6e A au 1er trimestre.
  for (const [name, values] of [
    ["Mathématiques", { ADA: "14", BOB: "8" }],
    ["Français", { ADA: "12", BOB: "9" }],
  ] as const) {
    const id = await createAssessment(director(), cls["6e A"], subject[name], {
      periodId: period[0],
      kind: "composition",
      title: "",
      date: "2026-11-05",
      maxScore: 20,
    });
    await saveGrades(
      director(),
      id,
      Object.entries(values).map(([who, value]) => ({
        enrollmentId: kid[who],
        expected: "",
        value,
      })),
    );
  }
}, 60_000);

afterAll(async () => {
  await closePdfBrowser();
  await closeDb();
});

describe("Liste des élèves et des classes", () => {
  it("tous les élèves de l'année avec leur responsable ; filtre par classe", async () => {
    const table = await buildExport(director(), { list: "students", yearId: year });
    expect(table.columns.map((c) => c.header)).toEqual([
      "Matricule",
      "Nom",
      "Prénoms",
      "Sexe",
      "Né(e) le",
      "Niveau",
      "Classe",
      "État",
      "Responsable",
      "Téléphone",
    ]);
    expect(table.rows.map((r) => [r[1], r[3], r[4], r[6], r[7], r[8]])).toEqual([
      ["ADA", "F", "02/03/2014", "6e A", "Inscrit", "Parent ADA"],
      ["BOB", "G", "02/03/2014", "6e A", "Inscrit", "Parent BOB"],
      ["CHLOE", "F", "02/03/2014", "5e A", "Inscrit", "Parent CHLOE"],
    ]);
    expect(table.rows[0][9]).toBe("+242066600001");
    expect(table.fileName).toBe("eleves-2026-2027");
    const sixA = await buildExport(director(), {
      list: "students",
      yearId: year,
      classId: cls["6e A"],
    });
    expect(sixA.rows).toHaveLength(2);
    expect(sixA.subtitle).toContain("Classe 6e A");
    expect(sixA.fileName).toBe("eleves-2026-2027-6e-a");
  });

  it("l'enseignant n'exporte que ses élèves et ses classes ; le parent rien", async () => {
    const mine = await buildExport(teacher, { list: "students", yearId: year });
    expect(mine.rows.map((r) => r[1])).toEqual(["CHLOE"]);
    const classes = await buildExport(teacher, { list: "classes", yearId: year });
    expect(classes.rows.map((r) => r[0])).toEqual(["5e A"]);
    expect((await exportChoices(teacher)).classes.map((c) => c.name)).toEqual(["5e A"]);
    await expectError(
      buildExport(as("parent"), { list: "students", yearId: year }),
      (e) => e instanceof ForbiddenError,
    );
  });

  it("classes : effectifs, filles et garçons, professeur principal, total", async () => {
    const table = await buildExport(as("secretary"), { list: "classes", yearId: year });
    expect(table.rows).toEqual([
      ["6e A", "6e", null, 40, 2, 1, 1],
      ["5e A", "5e", "Prof principal", 40, 1, 1, 0],
    ]);
    expect(table.totals).toEqual(["Total", null, null, null, 3, 2, 1]);
  });
});

describe("Listes financières", () => {
  it("impayés : pour le comptable et le directeur, pas pour le secrétariat", async () => {
    const table = await buildExport(as("accountant"), { list: "arrears", yearId: year });
    expect(table.rows.map((r) => [r[1], r[2], r[3], r[6]])).toEqual([
      ["BOB Test", "6e A", "+242066600002", 50000],
    ]);
    expect(table.totals?.at(-1)).toBe(50000);
    await expectError(
      buildExport(as("secretary"), { list: "arrears", yearId: year }),
      (e) => e instanceof ForbiddenError,
    );
  });

  it("encaissements d'une période, annulations comprises, total net ; un an au plus", async () => {
    const table = await buildExport(as("accountant"), {
      list: "payments",
      from: "2026-11-01",
      to: "2026-11-30",
    });
    expect(table.rows.map((r) => [r[0], r[2], r[6], r[9]])).toEqual([
      ["05/11/2026", "EX-0001", "Mobile money", 50000],
      ["06/11/2026", "EX-0002", "Mobile money", 10000],
      ["07/11/2026", "Annulation du reçu EX-0002", "Mobile money", -10000],
    ]);
    expect(table.totals?.at(-1)).toBe(50000);
    const one = await buildExport(director(), {
      list: "payments",
      from: "2026-11-06",
      to: "2026-11-06",
    });
    expect(one.rows).toHaveLength(1);
    await expectError(
      buildExport(director(), { list: "payments", from: "2025-01-01", to: "2026-11-30" }),
      (e) => e instanceof ExportError && e.code === "dateRange",
    );
    await expectError(
      buildExport(director(), { list: "payments", from: "2026-11-30", to: "2026-11-01" }),
      (e) => e instanceof ExportError && e.code === "dateRange",
    );
    await expectError(
      buildExport(teacher, { list: "payments", from: "2026-11-01", to: "2026-11-30" }),
      (e) => e instanceof ForbiddenError,
    );
  });
});

describe("Absences et résultats", () => {
  it("absences et retards, justifiés ou non, dans l'ordre des dates", async () => {
    const table = await buildExport(as("secretary"), {
      list: "absences",
      from: "2026-11-01",
      to: "2026-11-30",
    });
    expect(table.rows).toEqual([
      ["19/11/2026", "CHLOE Test", "5e A", "Matin", "Absence", "Oui", "Malade"],
      ["20/11/2026", "ADA Test", "6e A", "Matin", "Absence", "Non", null],
      ["20/11/2026", "BOB Test", "6e A", "Matin", "Retard", "Non", null],
    ]);
    const sixA = await buildExport(director(), {
      list: "absences",
      from: "2026-11-01",
      to: "2026-11-30",
      classId: cls["6e A"],
    });
    expect(sixA.rows).toHaveLength(2);
    await expectError(
      buildExport(as("accountant"), { list: "absences", from: "2026-11-01", to: "2026-11-30" }),
      (e) => e instanceof ForbiddenError,
    );
  });

  it("résultats d'une période (par rang, moyennes par matière) et de l'année", async () => {
    const table = await buildExport(director(), {
      list: "results",
      classId: cls["6e A"],
      periodKey: period[0],
    });
    expect(table.columns.map((c) => c.header)).toEqual([
      "Rang",
      "Matricule",
      "Nom et prénoms",
      "Mathématiques (coef. 4)",
      "Français (coef. 3)",
      "Moyenne /20",
      "Mention",
    ]);
    expect(table.rows.map((r) => [r[0], r[2], r[3], r[4], r[5]])).toEqual([
      ["1er", "ADA Test", 14, 12, 13.14],
      ["2e", "BOB Test", 8, 9, 8.43],
    ]);
    expect(table.subtitle).toEqual(["Classe 6e A", "1er trimestre"]);
    const annual = await buildExport(director(), {
      list: "results",
      classId: cls["6e A"],
      periodKey: "annee",
    });
    expect(annual.rows.map((r) => [r[0], r[2]])).toEqual([
      ["1er", "ADA Test"],
      ["2e", "BOB Test"],
    ]);
    // L'enseignant, professeur principal de la 5e A seulement.
    await expectError(
      buildExport(teacher, { list: "results", classId: cls["6e A"], periodKey: period[0] }),
      (e) => e instanceof GradingError,
    );
  });
});

describe("PDF", () => {
  it("le worker produit le PDF de la liste, avec les droits relus en base", async () => {
    const request = {
      kind: "export" as const,
      request: { list: "classes" as const, yearId: year },
    };
    expect(await checkDocumentRequest(director(), request)).toBe("classes-2026-2027.pdf");
    const doc = await renderDocument({ schoolId: a.schoolId, userId: a.directorId, request });
    expect(doc.fileName).toBe("classes-2026-2027.pdf");
    expect(Buffer.from(doc.pdfBase64, "base64").subarray(0, 4).toString()).toBe("%PDF");
  }, 60_000);
});
