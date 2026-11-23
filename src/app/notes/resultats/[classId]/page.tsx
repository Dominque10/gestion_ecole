import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import { formatDateTime } from "@/lib/dates";
import type { Stats } from "@/modules/grading/averages";
import { GradingError } from "@/modules/grading/errors";
import {
  getAnnualResults,
  getClassResults,
  type AnnualResults,
  type ClassResults,
} from "@/modules/grading/results";
import { can, type Principal } from "@/server/auth/permissions";
import { requireAction } from "@/server/auth/session";
import { refusalMessage } from "@/server/forms";
import { ClosePeriodForm, ReopenPeriodForm } from "../closure-forms";

export const metadata: Metadata = { title: t("results.title") };

type Props = Pick<PageProps<"/notes/resultats/[classId]">, "params" | "searchParams">;

const ANNUAL = "annee";

export default function ClassResultsPage({ params, searchParams }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/notes/resultats" className="text-blue-800 underline">
        {t("results.backToClasses")}
      </Link>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/** 12,7 → « 12,70 » ; null → « — ». */
const num = (value: number | null) => (value === null ? "—" : value.toFixed(2).replace(".", ","));
const rankText = (rank: number | null, tied: boolean) =>
  rank === null
    ? t("results.unranked")
    : t(tied ? "results.rankTied" : "results.rank", { n: rank, suffixe: rank === 1 ? "er" : "e" });

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

async function Content({ params, searchParams }: Props) {
  const { principal } = await requireAction("grades:write");
  const { classId } = await params;
  const choice = first((await searchParams).periode);
  let data: { annual: AnnualResults } | { period: ClassResults };
  try {
    data =
      choice === ANNUAL
        ? { annual: await getAnnualResults(principal, classId) }
        : { period: await getClassResults(principal, classId, choice) };
  } catch (error) {
    if (error instanceof GradingError) return <p role="alert">{refusalMessage(error)}</p>;
    throw error;
  }
  if ("annual" in data) {
    return (
      <>
        <Header
          classId={classId}
          className={data.annual.className}
          periods={data.annual.periods}
          choice={ANNUAL}
        />
        <AnnualView results={data.annual} />
      </>
    );
  }
  const results = data.period;
  return (
    <>
      <Header
        classId={classId}
        className={results.className}
        periods={results.periods}
        choice={results.period.id}
      />
      <ClosureBox results={results} principal={principal} />
      <PeriodView results={results} />
    </>
  );
}

function Header({
  classId,
  className,
  periods,
  choice,
}: {
  classId: string;
  className: string;
  periods: { id: string; label: string }[];
  choice: string;
}) {
  return (
    <>
      <h1 className="text-2xl font-semibold">{t("results.classTitle", { classe: className })}</h1>
      <form method="get" action={`/notes/resultats/${classId}`} className="flex items-end gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="results-period" className="font-medium">
            {t("grading.period")}
          </label>
          <select
            id="results-period"
            name="periode"
            defaultValue={choice}
            className={`${inputClass} bg-white`}
          >
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            <option value={ANNUAL}>{t("results.annual")}</option>
          </select>
        </div>
        <button type="submit" className="h-12 rounded-md border border-zinc-400 px-4 font-medium">
          {t("grading.showPeriod")}
        </button>
      </form>
    </>
  );
}

function ClosureBox({ results, principal }: { results: ClassResults; principal: Principal }) {
  const { closure, period } = results;
  const writable = results.yearStatus !== "archived";
  const formProps = {
    classId: results.classId,
    periodId: period.id,
    className: results.className,
    periodLabel: period.label,
  };
  return (
    <section
      className={`flex flex-col gap-3 rounded-md p-4 ${
        closure.state === "closed" ? "bg-zinc-100" : "border border-zinc-300"
      }`}
    >
      <h2 className="text-lg font-semibold">{t("results.closureTitle")}</h2>
      <p>
        {closure.state === "closed"
          ? t("results.stateClosed", {
              date: formatDateTime(closure.closedAt as Date),
              nom: closure.closedByName ?? "",
            })
          : closure.state === "reopened"
            ? t("results.stateReopened", {
                date: formatDateTime(closure.reopenedAt as Date),
                motif: closure.reopenReason ?? "",
              })
            : t("results.stateOpen")}
      </p>
      {writable && closure.state !== "closed" && can(principal, "periods:close") && (
        <ClosePeriodForm {...formProps} />
      )}
      {writable && closure.state === "closed" && can(principal, "grades:unlock") && (
        <ReopenPeriodForm {...formProps} />
      )}
    </section>
  );
}

function StatsLine({ stats }: { stats: Stats }) {
  return (
    <p className="rounded-md bg-blue-50 p-3">
      {t("results.classStats", {
        moyenne: num(stats.average),
        haut: num(stats.highest),
        bas: num(stats.lowest),
      })}
    </p>
  );
}

function PeriodView({ results }: { results: ClassResults }) {
  if (results.students.length === 0) return <p>{t("grading.noStudents")}</p>;
  const ordered = [...results.students].sort(
    (x, y) => (x.rank ?? Infinity) - (y.rank ?? Infinity) || x.lastName.localeCompare(y.lastName),
  );
  return (
    <>
      <StatsLine stats={results.classStats} />
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("results.studentsTitle")}</h2>
        <ol className="flex flex-col gap-2">
          {ordered.map((s) => (
            <li key={s.enrollmentId} className="rounded-md border border-zinc-300">
              <details>
                <summary className="flex min-h-12 cursor-pointer flex-wrap items-center gap-x-3 px-3 py-2">
                  <span className="w-24 text-sm text-zinc-600">{rankText(s.rank, s.tied)}</span>
                  <span className="flex-1 font-medium">
                    {s.lastName} {s.firstNames}
                  </span>
                  <span className="font-semibold">{num(s.average)}</span>
                  {s.mention && <span className="w-full text-sm text-blue-800">{s.mention}</span>}
                </summary>
                <table className="w-full border-t border-zinc-200 text-sm">
                  <thead>
                    <tr className="text-left text-zinc-600">
                      <th className="px-3 py-1 font-medium">{t("results.subject")}</th>
                      <th className="px-1 py-1 text-right font-medium">{t("results.average")}</th>
                      <th className="px-1 py-1 text-right font-medium">{t("results.coef")}</th>
                      <th className="px-3 py-1 text-right font-medium">{t("results.points")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.subjects.map((subject, i) => (
                      <tr key={subject.subjectId} className="border-t border-zinc-100">
                        <td className="px-3 py-1">
                          {subject.name}
                          {subject.optional && (
                            <span className="text-zinc-600"> {t("results.optional")}</span>
                          )}
                        </td>
                        <td className="px-1 py-1 text-right">
                          {s.subjects[i].average === null
                            ? t("results.notGraded")
                            : num(s.subjects[i].average)}
                        </td>
                        <td className="px-1 py-1 text-right">{subject.coefficient}</td>
                        <td className="px-3 py-1 text-right">{num(s.subjects[i].points)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-zinc-300 font-medium">
                      <td className="px-3 py-1">{t("results.total")}</td>
                      <td />
                      <td className="px-1 py-1 text-right">{s.totalCoefficients}</td>
                      <td className="px-3 py-1 text-right">{num(s.totalPoints)}</td>
                    </tr>
                  </tbody>
                </table>
              </details>
            </li>
          ))}
        </ol>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("results.subjectsTitle")}</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-600">
              <th className="py-1 font-medium">{t("results.subject")}</th>
              <th className="py-1 text-right font-medium">{t("results.classAverage")}</th>
              <th className="py-1 text-right font-medium">{t("results.highest")}</th>
              <th className="py-1 text-right font-medium">{t("results.lowest")}</th>
            </tr>
          </thead>
          <tbody>
            {results.subjects.map((subject, i) => (
              <tr key={subject.subjectId} className="border-t border-zinc-200">
                <td className="py-1">{subject.name}</td>
                <td className="py-1 text-right">{num(results.subjectStats[i].average)}</td>
                <td className="py-1 text-right">{num(results.subjectStats[i].highest)}</td>
                <td className="py-1 text-right">{num(results.subjectStats[i].lowest)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function AnnualView({ results }: { results: AnnualResults }) {
  if (results.students.length === 0) return <p>{t("grading.noStudents")}</p>;
  const ordered = [...results.students].sort(
    (x, y) => (x.rank ?? Infinity) - (y.rank ?? Infinity) || x.lastName.localeCompare(y.lastName),
  );
  return (
    <>
      <p className="text-sm text-zinc-600">{t("results.annualHelp")}</p>
      <StatsLine stats={results.classStats} />
      <ol className="flex flex-col gap-2">
        {ordered.map((s) => (
          <li
            key={s.enrollmentId}
            className="flex flex-col gap-1 rounded-md border border-zinc-300 px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-x-3">
              <span className="w-24 text-sm text-zinc-600">{rankText(s.rank, s.tied)}</span>
              <span className="flex-1 font-medium">
                {s.lastName} {s.firstNames}
              </span>
              <span className="font-semibold">{num(s.average)}</span>
            </div>
            <p className="text-sm text-zinc-600">
              {results.periods.map((p, i) => `${p.label} : ${num(s.periods[i])}`).join(" · ")}
            </p>
            {s.mention && <p className="text-sm text-blue-800">{s.mention}</p>}
          </li>
        ))}
      </ol>
    </>
  );
}
