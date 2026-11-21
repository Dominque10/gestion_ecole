// Le directeur gère les comptes du personnel de son école et leurs rôles (décision D3).
// Chaque changement de droits est tracé dans audit_logs (CLAUDE.md §6, Traçabilité).
import { and, arrayContains, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { authorize, type MembershipRole, type Principal } from "@/server/auth/permissions";
import { withSchool, type Tx } from "@/server/db/client";
import { auditLogs, memberships, users } from "@/server/db/schema";
import { findOrCreateAccount } from "./accounts";
import { SettingsError } from "./errors";
import { AddStaffSchema, STAFF_ROLES, StaffRolesSchema, type AddStaffInput } from "./schemas";

const isStaffRole = (role: MembershipRole) => (STAFF_ROLES as readonly string[]).includes(role);

function schoolContext(principal: Principal) {
  authorize(principal, "staff:manage");
  // authorize garantit une école de session pour une action d'école.
  return { schoolId: principal.schoolId as string, userId: principal.userId };
}

export type StaffMember = {
  userId: string;
  name: string;
  phone: string | null;
  email: string | null;
  roles: MembershipRole[];
  /** N'a pas encore remplacé son mot de passe provisoire. */
  pendingPassword: boolean;
};

export async function listStaff(principal: Principal): Promise<StaffMember[]> {
  const ctx = schoolContext(principal);
  const rows = await withSchool(ctx, (tx) =>
    tx
      .select({
        userId: users.id,
        name: users.name,
        phone: users.phone,
        email: users.email,
        roles: memberships.roles,
        pendingPassword: users.mustChangePassword,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.schoolId, ctx.schoolId))
      .orderBy(asc(users.name)),
  );
  return rows
    .map((r) => ({ ...r, roles: r.roles.filter(isStaffRole) }))
    .filter((r) => r.roles.length > 0);
}

/** Bloque les directeurs de l'école (évite deux retraits simultanés du « dernier » directeur). */
async function lockDirectors(tx: Tx, schoolId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.schoolId, schoolId), arrayContains(memberships.roles, ["director"])))
    .for("update");
  return rows.map((r) => r.userId);
}

async function lockMembership(tx: Tx, schoolId: string, userId: string) {
  if (!z.uuid().safeParse(userId).success) throw new SettingsError("notMember");
  const [m] = await tx
    .select({ id: memberships.id, roles: memberships.roles })
    .from(memberships)
    .where(and(eq(memberships.schoolId, schoolId), eq(memberships.userId, userId)))
    .for("update");
  return m;
}

export type AddedStaff = { userId: string; existingAccount: boolean };

/**
 * Ajoute une personne au personnel. Si elle a déjà un compte (autre école, ou parent ici),
 * elle le garde avec son mot de passe ; le mot de passe provisoire ne sert qu'à un nouveau compte.
 */
export async function addStaff(principal: Principal, input: AddStaffInput): Promise<AddedStaff> {
  const ctx = schoolContext(principal);
  const data = AddStaffSchema.parse(input);
  return withSchool(ctx, async (tx) => {
    const account = await findOrCreateAccount(tx, data);
    const existing = await lockMembership(tx, ctx.schoolId, account.userId);
    if (existing && existing.roles.some((r) => r !== "parent")) {
      throw new SettingsError("alreadyMember");
    }
    const roles: MembershipRole[] = [...(existing?.roles ?? []), ...data.roles];
    if (existing) {
      await tx
        .update(memberships)
        .set({ roles, updatedAt: new Date() })
        .where(eq(memberships.id, existing.id));
    } else {
      await tx
        .insert(memberships)
        .values({ schoolId: ctx.schoolId, userId: account.userId, roles });
    }
    await tx.insert(auditLogs).values({
      schoolId: ctx.schoolId,
      actorUserId: principal.userId,
      action: "staff.add",
      entityType: "membership",
      entityId: account.userId,
      before: existing ? { roles: existing.roles } : null,
      after: { roles, existingAccount: account.existingAccount },
    });
    return account;
  });
}

/** Remplace les rôles du personnel d'un membre (un éventuel rôle parent est conservé). */
export async function updateStaffRoles(
  principal: Principal,
  userId: string,
  newRoles: readonly string[],
): Promise<void> {
  const ctx = schoolContext(principal);
  const staffRoles = StaffRolesSchema.parse(newRoles);
  await withSchool(ctx, async (tx) => {
    const directors = await lockDirectors(tx, ctx.schoolId);
    const existing = await lockMembership(tx, ctx.schoolId, userId);
    if (!existing || !existing.roles.some(isStaffRole)) throw new SettingsError("notMember");
    if (directors.length === 1 && directors[0] === userId && !staffRoles.includes("director")) {
      throw new SettingsError("lastDirector");
    }
    const roles: MembershipRole[] = [
      ...existing.roles.filter((r) => !isStaffRole(r)),
      ...staffRoles,
    ];
    await tx
      .update(memberships)
      .set({ roles, updatedAt: new Date() })
      .where(eq(memberships.id, existing.id));
    await tx.insert(auditLogs).values({
      schoolId: ctx.schoolId,
      actorUserId: principal.userId,
      action: "staff.roles",
      entityType: "membership",
      entityId: userId,
      before: { roles: existing.roles },
      after: { roles },
    });
  });
}

/**
 * Retire une personne du personnel de l'école. Son compte n'est pas supprimé (il peut servir dans
 * une autre école) ; un éventuel rôle parent est conservé. Ses sessions dans l'école tombent aussitôt,
 * puisque les rôles sont relus à chaque requête.
 */
export async function removeStaff(principal: Principal, userId: string): Promise<void> {
  const ctx = schoolContext(principal);
  if (userId === principal.userId) throw new SettingsError("cannotRemoveSelf");
  await withSchool(ctx, async (tx) => {
    const directors = await lockDirectors(tx, ctx.schoolId);
    const existing = await lockMembership(tx, ctx.schoolId, userId);
    if (!existing || !existing.roles.some(isStaffRole)) throw new SettingsError("notMember");
    if (directors.length === 1 && directors[0] === userId) throw new SettingsError("lastDirector");
    const remaining = existing.roles.filter((r) => !isStaffRole(r));
    if (remaining.length > 0) {
      await tx
        .update(memberships)
        .set({ roles: remaining, updatedAt: new Date() })
        .where(eq(memberships.id, existing.id));
    } else {
      await tx.delete(memberships).where(eq(memberships.id, existing.id));
    }
    await tx.insert(auditLogs).values({
      schoolId: ctx.schoolId,
      actorUserId: principal.userId,
      action: "staff.remove",
      entityType: "membership",
      entityId: userId,
      before: { roles: existing.roles },
      after: { roles: remaining },
    });
  });
}
