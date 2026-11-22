import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  boolean,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { schools, users } from "./platform";

// Paramétrage de l'école (M1). Règles RLS et déclencheurs : migrations SQL personnalisées (*_rls).

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
    /** Dernier numéro de reçu de l'année (continu, sans trou, décision D6). */
    lastReceiptNumber: integer("last_receipt_number").notNull().default(0),
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
    // Cible des évaluations : la période appartient à l'année de la classe.
    unique("periods_id_year_school").on(t.id, t.academicYearId, t.schoolId),
    check("periods_position", sql`${t.position} >= 1`),
    check("periods_dates", sql`${t.startDate} <= ${t.endDate}`),
    index("periods_school_idx").on(t.schoolId),
  ],
);

// --- Structure pédagogique (4d) -------------------------------------------------------------

export const cycle = pgEnum("cycle", ["preschool", "primary", "college", "lycee"]);

/** Niveau d'enseignement (CP1, 6e, 1re…), propre à l'école, valable d'une année sur l'autre. */
export const levels = pgTable(
  "levels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    cycle: cycle("cycle").notNull(),
    name: text("name").notNull(),
    /** Ordre d'affichage (CP1 avant CP2…). */
    position: integer("position").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("levels_school_name").on(t.schoolId, t.name),
    unique("levels_id_school").on(t.id, t.schoolId),
  ],
);

/** Matière enseignée, propre à l'école. */
export const subjects = pgTable(
  "subjects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    name: text("name").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("subjects_school_name").on(t.schoolId, t.name),
    unique("subjects_id_school").on(t.id, t.schoolId),
  ],
);

/**
 * Grille des coefficients (décision D4) : pour une année, un niveau et une série, les matières
 * enseignées et leur coefficient. Toutes les classes de ce niveau + série partagent la grille.
 * Série vide ('') = pas de série (primaire, collège).
 */
export const levelSubjects = pgTable(
  "level_subjects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    academicYearId: uuid("academic_year_id").notNull(),
    levelId: uuid("level_id").notNull(),
    series: text("series").notNull().default(""),
    subjectId: uuid("subject_id").notNull(),
    coefficient: integer("coefficient").notNull(),
    /** Matière facultative : compte selon la règle de l'école (décision D10). */
    optional: boolean("optional").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "level_subjects_year_fk",
      columns: [t.academicYearId, t.schoolId],
      foreignColumns: [academicYears.id, academicYears.schoolId],
    }),
    foreignKey({
      name: "level_subjects_level_fk",
      columns: [t.levelId, t.schoolId],
      foreignColumns: [levels.id, levels.schoolId],
    }),
    foreignKey({
      name: "level_subjects_subject_fk",
      columns: [t.subjectId, t.schoolId],
      foreignColumns: [subjects.id, subjects.schoolId],
    }),
    unique("level_subjects_unique").on(t.academicYearId, t.levelId, t.series, t.subjectId),
    check("level_subjects_coefficient", sql`${t.coefficient} between 1 and 20`),
    index("level_subjects_school_idx").on(t.schoolId),
  ],
);

/** Classe d'une année (ex. « 1re C1 »). */
export const classes = pgTable(
  "classes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    academicYearId: uuid("academic_year_id").notNull(),
    levelId: uuid("level_id").notNull(),
    series: text("series").notNull().default(""),
    name: text("name").notNull(),
    /** Effectif maximal (facultatif). */
    capacity: integer("capacity"),
    /** Professeur principal (compte d'un enseignant de l'école). */
    headTeacherId: uuid("head_teacher_id").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "classes_year_fk",
      columns: [t.academicYearId, t.schoolId],
      foreignColumns: [academicYears.id, academicYears.schoolId],
    }),
    foreignKey({
      name: "classes_level_fk",
      columns: [t.levelId, t.schoolId],
      foreignColumns: [levels.id, levels.schoolId],
    }),
    unique("classes_year_name").on(t.academicYearId, t.name),
    unique("classes_id_year_school").on(t.id, t.academicYearId, t.schoolId),
    check("classes_capacity", sql`${t.capacity} is null or ${t.capacity} between 1 and 500`),
    index("classes_school_idx").on(t.schoolId),
  ],
);

