"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form-fields";
import { t } from "@/i18n";
import { idleFormState, type FormState } from "@/lib/form-state";
import {
  addGuardianAction,
  createStudentAction,
  deleteDocumentAction,
  removeGuardianAction,
  saveMedicalAction,
  setPrimaryGuardianAction,
  updateStudentAction,
} from "./actions";

type Values = Record<string, string>;

function IdentityFields({
  v,
  e,
  disabled,
}: {
  v: Values;
  e: FormState["fieldErrors"];
  disabled?: boolean;
}) {
  return (
    <>
      <Field
        name="lastName"
        label={t("students.lastName")}
        defaultValue={v.lastName}
        error={e.lastName}
        disabled={disabled}
        required
      />
      <Field
        name="firstNames"
        label={t("students.firstNames")}
        defaultValue={v.firstNames}
        error={e.firstNames}
        disabled={disabled}
        required
      />
      <fieldset
        className="flex flex-col gap-2"
        disabled={disabled}
        aria-describedby={e.sex ? "sex-error" : undefined}
      >
        <legend className="mb-1 font-medium">{t("students.sex")}</legend>
        <div className="flex gap-6">
          {(["F", "M"] as const).map((sex) => (
            <label key={sex} className="flex min-h-11 items-center gap-3">
              <input
                type="radio"
                name="sex"
                value={sex}
                defaultChecked={v.sex === sex}
                className="size-5"
              />
              {sex === "F" ? t("students.female") : t("students.male")}
            </label>
          ))}
        </div>
        {e.sex && (
          <p id="sex-error" className="text-sm text-red-800">
            {e.sex}
          </p>
        )}
      </fieldset>
      <Field
        name="birthDate"
        type="date"
        label={t("students.birthDate")}
        help={t("students.optional")}
        defaultValue={v.birthDate}
        error={e.birthDate}
        disabled={disabled}
      />
      <Field
        name="birthPlace"
        label={t("students.birthPlace")}
        help={t("students.optional")}
        defaultValue={v.birthPlace}
        disabled={disabled}
      />
      <Field
        name="nationality"
        label={t("students.nationality")}
        help={t("students.optional")}
        defaultValue={v.nationality}
        disabled={disabled}
      />
      <Field
        name="previousSchool"
        label={t("students.previousSchool")}
        help={t("students.optional")}
        defaultValue={v.previousSchool}
        disabled={disabled}
      />
    </>
  );
}

function GuardianFields({
  v,
  e,
  prefix,
}: {
  v: Values;
  e: FormState["fieldErrors"];
  prefix: string;
}) {
  return (
    <>
      <Field
        id={`${prefix}-name`}
        name="fullName"
        label={t("students.guardianName")}
        defaultValue={v.fullName}
        error={e.fullName}
        required
      />
      <Field
        id={`${prefix}-phone`}
        name="phone"
        inputMode="tel"
        label={t("students.guardianPhone")}
        help={t("students.guardianPhoneHelp")}
        defaultValue={v.phone}
        error={e.phone}
        required
      />
      <Field
        id={`${prefix}-other`}
        name="otherPhone"
        inputMode="tel"
        label={t("students.guardianOtherPhone")}
        help={t("students.optional")}
        defaultValue={v.otherPhone}
        error={e.otherPhone}
      />
      <Field
        id={`${prefix}-relationship`}
        name="relationship"
        label={t("students.relationship")}
        help={t("students.relationshipHelp")}
        defaultValue={v.relationship}
      />
    </>
  );
}

export function CreateStudentForm() {
  const [state, formAction] = useActionState(createStudentAction, idleFormState);
  const v = { nationality: "Congolaise", ...state.values };
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <fieldset className="flex flex-col gap-5">
        <legend className="mb-1 text-lg font-semibold">{t("students.identityTitle")}</legend>
        <IdentityFields v={v} e={state.fieldErrors} />
      </fieldset>
      <fieldset className="flex flex-col gap-5 rounded-md border border-zinc-300 p-4">
        <legend className="px-1 text-lg font-semibold">{t("students.guardianTitle")}</legend>
        <GuardianFields v={v} e={state.fieldErrors} prefix="guardian" />
      </fieldset>
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton label={t("students.create")} />
    </form>
  );
}

