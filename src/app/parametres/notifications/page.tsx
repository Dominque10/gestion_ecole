import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { t } from "@/i18n";
import { formatDateTime } from "@/lib/dates";
import { formatXAF } from "@/lib/money";
import { getNotificationSettings, listSentMessages } from "@/modules/notifications/settings";
import { requireAction } from "@/server/auth/session";
import { NotificationSettingsForm } from "./settings-form";

export const metadata: Metadata = { title: t("notifications.title") };

export default function NotificationsPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/accueil" className="text-blue-800 underline">
        {t("nav.home")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("notifications.title")}</h1>
      <p>{t("notifications.intro")}</p>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const { principal } = await requireAction("notifications:templates");
  const [settings, log] = await Promise.all([
    getNotificationSettings(principal),
    listSentMessages(principal),
  ]);
  return (
    <>
      <NotificationSettingsForm settings={settings} />
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("notifications.logTitle")}</h2>
        <p className="rounded-md bg-blue-50 p-3">
          {t("notifications.monthCost", { n: log.monthCount, montant: formatXAF(log.monthCost) })}
        </p>
        {log.messages.length === 0 ? (
          <p>{t("notifications.noMessage")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-300">
            {log.messages.map((m) => (
              <li key={m.id} className="flex flex-col gap-1 p-3 text-sm">
                <span className="font-medium">
                  {formatDateTime(m.createdAt)} — {t(`notifications.kinds.${m.kind}`)} —{" "}
                  {m.studentName}
                </span>
                <span className="text-zinc-700">{m.body}</span>
                <span className={m.status === "sent" ? "text-zinc-600" : "text-red-800"}>
                  {m.channel.toUpperCase()} · {m.phone} · {t(`notifications.status.${m.status}`)}
                  {m.status === "sent" ? ` · ${formatXAF(m.cost)}` : ""}
                  {m.error ? ` · ${m.error}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
