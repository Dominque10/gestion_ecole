"use server";

import { refresh } from "next/cache";
import { t } from "@/i18n";
import type { FormState } from "@/lib/form-state";
import { gradingRulesFromForm, MENTION_ROWS } from "@/modules/grading/rules-form";
import { updateGradingRules } from "@/modules/grading/settings";
import { requireAction } from "@/server/auth/session";
import { refusalMessage } from "@/server/forms";

export async function saveGradingRulesAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  const fields = Object.fromEntries(
    [...formData.entries()].map(([key, value]) => [key, String(value)]),
  );
  const values = Object.fromEntries(
    Array.from({ length: MENTION_ROWS }, (_, i) => [
      [`mention-${i}`, fields[`mention-${i}`] ?? ""],
      [`seuil-${i}`, fields[`seuil-${i}`] ?? ""],
    ]).flat(),
  );
  const rules = gradingRulesFromForm(fields);
  if (!rules) {
    return {
      status: "error",
      message: t("settings.errors.gradingInvalid"),
      fieldErrors: {},
      values,
    };
  }
  try {
    await updateGradingRules(principal, rules);
    refresh();
    return { status: "success", message: t("gradingRules.saved"), fieldErrors: {}, values: {} };
  } catch (error) {
    return { status: "error", message: refusalMessage(error), fieldErrors: {}, values };
  }
}
