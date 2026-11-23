// 2f — documents PDF : file d'attente pg-boss, worker, PDF Chromium, récupération, vérification.
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/server/auth/permissions";
import { closeDb } from "@/server/db/client";
import { DOCUMENTS_QUEUE, JOB_SCHEMA } from "@/server/db/setup";
import { closeJobQueue } from "@/server/jobs";
import { renderDocument } from "@/modules/documents/documents";
import { closePdfBrowser } from "@/modules/documents/pdf";
import { documentFile, documentStatus, requestDocument } from "@/modules/documents/requests";
import { checkReceipt, receiptToken } from "@/modules/documents/verification";
import {
  collectPayment,
  decideCancellation,
  requestCancellation,
} from "@/modules/finance/payments";
import { saveFee } from "@/modules/settings/fees";
import { addDefaultLevels, listLevels } from "@/modules/settings/levels";
import { addStaff } from "@/modules/settings/staff";
import { createYear } from "@/modules/settings/years";
import { preEnroll } from "@/modules/students/enrollments";
import { createStudent } from "@/modules/students/students";
import { adminQuery, createSchoolWithDirector, createSuperadmin, resetDatabase } from "./helpers";

let director: Principal;
let accountant: Principal;
let other: Principal;
let paymentId: string;
let worker: PgBoss;

async function waitReady(principal: Principal, jobId: string) {
  for (let i = 0; i < 60; i++) {
    const status = await documentStatus(principal, jobId);
    if (status?.state === "ready" || status?.state === "failed") return status;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Document jamais prêt");
}

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  const a = await createSchoolWithDirector(superadminId, "doca");
  const b = await createSchoolWithDirector(superadminId, "docb");
  director = {
    userId: a.directorId,
    schoolId: a.schoolId,
    roles: ["director"],
    isSuperadmin: false,
  };
  other = {
    userId: b.directorId,
    schoolId: b.schoolId,
    roles: ["director", "accountant"],
    isSuperadmin: false,
  };
  const accountantId = (
    await addStaff(director, {
      name: "Jean Comptable",
      identifier: "05 750 00 01",
      password: "Provisoire-2026",
      roles: ["accountant"],
    })
  ).userId;
  accountant = {
    userId: accountantId,
    schoolId: a.schoolId,
    roles: ["accountant"],
    isSuperadmin: false,
  };
  await addDefaultLevels(director, "college");
  const sixieme = (await listLevels(director)).find((l) => l.name === "6e")!.id;
  const y1 = await createYear(director, {
    label: "2026-2027",
    startDate: "2026-10-01",
    endDate: "2027-06-30",
    periodKind: "trimester",
  });
  await saveFee(director, y1, {
    name: "Frais d'inscription",
    kind: "registration",
    mandatory: true,
    levelIds: [sixieme],
    installments: [{ number: 1, amount: 25_000, dueDate: "2026-09-15" }],
  });
  const s = await createStudent(director, {
    student: {
      lastName: "NGOMA",
      firstNames: "Paul",
      sex: "M",
      birthDate: "",
      birthPlace: "",
      nationality: "",
      previousSchool: "",
    },
    guardian: { fullName: "Parent", phone: "06 750 00 02", otherPhone: "", relationship: "" },
  });
  const enrollmentId = await preEnroll(director, {
    studentId: s.id,
    academicYearId: y1,
    levelId: sixieme,
  });
  paymentId = (
    await collectPayment(accountant, {
      enrollmentId,
      amount: 10_000,
      method: "cash",
      reference: "",
      note: "",
    })
  ).paymentId;

  // Worker dans le test, avec le rôle applicatif (comme le vrai worker).
  worker = new PgBoss({
    connectionString: process.env.DATABASE_URL!,
    schema: JOB_SCHEMA,
    migrate: false,
    schedule: false,
  });
  worker.on("error", () => undefined);
  await worker.start();
  await worker.work(DOCUMENTS_QUEUE, { batchSize: 1, pollingIntervalSeconds: 0.5 }, async ([job]) =>
    renderDocument(job.data),
  );
}, 60_000);

