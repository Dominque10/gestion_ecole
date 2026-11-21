// Accès Support (décision A7) : lecture seule, accordée par le directeur, 24 h par défaut, tracée.
import { and, eq } from "drizzle-orm";
import { withSchool } from "@/server/db/client";
import { auditLogs, memberships, users } from "@/server/db/schema";
import { authorize, isSupportOnly, type Principal } from "./permissions";

export const SUPPORT_DEFAULT_HOURS = 24;

export class SupportGrantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupportGrantError";
  }
}

function schoolContext(principal: Principal) {
  if (!principal.schoolId) throw new SupportGrantError("Aucune école de session");
  return { schoolId: principal.schoolId, userId: principal.userId };
}

/** Le directeur autorise un super-admin à consulter son école pendant `hours` heures. */
export async function grantSupportAccess(
  director: Principal,
  superadminUserId: string,
  hours = SUPPORT_DEFAULT_HOURS,
  now = new Date(),
): Promise<Date> {
  authorize(director, "support:grant");
  if (!(hours > 0 && hours <= 72)) throw new SupportGrantError("Durée entre 1 et 72 heures");
  const ctx = schoolContext(director);
  const expiresAt = new Date(now.getTime() + hours * 3600 * 1000);

  return withSchool(ctx, async (tx) => {
    const [target] = await tx
      .select({ isSuperadmin: users.isSuperadmin })
      .from(users)
      .where(eq(users.id, superadminUserId));
    if (!target?.isSuperadmin) throw new SupportGrantError("Ce compte n'est pas un compte Support");

    const [existing] = await tx
      .select({ roles: memberships.roles })
      .from(memberships)
      .where(and(eq(memberships.schoolId, ctx.schoolId), eq(memberships.userId, superadminUserId)));
    if (existing && existing.roles.some((r) => r !== "support")) {
      throw new SupportGrantError("Ce compte a déjà d'autres rôles dans l'école");
    }

    await tx
      .insert(memberships)
      .values({
        schoolId: ctx.schoolId,
        userId: superadminUserId,
        roles: ["support"],
        expiresAt,
        grantedBy: director.userId,
      })
      .onConflictDoUpdate({
        target: [memberships.schoolId, memberships.userId],
        set: { roles: ["support"], expiresAt, grantedBy: director.userId, updatedAt: now },
      });
    await tx.insert(auditLogs).values({
      schoolId: ctx.schoolId,
      actorUserId: director.userId,
      action: "support.grant",
      entityType: "membership",
      entityId: superadminUserId,
      after: { expiresAt: expiresAt.toISOString() },
    });
    return expiresAt;
  });
}

/** Le directeur met fin à l'accès Support immédiatement. */
export async function revokeSupportAccess(
  director: Principal,
  superadminUserId: string,
  now = new Date(),
): Promise<void> {
  authorize(director, "support:grant");
  const ctx = schoolContext(director);
  await withSchool(ctx, async (tx) => {
    await tx
      .update(memberships)
      .set({ expiresAt: now, updatedAt: now })
      .where(
        and(
          eq(memberships.schoolId, ctx.schoolId),
          eq(memberships.userId, superadminUserId),
          eq(memberships.roles, ["support"]),
        ),
      );
    await tx.insert(auditLogs).values({
      schoolId: ctx.schoolId,
      actorUserId: director.userId,
      action: "support.revoke",
      entityType: "membership",
      entityId: superadminUserId,
    });
  });
}

/** Chaque consultation en accès Support est enregistrée dans le journal d'audit. */
export async function recordSupportRead(principal: Principal, resource: string): Promise<void> {
  const schoolId = principal.schoolId;
  if (!schoolId || !isSupportOnly(principal)) return;
  await withSchool({ schoolId, userId: principal.userId }, (tx) =>
    tx.insert(auditLogs).values({
      schoolId,
      actorUserId: principal.userId,
      action: "support.read",
      entityType: resource,
    }),
  );
}
