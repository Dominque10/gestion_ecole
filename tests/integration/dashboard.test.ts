// Phase 4, sous-étape 4f — tableau de bord de la direction (M7) : chiffres exacts sur un petit jeu de
// données, droits (directeur, comptable), et critère d'acceptation : moins de 3 s pour 2 000 élèves.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type MembershipRole, type Principal } from "@/server/auth/permissions";
import { closeDb } from "@/server/db/client";
import { getDashboard } from "@/modules/dashboard/dashboard";
import { createAssessment, saveGrades } from "@/modules/grading/assessments";
import { createClass } from "@/modules/settings/classes";
import { addDefaultGrid, saveGrid } from "@/modules/settings/coefficients";
import { addDefaultLevels, listLevels, listSubjects } from "@/modules/settings/levels";
import { activateYear, createYear } from "@/modules/settings/years";
import { assignClass, preEnroll, validateEnrollment } from "@/modules/students/enrollments";
import { createStudent } from "@/modules/students/students";
import { adminQuery, createSchoolWithDirector, createSuperadmin, resetDatabase } from "./helpers";

type School = { schoolId: string; directorId: string };
let a: School;
let b: School;
let big: School;
const as = (school: School, ...roles: MembershipRole[]): Principal => ({
  userId: school.directorId,
  schoolId: school.schoolId,
  roles,
  isSuperadmin: false,
});
const TODAY = "2026-11-23";

let year: string;
const level: Record<string, string> = {};
const cls: Record<string, string> = {};
const subject: Record<string, string> = {};
const kid: Record<string, string> = {};
const period: string[] = [];

async function newYear(principal: Principal) {
  return createYear(principal, {
    label: "2026-2027",
    startDate: "2026-10-01",
    endDate: "2027-06-30",
    periodKind: "trimester",
  });
}

