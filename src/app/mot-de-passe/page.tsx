import type { Metadata } from "next";
import { Suspense } from "react";
import { t } from "@/i18n";
import { PASSWORD_MIN_LENGTH } from "@/server/auth/password";
import { requireSession } from "@/server/auth/session";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: t("passwordChange.title") };

export default function PasswordPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">{t("passwordChange.title")}</h1>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  await requireSession({ allowPasswordChange: true });
  return (
    <>
      <p>{t("passwordChange.intro")}</p>
      <PasswordForm minLength={PASSWORD_MIN_LENGTH} />
    </>
  );
}
