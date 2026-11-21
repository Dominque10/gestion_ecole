// Schémas de validation du paramétrage (M1), partagés entre actions serveur et tests.
import { z } from "zod";
import { PASSWORD_MIN_LENGTH } from "@/server/auth/password";
import { parseIdentifier } from "@/server/auth/phone";
import { STAFF_ROLES } from "./roles";

export { STAFF_ROLES };

/**
 * Code école saisi à la connexion. Hypothèse : 2 à 20 lettres minuscules ou chiffres, sans espace
 * ni accent (facile à taper sur un téléphone).
 */
export const SchoolCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]{2,20}$/);

/** Préfixe des matricules (décision A6). Hypothèse : 2 à 5 lettres majuscules (ex. « SJB »). */
export const MatriculePrefixSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2,5}$/);

export const PersonNameSchema = z.string().trim().min(2).max(120);

/** Téléphone (normalisé en +242…) ou email (en minuscules). */
export const IdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .transform((value, ctx) => {
    const parsed = parseIdentifier(value);
    if (!parsed) {
      ctx.addIssue({ code: "custom", message: "identifier" });
      return z.NEVER;
    }
    return parsed;
  });

export const TemporaryPasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(200);

export const StaffRolesSchema = z
  .array(z.enum(STAFF_ROLES))
  .min(1)
  .transform((roles) => STAFF_ROLES.filter((r) => roles.includes(r)));

export const CreateSchoolSchema = z.object({
  name: z.string().trim().min(2).max(150),
  code: SchoolCodeSchema,
  matriculePrefix: MatriculePrefixSchema,
  directorName: PersonNameSchema,
  directorIdentifier: IdentifierSchema,
  directorPassword: TemporaryPasswordSchema,
});
export type CreateSchoolInput = z.input<typeof CreateSchoolSchema>;

export const AddStaffSchema = z.object({
  name: PersonNameSchema,
  identifier: IdentifierSchema,
  password: TemporaryPasswordSchema,
  roles: StaffRolesSchema,
});
/** Saisie brute du formulaire : les rôles sont vérifiés par le schéma. */
export type AddStaffInput = Omit<z.input<typeof AddStaffSchema>, "roles"> & {
  roles: readonly string[];
};
