import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { t } from "@/i18n";
import { formatDay, todayInBrazzaville } from "@/lib/dates";
import { proposeYear } from "@/modules/settings/periods-logic";
import { listYears } from "@/modules/settings/years";
import { can } from "@/server/auth/permissions";
import { requireAction } from "@/server/auth/session";
import { YearStatusBadge } from "./year-badge";
import { CreateYearForm } from "./year-forms";

export const metadata: Metadata = { title: t("years.title") };

export default function YearsPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/accueil" className="text-blue-800 underline">
        {t("nav.home")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("years.title")}</h1>
      <p>{t("years.intro")}</p>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const { principal } = await requireAction("settings:read");
  const years = await listYears(principal);
  const canEdit = can(principal, "settings:write");
  const proposal = proposeYear(todayInBrazzaville());
  const taken = new Set(years.map((y) => y.label));
  // Si l'année proposée existe déjà, on propose la suivante.
  const next = taken.has(proposal.label)
    ? proposeYear(`${Number(proposal.endDate.slice(0, 4))}-07-01`)
    : proposal;

  return (
    <>
      {years.length === 0 ? (
        <p>{t("years.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {years.map((year) => (
            <li key={year.id}>
              <Link
                href={`/parametres/annees/${year.id}`}
                className="flex flex-col gap-1 rounded-md border border-zinc-300 p-4"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{year.label}</span>
                  <YearStatusBadge status={year.status} />
                </span>
                <span className="text-sm text-zinc-600">
                  {formatDay(year.startDate)} → {formatDay(year.endDate)} ·{" "}
                  {t(`years.${year.periodKind}`)}
                </span>
                <span className="text-blue-800 underline">
                  {canEdit && year.status !== "archived" ? t("years.open") : t("years.view")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <>
          <h2 className="text-xl font-semibold">{t("years.createTitle")}</h2>
          <CreateYearForm proposal={{ ...next, periodKind: "trimester" }} />
        </>
      )}
    </>
  );
}
