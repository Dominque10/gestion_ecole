import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { t } from "@/i18n";
import { canImportValidated, importYears } from "@/modules/students/import";
import { requireAction } from "@/server/auth/session";
import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: t("studentImport.title") };

export default function ImportPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/eleves" className="text-blue-800 underline">
        {t("students.back")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("studentImport.title")}</h1>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const { principal } = await requireAction("students:write");
  const years = await importYears(principal);
  if (years.length === 0) return <p>{t("studentImport.noYear")}</p>;
  const workYear = years.find((y) => y.status === "active") ?? years[0];
  return (
    <>
      <ol className="flex list-decimal flex-col gap-2 pl-6">
        <li>{t("studentImport.step1")}</li>
        <li>{t("studentImport.step2")}</li>
        <li>{t("studentImport.step3")}</li>
      </ol>
      <div className="flex flex-col gap-2 rounded-md bg-zinc-100 p-4">
        <a
          href={`/api/v1/students/import-template?format=xlsx${workYear ? `&annee=${workYear.id}` : ""}`}
          className="flex h-12 items-center justify-center rounded-md bg-white font-medium underline"
        >
          {t("studentImport.templateXlsx")}
        </a>
        <a
          href={`/api/v1/students/import-template?format=csv${workYear ? `&annee=${workYear.id}` : ""}`}
          className="flex h-12 items-center justify-center rounded-md bg-white font-medium underline"
        >
          {t("studentImport.templateCsv")}
        </a>
      </div>
      <ImportForm
        years={years.map((y) => ({ id: y.id, label: y.label }))}
        canValidate={canImportValidated(principal)}
      />
    </>
  );
}
