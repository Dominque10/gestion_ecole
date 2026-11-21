// Schémas de validation du paramétrage (M1), partagés entre actions serveur et tests.
import { z } from "zod";
import { PASSWORD_MIN_LENGTH } from "@/server/auth/password";
import { normalizePhone, parseIdentifier } from "@/server/auth/phone";
import { isValidDate } from "./periods-logic";
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

/** Champ facultatif : une saisie vide devient null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

export const SchoolProfileSchema = z.object({
  name: z.string().trim().min(2).max(150),
  address: optionalText(300),
  phone: z
    .string()
    .trim()
    .max(30)
    .transform((value, ctx) => {
      if (value === "") return null;
      const phone = normalizePhone(value);
      if (!phone) {
        ctx.addIssue({ code: "custom", message: "phone" });
        return z.NEVER;
      }
      return phone;
    }),
});
export type SchoolProfileInput = z.input<typeof SchoolProfileSchema>;

export const DateSchema = z.string().trim().refine(isValidDate);

export const AcademicYearSchema = z
  .object({
    label: z.string().trim().min(4).max(30),
    startDate: DateSchema,
    endDate: DateSchema,
    periodKind: z.enum(["trimester", "semester"]),
  })
  .refine((y) => y.startDate < y.endDate, { path: ["endDate"], message: "yearDates" });
export type AcademicYearInput = z.input<typeof AcademicYearSchema>;

export const PeriodsSchema = z
  .array(
    z.object({
      position: z.coerce.number().int().min(1).max(3),
      label: z.string().trim().min(1).max(60),
      startDate: z.string().trim(),
      endDate: z.string().trim(),
    }),
  )
  .max(3);
export type PeriodsInput = z.input<typeof PeriodsSchema>;

export const LevelSchema = z.object({
  cycle: z.enum(["preschool", "primary", "college", "lycee"]),
  name: z.string().trim().min(1).max(40),
});
export type LevelInput = z.input<typeof LevelSchema>;

export const NameSchema = z.string().trim().min(1).max(80);
