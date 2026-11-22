// Ã‰valuations et saisie des notes (M4, sous-Ã©tape 3b).
// Un enseignant ne voit et ne note que les matiÃ¨res qu'il enseigne dans ses classes ; le directeur,
// toute l'Ã©cole (CLAUDE.md Â§6, Droits). Une note modifiÃ©e entre-temps par quelqu'un d'autre n'est
// jamais Ã©crasÃ©e : le conflit est rendu Ã  l'utilisateur (CLAUDE.md Â§6, Hors-ligne).
import { and, asc, count, desc, eq, inArray, max, type SQL } from "drizzle-orm";
import { z } from "zod";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool, type Tx } from "@/server/db/client";
import {
  academicYears,
  assessments,
  auditLogs,
  classes,
  classSubjects,
  enrollments,
  grades,
  levels,
  periods,
  students,
  subjects,
  users,
} from "@/server/db/schema";
import { dbGuardCode } from "@/modules/settings/errors";
import { todayInBrazzaville } from "@/lib/dates";
import { GradingError } from "./errors";
import {
  ASSESSMENT_KINDS,
  formatGradeValue,
  gradeValueOf,
  parseGradeInput,
  sameGradeValue,
  type AssessmentKind,
  type GradeInputProblem,
  type GradeStatus,
  type GradeValue,
} from "./grade-input";
import { loadGradingRules } from "./settings";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const AssessmentInputSchema = z.object({
  periodId: z.uuid(),
  kind: z.enum(ASSESSMENT_KINDS),
  title: z
    .string()
    .trim()
    .max(80)
    .transform((s) => (s === "" ? null : s)),
  date: isoDate,
  maxScore: z.coerce.number().int().min(1).max(100),
});
export type AssessmentInput = z.input<typeof AssessmentInputSchema>;

type Ctx = { schoolId: string; userId: string; allCourses: boolean };

/** Le directeur voit toutes les matiÃ¨res ; un enseignant, celles qu'il enseigne. */
function gradingContext(principal: Principal, action: "grades:write" | "assessments:manage"): Ctx {
  authorize(principal, action);
  return {
    schoolId: principal.schoolId as string,
    userId: principal.userId,
    allCourses: principal.roles.includes("director"),
  };
}

const isUuid = (value: string) => z.uuid().safeParse(value).success;

/** MatiÃ¨re d'une classe enseignÃ©e par le lecteur (filtre sur class_subjects). */
function ownCourse(ctx: Ctx): SQL | undefined {
  return ctx.allCourses ? undefined : eq(classSubjects.teacherId, ctx.userId);
}

/** Traduit le garde-fou Â« annÃ©e archivÃ©e Â» de la base en refus mÃ©tier. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (dbGuardCode(error) === "GS001") throw new GradingError("yearArchived");
    throw error;
  }
}

// --- MatiÃ¨res Ã  noter -----------------------------------------------------------------------

export type Course = {
  classId: string;
  className: string;
  levelName: string;
  subjectId: string;
  subjectName: string;
  teacherName: string | null;
};

/** MatiÃ¨res Ã  noter dans l'annÃ©e active : les siennes pour un enseignant, toutes pour le directeur. */
export async function listCourses(principal: Principal): Promise<Course[]> {
  const ctx = gradingContext(principal, "grades:write");
  return withSchool(ctx, (tx) =>
    tx
      .select({
        classId: classes.id,
        className: classes.name,
        levelName: levels.name,
        subjectId: subjects.id,
        subjectName: subjects.name,
        teacherName: users.name,
      })
      .from(classSubjects)
      .innerJoin(classes, eq(classes.id, classSubjects.classId))
      .innerJoin(levels, eq(levels.id, classes.levelId))
      .innerJoin(subjects, eq(subjects.id, classSubjects.subjectId))
      .innerJoin(academicYears, eq(academicYears.id, classSubjects.academicYearId))
      .leftJoin(users, eq(users.id, classSubjects.teacherId))
      .where(
        and(
          eq(classSubjects.schoolId, ctx.schoolId),
          eq(academicYears.status, "active"),
          ownCourse(ctx),
        ),
      )
      .orderBy(asc(levels.position), asc(classes.name), asc(subjects.name)),
  );
}

type CourseRow = Course & {
  academicYearId: string;
  yearStatus: "upcoming" | "active" | "archived";
  yearStart: string;
  yearEnd: string;
  cycle: "preschool" | "primary" | "college" | "lycee";
};

