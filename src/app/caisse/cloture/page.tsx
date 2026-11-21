import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import { formatDay, todayInBrazzaville } from "@/lib/dates";
import { isValidDate } from "@/modules/settings/periods-logic";
import { formatXAF } from "@/lib/money";
import { getDaySummary, listClosures } from "@/modules/finance/closures";
import { requireAction } from "@/server/auth/session";
import { CloseCashForm } from "../cash-forms";
import { ClosureDetails } from "../closure-details";

export const metadata: Metadata = { title: t("closure.title") };

type Props = Pick<PageProps<"/caisse/cloture">, "searchParams">;

export default function ClosurePage({ searchParams }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/caisse" className="text-blue-800 underline">
        {t("cash.back")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("closure.title")}</h1>
      <p>{t("closure.intro")}</p>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Content({ searchParams }: Props) {
  const { principal } = await requireAction("cash:close");
  const wanted = (await searchParams).jour;
  const today = todayInBrazzaville();
  const day = typeof wanted === "string" && isValidDate(wanted) && wanted <= today ? wanted : today;
  const [summary, history] = await Promise.all([
    getDaySummary(principal, day),
    listClosures(principal, 20),
  ]);

  return (
    <>
      <form method="get" className="flex flex-col gap-3 rounded-md bg-zinc-100 p-4">
        <label htmlFor="closure-day" className="font-medium">
          {t("closure.day")}
        </label>
        <input
          id="closure-day"
          name="jour"
          type="date"
          max={today}
          defaultValue={day}
          className={`${inputClass} bg-white`}
        />
        <button
          type="submit"
          className="h-12 rounded-md border border-zinc-400 bg-white font-medium"
        >
          {t("closure.show")}
        </button>
      </form>

      <section className="flex flex-col gap-3 rounded-md border border-zinc-300 p-4">
        <h2 className="text-lg font-semibold">
          {formatDay(day)} · {t("closure.receipts", { n: summary.receiptCount })}
        </h2>
        <h3 className="font-medium">{t("closure.byMethod")}</h3>
        <ul className="text-sm">
          {(
            [
              ["cash", summary.cashTotal],
              ["mobile_money", summary.mobileMoneyTotal],
              ["transfer", summary.transferTotal],
              ["cheque", summary.chequeTotal],
            ] as const
          ).map(([method, amount]) => (
            <li key={method} className="flex justify-between gap-2">
              <span>{t(`finance.methods.${method}`)}</span>
              <span>{formatXAF(amount)}</span>
            </li>
          ))}
        </ul>
        <p className="font-semibold">{t("closure.total", { montant: formatXAF(summary.total) })}</p>
        {summary.closure ? (
          <>
            <span className="self-start rounded bg-green-100 px-2 py-0.5 text-sm font-medium text-green-900">
              {t("closure.closedBadge")}
            </span>
            <ClosureDetails closure={summary.closure} />
          </>
        ) : (
          <>
            <p>{t("closure.expectedCash", { montant: formatXAF(summary.cashTotal) })}</p>
            <CloseCashForm day={day} />
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">{t("closure.historyTitle")}</h2>
        {history.length === 0 ? (
          <p className="text-zinc-600">{t("closure.historyEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {history.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 rounded-md border border-zinc-300 p-3">
                <p className="font-medium">
                  {formatDay(c.day)}
                  {c.status === "reopened" && ` · ${t("closure.reopenedBadge")}`}
                </p>
                <ClosureDetails closure={c} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
