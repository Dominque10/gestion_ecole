import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { t } from "@/i18n";
import { listSubjects } from "@/modules/settings/levels";
import { can } from "@/server/auth/permissions";
import { requireAction } from "@/server/auth/session";
import { CreateSubjectForm, SubjectItem } from "./subject-forms";

export const metadata: Metadata = { title: t("subjects.title") };

export default function SubjectsPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/accueil" className="text-blue-800 underline">
        {t("nav.home")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("subjects.title")}</h1>
      <p>{t("subjects.intro")}</p>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const { principal } = await requireAction("settings:read");
  const subjects = await listSubjects(principal);
  const canEdit = can(principal, "settings:write");
  return (
    <>
      {subjects.length === 0 ? (
        <p>{t("subjects.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-300 px-4">
          {subjects.map((subject) =>
            canEdit ? (
              <SubjectItem key={subject.id} id={subject.id} name={subject.name} />
            ) : (
              <li key={subject.id} className="py-3">
                {subject.name}
              </li>
            ),
          )}
        </ul>
      )}
      {canEdit && (
        <>
          <h2 className="text-xl font-semibold">{t("subjects.addTitle")}</h2>
          <CreateSubjectForm />
        </>
      )}
    </>
  );
}
