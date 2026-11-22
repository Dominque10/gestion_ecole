"use client";

import { useActionState } from "react";
import { Field, FormMessage, inputClass, SubmitButton } from "@/components/form-fields";
import { t } from "@/i18n";
import { idleFormState } from "@/lib/form-state";
import { ASSESSMENT_KINDS } from "@/modules/grading/grade-input";
import { createAssessmentAction, deleteAssessmentAction, updateAssessmentAction } from "./actions";

type Defaults = { periode: string; type: string; intitule: string; date: string; bareme: string };

function AssessmentFields({
  periods,
  defaults,
  idPrefix,
}: {
  periods: { id: string; label: string }[];
  defaults: Defaults;
  idPrefix: string;
}) {
  return (
    <>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">{t("grading.kind")}</legend>
        <div className="flex flex-wrap gap-2">
          {ASSESSMENT_KINDS.map((kind) => (
            <label
              key={kind}
              className="flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 px-3"
            >
              <input
                type="radio"
                name="type"
                value={kind}
                defaultChecked={defaults.type === kind}
                required
                className="size-5"
              />
              {t(`grading.kinds.${kind}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-period`} className="font-medium">
          {t("grading.period")}
        </label>
        <select
          id={`${idPrefix}-period`}
          name="periode"
          defaultValue={defaults.periode}
          className={`${inputClass} bg-white`}
        >
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <Field
        id={`${idPrefix}-date`}
        name="date"
        type="date"
        label={t("grading.date")}
        defaultValue={defaults.date}
        required
      />
      <Field
        id={`${idPrefix}-scale`}
        name="bareme"
        type="number"
        inputMode="numeric"
        min={1}
        max={100}
        step={1}
        label={t("grading.maxScore")}
        help={t("grading.maxScoreHelp")}
        defaultValue={defaults.bareme}
        required
      />
      <Field
        id={`${idPrefix}-title`}
        name="intitule"
        maxLength={80}
        label={t("grading.assessmentTitle")}
        help={t("grading.assessmentTitleHelp")}
        defaultValue={defaults.intitule}
      />
    </>
  );
}

export function CreateAssessmentForm({
  classId,
  subjectId,
  periods,
  defaults,
}: {
  classId: string;
  subjectId: string;
  periods: { id: string; label: string }[];
  defaults: Defaults;
}) {
  const [state, formAction] = useActionState(createAssessmentAction, idleFormState);
  const values = { ...defaults, ...state.values } as Defaults;
  return (
    <form
      key={JSON.stringify(state.values)}
      action={formAction}
      className="flex flex-col gap-4 rounded-md bg-zinc-100 p-4"
    >
      <input type="hidden" name="classe" value={classId} />
      <input type="hidden" name="matiere" value={subjectId} />
      <AssessmentFields periods={periods} defaults={values} idPrefix="new" />
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton label={t("grading.create")} />
    </form>
  );
}

export function EditAssessmentForm({
  assessmentId,
  periods,
  defaults,
}: {
  assessmentId: string;
  periods: { id: string; label: string }[];
  defaults: Defaults;
}) {
  const [state, formAction] = useActionState(updateAssessmentAction, idleFormState);
  const values =
    state.status === "error" ? ({ ...defaults, ...state.values } as Defaults) : defaults;
  return (
    <form key={JSON.stringify(values)} action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="evaluation" value={assessmentId} />
      <AssessmentFields periods={periods} defaults={values} idPrefix="edit" />
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton label={t("grading.saveAssessment")} />
    </form>
  );
}

export function DeleteAssessmentForm({
  assessmentId,
  classId,
  subjectId,
}: {
  assessmentId: string;
  classId: string;
  subjectId: string;
}) {
  const [state, formAction] = useActionState(deleteAssessmentAction, idleFormState);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(t("grading.deleteConfirm"))) event.preventDefault();
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="evaluation" value={assessmentId} />
      <input type="hidden" name="classe" value={classId} />
      <input type="hidden" name="matiere" value={subjectId} />
      <SubmitButton label={t("grading.deleteAssessment")} variant="danger" />
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}
