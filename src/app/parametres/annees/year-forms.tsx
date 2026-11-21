"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form-fields";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import { idleFormState } from "@/lib/form-state";
import type { AcademicYear } from "@/modules/settings/years";
import {
  activateYearAction,
  copyStructureAction,
  createYearAction,
  deleteYearAction,
  updatePeriodsAction,
  updateYearAction,
} from "./actions";

type YearValues = { label: string; startDate: string; endDate: string; periodKind: string };

function YearFields({
  values,
  errors,
  disabled,
}: {
  values: YearValues;
  errors: Record<string, string>;
  disabled?: boolean;
}) {
  return (
    <>
      <Field
        name="label"
        label={t("years.label")}
        help={t("years.labelHelp")}
        defaultValue={values.label}
        error={errors.label}
        disabled={disabled}
        required
      />
      <Field
        name="startDate"
        type="date"
        label={t("years.startDate")}
        defaultValue={values.startDate}
        error={errors.startDate}
        disabled={disabled}
        required
      />
      <Field
        name="endDate"
        type="date"
        label={t("years.endDate")}
        defaultValue={values.endDate}
        error={errors.endDate}
        disabled={disabled}
        required
      />
      <fieldset className="flex flex-col gap-2" disabled={disabled}>
        <legend className="mb-1 font-medium">{t("years.periodKind")}</legend>
        {(["trimester", "semester"] as const).map((kind) => (
          <label key={kind} className="flex min-h-11 items-center gap-3">
            <input
              type="radio"
              name="periodKind"
              value={kind}
              defaultChecked={values.periodKind === kind}
              className="size-5"
            />
            {t(`years.${kind}`)}
          </label>
        ))}
      </fieldset>
    </>
  );
}

export function CreateYearForm({ proposal }: { proposal: YearValues }) {
  const [state, formAction] = useActionState(createYearAction, idleFormState);
  const values = state.status === "idle" ? proposal : { ...proposal, ...state.values };
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <YearFields values={values} errors={state.fieldErrors} />
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton label={t("years.create")} />
    </form>
  );
}

export function EditYearForm({ year, readOnly }: { year: AcademicYear; readOnly: boolean }) {
  const [state, formAction] = useActionState(updateYearAction, idleFormState);
  const values = state.status === "idle" ? year : { ...year, ...state.values };
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="yearId" value={year.id} />
      <YearFields values={values} errors={state.fieldErrors} disabled={readOnly} />
      <FormMessage status={state.status} message={state.message} />
      {!readOnly && <SubmitButton label={t("years.save")} />}
    </form>
  );
}

export function PeriodsForm({ year, readOnly }: { year: AcademicYear; readOnly: boolean }) {
  const [state, formAction] = useActionState(updatePeriodsAction, idleFormState);
  const v = state.values;
  return (
    // La clé suit les périodes enregistrées : le formulaire se remet à jour après un recalcul.
    <form
      key={year.periods.map((p) => `${p.label}${p.startDate}${p.endDate}`).join("|")}
      action={formAction}
      className="flex flex-col gap-5"
      noValidate
    >
      <input type="hidden" name="yearId" value={year.id} />
      <input type="hidden" name="count" value={year.periods.length} />
      {year.periods.map((p) => (
        <fieldset
          key={p.position}
          disabled={readOnly}
          className="flex flex-col gap-4 rounded-md border border-zinc-300 p-4"
        >
          <legend className="px-1 font-semibold">{p.label}</legend>
          <Field
            name={`label-${p.position}`}
            label={t("years.periodName", { n: p.position })}
            defaultValue={v[`label-${p.position}`] ?? p.label}
            required
          />
          <Field
            name={`start-${p.position}`}
            type="date"
            label={t("years.periodStart", { n: p.position })}
            defaultValue={v[`start-${p.position}`] ?? p.startDate}
            required
          />
          <Field
            name={`end-${p.position}`}
            type="date"
            label={t("years.periodEnd", { n: p.position })}
            defaultValue={v[`end-${p.position}`] ?? p.endDate}
            required
          />
        </fieldset>
      ))}
      <FormMessage status={state.status} message={state.message} />
      {!readOnly && <SubmitButton label={t("years.savePeriods")} />}
    </form>
  );
}

export function ActivateYearForm({
  year,
  currentLabel,
}: {
  year: AcademicYear;
  currentLabel: string | null;
}) {
  const [state, formAction] = useActionState(activateYearAction, idleFormState);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (currentLabel && !window.confirm(t("years.activateConfirm", { nom: year.label }))) {
          event.preventDefault();
        }
      }}
      className="flex flex-col gap-3 rounded-md border border-amber-600 bg-amber-50 p-4"
    >
      <h2 className="text-lg font-semibold">{t("years.activateTitle")}</h2>
      <p>
        {currentLabel
          ? t("years.activateHelp", { nom: currentLabel })
          : t("years.activateHelpFirst")}
      </p>
      <input type="hidden" name="yearId" value={year.id} />
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton label={t("years.activate")} />
    </form>
  );
}

export function DeleteYearForm({ year }: { year: AcademicYear }) {
  const [state, formAction] = useActionState(deleteYearAction, idleFormState);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(t("years.deleteConfirm", { nom: year.label }))) event.preventDefault();
      }}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="yearId" value={year.id} />
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton label={t("years.delete")} variant="danger" />
    </form>
  );
}

export function CopyStructureForm({
  year,
  sources,
}: {
  year: AcademicYear;
  sources: { id: string; label: string }[];
}) {
  const [state, formAction] = useActionState(copyStructureAction, idleFormState);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        const select = event.currentTarget.elements.namedItem("source") as HTMLSelectElement;
        const source = select.selectedOptions[0]?.text ?? "";
        if (!window.confirm(t("copy.confirm", { source, cible: year.label }))) {
          event.preventDefault();
        }
      }}
      className="flex flex-col gap-3 rounded-md border border-zinc-300 p-4"
    >
      <h2 className="text-lg font-semibold">{t("copy.title")}</h2>
      <p className="text-sm">{t("copy.help")}</p>
      <input type="hidden" name="yearId" value={year.id} />
      <label htmlFor="copy-source" className="font-medium">
        {t("copy.source")}
      </label>
      <select id="copy-source" name="source" className={`${inputClass} bg-white`}>
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton label={t("copy.submit", { nom: year.label })} variant="secondary" />
    </form>
  );
}
