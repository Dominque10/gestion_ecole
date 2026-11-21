import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { schools, users } from "./platform";
import { academicYears, classes, levels } from "./settings";

// Élèves (M2). Règles RLS : migration SQL personnalisée « students_rls ».

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const sex = pgEnum("sex", ["M", "F"]);

/**
 * Fiche élève. Le matricule (CODE-AA-NNNNN, décision A6) est attribué une fois, jamais modifié ni
 * réutilisé ; la fiche n'est jamais supprimée (hypothèse H43).
 */
export const students = pgTable(
  "students",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    matricule: text("matricule").notNull(),
    lastName: text("last_name").notNull(),
    firstNames: text("first_names").notNull(),
    sex: sex("sex").notNull(),
    birthDate: date("birth_date", { mode: "string" }),
    birthPlace: text("birth_place"),
    nationality: text("nationality"),
    previousSchool: text("previous_school"),
    photoKey: text("photo_key"),
    /** Nom et matricule en minuscules sans accents, pour la recherche. */
    searchText: text("search_text").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("students_school_matricule").on(t.schoolId, t.matricule),
    unique("students_id_school").on(t.id, t.schoolId),
    index("students_school_search_idx").on(t.schoolId, t.searchText),
  ],
);

/** Données médicales (décision A4) : table séparée, lisible et modifiable par la direction seule. */
export const studentMedical = pgTable(
  "student_medical",
  {
    studentId: uuid("student_id").primaryKey(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    allergies: text("allergies"),
    treatments: text("treatments"),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "student_medical_student_fk",
      columns: [t.studentId, t.schoolId],
      foreignColumns: [students.id, students.schoolId],
    }),
  ],
);

/** Responsable légal, propre à l'école. Le compte parent commun (M6) passe par user_id. */
export const guardians = pgTable(
  "guardians",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    userId: uuid("user_id").references(() => users.id),
    fullName: text("full_name").notNull(),
    /** Téléphone principal, au format +242… (identifie le responsable dans l'école). */
    phone: text("phone").notNull(),
    otherPhone: text("other_phone"),
    /** Lien avec l'enfant (ex. « Mère », « Oncle »). */
    relationship: text("relationship"),
    ...timestamps,
  },
  (t) => [
    unique("guardians_school_phone").on(t.schoolId, t.phone),
    unique("guardians_id_school").on(t.id, t.schoolId),
  ],
);

/** Lien élève ↔ responsable ; un seul responsable principal par élève. */
export const studentGuardians = pgTable(
  "student_guardians",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    studentId: uuid("student_id").notNull(),
    guardianId: uuid("guardian_id").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "student_guardians_student_fk",
      columns: [t.studentId, t.schoolId],
      foreignColumns: [students.id, students.schoolId],
    }).onDelete("cascade"),
    foreignKey({
      name: "student_guardians_guardian_fk",
      columns: [t.guardianId, t.schoolId],
      foreignColumns: [guardians.id, guardians.schoolId],
    }),
    unique("student_guardians_unique").on(t.studentId, t.guardianId),
    uniqueIndex("student_guardians_one_primary")
      .on(t.studentId)
      .where(sql`${t.isPrimary}`),
    index("student_guardians_guardian_idx").on(t.guardianId),
  ],
);

export const documentKind = pgEnum("document_kind", ["birth_certificate", "report_card", "other"]);

/** Pièces jointes d'un élève (décision D6) : photos prises au téléphone. */
export const studentDocuments = pgTable(
  "student_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    studentId: uuid("student_id").notNull(),
    kind: documentKind("kind").notNull(),
    label: text("label"),
    fileKey: text("file_key").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "student_documents_student_fk",
      columns: [t.studentId, t.schoolId],
      foreignColumns: [students.id, students.schoolId],
    }),
    index("student_documents_student_idx").on(t.studentId),
  ],
);

// --- Inscriptions (2b) ------------------------------------------------------------------------

/** Préinscrit → inscrit (validé) → parti. */
export const enrollmentStatus = pgEnum("enrollment_status", ["pre_enrolled", "enrolled", "left"]);
/** Mode de validation (décision A3) : manuelle, ou automatique au paiement des frais d'inscription. */
export const validationMode = pgEnum("validation_mode", ["manual", "payment"]);
export const exitReason = pgEnum("exit_reason", ["transfer", "dropout", "expulsion"]);

/**
 * Inscription d'un élève pour une année : le pivot des notes, absences, échéances et bulletins.
 * Une seule par élève et par année.
 */
export const enrollments = pgTable(
  "enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    studentId: uuid("student_id").notNull(),
    academicYearId: uuid("academic_year_id").notNull(),
    levelId: uuid("level_id").notNull(),
    classId: uuid("class_id"),
    status: enrollmentStatus("status").notNull().default("pre_enrolled"),
    validationMode: validationMode("validation_mode"),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    validatedBy: uuid("validated_by").references(() => users.id),
    entryDate: date("entry_date", { mode: "string" }).notNull(),
    exitDate: date("exit_date", { mode: "string" }),
    exitReason: exitReason("exit_reason"),
    exitNote: text("exit_note"),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "enrollments_student_fk",
      columns: [t.studentId, t.schoolId],
      foreignColumns: [students.id, students.schoolId],
    }),
    foreignKey({
      name: "enrollments_year_fk",
      columns: [t.academicYearId, t.schoolId],
      foreignColumns: [academicYears.id, academicYears.schoolId],
    }),
    foreignKey({
      name: "enrollments_level_fk",
      columns: [t.levelId, t.schoolId],
      foreignColumns: [levels.id, levels.schoolId],
    }),
    // La classe appartient forcément à la même année et à la même école.
    foreignKey({
      name: "enrollments_class_fk",
      columns: [t.classId, t.academicYearId, t.schoolId],
      foreignColumns: [classes.id, classes.academicYearId, classes.schoolId],
    }),
    unique("enrollments_student_year").on(t.studentId, t.academicYearId),
    unique("enrollments_id_school").on(t.id, t.schoolId),
    unique("enrollments_id_year_school").on(t.id, t.academicYearId, t.schoolId),
    index("enrollments_class_idx").on(t.classId),
    index("enrollments_school_year_idx").on(t.schoolId, t.academicYearId),
    check(
      "enrollments_validated",
      sql`${t.status} <> 'enrolled' or (${t.validationMode} is not null and ${t.validatedAt} is not null)`,
    ),
    check(
      "enrollments_left",
      sql`${t.status} <> 'left' or (${t.exitDate} is not null and ${t.exitReason} is not null)`,
    ),
  ],
);
