// M2 (2a) — fiche élève, matricule, responsables, données médicales, pièces jointes, recherche.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type MembershipRole, type Principal } from "@/server/auth/permissions";
import { closeDb, withSchool } from "@/server/db/client";
import { studentMedical, students } from "@/server/db/schema";
import { LocalDiskStorage, setStorageForTests } from "@/server/storage";
import { addStaff } from "@/modules/settings/staff";
import { createYear } from "@/modules/settings/years";
import { StudentError } from "@/modules/students/errors";
import {
  addStudentDocument,
  deleteStudentDocument,
  listStudentDocuments,
  readStudentDocument,
  readStudentPhoto,
  setStudentPhoto,
} from "@/modules/students/media";
import { getMedical, saveMedical } from "@/modules/students/medical";
import {
  addGuardian,
  createStudent,
  getStudent,
  removeGuardian,
  searchStudents,
  setPrimaryGuardian,
  updateGuardian,
  updateStudent,
} from "@/modules/students/students";
import { adminQuery, createSchoolWithDirector, createSuperadmin, resetDatabase } from "./helpers";

type School = { schoolId: string; directorId: string };
let a: School;
let b: School;
let secretaryId: string;
const as = (school: School, ...roles: MembershipRole[]): Principal => ({
  userId: school.directorId,
  schoolId: school.schoolId,
  roles,
  isSuperadmin: false,
});
const director = () => as(a, "director");
const secretary = (): Principal => ({
  userId: secretaryId,
  schoolId: a.schoolId,
  roles: ["secretary"],
  isSuperadmin: false,
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const identity = {
  lastName: "ngoma",
  firstNames: "bénédicte ève",
  sex: "F" as const,
  birthDate: "2014-03-12",
  birthPlace: "Brazzaville",
  nationality: "Congolaise",
  previousSchool: "",
};
const mother = {
  fullName: "Awa Ngoma",
  phone: "06 555 11 22",
  otherPhone: "",
  relationship: "Mère",
};

async function expectStudentError(promise: Promise<unknown>, code: StudentError["code"]) {
  await expect(promise).rejects.toSatisfy(
    (e: unknown) => e instanceof StudentError && e.code === code,
  );
}

let root: string;
let first: { id: string; matricule: string; existingGuardian: boolean };

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "gs-students-"));
  setStorageForTests(new LocalDiskStorage(root));
  await resetDatabase();
  const superadminId = await createSuperadmin();
  a = await createSchoolWithDirector(superadminId, "eleva");
  b = await createSchoolWithDirector(superadminId, "elevb");
  await createYear(director(), {
    label: "2026-2027",
    startDate: "2026-10-01",
    endDate: "2027-06-30",
    periodKind: "trimester",
  });
  secretaryId = (
    await addStaff(director(), {
      name: "Secrétaire",
      identifier: "05 777 00 01",
      password: "Provisoire-2026",
      roles: ["secretary"],
    })
  ).userId;
});

afterAll(async () => {
  setStorageForTests(undefined);
  await rm(root, { recursive: true, force: true });
  await closeDb();
});

