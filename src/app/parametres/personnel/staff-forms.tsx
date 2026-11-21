"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form-fields";
import { t } from "@/i18n";
import { idleFormState } from "@/lib/form-state";
import { STAFF_ROLES } from "@/modules/settings/roles";
import type { StaffMember } from "@/modules/settings/staff";
import {
  addStaffAction,
  removeStaffAction,
  resetPasswordAction,
  updateRolesAction,
} from "./actions";

function RoleCheckboxes({
  idPrefix,
  checked = [],
  error,
}: {
  idPrefix: string;
  checked?: readonly string[];
  error?: string;
}) {
  const errorId = `${idPrefix}-roles-error`;
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? errorId : undefined}>
      <legend className="mb-1 font-medium">{t("staff.roles")}</legend>
      {STAFF_ROLES.map((role) => (
        <label key={role} className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            name="roles"
            value={role}
            defaultChecked={checked.includes(role)}
            className="size-5"
          />
          {t(`roles.${role}`)}
        </label>
      ))}
      {error && (
        <p id={errorId} className="text-sm text-red-800">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function AddStaffForm({ minLength }: { minLength: number }) {
  const [state, formAction] = useActionState(addStaffAction, idleFormState);
  const e = state.fieldErrors;
  const v = state.values;
  return (
    // La clé change après un succès : le formulaire est vidé.
    <form
      key={state.status === "success" ? state.message : "form"}
      action={formAction}
      className="flex flex-col gap-5"
      noValidate
    >
      <Field name="name" label={t("staff.name")} defaultValue={v.name} error={e.name} required />
      <Field
        name="identifier"
        label={t("staff.identifier")}
        inputMode="tel"
        defaultValue={v.identifier}
        error={e.identifier}
        required
      />
      <Field
        name="password"
        type="text"
        autoComplete="off"
        label={t("staff.password")}
        help={t("staff.passwordHelp", { min: minLength })}
        error={e.password}
        required
      />
      <RoleCheckboxes idPrefix="new" error={e.roles} />
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton label={t("staff.submit")} />
    </form>
  );
}

export function StaffMemberCard({
  member,
  isSelf,
  minLength,
}: {
  member: StaffMember;
  isSelf: boolean;
  minLength: number;
}) {
  const [rolesState, rolesAction] = useActionState(updateRolesAction, idleFormState);
  const [resetState, resetAction] = useActionState(resetPasswordAction, idleFormState);
  const [removeState, removeAction] = useActionState(removeStaffAction, idleFormState);
  const contact = member.phone ?? member.email;
  return (
    <li className="flex flex-col gap-4 rounded-md border border-zinc-300 p-4">
      <div>
        <h3 className="font-semibold">{member.name}</h3>
        {contact && <p className="text-sm text-zinc-600">{contact}</p>}
        {member.pendingPassword && (
          <p className="text-sm text-amber-800">{t("staff.pendingPassword")}</p>
        )}
      </div>
      <form action={rolesAction} className="flex flex-col gap-3">
        <input type="hidden" name="userId" value={member.userId} />
        <RoleCheckboxes idPrefix={member.userId} checked={member.roles} />
        <FormMessage status={rolesState.status} message={rolesState.message} />
        <SubmitButton label={t("staff.saveRoles")} variant="secondary" />
      </form>
      <form
        action={removeAction}
        onSubmit={(event) => {
          if (!window.confirm(t("staff.removeConfirm", { nom: member.name }))) {
            event.preventDefault();
          }
        }}
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="userId" value={member.userId} />
        <FormMessage status={removeState.status} message={removeState.message} />
        <SubmitButton label={t("staff.remove")} variant="danger" />
      </form>
      {!isSelf && (
        <details className="rounded-md bg-zinc-50 p-3">
          <summary className="min-h-11 cursor-pointer content-center font-medium">
            {t("staff.resetTitle")}
          </summary>
          <form
            key={resetState.status === "success" ? resetState.message : "form"}
            action={resetAction}
            className="mt-3 flex flex-col gap-3"
            noValidate
          >
            <input type="hidden" name="userId" value={member.userId} />
            <input type="hidden" name="name" value={member.name} />
            <Field
              id={`reset-${member.userId}`}
              name="password"
              type="text"
              autoComplete="off"
              label={t("staff.resetPassword", { nom: member.name })}
              help={t("staff.resetHelp", { min: minLength })}
              required
            />
            <FormMessage status={resetState.status} message={resetState.message} />
            <SubmitButton label={t("staff.resetSubmit")} variant="secondary" />
          </form>
        </details>
      )}
    </li>
  );
}
