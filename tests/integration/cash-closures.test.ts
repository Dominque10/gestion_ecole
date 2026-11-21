// M3 (2e) — clôture de caisse et impayés. Jalon de la phase 2 : la somme des reçus d'une journée
// égale toujours la clôture de caisse.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type Principal } from "@/server/auth/permissions";
import { closeDb, withSchool } from "@/server/db/client";
import { cashClosures } from "@/server/db/schema";
import { todayInBrazzaville } from "@/lib/dates";
import { arrearsFilters, listArrears } from "@/modules/finance/arrears";
import { closeCash, getDaySummary, listClosures, reopenClosure } from "@/modules/finance/closures";
import { FinanceError } from "@/modules/finance/errors";
import { collectPayment, listCashierPayments } from "@/modules/finance/payments";
import { saveFee } from "@/modules/settings/fees";
import { createClass } from "@/modules/settings/classes";
import { addDefaultLevels, listLevels } from "@/modules/settings/levels";
import { addStaff } from "@/modules/settings/staff";
import { createYear } from "@/modules/settings/years";
import { assignClass, preEnroll, validateEnrollment } from "@/modules/students/enrollments";
import { createStudent } from "@/modules/students/students";
import { brazzavilleDayRange } from "@/lib/dates";
import { adminQuery, createSchoolWithDirector, createSuperadmin, resetDatabase } from "./helpers";

let director: Principal;
let cashierA: Principal;
let cashierB: Principal;
let other: Principal;
let y1: string;
let sixieme: string;
let sixA: string;
const enrollmentIds: string[] = [];
const today = todayInBrazzaville();

async function expectFinanceError(promise: Promise<unknown>, code: FinanceError["code"]) {
  await expect(promise).rejects.toSatisfy(
    (e: unknown) => e instanceof FinanceError && e.code === code,
  );
}

const pay = (
  cashier: Principal,
  enrollmentId: string,
  amount: number,
  method: "cash" | "mobile_money" | "cheque" = "cash",
  reference = "",
) => collectPayment(cashier, { enrollmentId, amount, method, reference, note: "" });

/** Somme des reçus réellement enregistrés aujourd'hui par un caissier (lecture directe en base). */
async function receiptsTotal(cashierId: string): Promise<number> {
  const { from, to } = brazzavilleDayRange(today);
  const { rows } = await adminQuery<{ total: number }>(
    `select coalesce(sum(amount), 0)::int as total from payments
     where cashier_id = $1 and kind = 'payment' and paid_at >= $2 and paid_at < $3`,
    [cashierId, from, to],
  );
  return rows[0].total;
}

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  const a = await createSchoolWithDirector(superadminId, "cloturea");
  const b = await createSchoolWithDirector(superadminId, "clotureb");
  director = {
    userId: a.directorId,
    schoolId: a.schoolId,
    roles: ["director"],
    isSuperadmin: false,
  };
  other = {
    userId: b.directorId,
    schoolId: b.schoolId,
    roles: ["director", "accountant"],
    isSuperadmin: false,
  };
  for (const [i, ref] of (["A", "B"] as const).entries()) {
    const id = (
      await addStaff(director, {
        name: `Caissier ${ref}`,
        identifier: `05 740 00 0${i}`,
        password: "Provisoire-2026",
        roles: ["accountant"],
      })
    ).userId;
    const principal: Principal = {
      userId: id,
      schoolId: a.schoolId,
      roles: ["accountant"],
      isSuperadmin: false,
    };
    if (ref === "A") cashierA = principal;
    else cashierB = principal;
  }
  await addDefaultLevels(director, "college");
  sixieme = (await listLevels(director)).find((l) => l.name === "6e")!.id;
  y1 = await createYear(director, {
    label: "2026-2027",
    startDate: "2026-10-01",
    endDate: "2027-06-30",
    periodKind: "trimester",
  });
  sixA = await createClass(director, y1, {
    levelId: sixieme,
    series: "",
    name: "6e A",
    capacity: "",
    headTeacherId: "",
  });
  await saveFee(director, y1, {
    name: "Scolarité",
    kind: "tuition",
    mandatory: true,
    levelIds: [sixieme],
    installments: [
      { number: 1, amount: 100_000, dueDate: "2026-10-01" },
      { number: 2, amount: 100_000, dueDate: "2099-01-04" },
    ],
  });
  for (let i = 0; i < 12; i++) {
    const s = await createStudent(director, {
      student: {
        lastName: `ELEVE${String(i).padStart(2, "0")}`,
        firstNames: "Test",
        sex: "F",
        birthDate: "",
        birthPlace: "",
        nationality: "",
        previousSchool: "",
      },
      guardian: {
        fullName: "Parent",
        phone: `06 741 00 ${String(i).padStart(2, "0")}`,
        otherPhone: "",
        relationship: "",
      },
    });
    const e = await preEnroll(director, { studentId: s.id, academicYearId: y1, levelId: sixieme });
    await validateEnrollment(director, e);
    if (i < 4) await assignClass(director, e, sixA);
    enrollmentIds.push(e);
  }
});

