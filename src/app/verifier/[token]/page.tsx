import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { t } from "@/i18n";
import { formatDateTime } from "@/lib/dates";
import { formatXAF } from "@/lib/money";
import { checkReceipt } from "@/modules/documents/verification";

export const metadata: Metadata = { title: t("verify.title"), robots: { index: false } };

type Props = Pick<PageProps<"/verifier/[token]">, "params">;

/** Page publique ouverte par le QR code d'un reçu : pas de connexion, aucune donnée d'élève. */
export default function VerifyPage({ params }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">{t("verify.title")}</h1>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content params={params} />
      </Suspense>
    </main>
  );
}

async function Content({ params }: Props) {
  await connection();
  const { token } = await params;
  const receipt = await checkReceipt(token);
  if (!receipt) {
    return (
      <section className="flex flex-col gap-2 rounded-md border-2 border-red-700 p-4">
        <p className="text-xl font-bold text-red-800">{t("verify.invalid")}</p>
        <p>{t("verify.invalidHelp")}</p>
      </section>
    );
  }
  return (
    <section
      className={`flex flex-col gap-2 rounded-md border-2 p-4 ${
        receipt.reversed ? "border-red-700" : "border-green-700"
      }`}
    >
      <p className={`text-xl font-bold ${receipt.reversed ? "text-red-800" : "text-green-800"}`}>
        {receipt.reversed ? t("verify.cancelled") : t("verify.valid")}
      </p>
      {receipt.reversed && <p>{t("verify.cancelledHelp")}</p>}
      <p>{t("verify.school", { nom: receipt.schoolName })}</p>
      <p>{t("verify.number", { numero: receipt.receiptNumber })}</p>
      <p>{t("verify.date", { date: formatDateTime(receipt.paidAt) })}</p>
      <p className="font-semibold">{t("verify.amount", { montant: formatXAF(receipt.amount) })}</p>
      <p className="text-sm text-zinc-600">{t("verify.privacy")}</p>
    </section>
  );
}
