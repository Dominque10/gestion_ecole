// Niveaux et matières de l'école (M1, 4d). Valables d'une année sur l'autre.
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool, type Tx } from "@/server/db/client";
import { levels, subjects } from "@/server/db/schema";
import { cycleRank, DEFAULT_LEVELS, type Cycle } from "./defaults";
import { isForeignKeyViolation, isUniqueViolation, SettingsError } from "./errors";
import { LevelSchema, NameSchema, type LevelInput } from "./schemas";

function context(principal: Principal, action: "settings:read" | "settings:write") {
  authorize(principal, action);
  return { schoolId: principal.schoolId as string, userId: principal.userId };
}

const isUuid = (value: string) => z.uuid().safeParse(value).success;

/** Traduit unicité et clés étrangères en refus métier. */
async function guarded<T>(
  work: () => Promise<T>,
  codes: { taken: "levelNameTaken" | "subjectNameTaken"; inUse: "levelInUse" | "subjectInUse" },
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isUniqueViolation(error)) throw new SettingsError(codes.taken);
    if (isForeignKeyViolation(error)) throw new SettingsError(codes.inUse);
    throw error;
  }
}
const LEVEL_CODES = { taken: "levelNameTaken", inUse: "levelInUse" } as const;
const SUBJECT_CODES = { taken: "subjectNameTaken", inUse: "subjectInUse" } as const;

// --- Niveaux ---------------------------------------------------------------------------------

export type Level = { id: string; cycle: Cycle; name: string; position: number };

export async function listLevels(principal: Principal): Promise<Level[]> {
  const ctx = context(principal, "settings:read");
  const rows = await withSchool(ctx, (tx) =>
    tx
      .select({ id: levels.id, cycle: levels.cycle, name: levels.name, position: levels.position })
      .from(levels)
      .where(eq(levels.schoolId, ctx.schoolId)),
  );
  return rows.sort(
    (a, b) =>
      cycleRank(a.cycle) - cycleRank(b.cycle) ||
      a.position - b.position ||
      a.name.localeCompare(b.name, "fr"),
  );
}

async function nextPosition(tx: Tx, schoolId: string, cycle: Cycle): Promise<number> {
  const rows = await tx
    .select({ position: levels.position })
    .from(levels)
    .where(and(eq(levels.schoolId, schoolId), eq(levels.cycle, cycle)));
  return rows.reduce((max, r) => Math.max(max, r.position), 0) + 1;
}

/** Ajoute les niveaux congolais d'un cycle qui manquent (sans toucher aux niveaux existants). */
export async function addDefaultLevels(principal: Principal, cycle: Cycle): Promise<number> {
  const ctx = context(principal, "settings:write");
  LevelSchema.shape.cycle.parse(cycle);
  return withSchool(ctx, async (tx) => {
    const existing = await tx
      .select({ name: levels.name })
      .from(levels)
      .where(eq(levels.schoolId, ctx.schoolId));
    const taken = new Set(existing.map((l) => l.name.toLowerCase()));
    const missing = DEFAULT_LEVELS[cycle].filter((name) => !taken.has(name.toLowerCase()));
    if (missing.length === 0) return 0;
    const start = await nextPosition(tx, ctx.schoolId, cycle);
    await tx
      .insert(levels)
      .values(
        missing.map((name, i) => ({ schoolId: ctx.schoolId, cycle, name, position: start + i })),
      );
    return missing.length;
  });
}

export async function createLevel(principal: Principal, input: LevelInput): Promise<string> {
  const ctx = context(principal, "settings:write");
  const data = LevelSchema.parse(input);
  return guarded(
    () =>
      withSchool(ctx, async (tx) => {
        const position = await nextPosition(tx, ctx.schoolId, data.cycle);
        const [row] = await tx
          .insert(levels)
          .values({ schoolId: ctx.schoolId, ...data, position })
          .returning({ id: levels.id });
        return row.id;
      }),
    LEVEL_CODES,
  );
}

