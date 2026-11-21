import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { t } from "@/i18n";
import { formatDateTime } from "@/lib/dates";
import { formatXAF } from "@/lib/money";
import { getReceipt } from "@/modules/finance/payments";
import { can } from "@/server/auth/permissions";
import { requireAction } from "@/server/auth/session";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: t("receipt.title") };

type Props = Pick<PageProps<"/caisse/recus/[id]">, "params" | "searchParams">;

/** Reçu imprimable (format ticket étroit). Le PDF et le QR code arrivent en sous-étape 2f. */
export default function ReceiptPage({ params, searchParams }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-6 print:max-w-none print:p-0">
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Content({ params, searchParams }: Props) {
  const { principal } = await requireAction("students:read");
  const { id } = await params;
  const autoValidated = (await searchParams).inscription === "validee";
  const r = await getReceipt(principal, id);
  return (
    <>
      <article className="flex flex-col gap-2 rounded-md border border-zinc-400 p-4 font-mono text-sm print:border-0">
        <header className="flex flex-col items-center gap-1 text-center">
          <p className="text-base font-bold">{r.school.name}</p>
          {r.school.address && <p>{r.school.address}</p>}
          {r.school.phone && <p>{r.school.phone}</p>}
        </header>
        <hr className="border-dashed border-zinc-400" />
        <h1 className="text-center text-base font-bold">
          {t("receipt.number", { numero: r.receiptNumber })}
        </h1>
        {r.reversed && (
          <p className="text-center text-lg font-bold text-red-800">{t("receipt.cancelled")}</p>
        )}
        <p>{t("receipt.date", { date: formatDateTime(r.paidAt) })}</p>
        <p>{t("receipt.student", { nom: r.student.name, matricule: r.student.matricule })}</p>
        <p>
          {r.student.className
            ? t("receipt.classLine", { classe: r.student.className, annee: r.student.year })
            : t("receipt.levelLine", { niveau: r.student.level, annee: r.student.year })}
        </p>
        <hr className="border-dashed border-zinc-400" />
        <p className="text-base font-bold">
          {t("receipt.amount", { montant: formatXAF(r.amount) })}
        </p>
        <p>{t("receipt.method", { mode: t(`finance.methods.${r.method}`) })}</p>
        {r.reference && <p>{t("receipt.reference", { reference: r.reference })}</p>}
        <p className="font-semibold">{t("receipt.detail")}</p>
        <ul>
          {r.allocations.map((a) => (
            <li key={a.label} className="flex justify-between gap-2">
              <span>{a.label}</span>
              <span>{formatXAF(a.amount)}</span>
            </li>
          ))}
        </ul>
        <hr className="border-dashed border-zinc-400" />
        <p>{t("receipt.remaining", { montant: formatXAF(r.remainingAfter) })}</p>
        <p>{t("receipt.cashier", { nom: r.cashierName })}</p>
      </article>
      {autoValidated && (
        <p role="status" className="rounded-md bg-green-50 p-3 text-green-900 print:hidden">
          {t("receipt.autoValidated")}
        </p>
      )}
      <div className="flex flex-col gap-3 print:hidden">
        <PrintButton />
        {can(principal, "payments:collect") && (
          <Link
            href="/caisse"
            className="flex h-12 items-center justify-center rounded-md border border-zinc-400 font-medium"
          >
            {t("receipt.newPayment")}
          </Link>
        )}
      </div>
    </>
  );
}
