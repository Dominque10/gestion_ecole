"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form-fields";
import { t, type MessageKey } from "@/i18n";
import { compressImage } from "@/lib/compress-image";
import { idleFormState, type FormState } from "@/lib/form-state";
import { removeImageAction, updateProfileAction, uploadImageAction } from "./actions";

type Profile = { name: string; address: string | null; phone: string | null };

export function ProfileForm({ profile }: { profile: Profile }) {
  const [state, formAction] = useActionState(updateProfileAction, idleFormState);
  const e = state.fieldErrors;
  const v = state.status === "idle" ? {} : state.values;
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <Field
        name="name"
        label={t("schoolProfile.name")}
        defaultValue={v.name ?? profile.name}
        error={e.name}
        required
      />
      <Field
        name="address"
        label={t("schoolProfile.address")}
        help={t("schoolProfile.addressHelp")}
        defaultValue={v.address ?? profile.address ?? ""}
        error={e.address}
      />
      <Field
        name="phone"
        label={t("schoolProfile.phone")}
        help={t("schoolProfile.phoneHelp")}
        inputMode="tel"
        defaultValue={v.phone ?? profile.phone ?? ""}
        error={e.phone}
      />
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton label={t("schoolProfile.save")} />
    </form>
  );
}

const IMAGE_LABELS = {
  logo: "schoolProfile.logo",
  stamp: "schoolProfile.stamp",
  signature: "schoolProfile.signature",
} as const satisfies Record<string, MessageKey>;

export function ImageField({
  kind,
  version,
  canEdit,
}: {
  kind: keyof typeof IMAGE_LABELS;
  /** Version du fichier actuel (null = aucune image). */
  version: string | null;
  canEdit: boolean;
}) {
  const [uploadState, uploadAction, uploading] = useActionState(uploadImageAction, idleFormState);
  const [removeState, removeAction] = useActionState(removeImageAction, idleFormState);
  const [localError, setLocalError] = useState<FormState | null>(null);
  const [preparing, setPreparing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = `file-${kind}`;
  const message = localError ?? (removeState.message ? removeState : uploadState);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setLocalError({
        ...idleFormState,
        status: "error",
        message: t("settings.errors.imageMissing"),
      });
      return;
    }
    setPreparing(true);
    try {
      const blob = await compressImage(file);
      const formData = new FormData();
      formData.set("kind", kind);
      formData.set("file", blob, `${kind}.${blob.type === "image/webp" ? "webp" : "jpg"}`);
      startTransition(() => uploadAction(formData));
      if (inputRef.current) inputRef.current.value = "";
    } catch {
      setLocalError({
        ...idleFormState,
        status: "error",
        message: t("schoolProfile.compressFailed"),
      });
    } finally {
      setPreparing(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-zinc-300 p-4">
      <h3 className="font-semibold">{t(IMAGE_LABELS[kind])}</h3>
      {version ? (
        // eslint-disable-next-line @next/next/no-img-element -- image privée servie par l'API, déjà réduite
        <img
          src={`/api/v1/school/images/${kind}?v=${encodeURIComponent(version)}`}
          alt={t(IMAGE_LABELS[kind])}
          className="max-h-40 w-auto self-start rounded border border-zinc-200 bg-white object-contain"
        />
      ) : (
        <p className="text-zinc-600">{t("schoolProfile.none")}</p>
      )}
      {canEdit && (
        <>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <label htmlFor={inputId} className="font-medium">
              {t("schoolProfile.choose")}
            </label>
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              accept="image/*"
              className="text-base file:mr-3 file:h-12 file:rounded-md file:border file:border-zinc-400 file:bg-white file:px-4"
            />
            <button
              type="submit"
              disabled={preparing || uploading}
              className="h-12 rounded-md bg-blue-700 px-4 text-base font-semibold text-white disabled:opacity-60"
            >
              {preparing || uploading ? t("form.saving") : t("schoolProfile.upload")}
            </button>
          </form>
          {version && (
            <form action={removeAction}>
              <input type="hidden" name="kind" value={kind} />
              <SubmitButton label={t("schoolProfile.remove")} variant="danger" />
            </form>
          )}
        </>
      )}
      <FormMessage status={message.status} message={message.message} />
    </section>
  );
}