export function EditStudentForm({
  studentId,
  initial,
  readOnly,
}: {
  studentId: string;
  initial: Values;
  readOnly: boolean;
}) {
  const [state, formAction] = useActionState(updateStudentAction, idleFormState);
  const v = state.status === "idle" ? initial : { ...initial, ...state.values };
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="studentId" value={studentId} />
      <IdentityFields v={v} e={state.fieldErrors} disabled={readOnly} />
      <FormMessage status={state.status} message={state.message} />
      {!readOnly && <SubmitButton label={t("students.save")} />}
    </form>
  );
}

export function GuardianItem({
  studentId,
  guardian,
  canEdit,
}: {
  studentId: string;
  guardian: {
    id: string;
    fullName: string;
    phone: string;
    otherPhone: string | null;
    relationship: string | null;
    isPrimary: boolean;
  };
  canEdit: boolean;
}) {
  const [primaryState, makePrimary] = useActionState(setPrimaryGuardianAction, idleFormState);
  const [removeState, remove] = useActionState(removeGuardianAction, idleFormState);
  const message = removeState.message ? removeState : primaryState;
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {guardian.fullName}
          {guardian.relationship && (
            <span className="font-normal text-zinc-600"> · {guardian.relationship}</span>
          )}
        </span>
        {guardian.isPrimary && (
          <span className="rounded bg-blue-100 px-2 py-0.5 text-sm font-medium text-blue-900">
            {t("students.primary")}
          </span>
        )}
      </div>
      <p className="text-sm">
        <a href={`tel:${guardian.phone}`} className="text-blue-800 underline">
          {guardian.phone}
        </a>
        {guardian.otherPhone && ` · ${guardian.otherPhone}`}
      </p>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {!guardian.isPrimary && (
            <form action={makePrimary}>
              <input type="hidden" name="studentId" value={studentId} />
              <input type="hidden" name="guardianId" value={guardian.id} />
              <button
                type="submit"
                className="h-11 rounded-md border border-zinc-400 px-3 text-sm font-medium"
              >
                {t("students.makePrimary")}
              </button>
            </form>
          )}
          <form
            action={remove}
            onSubmit={(event) => {
              if (!window.confirm(t("students.removeGuardianConfirm", { nom: guardian.fullName })))
                event.preventDefault();
            }}
          >
            <input type="hidden" name="studentId" value={studentId} />
            <input type="hidden" name="guardianId" value={guardian.id} />
            <button
              type="submit"
              className="h-11 rounded-md border border-red-700 px-3 text-sm font-medium text-red-800"
            >
              {t("students.removeGuardian")}
            </button>
          </form>
        </div>
      )}
      <FormMessage status={message.status} message={message.message} />
    </li>
  );
}

export function AddGuardianForm({ studentId }: { studentId: string }) {
  const [state, formAction] = useActionState(addGuardianAction, idleFormState);
  return (
    <form
      key={state.status === "success" ? `ok-${state.message}` : "form"}
      action={formAction}
      className="flex flex-col gap-4"
      noValidate
    >
      <input type="hidden" name="studentId" value={studentId} />
      <GuardianFields v={state.values} e={state.fieldErrors} prefix="new-guardian" />
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton label={t("students.addGuardian")} variant="secondary" />
    </form>
  );
}

export function MedicalForm({ studentId, initial }: { studentId: string; initial: Values }) {
  const [state, formAction] = useActionState(saveMedicalAction, idleFormState);
  const v = state.status === "idle" ? initial : { ...initial, ...state.values };
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="studentId" value={studentId} />
      <Field name="allergies" label={t("students.allergies")} defaultValue={v.allergies} />
      <Field name="treatments" label={t("students.treatments")} defaultValue={v.treatments} />
      <Field
        name="emergencyContactName"
        label={t("students.emergencyName")}
        defaultValue={v.emergencyContactName}
      />
      <Field
        name="emergencyContactPhone"
        inputMode="tel"
        label={t("students.emergencyPhone")}
        defaultValue={v.emergencyContactPhone}
        error={state.fieldErrors.emergencyContactPhone}
      />
      <Field name="notes" label={t("students.medicalNotes")} defaultValue={v.notes} />
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton label={t("students.save")} variant="secondary" />
    </form>
  );
}

export function DeleteDocumentButton({ documentId }: { documentId: string }) {
  const [state, formAction] = useActionState(deleteDocumentAction, idleFormState);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(t("students.documentDeleteConfirm"))) event.preventDefault();
      }}
    >
      <input type="hidden" name="documentId" value={documentId} />
      <button
        type="submit"
        className="h-11 rounded-md border border-red-700 px-3 text-sm font-medium text-red-800"
      >
        {t("students.documentDelete")}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}
