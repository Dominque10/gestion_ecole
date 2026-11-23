"use client";

import { t } from "@/i18n";
import { offlineDb } from "@/lib/offline/db";
import { clearCopies } from "@/lib/offline/store";
import { forgetOwner, rememberedOwner } from "@/app/notes/offline/sync-client";
import { logoutAction } from "./actions";

/**
 * Déconnexion : efface d'abord du téléphone les copies de ce compte (noms d'élèves, notes), en gardant
 * les saisies pas encore envoyées (hypothèse H83).
 */
export function LogoutButton() {
  return (
    <form
      action={async () => {
        const owner = rememberedOwner();
        if (owner) {
          await clearCopies(offlineDb(), owner).catch(() => undefined);
          forgetOwner();
        }
        await logoutAction();
      }}
    >
      <button type="submit" className="h-12 rounded-md border border-zinc-400 px-4 font-medium">
        {t("session.logout")}
      </button>
    </form>
  );
}
