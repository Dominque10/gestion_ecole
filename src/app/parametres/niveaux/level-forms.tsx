"use client";

import { useActionState } from "react";
import { EditableItem } from "@/components/editable-item";
import { Field, FormMessage, SubmitButton } from "@/components/form-fields";
import { t } from "@/i18n";
import { idleFormState } from "@/lib/form-state";
import { CYCLES, type Cycle } from "@/modules/settings/defaults";
import {
  addDefaultLevelsAction,
  createLevelAction,
  deleteLevelAction,
  renameLevelAction,
} from "./actions";

export function AddDefaultLevelsButton({ cycle }: { cycle: Cycle }) {
  const [state, formAction] = useActionState(addDefaultLevelsAction, idleFormState);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="cycle" value={cycle} />
      <SubmitButton
        label={t("levels.addDefaults", { cycle: t(`cycles.${cycle}`).toLowerCase() })}
        variant="secondary"
      />
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

export function LevelItem({ id, name }: { id: string; name: string }) {
  return (
    <EditableItem
      id={id}
      name={name}
      renameAction={renameLevelAction}
      deleteAction={deleteLevelAction}
      labels={{
        rename: t("levels.rename"),
        newName: t("levels.newName", { nom: name }),
        delete: t("levels.delete"),
        deleteConfirm: t("levels.deleteConfirm", { nom: name }),
      }}
    />
  );
}

export function CreateLevelForm() {
  const [state, formAction] = useActionState(createLevelAction, idleFormState);
  return (
    <form
      key={state.status === "success" ? state.message : "form"}
      action={formAction}
      className="flex flex-col gap-5"
      noValidate
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="cycle" className="font-medium">
          {t("levels.cycle")}
        </label>
        <select
          id="cycle"
          name="cycle"
          defaultValue={state.values.cycle ?? "primary"}
          className="h-12 rounded-md border border-zinc-400 bg-white px-3 text-base"
        >
          {CYCLES.map((cycle) => (
            <option key={cycle} value={cycle}>
              {t(`cycles.${cycle}`)}
            </option>
          ))}
        </select>
      </div>
      <Field
        name="name"
        label={t("levels.name")}
        help={t("levels.nameHelp")}
        defaultValue={state.values.name}
        error={state.fieldErrors.name}
        required
      />
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton label={t("levels.add")} />
    </form>
  );
}
