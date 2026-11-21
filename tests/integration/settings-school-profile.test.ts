// M1 — fiche de l'école : coordonnées, logo, cachet, signature.
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type MembershipRole, type Principal } from "@/server/auth/permissions";
import { closeDb } from "@/server/db/client";
import { LocalDiskStorage, setStorageForTests } from "@/server/storage";
import { SettingsError } from "@/modules/settings/errors";
import {
  getSchoolProfile,
  readSchoolImage,
  removeSchoolImage,
  setSchoolImage,
  updateSchoolProfile,
} from "@/modules/settings/school-profile";
import { adminQuery, createSchoolWithDirector, createSuperadmin, resetDatabase } from "./helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6]);

type School = { schoolId: string; directorId: string };
let root: string;
let a: School;
let b: School;
const as = (school: School, ...roles: MembershipRole[]): Principal => ({
  userId: school.directorId,
  schoolId: school.schoolId,
  roles,
  isSuperadmin: false,
});

async function storedFiles(): Promise<string[]> {
  return readdir(path.join(root, "schools", a.schoolId)).catch(() => []);
}

async function expectSettingsError(promise: Promise<unknown>, code: SettingsError["code"]) {
  await expect(promise).rejects.toSatisfy(
    (e: unknown) => e instanceof SettingsError && e.code === code,
  );
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "gs-profile-"));
  setStorageForTests(new LocalDiskStorage(root));
  await resetDatabase();
  const superadminId = await createSuperadmin();
  a = await createSchoolWithDirector(superadminId, "fichea");
  b = await createSchoolWithDirector(superadminId, "ficheb");
});

afterAll(async () => {
  setStorageForTests(undefined);
  await rm(root, { recursive: true, force: true });
  await closeDb();
});

describe("Fiche de l'école : coordonnées", () => {
  it("le directeur modifie nom, adresse et téléphone (normalisé), avec trace", async () => {
    await updateSchoolProfile(as(a, "director"), {
      name: "  Collège La Fontaine ",
      address: " 12 avenue de la Paix, Brazzaville ",
      phone: "06 123 45 67",
    });
    expect(await getSchoolProfile(as(a, "director"))).toMatchObject({
      name: "Collège La Fontaine",
      code: "fichea",
      matriculePrefix: "FICHEA",
      address: "12 avenue de la Paix, Brazzaville",
      phone: "+242061234567",
    });
    const { rows } = await adminQuery("select action from audit_logs where school_id = $1", [
      a.schoolId,
    ]);
    expect(rows).toEqual([{ action: "school.profile" }]);
  });

  it("une adresse ou un téléphone vide efface la valeur", async () => {
    await updateSchoolProfile(as(a, "director"), {
      name: "Collège La Fontaine",
      address: " ",
      phone: "",
    });
    expect(await getSchoolProfile(as(a, "director"))).toMatchObject({
      address: null,
      phone: null,
    });
  });

  it("refuse un nom vide ou un téléphone invalide", async () => {
    const director = as(a, "director");
    await expect(
      updateSchoolProfile(director, { name: "", address: "", phone: "" }),
    ).rejects.toThrow();
    await expect(
      updateSchoolProfile(director, { name: "Nom", address: "", phone: "123" }),
    ).rejects.toThrow();
  });

  it("seul le directeur modifie ; le Support lit seulement ; les autres rôles ni l'un ni l'autre", async () => {
    await expect(getSchoolProfile(as(a, "support"))).resolves.toMatchObject({ code: "fichea" });
    for (const role of ["secretary", "accountant", "teacher", "parent", "support"] as const) {
      await expect(
        updateSchoolProfile(as(a, role), { name: "Piratée", address: "", phone: "" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(getSchoolProfile(as(a, "teacher"))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("chaque école ne voit et ne modifie que sa propre fiche", async () => {
    await updateSchoolProfile(as(b, "director"), { name: "École B", address: "", phone: "" });
    expect((await getSchoolProfile(as(a, "director"))).name).toBe("Collège La Fontaine");
    expect((await getSchoolProfile(as(b, "director"))).name).toBe("École B");
  });
});

describe("Fiche de l'école : logo, cachet, signature", () => {
  it("enregistre une image, la relit, et la remplace en supprimant l'ancien fichier", async () => {
    await setSchoolImage(as(a, "director"), "logo", PNG);
    const first = (await getSchoolProfile(as(a, "director"))).images.logo;
    expect(first).toMatch(new RegExp(`^schools/${a.schoolId}/logo-[0-9a-f-]+\\.png$`));
    expect(await readSchoolImage(as(a, "teacher"), "logo")).toEqual({
      bytes: PNG,
      type: "image/png",
    });

    await setSchoolImage(as(a, "director"), "logo", JPEG);
    const second = (await getSchoolProfile(as(a, "director"))).images.logo;
    expect(second).toMatch(/\.jpg$/);
    expect(await storedFiles()).toEqual([path.basename(second as string)]);
  });

  it("refuse un fichier qui n'est pas une image, vide ou trop lourd", async () => {
    const director = as(a, "director");
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    await expectSettingsError(setSchoolImage(director, "stamp", svg), "imageType");
    await expectSettingsError(setSchoolImage(director, "stamp", new Uint8Array()), "imageMissing");
    const big = new Uint8Array(500 * 1024 + 1);
    big.set(PNG);
    await expectSettingsError(setSchoolImage(director, "stamp", big), "imageTooLarge");
    expect((await getSchoolProfile(director)).images.stamp).toBeNull();
  });

  it("le cachet et la signature ne sont visibles que de la direction (et du Support)", async () => {
    await setSchoolImage(as(a, "director"), "stamp", PNG);
    await setSchoolImage(as(a, "director"), "signature", PNG);
    for (const kind of ["stamp", "signature"] as const) {
      expect(await readSchoolImage(as(a, "director"), kind)).not.toBeNull();
      expect(await readSchoolImage(as(a, "support"), kind)).not.toBeNull();
      for (const role of ["secretary", "accountant", "teacher", "parent"] as const) {
        expect(await readSchoolImage(as(a, role), kind)).toBeNull();
      }
    }
    expect(await readSchoolImage(as(a), "logo")).toBeNull();
  });

  it("une école ne lit jamais les images d'une autre", async () => {
    expect(await readSchoolImage(as(b, "director"), "logo")).toBeNull();
    expect(await readSchoolImage(as(b, "director"), "stamp")).toBeNull();
  });

  it("retire une image (fichier supprimé), chaque changement est tracé", async () => {
    await removeSchoolImage(as(a, "director"), "signature");
    expect((await getSchoolProfile(as(a, "director"))).images.signature).toBeNull();
    expect((await storedFiles()).some((f) => f.startsWith("signature-"))).toBe(false);
    await expect(removeSchoolImage(as(a, "director"), "signature")).resolves.toBeUndefined();
    const { rows } = await adminQuery<{ n: number }>(
      "select count(*)::int as n from audit_logs where school_id = $1 and action = 'school.image'",
      [a.schoolId],
    );
    expect(rows[0].n).toBe(5);
  });

  it("seul le directeur envoie ou retire une image", async () => {
    for (const role of ["secretary", "accountant", "teacher", "parent", "support"] as const) {
      await expect(setSchoolImage(as(a, role), "logo", PNG)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(removeSchoolImage(as(a, role), "logo")).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});
