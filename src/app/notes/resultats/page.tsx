import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { t } from "@/i18n";
import { listResultClasses } from "@/modules/grading/results";
import { requireAction } from "@/server/auth/session";

export const metadata: Metadata = { title: t("results.title") };

export default function ResultsPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/notes" className="text-blue-800 underline">
        {t("grading.backToCourses")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("results.title")}</h1>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const { principal } = await requireAction("grades:write");
  const list = await listResultClasses(principal);
  if (list.length === 0) return <p>{t("results.noClass")}</p>;
  return (
    <>
      <p>{t("results.intro")}</p>
      <ul className="flex flex-col gap-2">
        {list.map((c) => (
          <li key={c.classId}>
            <Link
              href={`/notes/resultats/${c.classId}`}
              className="flex min-h-12 items-center rounded-md border border-zinc-400 px-4 font-medium"
            >
              {c.className}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
