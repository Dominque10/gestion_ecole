// Passage d'année, partie M1 (plan phase 1, hypothèse 2) : reprendre la structure d'une année
// (classes, grille des coefficients, frais) dans une année en préparation. Les élèves ne sont pas
// copiés : la réinscription groupée se fait au M2.
import { and, arrayContains, eq } from "drizzle-orm";
import { z } from "zod";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool, type Tx } from "@/server/db/client";
import {
  academicYears,
  auditLogs,
  classes,
  classSubjects,
  feeItems,
  levelSubjects,
  memberships,
} from "@/server/db/schema";
import { syncClassSubjects } from "./coefficients";
import { SettingsError } from "./errors";

/**
 * Décale une date d'un nombre entier d'années (le 29 février devient le 28 si besoin).
 * Les échéances gardent ainsi le même jour du calendrier d'une année sur l'autre.
 */
export function shiftYears(date: string, years: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = y + years;
  const lastDay = new Date(Date.UTC(target, m, 0)).getUTCDate();
  return `${target}-${String(m).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

export type CopyResult = { classes: number; gridRows: number; feeRows: number };

async function loadYear(tx: Tx, schoolId: string, yearId: string) {
  if (!z.uuid().safeParse(yearId).success) throw new SettingsError("yearNotFound");
  const [year] = await tx
    .select()
    .from(academicYears)
    .where(and(eq(academicYears.schoolId, schoolId), eq(academicYears.id, yearId)))
    .for("update");
  if (!year) throw new SettingsError("yearNotFound");
  return year;
}

async function isEmptyYear(tx: Tx, yearId: string): Promise<boolean> {
  const [c] = await tx
    .select({ id: classes.id })
    .from(classes)
    .where(eq(classes.academicYearId, yearId))
    .limit(1);
  const [g] = await tx
    .select({ id: levelSubjects.id })
    .from(levelSubjects)
    .where(eq(levelSubjects.academicYearId, yearId))
    .limit(1);
  const [f] = await tx
    .select({ id: feeItems.id })
    .from(feeItems)
    .where(eq(feeItems.academicYearId, yearId))
    .limit(1);
  return !c && !g && !f;
}

/**
 * Copie classes, grille et frais de `fromYearId` vers `toYearId` (année en préparation et vide).
 * Professeurs principaux et enseignants repris seulement s'ils ont encore le rôle Enseignant.
 * Échéances décalées du nombre d'années entre les deux rentrées.
 */
export async function copyStructure(
  principal: Principal,
  fromYearId: string,
  toYearId: string,
): Promise<CopyResult> {
  authorize(principal, "settings:write");
  const schoolId = principal.schoolId as string;
  if (fromYearId === toYearId) throw new SettingsError("copySameYear");

  return withSchool({ schoolId, userId: principal.userId }, async (tx) => {
    const from = await loadYear(tx, schoolId, fromYearId);
    const to = await loadYear(tx, schoolId, toYearId);
    if (to.status !== "upcoming") throw new SettingsError("yearNotUpcoming");
    if (!(await isEmptyYear(tx, toYearId))) throw new SettingsError("copyTargetNotEmpty");

    const teacherRows = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(eq(memberships.schoolId, schoolId), arrayContains(memberships.roles, ["teacher"])),
      );
    const teachers = new Set(teacherRows.map((r) => r.userId));
    const stillTeacher = (id: string | null) => (id && teachers.has(id) ? id : null);

    // 1. Grille des coefficients.
    const grid = await tx
      .select()
      .from(levelSubjects)
      .where(eq(levelSubjects.academicYearId, fromYearId));
    if (grid.length > 0) {
      await tx.insert(levelSubjects).values(
        grid.map((g) => ({
          schoolId,
          academicYearId: toYearId,
          levelId: g.levelId,
          series: g.series,
          subjectId: g.subjectId,
          coefficient: g.coefficient,
        })),
      );
    }

    // 2. Classes, puis leurs matières (selon la grille) et les enseignants encore en poste.
    const sourceClasses = await tx
      .select()
      .from(classes)
      .where(eq(classes.academicYearId, fromYearId));
    const sourceAssignments = await tx
      .select({
        classId: classSubjects.classId,
        subjectId: classSubjects.subjectId,
        teacherId: classSubjects.teacherId,
      })
      .from(classSubjects)
      .where(eq(classSubjects.academicYearId, fromYearId));
    const keys = new Map<string, { levelId: string; series: string }>();
    for (const c of sourceClasses) {
      const [created] = await tx
        .insert(classes)
        .values({
          schoolId,
          academicYearId: toYearId,
          levelId: c.levelId,
          series: c.series,
          name: c.name,
          capacity: c.capacity,
          headTeacherId: stillTeacher(c.headTeacherId),
        })
        .returning({ id: classes.id });
      keys.set(`${c.levelId}|${c.series}`, { levelId: c.levelId, series: c.series });
      for (const a of sourceAssignments.filter(
        (x) => x.classId === c.id && stillTeacher(x.teacherId),
      )) {
        // La ligne de matière est créée par la synchronisation ci-dessous ; on la prépare ici.
        await tx
          .insert(classSubjects)
          .values({
            schoolId,
            academicYearId: toYearId,
            classId: created.id,
            subjectId: a.subjectId,
            teacherId: a.teacherId,
          })
          .onConflictDoNothing();
      }
    }
    for (const key of keys.values()) {
      await syncClassSubjects(tx, schoolId, { academicYearId: toYearId, ...key });
    }

    // 3. Frais, échéances décalées d'autant d'années que les rentrées.
    const yearsBetween = Number(to.startDate.slice(0, 4)) - Number(from.startDate.slice(0, 4));
    const fees = await tx.select().from(feeItems).where(eq(feeItems.academicYearId, fromYearId));
    if (fees.length > 0) {
      await tx.insert(feeItems).values(
        fees.map((f) => ({
          schoolId,
          academicYearId: toYearId,
          levelId: f.levelId,
          kind: f.kind,
          name: f.name,
          mandatory: f.mandatory,
          installmentNumber: f.installmentNumber,
          amount: f.amount,
          dueDate: shiftYears(f.dueDate, yearsBetween),
        })),
      );
    }

    const result = { classes: sourceClasses.length, gridRows: grid.length, feeRows: fees.length };
    await tx.insert(auditLogs).values({
      schoolId,
      actorUserId: principal.userId,
      action: "year.copy_structure",
      entityType: "academic_year",
      entityId: toYearId,
      before: { from: from.label },
      after: { to: to.label, ...result },
    });
    return result;
  });
}
