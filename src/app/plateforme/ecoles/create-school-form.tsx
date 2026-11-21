"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form-fields";
import { t } from "@/i18n";
import { idleFormState } from "@/lib/form-state";
import { createSchoolAction } from "./actions";

export function CreateSchoolForm({ minLength }: { minLength: number }) {
  const [state, formAction] = useActionState(createSchoolAction, idleFormState);
  const e = state.fieldErrors;
  const v = state.values;
  // La clé change après un succès : le formulaire est vidé.
  return (
    <form
      key={state.status === "success" ? state.message : "form"}
      action={formAction}
      className="flex flex-col gap-5"
      noValidate
    >
      <Field name="name" label={t("platform.name")} defaultValue={v.name} error={e.name} required />
      <Field
        name="code"
        label={t("platform.code")}
        help={t("platform.codeHelp")}
        autoCapitalize="none"
        defaultValue={v.code}
        error={e.code}
        required
      />
      <Field
        name="matriculePrefix"
        label={t("platform.prefix")}
        help={t("platform.prefixHelp")}
        autoCapitalize="characters"
        defaultValue={v.matriculePrefix}
        error={e.matriculePrefix}
        required
      />
      <fieldset className="flex flex-col gap-5 rounded-md border border-zinc-300 p-4">
        <legend className="px-1 font-semibold">{t("platform.directorTitle")}</legend>
        <Field
          name="directorName"
          label={t("platform.directorName")}
          defaultValue={v.directorName}
          error={e.directorName}
          required
        />
        <Field
          name="directorIdentifier"
          label={t("platform.directorIdentifier")}
          inputMode="tel"
          defaultValue={v.directorIdentifier}
          error={e.directorIdentifier}
          required
        />
        <Field
          name="directorPassword"
          type="text"
          autoComplete="off"
          label={t("platform.directorPassword")}
          help={t("platform.directorPasswordHelp", { min: minLength })}
          error={e.directorPassword}
          required
        />
      </fieldset>
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton label={t("platform.submit")} />
    </form>
  );
}
