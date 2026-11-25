// Vérification du stockage (mise en service, Sc) : fichiers référencés par la base mais absents du
// disque (perte, restauration incomplète), et fichiers que plus rien ne référence (orphelins : envoi
// interrompu, suppression ratée). Utilisée par « pnpm storage:check ».
import type { StoredFile } from "./index.ts";

/**
 * Un orphelin récent peut être un envoi en cours (fichier écrit, base pas encore à jour) : on ne
 * propose de supprimer que les orphelins de plus de 24 h.
 */
export const ORPHAN_MIN_AGE_HOURS = 24;

/** Colonnes de la base qui désignent un fichier stocké (à compléter si une colonne est ajoutée). */
export const FILE_KEY_QUERY = `
  select logo_key as key from schools where logo_key is not null
  union all select stamp_key from schools where stamp_key is not null
  union all select signature_key from schools where signature_key is not null
  union all select photo_key from students where photo_key is not null
  union all select file_key from student_documents
`;

export type StorageReport = {
  /** Référencés par la base, absents du disque. */
  missing: string[];
  /** Sur le disque, référencés par rien, de plus de 24 h (suppression possible). */
  orphans: string[];
  /** Orphelins de moins de 24 h (peut-être un envoi en cours : on n'y touche pas). */
  recentOrphans: string[];
  /** Nombre de fichiers référencés et présents. */
  ok: number;
};

export function compareStorage(
  referenced: Iterable<string>,
  files: StoredFile[],
  now: Date = new Date(),
): StorageReport {
  const refs = new Set(referenced);
  const onDisk = new Set(files.map((f) => f.key));
  const minAge = ORPHAN_MIN_AGE_HOURS * 3600 * 1000;
  const report: StorageReport = { missing: [], orphans: [], recentOrphans: [], ok: 0 };
  for (const key of [...refs].sort()) {
    if (onDisk.has(key)) report.ok++;
    else report.missing.push(key);
  }
  for (const file of files) {
    if (refs.has(file.key)) continue;
    if (now.getTime() - file.modifiedAt.getTime() >= minAge) report.orphans.push(file.key);
    else report.recentOrphans.push(file.key);
  }
  return report;
}
