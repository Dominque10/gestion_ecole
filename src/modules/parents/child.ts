// Espace parents (M6) : lectures d'un enfant. Le droit `parent:view` est vérifié ici, et la RLS
// (politiques « parent », 4a) garantit qu'un parent ne lit que ses propres enfants.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool } from "@/server/db/client";
import { academicYears, classes, enrollments, levels, schools, students } from "@/server/db/schema";

export type ChildSummary = {
  enrollmentId: string;
  lastName: string;
  firstNames: string;
  matricule: string;
  className: string | null;
  levelName: string;
  yearLabel: string;
  schoolName: string;
};

/** Fiche d'en-tête d'un enfant de l'école de session ; null si ce n'est pas un enfant du parent. */
export async function getChildSummary(
  principal: Principal,
  enrollmentId: string,
): Promise<ChildSummary | null> {
  authorize(principal, "parent:view");
  if (!z.uuid().safeParse(enrollmentId).success) return null;
  const ctx = { schoolId: principal.schoolId as string, userId: principal.userId };
  return withSchool(ctx, async (tx) => {
    const [row] = await tx
      .select({
        enrollmentId: enrollments.id,
        lastName: students.lastName,
        firstNames: students.firstNames,
        matricule: students.matricule,
        className: classes.name,
        levelName: levels.name,
        yearLabel: academicYears.label,
        schoolName: schools.name,
      })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .innerJoin(levels, eq(levels.id, enrollments.levelId))
      .innerJoin(academicYears, eq(academicYears.id, enrollments.academicYearId))
      .innerJoin(schools, eq(schools.id, enrollments.schoolId))
      .leftJoin(classes, eq(classes.id, enrollments.classId))
      .where(and(eq(enrollments.schoolId, ctx.schoolId), eq(enrollments.id, enrollmentId)));
    return row ?? null;
  });
}
