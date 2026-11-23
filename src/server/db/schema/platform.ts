import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// Règles RLS : voir la migration SQL « rls » (drizzle/). Ce fichier ne décrit que la structure.

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const schoolStatus = pgEnum("school_status", ["active", "suspended"]);
export const subscriptionPlan = pgEnum("subscription_plan", ["essential", "complete"]);

/** Établissement. Pas de school_id : c'est l'école elle-même (RLS sur id). */
export const schools = pgTable("schools", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** Code saisi à la connexion, en minuscules (ex. « sjb »). */
  code: text("code").notNull().unique(),
  /** Préfixe des matricules élèves (ex. « SJB » → SJB-26-00042). */
  matriculePrefix: text("matricule_prefix").notNull(),
  /** Dernier numéro d'ordre de matricule attribué (continu, jamais réutilisé, décision A6). */
  lastMatriculeNumber: integer("last_matricule_number").notNull().default(0),
  /** Réduction fratrie en % sur la scolarité, dès le 2e enfant inscrit (décision D6). 0 = aucune. */
  siblingDiscountPercent: integer("sibling_discount_percent").notNull().default(0),
  /** Option B7 (désactivée par défaut) : le parent ne voit pas le bulletin tant qu'une échéance échue reste impayée. */
  blockBulletinsIfOverdue: boolean("block_bulletins_if_overdue").notNull().default(false),
  /**
   * Règles de calcul des moyennes (décision D10), validées par `GradingRulesSchema`
   * (`src/modules/grading/rules.ts`). null = règles par défaut.
   */
  gradingRules: jsonb("grading_rules"),
  subdomain: text("subdomain").unique(),
  address: text("address"),
  phone: text("phone"),
  logoKey: text("logo_key"),
  stampKey: text("stamp_key"),
  signatureKey: text("signature_key"),
  plan: subscriptionPlan("plan").notNull().default("essential"),
  status: schoolStatus("status").notNull().default("active"),
  ...timestamps,
});

export const userStatus = pgEnum("user_status", ["active", "disabled"]);

/** Compte commun à toute la plateforme (pas de school_id, pas de RLS). */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").unique(),
    phone: text("phone").unique(),
    isSuperadmin: boolean("is_superadmin").notNull().default(false),
    status: userStatus("status").notNull().default("active"),
    /** Argon2id. Nul pour un compte sans mot de passe (parent : connexion par code SMS, M6). */
    passwordHash: text("password_hash"),
    /** Mot de passe provisoire (donné par le super-admin ou le directeur) : à changer à la connexion. */
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    /** Code de connexion par SMS des parents (4a) : haché, jamais en clair. */
    otpHash: text("otp_hash"),
    otpExpiresAt: timestamp("otp_expires_at", { withTimezone: true }),
    otpAttempts: integer("otp_attempts").notNull().default(0),
    otpSentAt: timestamp("otp_sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [check("users_email_or_phone", sql`${t.email} is not null or ${t.phone} is not null`)],
);

export const membershipRole = pgEnum("membership_role", [
  "director",
  "secretary",
  "accountant",
  "teacher",
  "parent",
  "support",
]);

/** Appartenance d'un utilisateur à une école, avec un ou plusieurs rôles. */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    roles: membershipRole("roles").array().notNull(),
    /** Accès Support (décision A7) : date de fin de l'autorisation. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** Accès Support : directeur qui a accordé l'accès. */
    grantedBy: uuid("granted_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    unique("memberships_school_user").on(t.schoolId, t.userId),
    check("memberships_roles_not_empty", sql`cardinality(${t.roles}) > 0`),
    index("memberships_user_idx").on(t.userId),
  ],
);

/**
 * Sessions de connexion. Seule l'empreinte SHA-256 du jeton est stockée (le jeton reste dans le cookie).
 * Exemptée de RLS : lue avant de connaître l'école, uniquement par empreinte de jeton (voir rls.test.ts).
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** École choisie à la connexion (code école). Nul = session de plateforme (super-admin). */
    schoolId: uuid("school_id").references(() => schools.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** Journal d'audit en ajout seul (ni UPDATE ni DELETE, garanti par la base). */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Nul uniquement pour les actions de plateforme (ex. création d'une école). */
    schoolId: uuid("school_id").references(() => schools.id),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_school_created_idx").on(t.schoolId, t.createdAt)],
);
