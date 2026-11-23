import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/i18n";
import { OfflineApp } from "./offline-app";

export const metadata: Metadata = { title: t("offline.title") };

/**
 * Saisie des notes sans réseau (3c). Page statique, gardée sur le téléphone par le service worker et
 * ouverte à sa place quand une page ne peut pas se charger : elle ne lit que les données du téléphone.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <nav className="flex flex-wrap gap-4">
        <Link href="/accueil" className="text-blue-800 underline">
          {t("nav.home")}
        </Link>
        <Link href="/notes" className="text-blue-800 underline">
          {t("offline.onlineNotes")}
        </Link>
      </nav>
      <h1 className="text-2xl font-semibold">{t("offline.title")}</h1>
      <OfflineApp />
    </main>
  );
}
