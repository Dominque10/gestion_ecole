// Appel (M5, sous-étape 3e) : par créneau (demi-journée ou cours), tous présents par défaut.
// Un enseignant fait l'appel des classes où il enseigne (ou dont il est professeur principal) ; la
// direction et le secrétariat, de toutes les classes. Une valeur changée entre-temps par quelqu'un
// d'autre n'est jamais écrasée (comme pour les notes) ; une absence programme le SMS du jour.
import { and, asc, eq, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool, type Tx } from "@/server/db/client";
import {
  academicYears,
  attendance,
  classes,
  classSubjects,
  enrollments,
  levels,
  students,
  subjects,
  timeSlots,
  users,
} from "@/server/db/schema";
import { dbGuardCode } from "@/modules/settings/errors";
import { todayInBrazzaville } from "@/lib/dates";
import { AttendanceError } from "./errors";
import { scheduleAbsenceNotice, type AbsenceNotice } from "./notices";
import { isRollStatus, type RollStatus, type RollValue } from "./roll-values";

type Ctx = { schoolId: string; userId: string; allClasses: boolean };

function rollContext(principal: Principal): Ctx {
  authorize(principal, "attendance:write");
  return {
    schoolId: principal.schoolId as string,
    userId: principal.userId,
    allClasses: principal.roles.some((r) => r === "director" || r === "secretary"),
  };
}

const isUuid = (value: string) => z.uuid().safeParse(value).success;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/** Classes où l'enseignant fait l'appel : professeur principal, ou il y enseigne une matière. */
function teacherClass(ctx: Ctx): SQL | undefined {
  if (ctx.allClasses) return undefined;
  return or(
    eq(classes.headTeacherId, ctx.userId),
    // Colonne qualifiée en toutes lettres : dans une sous-requête, « id » seul viserait cs.id.
    sql`exists (select 1 from class_subjects cs where cs.class_id = "classes"."id" and cs.teacher_id = ${ctx.userId})`,
  );
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (dbGuardCode(error) === "GS001") throw new AttendanceError("yearArchived");
    throw error;
  }
}

export type RollClass = { classId: string; className: string; levelName: string };

/** Classes de l'année active où le lecteur peut faire l'appel. */
export async function listRollClasses(principal: Principal): Promise<RollClass[]> {
  const ctx = rollContext(principal);
  return withSchool(ctx, (tx) =>
    tx
      .select({ classId: classes.id, className: classes.name, levelName: levels.name })
      .from(classes)
      .innerJoin(levels, eq(levels.id, classes.levelId))
      .innerJoin(academicYears, eq(academicYears.id, classes.academicYearId))
      .where(
        and(
          eq(classes.schoolId, ctx.schoolId),
          eq(academicYears.status, "active"),
          teacherClass(ctx),
        ),
      )
      .orderBy(asc(levels.position), asc(classes.name)),
  );
}

type ClassRow = {
  classId: string;
  className: string;
  academicYearId: string;
  yearStatus: "upcoming" | "active" | "archived";
  yearStart: string;
  yearEnd: string;
};

async function loadClass(tx: Tx, ctx: Ctx, classId: string): Promise<ClassRow> {
  if (!isUuid(classId)) throw new AttendanceError("classNotFound");
  const [row] = await tx
    .select({
      classId: classes.id,
      className: classes.name,
      academicYearId: classes.academicYearId,
      yearStatus: academicYears.status,
      yearStart: academicYears.startDate,
      yearEnd: academicYears.endDate,
    })
    .from(classes)
    .innerJoin(academicYears, eq(academicYears.id, classes.academicYearId))
    .where(and(eq(classes.schoolId, ctx.schoolId), eq(classes.id, classId), teacherClass(ctx)));
  if (!row) throw new AttendanceError("classNotFound");
  return row;
}

export type RollSetup = ClassRow & {
  slots: { id: string; label: string; startTime: string; endTime: string }[];
  /** Matières pour l'appel par cours (les siennes pour un enseignant). */
  subjects: { classSubjectId: string; name: string }[];
  students: { enrollmentId: string; lastName: string; firstNames: string }[];
  today: string;
};

