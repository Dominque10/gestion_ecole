// M1 — créneaux simples et grille tarifaire.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type MembershipRole, type Principal } from "@/server/auth/permissions";
import { closeDb } from "@/server/db/client";
import { SettingsError } from "@/modules/settings/errors";
import {
  defaultDueDates,
  deleteFee,
  listFees,
  saveFee,
  type FeeInput,
} from "@/modules/settings/fees";
import { proposeInstallments } from "@/modules/settings/fees-logic";
import { addDefaultLevels, listLevels } from "@/modules/settings/levels";
import {
  createTimeSlot,
  deleteTimeSlot,
  listTimeSlots,
  updateTimeSlot,
} from "@/modules/settings/time-slots";
import { activateYear, createYear } from "@/modules/settings/years";
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

async function expectSettingsError(promise: Promise<unknown>, code: SettingsError["code"]) {
  await expect(promise).rejects.toSatisfy(
    (e: unknown) => e instanceof SettingsError && e.code === code,
  );
}

let yearId: string;
let sixieme: string;
let cinquieme: string;
const TERMS = ["2026-10-01", "2027-01-01", "2027-04-01"];

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  a = await createSchoolWithDirector(superadminId, "fraisa");
  b = await createSchoolWithDirector(superadminId, "fraisb");
  await addDefaultLevels(director(), "college");
  const levels = await listLevels(director());
  sixieme = levels.find((l) => l.name === "6e")!.id;
  cinquieme = levels.find((l) => l.name === "5e")!.id;
  yearId = await createYear(director(), {
    label: "2026-2027",
    startDate: "2026-10-01",
    endDate: "2027-06-30",
    periodKind: "trimester",
  });
});

afterAll(async () => {
  await closeDb();
});

describe("Créneaux", () => {
  it("crée des créneaux (heures normalisées), triés par heure de début", async () => {
    await createTimeSlot(director(), { label: "Après-midi", startTime: "15h00", endTime: "17h30" });
    const morning = await createTimeSlot(director(), {
      label: "Matin",
      startTime: "7:30",
      endTime: "12:00",
    });
    expect(await listTimeSlots(director())).toEqual([
      { id: morning, label: "Matin", startTime: "07:30", endTime: "12:00" },
      expect.objectContaining({ label: "Après-midi", startTime: "15:00", endTime: "17:30" }),
    ]);
  });

  it("refuse un nom en double, une fin avant le début, une heure invalide", async () => {
    await expectSettingsError(
      createTimeSlot(director(), { label: "Matin", startTime: "08:00", endTime: "09:00" }),
      "timeSlotLabelTaken",
    );
    for (const times of [
      { startTime: "12:00", endTime: "07:30" },
      { startTime: "10:00", endTime: "10:00" },
      { startTime: "25:00", endTime: "26:00" },
      { startTime: "8", endTime: "9" },
    ]) {
      await expect(createTimeSlot(director(), { label: "X", ...times })).rejects.toThrow();
    }
  });

  it("modifie et supprime un créneau", async () => {
    const [morning] = await listTimeSlots(director());
    await updateTimeSlot(director(), morning.id, {
      label: "Matinée",
      startTime: "07:00",
      endTime: "12:00",
    });
    expect((await listTimeSlots(director()))[0]).toMatchObject({
      label: "Matinée",
      startTime: "07:00",
    });
    await deleteTimeSlot(director(), morning.id);
    await expectSettingsError(deleteTimeSlot(director(), morning.id), "timeSlotNotFound");
  });
});

