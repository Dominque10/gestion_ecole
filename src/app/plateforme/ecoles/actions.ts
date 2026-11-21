"use server";

import { refresh } from "next/cache";
import { t } from "@/i18n";
import type { FormState } from "@/lib/form-state";
import { createSchool } from "@/modules/settings/schools";
import { CreateSchoolSchema } from "@/modules/settings/schemas";
import { PASSWORD_MIN_LENGTH } from "@/server/auth/password";
import { requireAction } from "@/server/auth/session";
import { invalidForm, readFields, refusalMessage } from "@/server/forms";

const FIELDS = [
  "name",
  "code",
  "matriculePrefix",
  "directorName",
  "directorIdentifier",
  "directorPassword",
] as const;

export async function createSchoolAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("school:create");
  const raw = readFields(formData, FIELDS);
  // Les valeurs renvoyées au formulaire n'incluent jamais le mot de passe.
  const values: Record<string, string> = { ...raw, directorPassword: "" };

  const parsed = CreateSchoolSchema.safeParse(raw);
  if (!parsed.success) {
    return invalidForm(
      parsed.error,
      {
        name: t("platform.errors.name"),
        code: t("platform.errors.code"),
        matriculePrefix: t("platform.errors.matriculePrefix"),
        directorName: t("platform.errors.directorName"),
        directorIdentifier: t("platform.errors.directorIdentifier"),
        directorPassword: t("platform.errors.directorPassword", { min: PASSWORD_MIN_LENGTH }),
      },
      values,
    );
  }

  try {
    const created = await createSchool(principal, raw);
    refresh();
    const params = { nom: parsed.data.name, code: parsed.data.code };
    return {
      status: "success",
      message: created.existingAccount
        ? t("platform.createdExisting", params)
        : t("platform.created", params),
      fieldErrors: {},
      values: {},
    };
  } catch (error) {
    return { status: "error", message: refusalMessage(error), fieldErrors: {}, values };
  }
}
