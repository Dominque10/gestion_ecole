import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { t } from "@/i18n";
import { formatDateTime } from "@/lib/dates";
import { listAnnouncements } from "@/modules/announcements/announcements";
import { listRollClasses } from "@/modules/attendance/roll";
import { listLevels } from "@/modules/settings/levels";
import { can } from "@/server/auth/permissions";
import { requireAction } from "@/server/auth/session";
import { AnnouncementForm } from "./announcement-form";

export const metadata: Metadata = { title: t("announcements.title") };

export default function AnnouncementsPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/accueil" className="text-blue-800 underline">
        {t("nav.home")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("announcements.title")}</h1>
      <p>{t("announcements.intro")}</p>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const { principal } = await requireAction("announcements:send");
  const [list, levels, classes] = await Promise.all([
    listAnnouncements(principal),
    // Le secrétariat ne lit pas le paramétrage : la liste des niveaux vient des classes de l'année.
    can(principal, "settings:read") ? listLevels(principal) : Promise.resolve([]),
    listRollClasses(principal),
  ]);
  const levelOptions =
    levels.length > 0
      ? levels.map((l) => ({ id: l.id, name: l.name }))
      : [
          ...new Map(
            classes.map((c) => [c.levelId, { id: c.levelId, name: c.levelName }]),
          ).values(),
        ];
  return (
    <>
      <AnnouncementForm
        levels={levelOptions}
        classes={classes.map((c) => ({ id: c.classId, name: c.className }))}
      />
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("announcements.listTitle")}</h2>
        {list.length === 0 ? (
          <p>{t("announcements.none")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((a) => (
              <li key={a.id} className="flex flex-col gap-1 rounded-md border border-zinc-300 p-3">
                <span className="font-semibold">{a.title}</span>
                <span>{a.body}</span>
                <span className="text-sm text-zinc-600">
                  {formatDateTime(a.createdAt)} · {a.authorName} ·{" "}
                  {a.audience === "school"
                    ? t("announcements.audiences.school")
                    : (a.audienceName ?? "")}
                  {" · "}
                  {a.sendMessage
                    ? t("announcements.messages", { n: a.messageCount })
                    : t("announcements.noMessages")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
