"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { t } from "@/i18n";
import { formatTime } from "@/lib/dates";
import { login } from "@/server/auth/core";
import { setSessionCookie } from "@/server/auth/session";

export type LoginState = {
  error: string | null;
  values: { schoolCode: string; identifier: string };
};

const LoginSchema = z.object({
  schoolCode: z.string().trim().max(50),
  identifier: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(200),
});

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const raw = {
    schoolCode: String(formData.get("schoolCode") ?? ""),
    identifier: String(formData.get("identifier") ?? ""),
    password: String(formData.get("password") ?? ""),
  };
  const values = { schoolCode: raw.schoolCode, identifier: raw.identifier };
  const parsed = LoginSchema.safeParse(raw);
  if (!parsed.success) return { error: t("login.missingFields"), values };

  const result = await login(parsed.data);
  if (!result.ok) {
    const error =
      result.reason === "locked"
        ? t("login.locked", { heure: formatTime(result.lockedUntil) })
        : t("login.invalid");
    return { error, values };
  }
  await setSessionCookie(result.token, result.expiresAt);
  // Nouvelle session : les pages gardées en cache par le navigateur ne sont plus valables.
  revalidatePath("/", "layout");
  redirect("/accueil");
}
