// Années scolaires et périodes (M1). Une seule année active par école ; une année archivée est en
// lecture seule, définitivement (garanti aussi par la base, migration « academic_years_rls »).
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool, type Tx } from "@/server/db/client";
import { academicYears, auditLogs, periods } from "@/server/db/schema";
import { dbGuardCode, isUniqueViolation, SettingsError } from "./errors";
import { checkPeriods, proposePeriods, type PeriodDraft, type PeriodKind } from "./periods-logic";
import {
  AcademicYearSchema,
  PeriodsSchema,
  type AcademicYearInput,
  type PeriodsInput,
} from "./schemas";

export type YearStatus = "upcoming" | "active" | "archived";

export type AcademicYear = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  periodKind: PeriodKind;
  status: YearStatus;
  periods: PeriodDraft[];
};

function context(principal: Principal, action: "settings:read" | "settings:write") {
  authorize(principal, action);
  return { schoolId: principal.schoolId as string, userId: principal.userId };
}

/** Traduit les refus de la base (garde-fous, unicité) en refus métier. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isUniqueViolation(error, "academic_years_school_label")) {
      throw new SettingsError("yearLabelTaken");
    }
    const code = dbGuardCode(error);
    if (code === "GS001") throw new SettingsError("yearArchived");
    if (code === "GS002" || code === "GS003") throw new SettingsError("yearNotUpcoming");
    throw error;
  }
}

async function loadYear(tx: Tx, schoolId: string, yearId: string, lock = false) {
  if (!z.uuid().safeParse(yearId).success) throw new SettingsError("yearNotFound");
  const query = tx
    .select()
    .from(academicYears)
    .where(and(eq(academicYears.schoolId, schoolId), eq(academicYears.id, yearId)));
  const [year] = lock ? await query.for("update") : await query;
  if (!year) throw new SettingsError("yearNotFound");
  return year;
}

async function replacePeriods(tx: Tx, schoolId: string, yearId: string, drafts: PeriodDraft[]) {
  await tx.delete(periods).where(eq(periods.academicYearId, yearId));
  await tx.insert(periods).values(
    drafts.map((p) => ({
      schoolId,
      academicYearId: yearId,
      position: p.position,
      label: p.label.trim(),
      startDate: p.startDate,
      endDate: p.endDate,
    })),
  );
}

export async function listYears(principal: Principal): Promise<AcademicYear[]> {
  const ctx = context(principal, "settings:read");
  return withSchool(ctx, async (tx) => {
    const years = await tx
      .select()
      .from(academicYears)
      .where(eq(academicYears.schoolId, ctx.schoolId))
      .orderBy(desc(academicYears.startDate));
    const allPeriods = await tx
      .select()
      .from(periods)
      .where(eq(periods.schoolId, ctx.schoolId))
      .orderBy(asc(periods.position));
    return years.map((y) => ({
      id: y.id,
      label: y.label,
      startDate: y.startDate,
      endDate: y.endDate,
      periodKind: y.periodKind,
      status: y.status,
      periods: allPeriods
        .filter((p) => p.academicYearId === y.id)
        .map(({ position, label, startDate, endDate }) => ({
          position,
          label,
          startDate,
          endDate,
        })),
    }));
  });
}

export async function getYear(principal: Principal, yearId: string): Promise<AcademicYear> {
  const year = (await listYears(principal)).find((y) => y.id === yearId);
  if (!year) throw new SettingsError("yearNotFound");
  return year;
}

/** Crée une année « en préparation », avec ses périodes proposées par défaut. */
export async function createYear(principal: Principal, input: AcademicYearInput): Promise<string> {
  const ctx = context(principal, "settings:write");
  const data = AcademicYearSchema.parse(input);
  return guarded(() =>
    withSchool(ctx, async (tx) => {
      const [year] = await tx
        .insert(academicYears)
        .values({ schoolId: ctx.schoolId, ...data })
        .returning({ id: academicYears.id });
      await replacePeriods(
        tx,
        ctx.schoolId,
        year.id,
        proposePeriods(data.periodKind, data.startDate, data.endDate),
      );
      return year.id;
    }),
  );
}

