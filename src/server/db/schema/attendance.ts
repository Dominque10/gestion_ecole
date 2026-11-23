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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { schools, users } from "./platform";
import { classSubjects, timeSlots } from "./settings";
import { enrollments, guardians, studentDocuments } from "./students";

// Appel et absences (M5, sous-étape 3e). Règles RLS : migration « attendance_rls ».

export const attendanceStatus = pgEnum("attendance_status", ["present", "absent", "late"]);

/**
 * Appel : une ligne par élève, par jour et par créneau (décisions A1, A8). Tous les élèves de la classe
 * sont enregistrés (présents compris) : on sait ainsi que l'appel a été fait. `class_subject_id`
 * facultatif : appel par cours. Justification d'une absence ou d'un retard par le secrétariat.
 */
export const attendance = pgTable(
  "attendance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    academicYearId: uuid("academic_year_id").notNull(),
    enrollmentId: uuid("enrollment_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    timeSlotId: uuid("time_slot_id")
      .notNull()
      .references(() => timeSlots.id),
    classSubjectId: uuid("class_subject_id").references(() => classSubjects.id),
    status: attendanceStatus("status").notNull(),
    recordedBy: uuid("recorded_by")
      .notNull()
      .references(() => users.id),
    justified: boolean("justified").notNull().default(false),
    justificationReason: text("justification_reason"),
    /** Pièce justificative (photo), rangée avec les pièces de l'élève. */
    justificationDocumentId: uuid("justification_document_id").references(
      () => studentDocuments.id,
    ),
    justifiedBy: uuid("justified_by").references(() => users.id),
    justifiedAt: timestamp("justified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "attendance_enrollment_fk",
      columns: [t.enrollmentId, t.academicYearId, t.schoolId],
      foreignColumns: [enrollments.id, enrollments.academicYearId, enrollments.schoolId],
    }),
    unique("attendance_enrollment_day_slot").on(t.enrollmentId, t.date, t.timeSlotId),
    check(
      "attendance_justified",
      sql`not ${t.justified} or (${t.status} <> 'present' and ${t.justificationReason} is not null and ${t.justifiedBy} is not null and ${t.justifiedAt} is not null)`,
    ),
    index("attendance_school_date_idx").on(t.schoolId, t.date),
  ],
);

export const notificationKind = pgEnum("notification_kind", [
  "absence",
  "receipt",
  "bulletin",
  "announcement",
]);
/** skipped : pas envoyé (plafond mensuel de l'école atteint, 4d). */
export const notificationStatus = pgEnum("notification_status", ["sent", "failed", "skipped"]);
export const notificationChannel = pgEnum("notification_channel", ["sms", "whatsapp"]);

/**
 * Messages envoyés aux parents, journalisés avec leur coût (4d) : absence (D15 : un par élève et par
 * jour), reçu de paiement, bulletin publié, annonce. Les contraintes d'unicité empêchent tout doublon.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    kind: notificationKind("kind").notNull(),
    enrollmentId: uuid("enrollment_id").notNull(),
    /** Jour concerné (absences du jour). */
    date: date("date", { mode: "string" }).notNull(),
    guardianId: uuid("guardian_id").references(() => guardians.id),
    phone: text("phone").notNull(),
    body: text("body").notNull(),
    status: notificationStatus("status").notNull(),
    channel: notificationChannel("channel").notNull().default("sms"),
    /** Coût de l'envoi en FCFA (refacturation ou plafond par école). */
    cost: integer("cost").notNull().default(0),
    /** Objet concerné : paiement (reçu), fiche de bulletin, annonce. */
    referenceId: uuid("reference_id"),
    /** Référence donnée par le prestataire SMS. */
    providerRef: text("provider_ref"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "notifications_enrollment_fk",
      columns: [t.enrollmentId, t.schoolId],
      foreignColumns: [enrollments.id, enrollments.schoolId],
    }),
    // Un seul message d'absence par élève et par jour ; un seul message par objet et par élève.
    uniqueIndex("notifications_absence_day")
      .on(t.enrollmentId, t.date)
      .where(sql`${t.kind} = 'absence'`),
    uniqueIndex("notifications_reference")
      .on(t.kind, t.referenceId, t.enrollmentId)
      .where(sql`${t.referenceId} is not null`),
    check("notifications_cost", sql`${t.cost} >= 0`),
    index("notifications_school_idx").on(t.schoolId, t.createdAt),
  ],
);
