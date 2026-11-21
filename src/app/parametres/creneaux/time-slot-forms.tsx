"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form-fields";
import { t } from "@/i18n";
import { idleFormState, type FormState } from "@/lib/form-state";
import type { TimeSlot } from "@/modules/settings/time-slots";
import { createTimeSlotAction, deleteTimeSlotAction, updateTimeSlotAction } from "./actions";

function SlotFields({
  prefix,
  values,
  errors,
}: {
  prefix: string;
  values: { label: string; startTime: string; endTime: string };
  errors: FormState["fieldErrors"];
}) {
  return (
    <>
      <Field
        id={`${prefix}-label`}
        name="label"
        label={t("timeSlots.label")}
        help={t("timeSlots.labelHelp")}
        defaultValue={values.label}
        error={errors.label}
        required
      />
      <div className="grid grid-cols-2 gap-3">
        <Field
          id={`${prefix}-start`}
          name="startTime"
          type="time"
          label={t("timeSlots.start")}
          defaultValue={values.startTime}
          error={errors.startTime}
          required
        />
        <Field
          id={`${prefix}-end`}
          name="endTime"
          type="time"
          label={t("timeSlots.end")}
          defaultValue={values.endTime}
          error={errors.endTime}
          required
        />
      </div>
    </>
  );
}

export function CreateTimeSlotForm() {
  const [state, formAction] = useActionState(createTimeSlotAction, idleFormState);
  const values = { label: "", startTime: "", endTime: "", ...state.values };
  return (
    <form
      key={state.status === "success" ? state.message : "form"}
      action={formAction}
      className="flex flex-col gap-5"
      noValidate
    >
      <SlotFields prefix="new" values={values} errors={state.fieldErrors} />
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton label={t("timeSlots.add")} />
    </form>
  );
}

export function TimeSlotItem({ slot, canEdit }: { slot: TimeSlot; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [updateState, update] = useActionState(updateTimeSlotAction, idleFormState);
  const [deleteState, remove] = useActionState(deleteTimeSlotAction, idleFormState);
  const message = deleteState.message ? deleteState : updateState;
  return (
    <li className="flex flex-col gap-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <span>
          <span className="font-medium">{slot.label}</span>{" "}
          <span className="text-zinc-600">
            {slot.startTime} – {slot.endTime}
          </span>
        </span>
        {canEdit && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              aria-expanded={editing}
              className="h-11 rounded-md border border-zinc-400 px-3 text-sm font-medium"
            >
              {t("timeSlots.edit")}
            </button>
            <form
              action={remove}
              onSubmit={(event) => {
                if (!window.confirm(t("timeSlots.deleteConfirm", { nom: slot.label }))) {
                  event.preventDefault();
                }
              }}
            >
              <input type="hidden" name="id" value={slot.id} />
              <button
                type="submit"
                className="h-11 rounded-md border border-red-700 px-3 text-sm font-medium text-red-800"
              >
                {t("timeSlots.delete")}
              </button>
            </form>
          </div>
        )}
      </div>
      {editing && (
        <form action={update} className="flex flex-col gap-4" noValidate>
          <input type="hidden" name="id" value={slot.id} />
          <SlotFields
            prefix={slot.id}
            values={{ ...slot, ...updateState.values }}
            errors={updateState.fieldErrors}
          />
          <SubmitButton label={t("timeSlots.save")} variant="secondary" />
        </form>
      )}
      <FormMessage status={message.status} message={message.message} />
    </li>
  );
}
