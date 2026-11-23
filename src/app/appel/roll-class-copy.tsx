"use client";

import { useEffect } from "react";
import { offlineDb, type OfflineRollClass, type Owner } from "@/lib/offline/db";
import { saveRollClassCopy } from "@/lib/offline/roll-store";
import { rememberOwner } from "@/app/notes/offline/sync-client";

/** Garde sur le téléphone la classe ouverte avec du réseau, pour faire l'appel sans réseau. */
export function RollClassCopy({
  owner,
  copy,
}: {
  owner: Owner;
  copy: Omit<OfflineRollClass, "key" | "owner" | "savedAt">;
}) {
  useEffect(() => {
    rememberOwner(owner);
    void saveRollClassCopy(offlineDb(), { ...copy, owner });
  }, [owner, copy]);
  return null;
}
