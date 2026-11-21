import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { schools, users } from "./platform";
import { feeKind } from "./settings";
import { enrollments } from "./students";

// Finances (M3). Montants en francs CFA entiers. Règles RLS : migration « invoices_rls ».

export const invoiceStatus = pgEnum("invoice_status", ["open", "cancelled"]);

/**
 * Échéance d'un élève : une tranche d'un frais, copiée de la grille à l'inscription. La grille peut
 * changer ensuite sans toucher aux échéances déjà émises (hypothèse H34). Montant dû = montant − remise.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    academicYearId: uuid("academic_year_id").notNull(),
    enrollmentId: uuid("enrollment_id").notNull(),
    feeName: text("fee_name").notNull(),
    kind: feeKind("kind").notNull(),
    mandatory: boolean("mandatory").notNull(),
    installmentNumber: integer("installment_number").notNull(),
    installmentCount: integer("installment_count").notNull(),
    amount: integer("amount").notNull(),
    discountAmount: integer("discount_amount").notNull().default(0),
    /** Détail des réductions (ex. « Fratrie 10 % ; Bourse 50 % »). */
    discountNote: text("discount_note"),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    status: invoiceStatus("status").notNull().default("open"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // L'échéance appartient à l'inscription, de la même année et de la même école.
    foreignKey({
      name: "invoices_enrollment_fk",
      columns: [t.enrollmentId, t.academicYearId, t.schoolId],
      foreignColumns: [enrollments.id, enrollments.academicYearId, enrollments.schoolId],
    }),
    unique("invoices_unique").on(t.enrollmentId, t.feeName, t.installmentNumber),
    unique("invoices_id_school").on(t.id, t.schoolId),
    check("invoices_amount", sql`${t.amount} between 1 and 100000000`),
    check("invoices_discount", sql`${t.discountAmount} between 0 and ${t.amount}`),
    check("invoices_installment", sql`${t.installmentNumber} between 1 and ${t.installmentCount}`),
    check(
      "invoices_cancelled",
      sql`${t.status} <> 'cancelled' or (${t.cancelledAt} is not null and ${t.cancelReason} is not null)`,
    ),
    index("invoices_enrollment_idx").on(t.enrollmentId),
    index("invoices_school_due_idx").on(t.schoolId, t.dueDate),
  ],
);

// --- Caisse (2d) --------------------------------------------------------------------------------

export const paymentMethod = pgEnum("payment_method", [
  "cash",
  "mobile_money",
  "transfer",
  "cheque",
]);
export const paymentKind = pgEnum("payment_kind", ["payment", "reversal"]);

/**
 * Paiement (ou écriture inverse d'annulation). Jamais modifié ni supprimé (la base l'interdit) :
 * une annulation est une nouvelle ligne `reversal` de montant opposé, qui pointe vers l'original.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    academicYearId: uuid("academic_year_id").notNull(),
    enrollmentId: uuid("enrollment_id").notNull(),
    kind: paymentKind("kind").notNull().default("payment"),
    /** Positif pour un paiement, négatif (opposé de l'original) pour une annulation. */
    amount: integer("amount").notNull(),
    method: paymentMethod("method").notNull(),
    /** Référence de l'opérateur mobile money, du virement, ou numéro du chèque. */
    reference: text("reference"),
    /** Numéro de reçu (paiements seulement), continu par école et par année. */
    receiptNumber: text("receipt_number"),
    reversesId: uuid("reverses_id").references((): AnyPgColumn => payments.id),
    cashierId: uuid("cashier_id")
      .notNull()
      .references(() => users.id),
    note: text("note"),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "payments_enrollment_fk",
      columns: [t.enrollmentId, t.academicYearId, t.schoolId],
      foreignColumns: [enrollments.id, enrollments.academicYearId, enrollments.schoolId],
    }),
    unique("payments_receipt").on(t.schoolId, t.receiptNumber),
    unique("payments_reverses").on(t.reversesId),
    unique("payments_id_school").on(t.id, t.schoolId),
    // Une même référence opérateur n'est enregistrée qu'une fois (idempotence, CLAUDE.md §6).
    uniqueIndex("payments_reference")
      .on(t.schoolId, t.method, t.reference)
      .where(sql`${t.reference} is not null and ${t.kind} = 'payment'`),
    check(
      "payments_kind",
      sql`(${t.kind} = 'payment' and ${t.amount} between 1 and 100000000 and ${t.receiptNumber} is not null and ${t.reversesId} is null)
        or (${t.kind} = 'reversal' and ${t.amount} < 0 and ${t.receiptNumber} is null and ${t.reversesId} is not null)`,
    ),
    index("payments_enrollment_idx").on(t.enrollmentId),
    index("payments_school_paid_idx").on(t.schoolId, t.paidAt),
    index("payments_cashier_paid_idx").on(t.cashierId, t.paidAt),
  ],
);

/** Répartition d'un paiement sur les échéances (négative pour une annulation). Jamais modifiée. */
export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    paymentId: uuid("payment_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    amount: integer("amount").notNull(),
  },
  (t) => [
    foreignKey({
      name: "payment_allocations_payment_fk",
      columns: [t.paymentId, t.schoolId],
      foreignColumns: [payments.id, payments.schoolId],
    }),
    foreignKey({
      name: "payment_allocations_invoice_fk",
      columns: [t.invoiceId, t.schoolId],
      foreignColumns: [invoices.id, invoices.schoolId],
    }),
    unique("payment_allocations_unique").on(t.paymentId, t.invoiceId),
    check("payment_allocations_amount", sql`${t.amount} <> 0`),
    index("payment_allocations_invoice_idx").on(t.invoiceId),
  ],
);

export const cancellationStatus = pgEnum("cancellation_status", [
  "pending",
  "approved",
  "rejected",
]);

/** Demande d'annulation d'un paiement (décision D7) : le comptable demande, le directeur décide. */
export const paymentCancellations = pgTable(
  "payment_cancellations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    paymentId: uuid("payment_id").notNull(),
    reason: text("reason").notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    status: cancellationStatus("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    reversalId: uuid("reversal_id").references(() => payments.id),
  },
  (t) => [
    foreignKey({
      name: "payment_cancellations_payment_fk",
      columns: [t.paymentId, t.schoolId],
      foreignColumns: [payments.id, payments.schoolId],
    }),
    // Une seule demande en attente par paiement.
    uniqueIndex("payment_cancellations_one_pending")
      .on(t.paymentId)
      .where(sql`${t.status} = 'pending'`),
    check(
      "payment_cancellations_decided",
      sql`${t.status} = 'pending' or (${t.decidedBy} is not null and ${t.decidedAt} is not null)`,
    ),
    check(
      "payment_cancellations_approved",
      sql`${t.status} <> 'approved' or ${t.reversalId} is not null`,
    ),
    index("payment_cancellations_school_idx").on(t.schoolId, t.status),
  ],
);
