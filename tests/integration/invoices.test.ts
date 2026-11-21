// M3 (2c) — échéances : génération depuis la grille, fratrie, bourse, remise, frais facultatifs, départ.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type Principal } from "@/server/auth/permissions";
import { closeDb, withSchool } from "@/server/db/client";
import { feeItems, invoices } from "@/server/db/schema";
import { FinanceError } from "@/modules/finance/errors";
import {
  addMissingMandatoryFees,
  addOptionalFee,
  getSiblingDiscount,
  grantExceptionalDiscount,
  grantScholarship,
  listInvoices,
  optionalFees,
  setSiblingDiscount,
} from "@/modules/finance/invoices";
import { saveFee } from "@/modules/settings/fees";
import { addDefaultLevels, listLevels } from "@/modules/settings/levels";
import { activateYear, createYear } from "@/modules/settings/years";
import { changeEnrollmentLevel, preEnroll, recordDeparture } from "@/modules/students/enrollments";
import { createStudent } from "@/modules/students/students";
import {
  adminQuery,
  createSchoolWithDirector,
  createSuperadmin,
  resetDatabase,
  setEntryDate,
} from "./helpers";
import { eq } from "drizzle-orm";

let director: Principal;
let other: Principal;
let y1: string;
let sixieme: string;
let cinquieme: string;

async function expectFinanceError(promise: Promise<unknown>, code: FinanceError["code"]) {
  await expect(promise).rejects.toSatisfy(
    (e: unknown) => e instanceof FinanceError && e.code === code,
  );
}

async function student(name: string, phone: string) {
  return (
    await createStudent(director, {
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
    })
  ).id;
}

const totals = (rows: { due: number; status: string }[]) =>
  rows.filter((r) => r.status === "open").reduce((s, r) => s + r.due, 0);

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  const a = await createSchoolWithDirector(superadminId, "factua");
  const b = await createSchoolWithDirector(superadminId, "factub");
  director = {
    userId: a.directorId,
    schoolId: a.schoolId,
    roles: ["director"],
    isSuperadmin: false,
  };
  other = { userId: b.directorId, schoolId: b.schoolId, roles: ["director"], isSuperadmin: false };
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
      { number: 3, amount: 50_000, dueDate: "2027-04-12" },
    ],
  });
  await saveFee(director, y1, {
    name: "Scolarité",
    kind: "tuition",
    mandatory: true,
    levelIds: [cinquieme],
    installments: [{ number: 1, amount: 180_000, dueDate: "2026-10-01" }],
  });
  await saveFee(director, y1, {
    name: "Tenue",
    kind: "other",
    mandatory: false,
    levelIds: [sixieme],
    installments: [{ number: 1, amount: 12_500, dueDate: "2026-10-01" }],
  });
});

afterAll(async () => {
  await closeDb();
});

describe("Génération à la préinscription", () => {
  let firstEnrollment: string;

  it("crée les échéances obligatoires du niveau (pas les facultatives), copiées de la grille", async () => {
    const kid = await student("AINE", "06 720 00 01");
    firstEnrollment = await preEnroll(director, {
      studentId: kid,
      academicYearId: y1,
      levelId: sixieme,
    });
    const rows = await listInvoices(director, firstEnrollment);
    expect(
      rows.map((r) => [r.feeName, r.installmentNumber, r.installmentCount, r.due, r.dueDate]),
    ).toEqual([
      ["Frais d'inscription", 1, 1, 25_000, "2026-09-15"],
      ["Scolarité", 1, 3, 50_000, "2026-10-01"],
      ["Scolarité", 2, 3, 50_000, "2027-01-04"],
      ["Scolarité", 3, 3, 50_000, "2027-04-12"],
    ]);
  });

  it("modifier la grille ensuite ne change rien aux échéances déjà émises (H34)", async () => {
    await withSchool({ schoolId: director.schoolId!, userId: director.userId }, (tx) =>
      tx.update(feeItems).set({ amount: 99_999 }).where(eq(feeItems.name, "Scolarité")),
    );
    expect(totals(await listInvoices(director, firstEnrollment))).toBe(175_000);
    // Remise en état de la grille pour les tests suivants.
    await adminQuery(
      "update fee_items set amount = case when level_id = $1 then 50000 else 180000 end where name = 'Scolarité'",
      [sixieme],
    );
  });

  it("changer de niveau avant validation recalcule les échéances", async () => {
    await changeEnrollmentLevel(director, firstEnrollment, cinquieme);
    const rows = await listInvoices(director, firstEnrollment);
    expect(rows.map((r) => [r.feeName, r.due])).toEqual([
      ["Frais d'inscription", 25_000],
      ["Scolarité", 180_000],
    ]);
    await changeEnrollmentLevel(director, firstEnrollment, sixieme);
  });
});

