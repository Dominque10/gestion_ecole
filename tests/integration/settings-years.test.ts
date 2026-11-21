// M1 — années scolaires et périodes : une seule active, archives en lecture seule.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type MembershipRole, type Principal } from "@/server/auth/permissions";
import { closeDb, withSchool } from "@/server/db/client";
import { academicYears, periods } from "@/server/db/schema";
import { SettingsError } from "@/modules/settings/errors";
import {
  activateYear,
  createYear,
  deleteYear,
  getYear,
  listYears,
  updatePeriods,
  updateYear,
} from "@/modules/settings/years";
import { adminQuery, createSchoolWithDirector, createSuperadmin, resetDatabase } from "./helpers";
import { eq } from "drizzle-orm";

type School = { schoolId: string; directorId: string };
let a: School;
let b: School;
const as = (school: School, ...roles: MembershipRole[]): Principal => ({
  userId: school.directorId,
  schoolId: school.schoolId,
  roles,
  isSuperadmin: false,
});
const ctx = (school: School) => ({ schoolId: school.schoolId, userId: school.directorId });

const Y2026 = {
  label: "2026-2027",
  startDate: "2026-10-01",
  endDate: "2027-06-30",
  periodKind: "trimester" as const,
};
const Y2027 = { ...Y2026, label: "2027-2028", startDate: "2027-10-01", endDate: "2028-06-30" };

async function expectSettingsError(promise: Promise<unknown>, code: SettingsError["code"]) {
  await expect(promise).rejects.toSatisfy(
    (e: unknown) => e instanceof SettingsError && e.code === code,
  );
}

/** Vérifie qu'une écriture directe en base est refusée par un garde-fou (code SQLSTATE). */
async function expectDbGuard(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e as { code?: string; cause?: { code?: string } },
  );
  expect(error, "la base aurait dû refuser").not.toBeNull();
  expect(error?.code ?? error?.cause?.code).toBe(code);
}

let year1: string;
let year2: string;

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  a = await createSchoolWithDirector(superadminId, "anneea");
  b = await createSchoolWithDirector(superadminId, "anneeb");
});

afterAll(async () => {
  await closeDb();
});

describe("Créer et préparer une année", () => {
  it("crée une année en préparation avec 3 trimestres proposés", async () => {
    year1 = await createYear(as(a, "director"), Y2026);
    expect(await getYear(as(a, "director"), year1)).toEqual({
      id: year1,
      ...Y2026,
      status: "upcoming",
      periods: [
        { position: 1, label: "1er trimestre", startDate: "2026-10-01", endDate: "2026-12-31" },
        { position: 2, label: "2e trimestre", startDate: "2027-01-01", endDate: "2027-03-31" },
        { position: 3, label: "3e trimestre", startDate: "2027-04-01", endDate: "2027-06-30" },
      ],
    });
  });

  it("refuse un nom d'année déjà utilisé dans l'école, mais pas dans une autre école", async () => {
    await expectSettingsError(createYear(as(a, "director"), Y2026), "yearLabelTaken");
    await expect(createYear(as(b, "director"), Y2026)).resolves.toBeTypeOf("string");
  });

  it("refuse des dates invalides ou une fin avant la rentrée", async () => {
    const director = as(a, "director");
    await expect(createYear(director, { ...Y2027, endDate: "2027-09-01" })).rejects.toThrow();
    await expect(createYear(director, { ...Y2027, startDate: "2027-02-30" })).rejects.toThrow();
  });

  it("ajuste les périodes (vacances entre deux trimestres)", async () => {
    await updatePeriods(as(a, "director"), year1, [
      { position: 1, label: "Trimestre 1", startDate: "2026-10-01", endDate: "2026-12-18" },
      { position: 2, label: "Trimestre 2", startDate: "2027-01-04", endDate: "2027-03-26" },
      { position: 3, label: "Trimestre 3", startDate: "2027-04-12", endDate: "2027-06-30" },
    ]);
    const year = await getYear(as(a, "director"), year1);
    expect(year.periods.map((p) => [p.label, p.endDate])).toEqual([
      ["Trimestre 1", "2026-12-18"],
      ["Trimestre 2", "2027-03-26"],
      ["Trimestre 3", "2027-06-30"],
    ]);
  });

  it("refuse des périodes qui se chevauchent ou débordent de l'année", async () => {
    const before = (await getYear(as(a, "director"), year1)).periods;
    await expectSettingsError(
      updatePeriods(as(a, "director"), year1, [
        { ...before[0], endDate: "2027-01-10" },
        before[1],
        before[2],
      ]),
      "periodsOverlap",
    );
    await expectSettingsError(
      updatePeriods(as(a, "director"), year1, [
        before[0],
        before[1],
        { ...before[2], endDate: "2027-07-15" },
      ]),
      "periodsOutsideYear",
    );
    expect((await getYear(as(a, "director"), year1)).periods).toEqual(before);
  });

  it("garde les périodes ajustées si elles tiennent dans les nouvelles dates", async () => {
    const result = await updateYear(as(a, "director"), year1, { ...Y2026, endDate: "2027-07-05" });
    expect(result).toEqual({ periodsReset: false });
    expect((await getYear(as(a, "director"), year1)).periods[0].label).toBe("Trimestre 1");
  });

  it("recalcule les périodes si le découpage change (semestres)", async () => {
    const result = await updateYear(as(a, "director"), year1, { ...Y2026, periodKind: "semester" });
    expect(result).toEqual({ periodsReset: true });
    const year = await getYear(as(a, "director"), year1);
    expect(year.periods.map((p) => p.label)).toEqual(["1er semestre", "2e semestre"]);
    await updateYear(as(a, "director"), year1, Y2026);
    expect((await getYear(as(a, "director"), year1)).periods).toHaveLength(3);
  });
});