/**
 * Matière enseignée dans une classe, avec l'enseignant affecté. Les lignes suivent la grille du
 * niveau + série de la classe (le coefficient se lit dans level_subjects).
 */
export const classSubjects = pgTable(
  "class_subjects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    /** Recopié de la classe (contrôlé par la clé composite) : protège les années archivées. */
    academicYearId: uuid("academic_year_id").notNull(),
    classId: uuid("class_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    teacherId: uuid("teacher_id").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "class_subjects_class_fk",
      columns: [t.classId, t.academicYearId, t.schoolId],
      foreignColumns: [classes.id, classes.academicYearId, classes.schoolId],
    }).onDelete("cascade"),
    foreignKey({
      name: "class_subjects_subject_fk",
      columns: [t.subjectId, t.schoolId],
      foreignColumns: [subjects.id, subjects.schoolId],
    }),
    unique("class_subjects_unique").on(t.classId, t.subjectId),
    index("class_subjects_school_idx").on(t.schoolId),
    index("class_subjects_teacher_idx").on(t.teacherId),
  ],
);

/**
 * Personnel (décision A1) : table minimale, sans écran en V1. Prépare la paie / RH de la V2.
 */
export const staff = pgTable(
  "staff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    name: text("name").notNull(),
    /** Fonction (ex. « Enseignant de mathématiques », « Gardien »). */
    jobTitle: text("job_title"),
    userId: uuid("user_id").references(() => users.id),
    ...timestamps,
  },
  (t) => [index("staff_school_idx").on(t.schoolId)],
);

// --- Créneaux et frais (4e) ------------------------------------------------------------------

/**
 * Créneau simple défini par l'école (décisions A1, A8) : libellé et horaires, utilisé par l'appel (M5).
 * Ce n'est pas un emploi du temps (ni classe, ni jour, ni salle).
 */
export const timeSlots = pgTable(
  "time_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    label: text("label").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("time_slots_school_label").on(t.schoolId, t.label),
    check("time_slots_times", sql`${t.startTime} < ${t.endTime}`),
  ],
);

/** Nature d'un frais : l'inscription servira à valider l'inscription au paiement (décision A3). */
export const feeKind = pgEnum("fee_kind", ["registration", "tuition", "other"]);

/**
 * Grille tarifaire : une ligne par tranche d'un frais, pour une année et un niveau.
 * Un frais = (année, niveau, nom) ; ses tranches sont numérotées à partir de 1.
 * Montants en francs CFA entiers (jamais de décimales).
 */
export const feeItems = pgTable(
  "fee_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    academicYearId: uuid("academic_year_id").notNull(),
    levelId: uuid("level_id").notNull(),
    kind: feeKind("kind").notNull(),
    name: text("name").notNull(),
    mandatory: boolean("mandatory").notNull().default(true),
    installmentNumber: integer("installment_number").notNull(),
    amount: integer("amount").notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fee_items_year_fk",
      columns: [t.academicYearId, t.schoolId],
      foreignColumns: [academicYears.id, academicYears.schoolId],
    }),
    foreignKey({
      name: "fee_items_level_fk",
      columns: [t.levelId, t.schoolId],
      foreignColumns: [levels.id, levels.schoolId],
    }),
    unique("fee_items_unique").on(t.academicYearId, t.levelId, t.name, t.installmentNumber),
    unique("fee_items_id_school").on(t.id, t.schoolId),
    check("fee_items_installment", sql`${t.installmentNumber} between 1 and 12`),
    check("fee_items_amount", sql`${t.amount} between 1 and 100000000`),
    index("fee_items_school_idx").on(t.schoolId),
  ],
);
