// Phase 4, sous-étape 4b — espace parents : frais et reçus, bulletins publiés (option de blocage B7),
// absences ; un parent ne lit jamais les données d'un autre enfant.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/server/auth/permissions";
import { requestParentCode, verifyParentCode } from "@/server/auth/parent";
import { closeDb } from "@/server/db/client";
import { FakeSmsProvider } from "@/server/sms";
import { checkDocumentRequest, renderDocument } from "@/modules/documents/documents";
import { closePdfBrowser } from "@/modules/documents/pdf";
import { setBulletinBlocking } from "@/modules/finance/invoices";
import {
  getChildAccount,
  getChildAttendance,
  getChildBulletins,
  getPublishedBulletin,
} from "@/modules/parents/child";
import { addDefaultLevels, listLevels } from "@/modules/settings/levels";
import { createTimeSlot } from "@/modules/settings/time-slots";
import { activateYear, createYear } from "@/modules/settings/years";
import { preEnroll } from "@/modules/students/enrollments";
import { createStudent } from "@/modules/students/students";
import { adminQuery, createSchoolWithDirector, createSuperadmin, resetDatabase } from "./helpers";

type School = { schoolId: string; directorId: string };
let a: School;
let year: string;
let parent: Principal;
let otherPayment: string;
let adaPayment: string;
let publishedCard: string;
const kid: Record<string, string> = {};
const director = (): Principal => ({
  userId: a.directorId,
  schoolId: a.schoolId,
  roles: ["director"],
  isSuperadmin: false,
});

const bulletin = (name: string) => ({
  version: 1,
  enrollmentId: kid[name],
  yearLabel: "2026-2027",
  className: "6e A",
  levelName: "6e",
  headTeacherName: null,
  classSize: 2,
  annual: false,
  periodLabel: "1er trimestre",
  scale: 20,
  student: {
    matricule: `X-${name}`,
    lastName: name,
    firstNames: "Test",
    sex: "F",
    birthDate: null,
  },
  subjects: [],
  totalCoefficients: 0,
  totalPoints: 0,
  periods: [],
  average: 12.5,
  rank: 1,
  tied: false,
  mention: "Tableau d'honneur",
  classStats: { average: 11, highest: 12.5, lowest: 9.5 },
  generalComment: "Bon trimestre.",
  attendance: { absences: 1, unjustified: 1, lates: 1 },
  decision: null,
  councilDate: null,
});

async function payment(name: string, amount: number, invoiceId: string, receipt: string) {
  const { rows } = await adminQuery<{ id: string }>(
    `insert into payments (school_id, academic_year_id, enrollment_id, amount, method, receipt_number, cashier_id)
     values ($1, $2, $3, $4, 'cash', $5, $6) returning id`,
    [a.schoolId, year, kid[name], amount, receipt, a.directorId],
  );
  await adminQuery(
    "insert into payment_allocations (school_id, payment_id, invoice_id, amount) values ($1, $2, $3, $4)",
    [a.schoolId, rows[0].id, invoiceId, amount],
  );
  return rows[0].id;
}

