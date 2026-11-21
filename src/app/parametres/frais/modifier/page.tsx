import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { t } from "@/i18n";
import { defaultDueDates, listFees } from "@/modules/settings/fees";
import { listLevels } from "@/modules/settings/levels";
import { requireAction } from "@/server/auth/session";
import { FeeForm } from "../fee-forms";

export const metadata: Metadata = { title: t("fees.title") };

type Props = Pick<PageProps<"/parametres/frais/modifier">, "searchParams">;

export default function EditFeePage({ searchParams }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

async function Content({ searchParams }: Props) {
  const { principal } = await requireAction("settings:write");
  const query = await searchParams;
  const yearId = first(query.annee);
  const levelId = first(query.niveau);
  const name = first(query.nom);
  const [fees, levels, dueDates] = await Promise.all([
    listFees(principal, yearId),
    listLevels(principal),
    defaultDueDates(principal, yearId),
  ]);
  const fee = fees.find((f) => f.levelId === levelId && f.name === name);
  const level = levels.find((l) => l.id === levelId);
  if (!fee || !level) notFound();

  return (
    <>
      <Link href={`/parametres/frais?annee=${yearId}`} className="text-blue-800 underline">
        {t("fees.back")}
      </Link>
      <h1 className="text-2xl font-semibold">
        {t("fees.editTitle", { nom: fee.name, niveau: level.name })}
      </h1>
      <FeeForm
        yearId={yearId}
        levels={[]}
        dueDates={dueDates}
        fixedLevel={{ id: level.id, name: level.name }}
        originalName={fee.name}
        initial={{
          name: fee.name,
          kind: fee.kind,
          mandatory: fee.mandatory,
          installments: fee.installments,
        }}
      />
    </>
  );
}