async function loadCourse(
  tx: Tx,
  ctx: Ctx,
  classId: string,
  subjectId: string,
): Promise<CourseRow> {
  if (!isUuid(classId) || !isUuid(subjectId)) throw new GradingError("courseNotFound");
  const [row] = await tx
    .select({
      classId: classes.id,
      className: classes.name,
      levelName: levels.name,
      subjectId: subjects.id,
      subjectName: subjects.name,
      teacherName: users.name,
      academicYearId: academicYears.id,
      yearStatus: academicYears.status,
      yearStart: academicYears.startDate,
      yearEnd: academicYears.endDate,
      cycle: levels.cycle,
    })
    .from(classSubjects)
    .innerJoin(classes, eq(classes.id, classSubjects.classId))
    .innerJoin(levels, eq(levels.id, classes.levelId))
    .innerJoin(subjects, eq(subjects.id, classSubjects.subjectId))
    .innerJoin(academicYears, eq(academicYears.id, classSubjects.academicYearId))
    .leftJoin(users, eq(users.id, classSubjects.teacherId))
    .where(
      and(
        eq(classSubjects.schoolId, ctx.schoolId),
        eq(classSubjects.classId, classId),
        eq(classSubjects.subjectId, subjectId),
        ownCourse(ctx),
      ),
    );
  if (!row) throw new GradingError("courseNotFound");
  return row;
}

export type PeriodOption = { id: string; label: string; startDate: string; endDate: string };

export type AssessmentSummary = {
  id: string;
  periodId: string;
  kind: AssessmentKind;
  title: string | null;
  date: string;
  maxScore: number;
  /** Ã‰lÃ¨ves ayant une note, une absence ou une dispense. */
  filled: number;
};

export type CourseDetail = Course & {
  yearStatus: "upcoming" | "active" | "archived";
  periods: PeriodOption[];
  /** PÃ©riode qui contient aujourd'hui (sinon la derniÃ¨re commencÃ©e, sinon la premiÃ¨re). */
  currentPeriodId: string | null;
  /** BarÃ¨me proposÃ© pour une nouvelle Ã©valuation (sur 20 ; sur 10 au primaire si l'Ã©cole l'a choisi). */
  defaultMaxScore: number;
  studentCount: number;
  assessments: AssessmentSummary[];
};

/** PÃ©riode par dÃ©faut : celle du jour, sinon la derniÃ¨re commencÃ©e, sinon la premiÃ¨re. */
export function currentPeriod(list: readonly PeriodOption[], today: string): string | null {
  const ongoing = list.find((p) => p.startDate <= today && today <= p.endDate);
  if (ongoing) return ongoing.id;
  const started = list.filter((p) => p.startDate <= today);
  return (started.at(-1) ?? list[0])?.id ?? null;
}

async function loadPeriods(tx: Tx, yearId: string): Promise<PeriodOption[]> {
  return tx
    .select({
      id: periods.id,
      label: periods.label,
      startDate: periods.startDate,
      endDate: periods.endDate,
    })
    .from(periods)
    .where(eq(periods.academicYearId, yearId))
    .orderBy(asc(periods.position));
}

/** Ã‰lÃ¨ves inscrits dans la classe (ceux qu'on peut noter). */
function enrolledIn(classId: string): SQL {
  return and(eq(enrollments.classId, classId), eq(enrollments.status, "enrolled")) as SQL;
}

export async function getCourse(
  principal: Principal,
  classId: string,
  subjectId: string,
): Promise<CourseDetail> {
  const ctx = gradingContext(principal, "grades:write");
  return withSchool(ctx, async (tx) => {
    const course = await loadCourse(tx, ctx, classId, subjectId);
    const yearPeriods = await loadPeriods(tx, course.academicYearId);
    const rules = await loadGradingRules(tx, ctx.schoolId);
    const [{ n }] = await tx.select({ n: count() }).from(enrollments).where(enrolledIn(classId));
    const list = await tx
      .select({
        id: assessments.id,
        periodId: assessments.periodId,
        kind: assessments.kind,
        title: assessments.title,
        date: assessments.date,
        maxScore: assessments.maxScore,
        filled: count(grades.id),
      })
      .from(assessments)
      .leftJoin(grades, eq(grades.assessmentId, assessments.id))
      .where(and(eq(assessments.classId, classId), eq(assessments.subjectId, subjectId)))
      .groupBy(assessments.id)
      .orderBy(desc(assessments.date), desc(assessments.createdAt));
    const primary = course.cycle === "primary" || course.cycle === "preschool";
    return {
      classId: course.classId,
      className: course.className,
      levelName: course.levelName,
      subjectId: course.subjectId,
      subjectName: course.subjectName,
      teacherName: course.teacherName,
      yearStatus: course.yearStatus,
      periods: yearPeriods,
      currentPeriodId: currentPeriod(yearPeriods, todayInBrazzaville()),
      defaultMaxScore: primary ? rules.primaryScale : 20,
      studentCount: n,
      assessments: list,
    };
  });
}

