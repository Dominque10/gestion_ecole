// Phase 3, sous-étape 3a — règles de calcul de l'école (décision D10).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type MembershipRole, type Principal } from "@/server/auth/permissions";
import { closeDb } from "@/server/db/client";
import { SettingsError } from "@/modules/settings/errors";
import { DEFAULT_GRADING_RULES } from "@/modules/grading/rules";
import { getGradingRules, updateGradingRules } from "@/modules/grading/settings";
import { adminQuery, createSchoolWithDirector, createSuperadmin, resetDatabase } from "./helpers";

type School = { schoolId: string; directorId: string };
let a: School;
let b: School;
const as = (school: School, ...roles: MembershipRole[]): Principal => ({
  userId: school.directorId,
  schoolId: school.schoolId,
  roles,
  isSuperadmin: false,
});

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  a = await createSchoolWithDirector(superadminId, "calcula");
  b = await createSchoolWithDirector(superadminId, "calculb");
});

afterAll(async () => {
  await closeDb();
});

describe("Règles de calcul de l'école", () => {
  it("une nouvelle école a les règles par défaut", async () => {
    expect(await getGradingRules(as(a, "director"))).toEqual(DEFAULT_GRADING_RULES);
  });

  it("le directeur les modifie, avec trace ; l'autre école garde les siennes", async () => {
    const rules = {
      ...DEFAULT_GRADING_RULES,
      primaryScale: 10 as const,
      ranking: "dense" as const,
      mentions: [
        { label: "Tableau d'honneur", minAverage: 12 },
        { label: "Félicitations", minAverage: 16 },
      ],
    };
    await updateGradingRules(as(a, "director"), rules);
    expect(await getGradingRules(as(a, "director"))).toEqual({
      ...rules,
      mentions: [rules.mentions[1], rules.mentions[0]],
    });
    expect(await getGradingRules(as(b, "director"))).toEqual(DEFAULT_GRADING_RULES);

    const { rows } = await adminQuery<{ before: { ranking: string }; after: { ranking: string } }>(
      "select before, after from audit_logs where school_id = $1 and action = 'school.grading_rules'",
      [a.schoolId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].before.ranking).toBe("competition");
    expect(rows[0].after.ranking).toBe("dense");
  });

  it("refuse des règles invalides sans rien changer", async () => {
    await expect(
      updateGradingRules(as(a, "director"), { ...DEFAULT_GRADING_RULES, rounding: "x" }),
    ).rejects.toSatisfy((e: unknown) => e instanceof SettingsError && e.code === "gradingInvalid");
    expect((await getGradingRules(as(a, "director"))).ranking).toBe("dense");
  });

  it("le Support peut les lire ; seuls les directeurs les modifient", async () => {
    await expect(getGradingRules(as(a, "support"))).resolves.toBeDefined();
    await expect(getGradingRules(as(a, "teacher"))).rejects.toBeInstanceOf(ForbiddenError);
    for (const role of ["secretary", "accountant", "teacher", "support"] as const) {
      await expect(updateGradingRules(as(a, role), DEFAULT_GRADING_RULES)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
  });
});
