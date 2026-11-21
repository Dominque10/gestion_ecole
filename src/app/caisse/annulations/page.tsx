import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { t } from "@/i18n";
import { formatDateTime } from "@/lib/dates";
import { formatXAF } from "@/lib/money";
import { listPendingCancellations } from "@/modules/finance/payments";
import { requireAction } from "@/server/auth/session";
import { DecideCancellationForm } from "../cash-forms";

export const metadata: Metadata = { title: t("nav.cancellations") };

type Props = Pick<PageProps<"/caisse/annulations">, "searchParams">;

export default function CancellationsPage({ searchParams }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/accueil" className="text-blue-800 underline">
        {t("nav.home")}
      </Link>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Content({ searchParams }: Props) {
  const { principal } = await requireAction("payments:cancel:approve");
  const decision = (await searchParams).decision;
  const pending = await listPendingCancellations(principal);
  return (
    <>
      <h1 className="text-2xl font-semibold">{t("cash.pendingTitle", { n: pending.length })}</h1>
      {(decision === "validee" || decision === "refusee") && (
        <p role="status" className="rounded-md bg-green-50 p-3 text-green-900">
          {decision === "validee" ? t("cash.approved") : t("cash.rejected")}
        </p>
      )}
      {pending.length === 0 ? (
        <p>{t("enrollments.emptyTab")}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {pending.map((p) => (
            <li key={p.id} className="flex flex-col gap-3 rounded-md border border-zinc-300 p-4">
              <p className="font-semibold">
                {t("cash.pendingLine", {
                  numero: p.receiptNumber,
                  montant: formatXAF(p.amount),
                  eleve: p.studentName,
                })}
              </p>
              <p className="text-sm">
                {t("cash.pendingReason", {
                  motif: p.reason,
                  nom: p.requestedByName,
                  date: formatDateTime(p.requestedAt),
                })}
              </p>
              <Link href={`/caisse/recus/${p.paymentId}`} className="text-blue-800 underline">
                {t("finance.seeReceipt")}
              </Link>
              <DecideCancellationForm cancellationId={p.id} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
