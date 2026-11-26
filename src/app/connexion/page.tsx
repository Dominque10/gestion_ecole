import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { t } from "@/i18n";
import { DEMO_PARENT, DEMO_PASSWORD, DEMO_SCHOOL, DEMO_STAFF } from "@/modules/demo/accounts";
import { isDemoSite } from "@/server/env";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: t("login.title") };

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">{t("login.title")}</h1>
      <Suspense fallback={null}>
        <DemoAccounts />
      </Suspense>
      <LoginForm />
      <Link
        href="/parent/connexion"
        className="flex min-h-12 items-center justify-center rounded-md border-2 border-blue-700 px-4 font-semibold text-blue-800"
      >
        {t("parent.staffLink")}
      </Link>
    </main>
  );
}

/** Site de démonstration seulement (DEMO_SITE=true) : comptes partagés de l'école fictive. */
async function DemoAccounts() {
  await connection();
  if (!isDemoSite()) return null;
  return (
    <section
      aria-labelledby="demo-accounts"
      className="flex flex-col gap-2 rounded-md border-2 border-amber-400 bg-amber-50 p-4 text-sm"
    >
      <h2 id="demo-accounts" className="text-base font-semibold">
        {t("demo.accountsTitle")}
      </h2>
      <p>{t("demo.accountsIntro", { code: DEMO_SCHOOL.code, password: DEMO_PASSWORD })}</p>
      <ul className="flex flex-col gap-1">
        {DEMO_STAFF.map((s) => (
          <li key={s.role}>
            <span className="font-medium">{t(`demo.roles.${s.role}`)}</span> : {s.identifier}
          </li>
        ))}
      </ul>
      <p>{t("demo.parentAccount", { phone: DEMO_PARENT.phone })}</p>
    </section>
  );
}
