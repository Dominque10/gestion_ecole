// Grille tarifaire (M1, 4e) : frais par année et par niveau, avec leurs tranches.
// Modifiable par le directeur seul (décision D3). Montants en francs CFA entiers.
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool, type Tx } from "@/server/db/client";
import { academicYears, auditLogs, feeItems, levels, periods } from "@/server/db/schema";
import { dbGuardCode, isUniqueViolation, SettingsError } from "./errors";
import { checkInstallments, totalOf, type Installment } from "./fees-logic";
import { isValidDate } from "./periods-logic";

export const FEE_KINDS = ["registration", "tuition", "other"] as const;
export type FeeKind = (typeof FEE_KINDS)[number];

export const FeeSchema = z.object({
  name: z.string().trim().min(2).max(60),
  kind: z.enum(FEE_KINDS),
  mandatory: z.boolean(),
  levelIds: z.array(z.uuid()).min(1).max(50),
  installments: z
    .array(
      z.object({
        number: z.number().int(),
        amount: z.number(),
        dueDate: z.string().refine(isValidDate),
      }),
    )
    // Nombre de tranches vérifié par checkInstallments (message précis) ; borne anti-abus ici.
    .max(100),
});
export type FeeInput = z.input<typeof FeeSchema>;

export type Fee = {
  levelId: string;
  name: string;
  kind: FeeKind;
  mandatory: boolean;
  installments: Installment[];
  total: number;
};

function context(principal: Principal, action: "settings:read" | "settings:write") {
  authorize(principal, action);
  return { schoolId: principal.schoolId as string, userId: principal.userId };
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (dbGuardCode(error) === "GS001") throw new SettingsError("yearArchived");
    if (isUniqueViolation(error)) throw new SettingsError("feeNameTaken");
    throw error;
  }
}

async function loadYear(tx: Tx, schoolId: string, yearId: string, forWrite: boolean) {
  if (!z.uuid().safeParse(yearId).success) throw new SettingsError("yearNotFound");
  const [year] = await tx
    .select({ status: academicYears.status, startDate: academicYears.startDate })
    .from(academicYears)
    .where(and(eq(academicYears.schoolId, schoolId), eq(academicYears.id, yearId)));
  if (!year) throw new SettingsError("yearNotFound");
  if (forWrite && year.status === "archived") throw new SettingsError("yearArchived");
  return year;
}

/** Échéances proposées : début de chaque période de l'année (sinon la rentrée). */
export async function defaultDueDates(principal: Principal, yearId: string): Promise<string[]> {
  const ctx = context(principal, "settings:read");
  return withSchool(ctx, async (tx) => {
    const year = await loadYear(tx, ctx.schoolId, yearId, false);
    const rows = await tx
      .select({ startDate: periods.startDate })
      .from(periods)
      .where(eq(periods.academicYearId, yearId))
      .orderBy(asc(periods.position));
    return rows.length > 0 ? rows.map((r) => r.startDate) : [year.startDate];
  });
}