describe("Fiche élève et matricule", () => {
  it("crée la fiche (noms mis en forme) avec le matricule ELEVA-26-00001 et le responsable principal", async () => {
    first = await createStudent(secretary(), { student: identity, guardian: mother });
    expect(first.matricule).toBe("ELEVA-26-00001");
    expect(first.existingGuardian).toBe(false);
    expect(await getStudent(director(), first.id)).toMatchObject({
      lastName: "NGOMA",
      firstNames: "Bénédicte Ève",
      sex: "F",
      birthDate: "2014-03-12",
      previousSchool: null,
      guardians: [
        { fullName: "Awa Ngoma", phone: "+242065551122", relationship: "Mère", isPrimary: true },
      ],
    });
  });

  it("numéros continus ; un frère retrouve le même parent par son téléphone", async () => {
    const brother = await createStudent(secretary(), {
      student: { ...identity, firstNames: "Paul", sex: "M" },
      guardian: { ...mother, fullName: "Nom saisi autrement", phone: "065551122" },
    });
    expect(brother.matricule).toBe("ELEVA-26-00002");
    expect(brother.existingGuardian).toBe(true);
    const fetched = await getStudent(director(), brother.id);
    expect(fetched.guardians[0].fullName).toBe("Awa Ngoma");
  });

  it("des créations simultanées ne donnent jamais deux fois le même numéro", async () => {
    const created = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        createStudent(secretary(), {
          student: { ...identity, firstNames: `Enfant ${i}` },
          guardian: { ...mother, phone: `06 600 00 0${i}` },
        }),
      ),
    );
    const numbers = created.map((c) => Number(c.matricule.slice(-5))).sort((x, y) => x - y);
    expect(numbers).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("le matricule ne change jamais, même si le nom est corrigé ; la fiche ne se supprime pas", async () => {
    await updateStudent(secretary(), first.id, { ...identity, lastName: "Ngoma Mabiala" });
    const updated = await getStudent(director(), first.id);
    expect([updated.lastName, updated.matricule]).toEqual(["NGOMA MABIALA", "ELEVA-26-00001"]);
    await expect(
      withSchool({ schoolId: a.schoolId, userId: a.directorId }, (tx) => tx.delete(students)),
    ).rejects.toSatisfy((e: unknown) =>
      /permission denied/.test((e as { cause?: { message?: string } }).cause?.message ?? ""),
    );
  });

  it("refuse les saisies invalides", async () => {
    for (const bad of [
      { ...identity, lastName: " " },
      { ...identity, birthDate: "2014-02-30" },
      { ...identity, sex: "X" as "M" },
    ]) {
      await expect(
        createStudent(secretary(), { student: bad, guardian: mother }),
      ).rejects.toThrow();
    }
    await expect(
      createStudent(secretary(), { student: identity, guardian: { ...mother, phone: "123" } }),
    ).rejects.toThrow();
  });
});

describe("Recherche", () => {
  it("par nom sans accents, par prénom partiel, par matricule, par téléphone du parent", async () => {
    const names = async (q: string) =>
      (await searchStudents(secretary(), q)).map((s) => `${s.lastName} ${s.firstNames}`);
    expect(await names("benedicte")).toEqual(["NGOMA MABIALA Bénédicte Ève"]);
    expect(await names("ngoma pau")).toEqual(["NGOMA Paul"]);
    expect(await names("00002")).toEqual(["NGOMA Paul"]);
    expect((await names("06 555 11 22")).sort()).toEqual([
      "NGOMA MABIALA Bénédicte Ève",
      "NGOMA Paul",
    ]);
    expect(await names("inconnu")).toEqual([]);
    expect(await searchStudents(secretary(), "")).toHaveLength(10);
  });
});

describe("Responsables", () => {
  it("ajoute le père, le rend principal, retire la mère ; garde toujours un responsable", async () => {
    await addGuardian(secretary(), first.id, {
      fullName: "Jean Ngoma",
      phone: "05 444 33 22",
      otherPhone: "",
      relationship: "Père",
    });
    await expectStudentError(addGuardian(secretary(), first.id, mother), "guardianAlreadyLinked");
    let student = await getStudent(director(), first.id);
    const father = student.guardians.find((g) => g.fullName === "Jean Ngoma")!;
    await setPrimaryGuardian(secretary(), first.id, father.id);
    student = await getStudent(director(), first.id);
    expect(student.guardians.map((g) => [g.fullName, g.isPrimary])).toEqual([
      ["Jean Ngoma", true],
      ["Awa Ngoma", false],
    ]);
    const motherId = student.guardians[1].id;
    await removeGuardian(secretary(), first.id, motherId);
    await expectStudentError(removeGuardian(secretary(), first.id, father.id), "lastGuardian");
  });

  it("modifier un responsable vaut pour tous ses enfants", async () => {
    const [paul] = await searchStudents(secretary(), "paul");
    const guardian = (await getStudent(director(), paul.id)).guardians[0];
    await updateGuardian(secretary(), guardian.id, { ...mother, fullName: "Awa Ngoma Mabiala" });
    expect((await getStudent(director(), paul.id)).guardians[0].fullName).toBe("Awa Ngoma Mabiala");
  });
});

