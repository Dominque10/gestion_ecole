"use client";

import { startTransition, useActionState, useRef, useState, type FormEvent } from "react";
import { FormMessage, inputClass } from "@/components/form-fields";
import { t } from "@/i18n";
import { compressImage } from "@/lib/compress-image";
import { idleFormState } from "@/lib/form-state";
import { justifyDayAction } from "./actions";

/** Motif et photo facultative du justificatif (réduite dans le téléphone avant l'envoi, 3G). */
export function JustifyForm({ enrollmentId, date }: { enrollmentId: string; date: string }) {
  const [state, action, pending] = useActionState(justifyDayAction, idleFormState);
  const [preparing, setPreparing] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const id = `${enrollmentId}-${date}`;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(formRef.current ?? undefined);
    formData.delete("file");
    const file = fileRef.current?.files?.[0];
    if (file) {
      setPreparing(true);
      try {
        const blob = await compressImage(file);
        formData.set("file", blob, `justificatif.${blob.type === "image/webp" ? "webp" : "jpg"}`);
      } finally {
        setPreparing(false);
      }
    }
    startTransition(() => action(formData));
  }

  const busy = pending || preparing;
  return (
    <form ref={formRef} onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-3">
      <input type="hidden" name="inscription" value={enrollmentId} />
      <input type="hidden" name="date" value={date} />
      <div className="flex flex-col gap-1">
        <label htmlFor={`reason-${id}`} className="font-medium">
          {t("absences.reason")}
        </label>
        <input
          id={`reason-${id}`}
          name="motif"
          maxLength={200}
          defaultValue={state.values.motif ?? ""}
          aria-describedby={`reason-${id}-help`}
          className={inputClass}
        />
        <p id={`reason-${id}-help`} className="text-sm text-zinc-600">
          {t("absences.reasonHelp")}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`file-${id}`} className="font-medium">
          {t("absences.photo")}
        </label>
        <input
          ref={fileRef}
          id={`file-${id}`}
          type="file"
          accept="image/*"
          className="text-base file:mr-3 file:h-12 file:rounded-md file:border file:border-zinc-400 file:bg-white file:px-4"
        />
      </div>
      <button
        type="submit"
        disabled={busy}
        className="h-12 rounded-md bg-blue-700 px-4 font-semibold text-white disabled:opacity-60"
      >
        {busy ? t("form.saving") : t("absences.submit")}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}
