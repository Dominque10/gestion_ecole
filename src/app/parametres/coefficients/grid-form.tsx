"use client";

import { useActionState } from "react";
import { FormMessage, inputClass, SubmitButton } from "@/components/form-fields";
import { t } from "@/i18n";
import { idleFormState } from "@/lib/form-state";
import { addDefaultGridAction, saveGridAction } from "./actions";

type Key = { annee: string; niveau: string; serie: string };

function KeyFields({ gridKey }: { gridKey: Key }) {
  return (
    <>
      <input type="hidden" name="annee" value={gridKey.annee} />
      <input type="hidden" name="niveau" value={gridKey.niveau} />
      <input type="hidden" name="serie" value={gridKey.serie} />
    </>
  );
}

export function GridForm({
  gridKey,
  subjects,
  grid,
  readOnly,
}: {
  gridKey: Key;
  subjects: { id: string; name: string }[];
  /** Coefficient par matière enseignée. */
  grid: Record<string, number>;
  readOnly: boolean;
}) {
  const [state, formAction] = useActionState(saveGridAction, idleFormState);
  return (
    // La clé suit la grille enregistrée : les cases se remettent à jour après un ajout par défaut.
    <form key={JSON.stringify(grid)} action={formAction} className="flex flex-col gap-4" noValidate>
      <KeyFields gridKey={gridKey} />
      <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-300 px-4">
        {subjects.map((subject) => {
          const taught = subject.id in grid;
          return (
            <li key={subject.id} className="flex items-center justify-between gap-3 py-2">
              <label className="flex min-h-11 flex-1 items-center gap-3">
                <input
                  type="checkbox"
                  name="on"
                  value={subject.id}
                  defaultChecked={taught}
                  disabled={readOnly}
                  aria-label={t("coefficients.taught", { matiere: subject.name })}
                  className="size-5"
                />
                {subject.name}
              </label>
              <input
                type="number"
                name={`coef-${subject.id}`}
                inputMode="numeric"
                min={1}
                max={20}
                step={1}
                defaultValue={grid[subject.id] ?? 1}
                disabled={readOnly}
                aria-label={t("coefficients.coefficient", { matiere: subject.name })}
                className={`${inputClass} w-20 text-center`}
              />
            </li>
          );
        })}
      </ul>
      <FormMessage status={state.status} message={state.message} />
      {!readOnly && <SubmitButton label={t("coefficients.save")} />}
    </form>
  );
}

export function AddDefaultGridButton({ gridKey }: { gridKey: Key }) {
  const [state, formAction] = useActionState(addDefaultGridAction, idleFormState);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <KeyFields gridKey={gridKey} />
      <SubmitButton label={t("coefficients.addDefaults")} variant="secondary" />
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}
