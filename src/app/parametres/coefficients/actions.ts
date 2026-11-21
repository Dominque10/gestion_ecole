"use server";

import { refresh } from "next/cache";
import { t } from "@/i18n";
import type { FormState } from "@/lib/form-state";
import { addDefaultGrid, saveGrid, type GridKey } from "@/modules/settings/coefficients";
import { requireAction } from "@/server/auth/session";
import { refusalMessage } from "@/server/forms";

const result = (status: "success" | "error", message: string): FormState => ({
  status,
  message,
  fieldErrors: {},
  values: {},
});

function readKey(formData: FormData): GridKey {
  return {
    academicYearId: String(formData.get("annee") ?? ""),
    levelId: String(formData.get("niveau") ?? ""),
    series: String(formData.get("serie") ?? ""),
  };
}

export async function saveGridAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  // Cases cochées : champ « on » (valeur = id de la matière) ; coefficient : champ « coef-<id> ».
  const entries = formData
    .getAll("on")
    .map(String)
    .map((subjectId) => ({
      subjectId,
      coefficient: Number(formData.get(`coef-${subjectId}`) ?? ""),
    }));
  if (
    entries.some((e) => !Number.isInteger(e.coefficient) || e.coefficient < 1 || e.coefficient > 20)
  ) {
    return result("error", t("settings.errors.gridInvalid"));
  }
  try {
    await saveGrid(principal, readKey(formData), entries);
    refresh();
    return result("success", t("coefficients.saved"));
  } catch (error) {
    return result("error", refusalMessage(error));
  }
}

export async function addDefaultGridAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  try {
    const added = await addDefaultGrid(principal, readKey(formData));
    refresh();
    return result(
      "success",
      added > 0 ? t("coefficients.addedDefaults", { n: added }) : t("coefficients.nothingToAdd"),
    );
  } catch (error) {
    return result("error", refusalMessage(error));
  }
}
