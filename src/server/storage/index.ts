// Stockage des fichiers (logo, cachet, signature…) derrière une interface interne (plan phase 1,
// hypothèse 3) : disque en local, stockage compatible S3 en production (à brancher au déploiement).
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

export class LocalDiskStorage implements FileStorage {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    assertValidKey(key);
    return path.join(this.root, ...key.split("/"));
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
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
}

let storage: FileStorage | undefined;

/** Stockage de l'application. Dossier : STORAGE_DIR (par défaut « ./storage », hors Git). */
export function getStorage(): FileStorage {
  // Dossier choisi à l'exécution : rien à embarquer dans le build (commentaire pour Turbopack).
  storage ??= new LocalDiskStorage(
    path.resolve(/*turbopackIgnore: true*/ process.env.STORAGE_DIR ?? "storage"),
  );
  return storage;
}

/** Réservé aux tests : remplace le stockage de l'application. */
export function setStorageForTests(value: FileStorage | undefined): void {
  storage = value;
}
