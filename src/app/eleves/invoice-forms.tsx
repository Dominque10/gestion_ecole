"use client";

import { useActionState, type ReactNode } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form-fields";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import { idleFormState, type FormState } from "@/lib/form-state";
import { formatXAF } from "@/lib/money";
import {
  addMissingFeesAction,
  addOptionalFeeAction,
  discountAction,
  scholarshipAction,
} from "./actions";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-md bg-zinc-50 p-3">
      <summary className="min-h-11 cursor-pointer content-center font-medium">{title}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function useForm(action: Action) {
  return useActionState(action, idleFormState);
}

export function AddMissingFeesButton({ enrollmentId }: { enrollmentId: string }) {
  const [state, formAction] = useForm(addMissingFeesAction);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="enrollmentId" value={enrollmentId} />
      <SubmitButton label={t("finance.addMissing")} variant="secondary" />
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

export function OptionalFeeForm({
  enrollmentId,
  fees,
}: {
  enrollmentId: string;
  fees: { name: string; total: number }[];
}) {
  const [state, formAction] = useForm(addOptionalFeeAction);
  return (
    <Panel title={t("finance.optionalTitle")}>
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="enrollmentId" value={enrollmentId} />
        <label htmlFor={`optional-${enrollmentId}`} className="font-medium">
          {t("finance.optionalFee")}
        </label>
        <select id={`optional-${enrollmentId}`} name="feeName" className={`${inputClass} bg-white`}>
          {fees.map((f) => (
            <option key={f.name} value={f.name}>
              {t("finance.optionalOption", { frais: f.name, montant: formatXAF(f.total) })}
            </option>
          ))}
        </select>
        <FormMessage status={state.status} message={state.message} />
        <SubmitButton label={t("finance.addOptional")} variant="secondary" />
      </form>
    </Panel>
  );
}

export function ScholarshipForm({ enrollmentId }: { enrollmentId: string }) {
  const [state, formAction] = useForm(scholarshipAction);
  return (
    <Panel title={t("finance.scholarshipTitle")}>
      <form action={formAction} className="flex flex-col gap-3" noValidate>
        <input type="hidden" name="enrollmentId" value={enrollmentId} />
        <Field
          id={`percent-${enrollmentId}`}
          name="percent"
          type="number"
          inputMode="numeric"
          min={1}
          max={100}
          label={t("finance.scholarshipPercent")}
          defaultValue={state.values.percent}
        />
        <Field
          id={`sreason-${enrollmentId}`}
          name="reason"
          label={t("finance.reason")}
          help={t("finance.reasonHelp")}
          defaultValue={state.values.reason}
        />
        <FormMessage status={state.status} message={state.message} />
        <SubmitButton label={t("finance.grantScholarship")} variant="secondary" />
      </form>
    </Panel>
  );
}

export function DiscountForm({
  enrollmentId,
  invoices,
}: {
  enrollmentId: string;
  invoices: { id: string; label: string }[];
}) {
  const [state, formAction] = useForm(discountAction);
  return (
    <Panel title={t("finance.discountTitle")}>
      <form action={formAction} className="flex flex-col gap-3" noValidate>
        <label htmlFor={`dinvoice-${enrollmentId}`} className="font-medium">
          {t("finance.discountInvoice")}
        </label>
        <select
          id={`dinvoice-${enrollmentId}`}
          name="invoiceId"
          defaultValue={state.values.invoiceId}
          className={`${inputClass} bg-white`}
        >
          {invoices.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </select>
        <Field
          id={`damount-${enrollmentId}`}
          name="amount"
          inputMode="numeric"
          label={t("finance.discountAmount")}
          defaultValue={state.values.amount}
        />
        <Field
          id={`dreason-${enrollmentId}`}
          name="reason"
          label={t("finance.reason")}
          help={t("finance.reasonHelp")}
          defaultValue={state.values.reason}
        />
        <FormMessage status={state.status} message={state.message} />
        <SubmitButton label={t("finance.grantDiscount")} variant="secondary" />
      </form>
    </Panel>
  );
}
