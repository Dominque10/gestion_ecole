"use client";

import { useActionState } from "react";
import { t } from "@/i18n";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = { error: null, values: { schoolCode: "", identifier: "" } };

const inputClass =
  "h-12 w-full rounded-md border border-zinc-400 px-3 text-base focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1">
        <label htmlFor="schoolCode" className="font-medium">
          {t("login.schoolCode")}
        </label>
        <input
          id="schoolCode"
          name="schoolCode"
          autoCapitalize="none"
          autoComplete="organization"
          defaultValue={state.values.schoolCode}
          aria-describedby="schoolCode-help"
          className={inputClass}
        />
        <p id="schoolCode-help" className="text-sm text-zinc-600">
          {t("login.schoolCodeHelp")}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="identifier" className="font-medium">
          {t("login.identifier")}
        </label>
        <input
          id="identifier"
          name="identifier"
          inputMode="tel"
          autoComplete="username"
          required
          defaultValue={state.values.identifier}
          aria-describedby="identifier-help"
          className={inputClass}
        />
        <p id="identifier-help" className="text-sm text-zinc-600">
          {t("login.identifierHelp")}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="font-medium">
          {t("login.password")}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
        />
      </div>

      {state.error && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-red-800">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="h-12 rounded-md bg-blue-700 text-base font-semibold text-white disabled:opacity-60"
      >
        {pending ? t("login.pending") : t("login.submit")}
      </button>
    </form>
  );
}
