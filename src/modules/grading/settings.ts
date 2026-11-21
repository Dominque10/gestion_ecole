// Écran « Règles de calcul » (sous-étape 3a) : lecture et modification par la direction, tracées.
import { eq } from "drizzle-orm";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool, type Tx } from "@/server/db/client";
import { auditLogs, schools } from "@/server/db/schema";
import { SettingsError } from "@/modules/settings/errors";
import { GradingRulesSchema, readGradingRules, sortMentions, type GradingRules } from "./rules";

function context(principal: Principal, action: "settings:read" | "settings:write") {
  authorize(principal, action);
  return { schoolId: principal.schoolId as string, userId: principal.userId };
}

/** Règles de l'école courante, dans une transaction déjà ouverte (calculs des moyennes). */
export async function loadGradingRules(tx: Tx, schoolId: string): Promise<GradingRules> {
  const [row] = await tx
    .select({ rules: schools.gradingRules })
    .from(schools)
    .where(eq(schools.id, schoolId));
  if (!row) throw new SettingsError("notFound");
  return readGradingRules(row.rules);
}

export async function getGradingRules(principal: Principal): Promise<GradingRules> {
  const ctx = context(principal, "settings:read");
  return withSchool(ctx, (tx) => loadGradingRules(tx, ctx.schoolId));
}

/**
 * Remplace les règles de calcul. Elles valent pour les calculs suivants ; un bulletin déjà publié
 * garde ses moyennes (hypothèse H73). Chaque changement est noté dans le journal.
 */
export async function updateGradingRules(principal: Principal, input: unknown): Promise<void> {
  const ctx = context(principal, "settings:write");
  const parsed = GradingRulesSchema.safeParse(input);
  if (!parsed.success) throw new SettingsError("gradingInvalid");
  const rules = sortMentions(parsed.data);
  await withSchool(ctx, async (tx) => {
    const before = await loadGradingRules(tx, ctx.schoolId);
    await tx
      .update(schools)
      .set({ gradingRules: rules, updatedAt: new Date() })
      .where(eq(schools.id, ctx.schoolId));
    await tx.insert(auditLogs).values({
      schoolId: ctx.schoolId,
      actorUserId: principal.userId,
      action: "school.grading_rules",
      entityType: "school",
      entityId: ctx.schoolId,
      before,
      after: rules,
    });
  });
}
