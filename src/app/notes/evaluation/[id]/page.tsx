import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { t } from "@/i18n";
import { formatDay } from "@/lib/dates";
import { getCourse, getGradeSheet } from "@/modules/grading/assessments";
import { GradingError } from "@/modules/grading/errors";
import { can } from "@/server/auth/permissions";
import { requireAction } from "@/server/auth/session";
import { refusalMessage } from "@/server/forms";
import { DeleteAssessmentForm, EditAssessmentForm } from "../../assessment-forms";
import { GradeGrid } from "../../grade-grid";
import { SyncStatus } from "../../offline/sync-status";

export const metadata: Metadata = { title: t("grading.title") };

type Props = Pick<PageProps<"/notes/evaluation/[id]">, "params">;

export default function GradeSheetPage({ params }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content params={params} />
      </Suspense>
    </main>
  );
}

async function Content({ params }: Props) {
  const { principal } = await requireAction("grades:write");
  const { id } = await params;
  let sheet;
  let course;
  try {
    sheet = await getGradeSheet(principal, id);
    course = await getCourse(principal, sheet.classId, sheet.subjectId);
  } catch (error) {
    if (error instanceof GradingError) {
      return (
        <>
          <Link href="/notes" className="text-blue-800 underline">
            {t("grading.backToCourses")}
          </Link>
          <p role="alert">{refusalMessage(error)}</p>
        </>
      );
    }
    throw error;
  }
  const writable = sheet.yearStatus !== "archived";
  const canManage = writable && can(principal, "assessments:manage");
  const owner = `${principal.schoolId}:${principal.userId}`;

  return (
    <>
      <Link
        href={`/notes/${sheet.classId}/${sheet.subjectId}?periode=${sheet.periodId}`}
        className="text-blue-800 underline"
      >
        {t("grading.backToCourse")}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">
          {t("grading.sheetTitle", {
            type: t(`grading.kinds.${sheet.kind}`),
            date: formatDay(sheet.date),
          })}
        </h1>
        {sheet.title && <p className="font-medium">{sheet.title}</p>}
        <p className="text-sm text-zinc-600">
          {t("grading.sheetSubtitle", {
            matiere: sheet.subjectName,
            classe: sheet.className,
            periode: sheet.periodLabel,
            bareme: sheet.maxScore,
          })}
        </p>
      </div>

      {writable && <SyncStatus owner={owner} />}

      {sheet.rows.length === 0 ? (
        <p>{t("grading.noStudents")}</p>
      ) : (
        <GradeGrid
          // La grille repart des valeurs enregistrées si l'évaluation change (barème, etc.).
          key={`${sheet.id}-${sheet.maxScore}`}
          owner={owner}
          assessmentId={sheet.id}
          maxScore={sheet.maxScore}
          rows={sheet.rows.map((r) => ({
            enrollmentId: r.enrollmentId,
            name: `${r.lastName} ${r.firstNames}`,
            editable: r.editable,
          }))}
          readOnly={!writable}
          serverSheet={{
            owner,
            assessmentId: sheet.id,
            classId: sheet.classId,
            subjectId: sheet.subjectId,
            periodId: sheet.periodId,
            kind: sheet.kind,
            title: sheet.title,
            date: sheet.date,
            maxScore: sheet.maxScore,
            values: Object.fromEntries(
              sheet.rows.filter((r) => r.value !== "").map((r) => [r.enrollmentId, r.value]),
            ),
          }}
        />
      )}

      {canManage && (
        <details className="rounded-md border border-zinc-300 p-4">
          <summary className="cursor-pointer font-medium">{t("grading.editAssessment")}</summary>
          <div className="mt-4 flex flex-col gap-6">
            <EditAssessmentForm
              assessmentId={sheet.id}
              periods={course.periods}
              defaults={{
                periode: sheet.periodId,
                type: sheet.kind,
                intitule: sheet.title ?? "",
                date: sheet.date,
                bareme: String(sheet.maxScore),
              }}
            />
            <DeleteAssessmentForm
              assessmentId={sheet.id}
              classId={sheet.classId}
              subjectId={sheet.subjectId}
            />
          </div>
        </details>
      )}
    </>
  );
}
