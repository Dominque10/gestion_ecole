"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useSyncExternalStore } from "react";
import { t } from "@/i18n";
import { offlineDb, type Owner } from "@/lib/offline/db";
import { countPending } from "@/lib/offline/store";
import { getServerSyncState, getSyncState, requestSync, subscribeSync } from "./sync-client";

/** Toutes les 30 s tant qu'il reste des saisies à envoyer (hypothèse H84). */
const RETRY_MS = 30_000;

/**
 * État de l'envoi des saisies du téléphone, et déclencheur automatique : à l'ouverture de la page, au
 * retour du réseau, puis régulièrement tant qu'il reste quelque chose à envoyer.
 */
export function SyncStatus({ owner }: { owner: Owner }) {
  const sync = useSyncExternalStore(subscribeSync, getSyncState, getServerSyncState);
  const counts = useLiveQuery(() => countPending(offlineDb(), owner), [owner]);
  const waiting = (counts?.pending ?? 0) + (counts?.assessments ?? 0);

  useEffect(() => {
    void requestSync(owner);
    const onOnline = () => void requestSync(owner);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [owner]);

  useEffect(() => {
    if (waiting === 0) return;
    const timer = window.setInterval(() => void requestSync(owner), RETRY_MS);
    return () => window.clearInterval(timer);
  }, [owner, waiting]);

  if (!counts) return null;
  const conflicts = counts.conflicts + counts.errors;
  if (waiting === 0 && conflicts === 0 && sync.last?.status !== "session") return null;

  let message: string;
  if (sync.last?.status === "session") message = t("offline.status.session");
  else if (sync.running) message = t("offline.status.sending", { n: waiting });
  else if (waiting > 0 && sync.last?.status === "offline")
    message = t("offline.status.offline", { n: waiting });
  else if (waiting > 0) message = t("offline.status.waiting", { n: waiting });
  else message = t("offline.status.toCheck", { n: conflicts });

  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-md border border-amber-600 bg-amber-50 p-3"
    >
      <p>{message}</p>
      {waiting > 0 && conflicts > 0 && (
        <p className="text-sm">{t("offline.status.toCheck", { n: conflicts })}</p>
      )}
      {waiting > 0 && !sync.running && (
        <button
          type="button"
          onClick={() => void requestSync(owner)}
          className="h-11 rounded-md border border-zinc-400 bg-white px-4 font-medium"
        >
          {t("offline.sendNow")}
        </button>
      )}
    </div>
  );
}