describe("Grille tarifaire", () => {
  const tuition = (overrides: Partial<FeeInput> = {}): FeeInput => ({
    name: "Scolarité",
    kind: "tuition",
    mandatory: true,
    levelIds: [sixieme, cinquieme],
    installments: proposeInstallments(150_000, 3, TERMS),
    ...overrides,
  });

  it("propose les débuts de trimestre comme échéances", async () => {
    expect(await defaultDueDates(director(), yearId)).toEqual(TERMS);
  });

  it("enregistre la scolarité pour deux niveaux, en 3 tranches, tracée dans le journal", async () => {
    await saveFee(director(), yearId, tuition());
    const fees = await listFees(director(), yearId);
    expect(fees).toHaveLength(2);
    expect(fees.map((f) => [f.levelId, f.total, f.installments.length])).toEqual(
      expect.arrayContaining([
        [sixieme, 150_000, 3],
        [cinquieme, 150_000, 3],
      ]),
    );
    const { rows } = await adminQuery<{ after: { total: number } }>(
      "select after from audit_logs where school_id = $1 and action = 'fee.save'",
      [a.schoolId],
    );
    expect(rows[0].after.total).toBe(150_000);
  });

  it("frais d'inscription (une tranche) et frais facultatif ; un seul frais d'inscription par niveau", async () => {
    await saveFee(director(), yearId, {
      name: "Frais d'inscription",
      kind: "registration",
      mandatory: true,
      levelIds: [sixieme],
      installments: [{ number: 1, amount: 25_000, dueDate: "2026-09-15" }],
    });
    await saveFee(director(), yearId, {
      name: "Tenue",
      kind: "other",
      mandatory: false,
      levelIds: [sixieme],
      installments: [{ number: 1, amount: 12_500, dueDate: "2026-10-01" }],
    });
    await expectSettingsError(
      saveFee(director(), yearId, {
        name: "Réinscription",
        kind: "registration",
        mandatory: true,
        levelIds: [sixieme, cinquieme],
        installments: [{ number: 1, amount: 15_000, dueDate: "2026-09-15" }],
      }),
      "registrationExists",
    );
    const sixiemeFees = (await listFees(director(), yearId)).filter((f) => f.levelId === sixieme);
    expect(sixiemeFees.map((f) => [f.name, f.kind, f.mandatory, f.total])).toEqual([
      ["Frais d'inscription", "registration", true, 25_000],
      ["Scolarité", "tuition", true, 150_000],
      ["Tenue", "other", false, 12_500],
    ]);
  });

  it("refuse un frais du même nom, des montants faux, des échéances dans le désordre", async () => {
    await expectSettingsError(saveFee(director(), yearId, tuition()), "feeNameTaken");
    await expectSettingsError(
      saveFee(director(), yearId, tuition({ name: "Cantine", installments: [] })),
      "installmentsCount",
    );
    for (const amount of [0, -5000, 1500.5]) {
      await expectSettingsError(
        saveFee(
          director(),
          yearId,
          tuition({
            name: "Cantine",
            installments: [{ number: 1, amount, dueDate: "2026-10-01" }],
          }),
        ),
        "installmentAmount",
      );
    }
    await expectSettingsError(
      saveFee(
        director(),
        yearId,
        tuition({
          name: "Cantine",
          installments: [
            { number: 1, amount: 1000, dueDate: "2027-01-01" },
            { number: 2, amount: 1000, dueDate: "2026-10-01" },
          ],
        }),
      ),
      "installmentOrder",
    );
  });

  it("modifie un frais (montants et nom) sans toucher aux autres niveaux", async () => {
    await saveFee(
      director(),
      yearId,
      tuition({
        name: "Scolarité annuelle",
        levelIds: [sixieme],
        installments: proposeInstallments(180_000, 2, TERMS),
      }),
      "Scolarité",
    );
    const fees = await listFees(director(), yearId);
    const s6 = fees.filter((f) => f.levelId === sixieme).map((f) => [f.name, f.total]);
    expect(s6).toContainEqual(["Scolarité annuelle", 180_000]);
    expect(s6.map((f) => f[0])).not.toContain("Scolarité");
    expect(fees.find((f) => f.levelId === cinquieme)).toMatchObject({
      name: "Scolarité",
      total: 150_000,
    });
  });

  it("supprime un frais d'un niveau", async () => {
    await deleteFee(director(), yearId, sixieme, "Tenue");
    await expectSettingsError(deleteFee(director(), yearId, sixieme, "Tenue"), "feeNotFound");
  });

  it("la grille d'une année archivée ne se modifie plus", async () => {
    await activateYear(director(), yearId);
    const next = await createYear(director(), {
      label: "2027-2028",
      startDate: "2027-10-01",
      endDate: "2028-06-30",
      periodKind: "trimester",
    });
    await activateYear(director(), next);
    await expectSettingsError(
      saveFee(director(), yearId, tuition({ name: "Nouveau" })),
      "yearArchived",
    );
    await expectSettingsError(
      deleteFee(director(), yearId, cinquieme, "Scolarité"),
      "yearArchived",
    );
    expect(await listFees(director(), yearId)).not.toHaveLength(0);
  });
});

describe("Droits et isolation", () => {
  it("seul le directeur modifie les frais et les créneaux (décision D3)", async () => {
    for (const role of ["secretary", "accountant", "teacher", "parent", "support"] as const) {
      await expect(
        saveFee(as(a, role), yearId, {
          name: "X",
          kind: "other",
          mandatory: false,
          levelIds: [sixieme],
          installments: [{ number: 1, amount: 1000, dueDate: "2026-10-01" }],
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        createTimeSlot(as(a, role), { label: "X", startTime: "08:00", endTime: "09:00" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(listFees(as(a, "support"), yearId)).resolves.not.toHaveLength(0);
  });

  it("une école ne voit ni ne modifie les frais et créneaux d'une autre", async () => {
    await expectSettingsError(listFees(as(b, "director"), yearId), "yearNotFound");
    expect(await listTimeSlots(as(b, "director"))).toEqual([]);
    const [slotA] = await listTimeSlots(director());
    await expectSettingsError(deleteTimeSlot(as(b, "director"), slotA.id), "timeSlotNotFound");
  });
});
