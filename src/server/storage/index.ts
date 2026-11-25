// Stockage des fichiers (logo, cachet, signature, photos et pièces des élèves) derrière une interface
// interne. Production (décision D30, mise en service Sc) : disque du serveur, dans un volume Docker
// partagé par l'app et le worker, sauvegardé chaque nuit avec la base (Sd).
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface FileStorage {
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** Renvoie null si le fichier n'existe pas. */
  get(key: string): Promise<Uint8Array | null>;
  /** Sans effet si le fichier n'existe pas. */
  delete(key: string): Promise<void>;
}

/** Une clé est un chemin relatif simple (ex. « schools/<uuid>/logo-<uuid>.webp »), jamais « .. ». */
export function assertValidKey(key: string): void {
  if (
    !/^[a-z0-9][a-z0-9/_.-]*$/i.test(key) ||
    key.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new Error(`Clé de fichier invalide : ${key}`);
  }
}

/** Fichiers en cours d'écriture : jamais renvoyés comme des fichiers stockés. */
const TEMP_MARKER = ".tmp-";
/** Fichier de test d'écriture (démarrage, route de santé). */
const PROBE_FILE = ".probe";

export type StoredFile = { key: string; modifiedAt: Date };

export class LocalDiskStorage implements FileStorage {
  // Champ déclaré à part (pas de « private readonly » dans le constructeur) : ce fichier est aussi
  // chargé directement par Node, sans compilation (scripts/storage-check.mts).
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  private resolve(key: string): string {
    assertValidKey(key);
    return path.join(this.root, ...key.split("/"));
  }

  /**
   * Écriture atomique : fichier temporaire puis renommage. Une coupure (courant, redémarrage) en
   * pleine écriture ne laisse jamais un fichier tronqué sous la clé. Lisible du seul compte de l'app.
   */
  async put(key: string, bytes: Uint8Array): Promise<void> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}${TEMP_MARKER}${randomUUID()}`;
    try {
      await writeFile(temp, bytes, { mode: 0o600, flush: true });
      await rename(temp, file);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.resolve(key)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  /** Tous les fichiers stockés (vérification du stockage, après une restauration). */
  async list(): Promise<StoredFile[]> {
    let entries;
    try {
      entries = await readdir(this.root, { recursive: true, withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const files: StoredFile[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = path.join(entry.parentPath, entry.name);
      const key = path.relative(this.root, full).split(path.sep).join("/");
      if (key === PROBE_FILE || entry.name.startsWith(".")) continue;
      // Écriture interrompue : reste visible comme orphelin, pour être nettoyée.
      const { mtime } = await stat(full);
      files.push({ key, modifiedAt: mtime });
    }
    return files.sort((a, b) => a.key.localeCompare(b.key));
  }

  /** Vérifie que le dossier existe et accepte l'écriture (sinon : erreur explicite). */
  async probe(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const file = path.join(this.root, PROBE_FILE);
    await writeFile(file, new Date().toISOString(), { mode: 0o600 });
    await rm(file, { force: true });
  }
}

/** Dossier de stockage : STORAGE_DIR (par défaut « ./storage », hors Git). */
export function storageRoot(env: Record<string, string | undefined> = process.env): string {
  // Dossier choisi à l'exécution : rien à embarquer dans le build (commentaire pour Turbopack).
  return path.resolve(/*turbopackIgnore: true*/ env.STORAGE_DIR ?? "storage");
}

let storage: FileStorage | undefined;

/** Stockage de l'application. */
export function getStorage(): FileStorage {
  storage ??= new LocalDiskStorage(storageRoot());
  return storage;
}

/** Réservé aux tests : remplace le stockage de l'application. */
export function setStorageForTests(value: FileStorage | undefined): void {
  storage = value;
}

/** Au démarrage, en production : arrête le processus si le dossier de stockage n'est pas inscriptible. */
export async function enforceWritableStorage(service: string): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;
  const root = storageRoot();
  try {
    await new LocalDiskStorage(root).probe();
  } catch (error) {
    console.error(
      `[${service}] démarrage refusé, dossier de stockage inaccessible en écriture (${root}) : ` +
        (error as Error).message,
    );
    process.exit(1);
  }
}
