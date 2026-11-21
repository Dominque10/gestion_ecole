import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import { defaultYear, listYears } from "@/modules/settings/years";
import {
  countEnrollments,
  listEnrollments,
  type EnrollmentFilter,
} from "@/modules/students/enrollments";
import { can } from "@/server/auth/permissions";
import { requireAction } from "@/server/auth/session";

export const metadata: Metadata = { title: t("enrollments.listTitle") };

type Props = Pick<PageProps<"/inscriptions">, "searchParams">;

const TABS = ["pre_enrolled", "withoutClass", "enrolled", "left"] as const;
type Tab = (typeof TABS)[number];

const FILTERS: Record<Tab, EnrollmentFilter> = {
  pre_enrolled: { status: "pre_enrolled" },
  withoutClass: { status: "enrolled", withoutClass: true },
  enrolled: { status: "enrolled" },
  left: { status: "left" },
};

export default function EnrollmentsPage({ searchParams }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/accueil" className="text-blue-800 underline">
        {t("nav.home")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("enrollments.listTitle")}</h1>
      <p>{t("enrollments.listIntro")}</p>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Content({ searchParams }: Props) {
  const { principal } = await requireAction("students:read");
  const query = await searchParams;
  const years = await listYears(principal);
  if (years.length === 0) return <p>{t("enrollments.noYear")}</p>;
  const year = years.find((y) => y.id === first(query.annee)) ?? defaultYear(years)!;
  const wantedTab = first(query.liste);
  const tab: Tab = (TABS as readonly string[]).includes(wantedTab ?? "")
    ? (wantedTab as Tab)
    : "pre_enrolled";
  const [counts, rows] = await Promise.all([
    countEnrollments(principal, year.id),
    listEnrollments(principal, year.id, FILTERS[tab]),
  ]);

  return (
    <>
      <form method="get" className="flex flex-col gap-3 rounded-md bg-zinc-100 p-4">
        <label htmlFor="enrollments-year" className="font-medium">
          {t("enrollments.year")}
        </label>
        <select
          id="enrollments-year"
          name="annee"
          defaultValue={year.id}
          className={`${inputClass} bg-white`}
        >
          {years.map((y) => (
            <option key={y.id} value={y.id}>
              {y.label} ({t(`years.status.${y.status}`)})
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-12 rounded-md border border-zinc-400 bg-white font-medium"
        >
          {t("enrollments.show")}
        </button>
      </form>

      {can(principal, "students:write") && year.status !== "archived" && (
        <Link
          href={`/inscriptions/reinscription?annee=${year.id}`}
          className="flex h-12 items-center justify-center rounded-md border border-zinc-400 px-4 font-medium"
        >
          {t("enrollments.reEnrollLink")}
        </Link>
      )}

      <nav aria-label={t("enrollments.listTitle")} className="grid grid-cols-2 gap-2">
        {TABS.map((key) => (
          <Link
            key={key}
            href={`/inscriptions?annee=${year.id}&liste=${key}`}
            aria-current={key === tab ? "page" : undefined}
            className={`flex min-h-12 items-center justify-center rounded-md border px-2 text-center text-sm font-medium ${
              key === tab ? "border-blue-700 bg-blue-700 text-white" : "border-zinc-400"
            }`}
          >
            {t(`enrollments.tabs.${key}`, { n: counts[key] })}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p>{t("enrollments.emptyTab")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-300">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/eleves/${r.studentId}`} className="flex flex-col gap-0.5 p-3">
                <span className="font-medium">
                  {r.lastName} {r.firstNames}
                </span>
                <span className="text-sm text-zinc-600">
                  {r.matricule} · {r.levelName}
                  {r.className && ` · ${r.className}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
