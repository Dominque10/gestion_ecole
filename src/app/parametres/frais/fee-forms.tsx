"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form-fields";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import { idleFormState, type FormState } from "@/lib/form-state";
import { formatXAF, parseXAF } from "@/lib/money";
import { MAX_INSTALLMENTS, proposeInstallments } from "@/modules/settings/fees-logic";
import {
  bulletinBlockingAction,
  deleteFeeAction,
  saveFeeAction,
  siblingDiscountAction,
} from "./actions";

type Kind = "registration" | "tuition" | "other";
type Level = { id: string; name: string };
type Draft = { amount: string; dueDate: string };

export type FeeFormInitial = {
  name: string;
  kind: Kind;
  mandatory: boolean;
  installments: { amount: number; dueDate: string }[];
};

const KINDS: Kind[] = ["tuition", "registration", "other"];

/** Montant affiché dans un champ : « 50 000 ». */
const asInput = (amount: number) => formatXAF(amount).replace(" FCFA", "");

function FeeFields({
  yearId,
  levels,
  dueDates,
  initial,
  fixedLevel,
  originalName,
  state,
  formAction,
}: {
  yearId: string;
  levels: Level[];
  dueDates: string[];
  initial?: FeeFormInitial;
  fixedLevel?: Level;
  originalName?: string;
  state: FormState;
  formAction: (formData: FormData) => void;
}) {
  const [kind, setKind] = useState<Kind>(initial?.kind ?? "tuition");
  const [total, setTotal] = useState(
    initial ? asInput(initial.installments.reduce((s, p) => s + p.amount, 0)) : "",
  );
  const [count, setCount] = useState(initial?.installments.length ?? 3);
  const [drafts, setDrafts] = useState<Draft[]>(
    initial?.installments.map((p) => ({ amount: asInput(p.amount), dueDate: p.dueDate })) ?? [],
  );
  const [totalError, setTotalError] = useState<string | null>(null);

  function compute() {
    const value = parseXAF(total);
    if (value === null || value < count) {
      setTotalError(t("fees.errors.total"));
      return;
    }
    setTotalError(null);
    setDrafts(
      proposeInstallments(value, count, dueDates).map((p) => ({
        amount: asInput(p.amount),
        dueDate: p.dueDate,
      })),
    );
  }

  const amounts = drafts.map((d) => parseXAF(d.amount));
  const sum = amounts.every((a) => a !== null)
    ? amounts.reduce((s, a) => s + (a as number), 0)
    : null;
  const e = state.fieldErrors;
  const v = state.values;
  const checkedLevels = new Set((v.levelIds ?? "").split(",").filter(Boolean));

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="annee" value={yearId} />
      {originalName && <input type="hidden" name="originalName" value={originalName} />}
      <input type="hidden" name="count" value={drafts.length} />

      <Field
        name="name"
        id="fee-name"
        label={t("fees.name")}
        help={t("fees.nameHelp")}
        defaultValue={v.name ?? initial?.name}
        error={e.name}
        required
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">{t("fees.kindLabel")}</legend>
        {KINDS.map((k) => (
          <label key={k} className="flex min-h-11 items-center gap-3">
            <input
              type="radio"
              name="kind"
              value={k}
              checked={kind === k}
              onChange={() => {
                setKind(k);
                if (k === "registration" && drafts.length === 0) setCount(1);
              }}
              className="size-5"
            />
            {t(`fees.kind.${k}`)}
          </label>
        ))}
      </fieldset>

      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          name="mandatory"
          defaultChecked={
            v.mandatory !== undefined ? v.mandatory === "on" : (initial?.mandatory ?? true)
          }
          className="size-5"
        />
        {t("fees.mandatory")}
      </label>

      {fixedLevel ? (
        <input type="hidden" name="levelIds" value={fixedLevel.id} />
      ) : (
        <fieldset
          className="flex flex-col gap-1"
          aria-describedby={e.levels ? "fee-levels-error" : undefined}
        >
          <legend className="mb-1 font-medium">{t("fees.levels")}</legend>
          <div className="grid grid-cols-2 gap-x-3">
            {levels.map((level) => (
              <label key={level.id} className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  name="levelIds"
                  value={level.id}
                  defaultChecked={checkedLevels.has(level.id)}
                  className="size-5"
                />
                {level.name}
              </label>
            ))}
          </div>
          {e.levels && (
            <p id="fee-levels-error" className="text-sm text-red-800">
              {e.levels}
            </p>
          )}
        </fieldset>
      )}

      <div className="flex flex-col gap-4 rounded-md bg-zinc-100 p-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="fee-total" className="font-medium">
            {t("fees.total")}
          </label>
          <input
            id="fee-total"
            inputMode="numeric"
            value={total}
            onChange={(event) => setTotal(event.target.value)}
            aria-invalid={totalError ? true : undefined}
            aria-describedby="fee-total-help"
            className={`${inputClass} bg-white`}
          />
          <p id="fee-total-help" className="text-sm text-zinc-600">
            {totalError ?? t("fees.totalHelp")}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="fee-count" className="font-medium">
            {t("fees.count")}
          </label>
          <select
            id="fee-count"
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
            className={`${inputClass} bg-white`}
          >
            {Array.from({ length: MAX_INSTALLMENTS }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={compute}
          className="h-12 rounded-md border border-zinc-400 bg-white font-semibold"
        >
          {t("fees.compute")}
        </button>
      </div>

      {drafts.length > 0 && (
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-1 text-lg font-semibold">{t("fees.installmentsTitle")}</legend>
          <p className="text-sm text-zinc-600">{t("fees.installmentsHelp")}</p>
          {drafts.map((draft, i) => {
            const n = i + 1;
            return (
              <div key={n} className="grid grid-cols-2 gap-3">
                <Field
                  id={`amount-${n}`}
                  name={`amount-${n}`}
                  inputMode="numeric"
                  label={t("fees.installmentAmount", { n })}
                  value={draft.amount}
                  onChange={(event) =>
                    setDrafts(
                      drafts.map((d, j) => (j === i ? { ...d, amount: event.target.value } : d)),
                    )
                  }
                />
                <Field
                  id={`due-${n}`}
                  name={`due-${n}`}
                  type="date"
                  label={t("fees.installmentDue", { n })}
                  value={draft.dueDate}
                  onChange={(event) =>
                    setDrafts(
                      drafts.map((d, j) => (j === i ? { ...d, dueDate: event.target.value } : d)),
                    )
                  }
                />
              </div>
            );
          })}
          {sum !== null && (
            <p className="font-medium">{t("fees.sum", { montant: formatXAF(sum) })}</p>
          )}
        </fieldset>
      )}
      {e.installments && <p className="text-sm text-red-800">{e.installments}</p>}

      <FormMessage status={state.status} message={state.message} />
      <SubmitButton label={t("fees.save")} />
    </form>
  );
}

export function FeeForm(props: {
  yearId: string;
  levels: Level[];
  dueDates: string[];
  initial?: FeeFormInitial;
  fixedLevel?: Level;
  originalName?: string;
}) {
  const [state, formAction] = useActionState(saveFeeAction, idleFormState);
  // Après un ajout réussi, le formulaire repart à neuf (la clé change avec le message).
  return (
    <FeeFields
      key={state.status === "success" ? state.message : "form"}
      {...props}
      state={state}
      formAction={formAction}
    />
  );
}

export function DeleteFeeButton({
  yearId,
  levelId,
  name,
}: {
  yearId: string;
  levelId: string;
  name: string;
}) {
  const [state, formAction] = useActionState(deleteFeeAction, idleFormState);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(t("fees.deleteConfirm", { nom: name }))) event.preventDefault();
      }}
    >
      <input type="hidden" name="annee" value={yearId} />
      <input type="hidden" name="levelId" value={levelId} />
      <input type="hidden" name="name" value={name} />
      <button
        type="submit"
        className="h-11 rounded-md border border-red-700 px-3 text-sm font-medium text-red-800"
      >
        {t("fees.delete")}
      </button>
      <FormMessage status={state.status} message={state.message} />
    </form>
  );
}

