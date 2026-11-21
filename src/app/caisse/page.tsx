import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import { brazzavilleDayRange, formatTime, todayInBrazzaville } from "@/lib/dates";
import { formatXAF } from "@/lib/money";
import { listInvoices } from "@/modules/finance/invoices";
import { listCashierPayments } from "@/modules/finance/payments";
import { listStudentEnrollments } from "@/modules/students/enrollments";
import { getStudent, searchStudents } from "@/modules/students/students";
import type { Principal } from "@/server/auth/permissions";
import { requireAction } from "@/server/auth/session";
import { CollectPaymentForm } from "./cash-forms";

export const metadata: Metadata = { title: t("cash.title") };

type Props = Pick<PageProps<"/caisse">, "searchParams">;

export default function CashPage({ searchParams }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/accueil" className="text-blue-800 underline">
        {t("nav.home")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("cash.title")}</h1>
      <p>{t("cash.intro")}</p>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Content({ searchParams }: Props) {
  const { principal } = await requireAction("payments:collect");
  const query = await searchParams;
  const q = first(query.q) ?? "";
  const studentId = first(query.eleve);
  const results = q && !studentId ? await searchStudents(principal, q) : [];

  return (
    <>
      <form method="get" role="search" className="flex flex-col gap-2">
        <label htmlFor="cash-search" className="font-medium">
          {t("cash.search")}
        </label>
        <div className="flex gap-2">
          <input
            id="cash-search"
            name="q"
            type="search"
            defaultValue={q}
            aria-describedby="cash-search-help"
            className={inputClass}
          />
          <button
            type="submit"
            className="h-12 shrink-0 rounded-md border border-zinc-400 px-4 font-medium"
          >
            {t("cash.searchSubmit")}
          </button>
        </div>
        <p id="cash-search-help" className="text-sm text-zinc-600">
          {t("cash.searchHelp")}
        </p>
      </form>

      {q && !studentId && results.length === 0 && <p>{t("cash.noResult")}</p>}
      {results.length > 0 && (
        <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-300">
          {results.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 p-3">
              <span>
                <span className="font-medium">
                  {s.lastName} {s.firstNames}
                </span>
                <span className="block text-sm text-zinc-600">{s.matricule}</span>
              </span>
              <Link
                href={`/caisse?eleve=${s.id}`}
                className="flex h-11 items-center rounded-md bg-blue-700 px-4 font-semibold text-white"
              >
                {t("cash.pick")}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {studentId && <CollectSection principal={principal} studentId={studentId} />}
      <TodaySection principal={principal} />
    </>
  );
}

async function CollectSection({
  principal,
  studentId,
}: {
  principal: Principal;
  studentId: string;
}) {
  const student = await getStudent(principal, studentId);
  const enrollments = (await listStudentEnrollments(principal, studentId)).filter(
    (e) => e.yearStatus !== "archived",
  );
  const withDue = (
    await Promise.all(
      enrollments.map(async (e) => {
        const invoices = await listInvoices(principal, e.id);
        return { enrollment: e, remaining: invoices.reduce((sum, i) => sum + i.remaining, 0) };
      }),
    )
  ).filter((x) => x.remaining > 0);

  return (
    <section className="flex flex-col gap-4 rounded-md border border-blue-700 p-4">
      <h2 className="text-xl font-semibold">
        {t("cash.collectTitle", { nom: `${student.lastName} ${student.firstNames}` })}
      </h2>
      {withDue.length === 0 && <p>{t("cash.noEnrollment")}</p>}
      {withDue.map(({ enrollment, remaining }) => (
        <div key={enrollment.id} className="flex flex-col gap-3">
          <p className="font-medium">
            {t("cash.yearLine", { annee: enrollment.yearLabel, niveau: enrollment.levelName })}
            {" · "}
            {t("cash.remaining", { montant: formatXAF(remaining) })}
          </p>
          <CollectPaymentForm enrollmentId={enrollment.id} />
        </div>
      ))}
    </section>
  );
}

async function TodaySection({ principal }: { principal: Principal }) {
  const rows = await listCashierPayments(principal, brazzavilleDayRange(todayInBrazzaville()));
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">{t("cash.todayTitle")}</h2>
      {rows.length === 0 ? (
        <p className="text-zinc-600">{t("cash.todayEmpty")}</p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-300 text-sm">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span>
                  <span className="font-medium">{r.studentName}</span>
                  <span className="block text-zinc-600">
                    {formatTime(r.paidAt)} · {t(`finance.methods.${r.method}`)}
                    {r.receiptNumber && ` · ${r.receiptNumber}`}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className={`font-semibold ${r.amount < 0 ? "text-red-800" : ""}`}>
                    {formatXAF(r.amount)}
                  </span>
                  {r.kind === "payment" && (
                    <Link href={`/caisse/recus/${r.id}`} className="text-blue-800 underline">
                      {t("finance.seeReceipt")}
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="font-semibold">{t("cash.todayTotal", { montant: formatXAF(total) })}</p>
        </>
      )}
    </section>
  );
}
