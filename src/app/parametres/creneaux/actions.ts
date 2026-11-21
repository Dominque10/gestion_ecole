"use server";

import { refresh } from "next/cache";
import { t } from "@/i18n";
import type { FormState } from "@/lib/form-state";
import {
  createTimeSlot,
  deleteTimeSlot,
  TimeSlotSchema,
  updateTimeSlot,
} from "@/modules/settings/time-slots";
import { requireAction } from "@/server/auth/session";
import { invalidForm, readFields, refusalMessage } from "@/server/forms";

const FIELDS = ["label", "startTime", "endTime"] as const;

const result = (
  status: "success" | "error",
  message: string,
  values: Record<string, string> = {},
): FormState => ({ status, message, fieldErrors: {}, values });

const messages = () => ({
  label: t("timeSlots.errors.label"),
  startTime: t("timeSlots.errors.startTime"),
  endTime: t("timeSlots.errors.endTime"),
});

export async function createTimeSlotAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  const values = readFields(formData, FIELDS);
  const parsed = TimeSlotSchema.safeParse(values);
  if (!parsed.success) return invalidForm(parsed.error, messages(), values);
  try {
    await createTimeSlot(principal, values);
    refresh();
    return result("success", t("timeSlots.added", { nom: parsed.data.label }));
  } catch (error) {
    return result("error", refusalMessage(error), values);
  }
}

export async function updateTimeSlotAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  const values = readFields(formData, FIELDS);
  const parsed = TimeSlotSchema.safeParse(values);
  if (!parsed.success) return invalidForm(parsed.error, messages(), values);
  try {
    await updateTimeSlot(principal, String(formData.get("id") ?? ""), values);
    refresh();
    return result("success", t("timeSlots.saved"), values);
  } catch (error) {
    return result("error", refusalMessage(error), values);
  }
}

export async function deleteTimeSlotAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  try {
    await deleteTimeSlot(principal, String(formData.get("id") ?? ""));
    refresh();
    return result("success", t("timeSlots.deleted"));
  } catch (error) {
    return result("error", refusalMessage(error));
  }
}
