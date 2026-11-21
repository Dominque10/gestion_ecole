import { sql } from "drizzle-orm";
import {
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
import { schools } from "./platform";

// Paramétrage de l'école (M1). Règles RLS et déclencheurs : migration SQL « settings_rls ».

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/**
 * Cycle de vie d'une année : en préparation → active → archivée (lecture seule, définitif).
 * Une seule année active par école.
 */
export const academicYearStatus = pgEnum("academic_year_status", [
  "upcoming",
  "active",
  "archived",
]);
export const periodKind = pgEnum("period_kind", ["trimester", "semester"]);

export const academicYears = pgTable(
  "academic_years",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    /** Ex. « 2026-2027 ». */
    label: text("label").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    periodKind: periodKind("period_kind").notNull().default("trimester"),
    status: academicYearStatus("status").notNull().default("upcoming"),
    ...timestamps,
  },
  (t) => [
    unique("academic_years_school_label").on(t.schoolId, t.label),
    // Cible des clés étrangères composites (une période ne peut pas pointer vers l'année d'une autre école).
    unique("academic_years_id_school").on(t.id, t.schoolId),
    uniqueIndex("academic_years_one_active")
      .on(t.schoolId)
      .where(sql`${t.status} = 'active'`),
    check("academic_years_dates", sql`${t.startDate} < ${t.endDate}`),
  ],
);

/** Trimestres ou semestres d'une année, numérotés à partir de 1. */
export const periods = pgTable(
  "periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    academicYearId: uuid("academic_year_id").notNull(),
    position: integer("position").notNull(),
    label: text("label").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "periods_year_fk",
      columns: [t.academicYearId, t.schoolId],
      foreignColumns: [academicYears.id, academicYears.schoolId],
    }).onDelete("cascade"),
    unique("periods_year_position").on(t.academicYearId, t.position),
    unique("periods_id_school").on(t.id, t.schoolId),
    check("periods_position", sql`${t.position} >= 1`),
    check("periods_dates", sql`${t.startDate} <= ${t.endDate}`),
    index("periods_school_idx").on(t.schoolId),
  ],
);
