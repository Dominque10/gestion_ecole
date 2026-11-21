"use client";

import { startTransition, useActionState, useRef, useState, type ReactNode } from "react";
import { FormMessage } from "@/components/form-fields";
import { t } from "@/i18n";
import { compressImage } from "@/lib/compress-image";
import { idleFormState, type FormState } from "@/lib/form-state";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

/**
 * Envoi d'une photo réduite dans le téléphone avant l'envoi (3G). Le champ « file » reçoit l'image
 * réduite ; `fields` ajoute des champs cachés, `children` d'autres champs visibles.
 */
export function ImageUploadForm({
  action,
  id,
  chooseLabel,
  submitLabel,
  fields = {},
  maxSide,
  targetBytes,
  children,
}: {
  action: Action;
  id: string;
  chooseLabel: string;
  submitLabel: string;
  fields?: Record<string, string>;
  maxSide?: number;
  targetBytes?: number;
  children?: ReactNode;
}) {
  const [state, upload, pending] = useActionState(action, idleFormState);
  const [localError, setLocalError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setLocalError(t("students.errors.imageMissing"));
      return;
    }
    setPreparing(true);
    try {
      const blob = await compressImage(file, { maxSide, targetBytes });
      const formData = new FormData(formRef.current ?? undefined);
      formData.set("file", blob, `image.${blob.type === "image/webp" ? "webp" : "jpg"}`);
      startTransition(() => upload(formData));
      formRef.current?.reset();
    } catch {
      setLocalError(t("schoolProfile.compressFailed"));
    } finally {
      setPreparing(false);
    }
  }

  const busy = preparing || pending;
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-3">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      <label htmlFor={id} className="font-medium">
        {chooseLabel}
      </label>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept="image/*"
        className="text-base file:mr-3 file:h-12 file:rounded-md file:border file:border-zinc-400 file:bg-white file:px-4"
      />
      <button
        type="submit"
        disabled={busy}
        className="h-12 rounded-md bg-blue-700 px-4 text-base font-semibold text-white disabled:opacity-60"
      >
        {busy ? t("form.saving") : submitLabel}
      </button>
      <FormMessage
        status={localError ? "error" : state.status}
        message={localError ?? state.message}
      />
    </form>
  );
}
