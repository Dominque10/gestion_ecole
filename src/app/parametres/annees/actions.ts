"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { t } from "@/i18n";
import type { FormState } from "@/lib/form-state";
import { AcademicYearSchema } from "@/modules/settings/schemas";
import {
  activateYear,
  createYear,
  deleteYear,
  updatePeriods,
  updateYear,
} from "@/modules/settings/years";
import { copyStructure } from "@/modules/settings/structure-copy";
import { requireAction } from "@/server/auth/session";
import { invalidForm, readFields, refusalMessage } from "@/server/forms";

const YEAR_FIELDS = ["label", "startDate", "endDate", "periodKind"] as const;

const success = (message: string, values: Record<string, string> = {}): FormState => ({
  status: "success",
  message,
  fieldErrors: {},
  values,
});
const failure = (message: string, values: Record<string, string> = {}): FormState => ({
  status: "error",
  message,
  fieldErrors: {},
  values,
});

function yearFieldMessages() {
  return {
    label: t("years.errors.label"),
    startDate: t("years.errors.startDate"),
    endDate: t("years.errors.endDate"),
  };
}

export async function createYearAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  const values = readFields(formData, YEAR_FIELDS);
  const parsed = AcademicYearSchema.safeParse(values);
  if (!parsed.success) return invalidForm(parsed.error, yearFieldMessages(), values);
  let yearId: string;
  try {
    yearId = await createYear(principal, parsed.data);
  } catch (error) {
    return failure(refusalMessage(error), values);
  }
  redirect(`/parametres/annees/${yearId}?nouvelle=1`);
}

export async function updateYearAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  const yearId = String(formData.get("yearId") ?? "");
  const values = readFields(formData, YEAR_FIELDS);
  const parsed = AcademicYearSchema.safeParse(values);
  if (!parsed.success) return invalidForm(parsed.error, yearFieldMessages(), values);
  try {
    const { periodsReset } = await updateYear(principal, yearId, parsed.data);
    refresh();
    return success(periodsReset ? t("years.periodsReset") : t("years.saved"), values);
  } catch (error) {
    return failure(refusalMessage(error), values);
  }
}

export async function updatePeriodsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  const yearId = String(formData.get("yearId") ?? "");
  const count = Number(formData.get("count") ?? 0);
  const drafts = Array.from({ length: Math.min(Math.max(count, 0), 3) }, (_, i) => {
    const n = i + 1;
    return {
      position: n,
      label: String(formData.get(`label-${n}`) ?? ""),
      startDate: String(formData.get(`start-${n}`) ?? ""),
      endDate: String(formData.get(`end-${n}`) ?? ""),
    };
  });
  const values = Object.fromEntries(
    drafts.flatMap((p) => [
      [`label-${p.position}`, p.label],
      [`start-${p.position}`, p.startDate],
      [`end-${p.position}`, p.endDate],
    ]),
  );
  try {
    await updatePeriods(principal, yearId, drafts);
    refresh();
    return success(t("years.periodsSaved"), values);
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return failure(t("settings.errors.periodLabel"), values);
    }
    return failure(refusalMessage(error), values);
  }
}

export async function activateYearAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  const yearId = String(formData.get("yearId") ?? "");
  try {
    await activateYear(principal, yearId);
  } catch (error) {
    return failure(refusalMessage(error));
  }
  // Le bloc « Activer » disparaît une fois l'année active : la confirmation s'affiche sur la page.
  redirect(`/parametres/annees/${yearId}?activee=1`);
}

export async function deleteYearAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  try {
    await deleteYear(principal, String(formData.get("yearId") ?? ""));
  } catch (error) {
    return failure(refusalMessage(error));
  }
  redirect("/parametres/annees");
}

export async function copyStructureAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  try {
    const copied = await copyStructure(
      principal,
      String(formData.get("source") ?? ""),
      String(formData.get("yearId") ?? ""),
    );
    refresh();
    return success(
      t("copy.done", { classes: copied.classes, grille: copied.gridRows, frais: copied.feeRows }),
    );
  } catch (error) {
    return failure(refusalMessage(error));
  }
}