export async function renameLevel(principal: Principal, levelId: string, name: string) {
  const ctx = context(principal, "settings:write");
  const clean = NameSchema.parse(name);
  if (!isUuid(levelId)) throw new SettingsError("levelNotFound");
  await guarded(
    () =>
      withSchool(ctx, async (tx) => {
        const updated = await tx
          .update(levels)
          .set({ name: clean, updatedAt: new Date() })
          .where(and(eq(levels.schoolId, ctx.schoolId), eq(levels.id, levelId)))
          .returning({ id: levels.id });
        if (updated.length === 0) throw new SettingsError("levelNotFound");
      }),
    LEVEL_CODES,
  );
}

/** Supprime un niveau inutilisé (refusé s'il a des classes ou une grille de coefficients). */
export async function deleteLevel(principal: Principal, levelId: string) {
  const ctx = context(principal, "settings:write");
  if (!isUuid(levelId)) throw new SettingsError("levelNotFound");
  await guarded(
    () =>
      withSchool(ctx, async (tx) => {
        const deleted = await tx
          .delete(levels)
          .where(and(eq(levels.schoolId, ctx.schoolId), eq(levels.id, levelId)))
          .returning({ id: levels.id });
        if (deleted.length === 0) throw new SettingsError("levelNotFound");
      }),
    LEVEL_CODES,
  );
}

// --- Matières --------------------------------------------------------------------------------

export type Subject = { id: string; name: string };

export async function listSubjects(principal: Principal): Promise<Subject[]> {
  const ctx = context(principal, "settings:read");
  return withSchool(ctx, (tx) =>
    tx
      .select({ id: subjects.id, name: subjects.name })
      .from(subjects)
      .where(eq(subjects.schoolId, ctx.schoolId))
      .orderBy(asc(subjects.name)),
  );
}

/** Retrouve les matières par nom (casse ignorée) et crée celles qui manquent. */
export async function ensureSubjects(
  tx: Tx,
  schoolId: string,
  names: readonly string[],
): Promise<Map<string, string>> {
  const existing = await tx
    .select({ id: subjects.id, name: subjects.name })
    .from(subjects)
    .where(eq(subjects.schoolId, schoolId));
  const byName = new Map(existing.map((s) => [s.name.toLowerCase(), s.id]));
  const missing = names.filter((n) => !byName.has(n.toLowerCase()));
  if (missing.length > 0) {
    const created = await tx
      .insert(subjects)
      .values(missing.map((name) => ({ schoolId, name })))
      .returning({ id: subjects.id, name: subjects.name });
    for (const s of created) byName.set(s.name.toLowerCase(), s.id);
  }
  return new Map(names.map((n) => [n, byName.get(n.toLowerCase()) as string]));
}

export async function createSubject(principal: Principal, name: string): Promise<string> {
  const ctx = context(principal, "settings:write");
  const clean = NameSchema.parse(name);
  return guarded(
    () =>
      withSchool(ctx, async (tx) => {
        const [row] = await tx
          .insert(subjects)
          .values({ schoolId: ctx.schoolId, name: clean })
          .returning({ id: subjects.id });
        return row.id;
      }),
    SUBJECT_CODES,
  );
}

export async function renameSubject(principal: Principal, subjectId: string, name: string) {
  const ctx = context(principal, "settings:write");
  const clean = NameSchema.parse(name);
  if (!isUuid(subjectId)) throw new SettingsError("subjectNotFound");
  await guarded(
    () =>
      withSchool(ctx, async (tx) => {
        const updated = await tx
          .update(subjects)
          .set({ name: clean, updatedAt: new Date() })
          .where(and(eq(subjects.schoolId, ctx.schoolId), eq(subjects.id, subjectId)))
          .returning({ id: subjects.id });
        if (updated.length === 0) throw new SettingsError("subjectNotFound");
      }),
    SUBJECT_CODES,
  );
}

/** Supprime une matière inutilisée (refusé si elle figure dans une grille ou une classe). */
export async function deleteSubject(principal: Principal, subjectId: string) {
  const ctx = context(principal, "settings:write");
  if (!isUuid(subjectId)) throw new SettingsError("subjectNotFound");
  await guarded(
    () =>
      withSchool(ctx, async (tx) => {
        const deleted = await tx
          .delete(subjects)
          .where(and(eq(subjects.schoolId, ctx.schoolId), eq(subjects.id, subjectId)))
          .returning({ id: subjects.id });
        if (deleted.length === 0) throw new SettingsError("subjectNotFound");
      }),
    SUBJECT_CODES,
  );
}
