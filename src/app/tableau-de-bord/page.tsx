import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import { formatDay } from "@/lib/dates";
import { formatXAF } from "@/lib/money";
import { getDashboard, type Attendance, type Dashboard } from "@/modules/dashboard/dashboard";
import { can } from "@/server/auth/permissions";
import { requireAction, requireSession } from "@/server/auth/session";

export const metadata: Metadata = { title: t("dashboard.title") };

type Props = Pick<PageProps<"/tableau-de-bord">, "searchParams">;

export default function DashboardPage({ searchParams }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/accueil" className="text-blue-800 underline">
        {t("nav.home")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("dashboard.title")}</h1>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** Nombre à la française (12,5) ; tiret quand il n'y a rien à afficher. */
const decimal = (n: number | null) =>
  n === null ? t("dashboard.none") : String(n).replace(".", ",");
const percent = (n: number | null) =>
  n === null ? t("dashboard.none") : t("dashboard.percent", { n: decimal(n) });

async function Content({ searchParams }: Props) {
  const session = await requireSession();
  // Le directeur voit tout ; le comptable, les finances seulement.
  const { principal } = await requireAction(
    can(session.principal, "dashboard:school") ? "dashboard:school" : "dashboard:finance",
  );
  const query = await searchParams;
  const d = await getDashboard(principal, { periodId: first(query.periode) });
  if (!d.year) return <p>{t("dashboard.noYear")}</p>;
  return (
    <>
      <p>{t("dashboard.intro", { date: formatDay(d.today) })}</p>
      {d.headcount && <HeadcountSection h={d.headcount} />}
      {d.finance && <FinanceSection f={d.finance} />}
      {d.online && <OnlineSection o={d.online} />}
      {d.results && <ResultsSection r={d.results} />}
      {d.attendance && <AttendanceSection a={d.attendance} />}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `section-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Chiffre clé : un libellé, une grande valeur, un détail. */
function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-zinc-300 p-3">
      <span className="text-sm text-zinc-700">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {detail && <span className="text-sm text-zinc-700">{detail}</span>}
    </div>
  );
}

/** Ligne avec un taux : la valeur est écrite en toutes lettres, la barre ne fait que l'illustrer. */
function RateRow({ label, rate, detail }: { label: string; rate: number | null; detail: string }) {
  return (
    <li className="flex flex-col gap-1 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{label}</span>
        <span className="font-semibold tabular-nums">{percent(rate)}</span>
      </div>
      <div aria-hidden className="h-2 w-full rounded-full bg-zinc-200">
        {rate !== null && rate > 0 && (
          <div
            className="h-2 rounded-full bg-blue-700"
            style={{ width: `${Math.min(rate, 100)}%` }}
          />
        )}
      </div>
      <span className="text-sm text-zinc-700">{detail}</span>
    </li>
  );
}

function HeadcountSection({ h }: { h: NonNullable<Dashboard["headcount"]> }) {
  return (
    <Section title={t("dashboard.headcount.title")}>
      <div className="grid grid-cols-2 gap-3">
        <Tile
          label={t("dashboard.headcount.enrolled")}
          value={String(h.enrolled)}
          detail={t("dashboard.headcount.split", { filles: h.girls, garcons: h.boys })}
        />
        <Tile label={t("dashboard.headcount.newStudents")} value={String(h.newStudents)} />
        <Tile label={t("dashboard.headcount.returning")} value={String(h.returning)} />
        <Tile label={t("dashboard.headcount.preEnrolled")} value={String(h.preEnrolled)} />
        <Tile
          label={t("dashboard.headcount.validatedThisMonth")}
          value={String(h.validatedThisMonth)}
        />
        <Tile label={t("dashboard.headcount.left")} value={String(h.left)} />
      </div>
      {h.left > 0 && (
        <p className="text-sm text-zinc-700">
          {t("dashboard.headcount.leftDetail", {
            mois: h.leftThisMonth,
            transfert: h.leftByReason.transfer,
            abandon: h.leftByReason.dropout,
            exclusion: h.leftByReason.expulsion,
          })}
        </p>
      )}
      {h.rows.length > 0 && (
        <>
          <h3 className="font-semibold">{t("dashboard.headcount.byClass")}</h3>
          <ul className="flex flex-col divide-y divide-zinc-200">
            {h.rows.map((r) => (
              <li key={`${r.levelName}-${r.className}`} className="flex justify-between gap-3 py-2">
                <span>{r.className ?? `${r.levelName} · ${t("dashboard.headcount.noClass")}`}</span>
                <span className="text-zinc-700 tabular-nums">
                  {t("dashboard.headcount.classLine", {
                    n: r.enrolled,
                    filles: r.girls,
                    garcons: r.boys,
                  })}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

function FinanceSection({ f }: { f: NonNullable<Dashboard["finance"]> }) {
  return (
    <Section title={t("dashboard.finance.title")}>
      <div className="grid grid-cols-2 gap-3">
        <Tile
          label={t("dashboard.finance.today")}
          value={formatXAF(f.today)}
          detail={t("dashboard.finance.receipts", { n: f.receiptsToday })}
        />
        <Tile label={t("dashboard.finance.month")} value={formatXAF(f.month)} />
        <Tile label={t("dashboard.finance.year")} value={formatXAF(f.year)} />
        <Tile
          label={t("dashboard.finance.recovery")}
          value={percent(f.recoveryRate)}
          detail={t("dashboard.finance.recoveryDetail", {
            paye: formatXAF(f.paidOnDue),
            echu: formatXAF(f.dueToDate),
          })}
        />
      </div>
      <Tile
        label={t("dashboard.finance.arrears")}
        value={formatXAF(f.arrears)}
        detail={t("dashboard.finance.arrearsDetail", { n: f.arrearsStudents })}
      />
      <p className="text-sm text-zinc-700">
        {t("dashboard.finance.expected", {
          attendu: formatXAF(f.expected),
          paye: formatXAF(f.paid),
        })}
      </p>
      <Link href="/impayes" className="text-blue-800 underline">
        {t("dashboard.finance.arrearsLink")}
      </Link>
    </Section>
  );
}

function OnlineSection({ o }: { o: NonNullable<Dashboard["online"]> }) {
  return (
    <Section title={t("dashboard.online.title")}>
      <ul className="flex flex-col gap-1">
        <li>
          {t("dashboard.online.succeeded", {
            n: o.succeeded,
            montant: formatXAF(o.succeededAmount),
          })}
        </li>
        <li>{t("dashboard.online.pending", { n: o.pending })}</li>
        <li>{t("dashboard.online.failed", { n: o.failed, expire: o.expired })}</li>
        {o.recovered > 0 && <li>{t("dashboard.online.recovered", { n: o.recovered })}</li>}
      </ul>
      {o.stuck > 0 ? (
        <p className="rounded-md border border-amber-600 bg-amber-50 p-3" role="status">
          ⚠ {t("dashboard.online.stuck", { n: o.stuck })}
        </p>
      ) : (
        <p className="text-sm text-zinc-700">{t("dashboard.online.allClear")}</p>
      )}
    </Section>
  );
}

function ResultsSection({ r }: { r: NonNullable<Dashboard["results"]> }) {
  const summary = r.summary;
  return (
    <Section title={t("dashboard.results.title")}>
      <p className="text-sm text-zinc-700">{t("dashboard.results.passRule")}</p>
      {r.periods.length > 0 && (
        <>
          <h3 className="font-semibold">{t("dashboard.results.byPeriod")}</h3>
          <ul className="flex flex-col divide-y divide-zinc-200">
            {r.periods.map((p) => (
              <RateRow
                key={p.id}
                label={p.label}
                rate={p.passRate}
                detail={
                  p.ranked > 0
                    ? t("dashboard.results.periodLine", { reussis: p.passed, classes: p.ranked })
                    : t("dashboard.results.noGrades")
                }
              />
            ))}
          </ul>
          <form method="get" className="flex items-end gap-3 rounded-md bg-zinc-100 p-3">
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor="dashboard-period" className="font-medium">
                {t("dashboard.results.period")}
              </label>
              <select
                id="dashboard-period"
                name="periode"
                defaultValue={r.period?.id}
                className={`${inputClass} bg-white`}
              >
                {r.periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="h-12 rounded-md bg-blue-700 px-4 font-semibold text-white"
            >
              {t("dashboard.results.show")}
            </button>
          </form>
        </>
      )}
      {summary && r.period && (
        <>
          <h3 className="font-semibold">
            {t("dashboard.results.byClass")} · {r.period.label}
          </h3>
          <ul className="flex flex-col divide-y divide-zinc-200">
            {summary.classes.map((c) => (
              <RateRow
                key={c.classId}
                label={c.className}
                rate={c.passRate}
                detail={
                  c.ranked > 0
                    ? t("dashboard.results.classLine", {
                        moyenne: decimal(c.average),
                        bareme: c.scale,
                        reussis: c.passed,
                        classes: c.ranked,
                      })
                    : t("dashboard.results.noGrades")
                }
              />
            ))}
          </ul>
          {summary.subjects.length > 0 && (
            <>
              <h3 className="font-semibold">{t("dashboard.results.bySubject")}</h3>
              <ul className="flex flex-col divide-y divide-zinc-200">
                {summary.subjects.map((s) => (
                  <RateRow
                    key={s.subjectId}
                    label={s.name}
                    rate={s.passRate}
                    detail={t("dashboard.results.subjectLine", {
                      reussis: s.passed,
                      notes: s.graded,
                    })}
                  />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Section>
  );
}

function AttendanceSection({ a }: { a: NonNullable<Dashboard["attendance"]> }) {
  const detail = (x: Attendance["month"]) =>
    t("dashboard.attendance.detail", {
      absences: x.absences,
      retards: x.lates,
      appels: x.recorded,
    });
  return (
    <Section title={t("dashboard.attendance.title")}>
      <p className="text-sm text-zinc-700">{t("dashboard.attendance.intro")}</p>
      {a.year.recorded === 0 ? (
        <p>{t("dashboard.attendance.noRollCall")}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Tile
              label={t("dashboard.attendance.month")}
              value={percent(a.month.rate)}
              detail={detail(a.month)}
            />
            <Tile
              label={t("dashboard.attendance.year")}
              value={percent(a.year.rate)}
              detail={detail(a.year)}
            />
          </div>
          {a.classes.length > 0 && (
            <>
              <h3 className="font-semibold">{t("dashboard.attendance.worst")}</h3>
              <ul className="flex flex-col divide-y divide-zinc-200">
                {a.classes.map((c) => (
                  <RateRow
                    key={c.className}
                    label={c.className}
                    rate={c.rate}
                    detail={t("dashboard.attendance.classLine", {
                      absences: c.absences,
                      appels: c.recorded,
                    })}
                  />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Section>
  );
}
