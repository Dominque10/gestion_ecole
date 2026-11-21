"use client";

import type { InputHTMLAttributes } from "react";
import { useFormStatus } from "react-dom";
import { t } from "@/i18n";

export const inputClass =
  "h-12 w-full rounded-md border border-zinc-400 px-3 text-base focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700 aria-[invalid=true]:border-red-700";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  name: string;
  label: string;
  help?: string;
  error?: string;
};

/** Champ de formulaire accessible : libellé, aide et message d'erreur reliés au champ. */
export function Field({ name, label, help, error, id = name, ...input }: FieldProps) {
  const describedBy = [help && `${id}-help`, error && `${id}-error`].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={inputClass}
        {...input}
      />
      {help && (
        <p id={`${id}-help`} className="text-sm text-zinc-600">
          {help}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}

export function SubmitButton({
  label,
  variant = "primary",
}: {
  label: string;
  variant?: "primary" | "secondary" | "danger";
}) {
  const { pending } = useFormStatus();
  const styles = {
    primary: "bg-blue-700 text-white",
    secondary: "border border-zinc-400",
    danger: "border border-red-700 text-red-800",
  }[variant];
  return (
    <button
      type="submit"
      disabled={pending}
      className={`h-12 rounded-md px-4 text-base font-semibold disabled:opacity-60 ${styles}`}
    >
      {pending ? t("form.saving") : label}
    </button>
  );
}

/** Message global d'un formulaire (erreur ou succès), annoncé aux lecteurs d'écran. */
export function FormMessage({ status, message }: { status: string; message: string | null }) {
  if (!message) return null;
  const isError = status === "error";
  return (
    <p
      role={isError ? "alert" : "status"}
      className={`rounded-md p-3 ${isError ? "bg-red-50 text-red-800" : "bg-green-50 text-green-900"}`}
    >
      {message}
    </p>
  );
}
