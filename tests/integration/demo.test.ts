// Mise en service, Sg — site de démonstration : refus hors site de démonstration, école fictive complète
// créée par les fonctions métier, remise à neuf (sauf super-administrateurs), connexion des comptes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_PARENT, DEMO_PASSWORD, DEMO_SCHOOL, DEMO_STAFF } from "@/modules/demo/accounts";
import {
  DemoRefused,
  demoSchoolExists,
  seedDemo,
  wipeDemo,
  type DemoSummary,
} from "@/modules/demo/seed";
import { login } from "@/server/auth/core";
import { closeDb } from "@/server/db/client";
import { closeJobQueue } from "@/server/jobs";
import { adminQuery, createSuperadmin, resetDatabase } from "./helpers";

const SITE = { DEMO_SITE: "true", DEMO_MODE: "true" };
const TODAY = "2026-11-26";
let summary: DemoSummary;
let keptSuperadmin: string;

const count = async (query: string, values: unknown[] = []) =>
  Number((await adminQuery<{ n: string }>(query, values)).rows[0].n);

beforeAll(async () => {
  await resetDatabase();
  keptSuperadmin = await createSuperadmin();
  summary = await seedDemo({ today: TODAY, env: SITE });
}, 300_000);

afterAll(async () => {
  await closeJobQueue();
  await closeDb();
});

describe("Garde-fou", () => {
  it("refuse sans DEMO_SITE=true et DEMO_MODE=true (vraie école en mode démonstration)", async () => {
    for (const env of [{}, { DEMO_MODE: "true" }, { DEMO_SITE: "true", DEMO_MODE: "false" }]) {
      await expect(seedDemo({ today: TODAY, env })).rejects.toBeInstanceOf(DemoRefused);
      await expect(wipeDemo(env)).rejects.toBeInstanceOf(DemoRefused);
    }
    expect(await demoSchoolExists()).toBe(true);
  });
});

describe("École de démonstration", () => {
  it("année en cours, 146 élèves inscrits en classe, échéances générées", async () => {
    expect(summary).toMatchObject({ yearLabel: "2026-2027", students: 146 });
    expect(
      await count(
        "select count(*) n from enrollments where status = 'enrolled' and class_id is not null",
      ),
    ).toBe(146);
    expect(await count("select count(*) n from invoices")).toBe(146 * 4);
  });

  it("paiements avec reçus continus, impayés, caisse close égale à la somme des reçus", async () => {
    const payments = await count("select count(*) n from payments");
    expect(payments).toBe(summary.payments);
    expect(payments).toBeGreaterThan(100);
    expect(payments).toBeLessThan(146);
    const numbers = (
      await adminQuery<{ receipt_number: string }>(
        "select receipt_number from payments order by receipt_number",
      )
    ).rows.map((r) => Number(r.receipt_number.split("-").at(-1)));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
    const closure = (
      await adminQuery<{ cash_total: number; counted: number; sum: string }>(
        `select c.cash_total, c.counted_cash as counted,
           (select sum(p.amount) from payments p where p.cashier_id = c.cashier_id and p.method = 'cash') as sum
         from cash_closures c`,
      )
    ).rows;
    expect(closure).toHaveLength(1);
    expect(closure[0].cash_total).toBe(Number(closure[0].sum));
    expect(closure[0].counted).toBe(closure[0].cash_total);
    expect(await count("select count(*) n from payment_intents where status = 'succeeded'")).toBe(
      1,
    );
  });

  it("1er trimestre clôturé, conseils validés, bulletins publiés pour chaque élève", async () => {
    expect(summary.publishedBulletins).toBe(146);
    expect(await count("select count(*) n from period_closures where closed")).toBe(5);
    expect(await count("select count(*) n from report_cards where published_at is not null")).toBe(
      146,
    );
    expect(await count("select count(*) n from grades")).toBeGreaterThan(146 * 10);
  });

  it("appel, annonces", async () => {
    expect(await count("select count(*) n from attendance")).toBe(146 * 10);
    expect(
      await count("select count(*) n from attendance where status = 'absent'"),
    ).toBeGreaterThan(0);
    expect(await count("select count(*) n from announcements")).toBe(2);
  });

  it("comptes du personnel : mot de passe connu, aucun changement imposé", async () => {
    for (const s of DEMO_STAFF) {
      const result = await login({
        schoolCode: DEMO_SCHOOL.code,
        identifier: s.identifier,
        password: DEMO_PASSWORD,
      });
      expect(result.ok, s.identifier).toBe(true);
      if (result.ok) expect(result.principal.roles).toContain(s.role);
    }
    expect(
      await count(
        "select count(*) n from users where email like '%@example.org' and must_change_password",
      ),
    ).toBe(0);
  });

  it("le parent de démonstration a deux enfants", async () => {
    expect(
      await count(
        `select count(*) n from student_guardians sg join guardians g on g.id = sg.guardian_id
         where g.phone = $1`,
        ["+242" + DEMO_PARENT.phone.replace(/\s/g, "")],
      ),
    ).toBe(2);
  });
});

describe("Remise à neuf", () => {
  it("efface tout sauf les super-administrateurs, puis recrée la même école", async () => {
    await adminQuery(
      "insert into schools (name, code, matricule_prefix) values ('Autre', 'AUTRE', 'AUT')",
    );
    await wipeDemo(SITE);
    expect(await count("select count(*) n from schools")).toBe(0);
    expect(await count("select count(*) n from payments")).toBe(0);
    expect(await count("select count(*) n from users where id = $1", [keptSuperadmin])).toBe(1);
    expect(await count("select count(*) n from users where not is_superadmin")).toBe(0);
    const again = await seedDemo({ today: TODAY, env: SITE });
    expect(again).toMatchObject({ students: 146, payments: summary.payments });
  }, 300_000);
});
