// Grille des coefficients (décision D4) : par année, niveau et série, les matières enseignées et leur
// coefficient. Les classes de ce niveau + série suivent la grille (class_subjects synchronisé).
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { z } from "zod";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool, type Tx } from "@/server/db/client";
import { academicYears, classes, classSubjects, levels, levelSubjects } from "@/server/db/schema";
import { DEFAULT_SUBJECTS, type Cycle } from "./defaults";
import { dbGuardCode, isForeignKeyViolation, SettingsError } from "./errors";
import { ensureSubjects } from "./levels";

export const SeriesSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{0,10}$/);

export const GridEntriesSchema = z
  .array(
    z.object({
      subjectId: z.uuid(),
      coefficient: z.coerce.number().int().min(1).max(20),
    }),
  )
  .max(60);
export type GridEntryInput = z.input<typeof GridEntriesSchema>[number];

export type GridKey = { academicYearId: string; levelId: string; series: string };
export type GridRow = { subjectId: string; coefficient: number };

function context(principal: Principal, action: "settings:read" | "settings:write") {
  authorize(principal, action);
  return { schoolId: principal.schoolId as string, userId: principal.userId };
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (dbGuardCode(error) === "GS001") throw new SettingsError("yearArchived");
    if (isForeignKeyViolation(error)) throw new SettingsError("gridInvalid");
    throw error;
  }
}

/**
 * Vérifie la clé de grille : année et niveau de l'école, série seulement au lycée (hypothèse),
 * année non archivée pour une écriture. Renvoie la clé normalisée et le cycle du niveau.
 */
async function resolveKey(
  tx: Tx,
  schoolId: string,
  key: GridKey,
  forWrite: boolean,
): Promise<{ key: GridKey; cycle: Cycle }> {
  const series = SeriesSchema.safeParse(key.series);
  if (!z.uuid().safeParse(key.academicYearId).success) throw new SettingsError("yearNotFound");
  if (!z.uuid().safeParse(key.levelId).success) throw new SettingsError("levelNotFound");
  if (!series.success) throw new SettingsError("seriesInvalid");
  const [year] = await tx
    .select({ status: academicYears.status })
    .from(academicYears)
    .where(and(eq(academicYears.schoolId, schoolId), eq(academicYears.id, key.academicYearId)));
  if (!year) throw new SettingsError("yearNotFound");
  if (forWrite && year.status === "archived") throw new SettingsError("yearArchived");
  const [level] = await tx
    .select({ cycle: levels.cycle })
    .from(levels)
    .where(and(eq(levels.schoolId, schoolId), eq(levels.id, key.levelId)));
  if (!level) throw new SettingsError("levelNotFound");
  if (level.cycle !== "lycee" && series.data !== "") throw new SettingsError("seriesInvalid");
  return { key: { ...key, series: series.data }, cycle: level.cycle };
}

const keyFilter = (schoolId: string, key: GridKey) =>
  and(
    eq(levelSubjects.schoolId, schoolId),
    eq(levelSubjects.academicYearId, key.academicYearId),
    eq(levelSubjects.levelId, key.levelId),
    eq(levelSubjects.series, key.series),
  );

/**
 * Aligne les matières des classes de ce niveau + série sur la grille : ajoute les matières
 * manquantes, retire celles qui n'y sont plus (avec leur enseignant affecté).
 */
export async function syncClassSubjects(tx: Tx, schoolId: string, key: GridKey): Promise<void> {
  const grid = await tx
    .select({ subjectId: levelSubjects.subjectId })
    .from(levelSubjects)
    .where(keyFilter(schoolId, key));
  const subjectIds = grid.map((g) => g.subjectId);
  const classRows = await tx
    .select({ id: classes.id })
    .from(classes)
    .where(
      and(
        eq(classes.schoolId, schoolId),
        eq(classes.academicYearId, key.academicYearId),
        eq(classes.levelId, key.levelId),
        eq(classes.series, key.series),
      ),
    );
  if (classRows.length === 0) return;
  const classIds = classRows.map((c) => c.id);
  await tx
    .delete(classSubjects)
    .where(
      and(
        inArray(classSubjects.classId, classIds),
        subjectIds.length > 0 ? notInArray(classSubjects.subjectId, subjectIds) : undefined,
      ),
    );
  if (subjectIds.length === 0) return;
  await tx
    .insert(classSubjects)
    .values(
      classIds.flatMap((classId) =>
        subjectIds.map((subjectId) => ({
          schoolId,
          academicYearId: key.academicYearId,
          classId,
          subjectId,
        })),
      ),
    )
    .onConflictDoNothing({ target: [classSubjects.classId, classSubjects.subjectId] });
}

