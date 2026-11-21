import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertValidKey, LocalDiskStorage } from "./index";

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
