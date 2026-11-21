"use client";

import { useActionState } from "react";
import { EditableItem } from "@/components/editable-item";
import { Field, FormMessage, SubmitButton } from "@/components/form-fields";
import { t } from "@/i18n";
import { idleFormState } from "@/lib/form-state";
import { createSubjectAction, deleteSubjectAction, renameSubjectAction } from "./actions";

export function SubjectItem({ id, name }: { id: string; name: string }) {
  return (
    <EditableItem
      id={id}
      name={name}
      renameAction={renameSubjectAction}
      deleteAction={deleteSubjectAction}
      labels={{
        rename: t("subjects.rename"),
        newName: t("subjects.newName", { nom: name }),
        delete: t("subjects.delete"),
        deleteConfirm: t("subjects.deleteConfirm", { nom: name }),
      }}
    />
  );
}

export function CreateSubjectForm() {
  const [state, formAction] = useActionState(createSubjectAction, idleFormState);
  return (
    <form
      key={state.status === "success" ? state.message : "form"}
      action={formAction}
      className="flex flex-col gap-5"
      noValidate
    >
      <Field
        name="name"
        label={t("subjects.name")}
        defaultValue={state.values.name}
        error={state.fieldErrors.name}
        required
      />
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton label={t("subjects.add")} />
    </form>
  );
}
