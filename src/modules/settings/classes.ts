// Classes d'une année et affectation des enseignants (M1, 4d). Les matières d'une classe suivent la
// grille de son niveau + série (voir coefficients.ts).
import { and, arrayContains, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool, type Tx } from "@/server/db/client";
import {
  academicYears,
  classes,
  classSubjects,
  levels,
  levelSubjects,
  memberships,
  subjects,
  users,
} from "@/server/db/schema";
import { SeriesSchema, syncClassSubjects } from "./coefficients";
import { cycleRank } from "./defaults";
import { dbGuardCode, isForeignKeyViolation, isUniqueViolation, SettingsError } from "./errors";

export const ClassSchema = z.object({
  levelId: z.uuid(),
  series: SeriesSchema,
  name: z.string().trim().min(1).max(40),
  capacity: z
    .union([z.literal(""), z.coerce.number().int().min(1).max(500)])
    .transform((v) => (v === "" ? null : v)),
  headTeacherId: z.union([z.literal(""), z.uuid()]).transform((v) => (v === "" ? null : v)),
});
export type ClassInput = z.input<typeof ClassSchema>;

export type ClassSummary = {
  id: string;
  name: string;
  levelId: string;
  levelName: string;
  series: string;
  capacity: number | null;
  headTeacherId: string | null;
  headTeacherName: string | null;
  subjectCount: number;
};

export type ClassSubjectRow = {
  subjectId: string;
  subjectName: string;
  coefficient: number;
  teacherId: string | null;
};

export type Teacher = { id: string; name: string };

function context(principal: Principal, action: "settings:read" | "settings:write") {
  authorize(principal, action);
  return { schoolId: principal.schoolId as string, userId: principal.userId };
}

const isUuid = (value: string) => z.uuid().safeParse(value).success;

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (dbGuardCode(error) === "GS001") throw new SettingsError("yearArchived");
    if (isUniqueViolation(error, "classes_year_name")) throw new SettingsError("classNameTaken");
    if (isForeignKeyViolation(error)) throw new SettingsError("classInUse");
    throw error;
  }
}

/** Enseignants de l'école : membres ayant le rôle « enseignant » (accès Support exclu). */
async function teachersOf(tx: Tx, schoolId: string): Promise<Teacher[]> {
  return tx
    .select({ id: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.schoolId, schoolId), arrayContains(memberships.roles, ["teacher"])))
    .orderBy(asc(users.name));
}

async function assertTeacher(tx: Tx, schoolId: string, userId: string | null): Promise<void> {
  if (userId === null) return;
  const teachers = await teachersOf(tx, schoolId);
  if (!teachers.some((t) => t.id === userId)) throw new SettingsError("notTeacher");
}

async function writableYear(tx: Tx, schoolId: string, yearId: string): Promise<void> {
  if (!isUuid(yearId)) throw new SettingsError("yearNotFound");
  const [year] = await tx
    .select({ status: academicYears.status })
    .from(academicYears)
    .where(and(eq(academicYears.schoolId, schoolId), eq(academicYears.id, yearId)));
  if (!year) throw new SettingsError("yearNotFound");
  if (year.status === "archived") throw new SettingsError("yearArchived");
}

/** Vérifie le niveau et la série (série réservée au lycée, hypothèse). */
async function checkLevel(tx: Tx, schoolId: string, levelId: string, series: string) {
  const [level] = await tx
    .select({ cycle: levels.cycle })
    .from(levels)
    .where(and(eq(levels.schoolId, schoolId), eq(levels.id, levelId)));
  if (!level) throw new SettingsError("levelNotFound");
  if (level.cycle !== "lycee" && series !== "") throw new SettingsError("seriesInvalid");
}

async function loadClass(tx: Tx, schoolId: string, classId: string) {
  if (!isUuid(classId)) throw new SettingsError("classNotFound");
  const [row] = await tx
    .select()
    .from(classes)
    .where(and(eq(classes.schoolId, schoolId), eq(classes.id, classId)))
    .for("update");
  if (!row) throw new SettingsError("classNotFound");
  return row;
}

export async function listTeachers(principal: Principal): Promise<Teacher[]> {
  const ctx = context(principal, "settings:read");
  return withSchool(ctx, (tx) => teachersOf(tx, ctx.schoolId));
}

export async function listClasses(principal: Principal, yearId: string): Promise<ClassSummary[]> {
  const ctx = context(principal, "settings:read");
  if (!isUuid(yearId)) return [];
  return withSchool(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: classes.id,
        name: classes.name,
        levelId: classes.levelId,
        levelName: levels.name,
        levelCycle: levels.cycle,
        levelPosition: levels.position,
        series: classes.series,
        capacity: classes.capacity,
        headTeacherId: classes.headTeacherId,
        headTeacherName: users.name,
        subjectCount: sql<number>`(select count(*)::int from class_subjects cs where cs.class_id = ${classes.id})`,
      })
      .from(classes)
      .innerJoin(levels, eq(levels.id, classes.levelId))
      .leftJoin(users, eq(users.id, classes.headTeacherId))
      .where(and(eq(classes.schoolId, ctx.schoolId), eq(classes.academicYearId, yearId)));
    return rows
      .sort(
        (a, b) =>
          cycleRank(a.levelCycle) - cycleRank(b.levelCycle) ||
          a.levelPosition - b.levelPosition ||
          a.name.localeCompare(b.name, "fr", { numeric: true }),
      )
      .map((r) => ({
        id: r.id,
        name: r.name,
        levelId: r.levelId,
        levelName: r.levelName,
        series: r.series,
        capacity: r.capacity,
        headTeacherId: r.headTeacherId,
        headTeacherName: r.headTeacherName,
        subjectCount: r.subjectCount,
      }));
  });
}

