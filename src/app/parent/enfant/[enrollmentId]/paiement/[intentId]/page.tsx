import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DownloadPdfButton } from "@/components/download-pdf-button";
import { t } from "@/i18n";
import { formatXAF } from "@/lib/money";
import { getIntent } from "@/modules/finance/online";
import { requireAction } from "@/server/auth/session";
import { AutoRefresh } from "./auto-refresh";

export const metadata: Metadata = { title: t("online.statusTitle") };

type Props = Pick<PageProps<"/parent/enfant/[enrollmentId]/paiement/[intentId]">, "params">;

export default function PaymentStatusPage({ params }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 p-4">
      <h1 className="text-2xl font-semibold">{t("online.statusTitle")}</h1>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content params={params} />
      </Suspense>
    </main>
  );
}

async function Content({ params }: Props) {
  const { principal } = await requireAction("payments:pay-online");
  const { enrollmentId, intentId } = await params;
  const intent = await getIntent(principal, intentId);
  if (!intent || intent.enrollmentId !== enrollmentId) redirect("/parent");
  const back = (
    <Link href={`/parent/enfant/${enrollmentId}`} className="text-blue-800 underline">
      {t("online.backToChild")}
    </Link>
  );
  if (intent.status === "pending") {
    return (
      <>
        <AutoRefresh />
        <p role="status" className="rounded-lg bg-amber-50 p-4 text-lg">
          {t("online.pending", {
            montant: formatXAF(intent.amount),
            operateur: t(intent.operator === "airtel" ? "online.airtel" : "online.mtn"),
            numero: intent.phone,
          })}
        </p>
        <p className="text-sm text-zinc-600">{t("online.pendingHelp")}</p>
        {back}
      </>
    );
  }
  if (intent.status === "succeeded") {
    return (
      <>
        <p
          role="status"
          className="rounded-lg bg-green-50 p-4 text-lg font-semibold text-green-900"
        >
          {t("online.succeeded")}
        </p>
        {intent.receiptNumber && <p>{t("online.receipt", { numero: intent.receiptNumber })}</p>}
        {intent.paymentId && (
          <DownloadPdfButton
            request={{ kind: "receipt", paymentId: intent.paymentId, format: "A5" }}
            label={t("parentSpace.downloadReceipt")}
          />
        )}
        {back}
      </>
    );
  }
  return (
    <>
      <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-900">
        {intent.status === "expired"
          ? t("online.expiredTitle")
          : t("online.failed", { motif: intent.failureReason ?? "" })}
      </p>
      <Link
        href={`/parent/enfant/${enrollmentId}/payer`}
        className="flex min-h-12 items-center justify-center rounded-md bg-blue-700 px-4 font-semibold text-white"
      >
        {t("online.retry")}
      </Link>
      {back}
    </>
  );
}
