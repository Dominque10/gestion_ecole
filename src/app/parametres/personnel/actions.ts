"use server";

import { refresh } from "next/cache";
import { t } from "@/i18n";
import type { FormState } from "@/lib/form-state";
import { AddStaffSchema } from "@/modules/settings/schemas";
import {
  addStaff,
  removeStaff,
  resetStaffPassword,
  updateStaffRoles,
} from "@/modules/settings/staff";
import { PASSWORD_MIN_LENGTH } from "@/server/auth/password";
import { requireAction } from "@/server/auth/session";
import { invalidForm, readFields, refusalMessage } from "@/server/forms";

const success = (message: string): FormState => ({
  status: "success",
  message,
  fieldErrors: {},
  values: {},
});
const failure = (message: string, values: Record<string, string> = {}): FormState => ({
  status: "error",
  message,
  fieldErrors: {},
  values,
});

export async function addStaffAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("staff:manage");
  const { password, ...values } = readFields(formData, ["name", "identifier", "password"]);
  const input = { ...values, password, roles: formData.getAll("roles").map(String) };

  const parsed = AddStaffSchema.safeParse(input);
  if (!parsed.success) {
    return invalidForm(
      parsed.error,
      {
        name: t("staff.errors.name"),
        identifier: t("staff.errors.identifier"),
        password: t("staff.errors.password", { min: PASSWORD_MIN_LENGTH }),
        roles: t("staff.errors.roles"),
      },
      values,
    );
  }
  try {
    const added = await addStaff(principal, input);
    refresh();
    const params = { nom: parsed.data.name };
    return success(
      added.existingAccount ? t("staff.addedExisting", params) : t("staff.added", params),
    );
  } catch (error) {
    return failure(refusalMessage(error), values);
  }
}

export async function updateRolesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("staff:manage");
  const roles = formData.getAll("roles").map(String);
  if (roles.length === 0) return failure(t("staff.errors.roles"));
  try {
    await updateStaffRoles(principal, String(formData.get("userId") ?? ""), roles);
    refresh();
    return success(t("staff.rolesSaved"));
  } catch (error) {
    return failure(refusalMessage(error));
  }
}

export async function removeStaffAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("staff:manage");
  try {
    await removeStaff(principal, String(formData.get("userId") ?? ""));
    refresh();
    return success(t("staff.removed"));
  } catch (error) {
    return failure(refusalMessage(error));
  }
}

export async function resetPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("staff:manage");
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "");
  if (password.length < PASSWORD_MIN_LENGTH) {
    return failure(t("staff.errors.password", { min: PASSWORD_MIN_LENGTH }));
  }
  try {
    await resetStaffPassword(principal, String(formData.get("userId") ?? ""), password);
    refresh();
    return success(t("staff.resetDone", { nom: name }));
  } catch (error) {
    return failure(refusalMessage(error));
  }
}
