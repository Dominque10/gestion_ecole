// Phase 4, sous-étape 4c — paiement en ligne (faux prestataire) : intention, confirmation signée et
// idempotente, interrogation du statut, expiration, trop-perçu, réconciliation quotidienne.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/server/auth/permissions";
import { requestParentCode, verifyParentCode } from "@/server/auth/parent";
import { closeDb, withSchool } from "@/server/db/client";
import { paymentIntents } from "@/server/db/schema";
import { FakeMobileMoneyProvider, signBody } from "@/server/payments";
import { FakeSmsProvider } from "@/server/sms";
import { FinanceError } from "@/modules/finance/errors";
import {
  checkIntent,
  getIntent,
  handlePaymentWebhook,
  reconcileDay,
  startOnlinePayment,
  type IntentJob,
} from "@/modules/finance/online";
import { addDefaultLevels, listLevels } from "@/modules/settings/levels";
import { activateYear, createYear } from "@/modules/settings/years";
import { preEnroll } from "@/modules/students/enrollments";
import { createStudent } from "@/modules/students/students";
import { adminQuery, createSchoolWithDirector, createSuperadmin, resetDatabase } from "./helpers";

const SECRET = "secret-de-test-des-paiements";
const provider = new FakeMobileMoneyProvider(SECRET);
const scheduled: IntentJob[] = [];
const schedule = async (job: IntentJob) => void scheduled.push(job);

type School = { schoolId: string; directorId: string };
let a: School;
let year: string;
let parent: Principal;
const kid: Record<string, string> = {};
const inv: Record<string, string> = {};
const director = (): Principal => ({
  userId: a.directorId,
  schoolId: a.schoolId,
  roles: ["director"],
  isSuperadmin: false,
});

async function expectFinanceError(promise: Promise<unknown>, code: FinanceError["code"]) {
  await expect(promise).rejects.toSatisfy(
    (e: unknown) => e instanceof FinanceError && e.code === code,
  );
}

async function invoice(name: string, fee: string, kind: string, amount: number, due: string) {
  const { rows } = await adminQuery<{ id: string }>(
    `insert into invoices (school_id, academic_year_id, enrollment_id, fee_name, kind, mandatory,
       installment_number, installment_count, amount, due_date)
     values ($1, $2, $3, $4, $5, true, 1, 1, $6, $7) returning id`,
    [a.schoolId, year, kid[name], fee, kind, amount, due],
  );
  return rows[0].id;
}

/** Message de confirmation du prestataire, signé (ou pas). */
function webhook(event: Record<string, unknown>, secret = SECRET) {
  const body = JSON.stringify(event);
  return handlePaymentWebhook(body, signBody(body, secret), provider);
}

const providerRef = async (intentId: string) =>
  (
    await adminQuery<{ ref: string }>(
      "select provider_ref as ref from payment_intents where id = $1",
      [intentId],
    )
  ).rows[0].ref;
const paymentsOf = async (name: string) =>
  (
    await adminQuery<{ amount: number; method: string; receipt: string; note: string }>(
      "select amount, method, receipt_number as receipt, note from payments where enrollment_id = $1 order by paid_at",
      [kid[name]],
    )
  ).rows;

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  a = await createSchoolWithDirector(superadminId, "ligne");
  await addDefaultLevels(director(), "college");
  const level = (await listLevels(director()))[0].id;
  year = await createYear(director(), {
    label: "2026-2027",
    startDate: "2026-10-01",
    endDate: "2027-06-30",
    periodKind: "trimester",
  });
  await activateYear(director(), year);
  for (const [name, phone] of [
    ["ADA", "06 620 00 01"],
    ["BOB", "06 620 00 02"],
  ]) {
    const s = await createStudent(director(), {
      student: {
        lastName: name,
        firstNames: "Test",
        sex: "F",
        birthDate: "",
        birthPlace: "",
        nationality: "",
        previousSchool: "",
      },
      guardian: { fullName: `Parent ${name}`, phone, otherPhone: "", relationship: "" },
    });
    kid[name] = await preEnroll(director(), {
      studentId: s.id,
      academicYearId: year,
      levelId: level,
    });
  }
  inv.registration = await invoice("ADA", "Inscription", "registration", 25_000, "2026-09-15");
  inv.t1 = await invoice("ADA", "Scolarité T1", "tuition", 50_000, "2026-10-15");
  inv.t2 = await invoice("ADA", "Scolarité T2", "tuition", 50_000, "2027-01-15");
  inv.t3 = await invoice("ADA", "Scolarité T3", "tuition", 50_000, "2027-04-15");
  inv.bob = await invoice("BOB", "Scolarité T1", "tuition", 50_000, "2026-10-15");
  const sms = new FakeSmsProvider();
  const t0 = new Date("2026-11-23T08:00:00Z");
  await requestParentCode("06 620 00 01", sms, t0);
  const result = await verifyParentCode("06 620 00 01", sms.sent[0].body.match(/\d{6}/)![0], t0);
  if (!result.ok) throw new Error("connexion parent impossible");
  parent = result.principal;
});

