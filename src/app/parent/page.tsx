import type { Metadata } from "next";
import { Suspense } from "react";
import { t } from "@/i18n";
import { listChildren } from "@/server/auth/parent";
import { requireAction } from "@/server/auth/session";
import { LogoutButton } from "../accueil/logout-button";
import { openChildAction } from "./actions";

export const metadata: Metadata = { title: t("parent.childrenTitle") };

export default function ParentHomePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-5">
      <h1 className="text-2xl font-semibold">{t("parent.childrenTitle")}</h1>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const { principal } = await requireAction("parent:view");
  const children = await listChildren(principal);
  return (
    <>
      {children.length === 0 ? (
        <p>{t("parent.noChildren")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {children.map((c) => (
            <li key={c.enrollmentId}>
              <form action={openChildAction}>
                <input type="hidden" name="inscription" value={c.enrollmentId} />
                <button
                  type="submit"
                  className="flex min-h-16 w-full flex-col items-start justify-center rounded-lg border-2 border-blue-700 px-4 py-3 text-left"
                >
                  <span className="text-lg font-semibold">
                    {c.lastName} {c.firstNames}
                  </span>
                  <span className="text-sm text-zinc-700">
                    {t("parent.childLine", {
                      classe: c.className ?? t("parent.noClass"),
                      ecole: c.schoolName,
                    })}
                  </span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <LogoutButton />
    </>
  );
}
