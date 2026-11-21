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
import {
  cancelInvoicesAfter,
  generateMandatoryInvoices,
  regenerateInvoices,
} from "@/modules/finance/invoices";
import { StudentError } from "./errors";
import { assertVisibleStudent, readContext, teacherStudentsFilter } from "./students";

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
    // Échéances obligatoires créées tout de suite : le paiement des frais d'inscription validera
    // l'inscription (décision A3).
    await generateMandatoryInvoices(tx, ctx.schoolId, row.id);
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
    await regenerateInvoices(tx, ctx.schoolId, enrollmentId);
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
    const cancelled = await cancelInvoicesAfter(tx, {
      enrollmentId,
      exitDate: data.date,
      userId: ctx.userId,
      reason: `Départ (${data.reason})`,
    });
    await tx.insert(auditLogs).values({
      schoolId: ctx.schoolId,
      actorUserId: ctx.userId,
      action: "enrollment.leave",
      entityType: "enrollment",
      entityId: enrollmentId,
      before: { status: row.status, classId: row.classId },
      after: { ...data, cancelledInvoices: cancelled },
    });
  });
}

// --- Liste des inscriptions et réinscription groupée (2b) --------------------------------------

export type EnrollmentRow = {
  id: string;
  studentId: string;
  matricule: string;
  lastName: string;
  firstNames: string;
  levelId: string;
  levelName: string;
  classId: string | null;
  className: string | null;
  status: EnrollmentStatus;
};

export type EnrollmentFilter = {
  status?: EnrollmentStatus;
  /** Inscrits sans classe (à affecter). */
  withoutClass?: boolean;
  classId?: string;
};

/** Inscriptions d'une année (l'enseignant ne voit que ses élèves), triées par nom. */
export async function listEnrollments(
  principal: Principal,
  academicYearId: string,
  filter: EnrollmentFilter = {},
): Promise<EnrollmentRow[]> {
  const ctx = readContext(principal);
  if (!isUuid(academicYearId)) return [];
  if (filter.classId !== undefined && !isUuid(filter.classId)) return [];
  return withSchool(ctx, (tx) =>
    tx
      .select({
        id: enrollments.id,
        studentId: students.id,
        matricule: students.matricule,
        lastName: students.lastName,
        firstNames: students.firstNames,
        levelId: enrollments.levelId,
        levelName: levels.name,
        classId: enrollments.classId,
        className: classes.name,
        status: enrollments.status,
      })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .innerJoin(levels, eq(levels.id, enrollments.levelId))
      .leftJoin(classes, eq(classes.id, enrollments.classId))
      .where(
        and(
          eq(enrollments.schoolId, ctx.schoolId),
          eq(enrollments.academicYearId, academicYearId),
          filter.status ? eq(enrollments.status, filter.status) : undefined,
          filter.withoutClass ? sql`${enrollments.classId} is null` : undefined,
          filter.classId ? eq(enrollments.classId, filter.classId) : undefined,
          ctx.teacherOnly ? teacherStudentsFilter(ctx.userId) : undefined,
        ),
      )
      .orderBy(asc(students.lastName), asc(students.firstNames)),
  );
}

/** Nombre d'inscriptions par état pour une année (onglets de la liste). */
export async function countEnrollments(
  principal: Principal,
  academicYearId: string,
): Promise<{ pre_enrolled: number; enrolled: number; withoutClass: number; left: number }> {
  const rows = await listEnrollments(principal, academicYearId);
  return {
    pre_enrolled: rows.filter((r) => r.status === "pre_enrolled").length,
    enrolled: rows.filter((r) => r.status === "enrolled").length,
    withoutClass: rows.filter((r) => r.status === "enrolled" && r.classId === null).length,
    left: rows.filter((r) => r.status === "left").length,
  };
}

export type ReEnrollDecision = { enrollmentId: string; levelId: string | null };

/**
 * Réinscription groupée : pour chaque élève d'une classe d'une autre année, une préinscription dans
 * l'année cible au niveau choisi (niveau suivant ou redoublement) ; `levelId: null` = ne revient pas.
 * Les élèves déjà inscrits dans l'année cible sont ignorés (comptés à part). Elle passera ensuite par
 * la validation habituelle (paiement des frais d'inscription, décision A3).
 */
export async function reEnrollClass(
  principal: Principal,
  input: { toYearId: string; decisions: readonly ReEnrollDecision[] },
): Promise<{ created: number; alreadyEnrolled: number }> {
  const ctx = context(principal, "students:write");
  return withSchool(ctx, async (tx) => {
    await writableYear(tx, ctx.schoolId, input.toYearId);
    let created = 0;
    let alreadyEnrolled = 0;
    for (const d of input.decisions) {
      if (d.levelId === null) continue;
      if (!isUuid(d.enrollmentId)) throw new StudentError("enrollmentNotFound");
      const [source] = await tx
        .select({
          studentId: enrollments.studentId,
          yearId: enrollments.academicYearId,
          status: enrollments.status,
        })
        .from(enrollments)
        .where(and(eq(enrollments.schoolId, ctx.schoolId), eq(enrollments.id, d.enrollmentId)));
      if (!source || source.yearId === input.toYearId) throw new StudentError("enrollmentNotFound");
      if (source.status === "left") continue;
      await checkLevel(tx, ctx.schoolId, d.levelId);
      const inserted = await tx
        .insert(enrollments)
        .values({
          schoolId: ctx.schoolId,
          studentId: source.studentId,
          academicYearId: input.toYearId,
          levelId: d.levelId,
          entryDate: todayInBrazzaville(),
        })
        .onConflictDoNothing({ target: [enrollments.studentId, enrollments.academicYearId] })
        .returning({ id: enrollments.id });
      if (inserted.length > 0) {
        await generateMandatoryInvoices(tx, ctx.schoolId, inserted[0].id);
        created++;
      } else alreadyEnrolled++;
    }
    return { created, alreadyEnrolled };
  });
}