// --- Ã‰valuations ----------------------------------------------------------------------------

type ParsedAssessment = z.output<typeof AssessmentInputSchema>;

function parseAssessment(input: unknown): ParsedAssessment {
  const parsed = AssessmentInputSchema.safeParse(input);
  if (!parsed.success) throw new GradingError("assessmentInvalid");
  return parsed.data;
}

/** La pÃ©riode est de l'annÃ©e de la classe et la date tombe dans l'annÃ©e (hypothÃ¨se H75). */
async function checkPeriodAndDate(
  tx: Tx,
  course: Pick<CourseRow, "academicYearId" | "yearStart" | "yearEnd">,
  input: ParsedAssessment,
) {
  const [period] = await tx
    .select({ id: periods.id })
    .from(periods)
    .where(and(eq(periods.id, input.periodId), eq(periods.academicYearId, course.academicYearId)));
  if (!period) throw new GradingError("periodNotFound");
  if (input.date < course.yearStart || input.date > course.yearEnd) {
    throw new GradingError("dateOutsideYear");
  }
}

/**
 * CrÃ©e une Ã©valuation dans l'annÃ©e active. L'identifiant peut venir du tÃ©lÃ©phone (saisie hors
 * connexion) : renvoyer la mÃªme Ã©valuation deux fois ne la crÃ©e qu'une fois.
 */
export async function createAssessment(
  principal: Principal,
  classId: string,
  subjectId: string,
  input: unknown,
  id: string = crypto.randomUUID(),
): Promise<string> {
  const ctx = gradingContext(principal, "assessments:manage");
  const data = parseAssessment(input);
  if (!isUuid(id)) throw new GradingError("assessmentInvalid");
  return guarded(() =>
    withSchool(ctx, async (tx) => {
      const course = await loadCourse(tx, ctx, classId, subjectId);
      if (course.yearStatus !== "active") throw new GradingError("yearNotActive");
      await checkPeriodAndDate(tx, course, data);
      await tx
        .insert(assessments)
        .values({
          id,
          schoolId: ctx.schoolId,
          academicYearId: course.academicYearId,
          classId,
          subjectId,
          createdBy: ctx.userId,
          ...data,
        })
        .onConflictDoNothing({ target: assessments.id });
      return id;
    }),
  );
}

type AssessmentRow = {
  id: string;
  academicYearId: string;
  classId: string;
  subjectId: string;
  periodId: string;
  periodLabel: string;
  kind: AssessmentKind;
  title: string | null;
  date: string;
  maxScore: number;
  className: string;
  subjectName: string;
  yearStatus: "upcoming" | "active" | "archived";
  yearStart: string;
  yearEnd: string;
};

/** Ã‰valuation d'une matiÃ¨re que le lecteur peut noter (sinon : introuvable). */
async function loadAssessment(tx: Tx, ctx: Ctx, assessmentId: string): Promise<AssessmentRow> {
  if (!isUuid(assessmentId)) throw new GradingError("assessmentNotFound");
  const [row] = await tx
    .select({
      id: assessments.id,
      academicYearId: assessments.academicYearId,
      classId: assessments.classId,
      subjectId: assessments.subjectId,
      periodId: assessments.periodId,
      periodLabel: periods.label,
      kind: assessments.kind,
      title: assessments.title,
      date: assessments.date,
      maxScore: assessments.maxScore,
      className: classes.name,
      subjectName: subjects.name,
      yearStatus: academicYears.status,
      yearStart: academicYears.startDate,
      yearEnd: academicYears.endDate,
    })
    .from(assessments)
    .innerJoin(
      classSubjects,
      and(
        eq(classSubjects.classId, assessments.classId),
        eq(classSubjects.subjectId, assessments.subjectId),
      ),
    )
    .innerJoin(classes, eq(classes.id, assessments.classId))
    .innerJoin(subjects, eq(subjects.id, assessments.subjectId))
    .innerJoin(periods, eq(periods.id, assessments.periodId))
    .innerJoin(academicYears, eq(academicYears.id, assessments.academicYearId))
    .where(
      and(eq(assessments.schoolId, ctx.schoolId), eq(assessments.id, assessmentId), ownCourse(ctx)),
    );
  if (!row) throw new GradingError("assessmentNotFound");
  return row;
}