async function invoice(name: string, fee: string, amount: number, due: string) {
  const { rows } = await adminQuery<{ id: string }>(
    `insert into invoices (school_id, academic_year_id, enrollment_id, fee_name, kind, mandatory,
       installment_number, installment_count, amount, due_date)
     values ($1, $2, $3, $4, 'tuition', true, 1, 1, $5, $6) returning id`,
    [a.schoolId, year, kid[name], fee, amount, due],
  );
  return rows[0].id;
}

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  a = await createSchoolWithDirector(superadminId, "espacea");
  await addDefaultLevels(director(), "college");
  const level = (await listLevels(director()))[0].id;
  year = await createYear(director(), {
    label: "2026-2027",
    startDate: "2026-10-01",
    endDate: "2027-06-30",
    periodKind: "trimester",
  });
  await activateYear(director(), year);
  for (const [name, phone] of [
    ["ADA", "06 610 00 01"],
    ["BOB", "06 610 00 02"],
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
      guardian: { fullName: `Parent ${name}`, phone, otherPhone: "", relationship: "" },
    });
    kid[name] = await preEnroll(director(), {
      studentId: s.id,
      academicYearId: year,
      levelId: level,
    });
  }
  // ADA : 50 000 échus (payés 20 000), 50 000 à venir. BOB : une échéance payée.
  const overdue = await invoice("ADA", "Scolarité T1", 50_000, "2026-10-15");
  await invoice("ADA", "Scolarité T2", 50_000, "2027-01-15");
  adaPayment = await payment("ADA", 20_000, overdue, "ESP-2026-00001");
  otherPayment = await payment(
    "BOB",
    30_000,
    await invoice("BOB", "Scolarité T1", 30_000, "2026-10-15"),
    "ESP-2026-00002",
  );
  // Bulletins : un publié, un non publié (ADA) ; un publié pour BOB.
  const period = (
    await adminQuery<{ id: string }>(
      "select id from periods where academic_year_id = $1 order by position limit 1",
      [year],
    )
  ).rows[0].id;
  const card = async (name: string, published: boolean, periodId: string | null) =>
    (
      await adminQuery<{ id: string }>(
        `insert into report_cards (school_id, academic_year_id, enrollment_id, kind, period_id,
           council_validated_at, council_validated_by, published_at, published_by, snapshot)
         values ($1, $2, $3, $4, $5, now(), $6, ${published ? "now()" : "null"}, ${published ? "$6" : "null"}, $7)
         returning id`,
        [
          a.schoolId,
          year,
          kid[name],
          periodId ? "period" : "annual",
          periodId,
          a.directorId,
          published ? bulletin(name) : null,
        ],
      )
    ).rows[0].id;
  publishedCard = await card("ADA", true, period);
  await card("ADA", false, null);
  await card("BOB", true, period);
  // Appel : ADA absente (non justifiée) et en retard.
  const slot = await createTimeSlot(director(), {
    label: "Matin",
    startTime: "07:30",
    endTime: "12:30",
  });
  for (const [date, status] of [
    ["2026-11-10", "absent"],
    ["2026-11-12", "late"],
  ]) {
    await adminQuery(
      `insert into attendance (school_id, academic_year_id, enrollment_id, date, time_slot_id, status, recorded_by)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [a.schoolId, year, kid.ADA, date, slot, status, a.directorId],
    );
  }
  // Le parent d'ADA se connecte (code SMS).
  const sms = new FakeSmsProvider();
  const t0 = new Date("2026-11-23T08:00:00Z");
  await requestParentCode("06 610 00 01", sms, t0);
  const result = await verifyParentCode("06 610 00 01", sms.sent[0].body.match(/\d{6}/)![0], t0);
  if (!result.ok) throw new Error("connexion parent impossible");
  parent = result.principal;
});

afterAll(async () => {
  await closePdfBrowser();
  await closeDb();
});

describe("Frais et reçus", () => {
  it("reste à payer, dont échu ; échéances et reçus de son enfant", async () => {
    const account = await getChildAccount(parent, kid.ADA);
    expect(account).toMatchObject({ remaining: 80_000, overdue: 30_000 });
    expect(account.invoices.map((i) => [i.feeName, i.remaining])).toEqual([
      ["Scolarité T1", 30_000],
      ["Scolarité T2", 50_000],
    ]);
    expect(account.payments.map((p) => p.receiptNumber)).toEqual(["ESP-2026-00001"]);
  });

  it("jamais les comptes d'un autre enfant", async () => {
    await expect(getChildAccount(parent, kid.BOB)).rejects.toThrow();
    await expect(
      checkDocumentRequest(parent, { kind: "receipt", paymentId: otherPayment, format: "A5" }),
    ).rejects.toThrow();
  });

  it("reçu PDF de son enfant", async () => {
    const pdf = await renderDocument({
      schoolId: a.schoolId,
      userId: parent.userId,
      request: { kind: "receipt", paymentId: adaPayment, format: "A5" },
    });
    expect(pdf.fileName).toBe("recu-ESP-2026-00001.pdf");
  }, 60_000);
});

describe("Bulletins publiés", () => {
  it("seulement les bulletins publiés, en PDF", async () => {
    const data = await getChildBulletins(parent, kid.ADA);
    expect(data).toMatchObject({ blocked: false });
    expect(data.bulletins.map((b) => b.label)).toEqual(["1er trimestre"]);
    const pdf = await renderDocument({
      schoolId: a.schoolId,
      userId: parent.userId,
      request: { kind: "bulletin", reportCardId: publishedCard },
    });
    expect(pdf.fileName).toBe("bulletin-X-ADA-1er-trimestre.pdf");
    expect(Buffer.from(pdf.pdfBase64, "base64").subarray(0, 4).toString()).toBe("%PDF");
  }, 60_000);

  it("option de blocage (B7) : cachés tant qu'une échéance échue reste impayée", async () => {
    await setBulletinBlocking(director(), true);
    expect(await getChildBulletins(parent, kid.ADA)).toEqual({ bulletins: [], blocked: true });
    expect(await getPublishedBulletin(parent, publishedCard)).toBeNull();
    // Le solde de l'échéance échue est réglé : le bulletin redevient visible.
    const overdue = (
      await adminQuery<{ id: string }>(
        "select id from invoices where fee_name = 'Scolarité T1' and enrollment_id = $1",
        [kid.ADA],
      )
    ).rows[0].id;
    await payment("ADA", 30_000, overdue, "ESP-2026-00003");
    expect((await getChildBulletins(parent, kid.ADA)).blocked).toBe(false);
    expect(await getPublishedBulletin(parent, publishedCard)).not.toBeNull();
    await setBulletinBlocking(director(), false);
  });
});

describe("Absences", () => {
  it("totaux de l'année et dernières absences, justifiées ou non", async () => {
    const data = await getChildAttendance(parent, kid.ADA);
    expect(data).toMatchObject({ absences: 1, unjustified: 1, lates: 1 });
    expect(data.recent.map((r) => [r.date, r.status, r.justified])).toEqual([
      ["2026-11-12", "late", false],
      ["2026-11-10", "absent", false],
    ]);
    expect((await getChildAttendance(parent, kid.BOB)).recent).toEqual([]);
  });
});