async function enroll(name: string, sex: "F" | "M", lvl: string, className: string | null) {
  const director = as(a, "director");
  const s = await createStudent(director, {
    student: {
      lastName: name,
      firstNames: "Test",
      sex,
      birthDate: "",
      birthPlace: "",
      nationality: "",
      previousSchool: "",
    },
    guardian: { fullName: "Parent", phone: "06 650 00 01", otherPhone: "", relationship: "" },
  });
  const e = await preEnroll(director, {
    studentId: s.id,
    academicYearId: year,
    levelId: level[lvl],
  });
  if (className) {
    await validateEnrollment(director, e);
    await assignClass(director, e, cls[className]);
    await adminQuery("update enrollments set validated_at = '2026-10-02T08:00:00Z' where id = $1", [
      e,
    ]);
  }
  kid[name] = e;
  return { studentId: s.id, enrollmentId: e };
}

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  a = await createSchoolWithDirector(superadminId, "tbord");
  b = await createSchoolWithDirector(superadminId, "tbordb");
  big = await createSchoolWithDirector(superadminId, "grande");
  const director = as(a, "director");
  await addDefaultLevels(director, "college");
  for (const l of await listLevels(director)) level[l.name] = l.id;
  year = await newYear(director);
  for (const lvl of ["6e", "5e"]) {
    await addDefaultGrid(director, { academicYearId: year, levelId: level[lvl], series: "" });
  }
  for (const s of await listSubjects(director)) subject[s.name] = s.id;
  await saveGrid(director, { academicYearId: year, levelId: level["6e"], series: "" }, [
    { subjectId: subject["Mathématiques"], coefficient: 4 },
    { subjectId: subject["Français"], coefficient: 3 },
  ]);
  for (const [name, lvl] of [
    ["6e A", "6e"],
    ["5e A", "5e"],
  ]) {
    cls[name] = await createClass(director, year, {
      levelId: level[lvl],
      series: "",
      name,
      capacity: "",
      headTeacherId: "",
    });
  }
  await activateYear(director, year);
  const ids = await adminQuery<{ id: string }>(
    "select id from periods where academic_year_id = $1 order by position",
    [year],
  );
  period.push(...ids.rows.map((r) => r.id));

  // Effectifs : ADA déjà élève l'an dernier ; EMMA préinscrite ; FABRICE parti ce mois-ci ;
  // DAVID inscrit (validé) ce mois-ci.
  const ada = await enroll("ADA", "F", "6e", "6e A");
  await enroll("BOB", "M", "6e", "6e A");
  await enroll("CHLOE", "F", "6e", "6e A");
  await enroll("DAVID", "M", "5e", "5e A");
  await enroll("EMMA", "F", "6e", null);
  await enroll("FABRICE", "M", "5e", "5e A");
  await adminQuery("update enrollments set validated_at = '2026-11-12T08:00:00Z' where id = $1", [
    kid.DAVID,
  ]);
  await adminQuery(
    "update enrollments set status = 'left', exit_date = '2026-11-10', exit_reason = 'dropout' where id = $1",
    [kid.FABRICE],
  );
  const prior = await adminQuery<{ id: string }>(
    `insert into academic_years (school_id, label, start_date, end_date)
     values ($1, '2025-2026', '2025-10-01', '2026-06-30') returning id`,
    [a.schoolId],
  );
  await adminQuery(
    `insert into enrollments (school_id, student_id, academic_year_id, level_id, status, validation_mode,
       validated_at, entry_date)
     values ($1, $2, $3, $4, 'enrolled', 'manual', '2025-10-02', '2025-10-01')`,
    [a.schoolId, ada.studentId, prior.rows[0].id, level["6e"]],
  );
  // (Laissée « en préparation » : le passage direct à « archivée » est interdit, et seul l'ordre des
  // dates compte pour reconnaître un ancien élève.)

  // Finances : échéances et paiements aux montants connus.
  const installments: Record<string, number> = {};
  const invoice = async (who: string, amount: number, due: string, discount = 0, status = "open") =>
    (
      await adminQuery<{ id: string }>(
        `insert into invoices (school_id, academic_year_id, enrollment_id, fee_name, kind, mandatory,
           installment_number, installment_count, amount, discount_amount, due_date, status)
         values ($1, $2, $3, 'Scolarité', 'tuition', true, $8, 2, $4, $5, $6, $7) returning id`,
        [
          a.schoolId,
          year,
          kid[who],
          amount,
          discount,
          due,
          status,
          (installments[who] = (installments[who] ?? 0) + 1),
        ],
      )
    ).rows[0].id;
  const ada1 = await invoice("ADA", 50000, "2026-10-15");
  await invoice("ADA", 50000, "2026-12-15");
  const bob1 = await invoice("BOB", 50000, "2026-10-15", 10000);
  await invoice("BOB", 50000, "2026-12-15");
  const chloe1 = await invoice("CHLOE", 50000, "2026-11-30");
  await adminQuery(
    `update invoices set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Erreur',
       cancelled_by = $2 where id = $1`,
    [await invoice("DAVID", 99999, "2026-10-15"), a.directorId],
  );
  let receipt = 0;
  const pay = async (
    who: string,
    invoiceId: string,
    amount: number,
    paidAt: string,
    method = "cash",
    reverses: string | null = null,
  ) => {
    const id = (
      await adminQuery<{ id: string }>(
        `insert into payments (school_id, academic_year_id, enrollment_id, kind, amount, method,
           receipt_number, reverses_id, cashier_id, paid_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
        [
          a.schoolId,
          year,
          kid[who],
          reverses ? "reversal" : "payment",
          amount,
          method,
          reverses ? null : `TB-${++receipt}`,
          reverses,
          a.directorId,
          paidAt,
        ],
      )
    ).rows[0].id;
    await adminQuery(
      "insert into payment_allocations (school_id, payment_id, invoice_id, amount) values ($1, $2, $3, $4)",
      [a.schoolId, id, invoiceId, amount],
    );
    return id;
  };
  await pay("ADA", ada1, 50000, "2026-10-15T09:00:00Z");
  const p2 = await pay("BOB", bob1, 20000, "2026-11-05T09:00:00Z", "mobile_money");
  await pay("CHLOE", chloe1, 10000, "2026-11-23T09:00:00Z");
  const p4 = await pay("BOB", bob1, 5000, "2026-11-23T10:00:00Z");
  await pay("BOB", bob1, -5000, "2026-11-23T11:00:00Z", "cash", p4);

  // Paiements en ligne du mois, et la réconciliation qui en a rattrapé un.
  const intent = async (status: string, createdAt: string, paymentId: string | null = null) =>
    adminQuery(
      `insert into payment_intents (school_id, academic_year_id, enrollment_id, invoice_ids, amount,
         phone, operator, status, provider, payment_id, created_by, created_at)
       values ($1, $2, $3, '{}', 20000, '+242066500001', 'mtn', $4, 'fake', $5, $6, $7)`,
      [a.schoolId, year, kid.BOB, status, paymentId, a.directorId, createdAt],
    );
  await intent("succeeded", "2026-11-05T08:59:00Z", p2);
  await intent("failed", "2026-11-10T08:00:00Z");
  await intent("expired", "2026-11-11T08:00:00Z");
  await intent("pending", "2026-11-20T08:00:00Z");
  await intent("pending", "2026-10-30T08:00:00Z");
  for (const [at, recovered] of [
    ["2026-10-20T03:00:00Z", 4],
    ["2026-11-21T03:00:00Z", 1],
  ] as const) {
    await adminQuery(
      `insert into audit_logs (school_id, actor_user_id, action, entity_type, entity_id, after, created_at)
       values ($1::uuid, $2, 'payments.reconcile', 'school', $1::text, $3, $4)`,
      [a.schoolId, a.directorId, JSON.stringify({ recovered, checked: 3 }), at],
    );
  }

  // Résultats : 6e A notée au 1er trimestre (maths coef 4, français coef 3), ADA seule au 2e.
  const evaluate = async (
    subjectName: string,
    periodId: string,
    date: string,
    values: Record<string, string>,
  ) => {
    const id = await createAssessment(director, cls["6e A"], subject[subjectName], {
      periodId,
      kind: "composition",
      title: "",
      date,
      maxScore: 20,
    });
    await saveGrades(
      director,
      id,
      Object.entries(values).map(([who, value]) => ({
        enrollmentId: kid[who],
        expected: "",
        value,
      })),
    );
  };
  await evaluate("Mathématiques", period[0], "2026-11-05", { ADA: "14", BOB: "8", CHLOE: "12" });
  await evaluate("Français", period[0], "2026-11-06", { ADA: "12", BOB: "9", CHLOE: "6" });
  await evaluate("Mathématiques", period[1], "2027-02-05", { ADA: "5" });

  // Appel : un créneau, octobre et novembre.
  const slot = (
    await adminQuery<{ id: string }>(
      "insert into time_slots (school_id, label, start_time, end_time) values ($1, 'Matin', '07:30', '12:00') returning id",
      [a.schoolId],
    )
  ).rows[0].id;
  for (const [who, date, status] of [
    ["ADA", "2026-10-20", "present"],
    ["BOB", "2026-10-20", "absent"],
    ["ADA", "2026-11-20", "absent"],
    ["BOB", "2026-11-20", "present"],
    ["CHLOE", "2026-11-20", "late"],
    ["DAVID", "2026-11-20", "present"],
    ["DAVID", "2026-11-21", "absent"],
  ]) {
    await adminQuery(
      `insert into attendance (school_id, academic_year_id, enrollment_id, date, time_slot_id, status, recorded_by)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [a.schoolId, year, kid[who], date, slot, status, a.directorId],
    );
  }
}, 60_000);