export function SiblingDiscountForm({ percent, canEdit }: { percent: number; canEdit: boolean }) {
  const [state, formAction] = useActionState(siblingDiscountAction, idleFormState);
  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-zinc-300 p-4">
      <h2 className="text-lg font-semibold">{t("finance.siblingTitle")}</h2>
      <p className="text-sm">{t("finance.siblingHelp")}</p>
      <Field
        id="sibling-percent"
        name="percent"
        type="number"
        inputMode="numeric"
        min={0}
        max={100}
        label={t("finance.siblingPercent")}
        defaultValue={String(percent)}
        disabled={!canEdit}
      />
      <FormMessage status={state.status} message={state.message} />
      {canEdit && <SubmitButton label={t("finance.siblingSave")} variant="secondary" />}
    </form>
  );
}

/** Option B7 : bulletin caché au parent tant qu'une échéance échue reste impayée. */
export function BulletinBlockingForm({ enabled, canEdit }: { enabled: boolean; canEdit: boolean }) {
  const [state, formAction] = useActionState(bulletinBlockingAction, idleFormState);
  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-zinc-300 p-4">
      <h2 className="text-lg font-semibold">{t("fees.blockingTitle")}</h2>
      <label className="flex min-h-11 items-start gap-3">
        <input
          type="checkbox"
          name="bloquer"
          defaultChecked={enabled}
          disabled={!canEdit}
          className="mt-1 size-5 shrink-0"
        />
        <span>{t("fees.blockingLabel")}</span>
      </label>
      <p className="text-sm text-zinc-600">{t("fees.blockingHelp")}</p>
      <FormMessage status={state.status} message={state.message} />
      {canEdit && <SubmitButton label={t("fees.blockingSave")} variant="secondary" />}
    </form>
  );
}
