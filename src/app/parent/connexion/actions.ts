"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { t } from "@/i18n";
import { formatTime } from "@/lib/dates";
import { requestParentCode, verifyParentCode } from "@/server/auth/parent";
import { setSessionCookie } from "@/server/auth/session";

export type ParentLoginState = {
  step: "phone" | "code";
  phone: string;
  message: string | null;
  error: string | null;
};

export async function requestCodeAction(
  _prev: ParentLoginState,
  formData: FormData,
): Promise<ParentLoginState> {
  const phone = String(formData.get("telephone") ?? "").slice(0, 30);
  const result = await requestParentCode(phone);
  if (!result.ok) {
    return {
      step: "phone",
      phone,
      message: null,
      error: t(result.reason === "phone" ? "parent.phoneInvalid" : "parent.sendingFailed"),
    };
  }
  return { step: "code", phone, message: t("parent.codeSent"), error: null };
}

export async function verifyCodeAction(
  _prev: ParentLoginState,
  formData: FormData,
): Promise<ParentLoginState> {
  const phone = String(formData.get("telephone") ?? "").slice(0, 30);
  const code = String(formData.get("code") ?? "").slice(0, 12);
  const result = await verifyParentCode(phone, code);
  if (!result.ok) {
    return {
      step: "code",
      phone,
      message: null,
      error:
        result.reason === "locked"
          ? t("parent.locked", { heure: formatTime(result.lockedUntil) })
          : t("parent.codeInvalid"),
    };
  }
  await setSessionCookie(result.token, result.expiresAt);
  revalidatePath("/", "layout");
  redirect("/parent");
}