afterAll(async () => {
  await closeDb();
});

describe("Tableau de bord du directeur", () => {
  it("effectifs : par niveau et par classe, nouveaux élèves, inscriptions du mois, départs", async () => {
    const d = await getDashboard(as(a, "director"), { today: TODAY });
    expect(d.year?.label).toBe("2026-2027");
    expect(d.headcount).toEqual({
      enrolled: 4,
      girls: 2,
      boys: 2,
      preEnrolled: 1,
      newStudents: 3,
      returning: 1,
      validatedThisMonth: 1,
      left: 1,
      leftThisMonth: 1,
      leftByReason: { transfer: 0, dropout: 1, expulsion: 0 },
      rows: [
        { levelName: "6e", className: "6e A", enrolled: 3, girls: 2, boys: 1 },
        { levelName: "5e", className: "5e A", enrolled: 1, girls: 0, boys: 1 },
      ],
    });
  });

  it("encaissements du jour, du mois et de l'année (annulations déduites), recouvrement et impayés", async () => {
    const d = await getDashboard(as(a, "director"), { today: TODAY });
    expect(d.finance).toEqual({
      today: 10000,
      month: 30000,
      year: 80000,
      receiptsToday: 2,
      expected: 240000,
      paid: 80000,
      dueToDate: 90000,
      paidOnDue: 70000,
      recoveryRate: 77.8,
      arrears: 20000,
      arrearsStudents: 1,
    });
  });

  it("résultats : période en cours par défaut, taux de réussite par classe, par matière et par période", async () => {
    const d = await getDashboard(as(a, "director"), { today: TODAY });
    const r = d.results!;
    expect(r.period?.label).toBe("1er trimestre");
    expect(r.periods.map((p) => [p.label, p.ranked, p.passed, p.passRate])).toEqual([
      ["1er trimestre", 3, 1, 33.3],
      ["2e trimestre", 1, 0, 0],
      ["3e trimestre", 0, 0, null],
    ]);
    expect(
      r.summary!.classes.map((c) => [c.className, c.ranked, c.passed, c.passRate, c.average]),
    ).toEqual([
      ["6e A", 3, 1, 33.3, 10.33],
      ["5e A", 0, 0, null, null],
    ]);
    expect(r.summary!.subjects.map((s) => [s.name, s.graded, s.passed, s.passRate])).toEqual([
      ["Français", 3, 1, 33.3],
      ["Mathématiques", 3, 2, 66.7],
    ]);
    const second = await getDashboard(as(a, "director"), { today: TODAY, periodId: period[1] });
    expect(second.results!.period?.label).toBe("2e trimestre");
    expect(second.results!.summary!.passRate).toBe(0);
  });

  it("absentéisme du mois et de l'année, classes les plus touchées", async () => {
    const d = await getDashboard(as(a, "director"), { today: TODAY });
    expect(d.attendance).toEqual({
      month: { recorded: 5, absences: 2, lates: 1, rate: 40 },
      year: { recorded: 7, absences: 3, lates: 1, rate: 42.9 },
      classes: [
        { className: "5e A", recorded: 2, absences: 1, rate: 50 },
        { className: "6e A", recorded: 3, absences: 1, rate: 33.3 },
      ],
    });
  });

  it("paiements en ligne du mois : réussis, en attente (dont bloqués), échoués, rattrapés", async () => {
    const d = await getDashboard(as(a, "director"), { today: TODAY });
    expect(d.online).toEqual({
      succeeded: 1,
      succeededAmount: 20000,
      pending: 2,
      stuck: 2,
      failed: 1,
      expired: 1,
      recovered: 1,
    });
  });
});

