import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { schools, users } from "./platform";
import { classes, classSubjects, periods } from "./settings";
import { enrollments } from "./students";

// Notes (M4, sous-étape 3b). Règles RLS et déclencheurs : migration « assessments_rls ».

/** Types d'évaluation (hypothèse H70) : interrogations et devoirs forment la « moyenne des devoirs ». */
export const assessmentKind = pgEnum("assessment_kind", ["quiz", "homework", "composition"]);

/**
 * Évaluation d'une matière dans une classe, pour une période. L'identifiant peut être créé sur le
 * téléphone de l'enseignant (saisie hors connexion, 3c).
 */
export const assessments = pgTable(
  "assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    academicYearId: uuid("academic_year_id").notNull(),
    periodId: uuid("period_id").notNull(),
    classId: uuid("class_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    kind: assessmentKind("kind").notNull(),
    /** Intitulé libre (ex. « Équations du 1er degré »), facultatif. */
    title: text("title"),
    date: date("date", { mode: "string" }).notNull(),
    /** Barème de l'évaluation (sur 20, sur 10, sur 40…) ; ramené au barème de l'école au calcul. */
    maxScore: integer("max_score").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "assessments_class_fk",
      columns: [t.classId, t.academicYearId, t.schoolId],
      foreignColumns: [classes.id, classes.academicYearId, classes.schoolId],
    }),
    // La matière est enseignée dans la classe (ligne de class_subjects).
    foreignKey({
      name: "assessments_class_subject_fk",
      columns: [t.classId, t.subjectId],
      foreignColumns: [classSubjects.classId, classSubjects.subjectId],
    }),
    // La période appartient à l'année de la classe.
    foreignKey({
      name: "assessments_period_fk",
      columns: [t.periodId, t.academicYearId, t.schoolId],
      foreignColumns: [periods.id, periods.academicYearId, periods.schoolId],
    }),
    unique("assessments_id_year_school").on(t.id, t.academicYearId, t.schoolId),
    check("assessments_max_score", sql`${t.maxScore} between 1 and 100`),
    index("assessments_class_subject_period_idx").on(t.classId, t.subjectId, t.periodId),
    index("assessments_school_idx").on(t.schoolId),
  ],
);

/** Note d'un élève : note, absent (non comptée, hypothèse D10 §5) ou dispensé. */
export const gradeStatus = pgEnum("grade_status", ["scored", "absent", "excused"]);

export const grades = pgTable(
  "grades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    academicYearId: uuid("academic_year_id").notNull(),
    assessmentId: uuid("assessment_id").notNull(),
    enrollmentId: uuid("enrollment_id").notNull(),
    status: gradeStatus("status").notNull(),
    /** Note sur le barème de l'évaluation, deux décimales au plus ; vide si absent ou dispensé. */
    score: numeric("score", { precision: 5, scale: 2, mode: "number" }),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "grades_assessment_fk",
      columns: [t.assessmentId, t.academicYearId, t.schoolId],
      foreignColumns: [assessments.id, assessments.academicYearId, assessments.schoolId],
    }).onDelete("cascade"),
    foreignKey({
      name: "grades_enrollment_fk",
      columns: [t.enrollmentId, t.academicYearId, t.schoolId],
      foreignColumns: [enrollments.id, enrollments.academicYearId, enrollments.schoolId],
    }),
    unique("grades_assessment_enrollment").on(t.assessmentId, t.enrollmentId),
    check(
      "grades_score_status",
      sql`(${t.status} = 'scored') = (${t.score} is not null) and (${t.score} is null or ${t.score} >= 0)`,
    ),
    index("grades_enrollment_idx").on(t.enrollmentId),
    index("grades_school_idx").on(t.schoolId),
  ],
);