afterAll(async () => {
  await worker?.stop({ graceful: false });
  await closeJobQueue();
  await closePdfBrowser();
  await closeDb();
});

describe("Reçu en PDF", () => {
  it("demande → worker → PDF A5 récupérable par la personne qui l'a demandé", async () => {
    const jobId = await requestDocument(accountant, { kind: "receipt", paymentId, format: "A5" });
    expect(await waitReady(accountant, jobId)).toEqual({
      state: "ready",
      fileName: "recu-DOCA-2026-00001.pdf",
    });
    const file = await documentFile(accountant, jobId);
    expect(file?.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(file!.bytes.length).toBeGreaterThan(5_000);
  }, 60_000);

  it("ticket 80 mm", async () => {
    const jobId = await requestDocument(director, { kind: "receipt", paymentId, format: "ticket" });
    expect((await waitReady(director, jobId)).state).toBe("ready");
    const file = await documentFile(director, jobId);
    expect(file?.bytes.subarray(0, 5).toString()).toBe("%PDF-");
  }, 60_000);

  it("personne d'autre ne récupère le document (même école ou autre école)", async () => {
    const jobId = await requestDocument(accountant, { kind: "receipt", paymentId, format: "A5" });
    await waitReady(accountant, jobId);
    expect(await documentStatus(director, jobId)).toBeNull();
    expect(await documentFile(director, jobId)).toBeNull();
    expect(await documentStatus(other, jobId)).toBeNull();
    expect(await documentStatus(accountant, "pas-un-uuid")).toBeNull();
  }, 60_000);

  it("droits vérifiés dès la demande : enseignant refusé, reçu d'une autre école introuvable", async () => {
    await expect(
      requestDocument(
        { ...director, roles: ["teacher"] },
        { kind: "receipt", paymentId, format: "A5" },
      ),
    ).rejects.toThrow();
    await expect(
      requestDocument(other, { kind: "receipt", paymentId, format: "A5" }),
    ).rejects.toThrow();
    // Un vrai compte parent de l'école, sans enfant concerné : le reçu lui reste introuvable (RLS).
    const { rows } = await adminQuery<{ id: string }>(
      "insert into users (name, phone) values ('Parent sans enfant', '+242069990000') returning id",
    );
    await adminQuery(
      "insert into memberships (school_id, user_id, roles) values ($1, $2, '{parent}')",
      [director.schoolId, rows[0].id],
    );
    await expect(
      requestDocument(
        { userId: rows[0].id, schoolId: director.schoolId, roles: ["parent"], isSuperadmin: false },
        { kind: "receipt", paymentId, format: "A5" },
      ),
    ).rejects.toThrow();
  });

  it("le worker relit les droits en base : une tâche forgée pour un non-membre échoue", async () => {
    await expect(
      renderDocument({
        schoolId: director.schoolId,
        userId: other.userId,
        request: { kind: "receipt", paymentId, format: "A5" },
      }),
    ).rejects.toThrow();
  });
});

describe("Vérification publique par QR code", () => {
  it("un lien signé montre le reçu, sans l'élève ; un lien forgé est refusé", async () => {
    const check = await checkReceipt(receiptToken(paymentId));
    expect(check).toMatchObject({
      schoolName: "École doca",
      receiptNumber: "DOCA-2026-00001",
      amount: 10_000,
      reversed: false,
    });
    expect(JSON.stringify(check)).not.toContain("NGOMA");
    const [, sig] = receiptToken(paymentId).split(".");
    expect(await checkReceipt(`00000000-0000-4000-8000-000000000000.${sig}`)).toBeNull();
    expect(await checkReceipt("n'importe-quoi")).toBeNull();
  });

  it("un reçu annulé apparaît comme annulé", async () => {
    const id = await requestCancellation(accountant, paymentId, "Erreur de saisie");
    await decideCancellation(director, id, { approve: true, note: "" });
    expect((await checkReceipt(receiptToken(paymentId)))?.reversed).toBe(true);
  });
});
