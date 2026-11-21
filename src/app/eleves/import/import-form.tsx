"use client";

import { startTransition, useActionState } from "react";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import { importAction } from "./actions";
import { idleImportState } from "./import-state";

/** Au-delà, la liste d'erreurs est tronquée à l'écran (le fichier est à corriger de toute façon). */
const SHOWN_ERRORS = 200;

export function ImportForm({
  years,
  canValidate,
}: {
  years: { id: string; label: string }[];
  canValidate: boolean;
}) {
  const [state, formAction, pending] = useActionState(importAction, idleImportState);
  return (
    <form
      // Envoi manuel : React viderait le formulaire (et le fichier choisi) après chaque action ; on
      // garde le fichier entre « Vérifier » et « Importer ».
      onSubmit={(event) => {
        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const formData = new FormData(event.currentTarget, submitter);
        startTransition(() => formAction(formData));
      }}
      className="flex flex-col gap-4"
    >
      <label htmlFor="import-year" className="font-medium">
        {t("studentImport.year")}
      </label>
      <select id="import-year" name="annee" className={`${inputClass} bg-white`}>
        {years.map((y) => (
          <option key={y.id} value={y.id}>
            {y.label}
          </option>
        ))}
      </select>
      <label htmlFor="import-file" className="font-medium">
        {t("studentImport.file")}
      </label>
      <input
        id="import-file"
        name="file"
        type="file"
        accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        aria-describedby="import-file-help"
        className="text-base file:mr-3 file:h-12 file:rounded-md file:border file:border-zinc-400 file:bg-white file:px-4"
      />
      <p id="import-file-help" className="text-sm text-zinc-600">
        {t("studentImport.fileHelp")}
      </p>
      {canValidate && (
        <label className="flex min-h-11 items-start gap-3">
          <input type="checkbox" name="validated" className="mt-1 size-5" />
          <span>
            {t("studentImport.validated")}
            <span className="block text-sm text-zinc-600">{t("studentImport.validatedHelp")}</span>
          </span>
        </label>
      )}
      <div className="flex flex-col gap-2">
        <button
          type="submit"
          name="mode"
          value="check"
          disabled={pending}
          className="h-12 rounded-md border border-zinc-400 bg-white px-4 font-semibold disabled:opacity-60"
        >
          {pending ? t("studentImport.working") : t("studentImport.check")}
        </button>
        <button
          type="submit"
          name="mode"
          value="import"
          disabled={pending}
          className="h-12 rounded-md bg-blue-700 px-4 font-semibold text-white disabled:opacity-60"
        >
          {pending ? t("studentImport.working") : t("studentImport.import")}
        </button>
      </div>

      {state.message && (
        <p
          role={state.status === "error" || state.errors.length > 0 ? "alert" : "status"}
          className={`rounded-md p-3 ${
            state.status === "error" || state.errors.length > 0
              ? "bg-red-50 text-red-800"
              : "bg-green-50 text-green-900"
          }`}
        >
          {state.message}
        </p>
      )}
      {state.errors.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t("studentImport.reportTitle")}</h2>
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-300 text-sm">
            {state.errors.slice(0, SHOWN_ERRORS).map((e, i) => (
              <li key={`${e.line}-${e.column}-${i}`} className="p-2">
                <span className="font-semibold">
                  {t("studentImport.errorLine", { ligne: e.line, colonne: e.column })}
                </span>{" "}
                {e.message}
              </li>
            ))}
          </ul>
          {state.errors.length > SHOWN_ERRORS && (
            <p className="text-sm">
              {t("studentImport.moreErrors", { n: state.errors.length - SHOWN_ERRORS })}
            </p>
          )}
        </section>
      )}
    </form>
  );
}
