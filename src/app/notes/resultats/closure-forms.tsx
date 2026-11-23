"use client";

import { useActionState } from "react";
import { FormMessage, inputClass, SubmitButton } from "@/components/form-fields";
import { t } from "@/i18n";
import { idleFormState } from "@/lib/form-state";
import { closePeriodAction, reopenPeriodAction } from "./actions";

type Props = { classId: string; periodId: string; className: string; periodLabel: string };

export function ClosePeriodForm({ classId, periodId, className, periodLabel }: Props) {
  const [state, formAction] = useActionState(closePeriodAction, idleFormState);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (
          !window.confirm(t("results.closeConfirm", { periode: periodLabel, classe: className }))
        ) {
          event.preventDefault();
        }
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="classe" value={classId} />
      <input type="hidden" name="periode" value={periodId} />
      <SubmitButton label={t("results.close", { periode: periodLabel, classe: className })} />
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

export function ReopenPeriodForm({ classId, periodId }: Props) {
  const [state, formAction] = useActionState(reopenPeriodAction, idleFormState);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="classe" value={classId} />
      <input type="hidden" name="periode" value={periodId} />
      <label htmlFor="reopen-reason" className="font-medium">
        {t("results.reopenReason")}
      </label>
      <textarea
        id="reopen-reason"
        name="motif"
        required
        maxLength={300}
        rows={2}
        defaultValue={state.values.motif ?? ""}
        className={`${inputClass} h-auto py-2`}
      />
      <SubmitButton label={t("results.reopen")} variant="secondary" />
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}
