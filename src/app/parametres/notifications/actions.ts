"use server";

import { refresh } from "next/cache";
import { t } from "@/i18n";
import type { FormState } from "@/lib/form-state";
import { updateNotificationSettings } from "@/modules/notifications/settings";
import { TEMPLATE_KINDS } from "@/modules/notifications/templates";
import { requireAction } from "@/server/auth/session";
import { refusalMessage } from "@/server/forms";

export async function saveNotificationSettingsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("notifications:templates");
  const values: Record<string, string> = {
    canal: String(formData.get("canal") ?? "sms"),
    plafond: String(formData.get("plafond") ?? ""),
  };
  const templates: Record<string, string> = {};
  for (const kind of TEMPLATE_KINDS) {
    templates[kind] = String(formData.get(`modele-${kind}`) ?? "").slice(0, 400);
    values[`modele-${kind}`] = templates[kind];
  }
  const capText = values.plafond.replace(/\s/g, "");
  const cap = capText === "" ? null : Number(capText);
  try {
    await updateNotificationSettings(principal, {
      channel: values.canal,
      monthlyCap: cap === null || Number.isNaN(cap) ? (capText === "" ? null : -1) : cap,
      templates,
    });
  } catch (error) {
    return { status: "error", message: refusalMessage(error), fieldErrors: {}, values };
  }
  refresh();
  return { status: "success", message: t("notifications.saved"), fieldErrors: {}, values: {} };
}
