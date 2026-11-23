import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ExportCard } from "@/components/export-card";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import { todayInBrazzaville } from "@/lib/dates";
import { exportChoices } from "@/modules/exports/lists";
import { listResultClasses } from "@/modules/grading/results";
import { canBrowseStudents } from "@/modules/students/students";
import { can } from "@/server/auth/permissions";
import { requireAction } from "@/server/auth/session";

export const metadata: Metadata = { title: t("exports.title") };

type Props = Pick<PageProps<"/exports">, "searchParams">;

export default function ExportsPage({ searchParams }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/accueil" className="text-blue-800 underline">
        {t("nav.home")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("exports.title")}</h1>
      <p>{t("exports.intro")}</p>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Content({ searchParams }: Props) {
  const { principal } = await requireAction("students:read");
  const query = await searchParams;
  const choices = await exportChoices(principal, first(query.annee));
  if (!choices.yearId) return <p>{t("exports.noYear")}</p>;
  const yearId = choices.yearId;
  const today = todayInBrazzaville();
  const monthStart = `${today.slice(0, 7)}-01`;

  const classField = (withAll: boolean) => ({
    name: "classId",
    label: t("exports.fields.class"),
    type: "select" as const,
    options: [
      ...(withAll ? [{ value: "", label: t("exports.fields.allClasses") }] : []),
      ...choices.classes.map((c) => ({ value: c.id, label: c.name })),
    ],
    initial: withAll ? "" : (choices.classes[0]?.id ?? ""),
  });
  const dateFields = (from: string) => [
    { name: "from", label: t("exports.fields.from"), type: "date" as const, initial: from },
    { name: "to", label: t("exports.fields.to"), type: "date" as const, initial: today },
  ];

  const director = principal.roles.includes("director");
  const resultClasses = director
    ? choices.classes
    : can(principal, "grades:write")
      ? (await listResultClasses(principal))
          .filter((r) => choices.classes.some((c) => c.id === r.classId))
          .map((r) => ({ id: r.classId, name: r.className }))
      : [];

  return (
    <>
      {choices.years.length > 1 && (
        <form method="get" className="flex items-end gap-3 rounded-md bg-zinc-100 p-3">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="exports-year" className="font-medium">
              {t("exports.fields.year")}
            </label>
            <select
              id="exports-year"
              name="annee"
              defaultValue={yearId}
              className={`${inputClass} bg-white`}
            >
              {choices.years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.label} ({t(`years.status.${y.status}`)})
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
      )}
      {canBrowseStudents(principal) && (
        <>
          <ExportCard
            key={`students-${yearId}`}
            title={t("exports.lists.students")}
            base={{ list: "students", yearId }}
            fields={[
              classField(true),
              {
                name: "status",
                label: t("exports.fields.status"),
                type: "select",
                options: [
                  { value: "all", label: t("exports.fields.statusAll") },
                  ...(["enrolled", "pre_enrolled", "left"] as const).map((s) => ({
                    value: s,
                    label: t(`enrollments.status.${s}`),
                  })),
                ],
                initial: "all",
              },
            ]}
          />
          <ExportCard
            key={`classes-${yearId}`}
            title={t("exports.lists.classes")}
            base={{ list: "classes", yearId }}
          />
        </>
      )}
      {can(principal, "dashboard:finance") && (
        <>
          <ExportCard
            key={`arrears-${yearId}`}
            title={t("exports.lists.arrears")}
            base={{ list: "arrears", yearId }}
            fields={[classField(true)]}
          />
          <ExportCard
            title={t("exports.lists.payments")}
            base={{ list: "payments" }}
            fields={dateFields(monthStart)}
          />
        </>
      )}
      {can(principal, "attendance:justify") && (
        <ExportCard
          key={`absences-${yearId}`}
          title={t("exports.lists.absences")}
          base={{ list: "absences" }}
          fields={[...dateFields(monthStart), classField(true)]}
        />
      )}
      {resultClasses.length > 0 && choices.periods.length > 0 && (
        <ExportCard
          key={`results-${yearId}`}
          title={t("exports.lists.results")}
          base={{ list: "results" }}
          fields={[
            {
              name: "classId",
              label: t("exports.fields.class"),
              type: "select",
              options: resultClasses.map((c) => ({ value: c.id, label: c.name })),
              initial: resultClasses[0].id,
            },
            {
              name: "periodKey",
              label: t("exports.fields.period"),
              type: "select",
              options: [
                ...choices.periods.map((p) => ({ value: p.id, label: p.label })),
                { value: "annee", label: t("exports.fields.annual") },
              ],
              initial: choices.periods[0].id,
            },
          ]}
        />
      )}
    </>
  );
}
