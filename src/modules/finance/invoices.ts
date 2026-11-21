// Échéances des élèves (M3, 2c) : générées depuis la grille à la préinscription, réductions
// (fratrie automatique, bourse et remise exceptionnelle par le directeur), annulation au départ.
import { and, asc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool, type Tx } from "@/server/db/client";
import {
  academicYears,
  auditLogs,
  enrollments,
  feeItems,
  invoices,
  schools,
  studentGuardians,
} from "@/server/db/schema";
import { readContext } from "@/modules/students/students";
import { FinanceError } from "./errors";
import { addDiscount, amountDue, buildInvoices, percentOf, type FeeTranche } from "./invoice-logic";

export type Invoice = {
  id: string;
  feeName: string;
  kind: "registration" | "tuition" | "other";
  mandatory: boolean;
  installmentNumber: number;
  installmentCount: number;
  amount: number;
  discountAmount: number;
  discountNote: string | null;
  due: number;
  dueDate: string;
  status: "open" | "cancelled";
  cancelReason: string | null;
};

const isUuid = (value: string) => z.uuid().safeParse(value).success;

function context(principal: Principal, action: "invoices:manage" | "invoices:discount") {
  authorize(principal, action);
  return { schoolId: principal.schoolId as string, userId: principal.userId };
}

async function loadEnrollment(tx: Tx, schoolId: string, enrollmentId: string) {
  if (!isUuid(enrollmentId)) throw new FinanceError("enrollmentNotFound");
  const [row] = await tx
    .select({
      id: enrollments.id,
      studentId: enrollments.studentId,
      academicYearId: enrollments.academicYearId,
      levelId: enrollments.levelId,
      status: enrollments.status,
      createdAt: enrollments.createdAt,
      yearStatus: academicYears.status,
    })
    .from(enrollments)
    .innerJoin(academicYears, eq(academicYears.id, enrollments.academicYearId))
    .where(and(eq(enrollments.schoolId, schoolId), eq(enrollments.id, enrollmentId)))
    .for("update", { of: enrollments });
  if (!row) throw new FinanceError("enrollmentNotFound");
  return row;
}

/** Tranches de la grille d'un niveau pour une année (obligatoires seules, ou un frais donné). */
async function gridTranches(
  tx: Tx,
  schoolId: string,
  yearId: string,
  levelId: string,
  only: { mandatory: true } | { feeName: string },
): Promise<FeeTranche[]> {
  const rows = await tx
    .select()
    .from(feeItems)
    .where(
      and(
        eq(feeItems.schoolId, schoolId),
        eq(feeItems.academicYearId, yearId),
        eq(feeItems.levelId, levelId),
        "mandatory" in only ? eq(feeItems.mandatory, true) : eq(feeItems.name, only.feeName),
      ),
    )
    .orderBy(asc(feeItems.name), asc(feeItems.installmentNumber));
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
  return rows.map((r) => ({
    feeName: r.name,
    kind: r.kind,
    mandatory: r.mandatory,
    installmentNumber: r.installmentNumber,
    installmentCount: counts.get(r.name) ?? 1,
    amount: r.amount,
    dueDate: r.dueDate,
  }));
}

/**
 * Fratrie (décision D6) : l'élève a un frère ou une sœur (un responsable en commun) inscrit avant lui
 * la même année et toujours présent.
 */
