import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import { listClasses } from "@/modules/settings/classes";
import { listLevels } from "@/modules/settings/levels";
import { listYears } from "@/modules/settings/years";
import { listEnrollments } from "@/modules/students/enrollments";
import { nextLevelId } from "@/modules/students/next-level";
import { requireAction } from "@/server/auth/session";
import { ReEnrollForm, type ReEnrollRow } from "./re-enroll-form";

export const metadata: Metadata = { title: t("enrollments.reEnrollTitle") };

type Props = Pick<PageProps<"/inscriptions/reinscription">, "searchParams">;

export default function ReEnrollPage({ searchParams }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/inscriptions" className="text-blue-800 underline">
        {t("enrollments.listTitle")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("enrollments.reEnrollTitle")}</h1>
      <p>{t("enrollments.reEnrollIntro")}</p>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Content({ searchParams }: Props) {
  const { principal } = await requireAction("students:write");
  const query = await searchParams;
  const [years, levels] = await Promise.all([listYears(principal), listLevels(principal)]);
  const targets = years.filter((y) => y.status !== "archived");
  if (targets.length === 0) return <p>{t("enrollments.noTargetYear")}</p>;
  const target =
    targets.find((y) => y.id === first(query.annee)) ??
    targets.find((y) => y.status === "upcoming") ??
    targets[0];

  // Classes des autres années, de la plus récente à la plus ancienne.
  const sources = (
    await Promise.all(
      years
        .filter((y) => y.id !== target.id)
        .map(async (y) =>
          (await listClasses(principal, y.id)).map((c) => ({
            id: c.id,
            label: `${y.label} · ${c.name}`,
            yearId: y.id,
          })),
        ),
    )
  ).flat();
  const source = sources.find((c) => c.id === first(query.classe));

  let rows: ReEnrollRow[] = [];
  if (source) {
    const enrolled = await listEnrollments(principal, source.yearId, {
      classId: source.id,
      status: "enrolled",
    });
    rows = enrolled.map((e) => {
      const next = nextLevelId(levels, e.levelId);
      const nextLevel = levels.find((l) => l.id === next);
      return {
        enrollmentId: e.id,
        name: `${e.lastName} ${e.firstNames}`,
        currentLevel: { id: e.levelId, name: e.levelName },
        nextLevel: nextLevel ? { id: nextLevel.id, name: nextLevel.name } : null,
      };
    });
  }

  return (
    <>
      <form method="get" className="flex flex-col gap-3 rounded-md bg-zinc-100 p-4">
        <label htmlFor="re-target" className="font-medium">
          {t("enrollments.targetYear")}
        </label>
        <select
          id="re-target"
          name="annee"
          defaultValue={target.id}
          className={`${inputClass} bg-white`}
        >
          {targets.map((y) => (
            <option key={y.id} value={y.id}>
              {y.label} ({t(`years.status.${y.status}`)})
            </option>
          ))}
        </select>
        <label htmlFor="re-source" className="font-medium">
          {t("enrollments.sourceClass")}
        </label>
        <select
          id="re-source"
          name="classe"
          defaultValue={source?.id ?? ""}
          className={`${inputClass} bg-white`}
        >
          <option value="" disabled>
            —
          </option>
          {sources.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-12 rounded-md border border-zinc-400 bg-white font-medium"
        >
          {t("enrollments.showClass")}
        </button>
      </form>

      {source &&
        (rows.length === 0 ? (
          <p>{t("enrollments.noSourceStudents")}</p>
        ) : (
          <ReEnrollForm toYearId={target.id} rows={rows} />
        ))}
    </>
  );
}
