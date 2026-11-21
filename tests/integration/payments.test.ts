// M3 (2d) — caisse : encaissement, affectation, reçus, trop-perçu, validation automatique, annulation.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type Principal } from "@/server/auth/permissions";
import { closeDb, withSchool } from "@/server/db/client";
import { paymentAllocations, payments } from "@/server/db/schema";
import { FinanceError } from "@/modules/finance/errors";
import { grantExceptionalDiscount, listInvoices } from "@/modules/finance/invoices";
import {
  collectPayment,
  decideCancellation,
  getReceipt,
  listPayments,
  listPendingCancellations,
  requestCancellation,
} from "@/modules/finance/payments";
import { saveFee } from "@/modules/settings/fees";
import { addDefaultLevels, listLevels } from "@/modules/settings/levels";
import { activateYear, createYear } from "@/modules/settings/years";
import {
  changeEnrollmentLevel,
  listStudentEnrollments,
  preEnroll,
  recordDeparture,
} from "@/modules/students/enrollments";
import { createStudent } from "@/modules/students/students";
import {
  adminQuery,
  createSchoolWithDirector,
  createSuperadmin,
  resetDatabase,
  setEntryDate,
} from "./helpers";

let director: Principal;
let accountant: Principal;
let other: Principal;
let y1: string;
let sixieme: string;
let cinquieme: string;

async function expectFinanceError(promise: Promise<unknown>, code: FinanceError["code"]) {
  await expect(promise).rejects.toSatisfy(
    (e: unknown) => e instanceof FinanceError && e.code === code,
  );
}

async function enrolled(name: string, phone: string) {
  const s = await createStudent(director, {
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
  return {
    studentId: s.id,
    enrollmentId: await preEnroll(director, {
      studentId: s.id,
      academicYearId: y1,
      levelId: sixieme,
    }),
  };
}

const pay = (
  enrollmentId: string,
  amount: number,
  method: "cash" | "mobile_money" = "cash",
  reference = "",
) => collectPayment(accountant, { enrollmentId, amount, method, reference, note: "" });

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  const a = await createSchoolWithDirector(superadminId, "caissa");
  const b = await createSchoolWithDirector(superadminId, "caissb");
  director = {
    userId: a.directorId,
    schoolId: a.schoolId,
    roles: ["director"],
    isSuperadmin: false,
  };
  accountant = { ...director, roles: ["accountant"] };
  other = {
    userId: b.directorId,
    schoolId: b.schoolId,
    roles: ["accountant"],
    isSuperadmin: false,
  };
  await addDefaultLevels(director, "college");
  const levels = await listLevels(director);
  sixieme = levels.find((l) => l.name === "6e")!.id;
  cinquieme = levels.find((l) => l.name === "5e")!.id;
  y1 = await createYear(director, {
    label: "2026-2027",
    startDate: "2026-10-01",
    endDate: "2027-06-30",
    periodKind: "trimester",
  });
  await saveFee(director, y1, {
    name: "Frais d'inscription",
    kind: "registration",
    mandatory: true,
    levelIds: [sixieme, cinquieme],
    installments: [{ number: 1, amount: 25_000, dueDate: "2026-09-15" }],
  });
  await saveFee(director, y1, {
    name: "Scolarité",
    kind: "tuition",
    mandatory: true,
    levelIds: [sixieme],
    installments: [
      { number: 1, amount: 50_000, dueDate: "2026-10-01" },
      { number: 2, amount: 50_000, dueDate: "2027-01-04" },
    ],
  });
});

afterAll(async () => {
  await closeDb();
});