async function hasOlderSibling(
  tx: Tx,
  enrollment: { id: string; studentId: string; academicYearId: string; createdAt: Date },
): Promise<boolean> {
  const guardianIds = tx
    .select({ id: studentGuardians.guardianId })
    .from(studentGuardians)
    .where(eq(studentGuardians.studentId, enrollment.studentId));
  const siblings = tx
    .select({ id: studentGuardians.studentId })
    .from(studentGuardians)
    .where(
      and(
        inArray(studentGuardians.guardianId, guardianIds),
        ne(studentGuardians.studentId, enrollment.studentId),
      ),
    );
  const [row] = await tx
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.academicYearId, enrollment.academicYearId),
        inArray(enrollments.studentId, siblings),
        ne(enrollments.status, "left"),
        lt(enrollments.createdAt, enrollment.createdAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function insertDrafts(
  tx: Tx,
  schoolId: string,
  enrollment: { id: string; studentId: string; academicYearId: string; createdAt: Date },
  tranches: FeeTranche[],
): Promise<number> {
  if (tranches.length === 0) return 0;
  const [school] = await tx
    .select({ percent: schools.siblingDiscountPercent })
    .from(schools)
    .where(eq(schools.id, schoolId));
  const applies = (school?.percent ?? 0) > 0 && (await hasOlderSibling(tx, enrollment));
  const drafts = buildInvoices(tranches, { percent: school?.percent ?? 0, applies });
  const inserted = await tx
    .insert(invoices)
    .values(
      drafts.map((d) => ({
        schoolId,
        academicYearId: enrollment.academicYearId,
        enrollmentId: enrollment.id,
        ...d,
      })),
    )
    .onConflictDoNothing({
      target: [invoices.enrollmentId, invoices.feeName, invoices.installmentNumber],
    })
    .returning({ id: invoices.id });
  return inserted.length;
}

/**
 * Crée les échéances obligatoires d'une inscription depuis la grille (celles qui manquent seulement).
 * Appelée dans la transaction de la préinscription.
 */
export async function generateMandatoryInvoices(
  tx: Tx,
  schoolId: string,
  enrollmentId: string,
): Promise<number> {
  const enrollment = await loadEnrollment(tx, schoolId, enrollmentId);
  const tranches = await gridTranches(tx, schoolId, enrollment.academicYearId, enrollment.levelId, {
    mandatory: true,
  });
  return insertDrafts(tx, schoolId, enrollment, tranches);
}

/**
 * Niveau changé avant validation : les échéances sont recalculées pour le nouveau niveau.
 * (Avec la caisse, sous-étape 2d : refusé si un paiement existe déjà.)
 */
export async function regenerateInvoices(tx: Tx, schoolId: string, enrollmentId: string) {
  await tx.delete(invoices).where(eq(invoices.enrollmentId, enrollmentId));
  return generateMandatoryInvoices(tx, schoolId, enrollmentId);
}

/**
 * Départ (hypothèse H40) : les échéances dont la date limite tombe après la date de départ sont
 * annulées, jamais supprimées.
 */
export async function cancelInvoicesAfter(
  tx: Tx,
  input: { enrollmentId: string; exitDate: string; userId: string; reason: string },
): Promise<number> {
  const cancelled = await tx
    .update(invoices)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelReason: input.reason,
      cancelledBy: input.userId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(invoices.enrollmentId, input.enrollmentId),
        eq(invoices.status, "open"),
        gt(invoices.dueDate, input.exitDate),
      ),
    )
    .returning({ id: invoices.id });
  return cancelled.length;
}

/** Lecture des comptes d'élèves : pas pour un enseignant (il voit ses élèves, pas leurs finances). */
function financeReadContext(principal: Principal) {
  const ctx = readContext(principal);
  if (ctx.teacherOnly) throw new FinanceError("enrollmentNotFound");
  return ctx;
}

export async function listInvoices(principal: Principal, enrollmentId: string): Promise<Invoice[]> {
  const ctx = financeReadContext(principal);
  if (!isUuid(enrollmentId)) throw new FinanceError("enrollmentNotFound");
  return withSchool(ctx, async (tx) => {
    const [enrollment] = await tx
      .select({ studentId: enrollments.studentId })
      .from(enrollments)
      .where(and(eq(enrollments.schoolId, ctx.schoolId), eq(enrollments.id, enrollmentId)));
    if (!enrollment) throw new FinanceError("enrollmentNotFound");
    const rows = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.enrollmentId, enrollmentId))
      .orderBy(asc(invoices.dueDate), asc(invoices.feeName), asc(invoices.installmentNumber));
    return rows.map((r) => ({
      id: r.id,
      feeName: r.feeName,
      kind: r.kind,
      mandatory: r.mandatory,
      installmentNumber: r.installmentNumber,
      installmentCount: r.installmentCount,
      amount: r.amount,
      discountAmount: r.discountAmount,
      discountNote: r.discountNote,
      due: amountDue(r),
      dueDate: r.dueDate,
      status: r.status,
      cancelReason: r.cancelReason,
    }));
  });
}

