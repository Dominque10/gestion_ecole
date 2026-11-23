import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import {
  COMMENT_MAX,
  getSubjectComments,
  type SubjectCommentsSheet,
} from "@/modules/grading/council";
import { GradingError } from "@/modules/grading/errors";
import { requireAction } from "@/server/auth/session";
import { refusalMessage } from "@/server/forms";
import { SubjectCommentsForm } from "../../../council-forms";

export const metadata: Metadata = { title: t("council.commentsTitle") };

type Props = Pick<
  PageProps<"/notes/[classId]/[subjectId]/appreciations">,
  "params" | "searchParams"
>;

const num = (value: number | null) => (value === null ? "—" : value.toFixed(2).replace(".", ","));
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default function AppreciationsPage({ params, searchParams }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Content({ params, searchParams }: Props) {
  const { principal } = await requireAction("grades:write");
  const { classId, subjectId } = await params;
  const periodId = first((await searchParams).periode);
  let sheet: SubjectCommentsSheet;
  try {
    sheet = await getSubjectComments(principal, classId, subjectId, periodId);
  } catch (error) {
    if (error instanceof GradingError) return <p role="alert">{refusalMessage(error)}</p>;
    throw error;
  }
  const locked = sheet.students.some((s) => s.locked);
  const allLocked = sheet.students.length > 0 && sheet.students.every((s) => s.locked);
  return (
    <>
      <Link
        href={`/notes/${classId}/${subjectId}?periode=${sheet.period.id}`}
        className="text-blue-800 underline"
      >
        {t("grading.backToCourse")}
      </Link>
      <h1 className="text-2xl font-semibold">
        {t("council.commentsHeading", { matiere: sheet.subjectName, classe: sheet.className })}
      </h1>
      <form method="get" className="flex items-end gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="comments-period" className="font-medium">
            {t("grading.period")}
          </label>
          <select
            id="comments-period"
            name="periode"
            defaultValue={sheet.period.id}
            className={`${inputClass} bg-white`}
          >
            {sheet.periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="h-12 rounded-md border border-zinc-400 px-4 font-medium">
          {t("grading.showPeriod")}
        </button>
      </form>
      {locked && <p className="rounded-md bg-zinc-100 p-3">{t("council.lockedComments")}</p>}
      {sheet.students.length === 0 ? (
        <p>{t("grading.noStudents")}</p>
      ) : (
        <Wrapper
          locked={allLocked}
          hidden={{ classe: classId, matiere: subjectId, periode: sheet.period.id }}
        >
          <ol className="flex flex-col gap-4">
            {sheet.students.map((s) => (
              <li key={`${s.enrollmentId}-${s.comment}`} className="flex flex-col gap-1">
                <input type="hidden" name="eleve" value={s.enrollmentId} />
                <label
                  htmlFor={`com-${s.enrollmentId}`}
                  className="flex justify-between font-medium"
                >
                  <span>
                    {s.lastName} {s.firstNames}
                  </span>
                  <span className="text-zinc-600">
                    {t("council.subjectAverage", { moyenne: num(s.average) })}
                  </span>
                </label>
                <textarea
                  id={`com-${s.enrollmentId}`}
                  name={`appreciation-${s.enrollmentId}`}
                  defaultValue={s.comment}
                  maxLength={COMMENT_MAX}
                  rows={2}
                  disabled={s.locked}
                  className={`${inputClass} h-auto py-2`}
                />
              </li>
            ))}
          </ol>
        </Wrapper>
      )}
    </>
  );
}

function Wrapper({
  locked,
  hidden,
  children,
}: {
  locked: boolean;
  hidden: Record<string, string>;
  children: React.ReactNode;
}) {
  return locked ? (
    <>{children}</>
  ) : (
    <SubjectCommentsForm hidden={hidden}>{children}</SubjectCommentsForm>
  );
}
