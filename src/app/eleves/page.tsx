import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import { searchStudents } from "@/modules/students/students";
import { can } from "@/server/auth/permissions";
import { requireAction } from "@/server/auth/session";

export const metadata: Metadata = { title: t("students.title") };

type Props = Pick<PageProps<"/eleves">, "searchParams">;

export default function StudentsPage({ searchParams }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/accueil" className="text-blue-800 underline">
        {t("nav.home")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("students.title")}</h1>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Content({ searchParams }: Props) {
  const { principal } = await requireAction("students:read");
  const raw = (await searchParams).q;
  const query = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  const results = await searchStudents(principal, query);
  return (
    <>
      {can(principal, "students:write") && (
        <Link
          href="/eleves/nouveau"
          className="flex h-12 items-center justify-center rounded-md bg-blue-700 px-4 font-semibold text-white"
        >
          {t("students.new")}
        </Link>
      )}
      {/* Recherche : simple formulaire GET (fonctionne même avant le chargement du script). */}
      <form method="get" role="search" className="flex flex-col gap-2">
        <label htmlFor="student-search" className="font-medium">
          {t("students.search")}
        </label>
        <div className="flex gap-2">
          <input
            id="student-search"
            name="q"
            type="search"
            defaultValue={query}
            aria-describedby="student-search-help"
            className={inputClass}
          />
          <button
            type="submit"
            className="h-12 shrink-0 rounded-md border border-zinc-400 px-4 font-medium"
          >
            {t("students.searchSubmit")}
          </button>
        </div>
        <p id="student-search-help" className="text-sm text-zinc-600">
          {t("students.searchHelp")}
        </p>
      </form>

      <p className="text-sm font-medium" aria-live="polite">
        {query ? t("students.results", { n: results.length }) : t("students.recent")}
      </p>
      {results.length === 0 ? (
        <p>{query ? t("students.noResult") : t("students.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-300">
          {results.map((s) => (
            <li key={s.id}>
              <Link href={`/eleves/${s.id}`} className="flex flex-col gap-0.5 p-3">
                <span className="font-medium">
                  {s.lastName} {s.firstNames}
                </span>
                <span className="text-sm text-zinc-600">
                  {s.matricule}
                  {s.primaryGuardianPhone && ` · ${s.primaryGuardianPhone}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
