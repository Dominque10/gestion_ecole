// Le directeur gère les comptes du personnel de son école et leurs rôles (décision D3).
// Chaque changement de droits est tracé dans audit_logs (CLAUDE.md §6, Traçabilité).
import { and, arrayContains, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { authorize, type MembershipRole, type Principal } from "@/server/auth/permissions";
import { withSchool, type Tx } from "@/server/db/client";
import {
  academicYears,
  auditLogs,
  classes,
  classSubjects,
  memberships,
  sessions,
  users,
} from "@/server/db/schema";
import { hashPassword } from "@/server/auth/password";
import { findOrCreateAccount } from "./accounts";
import { SettingsError } from "./errors";
import {
  AddStaffSchema,
  STAFF_ROLES,
  StaffRolesSchema,
  TemporaryPasswordSchema,
  type AddStaffInput,
} from "./schemas";

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

/**
 * Une personne qui n'est plus enseignante dans l'école perd ses affectations (matières, professeur
 * principal) dans les années non archivées. Les années archivées gardent leur historique.
 */
async function releaseTeaching(tx: Tx, schoolId: string, userId: string): Promise<void> {
  const openYears = tx
    .select({ id: academicYears.id })
    .from(academicYears)
    .where(
      and(
        eq(academicYears.schoolId, schoolId),
        inArray(academicYears.status, ["upcoming", "active"]),
      ),
    );
  await tx
    .update(classSubjects)
    .set({ teacherId: null, updatedAt: new Date() })
    .where(
      and(
        eq(classSubjects.schoolId, schoolId),
        eq(classSubjects.teacherId, userId),
        inArray(classSubjects.academicYearId, openYears),
      ),
    );
  await tx
    .update(classes)
    .set({ headTeacherId: null, updatedAt: new Date() })
    .where(
      and(
        eq(classes.schoolId, schoolId),
        eq(classes.headTeacherId, userId),
        inArray(classes.academicYearId, openYears),
      ),
    );
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
    if (!roles.includes("teacher")) await releaseTeaching(tx, ctx.schoolId, userId);
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
    await releaseTeaching(tx, ctx.schoolId, userId);
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

/**
 * Mot de passe oublié (décision D5, H9) : le directeur remet un mot de passe provisoire à un membre
 * du personnel, qui devra le changer à la connexion. Refusé si le compte appartient aussi à une
 * autre école (le super-admin s'en charge alors), et pour son propre compte. Les sessions ouvertes
 * de la personne sont fermées ; le blocage après 5 essais est levé. Tracé dans le journal.
 */
export async function resetStaffPassword(
  principal: Principal,
  userId: string,
  temporaryPassword: string,
): Promise<void> {
  const ctx = schoolContext(principal);
  const password = TemporaryPasswordSchema.parse(temporaryPassword);
  if (userId === principal.userId) throw new SettingsError("cannotResetSelf");
  const passwordHash = await hashPassword(password);
  await withSchool(ctx, async (tx) => {
    const existing = await lockMembership(tx, ctx.schoolId, userId);
    if (!existing || !existing.roles.some(isStaffRole)) throw new SettingsError("notMember");
    const found = await tx.execute<{ other: boolean }>(
      sql`select app.user_in_other_school(${userId}) as other`,
    );
    if (found.rows[0]?.other) throw new SettingsError("otherSchoolAccount");
    const [target] = await tx
      .select({ isSuperadmin: users.isSuperadmin })
      .from(users)
      .where(eq(users.id, userId));
    if (!target || target.isSuperadmin) throw new SettingsError("platformAccount");
    await tx
      .update(users)
      .set({
        passwordHash,
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.insert(auditLogs).values({
      schoolId: ctx.schoolId,
      actorUserId: principal.userId,
      action: "staff.password_reset",
      entityType: "user",
      entityId: userId,
    });
  });
}
