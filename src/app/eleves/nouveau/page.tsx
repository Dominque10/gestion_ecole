import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { t } from "@/i18n";
import { requireAction } from "@/server/auth/session";
import { CreateStudentForm } from "../student-forms";

export const metadata: Metadata = { title: t("students.newTitle") };

export default function NewStudentPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/eleves" className="text-blue-800 underline">
        {t("students.back")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("students.newTitle")}</h1>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  await requireAction("students:write");
  return <CreateStudentForm />;
}
