// Phase 4, sous-étape 4d — messages aux parents : canal de l'école, modèles modifiables, coût
// journalisé, plafond mensuel ; reçu de paiement et bulletin publié ; une tâche par message.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type Principal } from "@/server/auth/permissions";
import { closeDb } from "@/server/db/client";
import { closeJobQueue } from "@/server/jobs";
import { FakeSmsProvider, type Channel } from "@/server/sms";
import { processNotice, scheduleNotice } from "@/modules/notifications/notices";
import {
  getNotificationSettings,
  listSentMessages,
  TemplateError,
  updateNotificationSettings,
} from "@/modules/notifications/settings";
import { DEFAULT_TEMPLATES } from "@/modules/notifications/templates";
import { addDefaultLevels, listLevels } from "@/modules/settings/levels";
import { activateYear, createYear } from "@/modules/settings/years";
import { preEnroll } from "@/modules/students/enrollments";
import { createStudent } from "@/modules/students/students";
import { adminQuery, createSchoolWithDirector, createSuperadmin, resetDatabase } from "./helpers";

type School = { schoolId: string; directorId: string };
let a: School;
let year: string;
const kid: Record<string, string> = {};
const director = (): Principal => ({
  userId: a.directorId,
  schoolId: a.schoolId,
  roles: ["director"],
  isSuperadmin: false,
});
const sms = new FakeSmsProvider("sms");
const whatsapp = new FakeSmsProvider("whatsapp");
const providers = (channel: Channel) => (channel === "sms" ? sms : whatsapp);
const base = () => ({ schoolId: a.schoolId, userId: a.directorId });

async function payment(name: string, amount: number, receipt: string) {
  const { rows } = await adminQuery<{ id: string }>(
    `insert into payments (school_id, academic_year_id, enrollment_id, amount, method, receipt_number, cashier_id)
     values ($1, $2, $3, $4, 'cash', $5, $6) returning id`,
    [a.schoolId, year, kid[name], amount, receipt, a.directorId],
  );
  return rows[0].id;
}

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  a = await createSchoolWithDirector(superadminId, "messa");
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
    ["ADA", "06 630 00 01"],
    ["BOB", "06 630 00 02"],
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
  await adminQuery(
    `insert into invoices (school_id, academic_year_id, enrollment_id, fee_name, kind, mandatory,
       installment_number, installment_count, amount, due_date)
     values ($1, $2, $3, 'Scolarité', 'tuition', true, 1, 1, 50000, '2026-10-15')`,
    [a.schoolId, year, kid.ADA],
  );
});

afterAll(async () => {
  await closeJobQueue();
  await closeDb();
});