describe("Réduction fratrie (décision D6)", () => {
  it("réglage de l'école de 0 à 100 %, tracé", async () => {
    await setSiblingDiscount(director, 10);
    expect(await getSiblingDiscount(director)).toBe(10);
    await expect(setSiblingDiscount(director, 101)).rejects.toThrow();
    await expect(
      setSiblingDiscount({ ...director, roles: ["accountant"] }, 5),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("le 2e enfant d'un même parent a 10 % sur la scolarité, pas sur l'inscription", async () => {
    const cadet = await student("CADET", "06 720 00 01");
    const enrollment = await preEnroll(director, {
      studentId: cadet,
      academicYearId: y1,
      levelId: sixieme,
    });
    const rows = await listInvoices(director, enrollment);
    expect(rows.map((r) => [r.feeName, r.discountAmount, r.discountNote])).toEqual([
      ["Frais d'inscription", 0, null],
      ["Scolarité", 5_000, "Fratrie 10 %"],
      ["Scolarité", 5_000, "Fratrie 10 %"],
      ["Scolarité", 5_000, "Fratrie 10 %"],
    ]);
  });

  it("un enfant sans frère ou sœur inscrit n'a pas de réduction", async () => {
    const alone = await student("SEUL", "06 720 00 09");
    const enrollment = await preEnroll(director, {
      studentId: alone,
      academicYearId: y1,
      levelId: sixieme,
    });
    expect((await listInvoices(director, enrollment)).every((r) => r.discountAmount === 0)).toBe(
      true,
    );
  });
});

describe("Bourse, remise, frais facultatifs", () => {
  let enrollment: string;

  it("bourse de 50 % sur la scolarité ouverte, motif obligatoire, tracée", async () => {
    const kid = await student("BOURSIER", "06 720 00 02");
    enrollment = await preEnroll(director, {
      studentId: kid,
      academicYearId: y1,
      levelId: sixieme,
    });
    await expect(
      grantScholarship(director, enrollment, { percent: 50, reason: "" }),
    ).rejects.toThrow();
    expect(
      await grantScholarship(director, enrollment, { percent: 50, reason: "Excellent élève" }),
    ).toBe(3);
    const rows = await listInvoices(director, enrollment);
    expect(totals(rows)).toBe(25_000 + 75_000);
    expect(rows[1].discountNote).toBe("Bourse 50 %");
    const { rows: logs } = await adminQuery(
      "select 1 from audit_logs where action = 'invoice.scholarship' and entity_id = $1",
      [enrollment],
    );
    expect(logs).toHaveLength(1);
  });

  it("remise exceptionnelle sur une échéance ; jamais plus que le reste à payer", async () => {
    const rows = await listInvoices(director, enrollment);
    await grantExceptionalDiscount(director, rows[0].id, {
      amount: 5_000,
      reason: "Famille en difficulté",
    });
    await expectFinanceError(
      grantExceptionalDiscount(director, rows[0].id, { amount: 20_001, reason: "Trop" }),
      "discountTooLarge",
    );
    const after = await listInvoices(director, enrollment);
    expect([after[0].due, after[0].discountNote]).toEqual([
      20_000,
      "Remise : Famille en difficulté",
    ]);
  });

  it("seul le directeur accorde bourse et remise", async () => {
    for (const role of ["secretary", "accountant", "teacher", "support"] as const) {
      await expect(
        grantScholarship({ ...director, roles: [role] }, enrollment, {
          percent: 10,
          reason: "xxx",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("frais facultatif ajouté à la demande, une seule fois", async () => {
    expect(await optionalFees(director, enrollment)).toEqual([{ name: "Tenue", total: 12_500 }]);
    const accountant: Principal = { ...director, roles: ["accountant"] };
    await addOptionalFee(accountant, enrollment, "Tenue");
    await expectFinanceError(addOptionalFee(accountant, enrollment, "Tenue"), "feeAlreadyInvoiced");
    await expectFinanceError(addOptionalFee(accountant, enrollment, "Inconnu"), "feeNotFound");
    expect(await optionalFees(director, enrollment)).toEqual([]);
  });

  it("frais obligatoire ajouté à la grille après coup : ajouté à la demande", async () => {
    await saveFee(director, y1, {
      name: "Assurance",
      kind: "other",
      mandatory: true,
      levelIds: [sixieme],
      installments: [{ number: 1, amount: 2_000, dueDate: "2026-10-01" }],
    });
    expect(await addMissingMandatoryFees(director, enrollment)).toBe(1);
    expect(await addMissingMandatoryFees(director, enrollment)).toBe(0);
  });
});

describe("Départ et années archivées", () => {
  it("au départ, les échéances après la date de départ sont annulées, jamais supprimées", async () => {
    const kid = await student("PARTANT", "06 720 00 03");
    const enrollment = await preEnroll(director, {
      studentId: kid,
      academicYearId: y1,
      levelId: sixieme,
    });
    await setEntryDate(enrollment, "2026-10-01");
    await recordDeparture(director, enrollment, {
      reason: "transfer",
      date: "2026-12-20",
      note: "",
    });
    const rows = await listInvoices(director, enrollment);
    // Inscription, assurance (ajoutée à la grille plus haut) et 1re tranche restent dues.
    expect(rows.map((r) => [r.feeName, r.dueDate, r.status])).toEqual([
      ["Frais d'inscription", "2026-09-15", "open"],
      ["Assurance", "2026-10-01", "open"],
      ["Scolarité", "2026-10-01", "open"],
      ["Scolarité", "2027-01-04", "cancelled"],
      ["Scolarité", "2027-04-12", "cancelled"],
    ]);
    expect(rows[3].cancelReason).toBe("Départ (transfer)");
    await expectFinanceError(addMissingMandatoryFees(director, enrollment), "enrollmentLeft");
  });

  it("une échéance annulée ne se rouvre pas (la base l'interdit)", async () => {
    await expect(
      withSchool({ schoolId: director.schoolId!, userId: director.userId }, (tx) =>
        tx.update(invoices).set({ status: "open" }).where(eq(invoices.status, "cancelled")),
      ),
    ).rejects.toThrow();
  });

  it("un enseignant ne voit pas les comptes des élèves", async () => {
    const [anyRow] = (
      await adminQuery<{ enrollment_id: string }>("select enrollment_id from invoices limit 1")
    ).rows;
    await expectFinanceError(
      listInvoices({ ...director, roles: ["teacher"] }, anyRow.enrollment_id),
      "enrollmentNotFound",
    );
  });

  it("une école ne voit pas les échéances d'une autre ; année archivée en lecture seule", async () => {
    const [anyRow] = (
      await adminQuery<{ enrollment_id: string }>("select enrollment_id from invoices limit 1")
    ).rows;
    await expectFinanceError(listInvoices(other, anyRow.enrollment_id), "enrollmentNotFound");
    await activateYear(director, y1);
    const y2 = await createYear(director, {
      label: "2027-2028",
      startDate: "2027-10-01",
      endDate: "2028-06-30",
      periodKind: "trimester",
    });
    await activateYear(director, y2);
    await expectFinanceError(
      addMissingMandatoryFees(director, anyRow.enrollment_id),
      "yearArchived",
    );
  });
});