export async function listFees(principal: Principal, yearId: string): Promise<Fee[]> {
  const ctx = context(principal, "settings:read");
  return withSchool(ctx, async (tx) => {
    await loadYear(tx, ctx.schoolId, yearId, false);
    const rows = await tx
      .select()
      .from(feeItems)
      .where(and(eq(feeItems.schoolId, ctx.schoolId), eq(feeItems.academicYearId, yearId)))
      .orderBy(asc(feeItems.name), asc(feeItems.installmentNumber));
    const kindOrder: Record<FeeKind, number> = { registration: 0, tuition: 1, other: 2 };
    const fees = new Map<string, Fee>();
    for (const r of rows) {
      const key = `${r.levelId}|${r.name}`;
      const fee = fees.get(key) ?? {
        levelId: r.levelId,
        name: r.name,
        kind: r.kind,
        mandatory: r.mandatory,
        installments: [],
        total: 0,
      };
      fee.installments.push({ number: r.installmentNumber, amount: r.amount, dueDate: r.dueDate });
      fee.total += r.amount;
      fees.set(key, fee);
    }
    return [...fees.values()].sort(
      (a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.name.localeCompare(b.name, "fr"),
    );
  });
}

/**
 * Enregistre un frais pour un ou plusieurs niveaux. `originalName` : nom avant modification (pour
 * renommer un frais existant) ; sans lui, un frais du même nom déjà présent est refusé.
 * Un seul frais d'inscription par niveau (hypothèse : il servira à valider l'inscription, décision A3).
 */
export async function saveFee(
  principal: Principal,
  yearId: string,
  input: FeeInput,
  originalName?: string,
): Promise<void> {
  const ctx = context(principal, "settings:write");
  const data = FeeSchema.parse(input);
  const problem = checkInstallments(data.installments);
  if (problem) throw new SettingsError(problem);
  const installments = [...data.installments].sort((a, b) => a.number - b.number);
  const levelIds = [...new Set(data.levelIds)];

  await guarded(() =>
    withSchool(ctx, async (tx) => {
      await loadYear(tx, ctx.schoolId, yearId, true);
      const known = await tx
        .select({ id: levels.id })
        .from(levels)
        .where(and(eq(levels.schoolId, ctx.schoolId), inArray(levels.id, levelIds)));
      if (known.length !== levelIds.length) throw new SettingsError("levelNotFound");

      const names = [...new Set([data.name, originalName ?? data.name])];
      const sameYear = and(
        eq(feeItems.schoolId, ctx.schoolId),
        eq(feeItems.academicYearId, yearId),
      );
      if (!originalName || originalName !== data.name) {
        const clash = await tx
          .select({ id: feeItems.id })
          .from(feeItems)
          .where(and(sameYear, inArray(feeItems.levelId, levelIds), eq(feeItems.name, data.name)))
          .limit(1);
        if (clash.length > 0) throw new SettingsError("feeNameTaken");
      }
      if (data.kind === "registration") {
        const other = await tx
          .select({ id: feeItems.id })
          .from(feeItems)
          .where(
            and(
              sameYear,
              inArray(feeItems.levelId, levelIds),
              eq(feeItems.kind, "registration"),
              ne(feeItems.name, originalName ?? data.name),
            ),
          )
          .limit(1);
        if (other.length > 0) throw new SettingsError("registrationExists");
      }

      await tx
        .delete(feeItems)
        .where(and(sameYear, inArray(feeItems.levelId, levelIds), inArray(feeItems.name, names)));
      await tx.insert(feeItems).values(
        levelIds.flatMap((levelId) =>
          installments.map((p) => ({
            schoolId: ctx.schoolId,
            academicYearId: yearId,
            levelId,
            kind: data.kind,
            name: data.name,
            mandatory: data.mandatory,
            installmentNumber: p.number,
            amount: p.amount,
            dueDate: p.dueDate,
          })),
        ),
      );
      await tx.insert(auditLogs).values({
        schoolId: ctx.schoolId,
        actorUserId: principal.userId,
        action: "fee.save",
        entityType: "fee",
        entityId: yearId,
        after: {
          name: data.name,
          originalName: originalName ?? null,
          kind: data.kind,
          mandatory: data.mandatory,
          levelIds,
          total: totalOf(installments),
          installments,
        },
      });
    }),
  );
}

/** Retire un frais d'un niveau (toutes ses tranches). */
export async function deleteFee(
  principal: Principal,
  yearId: string,
  levelId: string,
  name: string,
): Promise<void> {
  const ctx = context(principal, "settings:write");
  if (!z.uuid().safeParse(levelId).success) throw new SettingsError("feeNotFound");
  await guarded(() =>
    withSchool(ctx, async (tx) => {
      await loadYear(tx, ctx.schoolId, yearId, true);
      const deleted = await tx
        .delete(feeItems)
        .where(
          and(
            eq(feeItems.schoolId, ctx.schoolId),
            eq(feeItems.academicYearId, yearId),
            eq(feeItems.levelId, levelId),
            eq(feeItems.name, name),
          ),
        )
        .returning({ amount: feeItems.amount });
      if (deleted.length === 0) throw new SettingsError("feeNotFound");
      await tx.insert(auditLogs).values({
        schoolId: ctx.schoolId,
        actorUserId: principal.userId,
        action: "fee.delete",
        entityType: "fee",
        entityId: yearId,
        before: { name, levelId, total: deleted.reduce((s, r) => s + r.amount, 0) },
      });
    }),
  );
}
