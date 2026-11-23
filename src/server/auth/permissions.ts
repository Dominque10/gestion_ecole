// Tableau des droits du cahier des charges (§3), en un seul endroit.
// Toute action serveur vérifie un droit ici AVANT de toucher aux données (jamais seulement dans l'UI).
// Le périmètre fin (enseignant : ses classes ; parent : ses enfants) est vérifié en plus dans chaque module.

export type MembershipRole =
  "director" | "secretary" | "accountant" | "teacher" | "parent" | "support";

export type Principal = {
  userId: string;
  /** École de la session ; null = session de plateforme (super-admin). */
  schoolId: string | null;
  roles: readonly MembershipRole[];
  isSuperadmin: boolean;
};

/** Actions réservées au super-admin, hors de toute école. */
const PLATFORM_ACTIONS = ["school:create", "school:subscription", "dashboard:global"] as const;

/** Actions dans une école, avec les rôles autorisés. */
const SCHOOL_ACTIONS = {
  "settings:read": ["director", "support"],
  "settings:write": ["director"],
  /** Comptes du personnel et leurs rôles (décision D3). */
  "staff:manage": ["director"],
  "students:read": ["director", "secretary", "accountant", "teacher", "support"],
  "students:write": ["director", "secretary"],
  "students:medical": ["director"],
  /** Validation manuelle d'une inscription : exception réservée au directeur, tracée (décision A3). */
  "enrollments:validate": ["director"],
  /** Échéances : générer les frais manquants, ajouter un frais facultatif. */
  "invoices:manage": ["director", "secretary", "accountant"],
  /** Bourse et remise exceptionnelle (cahier des charges §5, M3). */
  "invoices:discount": ["director"],
  "payments:collect": ["accountant"],
  "payments:cancel:request": ["accountant"],
  "payments:cancel:approve": ["director"],
  "payments:pay-online": ["parent"],
  /** Clôture journalière de sa caisse ; réouverture par le directeur (tracée). */
  "cash:close": ["accountant"],
  "cash:reopen": ["director"],
  /** Évaluations : un enseignant pour ses classes et matières, le directeur pour toute l'école (3b). */
  "assessments:manage": ["director", "teacher"],
  "grades:write": ["director", "teacher"],
  /** Clôture d'une période pour une classe ; réouverture (motif obligatoire, tracée) — 3d. */
  "periods:close": ["director"],
  "grades:unlock": ["director"],
  "reportcards:publish": ["director"],
  "reportcards:read": ["director", "parent"],
  "attendance:write": ["director", "secretary", "teacher"],
  "attendance:read": ["director", "secretary", "teacher", "parent"],
  "dashboard:school": ["director"],
  "dashboard:finance": ["director", "accountant"],
  "support:grant": ["director"],
  "audit:read": ["director"],
} as const satisfies Record<string, readonly MembershipRole[]>;

export type PlatformAction = (typeof PLATFORM_ACTIONS)[number];
export type SchoolAction = keyof typeof SCHOOL_ACTIONS;
export type Action = PlatformAction | SchoolAction;

function isPlatformAction(action: Action): action is PlatformAction {
  return (PLATFORM_ACTIONS as readonly string[]).includes(action);
}

export function can(principal: Principal, action: Action): boolean {
  if (isPlatformAction(action)) {
    return principal.isSuperadmin && principal.schoolId === null;
  }
  if (principal.schoolId === null) return false;
  const allowed: readonly MembershipRole[] = SCHOOL_ACTIONS[action];
  return principal.roles.some((role) => allowed.includes(role));
}

export class ForbiddenError extends Error {
  constructor(readonly action: Action) {
    super(`Action non autorisée : ${action}`);
    this.name = "ForbiddenError";
  }
}

export function authorize(principal: Principal, action: Action): void {
  if (!can(principal, action)) throw new ForbiddenError(action);
}

/** Le principal n'agit qu'en accès Support (lecture seule, tracée). */
export function isSupportOnly(principal: Principal): boolean {
  return principal.roles.length > 0 && principal.roles.every((r) => r === "support");
}

export const ALL_SCHOOL_ACTIONS = Object.keys(SCHOOL_ACTIONS) as SchoolAction[];
