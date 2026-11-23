import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/i18n";
import { ParentLoginForm } from "./parent-login-form";

export const metadata: Metadata = { title: t("parent.loginTitle") };

export default function ParentLoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">{t("parent.loginTitle")}</h1>
      <p>{t("parent.loginIntro")}</p>
      <ParentLoginForm />
      <Link href="/connexion" className="text-center text-sm text-zinc-600 underline">
        {t("parent.staffSide")}
      </Link>
    </main>
  );
}