describe("Encaissement et reçu", () => {
  let kid: { studentId: string; enrollmentId: string };

  it("affecte le paiement aux échéances les plus anciennes et numérote le reçu", async () => {
    kid = await enrolled("PREMIER", "06 730 00 01");
    const result = await pay(kid.enrollmentId, 40_000);
    expect(result.receiptNumber).toBe("CAISSA-2026-00001");
    const invoices = await listInvoices(director, kid.enrollmentId);
    expect(invoices.map((i) => [i.feeName, i.paid, i.remaining])).toEqual([
      ["Frais d'inscription", 25_000, 0],
      ["Scolarité", 15_000, 35_000],
      ["Scolarité", 0, 50_000],
    ]);
  });

  it("les frais d'inscription payés valident l'inscription automatiquement (A3), tracé", async () => {
    const [e] = await listStudentEnrollments(director, kid.studentId);
    expect([e.status, e.validationMode]).toEqual(["enrolled", "payment"]);
    const { rows } = await adminQuery(
      "select after from audit_logs where action = 'enrollment.validate' and entity_id = $1",
      [kid.enrollmentId],
    );
    expect(rows).toEqual([{ after: { mode: "payment" } }]);
  });

  it("le reçu reprend l'élève, le détail par échéance et le reste à payer", async () => {
    const [p] = await listPayments(director, kid.enrollmentId);
    const receipt = await getReceipt(director, p.id);
    expect(receipt).toMatchObject({
      receiptNumber: "CAISSA-2026-00001",
      amount: 40_000,
      method: "cash",
      student: { name: "PREMIER Test", level: "6e", year: "2026-2027" },
      allocations: [
        { label: "Frais d'inscription", amount: 25_000 },
        { label: "Scolarité — tranche 1/2", amount: 15_000 },
      ],
      remainingAfter: 85_000,
      reversed: false,
    });
  });

  it("refuse le trop-perçu, en indiquant le maximum (décision D6)", async () => {
    await expect(pay(kid.enrollmentId, 85_001)).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof FinanceError &&
        e.code === "overpayment" &&
        e.params?.maximum === (85_000).toLocaleString("fr-FR"),
    );
    await pay(kid.enrollmentId, 85_000);
    await expectFinanceError(pay(kid.enrollmentId, 1), "nothingDue");
  });

  it("mobile money : référence obligatoire, jamais enregistrée deux fois", async () => {
    const second = await enrolled("SECOND", "06 730 00 02");
    await expectFinanceError(
      pay(second.enrollmentId, 10_000, "mobile_money", ""),
      "referenceRequired",
    );
    await pay(second.enrollmentId, 10_000, "mobile_money", "MP261121.1530.A12345");
    await expectFinanceError(
      pay(second.enrollmentId, 10_000, "mobile_money", "MP261121.1530.A12345"),
      "duplicateReference",
    );
  });

  it("des encaissements simultanés : reçus continus, sans trou ni doublon", async () => {
    const kids = await Promise.all(
      Array.from({ length: 6 }, (_, i) => enrolled(`SIMUL${i}`, `06 730 10 0${i}`)),
    );
    const results = await Promise.all(kids.map((k) => pay(k.enrollmentId, 5_000)));
    const numbers = results.map((r) => Number(r.receiptNumber.slice(-5))).sort((x, y) => x - y);
    expect(numbers).toEqual([4, 5, 6, 7, 8, 9]);
  });

  it("le paiement n'est jamais modifié ni supprimé (la base l'interdit)", async () => {
    const ctx = { schoolId: director.schoolId!, userId: director.userId };
    await expect(withSchool(ctx, (tx) => tx.update(payments).set({ amount: 1 }))).rejects.toThrow();
    await expect(withSchool(ctx, (tx) => tx.delete(payments))).rejects.toThrow();
    await expect(withSchool(ctx, (tx) => tx.delete(paymentAllocations))).rejects.toThrow();
    await expect(adminQuery("update payments set amount = 1")).rejects.toThrow(/définitif/);
  });

  it("après un paiement, le niveau ne change plus et la remise ne dépasse pas le reste dû", async () => {
    const kid2 = await enrolled("TROISIEME", "06 730 00 03");
    // 10 000 : l'inscription n'est pas soldée, l'élève reste préinscrit.
    await pay(kid2.enrollmentId, 10_000);
    await expectFinanceError(
      changeEnrollmentLevel(director, kid2.enrollmentId, cinquieme),
      "hasPayments",
    );
    const [registration] = await listInvoices(director, kid2.enrollmentId);
    await expectFinanceError(
      grantExceptionalDiscount(director, registration.id, { amount: 15_001, reason: "Trop" }),
      "discountTooLarge",
    );
    await grantExceptionalDiscount(director, registration.id, {
      amount: 15_000,
      reason: "Solde offert",
    });
  });
});

