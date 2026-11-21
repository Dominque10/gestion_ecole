// Super-admin : création d'une école et de son premier directeur (M1).
import { asc, eq } from "drizzle-orm";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withPlatform } from "@/server/db/client";
import { auditLogs, memberships, schools } from "@/server/db/schema";
import { findOrCreateAccount } from "./accounts";
import { isUniqueViolation, SettingsError } from "./errors";
import { CreateSchoolSchema, type CreateSchoolInput } from "./schemas";

export type CreatedSchool = { schoolId: string; directorUserId: string; existingAccount: boolean };

export async function createSchool(
  principal: Principal,
  input: CreateSchoolInput,
): Promise<CreatedSchool> {
  authorize(principal, "school:create");
  const data = CreateSchoolSchema.parse(input);

  try {
    return await withPlatform(principal.userId, async (tx) => {
      const [taken] = await tx
        .select({ id: schools.id })
        .from(schools)
        .where(eq(schools.code, data.code));
      if (taken) throw new SettingsError("codeTaken");

      const [school] = await tx
        .insert(schools)
        .values({ name: data.name, code: data.code, matriculePrefix: data.matriculePrefix })
        .returning({ id: schools.id });
      const director = await findOrCreateAccount(tx, {
        name: data.directorName,
        identifier: data.directorIdentifier,
        password: data.directorPassword,
      });
      await tx
        .insert(memberships)
        .values({ schoolId: school.id, userId: director.userId, roles: ["director"] });
      // Action de plateforme : journal sans école (invisible des écoles, cf. RLS d'audit_logs).
      await tx.insert(auditLogs).values({
        schoolId: null,
        actorUserId: principal.userId,
        action: "school.create",
        entityType: "school",
        entityId: school.id,
        after: {
          name: data.name,
          code: data.code,
          matriculePrefix: data.matriculePrefix,
          directorUserId: director.userId,
        },
      });
      return {
        schoolId: school.id,
        directorUserId: director.userId,
        existingAccount: director.existingAccount,
      };
    });
  } catch (error) {
    // Deux créations simultanées avec le même code : la contrainte d'unicité tranche.
    if (isUniqueViolation(error, "schools_code_unique")) throw new SettingsError("codeTaken");
    throw error;
  }
}

export type SchoolSummary = {
  id: string;
  name: string;
  code: string;
  matriculePrefix: string;
  status: "active" | "suspended";
};

export async function listSchools(principal: Principal): Promise<SchoolSummary[]> {
  authorize(principal, "school:create");
  return withPlatform(principal.userId, (tx) =>
    tx
      .select({
        id: schools.id,
        name: schools.name,
        code: schools.code,
        matriculePrefix: schools.matriculePrefix,
        status: schools.status,
      })
      .from(schools)
      .orderBy(asc(schools.name)),
  );
}
