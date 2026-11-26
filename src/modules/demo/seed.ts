// Site de démonstration (mise en service, Sg, décision D38) : crée une école fictive complète en passant
// par les fonctions métier de l'application (mêmes règles, mêmes droits, mêmes déclencheurs qu'à
// l'usage), et l'efface chaque nuit. Ne tourne que si DEMO_SITE=true (et DEMO_MODE=true) : une vraie
// installation, même en mode démonstration, ne reçoit jamais ces données (hypothèse H159).
import pg from "pg";
import { todayInBrazzaville } from "@/lib/dates";
import { publishAnnouncement } from "@/modules/announcements/announcements";
import { saveRollCall, type RollEntry } from "@/modules/attendance/roll";
import { closeCash, getDaySummary } from "@/modules/finance/closures";
import { settleIntent, startOnlinePayment } from "@/modules/finance/online";
import { collectPayment } from "@/modules/finance/payments";
import { createAssessment, saveGrades } from "@/modules/grading/assessments";
import { publishBulletins } from "@/modules/grading/bulletins";
import { saveCouncil, validateCouncil } from "@/modules/grading/council";
import { closePeriod } from "@/modules/grading/results";
import { assignTeachers, createClass } from "@/modules/settings/classes";
import { addDefaultGrid, saveGrid } from "@/modules/settings/coefficients";
import type { Cycle } from "@/modules/settings/defaults";
import { defaultDueDates, saveFee } from "@/modules/settings/fees";
import { addDefaultLevels, listLevels, listSubjects } from "@/modules/settings/levels";
import { proposeYear } from "@/modules/settings/periods-logic";
import { createSchool } from "@/modules/settings/schools";
import { addStaff } from "@/modules/settings/staff";
import { createTimeSlot } from "@/modules/settings/time-slots";
import { activateYear, createYear } from "@/modules/settings/years";
import { assignClass, preEnroll, validateEnrollment } from "@/modules/students/enrollments";
import { createStudent } from "@/modules/students/students";
import { requestParentCode, verifyParentCode } from "@/server/auth/parent";
import type { MembershipRole, Principal } from "@/server/auth/permissions";
import { isDemoSite } from "@/server/env";
import { FakeSmsProvider } from "@/server/sms";
import { DEMO_PARENT, DEMO_PASSWORD, DEMO_SCHOOL, DEMO_STAFF } from "./accounts";

type Env = Record<string, string | undefined>;

export class DemoRefused extends Error {}

/** Refus si ce n'est pas un site de démonstration : protège une vraie installation. */
export function assertDemoSite(env: Env = process.env): void {
  if (!isDemoSite(env)) {
    throw new DemoRefused(
      "Données de démonstration refusées : DEMO_SITE=true et DEMO_MODE=true sont nécessaires " +
        "(site de démonstration seulement, jamais sur l'installation d'une vraie école).",
    );
  }
}

async function admin<T extends pg.QueryResultRow>(text: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await client.connect();
  try {
    return await client.query<T>(text, values);
  } finally {
    await client.end();
  }
}

/** L'école de démonstration existe-t-elle déjà ? */
export async function demoSchoolExists(): Promise<boolean> {
  const { rows } = await admin("select 1 from schools where code = $1", [DEMO_SCHOOL.code]);
  return rows.length > 0;
}

/**
 * Efface toutes les données (écoles, comptes, paiements, fichiers en base, tâches en attente), sauf les
 * comptes super-administrateurs de la plateforme. Réservé au site de démonstration.
 */
