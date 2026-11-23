import "server-only";
import { ExportError } from "@/modules/exports/lists";
import type { z } from "zod";
import { t } from "@/i18n";
import { SettingsError } from "@/modules/settings/errors";
import { StudentError } from "@/modules/students/errors";
import { FinanceError } from "@/modules/finance/errors";
import { GradingError } from "@/modules/grading/errors";
import { AttendanceError } from "@/modules/attendance/errors";
import { TemplateError } from "@/modules/notifications/settings";
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
  if (error instanceof GradingError) return t(`grading.errors.${error.code}`);
  if (error instanceof AttendanceError) return t(`attendance.errors.${error.code}`);
  if (error instanceof TemplateError) {
    return t(`notifications.problems.${error.problem}`, {
      message: t(`notifications.kinds.${error.kind}`),
      champ: error.field ?? "",
    });
  }
  if (error instanceof ExportError) return t(`exports.errors.${error.code}`);
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
