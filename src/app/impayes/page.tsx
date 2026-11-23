import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ExportButtons } from "@/components/export-card";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import { formatDay } from "@/lib/dates";
import { formatXAF } from "@/lib/money";
import { arrearsFilters, listArrears } from "@/modules/finance/arrears";
import { AGE_BUCKETS } from "@/modules/finance/closure-logic";
import { requireAction } from "@/server/auth/session";

export const metadata: Metadata = { title: t("arrears.title") };

type Props = Pick<PageProps<"/impayes">, "searchParams">;

export default function ArrearsPage({ searchParams }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/accueil" className="text-blue-800 underline">
        {t("nav.home")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("arrears.title")}</h1>
      <p>{t("arrears.intro")}</p>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Content({ searchParams }: Props) {
  const { principal } = await requireAction("dashboard:finance");
  const query = await searchParams;
  const initial = await arrearsFilters(principal);
  if (initial.years.length === 0) return <p>{t("arrears.noYear")}</p>;
  const year =
    initial.years.find((y) => y.id === first(query.annee)) ??
    initial.years.find((y) => y.status === "active") ??
    initial.years.find((y) => y.status === "upcoming") ??
    initial.years[0];
  const { years, classes } = await arrearsFilters(principal, year.id);
  const classId = classes.find((c) => c.id === first(query.classe))?.id;
  const rows = await listArrears(principal, { academicYearId: year.id, classId });
  const total = rows.reduce((sum, r) => sum + r.overdue, 0);

  return (
    <>
      <form method="get" className="flex flex-col gap-3 rounded-md bg-zinc-100 p-4">
        <label htmlFor="arrears-year" className="font-medium">
          {t("arrears.year")}
        </label>
        <select
          id="arrears-year"
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
        {classes.length > 0 && (
          <>
            <label htmlFor="arrears-class" className="font-medium">
              {t("arrears.class")}
            </label>
            <select
              id="arrears-class"
              name="classe"
              defaultValue={classId ?? ""}
              className={`${inputClass} bg-white`}
            >
              <option value="">{t("arrears.allClasses")}</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </>
        )}
        <button
          type="submit"
          className="h-12 rounded-md border border-zinc-400 bg-white font-medium"
        >
          {t("arrears.show")}
        </button>
      </form>

      {rows.length === 0 ? (
        <p>{t("arrears.empty")}</p>
      ) : (
        <>
          <ExportButtons request={{ list: "arrears", yearId: year.id, classId }} />
          <p className="text-lg font-semibold">
            {t("arrears.total", { montant: formatXAF(total), n: rows.length })}
          </p>
          <ul className="grid grid-cols-2 gap-2 text-sm">
            {AGE_BUCKETS.map((bucket) => {
              const inBucket = rows.filter((r) => r.bucket === bucket);
              return (
                <li key={bucket} className="rounded-md bg-zinc-100 p-2">
                  {t("arrears.bucketLine", {
                    tranche: t(`arrears.buckets.${bucket}`),
                    montant: formatXAF(inBucket.reduce((s, r) => s + r.overdue, 0)),
                    n: inBucket.length,
                  })}
                </li>
              );
            })}
          </ul>
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-300">
            {rows.map((r) => (
              <li key={r.enrollmentId} className="flex flex-col gap-1 p-3">
                <span className="flex flex-wrap justify-between gap-2">
                  <Link
                    href={`/eleves/${r.studentId}`}
                    className="font-medium text-blue-800 underline"
                  >
                    {r.studentName}
                  </Link>
                  <span className="font-semibold">{formatXAF(r.overdue)}</span>
                </span>
                <span className="text-sm text-zinc-600">
                  {t("arrears.rowLine", {
                    matricule: r.matricule,
                    classe: r.className ?? r.levelName,
                  })}
                </span>
                <span className="text-sm">
                  {t("arrears.late", { n: r.daysLate, date: formatDay(r.oldestDueDate) })}
                </span>
                {r.guardianPhone && (
                  <a href={`tel:${r.guardianPhone}`} className="text-sm text-blue-800 underline">
                    {t("arrears.call", { tel: r.guardianPhone })}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
