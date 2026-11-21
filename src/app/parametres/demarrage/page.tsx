import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { t } from "@/i18n";
import { getSetupStatus, SETUP_LINKS } from "@/modules/settings/setup-status";
import { requireAction } from "@/server/auth/session";

export const metadata: Metadata = { title: t("setup.title") };

export default function SetupPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/accueil" className="text-blue-800 underline">
        {t("nav.home")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("setup.title")}</h1>
      <p>{t("setup.intro")}</p>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const { principal } = await requireAction("settings:read");
  const status = await getSetupStatus(principal);
  const doneCount = status.steps.filter((s) => s.done).length;
  return (
    <>
      <p className="font-medium">
        {t("setup.progress", { faites: doneCount, total: status.steps.length })}
      </p>
      {status.next ? (
        <Link
          href={SETUP_LINKS[status.next]}
          className="flex h-12 items-center justify-center rounded-md bg-blue-700 px-4 font-semibold text-white"
        >
          {t("setup.continue", { etape: t(`setup.steps.${status.next}`) })}
        </Link>
      ) : (
        <p role="status" className="rounded-md bg-green-50 p-3 text-green-900">
          {t("setup.allDone")}
        </p>
      )}
      <ol className="flex flex-col gap-2">
        {status.steps.map(({ step, done }, i) => (
          <li key={step}>
            <Link
              href={SETUP_LINKS[step]}
              className="flex items-center justify-between gap-3 rounded-md border border-zinc-300 p-3"
            >
              <span>
                {i + 1}. {t(`setup.steps.${step}`)}
              </span>
              <span
                className={`shrink-0 rounded px-2 py-0.5 text-sm font-medium ${
                  done ? "bg-green-100 text-green-900" : "bg-amber-100 text-amber-900"
                }`}
              >
                {done ? t("setup.done") : t("setup.todo")}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}