describe("Réglages des messages (directeur)", () => {
  it("par défaut : SMS, sans plafond, modèles en français", async () => {
    expect(await getNotificationSettings(director())).toEqual({
      channel: "sms",
      monthlyCap: null,
      templates: DEFAULT_TEMPLATES,
    });
    await expect(
      getNotificationSettings({ ...director(), roles: ["secretary"] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("canal WhatsApp, modèle de reçu personnalisé ; un champ inconnu est refusé", async () => {
    const templates = {
      ...DEFAULT_TEMPLATES,
      receipt: "{ecole} : merci ! {montant} reçus pour {eleve} (reçu {numero}).",
    };
    await expect(
      updateNotificationSettings(director(), {
        channel: "whatsapp",
        monthlyCap: null,
        templates: { ...templates, bulletin: "Bulletin de {eleve} : {montant}" },
      }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof TemplateError && e.kind === "bulletin" && e.field === "montant",
    );
    await updateNotificationSettings(director(), {
      channel: "whatsapp",
      monthlyCap: null,
      templates,
    });
    expect((await getNotificationSettings(director())).channel).toBe("whatsapp");
    const { rows } = await adminQuery(
      "select 1 from audit_logs where action = 'school.notifications'",
    );
    expect(rows).toHaveLength(1);
  });
});

describe("Reçu de paiement et bulletin publié", () => {
  it("reçu : par le canal de l'école, selon son modèle, coût journalisé ; jamais deux fois", async () => {
    const paymentId = await payment("ADA", 20_000, "MESSA-2026-00001");
    const job = { type: "receipt" as const, ...base(), enrollmentId: kid.ADA, paymentId };
    expect(await processNotice(job, providers)).toBe("sent");
    expect(whatsapp.sent.at(-1)).toMatchObject({
      to: "+242066300001",
      body: "École messa : merci ! 20 000 FCFA reçus pour ADA Test (reçu MESSA-2026-00001).",
    });
    expect(await processNotice(job, providers)).toBe("alreadySent");
    expect(whatsapp.sent).toHaveLength(1);
    const { rows } = await adminQuery<{ channel: string; cost: number; kind: string }>(
      "select channel, cost, kind from notifications where reference_id = $1",
      [paymentId],
    );
    expect(rows).toEqual([{ channel: "whatsapp", cost: 15, kind: "receipt" }]);
  });

  it("bulletin publié : « disponible dans l'espace parents » avec la période", async () => {
    const period = (
      await adminQuery<{ id: string }>(
        "select id from periods where academic_year_id = $1 order by position limit 1",
        [year],
      )
    ).rows[0].id;
    const card = (
      await adminQuery<{ id: string }>(
        `insert into report_cards (school_id, academic_year_id, enrollment_id, kind, period_id,
           council_validated_at, council_validated_by, published_at, published_by, snapshot)
         values ($1, $2, $3, 'period', $4, now(), $5, now(), $5, '{}') returning id`,
        [a.schoolId, year, kid.ADA, period, a.directorId],
      )
    ).rows[0].id;
    expect(
      await processNotice(
        { type: "bulletin", ...base(), enrollmentId: kid.ADA, reportCardId: card },
        providers,
      ),
    ).toBe("sent");
    expect(whatsapp.sent.at(-1)?.body).toBe(
      "École messa : le bulletin de ADA Test (1er trimestre) est disponible dans l'espace parents.",
    );
  });

  it("plafond mensuel atteint : message non envoyé, noté, jamais réessayé", async () => {
    // Déjà 30 FCFA ce mois-ci ; plafond 40 : un message WhatsApp de plus (15) le dépasserait.
    await updateNotificationSettings(director(), {
      channel: "whatsapp",
      monthlyCap: 40,
      templates: (await getNotificationSettings(director())).templates,
    });
    const paymentId = await payment("ADA", 10_000, "MESSA-2026-00002");
    const job = { type: "receipt" as const, ...base(), enrollmentId: kid.ADA, paymentId };
    const before = whatsapp.sent.length;
    expect(await processNotice(job, providers)).toBe("capReached");
    expect(await processNotice(job, providers)).toBe("alreadySent");
    expect(whatsapp.sent.length).toBe(before);
    const log = await listSentMessages(director());
    expect(log).toMatchObject({ monthCost: 30, monthCount: 2 });
    expect(log.messages[0]).toMatchObject({
      status: "skipped",
      kind: "receipt",
      error: "Plafond mensuel de l'école atteint.",
    });
  });
});

describe("File des messages", () => {
  it("une tâche par message : un reçu n'est programmé qu'une fois, chaque famille a la sienne", async () => {
    const paymentId = crypto.randomUUID();
    const job = { type: "receipt" as const, ...base(), enrollmentId: kid.ADA, paymentId };
    await scheduleNotice(job);
    await scheduleNotice(job);
    const card = crypto.randomUUID();
    for (const name of ["ADA", "BOB"]) {
      await scheduleNotice({
        type: "bulletin",
        ...base(),
        enrollmentId: kid[name],
        reportCardId: card,
      });
    }
    const count = async (key: string) =>
      (
        await adminQuery<{ n: number }>(
          "select count(*)::int as n from pgboss.job where name = 'notifications' and singleton_key like $1",
          [key],
        )
      ).rows[0].n;
    expect(await count(`receipt:${paymentId}`)).toBe(1);
    expect(await count(`bulletin:${card}:%`)).toBe(2);
  });
});
