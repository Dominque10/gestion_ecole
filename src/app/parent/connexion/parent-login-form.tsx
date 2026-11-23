"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form-fields";
import { t } from "@/i18n";
import { requestCodeAction, verifyCodeAction, type ParentLoginState } from "./actions";

const initial: ParentLoginState = { step: "phone", phone: "", message: null, error: null };

/** Deux étapes : le numéro, puis le code reçu par SMS. */
export function ParentLoginForm() {
  const [requestState, request] = useActionState(requestCodeAction, initial);
  const [verifyState, verify] = useActionState(verifyCodeAction, initial);
  const onCodeStep = requestState.step === "code";
  if (!onCodeStep) {
    return (
      <form action={request} className="flex flex-col gap-4">
        <Field
          name="telephone"
          label={t("parent.phone")}
          help={t("parent.phoneHelp")}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          defaultValue={requestState.phone}
          required
        />
        <FormMessage status="error" message={requestState.error} />
        <SubmitButton label={t("parent.sendCode")} />
      </form>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <FormMessage status="success" message={requestState.message} />
      <form action={verify} className="flex flex-col gap-4">
        <input type="hidden" name="telephone" value={requestState.phone} />
        <Field
          name="code"
          label={t("parent.code")}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          pattern="[0-9]{6}"
          required
        />
        <FormMessage status="error" message={verifyState.error} />
        <SubmitButton label={t("parent.signIn")} />
      </form>
      <form action={request}>
        <input type="hidden" name="telephone" value={requestState.phone} />
        <button
          type="submit"
          className="h-12 w-full rounded-md border border-zinc-400 px-4 font-medium"
        >
          {t("parent.resend")}
        </button>
      </form>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="text-center text-blue-800 underline"
      >
        {t("parent.otherPhone")}
      </button>
    </div>
  );
}
