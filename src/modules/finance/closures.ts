// Clôture de caisse journalière (M3, 2e). Jalon de la phase : la somme des reçus d'une journée égale
// toujours la clôture. Encaissements et clôture d'un même caissier pour un même jour passent par un
// verrou commun : un reçu ne peut pas « glisser » entre le calcul des totaux et la clôture.
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { brazzavilleDayRange, todayInBrazzaville } from "@/lib/dates";
import { isValidDate } from "@/modules/settings/periods-logic";
import { isUniqueViolation } from "@/modules/settings/errors";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool, type Tx } from "@/server/db/client";
import { auditLogs, cashClosures, payments, users } from "@/server/db/schema";
import { summarizeReceipts, type DayTotals } from "./closure-logic";
import { FinanceError } from "./errors";

/** Verrou de transaction sur (école, caissier, jour). */
async function lockCashierDay(tx: Tx, schoolId: string, cashierId: string, day: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`cash:${schoolId}:${cashierId}:${day}`}, 0))`,
  );
}

async function closedClosure(tx: Tx, schoolId: string, cashierId: string, day: string) {
  const [row] = await tx
    .select()
    .from(cashClosures)
    .where(
      and(
        eq(cashClosures.schoolId, schoolId),
        eq(cashClosures.cashierId, cashierId),
        eq(cashClosures.day, day),
        eq(cashClosures.status, "closed"),
      ),
    );
  return row ?? null;
}

/**
 * Appelée dans la transaction d'un encaissement : prend le verrou du jour et refuse si la caisse du
 * caissier est déjà clôturée aujourd'hui (hypothèse H42).
 */
export async function assertCashOpen(tx: Tx, schoolId: string, cashierId: string): Promise<void> {
  const day = todayInBrazzaville();
  await lockCashierDay(tx, schoolId, cashierId, day);
  if (await closedClosure(tx, schoolId, cashierId, day)) throw new FinanceError("cashClosed");
}

async function dayTotals(
  tx: Tx,
  schoolId: string,
  cashierId: string,
  day: string,
): Promise<DayTotals> {
  const { from, to } = brazzavilleDayRange(day);
  const receipts = await tx
    .select({ amount: payments.amount, method: payments.method })
    .from(payments)
    .where(
      and(
        eq(payments.schoolId, schoolId),
        eq(payments.cashierId, cashierId),
        eq(payments.kind, "payment"),
        gte(payments.paidAt, from),
        lt(payments.paidAt, to),
      ),
    );
  return summarizeReceipts(receipts);
}

function context(principal: Principal, action: "cash:close" | "cash:reopen" | "dashboard:finance") {
  authorize(principal, action);
  return { schoolId: principal.schoolId as string, userId: principal.userId };
}

const DaySchema = z
  .string()
  .refine(isValidDate)
  .refine((d) => d <= todayInBrazzaville(), { message: "future" });

export type Closure = DayTotals & {
  id: string;
  cashierId: string;
  cashierName: string;
  day: string;
  countedCash: number;
  difference: number;
  note: string | null;
  closedAt: Date;
  status: "closed" | "reopened";
  reopenReason: string | null;
};

/** Situation de la caisse du caissier connecté pour un jour : totaux de ses reçus, clôture éventuelle. */
export async function getDaySummary(
  principal: Principal,
  day: string,
): Promise<DayTotals & { closure: Closure | null }> {
  const ctx = context(principal, "cash:close");
  const date = DaySchema.parse(day);
  return withSchool(ctx, async (tx) => {
    const totals = await dayTotals(tx, ctx.schoolId, ctx.userId, date);
    const closure = await closedClosure(tx, ctx.schoolId, ctx.userId, date);
    const [me] = await tx.select({ name: users.name }).from(users).where(eq(users.id, ctx.userId));
    return { ...totals, closure: closure ? { ...closure, cashierName: me?.name ?? "" } : null };
  });
}

/**
 * Clôture la caisse du caissier pour un jour (aujourd'hui ou un jour passé oublié) : instantané de
 * ses reçus, espèces comptées, écart. Tracée.
 */
export async function closeCash(
  principal: Principal,
  input: { day: string; countedCash: number; note: string },
): Promise<{ id: string; totals: DayTotals; difference: number }> {
  const ctx = context(principal, "cash:close");
  const day = DaySchema.parse(input.day);
  const countedCash = z.number().int().min(0).max(1_000_000_000).parse(input.countedCash);
  const note = z.string().trim().max(300).parse(input.note) || null;
  try {
    return await withSchool(ctx, async (tx) => {
      await lockCashierDay(tx, ctx.schoolId, ctx.userId, day);
      if (await closedClosure(tx, ctx.schoolId, ctx.userId, day))
        throw new FinanceError("alreadyClosed");
      const totals = await dayTotals(tx, ctx.schoolId, ctx.userId, day);
      const difference = countedCash - totals.cashTotal;
      const [row] = await tx
        .insert(cashClosures)
        .values({
          schoolId: ctx.schoolId,
          cashierId: ctx.userId,
          day,
          ...totals,
          countedCash,
          difference,
          note,
        })
        .returning({ id: cashClosures.id });
      await tx.insert(auditLogs).values({
        schoolId: ctx.schoolId,
        actorUserId: ctx.userId,
        action: "cash.close",
        entityType: "cash_closure",
        entityId: row.id,
        after: { day, ...totals, countedCash, difference },
      });
      return { id: row.id, totals, difference };
    });
  } catch (error) {
    if (isUniqueViolation(error, "cash_closures_one_closed"))
      throw new FinanceError("alreadyClosed");
    throw error;
  }
}

/** Clôtures de l'école (directeur) ou du caissier connecté (comptable), les plus récentes d'abord. */
export async function listClosures(principal: Principal, limit = 60): Promise<Closure[]> {
  const ctx = context(principal, "dashboard:finance");
  const all = principal.roles.includes("director");
  return withSchool(ctx, (tx) =>
    tx
      .select({
        id: cashClosures.id,
        cashierId: cashClosures.cashierId,
        cashierName: users.name,
        day: cashClosures.day,
        receiptCount: cashClosures.receiptCount,
        cashTotal: cashClosures.cashTotal,
        mobileMoneyTotal: cashClosures.mobileMoneyTotal,
        transferTotal: cashClosures.transferTotal,
        chequeTotal: cashClosures.chequeTotal,
        total: cashClosures.total,
        countedCash: cashClosures.countedCash,
        difference: cashClosures.difference,
        note: cashClosures.note,
        closedAt: cashClosures.closedAt,
        status: cashClosures.status,
        reopenReason: cashClosures.reopenReason,
      })
      .from(cashClosures)
      .innerJoin(users, eq(users.id, cashClosures.cashierId))
      .where(
        and(
          eq(cashClosures.schoolId, ctx.schoolId),
          all ? undefined : eq(cashClosures.cashierId, ctx.userId),
        ),
      )
      .orderBy(desc(cashClosures.day), desc(cashClosures.closedAt))
      .limit(limit),
  );
}

/** Le directeur rouvre une clôture (motif obligatoire, tracé) : le caissier peut encaisser à nouveau. */
export async function reopenClosure(
  principal: Principal,
  closureId: string,
  reason: string,
): Promise<void> {
  const ctx = context(principal, "cash:reopen");
  const text = z.string().trim().min(3).max(300).parse(reason);
  if (!z.uuid().safeParse(closureId).success) throw new FinanceError("closureNotFound");
  await withSchool(ctx, async (tx) => {
    const [row] = await tx
      .select({
        status: cashClosures.status,
        cashierId: cashClosures.cashierId,
        day: cashClosures.day,
      })
      .from(cashClosures)
      .where(and(eq(cashClosures.schoolId, ctx.schoolId), eq(cashClosures.id, closureId)))
      .for("update");
    if (!row || row.status !== "closed") throw new FinanceError("closureNotFound");
    await lockCashierDay(tx, ctx.schoolId, row.cashierId, row.day);
    await tx
      .update(cashClosures)
      .set({
        status: "reopened",
        reopenedBy: ctx.userId,
        reopenedAt: new Date(),
        reopenReason: text,
      })
      .where(eq(cashClosures.id, closureId));
    await tx.insert(auditLogs).values({
      schoolId: ctx.schoolId,
      actorUserId: ctx.userId,
      action: "cash.reopen",
      entityType: "cash_closure",
      entityId: closureId,
      after: { reason: text, cashierId: row.cashierId, day: row.day },
    });
  });
}
