import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { t } from "@/i18n";
import { listRollClasses } from "@/modules/attendance/roll";
import { requireAction } from "@/server/auth/session";

export const metadata: Metadata = { title: t("attendance.title") };

export default function RollCallPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/accueil" className="text-blue-800 underline">
        {t("nav.home")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("attendance.title")}</h1>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const { principal } = await requireAction("attendance:write");
  const list = await listRollClasses(principal);
  if (list.length === 0) return <p>{t("attendance.noClass")}</p>;
  return (
    <>
      <p>{t("attendance.intro")}</p>
      <Link href="/notes/hors-ligne" className="text-blue-800 underline">
        {t("offline.title")}
      </Link>
      <ul className="flex flex-col gap-2">
        {list.map((c) => (
          <li key={c.classId}>
            <Link
              href={`/appel/${c.classId}`}
              className="flex min-h-12 items-center rounded-md border border-zinc-400 px-4 font-medium"
            >
              {c.className}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
