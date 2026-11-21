"use server";

import { refresh } from "next/cache";
import { t } from "@/i18n";
import type { FormState } from "@/lib/form-state";
import { addDefaultLevels, createLevel, deleteLevel, renameLevel } from "@/modules/settings/levels";
import { LevelSchema, NameSchema } from "@/modules/settings/schemas";
import { requireAction } from "@/server/auth/session";
import { readFields, refusalMessage } from "@/server/forms";

const result = (status: "success" | "error", message: string, values = {}): FormState => ({
  status,
  message,
  fieldErrors: {},
  values,
});

export async function addDefaultLevelsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  const cycle = LevelSchema.shape.cycle.safeParse(formData.get("cycle"));
  if (!cycle.success) return result("error", t("form.invalid"));
  try {
    const added = await addDefaultLevels(principal, cycle.data);
    refresh();
    return result(
      "success",
      added > 0 ? t("levels.addedDefaults", { n: added }) : t("levels.nothingToAdd"),
    );
  } catch (error) {
    return result("error", refusalMessage(error));
  }
}

export async function createLevelAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  const values = readFields(formData, ["cycle", "name"]);
  const parsed = LevelSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ...result("error", t("levels.nameError"), values),
      fieldErrors: { name: t("levels.nameError") },
    };
  }
  try {
    await createLevel(principal, parsed.data);
    refresh();
    return result("success", t("levels.added"));
  } catch (error) {
    return result("error", refusalMessage(error), values);
  }
}

export async function renameLevelAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  const name = NameSchema.safeParse(formData.get("name"));
  if (!name.success) return result("error", t("levels.nameError"));
  try {
    await renameLevel(principal, String(formData.get("id") ?? ""), name.data);
    refresh();
    return result("success", t("levels.renamed"));
  } catch (error) {
    return result("error", refusalMessage(error));
  }
}

export async function deleteLevelAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  try {
    await deleteLevel(principal, String(formData.get("id") ?? ""));
    refresh();
    return result("success", t("levels.deleted"));
  } catch (error) {
    return result("error", refusalMessage(error));
  }
}