export async function getGrid(principal: Principal, key: GridKey): Promise<GridRow[]> {
  const ctx = context(principal, "settings:read");
  return withSchool(ctx, async (tx) => {
    const resolved = await resolveKey(tx, ctx.schoolId, key, false);
    return tx
      .select({ subjectId: levelSubjects.subjectId, coefficient: levelSubjects.coefficient })
      .from(levelSubjects)
      .where(keyFilter(ctx.schoolId, resolved.key));
  });
}

/** Séries déjà utilisées pour un niveau (grilles ou classes), pour les proposer à l'écran. */
export async function listSeries(
  principal: Principal,
  academicYearId: string,
  levelId: string,
): Promise<string[]> {
  const ctx = context(principal, "settings:read");
  if (!z.uuid().safeParse(academicYearId).success || !z.uuid().safeParse(levelId).success) {
    return [];
  }
  return withSchool(ctx, async (tx) => {
    const fromGrid = await tx
      .selectDistinct({ series: levelSubjects.series })
      .from(levelSubjects)
      .where(
        and(
          eq(levelSubjects.schoolId, ctx.schoolId),
          eq(levelSubjects.academicYearId, academicYearId),
          eq(levelSubjects.levelId, levelId),
        ),
      );
    const fromClasses = await tx
      .selectDistinct({ series: classes.series })
      .from(classes)
      .where(
        and(
          eq(classes.schoolId, ctx.schoolId),
          eq(classes.academicYearId, academicYearId),
          eq(classes.levelId, levelId),
        ),
      );
    return [...new Set([...fromGrid, ...fromClasses].map((r) => r.series))]
      .filter((s) => s !== "")
      .sort();
  });
}

/** Remplace la grille d'un niveau + série par les matières et coefficients donnés. */
export async function saveGrid(
  principal: Principal,
  key: GridKey,
  entries: readonly GridEntryInput[],
): Promise<void> {
  const ctx = context(principal, "settings:write");
  const rows = GridEntriesSchema.parse(entries);
  if (new Set(rows.map((r) => r.subjectId)).size !== rows.length) {
    throw new SettingsError("gridInvalid");
  }
  await guarded(() =>
    withSchool(ctx, async (tx) => {
      const resolved = await resolveKey(tx, ctx.schoolId, key, true);
      const k = resolved.key;
      const keep = rows.map((r) => r.subjectId);
      await tx
        .delete(levelSubjects)
        .where(
          and(
            keyFilter(ctx.schoolId, k),
            keep.length > 0 ? notInArray(levelSubjects.subjectId, keep) : undefined,
          ),
        );
      for (const row of rows) {
        await tx
          .insert(levelSubjects)
          .values({ schoolId: ctx.schoolId, ...k, ...row })
          .onConflictDoUpdate({
            target: [
              levelSubjects.academicYearId,
              levelSubjects.levelId,
              levelSubjects.series,
              levelSubjects.subjectId,
            ],
            set: { coefficient: row.coefficient, updatedAt: new Date() },
          });
      }
      await syncClassSubjects(tx, ctx.schoolId, k);
    }),
  );
}

/**
 * Ajoute à la grille les matières courantes du cycle du niveau (coefficient 1, hypothèse H21),
 * en créant les matières qui n'existent pas encore. Les matières déjà dans la grille ne bougent pas.
 */
export async function addDefaultGrid(principal: Principal, key: GridKey): Promise<number> {
  const ctx = context(principal, "settings:write");
  return guarded(() =>
    withSchool(ctx, async (tx) => {
      const resolved = await resolveKey(tx, ctx.schoolId, key, true);
      const ids = await ensureSubjects(tx, ctx.schoolId, DEFAULT_SUBJECTS[resolved.cycle]);
      const inserted = await tx
        .insert(levelSubjects)
        .values(
          [...ids.values()].map((subjectId) => ({
            schoolId: ctx.schoolId,
            ...resolved.key,
            subjectId,
            coefficient: 1,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: levelSubjects.id });
      await syncClassSubjects(tx, ctx.schoolId, resolved.key);
      return inserted.length;
    }),
  );
}
