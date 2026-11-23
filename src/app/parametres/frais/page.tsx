import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import { formatDay } from "@/lib/dates";
import { formatXAF } from "@/lib/money";
import { getBulletinBlocking, getSiblingDiscount } from "@/modules/finance/invoices";
import { defaultDueDates, listFees } from "@/modules/settings/fees";
import { listLevels } from "@/modules/settings/levels";
import { defaultYear, listYears } from "@/modules/settings/years";
import { can } from "@/server/auth/permissions";
import { requireAction } from "@/server/auth/session";
import { BulletinBlockingForm, DeleteFeeButton, FeeForm, SiblingDiscountForm } from "./fee-forms";

export const metadata: Metadata = { title: t("fees.title") };

type Props = Pick<PageProps<"/parametres/frais">, "searchParams">;

export default function FeesPage({ searchParams }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/accueil" className="text-blue-800 underline">
        {t("nav.home")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("fees.title")}</h1>
      <p>{t("fees.intro")}</p>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Content({ searchParams }: Props) {
  const { principal } = await requireAction("settings:read");
  const query = await searchParams;
  const [years, levels] = await Promise.all([listYears(principal), listLevels(principal)]);
  if (years.length === 0) return <p>{t("fees.noYear")}</p>;
  if (levels.length === 0) return <p>{t("fees.noLevel")}</p>;

  const wanted = Array.isArray(query.annee) ? query.annee[0] : query.annee;
  const year = years.find((y) => y.id === wanted) ?? defaultYear(years)!;
  const [fees, dueDates, siblingPercent, blocking] = await Promise.all([
    listFees(principal, year.id),
    defaultDueDates(principal, year.id),
    getSiblingDiscount(principal),
    getBulletinBlocking(principal),
  ]);
  const canEdit = can(principal, "settings:write") && year.status !== "archived";

  return (
    <>
      <form method="get" className="flex flex-col gap-3 rounded-md bg-zinc-100 p-4">
        <label htmlFor="fees-year" className="font-medium">
          {t("fees.year")}
        </label>
        <select
          id="fees-year"
          name="annee"
          defaultValue={year.id}
          className={`${inputClass} bg-white`}
        >
          {years.map((y) => (
            <option key={y.id} value={y.id}>
              {y.label} ({t(`years.status.${y.status}`)})
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-12 rounded-md border border-zinc-400 bg-white font-medium"
        >
          {t("fees.show")}
        </button>
      </form>

      <SiblingDiscountForm percent={siblingPercent} canEdit={can(principal, "settings:write")} />
      <BulletinBlockingForm enabled={blocking} canEdit={can(principal, "settings:write")} />

      {year.status === "archived" && (
        <p className="rounded-md bg-zinc-100 p-3">{t("fees.readOnly")}</p>
      )}

      {levels.map((level) => {
        const levelFees = fees.filter((f) => f.levelId === level.id);
        const mandatoryTotal = levelFees
          .filter((f) => f.mandatory)
          .reduce((sum, f) => sum + f.total, 0);
        return (
          <section
            key={level.id}
            aria-labelledby={`level-${level.id}`}
            className="flex flex-col gap-3 rounded-md border border-zinc-300 p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`level-${level.id}`} className="text-lg font-semibold">
                {level.name}
              </h2>
              {levelFees.length > 0 && (
                <span className="text-sm font-medium">
                  {t("fees.levelTotal", { montant: formatXAF(mandatoryTotal) })}
                </span>
              )}
            </div>
            {levelFees.length === 0 ? (
              <p className="text-zinc-600">{t("fees.levelEmpty")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-zinc-200">
                {levelFees.map((fee) => (
                  <li key={fee.name} className="flex flex-col gap-2 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{fee.name}</span>
                      <span className="font-semibold">{formatXAF(fee.total)}</span>
                    </div>
                    <p className="text-sm text-zinc-600">
                      {t(`fees.kind.${fee.kind}`)} ·{" "}
                      {fee.mandatory ? t("fees.mandatoryBadge") : t("fees.optionalBadge")}
                    </p>
                    <ul className="text-sm">
                      {fee.installments.map((p) => (
                        <li key={p.number}>
                          {t("fees.installmentLine", {
                            n: p.number,
                            montant: formatXAF(p.amount),
                            date: formatDay(p.dueDate),
                          })}
                        </li>
                      ))}
                    </ul>
                    {canEdit && (
                      <div className="flex gap-2">
                        <Link
                          href={`/parametres/frais/modifier?annee=${year.id}&niveau=${level.id}&nom=${encodeURIComponent(fee.name)}`}
                          className="flex h-11 items-center rounded-md border border-zinc-400 px-3 text-sm font-medium"
                        >
                          {t("fees.edit")}
                        </Link>
                        <DeleteFeeButton yearId={year.id} levelId={level.id} name={fee.name} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {canEdit && (
        <>
          <h2 className="text-xl font-semibold">{t("fees.addTitle")}</h2>
          <FeeForm
            yearId={year.id}
            levels={levels.map((l) => ({ id: l.id, name: l.name }))}
            dueDates={dueDates}
          />
        </>
      )}
    </>
  );
}
