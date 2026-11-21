"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form-fields";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import { idleFormState } from "@/lib/form-state";
import {
  assignTeachersAction,
  createClassAction,
  deleteClassAction,
  updateClassAction,
} from "./actions";

type Option = { id: string; name: string };
type ClassValues = {
  levelId: string;
  series: string;
  name: string;
  capacity: string;
  headTeacherId: string;
};

function Select({
  id,
  name,
  label,
  options,
  defaultValue,
  emptyLabel,
  error,
  disabled,
}: {
  id: string;
  name: string;
  label: string;
  options: Option[];
  defaultValue: string;
  emptyLabel?: string;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <select
        id={id}
        name={name}
        defaultValue={defaultValue}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${inputClass} bg-white`}
      >
        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}

function ClassFields({
  prefix,
  values,
  errors,
  levels,
  teachers,
  disabled,
}: {
  prefix: string;
  values: ClassValues;
  errors: Record<string, string>;
  levels: Option[];
  teachers: Option[];
  disabled?: boolean;
}) {
  return (
    <>
      <Select
        id={`${prefix}-level`}
        name="levelId"
        label={t("classes.level")}
        options={levels}
        defaultValue={values.levelId}
        emptyLabel="—"
        error={errors.levelId}
        disabled={disabled}
      />
      <Field
        id={`${prefix}-series`}
        name="series"
        label={t("classes.series")}
        help={t("classes.seriesHelp")}
        autoCapitalize="characters"
        defaultValue={values.series}
        error={errors.series}
        disabled={disabled}
      />
      <Field
        id={`${prefix}-name`}
        name="name"
        label={t("classes.name")}
        help={t("classes.nameHelp")}
        defaultValue={values.name}
        error={errors.name}
        disabled={disabled}
        required
      />
      <Field
        id={`${prefix}-capacity`}
        name="capacity"
        type="number"
        inputMode="numeric"
        min={1}
        max={500}
        label={t("classes.capacity")}
        help={t("classes.capacityHelp")}
        defaultValue={values.capacity}
        error={errors.capacity}
        disabled={disabled}
      />
      <Select
        id={`${prefix}-head`}
        name="headTeacherId"
        label={t("classes.headTeacher")}
        options={teachers}
        defaultValue={values.headTeacherId}
        emptyLabel={t("classes.noHeadTeacher")}
        disabled={disabled}
      />
      {teachers.length === 0 && <p className="text-sm text-zinc-600">{t("classes.noTeachers")}</p>}
    </>
  );
}

const EMPTY: ClassValues = { levelId: "", series: "", name: "", capacity: "", headTeacherId: "" };

export function CreateClassForm({
  yearId,
  levels,
  teachers,
}: {
  yearId: string;
  levels: Option[];
  teachers: Option[];
}) {
  const [state, formAction] = useActionState(createClassAction, idleFormState);
  const values = state.status === "error" ? { ...EMPTY, ...state.values } : EMPTY;
  return (
    <form
      key={state.status === "success" ? state.message : "form"}
      action={formAction}
      className="flex flex-col gap-5"
      noValidate
    >
      <input type="hidden" name="annee" value={yearId} />
      <ClassFields
        prefix="new"
        values={values}
        errors={state.fieldErrors}
        levels={levels}
        teachers={teachers}
      />
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton label={t("classes.create")} />
    </form>
  );
}

export function EditClassForm({
  classId,
  initial,
  levels,
  teachers,
  readOnly,
}: {
  classId: string;
  initial: ClassValues;
  levels: Option[];
  teachers: Option[];
  readOnly: boolean;
}) {
  const [state, formAction] = useActionState(updateClassAction, idleFormState);
  const values = state.status === "idle" ? initial : { ...initial, ...state.values };
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="classId" value={classId} />
      <ClassFields
        prefix="edit"
        values={values}
        errors={state.fieldErrors}
        levels={levels}
        teachers={teachers}
        disabled={readOnly}
      />
      <FormMessage status={state.status} message={state.message} />
      {!readOnly && <SubmitButton label={t("classes.save")} />}
    </form>
  );
}

export function TeachersForm({
  classId,
  subjects,
  teachers,
  readOnly,
}: {
  classId: string;
  subjects: {
    subjectId: string;
    subjectName: string;
    coefficient: number;
    teacherId: string | null;
  }[];
  teachers: Option[];
  readOnly: boolean;
}) {
  const [state, formAction] = useActionState(assignTeachersAction, idleFormState);
  return (
    <form
      key={subjects.map((s) => `${s.subjectId}:${s.teacherId}`).join("|")}
      action={formAction}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="classId" value={classId} />
      {subjects.map((s) => (
        <Select
          key={s.subjectId}
          id={`teacher-${s.subjectId}`}
          name={`teacher-${s.subjectId}`}
          label={`${s.subjectName} (${t("classes.coefficientShort", { n: s.coefficient })})`}
          options={teachers}
          defaultValue={s.teacherId ?? ""}
          emptyLabel={t("classes.noTeacher")}
          disabled={readOnly}
        />
      ))}
      <FormMessage status={state.status} message={state.message} />
      {!readOnly && <SubmitButton label={t("classes.saveTeachers")} />}
    </form>
  );
}

export function DeleteClassForm({
  classId,
  yearId,
  name,
}: {
  classId: string;
  yearId: string;
  name: string;
}) {
  const [state, formAction] = useActionState(deleteClassAction, idleFormState);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(t("classes.deleteConfirm", { nom: name }))) event.preventDefault();
      }}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="classId" value={classId} />
      <input type="hidden" name="annee" value={yearId} />
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton label={t("classes.delete")} variant="danger" />
    </form>
  );
}
