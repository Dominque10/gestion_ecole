"use server";

import { redirect } from "next/navigation";
import { t } from "@/i18n";
import type { FormState } from "@/lib/form-state";
import { changePassword } from "@/server/auth/core";
import { PASSWORD_MIN_LENGTH } from "@/server/auth/password";
import { readSessionToken } from "@/server/auth/session";
import { readFields } from "@/server/forms";

export async function changePasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  // Pas de lecture préalable de la session : elle serait mise en cache pour la requête, et la page
  // affichée après la redirection croirait le mot de passe encore provisoire. changePassword vérifie
  // lui-même le jeton de session.
  const f = readFields(formData, ["current", "new", "confirm"]);
  const fail = (field: string, message: string): FormState => ({
    status: "error",
    message,
    fieldErrors: { [field]: message },
    values: {},
  });
  if (f.new !== f.confirm) return fail("confirm", t("passwordChange.mismatch"));

  const result = await changePassword(await readSessionToken(), f.current, f.new);
  if (!result.ok) {
    switch (result.reason) {
      case "invalid-session":
        redirect("/connexion");
      case "wrong-password":
        return fail("current", t("passwordChange.wrongPassword"));
      case "too-short":
        return fail("new", t("passwordChange.tooShort", { min: PASSWORD_MIN_LENGTH }));
      case "same-password":
        return fail("new", t("passwordChange.samePassword"));
    }
  }
  // Le formulaire recharge alors entièrement l'accueil (voir password-form.tsx).
  return { status: "success", message: null, fieldErrors: {}, values: {} };
}
