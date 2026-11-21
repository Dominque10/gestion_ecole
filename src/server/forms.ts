import "server-only";
import type { z } from "zod";
import { t } from "@/i18n";
import { SettingsError } from "@/modules/settings/errors";
import { StudentError } from "@/modules/students/errors";
import { FinanceError } from "@/modules/finance/errors";
import { ForbiddenError } from "@/server/auth/permissions";
import type { FormState } from "@/lib/form-state";

/** Associe chaque champ en erreur à son message (le premier champ du chemin Zod). */
export function fieldErrors(
  error: z.ZodError,
  messages: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    if (field in messages && !(field in result)) result[field] = messages[field];
  }
  return result;
}

export function invalidForm(
  error: z.ZodError,
  messages: Record<string, string>,
  values: Record<string, string> = {},
): FormState {
  return {
    status: "error",
    message: t("form.invalid"),
    fieldErrors: fieldErrors(error, messages),
    values,
  };
}

/** Traduit un refus métier ou de droits en message ; toute autre erreur remonte telle quelle. */
export function refusalMessage(error: unknown): string {
  if (error instanceof SettingsError) return t(`settings.errors.${error.code}`);
  if (error instanceof StudentError) return t(`students.errors.${error.code}`);
  if (error instanceof FinanceError) return t(`finance.errors.${error.code}`, error.params);
  if (error instanceof ForbiddenError) return t("form.forbidden");
  throw error;
}

/** Lit les champs texte d'un formulaire. */
export function readFields<K extends string>(
  formData: FormData,
  keys: readonly K[],
): Record<K, string> {
  return Object.fromEntries(keys.map((k) => [k, String(formData.get(k) ?? "")])) as Record<
    K,
    string
  >;
}
