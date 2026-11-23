import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DownloadPdfButton } from "@/components/download-pdf-button";
import { t } from "@/i18n";
import { formatDay } from "@/lib/dates";
import { formatXAF } from "@/lib/money";
import {
  getChildAccount,
  getChildAttendance,
  getChildBulletins,
  getChildSummary,
  type ChildAccount,
  type ChildAttendance,
  type ChildBulletins,
} from "@/modules/parents/child";
import { requireAction } from "@/server/auth/session";

export const metadata: Metadata = { title: t("parent.loginTitle") };

type Props = Pick<PageProps<"/parent/enfant/[enrollmentId]">, "params">;

/**
 * Page d'un enfant pour son parent (4b) : une seule page, légère, lisible sur un petit téléphone.
 * L'essentiel en haut (reste à payer, bulletins, absences), le détail en dessous.
 */
export default function ChildPage({ params }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 p-4">
      <Link href="/parent" className="text-blue-800 underline">
        {t("parent.backToChildren")}
      </Link>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content params={params} />
      </Suspense>
    </main>
  );
}

async function Content({ params }: Props) {
  const { principal } = await requireAction("parent:view");
  const { enrollmentId } = await params;
  const child = await getChildSummary(principal, enrollmentId);
  // Enfant d'une autre école (ou d'un autre parent) : retour à la liste, qui sait basculer la session.
  if (!child) redirect("/parent");
  const [account, bulletins, attendance] = await Promise.all([
    getChildAccount(principal, enrollmentId),
    getChildBulletins(principal, enrollmentId),
    getChildAttendance(principal, enrollmentId),
  ]);
  return (
    <>
      <section className="flex flex-col gap-1 rounded-lg bg-blue-50 p-4">
        <h1 className="text-2xl font-semibold">
          {child.lastName} {child.firstNames}
        </h1>
        <p>
          {t("parent.childLine", {
            classe: child.className ?? t("parent.noClass"),
            ecole: child.schoolName,
          })}
        </p>
        <p className="text-sm text-zinc-600">
          {child.yearLabel} · {child.matricule}
        </p>
      </section>
      <Fees account={account} />
      <Bulletins data={bulletins} />
      <Absences data={attendance} />
    </>
  );
}

function Fees({ account }: { account: ChildAccount }) {
  const receipts = account.payments.filter((p) => p.kind === "payment");
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">{t("parentSpace.feesTitle")}</h2>
      <div
        className={`rounded-lg p-4 ${account.remaining === 0 ? "bg-green-50" : account.overdue > 0 ? "bg-red-50" : "bg-amber-50"}`}
      >
        {account.remaining === 0 ? (
          <p className="text-lg font-semibold text-green-900">{t("parentSpace.allPaid")}</p>
        ) : (
          <>
            <p>{t("parentSpace.remaining")}</p>
            <p className="text-2xl font-bold">{formatXAF(account.remaining)}</p>
            {account.overdue > 0 && (
              <p className="font-semibold text-red-800">
                {t("parentSpace.overdue", { montant: formatXAF(account.overdue) })}
              </p>
            )}
          </>
        )}
      </div>
      {account.invoices.length > 0 && (
        <details className="rounded-lg border border-zinc-300">
          <summary className="flex min-h-12 cursor-pointer items-center px-4 font-medium">
            {t("parentSpace.installments", { n: account.invoices.length })}
          </summary>
          <ul className="divide-y divide-zinc-200 border-t border-zinc-200">
            {account.invoices.map((i) => (
              <li key={i.id} className="flex flex-col px-4 py-2">
                <span className="font-medium">
                  {i.installmentCount > 1
                    ? t("parentSpace.installmentLabel", {
                        frais: i.feeName,
                        n: i.installmentNumber,
                        total: i.installmentCount,
                      })
                    : i.feeName}
                </span>
                <span className="text-sm text-zinc-700">
                  {t("parentSpace.installmentLine", {
                    date: formatDay(i.dueDate),
                    montant: formatXAF(i.due),
                  })}
                </span>
                <span
                  className={`text-sm font-medium ${i.remaining === 0 ? "text-green-800" : "text-red-800"}`}
                >
                  {i.remaining === 0
                    ? t("parentSpace.paid")
                    : t("parentSpace.toPay", { montant: formatXAF(i.remaining) })}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {receipts.length > 0 && (
        <details className="rounded-lg border border-zinc-300">
          <summary className="flex min-h-12 cursor-pointer items-center px-4 font-medium">
            {t("parentSpace.receipts", { n: receipts.length })}
          </summary>
          <ul className="flex flex-col gap-3 border-t border-zinc-200 p-4">
            {receipts.map((p) => (
              <li key={p.id} className="flex flex-col gap-2">
                <span>
                  {t("parentSpace.receiptLine", {
                    numero: p.receiptNumber ?? "",
                    date: formatDay(p.paidAt.toISOString().slice(0, 10)),
                    montant: formatXAF(p.amount),
                  })}
                  {p.reversed && (
                    <span className="text-red-800"> {t("parentSpace.cancelled")}</span>
                  )}
                </span>
                <DownloadPdfButton
                  request={{ kind: "receipt", paymentId: p.id, format: "A5" }}
                  label={t("parentSpace.downloadReceipt")}
                  variant="secondary"
                />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Bulletins({ data }: { data: ChildBulletins }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">{t("parentSpace.bulletinsTitle")}</h2>
      {data.blocked ? (
        <p className="rounded-lg bg-amber-50 p-4">{t("parentSpace.bulletinsBlocked")}</p>
      ) : data.bulletins.length === 0 ? (
        <p className="text-zinc-700">{t("parentSpace.noBulletin")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.bulletins.map((b) => (
            <li
              key={b.reportCardId}
              className="flex flex-col gap-2 rounded-lg border border-zinc-300 p-4"
            >
              <span className="font-medium">
                {t("parentSpace.bulletinOf", { periode: b.label })}
              </span>
              <DownloadPdfButton
                request={{ kind: "bulletin", reportCardId: b.reportCardId }}
                label={t("parentSpace.downloadBulletin")}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Absences({ data }: { data: ChildAttendance }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">{t("parentSpace.absencesTitle")}</h2>
      <p>
        {t("parentSpace.absencesSummary", {
          absences: data.absences,
          nonjustifiees: data.unjustified,
          retards: data.lates,
        })}
      </p>
      {data.unjustified > 0 && (
        <p className="text-sm text-red-800">{t("parentSpace.justifyHint")}</p>
      )}
      {data.recent.length > 0 && (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-300">
          {data.recent.map((r, i) => (
            <li key={`${r.date}-${i}`} className="flex flex-col px-4 py-2 text-sm">
              <span className="font-medium">
                {formatDay(r.date)} — {r.slotLabel} :{" "}
                {t(r.status === "absent" ? "parentSpace.absent" : "parentSpace.late")}
              </span>
              <span className={r.justified ? "text-green-800" : "text-red-800"}>
                {r.justified
                  ? t("parentSpace.justified", { motif: r.reason ?? "" })
                  : t("parentSpace.notJustified")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
