"use client";

import { useActionState } from "react";
import { FormMessage, inputClass, SubmitButton } from "@/components/form-fields";
import { t } from "@/i18n";
import { idleFormState } from "@/lib/form-state";
import type { NotificationSettings } from "@/modules/notifications/settings";
import {
  PLACEHOLDERS,
  TEMPLATE_KINDS,
  TEMPLATE_MAX_LENGTH,
} from "@/modules/notifications/templates";
import { saveNotificationSettingsAction } from "./actions";

export function NotificationSettingsForm({ settings }: { settings: NotificationSettings }) {
  const [state, formAction] = useActionState(saveNotificationSettingsAction, idleFormState);
  const v = state.status === "error" ? state.values : {};
  return (
    <form key={JSON.stringify(settings)} action={formAction} className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-medium">{t("notifications.channel")}</legend>
        {(["sms", "whatsapp"] as const).map((c) => (
          <label key={c} className="flex min-h-11 items-center gap-3">
            <input
              type="radio"
              name="canal"
              value={c}
              defaultChecked={(v.canal ?? settings.channel) === c}
              className="size-5"
            />
            {t(c === "sms" ? "notifications.sms" : "notifications.whatsapp")}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1">
        <label htmlFor="notif-cap" className="font-medium">
          {t("notifications.cap")}
        </label>
        <input
          id="notif-cap"
          name="plafond"
          inputMode="numeric"
          defaultValue={
            v.plafond ?? (settings.monthlyCap === null ? "" : String(settings.monthlyCap))
          }
          aria-describedby="notif-cap-help"
          className={inputClass}
        />
        <p id="notif-cap-help" className="text-sm text-zinc-600">
          {t("notifications.capHelp")}
        </p>
      </div>
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t("notifications.templatesTitle")}</h2>
        {TEMPLATE_KINDS.map((kind) => (
          <div key={kind} className="flex flex-col gap-1">
            <label htmlFor={`tpl-${kind}`} className="font-medium">
              {t(`notifications.kinds.${kind}`)}
            </label>
            <textarea
              id={`tpl-${kind}`}
              name={`modele-${kind}`}
              rows={3}
              maxLength={TEMPLATE_MAX_LENGTH}
              defaultValue={v[`modele-${kind}`] ?? settings.templates[kind]}
              aria-describedby={`tpl-${kind}-help`}
              className={`${inputClass} h-auto py-2`}
            />
            <p id={`tpl-${kind}-help`} className="text-sm text-zinc-600">
              {t("notifications.fields", {
                champs: PLACEHOLDERS[kind].map((p) => `{${p}}`).join(", "),
              })}
            </p>
          </div>
        ))}
      </section>
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton label={t("notifications.save")} />
    </form>
  );
}
