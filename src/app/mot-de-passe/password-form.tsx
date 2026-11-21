"use client";

import { useActionState, useEffect } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form-fields";
import { t } from "@/i18n";
import { idleFormState } from "@/lib/form-state";
import { changePasswordAction } from "./actions";

export function PasswordForm({ minLength }: { minLength: number }) {
  const [state, formAction] = useActionState(changePasswordAction, idleFormState);
  useEffect(() => {
    // Rechargement complet (pas une navigation interne) : le routeur de Next garde en mémoire la
    // redirection « accueil → mot de passe » de la connexion, qui renverrait ici.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- voulu, voir ci-dessus
    if (state.status === "success") window.location.assign("/accueil");
  }, [state.status]);
  const e = state.fieldErrors;
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <Field
        name="current"
        type="password"
        autoComplete="current-password"
        label={t("passwordChange.current")}
        error={e.current}
        required
      />
      <Field
        name="new"
        type="password"
        autoComplete="new-password"
        label={t("passwordChange.new")}
        help={t("passwordChange.newHelp", { min: minLength })}
        error={e.new}
        required
      />
      <Field
        name="confirm"
        type="password"
        autoComplete="new-password"
        label={t("passwordChange.confirm")}
        error={e.confirm}
        required
      />
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton label={t("passwordChange.submit")} />
    </form>
  );
}
