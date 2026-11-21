"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form-fields";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import { idleFormState } from "@/lib/form-state";
import {
  closeCashAction,
  collectPaymentAction,
  decideCancellationAction,
  reopenClosureAction,
  requestCancellationAction,
} from "./actions";

const METHODS = ["cash", "mobile_money", "transfer", "cheque"] as const;

export function CollectPaymentForm({ enrollmentId }: { enrollmentId: string }) {
  const [state, formAction] = useActionState(collectPaymentAction, idleFormState);
  const [method, setMethod] = useState<string>(state.values.method ?? "cash");
  const v = state.values;
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="enrollmentId" value={enrollmentId} />
      <Field
        id={`amount-${enrollmentId}`}
        name="amount"
        inputMode="numeric"
        autoComplete="off"
        label={t("cash.amount")}
        help={t("cash.amountHelp")}
        defaultValue={v.amount}
        error={state.fieldErrors.amount}
        required
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">{t("cash.method")}</legend>
        <div className="grid grid-cols-2 gap-x-3">
          {METHODS.map((m) => (
            <label key={m} className="flex min-h-11 items-center gap-3">
              <input
                type="radio"
                name="method"
                value={m}
                checked={method === m}
                onChange={() => setMethod(m)}
                className="size-5"
              />
              {t(`finance.methods.${m}`)}
            </label>
          ))}
        </div>
      </fieldset>
      {method !== "cash" && (
        <Field
          id={`reference-${enrollmentId}`}
          name="reference"
          autoComplete="off"
          label={t("cash.reference")}
          help={t("cash.referenceHelp")}
          defaultValue={v.reference}
          required
        />
      )}
      <Field
        id={`note-${enrollmentId}`}
        name="note"
        label={t("cash.note")}
        help={t("cash.noteHelp")}
        defaultValue={v.note}
      />
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton label={t("cash.submit")} />
    </form>
  );
}

export function RequestCancellationForm({ paymentId }: { paymentId: string }) {
  const [state, formAction] = useActionState(requestCancellationAction, idleFormState);
  return (
    <details className="rounded-md bg-zinc-50 p-2">
      <summary className="min-h-11 cursor-pointer content-center text-sm font-medium">
        {t("finance.cancelRequestTitle")}
      </summary>
      <form action={formAction} className="mt-2 flex flex-col gap-3" noValidate>
        <input type="hidden" name="paymentId" value={paymentId} />
        <Field
          id={`cancel-${paymentId}`}
          name="reason"
          label={t("finance.cancelReason")}
          defaultValue={state.values.reason}
        />
        <FormMessage status={state.status} message={state.message} />
        <SubmitButton label={t("finance.requestCancel")} variant="danger" />
      </form>
    </details>
  );
}

export function DecideCancellationForm({ cancellationId }: { cancellationId: string }) {
  const [state, formAction] = useActionState(decideCancellationAction, idleFormState);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        if (submitter?.value === "approve" && !window.confirm(t("cash.approveConfirm"))) {
          event.preventDefault();
        }
      }}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="cancellationId" value={cancellationId} />
      <label htmlFor={`note-${cancellationId}`} className="font-medium">
        {t("cash.decisionNote")}
      </label>
      <input id={`note-${cancellationId}`} name="note" maxLength={300} className={inputClass} />
      <div className="flex gap-2">
        <button
          type="submit"
          name="decision"
          value="approve"
          className="h-12 flex-1 rounded-md border border-red-700 px-3 font-semibold text-red-800"
        >
          {t("cash.approve")}
        </button>
        <button
          type="submit"
          name="decision"
          value="reject"
          className="h-12 flex-1 rounded-md border border-zinc-400 px-3 font-semibold"
        >
          {t("cash.reject")}
        </button>
      </div>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

export function CloseCashForm({ day }: { day: string }) {
  const [state, formAction] = useActionState(closeCashAction, idleFormState);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(t("closure.confirm"))) event.preventDefault();
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      <input type="hidden" name="day" value={day} />
      <Field
        id="counted-cash"
        name="countedCash"
        inputMode="numeric"
        autoComplete="off"
        label={t("closure.countedCash")}
        help={t("closure.countedHelp")}
        defaultValue={state.values.countedCash}
        error={state.fieldErrors.countedCash}
        required
      />
      <Field
        id="closure-note"
        name="note"
        label={t("closure.note")}
        help={t("closure.noteHelp")}
        defaultValue={state.values.note}
      />
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton label={t("closure.submit")} />
    </form>
  );
}

export function ReopenClosureForm({ closureId }: { closureId: string }) {
  const [state, formAction] = useActionState(reopenClosureAction, idleFormState);
  return (
    <details className="rounded-md bg-zinc-50 p-2">
      <summary className="min-h-11 cursor-pointer content-center text-sm font-medium">
        {t("closure.reopenTitle")}
      </summary>
      <form
        action={formAction}
        onSubmit={(event) => {
          if (!window.confirm(t("closure.reopenConfirm"))) event.preventDefault();
        }}
        className="mt-2 flex flex-col gap-3"
        noValidate
      >
        <input type="hidden" name="closureId" value={closureId} />
        <Field
          id={`reopen-${closureId}`}
          name="reason"
          label={t("closure.reopenReason")}
          defaultValue={state.values.reason}
        />
        <FormMessage status={state.status} message={state.message} />
        <SubmitButton label={t("closure.reopen")} variant="danger" />
      </form>
    </details>
  );
}
