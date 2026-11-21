import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { t } from "@/i18n";
import { CYCLES } from "@/modules/settings/defaults";
import { listLevels } from "@/modules/settings/levels";
import { can } from "@/server/auth/permissions";
import { requireAction } from "@/server/auth/session";
import { AddDefaultLevelsButton, CreateLevelForm, LevelItem } from "./level-forms";

export const metadata: Metadata = { title: t("levels.title") };

export default function LevelsPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/accueil" className="text-blue-800 underline">
        {t("nav.home")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("levels.title")}</h1>
      <p>{t("levels.intro")}</p>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const { principal } = await requireAction("settings:read");
  const levels = await listLevels(principal);
  const canEdit = can(principal, "settings:write");
  return (
    <>
      {levels.length === 0 && <p>{t("levels.empty")}</p>}
      {CYCLES.map((cycle) => {
        const inCycle = levels.filter((l) => l.cycle === cycle);
        if (inCycle.length === 0 && !canEdit) return null;
        return (
          <section
            key={cycle}
            className="flex flex-col gap-3 rounded-md border border-zinc-300 p-4"
          >
            <h2 className="text-lg font-semibold">{t(`cycles.${cycle}`)}</h2>
            {inCycle.length > 0 && (
              <ul className="flex flex-col divide-y divide-zinc-200">
                {inCycle.map((level) =>
                  canEdit ? (
                    <LevelItem key={level.id} id={level.id} name={level.name} />
                  ) : (
                    <li key={level.id} className="py-2">
                      {level.name}
                    </li>
                  ),
                )}
              </ul>
            )}
            {canEdit && <AddDefaultLevelsButton cycle={cycle} />}
          </section>
        );
      })}
      {canEdit && (
        <>
          <h2 className="text-xl font-semibold">{t("levels.addTitle")}</h2>
          <CreateLevelForm />
        </>
      )}
    </>
  );
}
