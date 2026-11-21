import type { Metadata } from "next";
import { t } from "@/i18n";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: t("login.title") };

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">{t("login.title")}</h1>
      <LoginForm />
    </main>
  );
}
