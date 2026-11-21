import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DownloadPdfButton } from "@/components/download-pdf-button";
import { t } from "@/i18n";
import { visibleClasses } from "@/modules/students/enrollments";
import { can } from "@/server/auth/permissions";
import { requireAction } from "@/server/auth/session";

export const metadata: Metadata = { title: t("lists.title") };

export default function ListsPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/accueil" className="text-blue-800 underline">
        {t("nav.home")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("lists.title")}</h1>
      <p>{t("lists.intro")}</p>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const { principal } = await requireAction("students:read");
  const classes = await visibleClasses(principal);
  const canCards = can(principal, "students:write");
  if (classes.length === 0) return <p>{t("lists.empty")}</p>;
  return (
    <ul className="flex flex-col gap-3">
      {classes.map((c) => (
        <li key={c.id} className="flex flex-col gap-3 rounded-md border border-zinc-300 p-4">
          <div>
            <h2 className="text-lg font-semibold">{c.name}</h2>
            <p className="text-sm text-zinc-600">
              {t("lists.line", { annee: c.yearLabel, niveau: c.levelName, n: c.count })}
            </p>
          </div>
          <DownloadPdfButton
            request={{ kind: "class_list", classId: c.id }}
            label={t("documents.classList")}
          />
          {canCards && (
            <DownloadPdfButton
              request={{ kind: "student_cards", classId: c.id }}
              label={t("documents.studentCards")}
              variant="secondary"
            />
          )}
        </li>
      ))}
    </ul>
  );
}