export async function getClass(
  principal: Principal,
  classId: string,
): Promise<ClassSummary & { academicYearId: string; subjects: ClassSubjectRow[] }> {
  const ctx = context(principal, "settings:read");
  if (!isUuid(classId)) throw new SettingsError("classNotFound");
  return withSchool(ctx, async (tx) => {
    const [row] = await tx
      .select({
        id: classes.id,
        academicYearId: classes.academicYearId,
        name: classes.name,
        levelId: classes.levelId,
        levelName: levels.name,
        series: classes.series,
        capacity: classes.capacity,
        headTeacherId: classes.headTeacherId,
        headTeacherName: users.name,
      })
      .from(classes)
      .innerJoin(levels, eq(levels.id, classes.levelId))
      .leftJoin(users, eq(users.id, classes.headTeacherId))
      .where(and(eq(classes.schoolId, ctx.schoolId), eq(classes.id, classId)));
    if (!row) throw new SettingsError("classNotFound");
    const subjectRows = await tx
      .select({
        subjectId: classSubjects.subjectId,
        subjectName: subjects.name,
        coefficient: levelSubjects.coefficient,
        teacherId: classSubjects.teacherId,
      })
      .from(classSubjects)
      .innerJoin(subjects, eq(subjects.id, classSubjects.subjectId))
      .innerJoin(
        levelSubjects,
        and(
          eq(levelSubjects.academicYearId, row.academicYearId),
          eq(levelSubjects.levelId, row.levelId),
          eq(levelSubjects.series, row.series),
          eq(levelSubjects.subjectId, classSubjects.subjectId),
        ),
      )
      .where(eq(classSubjects.classId, classId))
      .orderBy(asc(subjects.name));
    return { ...row, subjectCount: subjectRows.length, subjects: subjectRows };
  });
}

/** Crée une classe ; ses matières sont reprises de la grille de son niveau + série. */
export async function createClass(
  principal: Principal,
  academicYearId: string,
  input: ClassInput,
): Promise<string> {
  const ctx = context(principal, "settings:write");
  const data = ClassSchema.parse(input);
  return guarded(() =>
    withSchool(ctx, async (tx) => {
      await writableYear(tx, ctx.schoolId, academicYearId);
      await checkLevel(tx, ctx.schoolId, data.levelId, data.series);
      await assertTeacher(tx, ctx.schoolId, data.headTeacherId);
      const [row] = await tx
        .insert(classes)
        .values({ schoolId: ctx.schoolId, academicYearId, ...data })
        .returning({ id: classes.id });
      await syncClassSubjects(tx, ctx.schoolId, {
        academicYearId,
        levelId: data.levelId,
        series: data.series,
      });
      return row.id;
    }),
  );
}

/**
 * Modifie une classe. Si le niveau ou la série change, ses matières suivent la nouvelle grille
 * (les affectations des matières retirées sont perdues, celles des matières gardées restent).
 */
export async function updateClass(
  principal: Principal,
  classId: string,
  input: ClassInput,
): Promise<void> {
  const ctx = context(principal, "settings:write");
  const data = ClassSchema.parse(input);
  await guarded(() =>
    withSchool(ctx, async (tx) => {
      const current = await loadClass(tx, ctx.schoolId, classId);
      await writableYear(tx, ctx.schoolId, current.academicYearId);
      await checkLevel(tx, ctx.schoolId, data.levelId, data.series);
      await assertTeacher(tx, ctx.schoolId, data.headTeacherId);
      await tx
        .update(classes)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(classes.id, classId));
      if (current.levelId !== data.levelId || current.series !== data.series) {
        await tx.delete(classSubjects).where(
          and(
            eq(classSubjects.classId, classId),
            sql`${classSubjects.subjectId} not in (
              select subject_id from level_subjects
              where academic_year_id = ${current.academicYearId}
                and level_id = ${data.levelId} and series = ${data.series})`,
          ),
        );
        await syncClassSubjects(tx, ctx.schoolId, {
          academicYearId: current.academicYearId,
          levelId: data.levelId,
          series: data.series,
        });
      }
    }),
  );
}

/** Supprime une classe (refusé plus tard si des élèves y sont inscrits). */
export async function deleteClass(principal: Principal, classId: string): Promise<void> {
  const ctx = context(principal, "settings:write");
  await guarded(() =>
    withSchool(ctx, async (tx) => {
      const current = await loadClass(tx, ctx.schoolId, classId);
      await writableYear(tx, ctx.schoolId, current.academicYearId);
      await tx.delete(classes).where(eq(classes.id, classId));
    }),
  );
}

/** Affecte (ou retire, avec null) l'enseignant d'une matière dans une classe. */
export async function assignTeachers(
  principal: Principal,
  classId: string,
  assignments: readonly { subjectId: string; teacherId: string | null }[],
): Promise<void> {
  const ctx = context(principal, "settings:write");
  await guarded(() =>
    withSchool(ctx, async (tx) => {
      const current = await loadClass(tx, ctx.schoolId, classId);
      await writableYear(tx, ctx.schoolId, current.academicYearId);
      const teacherIds = new Set((await teachersOf(tx, ctx.schoolId)).map((t) => t.id));
      for (const a of assignments) {
        if (!isUuid(a.subjectId)) throw new SettingsError("subjectNotFound");
        if (a.teacherId !== null && !teacherIds.has(a.teacherId)) {
          throw new SettingsError("notTeacher");
        }
        const updated = await tx
          .update(classSubjects)
          .set({ teacherId: a.teacherId, updatedAt: new Date() })
          .where(and(eq(classSubjects.classId, classId), eq(classSubjects.subjectId, a.subjectId)))
          .returning({ id: classSubjects.id });
        if (updated.length === 0) throw new SettingsError("subjectNotFound");
      }
    }),
  );
}