/** Modifie une Ã©valuation ; le barÃ¨me ne descend pas sous une note dÃ©jÃ  saisie. */
export async function updateAssessment(
  principal: Principal,
  assessmentId: string,
  input: unknown,
): Promise<void> {
  const ctx = gradingContext(principal, "assessments:manage");
  const data = parseAssessment(input);
  await guarded(() =>
    withSchool(ctx, async (tx) => {
      const current = await loadAssessment(tx, ctx, assessmentId);
      await checkPeriodAndDate(tx, current, data);
      const [{ highest }] = await tx
        .select({ highest: max(grades.score) })
        .from(grades)
        .where(eq(grades.assessmentId, assessmentId));
      if (highest !== null && Number(highest) > data.maxScore) {
        throw new GradingError("scoreAboveMax");
      }
      await tx
        .update(assessments)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(assessments.id, assessmentId));
    }),
  );
}

/** Supprime une Ã©valuation et ses notes ; si des notes existaient, la suppression est tracÃ©e. */
export async function deleteAssessment(principal: Principal, assessmentId: string): Promise<void> {
  const ctx = gradingContext(principal, "assessments:manage");
  await guarded(() =>
    withSchool(ctx, async (tx) => {
      const current = await loadAssessment(tx, ctx, assessmentId);
      const [{ n }] = await tx
        .select({ n: count() })
        .from(grades)
        .where(eq(grades.assessmentId, assessmentId));
      await tx.delete(assessments).where(eq(assessments.id, assessmentId));
      if (n > 0) {
        await tx.insert(auditLogs).values({
          schoolId: ctx.schoolId,
          actorUserId: ctx.userId,
          action: "assessment.delete",
          entityType: "assessment",
          entityId: assessmentId,
          before: { ...current, grades: n },
          after: null,
        });
      }
    }),
  );
}

// --- Feuille de notes -----------------------------------------------------------------------

export type GradeSheetRow = {
  enrollmentId: string;
  matricule: string;
  lastName: string;
  firstNames: string;
  /** Texte de la case (12,5 ; Â« a Â» ; Â« d Â» ; vide). */
  value: string;
  /** Faux pour un Ã©lÃ¨ve parti ou changÃ© de classe : sa note reste visible, sans modification. */
  editable: boolean;
};

export type GradeSheet = Omit<AssessmentRow, "academicYearId" | "yearStart" | "yearEnd"> & {
  rows: GradeSheetRow[];
};

type StoredGrade = { enrollmentId: string; status: GradeStatus; score: number | null };

async function storedGrades(tx: Tx, assessmentId: string, lock = false): Promise<StoredGrade[]> {
  const query = tx
    .select({ enrollmentId: grades.enrollmentId, status: grades.status, score: grades.score })
    .from(grades)
    .where(eq(grades.assessmentId, assessmentId));
  return lock ? query.for("update") : query;
}

/** Ã‰lÃ¨ves de la classe, par ordre alphabÃ©tique, avec leur note ; puis les anciens Ã©lÃ¨ves notÃ©s. */
export async function getGradeSheet(
  principal: Principal,
  assessmentId: string,
): Promise<GradeSheet> {
  const ctx = gradingContext(principal, "grades:write");
  return withSchool(ctx, async (tx) => {
    const a = await loadAssessment(tx, ctx, assessmentId);
    const existing = new Map(
      (await storedGrades(tx, assessmentId)).map((g) => [g.enrollmentId, g]),
    );
    const identity = {
      enrollmentId: enrollments.id,
      matricule: students.matricule,
      lastName: students.lastName,
      firstNames: students.firstNames,
    };
    const enrolled = await tx
      .select(identity)
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(enrolledIn(a.classId))
      .orderBy(asc(students.lastName), asc(students.firstNames));
    const enrolledIds = new Set(enrolled.map((e) => e.enrollmentId));
    const formerIds = [...existing.keys()].filter((id) => !enrolledIds.has(id));
    const former = formerIds.length
      ? await tx
          .select(identity)
          .from(enrollments)
          .innerJoin(students, eq(students.id, enrollments.studentId))
          .where(inArray(enrollments.id, formerIds))
          .orderBy(asc(students.lastName), asc(students.firstNames))
      : [];
    const row = (e: (typeof enrolled)[number], editable: boolean): GradeSheetRow => ({
      ...e,
      value: formatGradeValue(gradeValueOf(existing.get(e.enrollmentId))),
      editable,
    });
    return {
      id: a.id,
      classId: a.classId,
      subjectId: a.subjectId,
      periodId: a.periodId,
      periodLabel: a.periodLabel,
      kind: a.kind,
      title: a.title,
      date: a.date,
      maxScore: a.maxScore,
      className: a.className,
      subjectName: a.subjectName,
      yearStatus: a.yearStatus,
      rows: [...enrolled.map((e) => row(e, true)), ...former.map((e) => row(e, false))],
    };
  });
}

