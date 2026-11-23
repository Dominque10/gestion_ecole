"use server";

import { refresh } from "next/cache";
import { t } from "@/i18n";
import type { FormState } from "@/lib/form-state";
import { closePeriod, reopenPeriod } from "@/modules/grading/results";
import { requireAction } from "@/server/auth/session";
import { refusalMessage } from "@/server/forms";

const state = (status: "success" | "error", message: string, values = {}): FormState => ({
  status,
  message,
  fieldErrors: {},
  values,
});

export async function closePeriodAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("periods:close");
  try {
    await closePeriod(
      principal,
      String(formData.get("classe") ?? ""),
      String(formData.get("periode") ?? ""),
    );
  } catch (error) {
    return state("error", refusalMessage(error));
  }
  refresh();
  return state("success", t("results.closed"));
}

export async function reopenPeriodAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("grades:unlock");
  const reason = String(formData.get("motif") ?? "");
  try {
    await reopenPeriod(
      principal,
      String(formData.get("classe") ?? ""),
      String(formData.get("periode") ?? ""),
      reason,
    );
  } catch (error) {
    return state("error", refusalMessage(error), { motif: reason });
  }
  refresh();
  return state("success", t("results.reopened"));
}
