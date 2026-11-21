/** Rôles que le directeur peut donner au personnel (ni parent : M2/M6, ni support : accordé à part). */
export const STAFF_ROLES = ["director", "secretary", "accountant", "teacher"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
