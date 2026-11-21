import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import { getGrid, listSeries, SeriesSchema } from "@/modules/settings/coefficients";
import { SUGGESTED_SERIES } from "@/modules/settings/defaults";
import { listLevels, listSubjects } from "@/modules/settings/levels";
import { defaultYear, listYears } from "@/modules/settings/years";
import { can } from "@/server/auth/permissions";
import { requireAction } from "@/server/auth/session";
import { AddDefaultGridButton, GridForm } from "./grid-form";

export const metadata: Metadata = { title: t("coefficients.title") };

type Props = Pick<PageProps<"/parametres/coefficients">, "searchParams">;

export default function CoefficientsPage({ searchParams }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/accueil" className="text-blue-800 underline">
        {t("nav.home")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("coefficients.title")}</h1>
      <p>{t("coefficients.intro")}</p>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

async function Content({ searchParams }: Props) {
  const { principal } = await requireAction("settings:read");
  const query = await searchParams;
  const [years, levels, subjects] = await Promise.all([
    listYears(principal),
    listLevels(principal),
    listSubjects(principal),
  ]);
  if (years.length === 0) return <p>{t("coefficients.noYear")}</p>;
  if (levels.length === 0) return <p>{t("coefficients.noLevel")}</p>;

  const year = years.find((y) => y.id === first(query.annee)) ?? defaultYear(years)!;
  const level = levels.find((l) => l.id === first(query.niveau));
  const parsedSeries = SeriesSchema.safeParse(first(query.serie) ?? "");
  const series = level?.cycle === "lycee" && parsedSeries.success ? parsedSeries.data : "";
  const knownSeries = level ? await listSeries(principal, year.id, level.id) : [];
  const readOnly = !can(principal, "settings:write") || year.status === "archived";

  const grid = level
    ? await getGrid(principal, { academicYearId: year.id, levelId: level.id, series })
    : [];
  const coefficients = Object.fromEntries(grid.map((r) => [r.subjectId, r.coefficient]));
  const gridKey = { annee: year.id, niveau: level?.id ?? "", serie: series };

  return (
    <>
      {/* Choix de la grille : simple formulaire GET, utilisable même avant le chargement du script. */}
      <form method="get" className="flex flex-col gap-4 rounded-md bg-zinc-100 p-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="grid-year" className="font-medium">
            {t("coefficients.year")}
          </label>
          <select
            id="grid-year"
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
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="grid-level" className="font-medium">
            {t("coefficients.level")}
          </label>
          <select
            id="grid-level"
            name="niveau"
            defaultValue={level?.id ?? ""}
            className={`${inputClass} bg-white`}
          >
            <option value="" disabled>
              —
            </option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="grid-series" className="font-medium">
            {t("coefficients.series")}
          </label>
          <input
            id="grid-series"
            name="serie"
            list="series-suggestions"
            defaultValue={series}
            autoCapitalize="characters"
            className={`${inputClass} bg-white`}
            aria-describedby="series-help"
          />
          <datalist id="series-suggestions">
            {[...new Set([...knownSeries, ...SUGGESTED_SERIES])].map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <p id="series-help" className="text-sm text-zinc-600">
            {t("coefficients.seriesHelp")}
          </p>
        </div>
        <button type="submit" className="h-12 rounded-md bg-blue-700 px-4 font-semibold text-white">
          {t("coefficients.show")}
        </button>
      </form>

      {level && (
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">
            {series
              ? t("coefficients.gridTitleSeries", { niveau: level.name, serie: series })
              : t("coefficients.gridTitle", { niveau: level.name })}
          </h2>
          <p className="text-sm text-zinc-600">{t("coefficients.count", { n: grid.length })}</p>
          {year.status === "archived" && (
            <p className="rounded-md bg-zinc-100 p-3">{t("coefficients.readOnly")}</p>
          )}
          {subjects.length === 0 ? (
            <p>{t("coefficients.noSubjects")}</p>
          ) : (
            <GridForm
              gridKey={gridKey}
              subjects={subjects}
              grid={coefficients}
              readOnly={readOnly}
            />
          )}
          {!readOnly && <AddDefaultGridButton gridKey={gridKey} />}
        </section>
      )}
    </>
  );
}
