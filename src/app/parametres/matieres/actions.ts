"use server";

import { refresh } from "next/cache";
import { t } from "@/i18n";
import type { FormState } from "@/lib/form-state";
import { createSubject, deleteSubject, renameSubject } from "@/modules/settings/levels";
import { NameSchema } from "@/modules/settings/schemas";
import { requireAction } from "@/server/auth/session";
import { refusalMessage } from "@/server/forms";

const result = (status: "success" | "error", message: string, values = {}): FormState => ({
  status,
  message,
  fieldErrors: {},
  values,
});

export async function createSubjectAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  const raw = String(formData.get("name") ?? "");
  const name = NameSchema.safeParse(raw);
  if (!name.success) {
    return {
      ...result("error", t("subjects.nameError"), { name: raw }),
      fieldErrors: { name: t("subjects.nameError") },
    };
  }
  try {
    await createSubject(principal, name.data);
    refresh();
    return result("success", t("subjects.added"));
  } catch (error) {
    return result("error", refusalMessage(error), { name: raw });
  }
}

export async function renameSubjectAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  const name = NameSchema.safeParse(formData.get("name"));
  if (!name.success) return result("error", t("subjects.nameError"));
  try {
    await renameSubject(principal, String(formData.get("id") ?? ""), name.data);
    refresh();
    return result("success", t("subjects.renamed"));
  } catch (error) {
    return result("error", refusalMessage(error));
  }
}

export async function deleteSubjectAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  try {
    await deleteSubject(principal, String(formData.get("id") ?? ""));
    refresh();
    return result("success", t("subjects.deleted"));
  } catch (error) {
    return result("error", refusalMessage(error));
  }
}
