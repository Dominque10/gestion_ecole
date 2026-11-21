import { z } from "zod";
import { normalizePhone } from "@/server/auth/phone";
import { isValidDate } from "@/modules/settings/periods-logic";
import { formatFirstNames, formatLastName } from "./identity";

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

const PhoneSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const phone = normalizePhone(value);
    if (!phone) {
      ctx.addIssue({ code: "custom", message: "phone" });
      return z.NEVER;
    }
    return phone;
  });

const OptionalPhoneSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (value === "") return null;
    const phone = normalizePhone(value);
    if (!phone) {
      ctx.addIssue({ code: "custom", message: "phone" });
      return z.NEVER;
    }
    return phone;
  });

export const StudentSchema = z.object({
  lastName: z.string().trim().min(1).max(80).transform(formatLastName),
  firstNames: z.string().trim().min(1).max(120).transform(formatFirstNames),
  sex: z.enum(["M", "F"]),
  birthDate: z
    .string()
    .trim()
    .refine((v) => v === "" || isValidDate(v))
    .transform((v) => (v === "" ? null : v)),
  birthPlace: optional(80),
  nationality: optional(60),
  previousSchool: optional(120),
});
/** Saisie brute du formulaire : le sexe est vérifié par le schéma. */
export type StudentInput = Omit<z.input<typeof StudentSchema>, "sex"> & { sex: string };

export const GuardianSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: PhoneSchema,
  otherPhone: OptionalPhoneSchema,
  relationship: optional(40),
});
export type GuardianInput = z.input<typeof GuardianSchema>;

export const MedicalSchema = z.object({
  allergies: optional(500),
  treatments: optional(500),
  emergencyContactName: optional(120),
  emergencyContactPhone: OptionalPhoneSchema,
  notes: optional(1000),
});
export type MedicalInput = z.input<typeof MedicalSchema>;
