import { describe, expect, it } from "vitest";
import {
  ALL_SCHOOL_ACTIONS,
  authorize,
  can,
  ForbiddenError,
  type MembershipRole,
  type Principal,
  type SchoolAction,
} from "./permissions";

const SCHOOL = "11111111-1111-4111-8111-111111111111";
const as = (...roles: MembershipRole[]): Principal => ({
  userId: "22222222-2222-4222-8222-222222222222",
  schoolId: SCHOOL,
  roles,
  isSuperadmin: false,
});
const platformAdmin: Principal = { userId: "x", schoolId: null, roles: [], isSuperadmin: true };

// Une ligne par ligne du tableau §3 du cahier des charges (colonnes : rôles autorisés).
const MATRIX: Record<SchoolAction, MembershipRole[]> = {
  "settings:read": ["director", "support"],
  "settings:write": ["director"],
  "staff:manage": ["director"],
  "students:read": ["director", "secretary", "accountant", "teacher", "support"],
  "students:write": ["director", "secretary"],
  "students:medical": ["director"],
  "enrollments:validate": ["director"],
  "invoices:manage": ["director", "secretary", "accountant"],
  "invoices:discount": ["director"],
  "payments:collect": ["accountant"],
  "payments:cancel:request": ["accountant"],
  "payments:cancel:approve": ["director"],
  "payments:pay-online": ["parent"],
  "parent:view": ["parent"],
  "cash:close": ["accountant"],
  "cash:reopen": ["director"],
  "assessments:manage": ["director", "teacher"],
  "grades:write": ["director", "teacher"],
  "periods:close": ["director"],
  "grades:unlock": ["director"],
  "reportcards:council": ["director"],
  "reportcards:publish": ["director"],
  "reportcards:read": ["director", "parent"],
  "attendance:write": ["director", "secretary", "teacher"],
  "attendance:justify": ["director", "secretary"],
  "attendance:read": ["director", "secretary", "teacher", "parent"],
  "dashboard:school": ["director"],
  "dashboard:finance": ["director", "accountant"],
  "support:grant": ["director"],
  "audit:read": ["director"],
};

const ROLES: MembershipRole[] = [
  "director",
  "secretary",
  "accountant",
  "teacher",
  "parent",
  "support",
];

describe("Tableau des droits (§3)", () => {
  it("chaque action du code figure dans le tableau de référence", () => {
    expect([...ALL_SCHOOL_ACTIONS].sort()).toEqual(Object.keys(MATRIX).sort());
  });

  for (const action of ALL_SCHOOL_ACTIONS) {
    for (const role of ROLES) {
      const expected = MATRIX[action].includes(role);
      it(`${action} : ${role} → ${expected ? "autorisé" : "refusé"}`, () => {
        expect(can(as(role), action)).toBe(expected);
      });
    }
  }

  it("un compte cumulant plusieurs rôles a l'union des droits (directeur qui enseigne)", () => {
    expect(can(as("teacher", "accountant"), "payments:collect")).toBe(true);
    expect(can(as("teacher", "accountant"), "grades:write")).toBe(true);
  });

  it("le Support ne peut que lire le paramétrage et les élèves", () => {
    const allowed = ALL_SCHOOL_ACTIONS.filter((a) => can(as("support"), a));
    expect(allowed.sort()).toEqual(["settings:read", "students:read"]);
  });

  it("sans rôle, aucune action d'école", () => {
    expect(ALL_SCHOOL_ACTIONS.some((a) => can(as(), a))).toBe(false);
  });
});

describe("Super-admin", () => {
  it("crée une école en session de plateforme", () => {
    expect(can(platformAdmin, "school:create")).toBe(true);
  });

  it("n'a aucun droit métier en session de plateforme", () => {
    expect(ALL_SCHOOL_ACTIONS.some((a) => can(platformAdmin, a))).toBe(false);
  });

  it("n'a pas les actions de plateforme quand il est dans une école", () => {
    expect(can({ ...platformAdmin, schoolId: SCHOOL, roles: ["support"] }, "school:create")).toBe(
      false,
    );
  });

  it("un directeur ne peut pas créer d'école", () => {
    expect(can(as("director"), "school:create")).toBe(false);
  });
});

describe("authorize", () => {
  it("lève ForbiddenError quand l'action est refusée", () => {
    expect(() => authorize(as("teacher"), "payments:collect")).toThrow(ForbiddenError);
  });

  it("ne lève rien quand l'action est autorisée", () => {
    expect(() => authorize(as("accountant"), "payments:collect")).not.toThrow();
  });
});
