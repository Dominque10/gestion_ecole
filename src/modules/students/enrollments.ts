// Inscriptions (M2, 2b) : préinscription → inscription validée → affectation en classe ; départs.
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { todayInBrazzaville } from "@/lib/dates";
import { isValidDate } from "@/modules/settings/periods-logic";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool, type Tx } from "@/server/db/client";
import {
  academicYears,
  auditLogs,
  classes,
  enrollments,
  levels,
  students,
} from "@/server/db/schema";
import { StudentError } from "./errors";
import { assertVisibleStudent, readContext } from "./students";

export const EXIT_REASONS = ["transfer", "dropout", "expulsion"] as const;
export type ExitReason = (typeof EXIT_REASONS)[number];
export type EnrollmentStatus = "pre_enrolled" | "enrolled" | "left";

export type Enrollment = {
  id: string;
  academicYearId: string;
  yearLabel: string;
  yearStatus: "upcoming" | "active" | "archived";
  levelId: string;
  levelName: string;
  classId: string | null;
  className: string | null;
  status: EnrollmentStatus;
  validationMode: "manual" | "payment" | null;
  entryDate: string;
  exitDate: string | null;
  exitReason: ExitReason | null;
  exitNote: string | null;
};

export type ClassOption = { id: string; name: string; capacity: number | null; enrolled: number };

const isUuid = (value: string) => z.uuid().safeParse(value).success;

function context(
  principal: Principal,
  action: "students:read" | "students:write" | "enrollments:validate",
) {
  authorize(principal, action);
  return { schoolId: principal.schoolId as string, userId: principal.userId };
}

/** Une année archivée est en lecture seule (la base le garantit aussi). */
async function writableYear(tx: Tx, schoolId: string, yearId: string) {
  if (!isUuid(yearId)) throw new StudentError("yearNotFound");
  const [year] = await tx
    .select({ status: academicYears.status })
    .from(academicYears)
    .where(and(eq(academicYears.schoolId, schoolId), eq(academicYears.id, yearId)));
  if (!year) throw new StudentError("yearNotFound");
  if (year.status === "archived") throw new StudentError("yearArchived");
}

async function loadEnrollment(tx: Tx, schoolId: string, enrollmentId: string) {
  if (!isUuid(enrollmentId)) throw new StudentError("enrollmentNotFound");
  const [row] = await tx
    .select()
    .from(enrollments)
    .where(and(eq(enrollments.schoolId, schoolId), eq(enrollments.id, enrollmentId)))
    .for("update");
  if (!row) throw new StudentError("enrollmentNotFound");
  await writableYear(tx, schoolId, row.academicYearId);
  return row;
}

async function checkLevel(tx: Tx, schoolId: string, levelId: string) {
  if (!isUuid(levelId)) throw new StudentError("levelNotFound");
  const [level] = await tx
    .select({ id: levels.id })
    .from(levels)
    .where(and(eq(levels.schoolId, schoolId), eq(levels.id, levelId)));
  if (!level) throw new StudentError("levelNotFound");
}

export async function listStudentEnrollments(
  principal: Principal,
  studentId: string,
): Promise<Enrollment[]> {
  const ctx = readContext(principal);
  return withSchool(ctx, async (tx) => {
    await assertVisibleStudent(tx, ctx, studentId);
    return tx
      .select({
        id: enrollments.id,
        academicYearId: enrollments.academicYearId,
        yearLabel: academicYears.label,
        yearStatus: academicYears.status,
        levelId: enrollments.levelId,
        levelName: levels.name,
        classId: enrollments.classId,
        className: classes.name,
        status: enrollments.status,
        validationMode: enrollments.validationMode,
        entryDate: enrollments.entryDate,
        exitDate: enrollments.exitDate,
        exitReason: enrollments.exitReason,
        exitNote: enrollments.exitNote,
      })
      .from(enrollments)
      .innerJoin(academicYears, eq(academicYears.id, enrollments.academicYearId))
      .innerJoin(levels, eq(levels.id, enrollments.levelId))
      .leftJoin(classes, eq(classes.id, enrollments.classId))
      .where(and(eq(enrollments.schoolId, ctx.schoolId), eq(enrollments.studentId, studentId)))
      .orderBy(desc(academicYears.startDate));
  });
}

/** Préinscrit un élève pour une année, au niveau demandé. */
export async function preEnroll(
  principal: Principal,
  input: { studentId: string; academicYearId: string; levelId: string },
): Promise<string> {
  const ctx = context(principal, "students:write");
  return withSchool(ctx, async (tx) => {
    if (!isUuid(input.studentId)) throw new StudentError("notFound");
    const [student] = await tx
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.schoolId, ctx.schoolId), eq(students.id, input.studentId)));
    if (!student) throw new StudentError("notFound");
    await writableYear(tx, ctx.schoolId, input.academicYearId);
    await checkLevel(tx, ctx.schoolId, input.levelId);
    const [existing] = await tx
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.studentId, input.studentId),
          eq(enrollments.academicYearId, input.academicYearId),
        ),
      );
    if (existing) throw new StudentError("alreadyEnrolled");
    const [row] = await tx
      .insert(enrollments)
      .values({
        schoolId: ctx.schoolId,
        studentId: input.studentId,
        academicYearId: input.academicYearId,
        levelId: input.levelId,
        entryDate: todayInBrazzaville(),
      })
      .returning({ id: enrollments.id });
    return row.id;
  });
}

