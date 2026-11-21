"use server";

import { refresh } from "next/cache";
import { t } from "@/i18n";
import type { FormState } from "@/lib/form-state";
import {
  isSchoolImageKind,
  removeSchoolImage,
  setSchoolImage,
  updateSchoolProfile,
} from "@/modules/settings/school-profile";
import { SchoolProfileSchema } from "@/modules/settings/schemas";
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

export async function updateProfileAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  const values = readFields(formData, ["name", "address", "phone"]);
  const parsed = SchoolProfileSchema.safeParse(values);
  if (!parsed.success) {
    return invalidForm(
      parsed.error,
      {
        name: t("schoolProfile.errors.name"),
        address: t("schoolProfile.errors.address"),
        phone: t("schoolProfile.errors.phone"),
      },
      values,
    );
  }
  try {
    await updateSchoolProfile(principal, values);
    refresh();
    return { ...success(t("schoolProfile.saved")), values };
  } catch (error) {
    return failure(refusalMessage(error), values);
  }
}

export async function uploadImageAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  const kind = String(formData.get("kind") ?? "");
  const file = formData.get("file");
  if (!isSchoolImageKind(kind)) return failure(t("settings.errors.imageType"));
  if (!(file instanceof File) || file.size === 0) return failure(t("settings.errors.imageMissing"));
  try {
    await setSchoolImage(principal, kind, new Uint8Array(await file.arrayBuffer()));
    refresh();
    return success(t("schoolProfile.imageSaved"));
  } catch (error) {
    return failure(refusalMessage(error));
  }
}

export async function removeImageAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  const kind = String(formData.get("kind") ?? "");
  if (!isSchoolImageKind(kind)) return failure(t("settings.errors.imageType"));
  try {
    await removeSchoolImage(principal, kind);
    refresh();
    return success(t("schoolProfile.imageRemoved"));
  } catch (error) {
    return failure(refusalMessage(error));
  }
}
