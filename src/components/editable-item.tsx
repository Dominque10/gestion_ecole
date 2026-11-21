"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form-fields";
import { t } from "@/i18n";
import { idleFormState, type FormState } from "@/lib/form-state";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

/**
 * Élément de liste renommable et supprimable (niveau, matière…). Le formulaire de renommage
 * s'ouvre à la demande pour garder la liste courte sur un petit écran.
 */
export function EditableItem({
  id,
  name,
  renameAction,
  deleteAction,
  labels,
}: {
  id: string;
  name: string;
  renameAction: Action;
  deleteAction: Action;
  labels: { rename: string; newName: string; delete: string; deleteConfirm: string };
}) {
  const [renameState, rename] = useActionState(renameAction, idleFormState);
  const [deleteState, remove] = useActionState(deleteAction, idleFormState);
  const [editing, setEditing] = useState(false);
  const message = deleteState.message ? deleteState : renameState;

  return (
    <li className="flex flex-col gap-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{name}</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
            className="h-11 rounded-md border border-zinc-400 px-3 text-sm font-medium"
          >
            {labels.rename}
          </button>
          <form
            action={remove}
            onSubmit={(event) => {
              if (!window.confirm(labels.deleteConfirm)) event.preventDefault();
            }}
          >
            <input type="hidden" name="id" value={id} />
            <button
              type="submit"
              className="h-11 rounded-md border border-red-700 px-3 text-sm font-medium text-red-800"
            >
              {labels.delete}
            </button>
          </form>
        </div>
      </div>
      {editing && (
        <form action={rename} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={id} />
          <Field
            name="name"
            id={`name-${id}`}
            label={labels.newName}
            defaultValue={name}
            required
          />
          <SubmitButton label={t("form.save")} variant="secondary" />
        </form>
      )}
      <FormMessage status={message.status} message={message.message} />
    </li>
  );
}
