import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { t } from "@/i18n";
import { getYear, listYears } from "@/modules/settings/years";
import { can } from "@/server/auth/permissions";
import { requireAction } from "@/server/auth/session";
import { YearStatusBadge } from "../year-badge";
import { ActivateYearForm, DeleteYearForm, EditYearForm, PeriodsForm } from "../year-forms";

export const metadata: Metadata = { title: t("years.title") };

export default function YearPage({ params, searchParams }: PageProps<"/parametres/annees/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/parametres/annees" className="text-blue-800 underline">
        {t("years.back")}
      </Link>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Content({
  params,
  searchParams,
}: Pick<PageProps<"/parametres/annees/[id]">, "params" | "searchParams">) {
  const { principal } = await requireAction("settings:read");
  const { id } = await params;
  const query = await searchParams;
  const isNew = query.nouvelle === "1";
  const justActivated = query.activee === "1";
  const year = await getYear(principal, id);
  const canEdit = can(principal, "settings:write");
  const readOnly = !canEdit || year.status === "archived";
  const current = (await listYears(principal)).find((y) => y.status === "active");

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{t("years.yearTitle", { nom: year.label })}</h1>
        <YearStatusBadge status={year.status} />
      </div>
      {isNew && (
        <p role="status" className="rounded-md bg-green-50 p-3 text-green-900">
          {t("years.created", { nom: year.label })}
        </p>
      )}
      {justActivated && year.status === "active" && (
        <p role="status" className="rounded-md bg-green-50 p-3 text-green-900">
          {t("years.activated", { nom: year.label })}
        </p>
      )}
      {year.status === "archived" && (
        <p className="rounded-md bg-zinc-100 p-3">{t("years.archivedNotice")}</p>
      )}

      <h2 className="text-xl font-semibold">{t("years.periodsTitle")}</h2>
      {!readOnly && <p>{t("years.periodsHelp")}</p>}
      <PeriodsForm year={year} readOnly={readOnly} />

      <h2 className="text-xl font-semibold">{t("years.editTitle")}</h2>
      <EditYearForm year={year} readOnly={readOnly} />

      {canEdit && year.status === "upcoming" && (
        <>
          <ActivateYearForm year={year} currentLabel={current?.label ?? null} />
          <DeleteYearForm year={year} />
        </>
      )}
    </>
  );
}
