import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { t } from "@/i18n";
import { getChildSummary } from "@/modules/parents/child";
import { requireAction } from "@/server/auth/session";

export const metadata: Metadata = { title: t("parent.loginTitle") };

type Props = Pick<PageProps<"/parent/enfant/[enrollmentId]">, "params">;

export default function ChildPage({ params }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 p-5">
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
  return (
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
  );
}
