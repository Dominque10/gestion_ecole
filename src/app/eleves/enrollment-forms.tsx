"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form-fields";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import { idleFormState } from "@/lib/form-state";
import {
  assignClassAction,
  departureAction,
  preEnrollAction,
  validateEnrollmentAction,
} from "./actions";

type Option = { id: string; label: string };

function Select({
  id,
  name,
  label,
  options,
  defaultValue,
}: {
  id: string;
  name: string;
  label: string;
  options: Option[];
  defaultValue?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <select id={id} name={name} defaultValue={defaultValue} className={`${inputClass} bg-white`}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function PreEnrollForm({
  studentId,
  years,
  levels,
}: {
  studentId: string;
  years: Option[];
  levels: Option[];
}) {
  const [state, formAction] = useActionState(preEnrollAction, idleFormState);
  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-md bg-zinc-50 p-4">
      <h3 className="font-semibold">{t("enrollments.preEnrollTitle")}</h3>
      <input type="hidden" name="studentId" value={studentId} />
      <Select id="pre-year" name="yearId" label={t("enrollments.year")} options={years} />
      <Select id="pre-level" name="levelId" label={t("enrollments.level")} options={levels} />
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton label={t("enrollments.preEnroll")} />
    </form>
  );
}

export function ValidateEnrollmentButton({ enrollmentId }: { enrollmentId: string }) {
  const [state, formAction] = useActionState(validateEnrollmentAction, idleFormState);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="enrollmentId" value={enrollmentId} />
      <p className="text-sm text-zinc-600">{t("enrollments.validateHelp")}</p>
      <SubmitButton label={t("enrollments.validate")} />
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

export function AssignClassForm({
  enrollmentId,
  currentClassId,
  options,
}: {
  enrollmentId: string;
  currentClassId: string | null;
  options: { id: string; name: string; capacity: number | null; enrolled: number }[];
}) {
  const [state, formAction] = useActionState(assignClassAction, idleFormState);
  if (options.length === 0)
    return <p className="text-sm text-zinc-600">{t("enrollments.noClassForLevel")}</p>;
  const places = (o: (typeof options)[number]) =>
    o.capacity === null
      ? t("enrollments.placesFree")
      : o.enrolled >= o.capacity
        ? t("enrollments.placesFull")
        : t("enrollments.placesLeft", { n: o.capacity - o.enrolled });
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="enrollmentId" value={enrollmentId} />
      <Select
        id={`class-${enrollmentId}`}
        name="classId"
        label={t("enrollments.class")}
        defaultValue={currentClassId ?? ""}
        options={[
          { id: "", label: t("enrollments.noClass") },
          ...options.map((o) => ({
            id: o.id,
            label: t("enrollments.classOption", { classe: o.name, places: places(o) }),
          })),
        ]}
      />
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton label={t("enrollments.assign")} variant="secondary" />
    </form>
  );
}

export function DepartureForm({ enrollmentId, today }: { enrollmentId: string; today: string }) {
  const [state, formAction] = useActionState(departureAction, idleFormState);
  return (
    <details className="rounded-md bg-zinc-50 p-3">
      <summary className="min-h-11 cursor-pointer content-center font-medium">
        {t("enrollments.departureTitle")}
      </summary>
      <form
        action={formAction}
        onSubmit={(event) => {
          if (!window.confirm(t("enrollments.leaveConfirm"))) event.preventDefault();
        }}
        className="mt-3 flex flex-col gap-4"
        noValidate
      >
        <input type="hidden" name="enrollmentId" value={enrollmentId} />
        <Select
          id={`reason-${enrollmentId}`}
          name="reason"
          label={t("enrollments.reason")}
          defaultValue={state.values.reason}
          options={(["transfer", "dropout", "expulsion"] as const).map((r) => ({
            id: r,
            label: t(`enrollments.exitReasons.${r}`),
          }))}
        />
        <Field
          id={`date-${enrollmentId}`}
          name="date"
          type="date"
          label={t("enrollments.date")}
          defaultValue={state.values.date ?? today}
        />
        <Field
          id={`note-${enrollmentId}`}
          name="note"
          label={t("enrollments.note")}
          help={t("enrollments.noteHelp")}
          defaultValue={state.values.note}
        />
        <FormMessage status={state.status} message={state.message} />
        <SubmitButton label={t("enrollments.leave")} variant="danger" />
      </form>
    </details>
  );
}