afterAll(async () => {
  await closeDb();
});

describe("Clôture de caisse", () => {
  it("totaux du jour par mode, pour le caissier seulement", async () => {
    await pay(cashierA, enrollmentIds[0], 25_000);
    await pay(cashierA, enrollmentIds[1], 10_000, "mobile_money", "MP-0001");
    await pay(cashierA, enrollmentIds[2], 50_000, "cheque", "CHQ-123");
    await pay(cashierB, enrollmentIds[3], 7_000);
    expect(await getDaySummary(cashierA, today)).toMatchObject({
      receiptCount: 3,
      cashTotal: 25_000,
      mobileMoneyTotal: 10_000,
      chequeTotal: 50_000,
      total: 85_000,
      closure: null,
    });
  });

  it("clôture avec écart constaté (espèces comptées − attendues), tracée", async () => {
    const closed = await closeCash(cashierA, {
      day: today,
      countedCash: 24_500,
      note: "Pièce manquante",
    });
    expect(closed.difference).toBe(-500);
    expect(closed.totals.total).toBe(await receiptsTotal(cashierA.userId));
    const { rows } = await adminQuery(
      "select 1 from audit_logs where action = 'cash.close' and entity_id = $1",
      [closed.id],
    );
    expect(rows).toHaveLength(1);
  });

  it("après clôture : plus d'encaissement ce jour-là, pas de seconde clôture ; l'autre caissier continue", async () => {
    await expectFinanceError(pay(cashierA, enrollmentIds[4], 1_000), "cashClosed");
    await expectFinanceError(
      closeCash(cashierA, { day: today, countedCash: 0, note: "" }),
      "alreadyClosed",
    );
    await expect(pay(cashierB, enrollmentIds[4], 1_000)).resolves.toMatchObject({});
  });

  it("une clôture ne se modifie pas, ni ne se supprime (la base l'interdit)", async () => {
    const ctx = { schoolId: director.schoolId!, userId: director.userId };
    await expect(
      withSchool(ctx, (tx) => tx.update(cashClosures).set({ countedCash: 25_000 })),
    ).rejects.toThrow();
    await expect(withSchool(ctx, (tx) => tx.delete(cashClosures))).rejects.toThrow();
  });

  it("le directeur rouvre (motif, trace) ; la nouvelle clôture reprend toute la journée", async () => {
    const [closure] = await listClosures(director);
    await expect(reopenClosure(director, closure.id, "")).rejects.toThrow();
    await reopenClosure(director, closure.id, "Encaissement oublié");
    await pay(cashierA, enrollmentIds[4], 3_000);
    const second = await closeCash(cashierA, { day: today, countedCash: 28_000, note: "" });
    expect(second.totals).toMatchObject({ receiptCount: 4, cashTotal: 28_000, total: 88_000 });
    expect(second.difference).toBe(0);
    const history = await listClosures(director);
    expect(history.filter((c) => c.cashierId === cashierA.userId).map((c) => c.status)).toEqual([
      "closed",
      "reopened",
    ]);
    await expectFinanceError(reopenClosure(director, closure.id, "Encore"), "closureNotFound");
  });

  it("JALON : encaissements et clôture simultanés — la clôture égale toujours la somme des reçus", async () => {
    const attempts = enrollmentIds.slice(5, 12).map((e, i) =>
      pay(cashierB, e, 1_000 + i).then(
        () => "ok",
        (error: unknown) => (error instanceof FinanceError ? error.code : "autre"),
      ),
    );
    const closing = closeCash(cashierB, { day: today, countedCash: 0, note: "" });
    const outcomes = await Promise.all(attempts);
    const closed = await closing;
    // Chaque encaissement est soit dans la clôture, soit refusé (caisse clôturée) : jamais entre les deux.
    expect(outcomes.every((o) => o === "ok" || o === "cashClosed")).toBe(true);
    expect(closed.totals.total).toBe(await receiptsTotal(cashierB.userId));
    const listed = await listCashierPayments(cashierB, brazzavilleDayRange(today));
    expect(closed.totals.receiptCount).toBe(listed.filter((p) => p.kind === "payment").length);
  });

  it("refuse une journée future ; droits : le comptable clôture, le directeur rouvre", async () => {
    await expect(
      closeCash(cashierA, { day: "2099-01-01", countedCash: 0, note: "" }),
    ).rejects.toThrow();
    await expect(
      closeCash(director, { day: today, countedCash: 0, note: "" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const [closure] = await listClosures(director);
    await expect(reopenClosure(cashierA, closure.id, "Moi")).rejects.toBeInstanceOf(ForbiddenError);
    // Un comptable ne voit que ses clôtures ; le directeur toutes.
    expect((await listClosures(cashierA)).every((c) => c.cashierId === cashierA.userId)).toBe(true);
    expect(await listClosures(other)).toEqual([]);
  });
});

describe("Impayés", () => {
  it("élèves en retard, montant et ancienneté, du plus gros au plus petit", async () => {
    const rows = await listArrears(director, { academicYearId: y1, today: "2026-12-15" });
    // 1re tranche (100 000, due le 1er octobre) : 75 jours de retard.
    const first = rows.find((r) => r.studentName === "ELEVE00 Test")!;
    expect(first).toMatchObject({
      overdue: 75_000,
      daysLate: 75,
      bucket: "61-90",
      className: "6e A",
      guardianPhone: "+242067410000",
    });
    expect(rows[0].overdue).toBeGreaterThanOrEqual(rows.at(-1)!.overdue);
    // ELEVE02 a payé 50 000 : il lui reste 50 000 en retard.
    expect(rows.find((r) => r.studentName === "ELEVE02 Test")?.overdue).toBe(50_000);
  });

  it("filtre par classe ; rien n'est en retard avant la date limite", async () => {
    const inClass = await listArrears(director, {
      academicYearId: y1,
      classId: sixA,
      today: "2026-12-15",
    });
    expect(inClass.map((r) => r.studentName).sort()).toEqual([
      "ELEVE00 Test",
      "ELEVE01 Test",
      "ELEVE02 Test",
      "ELEVE03 Test",
    ]);
    expect(await listArrears(director, { academicYearId: y1, today: "2026-10-01" })).toEqual([]);
  });

  it("filtres (années, classes) lisibles par le comptable", async () => {
    const filters = await arrearsFilters(cashierA, y1);
    expect(filters.years.map((y) => y.label)).toEqual(["2026-2027"]);
    expect(filters.classes.map((c) => c.name)).toEqual(["6e A"]);
    await expect(arrearsFilters({ ...director, roles: ["teacher"] })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("direction et comptabilité seulement ; une autre école ne voit rien", async () => {
    await expect(
      listArrears({ ...director, roles: ["secretary"] }, { academicYearId: y1 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listArrears(cashierA, { academicYearId: y1 })).resolves.not.toBeNull();
    expect(await listArrears(other, { academicYearId: y1, today: "2026-12-15" })).toEqual([]);
  });
});