describe("Activer une année, archiver la précédente", () => {
  it("active la première année ; une seule année est active", async () => {
    await activateYear(as(a, "director"), year1);
    year2 = await createYear(as(a, "director"), Y2027);
    const statuses = (await listYears(as(a, "director"))).map((y) => [y.label, y.status]);
    expect(statuses).toEqual([
      ["2027-2028", "upcoming"],
      ["2026-2027", "active"],
    ]);
  });

  it("une année active ne se supprime pas, et ne se réactive pas", async () => {
    await expectSettingsError(deleteYear(as(a, "director"), year1), "yearNotUpcoming");
    await expectSettingsError(activateYear(as(a, "director"), year1), "yearNotUpcoming");
  });

  it("activer la nouvelle année archive l'ancienne, avec trace", async () => {
    await activateYear(as(a, "director"), year2);
    const statuses = (await listYears(as(a, "director"))).map((y) => [y.label, y.status]);
    expect(statuses).toEqual([
      ["2027-2028", "active"],
      ["2026-2027", "archived"],
    ]);
    const { rows } = await adminQuery<{ before: unknown; after: unknown }>(
      "select before, after from audit_logs where school_id = $1 and action = 'year.activate' order by created_at",
      [a.schoolId],
    );
    expect(rows.at(-1)).toEqual({
      before: { archived: ["2026-2027"] },
      after: { active: "2027-2028" },
    });
  });

  it("une année archivée ne se modifie plus (application)", async () => {
    const director = as(a, "director");
    const archived = await getYear(director, year1);
    await expectSettingsError(
      updateYear(director, year1, { ...Y2026, label: "Changé" }),
      "yearArchived",
    );
    await expectSettingsError(updatePeriods(director, year1, archived.periods), "yearArchived");
    await expectSettingsError(deleteYear(director, year1), "yearNotUpcoming");
    await expectSettingsError(activateYear(director, year1), "yearNotUpcoming");
  });

  it("une année archivée ne se modifie plus, même en écrivant directement en base", async () => {
    await expectDbGuard(
      withSchool(ctx(a), (tx) =>
        tx.update(academicYears).set({ label: "Falsifiée" }).where(eq(academicYears.id, year1)),
      ),
      "GS001",
    );
    await expectDbGuard(
      withSchool(ctx(a), (tx) =>
        tx.update(academicYears).set({ status: "active" }).where(eq(academicYears.id, year1)),
      ),
      "GS001",
    );
    await expectDbGuard(
      withSchool(ctx(a), (tx) =>
        tx.update(periods).set({ label: "Falsifiée" }).where(eq(periods.academicYearId, year1)),
      ),
      "GS001",
    );
    await expectDbGuard(
      withSchool(ctx(a), (tx) => tx.delete(periods).where(eq(periods.academicYearId, year1))),
      "GS001",
    );
    await expectDbGuard(
      withSchool(ctx(a), (tx) => tx.delete(academicYears).where(eq(academicYears.id, year1))),
      "GS003",
    );
  });

  it("la base refuse aussi les sauts de statut et la création d'une année déjà active", async () => {
    const [upcoming] = await withSchool(ctx(b), (tx) =>
      tx.select({ id: academicYears.id }).from(academicYears),
    );
    await expectDbGuard(
      withSchool(ctx(b), (tx) =>
        tx
          .update(academicYears)
          .set({ status: "archived" })
          .where(eq(academicYears.id, upcoming.id)),
      ),
      "GS002",
    );
    await expectDbGuard(
      withSchool(ctx(b), (tx) =>
        tx.insert(academicYears).values({ ...Y2027, schoolId: b.schoolId, status: "active" }),
      ),
      "GS002",
    );
  });

  it("une année en préparation se supprime avec ses périodes", async () => {
    const draft = await createYear(as(a, "director"), {
      ...Y2027,
      label: "Brouillon",
      startDate: "2028-10-01",
      endDate: "2029-06-30",
    });
    await deleteYear(as(a, "director"), draft);
    await expectSettingsError(getYear(as(a, "director"), draft), "yearNotFound");
    const { rows } = await adminQuery("select 1 from periods where academic_year_id = $1", [draft]);
    expect(rows).toEqual([]);
  });
});

describe("Droits et isolation", () => {
  it("seul le directeur modifie ; le Support consulte ; les autres rôles n'accèdent pas au paramétrage", async () => {
    await expect(listYears(as(a, "support"))).resolves.toHaveLength(2);
    for (const role of ["secretary", "accountant", "teacher", "parent", "support"] as const) {
      await expect(createYear(as(a, role), { ...Y2027, label: "X" })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(activateYear(as(a, role), year2)).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(listYears(as(a, "teacher"))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("une école ne voit ni ne touche les années d'une autre", async () => {
    expect((await listYears(as(b, "director"))).map((y) => y.label)).toEqual(["2026-2027"]);
    await expectSettingsError(getYear(as(b, "director"), year2), "yearNotFound");
    await expectSettingsError(activateYear(as(b, "director"), year2), "yearNotFound");
    await expectSettingsError(updateYear(as(b, "director"), year2, Y2027), "yearNotFound");
    await expectSettingsError(deleteYear(as(b, "director"), year2), "yearNotFound");
  });

  it("une période ne peut pas être rattachée à l'année d'une autre école", async () => {
    await expect(
      withSchool(ctx(b), (tx) =>
        tx.insert(periods).values({
          schoolId: b.schoolId,
          academicYearId: year2,
          position: 9,
          label: "Intruse",
          startDate: "2027-10-01",
          endDate: "2027-10-02",
        }),
      ),
    ).rejects.toThrow();
  });
});