describe("Données médicales (décision A4)", () => {
  it("la direction les lit et les écrit", async () => {
    await saveMedical(director(), first.id, {
      allergies: "Arachides",
      treatments: "",
      emergencyContactName: "Jean Ngoma",
      emergencyContactPhone: "05 444 33 22",
      notes: "",
    });
    expect(await getMedical(director(), first.id)).toEqual({
      allergies: "Arachides",
      treatments: null,
      emergencyContactName: "Jean Ngoma",
      emergencyContactPhone: "+242054443322",
      notes: null,
    });
  });

  it("le secrétariat, la comptabilité et le Support n'y ont pas accès (application)", async () => {
    for (const role of ["secretary", "accountant", "teacher", "support"] as const) {
      await expect(getMedical(as(a, role), first.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("la base les cache à une session qui n'est pas celle d'un directeur, même si l'application se trompait", async () => {
    const asSecretary = { schoolId: a.schoolId, userId: secretaryId };
    const rows = await withSchool(asSecretary, (tx) => tx.select().from(studentMedical));
    expect(rows).toEqual([]);
    await expect(
      withSchool(asSecretary, (tx) =>
        tx.insert(studentMedical).values({ schoolId: a.schoolId, studentId: first.id, notes: "x" }),
      ),
    ).rejects.toThrow();
    const asDirector = { schoolId: a.schoolId, userId: a.directorId };
    expect(await withSchool(asDirector, (tx) => tx.select().from(studentMedical))).toHaveLength(1);
  });

  it("le secrétariat modifie la fiche élève sans toucher aux données médicales", async () => {
    await updateStudent(secretary(), first.id, { ...identity, birthPlace: "Pointe-Noire" });
    expect((await getMedical(director(), first.id)).allergies).toBe("Arachides");
  });
});

describe("Photo et pièces jointes", () => {
  it("photo : enregistrée, lisible, remplacée (ancien fichier supprimé)", async () => {
    await setStudentPhoto(secretary(), first.id, PNG);
    expect(await readStudentPhoto(as(a, "accountant"), first.id)).toEqual({
      bytes: PNG,
      type: "image/png",
    });
    await setStudentPhoto(secretary(), first.id, PNG);
    const { rows } = await adminQuery<{ photo_key: string }>(
      "select photo_key from students where id = $1",
      [first.id],
    );
    expect(rows[0].photo_key).toMatch(/photo-.+\.png$/);
  });

  it("documents : ajout, liste, lecture, suppression ; refus d'un faux fichier", async () => {
    const id = await addStudentDocument(secretary(), first.id, {
      kind: "birth_certificate",
      label: "",
      bytes: PNG,
    });
    expect(await listStudentDocuments(director(), first.id)).toMatchObject([
      { id, kind: "birth_certificate", label: null },
    ]);
    expect(await readStudentDocument(director(), id)).toEqual({ bytes: PNG, type: "image/png" });
    await expectStudentError(
      addStudentDocument(secretary(), first.id, {
        kind: "other",
        label: "",
        bytes: new TextEncoder().encode("%PDF-1.7"),
      }),
      "imageType",
    );
    await deleteStudentDocument(secretary(), id);
    expect(await listStudentDocuments(director(), first.id)).toEqual([]);
  });
});

describe("Droits et isolation", () => {
  it("seuls direction et secrétariat créent ou modifient ; la comptabilité et le Support consultent", async () => {
    for (const role of ["accountant", "teacher", "parent", "support"] as const) {
      await expect(
        createStudent(as(a, role), { student: identity, guardian: mother }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(searchStudents(as(a, "accountant"), "")).resolves.not.toHaveLength(0);
    await expect(getStudent(as(a, "support"), first.id)).resolves.toMatchObject({ id: first.id });
  });

  it("un enseignant ne voit encore aucune fiche (ses classes arriveront avec les inscriptions)", async () => {
    await expectStudentError(searchStudents(as(a, "teacher"), ""), "notFound");
    await expectStudentError(getStudent(as(a, "teacher"), first.id), "notFound");
  });

  it("une école ne voit ni ne modifie les élèves d'une autre ; ses matricules repartent à 1", async () => {
    expect(await searchStudents(as(b, "director"), "")).toEqual([]);
    await expectStudentError(getStudent(as(b, "director"), first.id), "notFound");
    await expectStudentError(updateStudent(as(b, "director"), first.id, identity), "notFound");
    await expectStudentError(addGuardian(as(b, "director"), first.id, mother), "notFound");
    expect(await readStudentPhoto(as(b, "director"), first.id)).toBeNull();
    const other = await createStudent(as(b, "director"), { student: identity, guardian: mother });
    expect(other.matricule).toMatch(/^ELEVB-\d{2}-00001$/);
    // Le même parent (même téléphone) est un responsable distinct dans l'autre école.
    expect(other.existingGuardian).toBe(false);
  });
});
