import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { t } from "@/i18n";
import { listSchools } from "@/modules/settings/schools";
import { PASSWORD_MIN_LENGTH } from "@/server/auth/password";
import { requireAction } from "@/server/auth/session";
import { CreateSchoolForm } from "./create-school-form";

export const metadata: Metadata = { title: t("platform.title") };

export default function SchoolsPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/accueil" className="text-blue-800 underline">
        {t("nav.home")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("platform.title")}</h1>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const { principal } = await requireAction("school:create");
  const schools = await listSchools(principal);
  return (
    <>
      {schools.length === 0 ? (
        <p>{t("platform.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-300">
          {schools.map((s) => (
            <li key={s.id} className="flex flex-col p-3">
              <span className="font-medium">{s.name}</span>
              <span className="text-sm text-zinc-600">
                {s.code} · {s.matriculePrefix}
                {s.status === "suspended" && ` · ${t("platform.suspended")}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <h2 className="text-xl font-semibold">{t("platform.createTitle")}</h2>
      <CreateSchoolForm minLength={PASSWORD_MIN_LENGTH} />
    </>
  );
}