async function writableEnrollment(tx: Tx, schoolId: string, enrollmentId: string) {
  const enrollment = await loadEnrollment(tx, schoolId, enrollmentId);
  if (enrollment.yearStatus === "archived") throw new FinanceError("yearArchived");
  if (enrollment.status === "left") throw new FinanceError("enrollmentLeft");
  return enrollment;
}

/** Frais obligatoires ajoutés à la grille après l'inscription : on les ajoute à l'élève. */
export async function addMissingMandatoryFees(
  principal: Principal,
  enrollmentId: string,
): Promise<number> {
  const ctx = context(principal, "invoices:manage");
  return withSchool(ctx, async (tx) => {
    await writableEnrollment(tx, ctx.schoolId, enrollmentId);
    return generateMandatoryInvoices(tx, ctx.schoolId, enrollmentId);
  });
}

/** Frais facultatifs proposés pour une inscription (ceux de la grille pas encore pris). */
export async function optionalFees(
  principal: Principal,
  enrollmentId: string,
): Promise<{ name: string; total: number }[]> {
  const ctx = financeReadContext(principal);
  if (!isUuid(enrollmentId)) return [];
  return withSchool(ctx, async (tx) => {
    const [enrollment] = await tx
      .select({ yearId: enrollments.academicYearId, levelId: enrollments.levelId })
      .from(enrollments)
      .where(and(eq(enrollments.schoolId, ctx.schoolId), eq(enrollments.id, enrollmentId)));
    if (!enrollment) return [];
    const taken = await tx
      .selectDistinct({ name: invoices.feeName })
      .from(invoices)
      .where(eq(invoices.enrollmentId, enrollmentId));
    const rows = await tx
      .select({ name: feeItems.name, total: sql<number>`sum(${feeItems.amount})::int` })
      .from(feeItems)
      .where(
        and(
          eq(feeItems.schoolId, ctx.schoolId),
          eq(feeItems.academicYearId, enrollment.yearId),
          eq(feeItems.levelId, enrollment.levelId),
          eq(feeItems.mandatory, false),
        ),
      )
      .groupBy(feeItems.name)
      .orderBy(asc(feeItems.name));
    const takenNames = new Set(taken.map((t) => t.name));
    return rows.filter((r) => !takenNames.has(r.name));
  });
}

/** Ajoute un frais facultatif (tenue, assurance…) à un élève, avec ses tranches. */
export async function addOptionalFee(
  principal: Principal,
  enrollmentId: string,
  feeName: string,
): Promise<number> {
  const ctx = context(principal, "invoices:manage");
  return withSchool(ctx, async (tx) => {
    const enrollment = await writableEnrollment(tx, ctx.schoolId, enrollmentId);
    const tranches = await gridTranches(
      tx,
      ctx.schoolId,
      enrollment.academicYearId,
      enrollment.levelId,
      {
        feeName,
      },
    );
    if (tranches.length === 0) throw new FinanceError("feeNotFound");
    const added = await insertDrafts(tx, ctx.schoolId, enrollment, tranches);
    if (added === 0) throw new FinanceError("feeAlreadyInvoiced");
    return added;
  });
}

const ReasonSchema = z.string().trim().min(3).max(200);

/**
 * Bourse : un pourcentage de réduction sur toutes les échéances de scolarité encore ouvertes,
 * accordé par le directeur avec un motif, tracé dans le journal.
 */