export type GradeEntry = {
  enrollmentId: string;
  /** Valeur de la case au moment oÃ¹ la grille a Ã©tÃ© ouverte. */
  expected: string;
  /** Valeur saisie. */
  value: string;
};

export type SaveGradesResult = {
  /** Cases enregistrÃ©es. */
  saved: number;
  /** Cases illisibles : rien n'est enregistrÃ© tant qu'il en reste. */
  problems: { enrollmentId: string; problem: GradeInputProblem }[];
  /** Notes changÃ©es entre-temps par quelqu'un d'autre : laissÃ©es telles quelles, valeur actuelle. */
  conflicts: { enrollmentId: string; current: string }[];
};

/**
 * Enregistre les cases modifiÃ©es d'une feuille de notes. Une case dont la note a changÃ© en base depuis
 * l'ouverture de la grille n'est pas Ã©crasÃ©e : elle est rendue comme conflit avec sa valeur actuelle.
 */
export async function saveGrades(
  principal: Principal,
  assessmentId: string,
  entries: readonly GradeEntry[],
): Promise<SaveGradesResult> {
  const ctx = gradingContext(principal, "grades:write");
  return guarded(() =>
    withSchool(ctx, async (tx) => {
      const a = await loadAssessment(tx, ctx, assessmentId);
      const problems: SaveGradesResult["problems"] = [];
      const changes: { enrollmentId: string; expected: GradeValue; value: GradeValue }[] = [];
      for (const entry of entries) {
        const value = parseGradeInput(entry.value, a.maxScore);
        if (!value.ok) {
          problems.push({ enrollmentId: entry.enrollmentId, problem: value.problem });
          continue;
        }
        // Valeur d'origine : produite par le serveur ; illisible = traitÃ©e comme une case vide.
        const expected = parseGradeInput(entry.expected, 100);
        const before: GradeValue = expected.ok ? expected.value : { status: "empty" };
        if (!sameGradeValue(before, value.value)) {
          changes.push({ enrollmentId: entry.enrollmentId, expected: before, value: value.value });
        }
      }
      if (problems.length > 0) return { saved: 0, problems, conflicts: [] };
      if (changes.length === 0) return { saved: 0, problems, conflicts: [] };

      const allowed = new Set(
        (
          await tx.select({ id: enrollments.id }).from(enrollments).where(enrolledIn(a.classId))
        ).map((e) => e.id),
      );
      if (changes.some((c) => !allowed.has(c.enrollmentId))) {
        throw new GradingError("studentNotInClass");
      }
      // Notes actuelles verrouillÃ©es jusqu'Ã  la fin de la transaction (deux saisies simultanÃ©es).
      const current = new Map(
        (await storedGrades(tx, assessmentId, true)).map((g) => [g.enrollmentId, g]),
      );
      const conflicts: SaveGradesResult["conflicts"] = [];
      let saved = 0;
      for (const change of changes) {
        const now = gradeValueOf(current.get(change.enrollmentId));
        if (sameGradeValue(now, change.value)) continue; // dÃ©jÃ  la valeur voulue
        if (!sameGradeValue(now, change.expected)) {
          conflicts.push({ enrollmentId: change.enrollmentId, current: formatGradeValue(now) });
          continue;
        }
        if (change.value.status === "empty") {
          await tx
            .delete(grades)
            .where(
              and(
                eq(grades.assessmentId, assessmentId),
                eq(grades.enrollmentId, change.enrollmentId),
              ),
            );
        } else {
          const score = change.value.status === "scored" ? change.value.score : null;
          await tx
            .insert(grades)
            .values({
              schoolId: ctx.schoolId,
              academicYearId: a.academicYearId,
              assessmentId,
              enrollmentId: change.enrollmentId,
              status: change.value.status,
              score,
              updatedBy: ctx.userId,
            })
            .onConflictDoUpdate({
              target: [grades.assessmentId, grades.enrollmentId],
              set: {
                status: change.value.status,
                score,
                updatedBy: ctx.userId,
                updatedAt: new Date(),
              },
            });
        }
        saved++;
      }
      return { saved, problems, conflicts };
    }),
  );
}
