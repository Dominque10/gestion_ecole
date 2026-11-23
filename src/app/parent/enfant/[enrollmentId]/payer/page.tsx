import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { t } from "@/i18n";
import { todayInBrazzaville } from "@/lib/dates";
import { getChildAccount, getChildSummary } from "@/modules/parents/child";
import { getUserPhone } from "@/server/auth/parent";
import { requireAction } from "@/server/auth/session";
import { PayForm } from "./pay-form";

export const metadata: Metadata = { title: t("online.payTitle") };

type Props = Pick<PageProps<"/parent/enfant/[enrollmentId]/payer">, "params">;

export default function PayPage({ params }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 p-4">
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content params={params} />
      </Suspense>
    </main>
  );
}

async function Content({ params }: Props) {
  const { principal } = await requireAction("payments:pay-online");
  const { enrollmentId } = await params;
  const child = await getChildSummary(principal, enrollmentId);
  if (!child) redirect("/parent");
  const [account, phone] = await Promise.all([
    getChildAccount(principal, enrollmentId),
    getUserPhone(principal.userId),
  ]);
  const today = todayInBrazzaville();
  const lines = account.invoices
    .filter((i) => i.remaining > 0)
    .map((i) => ({
      id: i.id,
      label:
        i.installmentCount > 1
          ? t("parentSpace.installmentLabel", {
              frais: i.feeName,
              n: i.installmentNumber,
              total: i.installmentCount,
            })
          : i.feeName,
      remaining: i.remaining,
      overdue: i.dueDate < today,
    }));
  return (
    <>
      <Link href={`/parent/enfant/${enrollmentId}`} className="text-blue-800 underline">
        {t("online.backToChild")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("online.payTitle")}</h1>
      <p className="font-medium">
        {child.lastName} {child.firstNames}
      </p>
      {lines.length === 0 ? (
        <p>{t("online.nothingToPay")}</p>
      ) : (
        <>
          <p>{t("online.payIntro")}</p>
          <PayForm enrollmentId={enrollmentId} lines={lines} phone={phone ?? ""} />
        </>
      )}
    </>
  );
}
