"use client";

import { useActionState, useState } from "react";
import { FormMessage, inputClass, SubmitButton } from "@/components/form-fields";
import { t } from "@/i18n";
import { idleFormState } from "@/lib/form-state";
import { publishAnnouncementAction } from "./actions";

type Option = { id: string; name: string };

export function AnnouncementForm({ levels, classes }: { levels: Option[]; classes: Option[] }) {
  const [state, formAction] = useActionState(publishAnnouncementAction, idleFormState);
  const v = state.status === "error" ? state.values : {};
  const [audience, setAudience] = useState(v.public ?? "school");
  const [body, setBody] = useState(v.texte ?? "");
  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-md bg-zinc-100 p-4">
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-medium">{t("announcements.audience")}</legend>
        {(["school", "level", "class"] as const).map((a) => (
          <label key={a} className="flex min-h-11 items-center gap-3">
            <input
              type="radio"
              name="public"
              value={a}
              checked={audience === a}
              onChange={() => setAudience(a)}
              className="size-5"
            />
            {t(`announcements.audiences.${a}`)}
          </label>
        ))}
      </fieldset>
      {audience === "level" && (
        <select
          name="niveau"
          aria-label={t("announcements.level")}
          defaultValue={v.niveau}
          className={`${inputClass} bg-white`}
        >
          {levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      )}
      {audience === "class" && (
        <select
          name="classe"
          aria-label={t("announcements.class")}
          defaultValue={v.classe}
          className={`${inputClass} bg-white`}
        >
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor="ann-title" className="font-medium">
          {t("announcements.titleLabel")}
        </label>
        <input
          id="ann-title"
          name="titre"
          maxLength={80}
          defaultValue={v.titre}
          className={`${inputClass} bg-white`}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="ann-body" className="font-medium">
          {t("announcements.body")}
        </label>
        <textarea
          id="ann-body"
          name="texte"
          rows={4}
          maxLength={300}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className={`${inputClass} h-auto bg-white py-2`}
        />
        <p className="text-sm text-zinc-600">{t("announcements.count", { n: body.length })}</p>
      </div>
      <label className="flex min-h-11 items-start gap-3">
        <input
          type="checkbox"
          name="envoyer"
          defaultChecked={v.envoyer !== ""}
          className="mt-1 size-5 shrink-0"
        />
        <span>{t("announcements.send")}</span>
      </label>
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton label={t("announcements.publish")} />
    </form>
  );
}
