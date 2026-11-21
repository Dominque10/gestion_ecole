import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import { listClasses, listTeachers } from "@/modules/settings/classes";
import { listLevels } from "@/modules/settings/levels";
import { defaultYear, listYears } from "@/modules/settings/years";
import { can } from "@/server/auth/permissions";
import { requireAction } from "@/server/auth/session";
import { CreateClassForm } from "./class-forms";

export const metadata: Metadata = { title: t("classes.title") };

type Props = Pick<PageProps<"/parametres/classes">, "searchParams">;

export default function ClassesPage({ searchParams }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/accueil" className="text-blue-800 underline">
        {t("nav.home")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("classes.title")}</h1>
      <p>{t("classes.intro")}</p>
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
  if (years.length === 0) return <p>{t("classes.noYear")}</p>;
  if (levels.length === 0) return <p>{t("classes.noLevel")}</p>;

  const wanted = Array.isArray(query.annee) ? query.annee[0] : query.annee;
  const year = years.find((y) => y.id === wanted) ?? defaultYear(years)!;
  const [classList, teachers] = await Promise.all([
    listClasses(principal, year.id),
    listTeachers(principal),
  ]);
  const canEdit = can(principal, "settings:write") && year.status !== "archived";

  return (
    <>
      <form method="get" className="flex flex-col gap-3 rounded-md bg-zinc-100 p-4">
        <label htmlFor="classes-year" className="font-medium">
          {t("classes.year")}
        </label>
        <select
          id="classes-year"
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
          {t("classes.show")}
        </button>
      </form>

      {year.status === "archived" && (
        <p className="rounded-md bg-zinc-100 p-3">{t("classes.readOnly")}</p>
      )}

      {classList.length === 0 ? (
        <p>{t("classes.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {classList.map((c) => (
            <li key={c.id}>
              <Link
                href={`/parametres/classes/${c.id}`}
                className="flex flex-col gap-1 rounded-md border border-zinc-300 p-4"
              >
                <span className="font-semibold">{c.name}</span>
                <span className="text-sm text-zinc-600">
                  {[
                    c.series ? `${c.levelName} ${c.series}` : c.levelName,
                    t("classes.subjects", { n: c.subjectCount }),
                    c.capacity ? t("classes.capacityShort", { n: c.capacity }) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {c.headTeacherName && (
                  <span className="text-sm text-zinc-600">
                    {t("classes.headTeacherShort", { nom: c.headTeacherName })}
                  </span>
                )}
                <span className="text-blue-800 underline">{t("classes.open")}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <>
          <h2 className="text-xl font-semibold">{t("classes.createTitle")}</h2>
          <CreateClassForm
            yearId={year.id}
            levels={levels.map((l) => ({ id: l.id, name: l.name }))}
            teachers={teachers}
          />
        </>
      )}
    </>
  );
}
