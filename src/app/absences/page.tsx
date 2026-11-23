import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import { formatDateTime, formatDay, todayInBrazzaville } from "@/lib/dates";
import { listAbsenceDays } from "@/modules/attendance/justify";
import { listRollClasses } from "@/modules/attendance/roll";
import { requireAction } from "@/server/auth/session";
import { JustifyForm } from "./justify-form";

export const metadata: Metadata = { title: t("absences.title") };

type Props = Pick<PageProps<"/absences">, "searchParams">;

export default function AbsencesPage({ searchParams }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/accueil" className="text-blue-800 underline">
        {t("nav.home")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("absences.title")}</h1>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
/** « 2026-11-23 », 14 → « 2026-11-09 ». */
const daysBefore = (day: string, n: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const isDate = (value: string | undefined): value is string =>
  value !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(value);

async function Content({ searchParams }: Props) {
  const { principal } = await requireAction("attendance:justify");
  const query = await searchParams;
  const today = todayInBrazzaville();
  const twoWeeksAgo = daysBefore(today, 14);
  const from = isDate(first(query.du)) ? (first(query.du) as string) : twoWeeksAgo;
  const to = isDate(first(query.au)) ? (first(query.au) as string) : today;
  const classId = first(query.classe) ?? "";
  const includeJustified = first(query.toutes) === "1";
  const [days, classes] = await Promise.all([
    listAbsenceDays(principal, { from, to, classId, includeJustified }),
    listRollClasses(principal),
  ]);

  return (
    <>
      <p>{t("absences.intro")}</p>
      <form method="get" className="flex flex-col gap-3 rounded-md bg-zinc-100 p-4">
        <div className="flex gap-3">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="abs-from" className="font-medium">
              {t("absences.from")}
            </label>
            <input
              id="abs-from"
              name="du"
              type="date"
              defaultValue={from}
              className={`${inputClass} bg-white`}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="abs-to" className="font-medium">
              {t("absences.to")}
            </label>
            <input
              id="abs-to"
              name="au"
              type="date"
              defaultValue={to}
              className={`${inputClass} bg-white`}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="abs-class" className="font-medium">
            {t("absences.class")}
          </label>
          <select
            id="abs-class"
            name="classe"
            defaultValue={classId}
            className={`${inputClass} bg-white`}
          >
            <option value="">{t("absences.allClasses")}</option>
            {classes.map((c) => (
              <option key={c.classId} value={c.classId}>
                {c.className}
              </option>
            ))}
          </select>
        </div>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            name="toutes"
            value="1"
            defaultChecked={includeJustified}
            className="size-5"
          />
          {t("absences.includeJustified")}
        </label>
        <button
          type="submit"
          className="h-12 rounded-md border border-zinc-400 bg-white px-4 font-medium"
        >
          {t("absences.show")}
        </button>
      </form>

      {days.length === 0 ? (
        <p>{t("absences.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {days.map((d) => {
            const open = d.marks.some((m) => !m.justified);
            return (
              <li
                key={`${d.enrollmentId}-${d.date}`}
                className="flex flex-col gap-2 rounded-md border border-zinc-300 p-3"
              >
                <div>
                  <p className="font-medium">
                    {d.lastName} {d.firstNames}
                    {d.className && <span className="text-zinc-600"> — {d.className}</span>}
                  </p>
                  <p className="text-sm">{formatDay(d.date)}</p>
                </div>
                <ul className="text-sm">
                  {d.marks.map((m) => (
                    <li key={m.id}>
                      {m.slotLabel} :{" "}
                      {t(m.status === "absent" ? "absences.absent" : "absences.late")}
                      {m.justified && (
                        <span className="text-green-800">
                          {" "}
                          ({t("absences.justifiedMark", { motif: m.reason ?? "" })})
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-zinc-600">
                  {d.smsSentAt
                    ? t("absences.smsSent", { date: formatDateTime(d.smsSentAt) })
                    : t("absences.noSms")}
                </p>
                {open && (
                  <details>
                    <summary className="flex min-h-11 cursor-pointer items-center font-medium text-blue-800">
                      {t("absences.justify")}
                    </summary>
                    <div className="mt-2">
                      <JustifyForm enrollmentId={d.enrollmentId} date={d.date} />
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
