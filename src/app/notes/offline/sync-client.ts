"use client";

// Envoi des saisies du téléphone : un seul envoi à la fois par onglet ; une demande pendant un envoi
// en relance un autre juste après (pour ne rien laisser de côté).
import { offlineDb, type Owner } from "@/lib/offline/db";
import { syncPending, type SyncApi, type SyncOutcome } from "@/lib/offline/sync";
import { syncCreateAssessment, syncSaveGrades } from "../sync-actions";

const api: SyncApi = {
  createAssessment: (op) => syncCreateAssessment(op),
  saveGrades: (assessmentId, entries) => syncSaveGrades(assessmentId, entries),
};

export type SyncState = { running: boolean; last: SyncOutcome | null };

let state: SyncState = { running: false, last: null };
let current: Promise<SyncOutcome> | null = null;
let again = false;
const listeners = new Set<() => void>();

function setState(next: SyncState) {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getSyncState = () => state;
const serverState: SyncState = { running: false, last: null };
export const getServerSyncState = () => serverState;

/** Lance l'envoi (ou en programme un autre juste après celui en cours). */
export function requestSync(owner: Owner): Promise<SyncOutcome> {
  if (current) {
    again = true;
    return current;
  }
  setState({ ...state, running: true });
  current = (async () => {
    let outcome: SyncOutcome;
    do {
      again = false;
      outcome = await syncPending(offlineDb(), owner, api).catch((): SyncOutcome => ({
        status: "offline",
        sent: 0,
      }));
    } while (again && outcome.status === "done");
    return outcome;
  })();
  return current
    .finally(() => {
      current = null;
    })
    .then((outcome) => {
      setState({ running: false, last: outcome });
      return outcome;
    });
}

const OWNER_KEY = "gs-notes-owner";

/** Compte de la dernière page ouverte avec du réseau (utilisé par la page hors connexion). */
export function rememberOwner(owner: Owner) {
  try {
    localStorage.setItem(OWNER_KEY, owner);
  } catch {
    // Stockage indisponible (navigation privée) : la page hors connexion le signalera.
  }
}

export function rememberedOwner(): Owner | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

export function forgetOwner() {
  try {
    localStorage.removeItem(OWNER_KEY);
  } catch {
    // rien à faire
  }
}