describe("Annulation par écriture inverse (décision D7)", () => {
  let enrollmentId: string;
  let paymentId: string;

  it("le comptable demande l'annulation, avec motif ; une seule demande en attente", async () => {
    enrollmentId = (await enrolled("ANNULE", "06 730 00 04")).enrollmentId;
    paymentId = (await pay(enrollmentId, 30_000)).paymentId;
    await expect(requestCancellation(accountant, paymentId, "")).rejects.toThrow();
    await requestCancellation(accountant, paymentId, "Erreur de saisie : élève voisin");
    await expectFinanceError(
      requestCancellation(accountant, paymentId, "Encore"),
      "cancellationPending",
    );
    const pending = await listPendingCancellations(director);
    expect(pending.map((p) => [p.amount, p.reason, p.studentName])).toEqual([
      [30_000, "Erreur de saisie : élève voisin", "ANNULE Test"],
    ]);
  });

  it("le directeur valide : écriture inverse, échéances rouvertes, reçu marqué annulé", async () => {
    const [request] = await listPendingCancellations(director);
    await decideCancellation(director, request.id, { approve: true, note: "" });
    const lines = await listPayments(director, enrollmentId);
    expect(lines.map((l) => [l.kind, l.amount, l.reversed])).toEqual([
      ["reversal", -30_000, false],
      ["payment", 30_000, true],
    ]);
    expect((await listInvoices(director, enrollmentId)).every((i) => i.paid === 0)).toBe(true);
    expect((await getReceipt(director, paymentId)).reversed).toBe(true);
    await expectFinanceError(
      requestCancellation(accountant, paymentId, "Encore"),
      "alreadyReversed",
    );
    await expectFinanceError(
      decideCancellation(director, request.id, { approve: true, note: "" }),
      "cancellationNotFound",
    );
  });

  it("le directeur peut refuser une demande", async () => {
    const p = await pay(enrollmentId, 5_000);
    const id = await requestCancellation(accountant, p.paymentId, "Doute");
    await decideCancellation(director, id, { approve: false, note: "Paiement vérifié" });
    expect((await listPayments(director, enrollmentId))[0]).toMatchObject({
      reversed: false,
      pendingCancellation: false,
    });
  });

  it("chacun son rôle : le comptable encaisse et demande, le directeur décide", async () => {
    const [anyPayment] = await listPayments(director, enrollmentId);
    await expect(
      collectPayment(director, {
        enrollmentId,
        amount: 1000,
        method: "cash",
        reference: "",
        note: "",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requestCancellation(director, anyPayment.id, "Motif")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(listPendingCancellations(accountant)).rejects.toBeInstanceOf(ForbiddenError);
    for (const role of ["secretary", "teacher", "support"] as const) {
      await expect(
        collectPayment(
          { ...director, roles: [role] },
          { enrollmentId, amount: 1000, method: "cash", reference: "", note: "" },
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("Départ, isolation, années archivées", () => {
  it("au départ, une échéance déjà payée en partie reste due ; les non payées sont annulées", async () => {
    const kid = await enrolled("PARTANT", "06 730 00 05");
    // 80 000 : inscription et 1re tranche soldées, 5 000 versés sur la 2e (due après le départ).
    await pay(kid.enrollmentId, 80_000);
    await setEntryDate(kid.enrollmentId, "2026-10-01");
    await recordDeparture(director, kid.enrollmentId, {
      reason: "transfer",
      date: "2026-12-20",
      note: "",
    });
    let rows = await listInvoices(director, kid.enrollmentId);
    expect(rows.map((r) => [r.dueDate, r.status, r.remaining])).toEqual([
      ["2026-09-15", "open", 0],
      ["2026-10-01", "open", 0],
      ["2027-01-04", "open", 45_000],
    ]);
    // Rien de versé sur la 2e tranche : elle est annulée.
    const other2 = await enrolled("PARTANT2", "06 730 00 15");
    await pay(other2.enrollmentId, 25_000);
    await setEntryDate(other2.enrollmentId, "2026-10-01");
    await recordDeparture(director, other2.enrollmentId, {
      reason: "dropout",
      date: "2026-12-20",
      note: "",
    });
    rows = await listInvoices(director, other2.enrollmentId);
    expect(rows.map((r) => [r.dueDate, r.status])).toEqual([
      ["2026-09-15", "open"],
      ["2026-10-01", "open"],
      ["2027-01-04", "cancelled"],
    ]);
  });

  it("une école ne voit ni n'encaisse pour une autre ; plus d'encaissement dans une année archivée", async () => {
    const kid = await enrolled("ISOLE", "06 730 00 06");
    await expectFinanceError(
      collectPayment(other, {
        enrollmentId: kid.enrollmentId,
        amount: 1000,
        method: "cash",
        reference: "",
        note: "",
      }),
      "enrollmentNotFound",
    );
    expect(await listPayments({ ...other, roles: ["director"] }, kid.enrollmentId)).toEqual([]);
    await activateYear(director, y1);
    const y2 = await createYear(director, {
      label: "2027-2028",
      startDate: "2027-10-01",
      endDate: "2028-06-30",
      periodKind: "trimester",
    });
    await activateYear(director, y2);
    await expectFinanceError(pay(kid.enrollmentId, 1000), "yearArchived");
  });

  it("chaque paiement est tracé dans le journal", async () => {
    const { rows } = await adminQuery<{ n: number }>(
      "select count(*)::int as n from audit_logs where action = 'payment.collect'",
    );
    const { rows: count } = await adminQuery<{ n: number }>(
      "select count(*)::int as n from payments where kind = 'payment'",
    );
    expect(rows[0].n).toBe(count[0].n);
    await withSchool({ schoolId: director.schoolId!, userId: director.userId }, (tx) =>
      tx.select().from(payments).where(eq(payments.kind, "reversal")),
    ).then((r) => expect(r).toHaveLength(1));
  });
});
