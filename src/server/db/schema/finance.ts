import { sql } from "drizzle-orm";
import {
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