afterAll(async () => {
  await closeDb();
});

const start = (
  invoiceIds: string[],
  phone = "06 620 00 01",
  operator: "airtel" | "mtn" = "airtel",
) =>
  startOnlinePayment(
    parent,
    { enrollmentId: kid.ADA, invoiceIds, phone, operator },
    provider,
    schedule,
  );

describe("Lancer un paiement", () => {
  let intent: string;

  it("refuse une demande vide, une échéance d'un autre enfant, un numéro illisible", async () => {
    await expectFinanceError(start([]), "onlineInvalid");
    await expectFinanceError(start([inv.bob]), "onlineInvalid");
    await expectFinanceError(
      startOnlinePayment(
        parent,
        { enrollmentId: kid.BOB, invoiceIds: [inv.bob], phone: "06 620 00 01", operator: "mtn" },
        provider,
        schedule,
      ),
      "enrollmentNotFound",
    );
    await expectFinanceError(start([inv.t1], "123"), "onlinePhone");
  });

  it("échéances entières de son enfant ; interrogation programmée ; une seule demande en attente à la fois", async () => {
    intent = await start([inv.registration, inv.t1]);
    expect(await getIntent(parent, intent)).toMatchObject({
      status: "pending",
      amount: 75_000,
      operator: "airtel",
      phone: "+242066200001",
      receiptNumber: null,
    });
    expect(await providerRef(intent)).toMatch(/^fake-/);
    expect(scheduled.at(-1)).toEqual({ schoolId: a.schoolId, intentId: intent });
    await expectFinanceError(start([inv.t2]), "onlinePending");
  });

  it("le parent n'écrit jamais lui-même une intention (RLS)", async () => {
    await expect(
      withSchool({ schoolId: a.schoolId, userId: parent.userId }, (tx) =>
        tx.update(paymentIntents).set({ status: "succeeded" }),
      ),
    ).resolves.toBeDefined();
    expect((await getIntent(parent, intent))?.status).toBe("pending");
  });

  it("confirmation : signature vérifiée ; enregistrée une seule fois ; reçu ; inscription validée (A3)", async () => {
    const ref = await providerRef(intent);
    expect(await webhook({ providerRef: ref, status: "succeeded" }, "mauvais-secret")).toEqual({
      status: 401,
    });
    expect(await webhook({ providerRef: "fake-inconnu", status: "succeeded" })).toEqual({
      status: 404,
    });

    const event = { providerRef: ref, status: "succeeded", operatorRef: "AIRTEL-778899" };
    expect(await webhook(event)).toEqual({ status: 200, outcome: "recorded" });
    expect(await webhook(event)).toEqual({ status: 200, outcome: "alreadyRecorded" });

    const paid = await paymentsOf("ADA");
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({
      amount: 75_000,
      method: "mobile_money",
      note: "Paiement en ligne (Airtel Money)",
    });
    expect((await getIntent(parent, intent))?.receiptNumber).toBe(paid[0].receipt);
    const { rows: allocations } = await adminQuery<{ invoice_id: string; amount: number }>(
      "select invoice_id, amount from payment_allocations order by amount",
    );
    expect(allocations).toEqual([
      { invoice_id: inv.registration, amount: 25_000 },
      { invoice_id: inv.t1, amount: 50_000 },
    ]);
    const { rows } = await adminQuery<{ status: string; validation_mode: string }>(
      "select status, validation_mode from enrollments where id = $1",
      [kid.ADA],
    );
    expect(rows[0]).toEqual({ status: "enrolled", validation_mode: "payment" });
    const cashier = await adminQuery<{ name: string; password_hash: string | null }>(
      "select u.name, u.password_hash from payments p join users u on u.id = p.cashier_id limit 1",
    );
    expect(cashier.rows[0]).toEqual({ name: "Paiement en ligne", password_hash: null });
  });
});

