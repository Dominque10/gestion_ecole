"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-fields";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import { idleFormState } from "@/lib/form-state";
import { reEnrollAction } from "@/app/eleves/actions";

export type ReEnrollRow = {
  enrollmentId: string;
  name: string;
  currentLevel: { id: string; name: string };
  nextLevel: { id: string; name: string } | null;
};

export function ReEnrollForm({ toYearId, rows }: { toYearId: string; rows: ReEnrollRow[] }) {
  const [state, formAction] = useActionState(reEnrollAction, idleFormState);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="toYearId" value={toYearId} />
      <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-300 px-4">
        {rows.map((r) => (
          <li key={r.enrollmentId} className="flex flex-col gap-1 py-3">
            <label htmlFor={`decision-${r.enrollmentId}`} className="font-medium">
              {r.name}
            </label>
            <select
              id={`decision-${r.enrollmentId}`}
              name={`decision-${r.enrollmentId}`}
              aria-label={t("enrollments.decisionFor", { nom: r.name })}
              defaultValue={r.nextLevel?.id ?? ""}
              className={`${inputClass} bg-white`}
            >
              {r.nextLevel && (
                <option value={r.nextLevel.id}>
                  {t("enrollments.promote", { niveau: r.nextLevel.name })}
                </option>
              )}
              <option value={r.currentLevel.id}>
                {t("enrollments.repeat", { niveau: r.currentLevel.name })}
              </option>
              <option value="">{t("enrollments.skip")}</option>
            </select>
          </li>
        ))}
      </ul>
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton label={t("enrollments.reEnrollSubmit")} />
    </form>
  );
}
