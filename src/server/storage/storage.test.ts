import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compareStorage } from "./check";
import { assertValidKey, LocalDiskStorage, storageRoot } from "./index";

let root: string;
let storage: LocalDiskStorage;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "gs-storage-"));
  storage = new LocalDiskStorage(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("Stockage local", () => {
  it("enregistre, relit et supprime un fichier", async () => {
    await storage.put("schools/a/logo-1.png", new Uint8Array([1, 2, 3]));
    expect(await storage.get("schools/a/logo-1.png")).toEqual(new Uint8Array([1, 2, 3]));
    await storage.delete("schools/a/logo-1.png");
    expect(await storage.get("schools/a/logo-1.png")).toBeNull();
    await expect(storage.delete("schools/a/logo-1.png")).resolves.toBeUndefined();
  });

  it("refuse toute clé qui sortirait du dossier de stockage", () => {
    const invalid = ["../secret", "schools/../../etc/passwd", "/etc/passwd", "a//b", "C:\\x", ""];
    for (const key of invalid) {
      expect(() => assertValidKey(key), key).toThrow();
    }
    expect(() => assertValidKey("schools/0f1e/logo-9a.webp")).not.toThrow();
  });
});

describe("Stockage local en production (Sc)", () => {
  it("n'écrase jamais un fichier par une version tronquée : écriture puis renommage", async () => {
    await storage.put("schools/b/photo.webp", new Uint8Array([1]));
    await storage.put("schools/b/photo.webp", new Uint8Array([2, 2]));
    expect(await storage.get("schools/b/photo.webp")).toEqual(new Uint8Array([2, 2]));
    // Aucun fichier temporaire ne reste après l'écriture.
    expect(await readdir(path.join(root, "schools", "b"))).toEqual(["photo.webp"]);
  });

  it.skipIf(process.platform === "win32")(
    "fichiers lisibles du seul compte de l'application",
    async () => {
      await storage.put("schools/c/doc.webp", new Uint8Array([1]));
      expect((await stat(path.join(root, "schools", "c", "doc.webp"))).mode & 0o777).toBe(0o600);
      expect((await stat(path.join(root, "schools", "c"))).mode & 0o777).toBe(0o700);
    },
  );

  it("liste les fichiers stockés, sans le fichier de test d'écriture", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gs-list-"));
    const local = new LocalDiskStorage(dir);
    expect(await local.list()).toEqual([]);
    await local.put("schools/x/logo.png", new Uint8Array([1]));
    await local.put("schools/x/students/y/photo.webp", new Uint8Array([1]));
    await local.probe();
    expect((await local.list()).map((f) => f.key)).toEqual([
      "schools/x/logo.png",
      "schools/x/students/y/photo.webp",
    ]);
    expect(await new LocalDiskStorage(path.join(dir, "absent")).list()).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });

  it("le test d'écriture échoue si le dossier n'est pas utilisable", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gs-probe-"));
    await new LocalDiskStorage(path.join(dir, "ok")).probe();
    // Un fichier à la place du dossier : comme un volume mal monté.
    await writeFile(path.join(dir, "fichier"), "x");
    await expect(new LocalDiskStorage(path.join(dir, "fichier")).probe()).rejects.toThrow();
    await rm(dir, { recursive: true, force: true });
  });

  it("dossier : STORAGE_DIR, sinon « storage » dans le dossier courant", () => {
    expect(storageRoot({ STORAGE_DIR: path.resolve("/srv/fichiers") })).toBe(
      path.resolve("/srv/fichiers"),
    );
    expect(storageRoot({})).toBe(path.resolve("storage"));
  });

  it("un orphelin interrompu en pleine écriture est repéré par la vérification", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gs-tmp-"));
    await mkdir(path.join(dir, "schools"), { recursive: true });
    const temp = path.join(dir, "schools", "logo.png.tmp-1234");
    await writeFile(temp, "x");
    const old = new Date(Date.now() - 48 * 3600 * 1000);
    await utimes(temp, old, old);
    const report = compareStorage([], await new LocalDiskStorage(dir).list());
    expect(report.orphans).toEqual(["schools/logo.png.tmp-1234"]);
    await rm(dir, { recursive: true, force: true });
  });
});
