import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { t } from "@/i18n";
import { formatDay } from "@/lib/dates";
import { listClosures } from "@/modules/finance/closures";
import { requireAction } from "@/server/auth/session";
import { ReopenClosureForm } from "../cash-forms";
import { ClosureDetails } from "../closure-details";

export const metadata: Metadata = { title: t("closure.listTitle") };

type Props = Pick<PageProps<"/caisse/clotures">, "searchParams">;

export default function ClosuresPage({ searchParams }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/accueil" className="text-blue-800 underline">
        {t("nav.home")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("closure.listTitle")}</h1>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Content({ searchParams }: Props) {
  const { principal } = await requireAction("cash:reopen");
  const reopened = (await searchParams).rouverte === "1";
  const closures = await listClosures(principal);
  return (
    <>
      {reopened && (
        <p role="status" className="rounded-md bg-green-50 p-3 text-green-900">
          {t("closure.reopened")}
        </p>
      )}
      {closures.length === 0 ? (
        <p>{t("closure.historyEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {closures.map((c) => (
            <li key={c.id} className="flex flex-col gap-2 rounded-md border border-zinc-300 p-3">
              <p className="flex flex-wrap items-center justify-between gap-2 font-medium">
                <span>
                  {t("closure.listLine", { date: formatDay(c.day), caissier: c.cashierName })}
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-sm ${
                    c.status === "closed"
                      ? "bg-green-100 text-green-900"
                      : "bg-zinc-200 text-zinc-800"
                  }`}
                >
                  {c.status === "closed" ? t("closure.closedBadge") : t("closure.reopenedBadge")}
                </span>
              </p>
              <ClosureDetails closure={c} />
              {c.status === "closed" && <ReopenClosureForm closureId={c.id} />}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