export async function grantScholarship(
  principal: Principal,
  enrollmentId: string,
  input: { percent: number; reason: string },
): Promise<number> {
  const ctx = context(principal, "invoices:discount");
  const percent = z.number().int().min(1).max(100).parse(input.percent);
  const reason = ReasonSchema.parse(input.reason);
  return withSchool(ctx, async (tx) => {
    await writableEnrollment(tx, ctx.schoolId, enrollmentId);
    const rows = await tx
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.enrollmentId, enrollmentId),
          eq(invoices.kind, "tuition"),
          eq(invoices.status, "open"),
        ),
      )
      .for("update");
    if (rows.length === 0) throw new FinanceError("noTuition");
    for (const r of rows) {
      await tx
        .update(invoices)
        .set({
          ...addDiscount(r, percentOf(r.amount, percent), `Bourse ${percent} %`),
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, r.id));
    }
    await tx.insert(auditLogs).values({
      schoolId: ctx.schoolId,
      actorUserId: ctx.userId,
      action: "invoice.scholarship",
      entityType: "enrollment",
      entityId: enrollmentId,
      after: { percent, reason, invoices: rows.length },
    });
    return rows.length;
  });
}

/** Remise exceptionnelle sur une échéance (montant en FCFA), par le directeur, motif obligatoire. */
export async function grantExceptionalDiscount(
  principal: Principal,
  invoiceId: string,
  input: { amount: number; reason: string },
): Promise<void> {
  const ctx = context(principal, "invoices:discount");
  const amount = z.number().int().min(1).parse(input.amount);
  const reason = ReasonSchema.parse(input.reason);
  if (!isUuid(invoiceId)) throw new FinanceError("invoiceNotFound");
  await withSchool(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.schoolId, ctx.schoolId), eq(invoices.id, invoiceId)))
      .for("update");
    if (!row) throw new FinanceError("invoiceNotFound");
    await writableEnrollment(tx, ctx.schoolId, row.enrollmentId);
    if (row.status !== "open") throw new FinanceError("invoiceCancelled");
    if (amount > amountDue(row)) throw new FinanceError("discountTooLarge");
    await tx
      .update(invoices)
      .set({ ...addDiscount(row, amount, `Remise : ${reason}`), updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId));
    await tx.insert(auditLogs).values({
      schoolId: ctx.schoolId,
      actorUserId: ctx.userId,
      action: "invoice.discount",
      entityType: "invoice",
      entityId: invoiceId,
      before: { discountAmount: row.discountAmount },
      after: { discountAmount: row.discountAmount + amount, reason },
    });
  });
}

/** Réglage de l'école : pourcentage de réduction fratrie (0 à 100). */
export async function setSiblingDiscount(principal: Principal, percent: number): Promise<void> {
  authorize(principal, "settings:write");
  const value = z.number().int().min(0).max(100).parse(percent);
  const schoolId = principal.schoolId as string;
  await withSchool({ schoolId, userId: principal.userId }, async (tx) => {
    const [before] = await tx
      .select({ percent: schools.siblingDiscountPercent })
      .from(schools)
      .where(eq(schools.id, schoolId));
    await tx
      .update(schools)
      .set({ siblingDiscountPercent: value, updatedAt: new Date() })
      .where(eq(schools.id, schoolId));
    await tx.insert(auditLogs).values({
      schoolId,
      actorUserId: principal.userId,
      action: "school.sibling_discount",
      entityType: "school",
      entityId: schoolId,
      before: { percent: before?.percent ?? 0 },
      after: { percent: value },
    });
  });
}

export async function getSiblingDiscount(principal: Principal): Promise<number> {
  authorize(principal, "settings:read");
  const schoolId = principal.schoolId as string;
  const [row] = await withSchool({ schoolId, userId: principal.userId }, (tx) =>
    tx
      .select({ percent: schools.siblingDiscountPercent })
      .from(schools)
      .where(eq(schools.id, schoolId)),
  );
  return row?.percent ?? 0;
}
