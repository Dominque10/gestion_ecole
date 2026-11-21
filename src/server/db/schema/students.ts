import { sql } from "drizzle-orm";
import {
  boolean,
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
