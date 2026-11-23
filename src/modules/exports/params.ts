// Demande d'export ↔ paramètres d'URL (lien Excel). Sans dépendance serveur : utilisé aussi par les
// boutons d'export dans le navigateur.
import type { ExportRequest } from "./lists";

const KEYS = {
  list: "liste",
  yearId: "annee",
  classId: "classe",
  status: "statut",
  from: "du",
  to: "au",
  periodKey: "periode",
} as const;

/** Lien de téléchargement Excel d'une liste. */
export function excelHref(request: ExportRequest): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(request)) {
    if (value === undefined || value === "") continue;
    params.set(KEYS[key as keyof typeof KEYS], String(value));
  }
  return `/api/v1/exports?${params.toString()}`;
}

/** Inverse de `excelHref` : objet à valider par le schéma des demandes. */
export function exportRequestFromParams(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, name] of Object.entries(KEYS)) {
    const value = params.get(name);
    if (value) out[key] = value;
  }
  return out;
}
