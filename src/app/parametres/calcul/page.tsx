import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { t } from "@/i18n";
import { getGradingRules } from "@/modules/grading/settings";
import { can } from "@/server/auth/permissions";
import { requireAction } from "@/server/auth/session";
import { GradingRulesForm } from "./rules-form";

export const metadata: Metadata = { title: t("gradingRules.title") };

export default function GradingRulesPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/accueil" className="text-blue-800 underline">
        {t("nav.home")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("gradingRules.title")}</h1>
      <p>{t("gradingRules.intro")}</p>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const { principal } = await requireAction("settings:read");
  const rules = await getGradingRules(principal);
  const readOnly = !can(principal, "settings:write");
  return (
    <>
      {readOnly && <p className="rounded-md bg-zinc-100 p-3">{t("gradingRules.readOnly")}</p>}
      <GradingRulesForm rules={rules} readOnly={readOnly} />
    </>
  );
}