describe("Sans confirmation : interrogation, échec, expiration", () => {
  it("échec annoncé par l'opérateur (numéro …0000 du faux prestataire)", async () => {
    const intent = await start([inv.t2], "06 620 00 00");
    expect(await checkIntent({ schoolId: a.schoolId, intentId: intent }, provider, schedule)).toBe(
      "failed",
    );
    expect(await getIntent(parent, intent)).toMatchObject({
      status: "failed",
      failureReason: "Solde insuffisant (simulation)",
    });
  });

  it("toujours en attente : nouvelle interrogation, puis expiration après une heure ; une réussite tardive est quand même enregistrée", async () => {
    const intent = await start([inv.t2], "06 620 00 01", "mtn");
    const job = { schoolId: a.schoolId, intentId: intent };
    const before = scheduled.length;
    expect(await checkIntent(job, provider, schedule)).toBe("stillPending");
    expect(scheduled.length).toBe(before + 1);
    expect(await checkIntent(job, provider, schedule, new Date(Date.now() + 61 * 60 * 1000))).toBe(
      "expired",
    );
    expect((await getIntent(parent, intent))?.status).toBe("expired");
    // L'opérateur confirme enfin : l'argent a été pris, le paiement est enregistré.
    expect(
      await webhook({
        providerRef: await providerRef(intent),
        status: "succeeded",
        operatorRef: "MTN-1",
      }),
    ).toMatchObject({
      outcome: "recorded",
    });
    expect((await getIntent(parent, intent))?.status).toBe("succeeded");
  });

  it("réussite constatée par l'interrogation (numéro …1111 du faux prestataire)", async () => {
    const intent = await start([inv.t3], "06 620 11 11");
    expect(await checkIntent({ schoolId: a.schoolId, intentId: intent }, provider, schedule)).toBe(
      "recorded",
    );
    expect((await getIntent(parent, intent))?.status).toBe("succeeded");
  });
});

describe("Trop-perçu et réconciliation", () => {
  it("échéance réglée au guichet entre-temps : l'argent reçu est enregistré, le trop-perçu signalé", async () => {
    const t4 = await invoice("ADA", "Cantine", "other", 10_000, "2027-02-01");
    const intent = await start([t4]);
    // Le guichet encaisse la même échéance avant la confirmation.
    const { rows } = await adminQuery<{ id: string }>(
      `insert into payments (school_id, academic_year_id, enrollment_id, amount, method, receipt_number, cashier_id)
       values ($1, $2, $3, 10000, 'cash', 'LIGNE-2026-99999', $4) returning id`,
      [a.schoolId, year, kid.ADA, a.directorId],
    );
    await adminQuery(
      "insert into payment_allocations (school_id, payment_id, invoice_id, amount) values ($1, $2, $3, 10000)",
      [a.schoolId, rows[0].id, t4],
    );
    expect(
      await webhook({ providerRef: await providerRef(intent), status: "succeeded" }),
    ).toMatchObject({ outcome: "recorded" });
    const last = (await paymentsOf("ADA")).at(-1)!;
    expect(last.note).toBe(
      "Paiement en ligne (Airtel Money) — trop-perçu de 10 000 FCFA à rembourser",
    );
  });

  it("réconciliation : une confirmation perdue est rattrapée, une transaction inconnue signalée", async () => {
    const t5 = await invoice("ADA", "Uniforme", "other", 15_000, "2027-02-01");
    const intent = await start([t5]);
    const ref = await providerRef(intent);
    provider.statement = [
      { providerRef: ref, status: "succeeded", operatorRef: "AIRTEL-LOST", amount: 15_000 },
      { providerRef: "fake-hors-plateforme", status: "succeeded", amount: 5_000 },
    ];
    expect(await reconcileDay("2026-11-23", provider)).toEqual({
      day: "2026-11-23",
      checked: 2,
      recovered: 1,
      unknown: ["fake-hors-plateforme"],
    });
    expect((await getIntent(parent, intent))?.status).toBe("succeeded");
    // Rejouée, la réconciliation ne paie pas deux fois.
    expect((await reconcileDay("2026-11-23", provider)).recovered).toBe(0);
    const { rows } = await adminQuery(
      "select 1 from audit_logs where action = 'payments.reconcile'",
    );
    expect(rows).toHaveLength(2);
  });
});
