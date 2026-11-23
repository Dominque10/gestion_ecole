import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import { formatDay, todayInBrazzaville } from "@/lib/dates";
import {
  getCourse,
  getCourseSheets,
  type CourseDetail,
  type CourseSheet,
} from "@/modules/grading/assessments";
import { GradingError } from "@/modules/grading/errors";
import { can } from "@/server/auth/permissions";
import { requireAction } from "@/server/auth/session";
import { refusalMessage } from "@/server/forms";
import { CreateAssessmentForm } from "../../assessment-forms";
import { CourseCopy } from "../../offline/course-copy";
import { SyncStatus } from "../../offline/sync-status";

export const metadata: Metadata = { title: t("grading.title") };

type Props = Pick<PageProps<"/notes/[classId]/[subjectId]">, "params" | "searchParams">;

export default function CoursePage({ params, searchParams }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/notes" className="text-blue-800 underline">
        {t("grading.backToCourses")}
      </Link>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

async function Content({ params, searchParams }: Props) {
  const { principal } = await requireAction("grades:write");
  const { classId, subjectId } = await params;
  let course: CourseDetail;
  let sheets: CourseSheet[];
  try {
    [course, sheets] = await Promise.all([
      getCourse(principal, classId, subjectId),
      getCourseSheets(principal, classId, subjectId),
    ]);
  } catch (error) {
    if (error instanceof GradingError) return <p role="alert">{refusalMessage(error)}</p>;
    throw error;
  }
  const query = await searchParams;
  const period =
    course.periods.find((p) => p.id === first(query.periode)) ??
    course.periods.find((p) => p.id === course.currentPeriodId);
  const shown = course.assessments.filter((a) => a.periodId === period?.id);
  const periodClosed = period !== undefined && course.closedPeriodIds.includes(period.id);
  const canCreate =
    can(principal, "assessments:manage") && course.yearStatus === "active" && !periodClosed;
  const owner = `${principal.schoolId}:${principal.userId}`;
  const offlineReady = course.yearStatus === "active" && course.periods.length > 0;

  return (
    <>
      <h1 className="text-2xl font-semibold">
        {t("grading.courseTitle", { matiere: course.subjectName, classe: course.className })}
      </h1>
      {offlineReady && (
        <>
          <CourseCopy
            owner={owner}
            course={{
              classId: course.classId,
              subjectId: course.subjectId,
              className: course.className,
              subjectName: course.subjectName,
              periods: course.periods,
              currentPeriodId: course.currentPeriodId,
              defaultMaxScore: course.defaultMaxScore,
              closedPeriodIds: course.closedPeriodIds,
              students: course.students,
            }}
            sheets={sheets}
          />
          <SyncStatus owner={owner} />
          <p className="text-sm text-zinc-600">
            {t("offline.courseReady")}{" "}
            <Link
              href={`/notes/hors-ligne#c=${course.classId}.${course.subjectId}`}
              className="text-blue-800 underline"
            >
              {t("offline.openOffline")}
            </Link>
          </p>
        </>
      )}
      {course.periods.length === 0 ? (
        <p>{t("grading.noPeriod")}</p>
      ) : (
        <>
          <form method="get" className="flex items-end gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor="course-period" className="font-medium">
                {t("grading.period")}
              </label>
              <select
                id="course-period"
                name="periode"
                defaultValue={period?.id}
                className={`${inputClass} bg-white`}
              >
                {course.periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="h-12 rounded-md border border-zinc-400 px-4 font-medium"
            >
              {t("grading.showPeriod")}
            </button>
          </form>

          <section className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold">{t("grading.assessmentsTitle")}</h2>
            {shown.length === 0 ? (
              <p>{t("grading.noAssessment")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {shown.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/notes/evaluation/${a.id}`}
                      className="flex min-h-12 flex-col justify-center rounded-md border border-zinc-400 px-4 py-2"
                    >
                      <span className="font-medium">
                        {t(`grading.kinds.${a.kind}`)} — {formatDay(a.date)} (
                        {t("grading.onScale", { n: a.maxScore })})
                      </span>
                      {a.title && <span>{a.title}</span>}
                      <span className="text-sm text-zinc-600">
                        {t("grading.filled", { n: a.filled, total: course.studentCount })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold">{t("grading.newAssessment")}</h2>
            {canCreate ? (
              <CreateAssessmentForm
                classId={course.classId}
                subjectId={course.subjectId}
                periods={course.periods}
                defaults={{
                  periode: period?.id ?? "",
                  type: "",
                  intitule: "",
                  date: todayInBrazzaville(),
                  bareme: String(course.defaultMaxScore),
                }}
              />
            ) : (
              <p className="rounded-md bg-zinc-100 p-3">
                {t(periodClosed ? "results.lockedBanner" : "grading.readOnlyYear")}
              </p>
            )}
          </section>
        </>
      )}
    </>
  );
}