describe("Droits", () => {
  it("le comptable ne voit que les finances ; les autres rôles n'ont pas de tableau de bord", async () => {
    const d = await getDashboard(as(a, "accountant"), { today: TODAY });
    expect(d.finance?.year).toBe(80000);
    expect(d.online?.succeeded).toBe(1);
    expect([d.headcount, d.results, d.attendance]).toEqual([null, null, null]);
    for (const role of ["teacher", "secretary", "parent"] as const) {
      await expect(getDashboard(as(a, role), { today: TODAY })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
  });

  it("une école sans année active : un tableau vide, rien d'une autre école", async () => {
    const d = await getDashboard(as(b, "director"), { today: TODAY });
    expect(d.year).toBeNull();
    expect(d.finance).toBeNull();
  });
});

describe("Performance (critère d'acceptation M7)", () => {
  it("école de 2 000 élèves : le tableau de bord se calcule en moins de 3 secondes", async () => {
    const director = as(big, "director");
    await addDefaultLevels(director, "college");
    const levels = await listLevels(director);
    const bigYear = await newYear(director);
    for (const l of levels) {
      await addDefaultGrid(director, { academicYearId: bigYear, levelId: l.id, series: "" });
      for (let i = 1; i <= 10; i++) {
        await createClass(director, bigYear, {
          levelId: l.id,
          series: "",
          name: `${l.name} ${i}`,
          capacity: "",
          headTeacherId: "",
        });
      }
    }
    await activateYear(director, bigYear);
    const params = [big.schoolId, bigYear, big.directorId];
    const classCount = levels.length * 10;
    await adminQuery(
      `with c as (
         select id as class_id, level_id, (row_number() over (order by id)) - 1 as ci
         from classes where school_id = $1 and academic_year_id = $2),
       s as (
         insert into students (school_id, matricule, last_name, first_names, sex, search_text)
         select $1, 'G' || lpad(g::text, 5, '0'), 'ELEVE' || g, 'Test',
           (case when g % 2 = 0 then 'F' else 'M' end)::sex, 'eleve' || g
         from generate_series(0, 1999) g
         returning id, matricule)
       insert into enrollments (school_id, student_id, academic_year_id, level_id, class_id, status,
         validation_mode, validated_at, entry_date)
       select $1, s.id, $2, c.level_id, c.class_id, 'enrolled', 'manual', '2026-10-02', '2026-10-01'
       from s join c on c.ci = substr(s.matricule, 2)::int % ${classCount}`,
      params.slice(0, 2),
    );
    await adminQuery(
      `insert into invoices (school_id, academic_year_id, enrollment_id, fee_name, kind, mandatory,
         installment_number, installment_count, amount, due_date)
       select $1, $2, e.id, 'Scolarité', 'tuition', true, n, 3, 50000,
         (array['2026-10-15', '2026-12-15', '2027-03-15'])[n]::date
       from enrollments e cross join generate_series(1, 3) n where e.school_id = $1`,
      params.slice(0, 2),
    );
    await adminQuery(
      `with p as (
         insert into payments (school_id, academic_year_id, enrollment_id, kind, amount, method,
           receipt_number, cashier_id, paid_at)
         select $1, $2, e.id, 'payment', 50000, 'cash', 'G-' || row_number() over (), $3,
           '2026-10-15T10:00:00Z'
         from enrollments e where e.school_id = $1 and e.id::text < 'e'
         returning id, enrollment_id)
       insert into payment_allocations (school_id, payment_id, invoice_id, amount)
       select $1, p.id, i.id, 50000
       from p join invoices i on i.enrollment_id = p.enrollment_id and i.installment_number = 1`,
      params,
    );
    const slot = await adminQuery<{ id: string }>(
      "insert into time_slots (school_id, label, start_time, end_time) values ($1, 'Matin', '07:30', '12:00') returning id",
      [big.schoolId],
    );
    await adminQuery(
      `insert into attendance (school_id, academic_year_id, enrollment_id, date, time_slot_id, status,
         recorded_by)
       select $1, $2, e.id, d::date, $4,
         (case abs(hashtext(e.id::text || d::text)) % 20 when 0 then 'absent' when 1 then 'late'
           else 'present' end)::attendance_status, $3
       from enrollments e
       cross join generate_series('2026-10-05'::date, '2026-11-20'::date, '1 day') d
       where e.school_id = $1 and extract(isodow from d) < 6`,
      [...params, slot.rows[0].id],
    );
    await adminQuery(
      `insert into assessments (school_id, academic_year_id, period_id, class_id, subject_id, kind,
         date, max_score, created_by)
       select $1, $2, p.id, cs.class_id, cs.subject_id, k::assessment_kind, p.start_date + 10, 20, $3
       from class_subjects cs
       join periods p on p.academic_year_id = $2
       cross join unnest(array['quiz', 'composition']) k
       where cs.school_id = $1`,
      params,
    );
    await adminQuery(
      `insert into grades (school_id, academic_year_id, assessment_id, enrollment_id, status, score,
         updated_by)
       select $1, $2, a.id, e.id, 'scored', (abs(hashtext(a.id::text || e.id::text)) % 2001) / 100.0, $3
       from assessments a join enrollments e on e.class_id = a.class_id
       where a.school_id = $1`,
      params,
    );
    await adminQuery("analyze");
    const counts = await adminQuery<{ grades: string; attendance: string }>(
      `select (select count(*) from grades where school_id = $1) as grades,
         (select count(*) from attendance where school_id = $1) as attendance`,
      [big.schoolId],
    );

    const started = performance.now();
    const d = await getDashboard(director, { today: TODAY });
    const elapsed = performance.now() - started;
    console.info(
      `Tableau de bord, 2 000 élèves (${counts.rows[0].grades} notes, ${counts.rows[0].attendance} appels) : ${Math.round(elapsed)} ms`,
    );
    expect(d.headcount?.enrolled).toBe(2000);
    expect(d.headcount?.rows).toHaveLength(classCount);
    expect(d.results?.summary?.classes).toHaveLength(classCount);
    expect(d.results?.summary?.ranked).toBe(2000);
    expect(d.finance?.expected).toBe(2000 * 150000);
    expect(d.attendance?.year.recorded).toBe(Number(counts.rows[0].attendance));
    expect(elapsed).toBeLessThan(3000);
  }, 180_000);
});