export async function wipeDemo(env: Env = process.env): Promise<void> {
  assertDemoSite(env);
  const { rows } = await admin<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' and tablename <> 'users'",
  );
  const client = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await client.connect();
  try {
    await client.query("begin");
    // TRUNCATE : seul moyen d'effacer les paiements (ajout seul, déclencheurs) ; voulu ici.
    await client.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} cascade`);
    await client.query("delete from users where not is_superadmin");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
  // Messages et vérifications programmés pour les anciennes données : sans objet désormais.
  await admin("delete from pgboss.job where state in ('created', 'retry')").catch(() => undefined);
}

/** Générateur pseudo-aléatoire déterministe : la démonstration est la même à chaque remise à zéro. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Noms inventés, courants au Congo ; aucune personne réelle.
const LAST_NAMES = [
  "MALONGA",
  "MOUANDA",
  "NGOMA",
  "MAKAYA",
  "BAKALA",
  "MILANDOU",
  "NZAOU",
  "MOUSSOUNDA",
  "LOEMBA",
  "MABIALA",
  "KIMPOUTOU",
  "NDINGA",
  "OKEMBA",
  "ONDONGO",
  "ITOUA",
  "ELENGA",
  "GANGA",
  "MBOUNGOU",
  "SAMBA",
  "TATY",
  "NGOULOU",
  "BATCHI",
  "MASSENGO",
  "KOUKA",
  "MAMPOUYA",
  "NKOUKA",
  "MBANI",
  "OBAMI",
];
const GIRLS = [
  "Grâce",
  "Merveille",
  "Divine",
  "Bénie",
  "Ornella",
  "Glodie",
  "Sarah",
  "Esther",
  "Ruth",
  "Gloria",
  "Prisca",
  "Dorcas",
  "Naomie",
  "Chancelvie",
  "Josiane",
  "Rebecca",
];
const BOYS = [
  "Exaucé",
  "Prince",
  "Dieudonné",
  "Junior",
  "Christ",
  "Destin",
  "Arnaud",
  "Rodrigue",
  "Fortuné",
  "Josué",
  "Jordy",
  "Michée",
  "Emmanuel",
  "Brice",
  "Hermann",
  "Gédéon",
];

type ClassPlan = {
  cycle: Cycle;
  level: string;
  series: string;
  name: string;
  size: number;
  /** Montant d'une tranche de scolarité (3 tranches). */
  tranche: number;
  coefficients: Record<string, number>;
};

const PRIMARY = { Français: 4, Mathématiques: 4, "Sciences d'observation": 2 };
const COLLEGE = { Français: 4, Mathématiques: 4, Anglais: 2, "Physique-Chimie": 2 };
const CLASSES: readonly ClassPlan[] = [
  {
    cycle: "primary",
    level: "CM2",
    series: "",
    name: "CM2 A",
    size: 28,
    tranche: 25_000,
    coefficients: PRIMARY,
  },
  {
    cycle: "college",
    level: "6e",
    series: "",
    name: "6e A",
    size: 32,
    tranche: 35_000,
    coefficients: COLLEGE,
  },
  {
    cycle: "college",
    level: "6e",
    series: "",
    name: "6e B",
    size: 30,
    tranche: 35_000,
    coefficients: COLLEGE,
  },
  {
    cycle: "college",
    level: "3e",
    series: "",
    name: "3e A",
    size: 30,
    tranche: 35_000,
    coefficients: COLLEGE,
  },
  {
    cycle: "lycee",
    level: "Tle",
    series: "D",
    name: "Tle D",
    size: 26,
    tranche: 45_000,
    coefficients: {
      Mathématiques: 4,
      "Sciences de la vie et de la Terre": 4,
      "Physique-Chimie": 4,
      Français: 2,
      Philosophie: 2,
    },
  },
];
const REGISTRATION_FEE = 15_000;

export type DemoSummary = {
  schoolId: string;
  students: number;
  payments: number;
  publishedBulletins: number;
  yearLabel: string;
};

/** Jours ouvrés (lundi à vendredi), du plus ancien au plus récent, jusqu'à `last` inclus. */
function lastSchoolDays(last: string, count: number, notBefore: string): string[] {
  const days: string[] = [];
  for (let d = last; days.length < count && d >= notBefore; d = addDays(d, -1)) {
    const weekday = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.unshift(d);
  }
  return days;
}

const minDate = (a: string, b: string) => (a < b ? a : b);

/** Date ISO décalée de `days` jours. */
function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Crée l'école de démonstration pour l'année scolaire en cours (ou la dernière, pendant les vacances).
 * Le 1er trimestre est présenté comme clôturé, bulletins publiés (décision D38) ; les périodes déjà
 * terminées aussi ; la période en cours a quelques notes.
 */
export async function seedDemo(
  options: { today?: string; env?: Env; log?: (line: string) => void } = {},
): Promise<DemoSummary> {
  assertDemoSite(options.env);
  const log = options.log ?? (() => undefined);
  const today = options.today ?? todayInBrazzaville();
  const rand = random(20261126);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)];

  // --- École, comptes ---
  const platform = (
    await admin<{ id: string }>(
      `insert into users (name, email, is_superadmin) values ('Plateforme (démonstration)', $1, true)
       on conflict (email) do update set is_superadmin = true returning id`,
      ["plateforme-demo@systeme.invalid"],
    )
  ).rows[0].id;
  const superadmin: Principal = { userId: platform, schoolId: null, roles: [], isSuperadmin: true };
  const directorAccount = DEMO_STAFF.find((s) => s.role === "director")!;
  const { schoolId, directorUserId } = await createSchool(superadmin, {
    name: DEMO_SCHOOL.name,
    code: DEMO_SCHOOL.code,
    matriculePrefix: DEMO_SCHOOL.matriculePrefix,
    directorName: directorAccount.name,
    directorIdentifier: directorAccount.identifier,
    directorPassword: DEMO_PASSWORD,
  });
  const as = (userId: string, roles: MembershipRole[]): Principal => ({
    userId,
    schoolId,
    roles,
    isSuperadmin: false,
  });
  const director = as(directorUserId, ["director"]);
  const staff: Record<string, string> = { director: directorUserId };
  for (const s of DEMO_STAFF.filter((s) => s.role !== "director")) {
    staff[s.role] = (
      await addStaff(director, {
        name: s.name,
        identifier: s.identifier,
        password: DEMO_PASSWORD,
        roles: [s.role],
      })
    ).userId;
  }
  // Caissier de la veille (pas de connexion) : sa caisse est close, celle du compte de démonstration
  // reste ouverte pour que les visiteurs puissent encaisser.
  const morningCashier = (
    await addStaff(director, {
      name: "Caisse principale",
      identifier: "caisse-principale@example.org",
      password: `${DEMO_PASSWORD}-${schoolId}`,
      roles: ["accountant"],
    })
  ).userId;
  // Comptes partagés par tous les visiteurs : pas de changement de mot de passe imposé.
  await admin("update users set must_change_password = false where email like '%@example.org'");
  log("École et comptes créés");

  // --- Année, structure, frais ---
  let year = proposeYear(today);
  if (today < year.startDate) year = proposeYear(`${Number(year.startDate.slice(0, 4)) - 1}-12-01`);
  const refDay = minDate(today, year.endDate);
  const yearId = await createYear(director, { ...year, periodKind: "trimester" });
  for (const cycle of ["primary", "college", "lycee"] as const)
    await addDefaultLevels(director, cycle);
  const levelId = new Map((await listLevels(director)).map((l) => [l.name, l.id]));
  const subjectsByName = new Map<string, string>();

  const gridDone = new Set<string>();
  for (const c of CLASSES) {
    const key = { academicYearId: yearId, levelId: levelId.get(c.level)!, series: c.series };
    const gridKey = `${c.level}:${c.series}`;
    if (gridDone.has(gridKey)) continue;
    gridDone.add(gridKey);
    await addDefaultGrid(director, key);
    for (const s of await listSubjects(director)) subjectsByName.set(s.name, s.id);
    await saveGrid(
      director,
      key,
      Object.entries(c.coefficients).map(([name, coefficient]) => ({
        subjectId: subjectsByName.get(name)!,
        coefficient,
      })),
    );
  }
  const dueDates = await defaultDueDates(director, yearId);
  const levelsOf = (filter: (c: ClassPlan) => boolean) => [
    ...new Set(CLASSES.filter(filter).map((c) => levelId.get(c.level)!)),
  ];
  await saveFee(director, yearId, {
    name: "Inscription",
    kind: "registration",
    mandatory: true,
    levelIds: levelsOf(() => true),
    installments: [{ number: 1, amount: REGISTRATION_FEE, dueDate: year.startDate }],
  });
  for (const tranche of [...new Set(CLASSES.map((c) => c.tranche))]) {
    await saveFee(director, yearId, {
      name: `Scolarité ${tranche / 1000} 000`,
      kind: "tuition",
      mandatory: true,
      levelIds: levelsOf((c) => c.tranche === tranche),
      installments: dueDates.slice(0, 3).map((dueDate, i) => ({
        number: i + 1,
        amount: tranche,
        dueDate,
      })),
    });
  }
  const morning = await createTimeSlot(director, {
    label: "Matin",
    startTime: "07:30",
    endTime: "12:30",
  });
  await createTimeSlot(director, { label: "Après-midi", startTime: "14:30", endTime: "17:30" });

  const classIds = new Map<string, string>();
  for (const c of CLASSES) {
    classIds.set(
      c.name,
      await createClass(director, yearId, {
        levelId: levelId.get(c.level)!,
        series: c.series,
        name: c.name,
        capacity: "",
        headTeacherId: c.name === "6e A" ? staff.teacher : "",
      }),
    );
  }
  // L'enseignant de démonstration : mathématiques en 6e A, 6e B et 3e A.
  for (const name of ["6e A", "6e B", "3e A"]) {
    await assignTeachers(director, classIds.get(name)!, [
      { subjectId: subjectsByName.get("Mathématiques")!, teacherId: staff.teacher },
    ]);
  }
  await activateYear(director, yearId);
  const periods = (
    await admin<{ id: string; position: number; start: string; end: string }>(
      `select id, position, start_date::text as start, end_date::text as "end"
       from periods where academic_year_id = $1 order by position`,
      [yearId],
    )
  ).rows;
  log(`Année ${year.label} et classes créées`);

  // --- Élèves (les deux premiers : enfants du parent de démonstration) ---
  const secretary = as(staff.secretary, ["secretary"]);
  const roster = new Map<string, { enrollmentId: string; ability: number }[]>();
  let count = 0;
  for (const c of CLASSES) {
    const list: { enrollmentId: string; ability: number }[] = [];
    const birthYear =
      Number(year.startDate.slice(0, 4)) - { CM2: 11, "6e": 12, "3e": 15, Tle: 18 }[c.level]!;
    for (let i = 0; i < c.size; i++) {
      const girl = rand() < 0.5;
      const lastName = pick(LAST_NAMES);
      const ownParent = (c.name === "6e A" || c.name === "CM2 A") && i === 0;
      const student = await createStudent(secretary, {
        student: {
          lastName,
          firstNames: `${pick(girl ? GIRLS : BOYS)} ${pick(girl ? GIRLS : BOYS)}`,
          sex: girl ? "F" : "M",
          birthDate: `${birthYear}-${String(1 + Math.floor(rand() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rand() * 28)).padStart(2, "0")}`,
          birthPlace: rand() < 0.6 ? "Brazzaville" : "Pointe-Noire",
          nationality: "Congolaise",
          previousSchool: "",
        },
        guardian: ownParent
          ? {
              fullName: DEMO_PARENT.name,
              phone: DEMO_PARENT.phone,
              otherPhone: "",
              relationship: "Mère",
            }
          : {
              fullName: `${rand() < 0.5 ? "Mme" : "M."} ${lastName}`,
              // 06 000 10 00, 06 000 10 01… : jamais le numéro du parent de démonstration.
              phone: `06 000 ${String(1000 + count).slice(0, 2)} ${String(1000 + count).slice(2)}`,
              otherPhone: "",
              relationship: "",
            },
      });
      const enrollmentId = await preEnroll(secretary, {
        studentId: student.id,
        academicYearId: yearId,
        levelId: levelId.get(c.level)!,
      });
      await validateEnrollment(director, enrollmentId);
      await assignClass(secretary, enrollmentId, classIds.get(c.name)!);
      list.push({ enrollmentId, ability: 6 + rand() * 10 });
      count++;
    }
    roster.set(c.name, list);
  }
  log(`${count} élèves inscrits`);

  // --- Paiements : la veille par la caisse principale (close), quelques-uns par le compte de démo ---
  const cashierOf = (n: number) =>
    as(n % 9 === 0 ? staff.accountant : morningCashier, ["accountant"]);
  let paymentCount = 0;
  let n = 0;
  for (const c of CLASSES) {
    for (const { enrollmentId } of roster.get(c.name)!) {
      n++;
      const r = rand();
      // 55 % à jour du 1er trimestre, 20 % une partie, 10 % deux tranches, 15 % rien (impayés).
      const amount =
        r < 0.55
          ? REGISTRATION_FEE + c.tranche
          : r < 0.75
            ? REGISTRATION_FEE + Math.round((c.tranche * (0.3 + rand() * 0.4)) / 500) * 500
            : r < 0.85
              ? REGISTRATION_FEE + 2 * c.tranche
              : 0;
      if (amount === 0) continue;
      const mobile = rand() < 0.3;
      await collectPayment(cashierOf(n), {
        enrollmentId,
        amount,
        method: mobile ? "mobile_money" : "cash",
        reference: mobile ? `MP${String(240000 + n * 37)}` : "",
        note: "",
      });
      paymentCount++;
    }
  }
  const summary = await getDaySummary(as(morningCashier, ["accountant"]), today);
  await closeCash(as(morningCashier, ["accountant"]), {
    day: today,
    countedCash: summary.cashTotal,
    note: "Caisse de démonstration",
  });
  log(`${paymentCount} paiements, caisse principale close`);

  // --- Paiement en ligne du parent de démonstration (faux prestataire) ---
  const sms = new FakeSmsProvider();
  await requestParentCode(DEMO_PARENT.phone, sms);
  const login = await verifyParentCode(
    DEMO_PARENT.phone,
    sms.sent[0]?.body.match(/\d{6}/)?.[0] ?? "",
  );
  if (!login.ok) throw new Error("Parent de démonstration : connexion impossible");
  const child = roster.get("6e A")![0].enrollmentId;
  const nextInvoice = (
    await admin<{ id: string }>(
      `select i.id from invoices i
       where i.enrollment_id = $1 and i.cancelled_at is null
         and i.amount - i.discount_amount > coalesce((select sum(a.amount) from payment_allocations a where a.invoice_id = i.id), 0)
       order by i.due_date limit 1`,
      [child],
    )
  ).rows[0];
  if (nextInvoice) {
    const intentId = await startOnlinePayment(
      login.principal,
      {
        enrollmentId: child,
        invoiceIds: [nextInvoice.id],
        phone: DEMO_PARENT.phone,
        operator: "mtn",
      },
      undefined,
      async () => undefined,
    );
    const ref = (
      await admin<{ ref: string }>(
        "select provider_ref as ref from payment_intents where id = $1",
        [intentId],
      )
    ).rows[0].ref;
    await settleIntent(schoolId, intentId, {
      providerRef: ref,
      status: "succeeded",
      operatorRef: "MTN-DEMO-0001",
    });
    paymentCount++;
  }
  await admin("delete from sessions where user_id = $1", [login.principal.userId]);

  // --- Notes, conseils, bulletins ---
  let published = 0;
  for (const c of CLASSES) {
    const classId = classIds.get(c.name)!;
    const pupils = roster.get(c.name)!;
    for (const p of periods.filter((p) => p.start <= refDay)) {
      const closed = p.position === 1 || p.end < refDay;
      const tests = closed
        ? [
            {
              kind: "quiz",
              title: "Interrogation 1",
              date: minDate(addDays(p.start, 14), refDay),
              max: 10,
            },
            {
              kind: "homework",
              title: "Devoir 1",
              date: minDate(addDays(p.start, 28), refDay),
              max: 20,
            },
            {
              kind: "composition",
              title: "Composition",
              date: minDate(addDays(p.end, -7), refDay),
              max: 20,
            },
          ]
        : [
            {
              kind: "quiz",
              title: "Interrogation 1",
              date: minDate(addDays(p.start, 10), refDay),
              max: 10,
            },
          ];
      for (const [subject, coefficient] of Object.entries(c.coefficients)) {
        const subjectId = subjectsByName.get(subject)!;
        const bias = (coefficient - 3) * 0.4;
        for (const test of tests) {
          const assessmentId = await createAssessment(director, classId, subjectId, {
            periodId: p.id,
            kind: test.kind,
            title: test.title,
            date: test.date,
            maxScore: test.max,
          });
          await saveGrades(
            director,
            assessmentId,
            pupils.map(({ enrollmentId, ability }) => {
              if (rand() < 0.03) return { enrollmentId, expected: "", value: "a" };
              const on20 = Math.min(20, Math.max(1, ability + bias + (rand() - 0.5) * 7));
              const score = Math.round(((on20 * test.max) / 20) * 4) / 4;
              return { enrollmentId, expected: "", value: String(score).replace(".", ",") };
            }),
          );
        }
      }
      if (!closed) continue;
      await closePeriod(director, classId, p.id);
      await saveCouncil(
        director,
        classId,
        p.id,
        pupils.map(({ enrollmentId, ability }) => ({
          enrollmentId,
          generalComment:
            ability >= 13
              ? "Très bon trimestre, continuez ainsi."
              : ability >= 10
                ? "Trimestre satisfaisant. Peut mieux faire."
                : "Résultats insuffisants : il faut redoubler d'efforts.",
        })),
      );
      await validateCouncil(director, classId, p.id);
      published += await publishBulletins(director, classId, p.id);
    }
  }
  log(`${published} bulletins publiés`);

  // --- Appel du matin, dix derniers jours de classe ---
  const days = lastSchoolDays(refDay, 10, year.startDate);
  for (const c of CLASSES) {
    for (const date of days) {
      const entries: RollEntry[] = roster.get(c.name)!.map(({ enrollmentId }) => {
        const r = rand();
        return {
          enrollmentId,
          expected: "",
          value: r < 0.04 ? "absent" : r < 0.07 ? "late" : "present",
        };
      });
      await saveRollCall(
        director,
        { classId: classIds.get(c.name)!, date, slotId: morning },
        entries,
        async () => undefined,
      );
    }
  }
  log(`Appel fait sur ${days.length} jours`);

  // --- Annonces ---
  const noMessages = async () => undefined;
  await publishAnnouncement(
    director,
    {
      audience: "school",
      levelId: null,
      classId: null,
      title: "Réunion des parents d'élèves",
      body: "Les parents sont invités à la réunion de rentrée, samedi à 9 h, dans la cour de l'école.",
      sendMessage: false,
    },
    noMessages,
  );
  await publishAnnouncement(
    director,
    {
      audience: "class",
      levelId: null,
      classId: classIds.get("6e A")!,
      title: "Sortie pédagogique",
      body: "La classe de 6e A visitera le jardin botanique vendredi. Prévoir une bouteille d'eau.",
      sendMessage: false,
    },
    noMessages,
  );
  log("Annonces publiées");

  return {
    schoolId,
    students: count,
    payments: paymentCount,
    publishedBulletins: published,
    yearLabel: year.label,
  };
}