/** Ce qu'il faut pour faire l'appel d'une classe (aussi gardé sur le téléphone, hors connexion). */
export async function getRollSetup(principal: Principal, classId: string): Promise<RollSetup> {
  const ctx = rollContext(principal);
  return withSchool(ctx, async (tx) => {
    const c = await loadClass(tx, ctx, classId);
    const slots = await tx
      .select({
        id: timeSlots.id,
        label: timeSlots.label,
        startTime: timeSlots.startTime,
        endTime: timeSlots.endTime,
      })
      .from(timeSlots)
      .where(eq(timeSlots.schoolId, ctx.schoolId))
      .orderBy(asc(timeSlots.startTime));
    const subjectRows = await tx
      .select({ classSubjectId: classSubjects.id, name: subjects.name })
      .from(classSubjects)
      .innerJoin(subjects, eq(subjects.id, classSubjects.subjectId))
      .where(
        and(
          eq(classSubjects.classId, classId),
          ctx.allClasses ? undefined : eq(classSubjects.teacherId, ctx.userId),
        ),
      )
      .orderBy(asc(subjects.name));
    const roster = await tx
      .select({
        enrollmentId: enrollments.id,
        lastName: students.lastName,
        firstNames: students.firstNames,
      })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(and(eq(enrollments.classId, classId), eq(enrollments.status, "enrolled")))
      .orderBy(asc(students.lastName), asc(students.firstNames));
    return { ...c, slots, subjects: subjectRows, students: roster, today: todayInBrazzaville() };
  });
}

export type RollCallKey = {
  classId: string;
  date: string;
  slotId: string;
  /** Appel par cours (facultatif). */
  classSubjectId?: string | null;
};

/** La date est dans l'année et pas dans le futur (hypothèse H91) ; le créneau est de l'école. */
async function checkKey(tx: Tx, ctx: Ctx, c: ClassRow, key: RollCallKey) {
  if (!isoDate.test(key.date) || key.date > todayInBrazzaville()) {
    throw new AttendanceError("dateInvalid");
  }
  if (key.date < c.yearStart || key.date > c.yearEnd) throw new AttendanceError("dateInvalid");
  if (!isUuid(key.slotId)) throw new AttendanceError("slotNotFound");
  const [slot] = await tx
    .select({ id: timeSlots.id })
    .from(timeSlots)
    .where(and(eq(timeSlots.schoolId, ctx.schoolId), eq(timeSlots.id, key.slotId)));
  if (!slot) throw new AttendanceError("slotNotFound");
  if (key.classSubjectId) {
    if (!isUuid(key.classSubjectId)) throw new AttendanceError("subjectNotFound");
    const [cs] = await tx
      .select({ id: classSubjects.id })
      .from(classSubjects)
      .where(
        and(
          eq(classSubjects.id, key.classSubjectId),
          eq(classSubjects.classId, c.classId),
          ctx.allClasses ? undefined : eq(classSubjects.teacherId, ctx.userId),
        ),
      );
    if (!cs) throw new AttendanceError("subjectNotFound");
  }
}

type StoredMark = { enrollmentId: string; status: RollStatus; justified: boolean };

async function storedMarks(tx: Tx, classId: string, date: string, slotId: string, lock = false) {
  const query = tx
    .select({
      enrollmentId: attendance.enrollmentId,
      status: attendance.status,
      justified: attendance.justified,
    })
    .from(attendance)
    .innerJoin(enrollments, eq(enrollments.id, attendance.enrollmentId))
    .where(
      and(
        eq(enrollments.classId, classId),
        eq(attendance.date, date),
        eq(attendance.timeSlotId, slotId),
      ),
    );
  return (lock ? query.for("update", { of: attendance }) : query) as Promise<StoredMark[]>;
}

export type RollCall = {
  /** Valeur enregistrée par élève (« » = appel pas fait pour lui). */
  values: Record<string, RollValue>;
  justified: string[];
  recordedByName: string | null;
  classSubjectId: string | null;
};