/** Change le niveau demandé, tant que l'inscription n'est pas validée. */
export async function changeEnrollmentLevel(
  principal: Principal,
  enrollmentId: string,
  levelId: string,
): Promise<void> {
  const ctx = context(principal, "students:write");
  await withSchool(ctx, async (tx) => {
    const row = await loadEnrollment(tx, ctx.schoolId, enrollmentId);
    if (row.status !== "pre_enrolled") throw new StudentError("notPreEnrolled");
    await checkLevel(tx, ctx.schoolId, levelId);
    await tx
      .update(enrollments)
      .set({ levelId, updatedAt: new Date() })
      .where(eq(enrollments.id, enrollmentId));
  });
}

/** Validation manuelle (décision A3), tracée dans le journal. */
export async function validateEnrollment(
  principal: Principal,
  enrollmentId: string,
): Promise<void> {
  const ctx = context(principal, "enrollments:validate");
  await withSchool(ctx, async (tx) => {
    const row = await loadEnrollment(tx, ctx.schoolId, enrollmentId);
    if (row.status !== "pre_enrolled") throw new StudentError("notPreEnrolled");
    await tx
      .update(enrollments)
      .set({
        status: "enrolled",
        validationMode: "manual",
        validatedAt: new Date(),
        validatedBy: ctx.userId,
        updatedAt: new Date(),
      })
      .where(eq(enrollments.id, enrollmentId));
    await tx.insert(auditLogs).values({
      schoolId: ctx.schoolId,
      actorUserId: ctx.userId,
      action: "enrollment.validate",
      entityType: "enrollment",
      entityId: enrollmentId,
      after: { mode: "manual" },
    });
  });
}

/** Classes possibles pour une inscription : même année, même niveau, avec les places occupées. */
export async function classOptions(
  principal: Principal,
  academicYearId: string,
  levelId: string,
): Promise<ClassOption[]> {
  const ctx = context(principal, "students:read");
  if (!isUuid(academicYearId) || !isUuid(levelId)) return [];
  return withSchool(ctx, (tx) =>
    tx
      .select({
        id: classes.id,
        name: classes.name,
        capacity: classes.capacity,
        enrolled: sql<number>`(select count(*)::int from enrollments e
          where e.class_id = "classes"."id" and e.status = 'enrolled')`,
      })
      .from(classes)
      .where(
        and(
          eq(classes.schoolId, ctx.schoolId),
          eq(classes.academicYearId, academicYearId),
          eq(classes.levelId, levelId),
        ),
      )
      .orderBy(asc(classes.name)),
  );
}

/**
 * Affecte (ou retire, avec null) la classe d'un élève inscrit. La classe doit être de la même année et
 * du même niveau ; l'effectif maximal est respecté (classe verrouillée pendant la vérification).
 */
export async function assignClass(
  principal: Principal,
  enrollmentId: string,
  classId: string | null,
): Promise<void> {
  const ctx = context(principal, "students:write");
  await withSchool(ctx, async (tx) => {
    const row = await loadEnrollment(tx, ctx.schoolId, enrollmentId);
    if (row.status !== "enrolled") throw new StudentError("notEnrolled");
    if (classId !== null) {
      if (!isUuid(classId)) throw new StudentError("classNotFound");
      const [target] = await tx
        .select({
          levelId: classes.levelId,
          yearId: classes.academicYearId,
          capacity: classes.capacity,
        })
        .from(classes)
        .where(and(eq(classes.schoolId, ctx.schoolId), eq(classes.id, classId)))
        .for("update");
      if (!target || target.yearId !== row.academicYearId) throw new StudentError("classNotFound");
      if (target.levelId !== row.levelId) throw new StudentError("classWrongLevel");
      if (target.capacity !== null) {
        const [{ n }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(enrollments)
          .where(
            and(
              eq(enrollments.classId, classId),
              eq(enrollments.status, "enrolled"),
              ne(enrollments.id, enrollmentId),
            ),
          );
        if (n >= target.capacity) throw new StudentError("classFull");
      }
    }
    await tx
      .update(enrollments)
      .set({ classId, updatedAt: new Date() })
      .where(eq(enrollments.id, enrollmentId));
  });
}

export const DepartureSchema = z.object({
  reason: z.enum(EXIT_REASONS),
  date: z.string().trim().refine(isValidDate),
  note: z
    .string()
    .trim()
    .max(300)
    .transform((v) => (v === "" ? null : v)),
});
/** Saisie brute du formulaire : le motif est vérifié par le schéma. */
export type DepartureInput = Omit<z.input<typeof DepartureSchema>, "reason"> & { reason: string };

/**
 * Départ d'un élève (transfert, abandon, exclusion), tracé. La classe reste dans l'historique ; les
 * échéances à venir seront annulées par la caisse (hypothèse H40, sous-étape 2c).
 */
export async function recordDeparture(
  principal: Principal,
  enrollmentId: string,
  input: DepartureInput,
): Promise<void> {
  const ctx = context(principal, "students:write");
  const data = DepartureSchema.parse(input);
  await withSchool(ctx, async (tx) => {
    const row = await loadEnrollment(tx, ctx.schoolId, enrollmentId);
    if (row.status === "left") throw new StudentError("alreadyLeft");
    if (data.date < row.entryDate) throw new StudentError("exitBeforeEntry");
    await tx
      .update(enrollments)
      .set({
        status: "left",
        exitDate: data.date,
        exitReason: data.reason,
        exitNote: data.note,
        updatedAt: new Date(),
      })
      .where(eq(enrollments.id, enrollmentId));
    await tx.insert(auditLogs).values({
      schoolId: ctx.schoolId,
      actorUserId: ctx.userId,
      action: "enrollment.leave",
      entityType: "enrollment",
      entityId: enrollmentId,
      before: { status: row.status, classId: row.classId },
      after: data,
    });
  });
}