/**
 * Modifie le libellé, les dates ou le découpage d'une année non archivée. Si le découpage change, ou si
 * les périodes actuelles ne tiennent plus dans les nouvelles dates, elles sont recalculées par défaut
 * (`periodsReset: true`, signalé à l'utilisateur).
 */
export async function updateYear(
  principal: Principal,
  yearId: string,
  input: AcademicYearInput,
): Promise<{ periodsReset: boolean }> {
  const ctx = context(principal, "settings:write");
  const data = AcademicYearSchema.parse(input);
  return guarded(() =>
    withSchool(ctx, async (tx) => {
      const year = await loadYear(tx, ctx.schoolId, yearId, true);
      if (year.status === "archived") throw new SettingsError("yearArchived");
      const current = await tx
        .select()
        .from(periods)
        .where(eq(periods.academicYearId, yearId))
        .orderBy(asc(periods.position));
      await tx
        .update(academicYears)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(academicYears.id, yearId));
      const stillValid = checkPeriods(data, current) === null;
      if (!stillValid) {
        await replacePeriods(
          tx,
          ctx.schoolId,
          yearId,
          proposePeriods(data.periodKind, data.startDate, data.endDate),
        );
      }
      return { periodsReset: !stillValid };
    }),
  );
}

/** Enregistre les dates et libellés des périodes d'une année non archivée. */
export async function updatePeriods(
  principal: Principal,
  yearId: string,
  input: PeriodsInput,
): Promise<void> {
  const ctx = context(principal, "settings:write");
  const drafts = PeriodsSchema.parse(input);
  await guarded(() =>
    withSchool(ctx, async (tx) => {
      const year = await loadYear(tx, ctx.schoolId, yearId, true);
      if (year.status === "archived") throw new SettingsError("yearArchived");
      const problem = checkPeriods(year, drafts);
      if (problem) throw new SettingsError(problem);
      for (const p of drafts) {
        await tx
          .update(periods)
          .set({
            label: p.label,
            startDate: p.startDate,
            endDate: p.endDate,
            updatedAt: new Date(),
          })
          .where(and(eq(periods.academicYearId, yearId), eq(periods.position, p.position)));
      }
    }),
  );
}

/**
 * Active une année en préparation. L'année active jusque-là est archivée : elle passe en lecture seule,
 * définitivement (hypothèse à confirmer : le passage d'année ne se défait pas).
 */
export async function activateYear(principal: Principal, yearId: string): Promise<void> {
  const ctx = context(principal, "settings:write");
  await guarded(() =>
    withSchool(ctx, async (tx) => {
      // Verrouille toutes les années de l'école : deux activations simultanées se suivent.
      await tx
        .select({ id: academicYears.id })
        .from(academicYears)
        .where(eq(academicYears.schoolId, ctx.schoolId))
        .for("update");
      const year = await loadYear(tx, ctx.schoolId, yearId);
      if (year.status !== "upcoming") throw new SettingsError("yearNotUpcoming");
      const archived = await tx
        .update(academicYears)
        .set({ status: "archived", updatedAt: new Date() })
        .where(
          and(
            eq(academicYears.schoolId, ctx.schoolId),
            eq(academicYears.status, "active"),
            ne(academicYears.id, yearId),
          ),
        )
        .returning({ id: academicYears.id, label: academicYears.label });
      await tx
        .update(academicYears)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(academicYears.id, yearId));
      await tx.insert(auditLogs).values({
        schoolId: ctx.schoolId,
        actorUserId: principal.userId,
        action: "year.activate",
        entityType: "academic_year",
        entityId: yearId,
        before: { archived: archived.map((y) => y.label) },
        after: { active: year.label },
      });
    }),
  );
}

/** Supprime une année encore en préparation (une erreur de saisie, par exemple). */
export async function deleteYear(principal: Principal, yearId: string): Promise<void> {
  const ctx = context(principal, "settings:write");
  await guarded(() =>
    withSchool(ctx, async (tx) => {
      const year = await loadYear(tx, ctx.schoolId, yearId, true);
      if (year.status !== "upcoming") throw new SettingsError("yearNotUpcoming");
      await tx.delete(academicYears).where(eq(academicYears.id, yearId));
    }),
  );
}
