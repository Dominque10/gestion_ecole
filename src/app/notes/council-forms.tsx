"use client";

import { useActionState, type ReactNode } from "react";
import { FormMessage, SubmitButton } from "@/components/form-fields";
import { t } from "@/i18n";
import { idleFormState, type FormState } from "@/lib/form-state";
import {
  reopenCouncilAction,
  saveCouncilAction,
  saveSubjectCommentsAction,
  validateCouncilAction,
} from "./council-actions";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

/** Formulaire d'enregistrement : champs cachés + contenu, message et bouton. */
function ActionForm({
  action,
  hidden,
  label,
  variant,
  confirm,
  children,
}: {
  action: Action;
  hidden: Record<string, string>;
  label: string;
  variant?: "primary" | "secondary" | "danger";
  confirm?: string;
  children?: ReactNode;
}) {
  const [state, formAction] = useActionState(action, idleFormState);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
      className="flex flex-col gap-4"
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      <FormMessage status={state.status} message={state.message} />
      <div className="sticky bottom-0 bg-white py-2">
        <SubmitButton label={label} variant={variant} />
      </div>
    </form>
  );
}

export function SubjectCommentsForm(props: {
  hidden: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <ActionForm
      action={saveSubjectCommentsAction}
      hidden={props.hidden}
      label={t("council.saveComments")}
    >
      {props.children}
    </ActionForm>
  );
}

export function CouncilForm(props: { hidden: Record<string, string>; children: ReactNode }) {
  return (
    <ActionForm action={saveCouncilAction} hidden={props.hidden} label={t("council.save")}>
      {props.children}
    </ActionForm>
  );
}

export function ValidateCouncilForm({
  hidden,
  className,
}: {
  hidden: Record<string, string>;
  className: string;
}) {
  return (
    <ActionForm
      action={validateCouncilAction}
      hidden={hidden}
      label={t("council.validate")}
      confirm={t("council.validateConfirm", { classe: className })}
    />
  );
}

export function ReopenCouncilForm({ hidden }: { hidden: Record<string, string> }) {
  return (
    <ActionForm
      action={reopenCouncilAction}
      hidden={hidden}
      label={t("council.reopen")}
      variant="secondary"
    />
  );
}