export async function getRollCall(principal: Principal, key: RollCallKey): Promise<RollCall> {
  const ctx = rollContext(principal);
  return withSchool(ctx, async (tx) => {
    const c = await loadClass(tx, ctx, key.classId);
    await checkKey(tx, ctx, c, { ...key, classSubjectId: null });
    const marks = await storedMarks(tx, key.classId, key.date, key.slotId);
    const [last] = await tx
      .select({ name: users.name, classSubjectId: attendance.classSubjectId })
      .from(attendance)
      .innerJoin(enrollments, eq(enrollments.id, attendance.enrollmentId))
      .innerJoin(users, eq(users.id, attendance.recordedBy))
      .where(
        and(
          eq(enrollments.classId, key.classId),
          eq(attendance.date, key.date),
          eq(attendance.timeSlotId, key.slotId),
        ),
      )
      .orderBy(sql`${attendance.updatedAt} desc`)
      .limit(1);
    return {
      values: Object.fromEntries(marks.map((m) => [m.enrollmentId, m.status])),
      justified: marks.filter((m) => m.justified).map((m) => m.enrollmentId),
      recordedByName: last?.name ?? null,
      classSubjectId: last?.classSubjectId ?? null,
    };
  });
}

export type RollEntry = { enrollmentId: string; expected: string; value: string };

export type SaveRollResult = {
  saved: number;
  /** Lignes changées entre-temps par quelqu'un d'autre : laissées telles quelles, valeur actuelle. */
  conflicts: { enrollmentId: string; current: RollValue }[];
};

/**
 * Enregistre l'appel. Une ligne dont la valeur a changé sur le serveur depuis l'ouverture de l'appel
 * n'est pas remplacée (conflit rendu). Chaque nouvelle absence programme le SMS du jour.
 */
export async function saveRollCall(
  principal: Principal,
  key: RollCallKey,
  entries: readonly RollEntry[],
  schedule: (notice: AbsenceNotice) => Promise<void> = scheduleAbsenceNotice,
): Promise<SaveRollResult> {
  const ctx = rollContext(principal);
  for (const e of entries) {
    if (!isRollStatus(e.value) || (e.expected !== "" && !isRollStatus(e.expected))) {
      throw new AttendanceError("statusInvalid");
    }
  }
  const absences: string[] = [];
  const result = await guarded(() =>
    withSchool(ctx, async (tx) => {
      const c = await loadClass(tx, ctx, key.classId);
      await checkKey(tx, ctx, c, key);
      const allowed = new Set(
        (
          await tx
            .select({ id: enrollments.id })
            .from(enrollments)
            .where(and(eq(enrollments.classId, key.classId), eq(enrollments.status, "enrolled")))
        ).map((e) => e.id),
      );
      if (entries.some((e) => !allowed.has(e.enrollmentId))) {
        throw new AttendanceError("studentNotInClass");
      }
      const current = new Map(
        (await storedMarks(tx, key.classId, key.date, key.slotId, true)).map((m) => [
          m.enrollmentId,
          m,
        ]),
      );
      const conflicts: SaveRollResult["conflicts"] = [];
      let saved = 0;
      for (const entry of entries) {
        const now: RollValue = current.get(entry.enrollmentId)?.status ?? "";
        const value = entry.value as RollStatus;
        if (now === value) continue;
        if (now !== entry.expected) {
          conflicts.push({ enrollmentId: entry.enrollmentId, current: now });
          continue;
        }
        // Un élève finalement présent n'a plus d'absence à justifier.
        const clearJustification =
          value === "present"
            ? {
                justified: false,
                justificationReason: null,
                justificationDocumentId: null,
                justifiedBy: null,
                justifiedAt: null,
              }
            : {};
        await tx
          .insert(attendance)
          .values({
            schoolId: ctx.schoolId,
            academicYearId: c.academicYearId,
            enrollmentId: entry.enrollmentId,
            date: key.date,
            timeSlotId: key.slotId,
            classSubjectId: key.classSubjectId ?? null,
            status: value,
            recordedBy: ctx.userId,
          })
          .onConflictDoUpdate({
            target: [attendance.enrollmentId, attendance.date, attendance.timeSlotId],
            set: {
              status: value,
              classSubjectId: key.classSubjectId ?? null,
              recordedBy: ctx.userId,
              updatedAt: new Date(),
              ...clearJustification,
            },
          });
        if (value === "absent") absences.push(entry.enrollmentId);
        saved++;
      }
      return { saved, conflicts };
    }),
  );
  // Après l'enregistrement : un SMS manqué ne doit jamais faire perdre l'appel.
  for (const enrollmentId of absences) {
    await schedule({
      schoolId: ctx.schoolId,
      userId: ctx.userId,
      enrollmentId,
      date: key.date,
    }).catch((error: unknown) =>
      console.error("SMS d'absence non programmé :", (error as Error).message),
    );
  }
  return result;
}
