import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import { formatDateTime } from "@/lib/dates";
import {
  ANNUAL,
  COMMENT_MAX,
  DECISIONS,
  getCouncil,
  type CouncilSheet,
} from "@/modules/grading/council";
import { GradingError } from "@/modules/grading/errors";
import { can } from "@/server/auth/permissions";
import { requireAction } from "@/server/auth/session";
import { refusalMessage } from "@/server/forms";
import { DownloadPdfButton } from "@/components/download-pdf-button";
import {
  CouncilForm,
  PublishBulletinsForm,
  ReopenCouncilForm,
  ValidateCouncilForm,
} from "../../../council-forms";

export const metadata: Metadata = { title: t("council.title") };

type Props = Pick<PageProps<"/notes/resultats/[classId]/conseil">, "params" | "searchParams">;

const num = (value: number | null) => (value === null ? "—" : value.toFixed(2).replace(".", ","));
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const rankText = (rank: number | null, tied: boolean) =>
  rank === null
    ? t("results.unranked")
    : t(tied ? "results.rankTied" : "results.rank", { n: rank, suffixe: rank === 1 ? "er" : "e" });

export default function CouncilPage({ params, searchParams }: Props) {
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
  const { classId } = await params;
  const periodKey = first((await searchParams).periode);
  let council: CouncilSheet;
  try {
    council = await getCouncil(principal, classId, periodKey);
  } catch (error) {
    if (error instanceof GradingError) return <p role="alert">{refusalMessage(error)}</p>;
    throw error;
  }
  const decides = can(principal, "reportcards:council");
  const locked = council.validatedAt !== null;
  const hidden = { classe: classId, periode: council.periodKey };
  const subjectName = new Map(council.subjects.map((s) => [s.subjectId, s.name]));

  return (
    <>
      <Link
        href={`/notes/resultats/${classId}?periode=${council.periodKey}`}
        className="text-blue-800 underline"
      >
        {t("council.backToResults")}
      </Link>
      <h1 className="text-2xl font-semibold">
        {t("council.heading", {
          classe: council.className,
          periode: council.annual ? t("results.annual") : council.periodLabel,
        })}
      </h1>
      <form method="get" className="flex items-end gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="council-period" className="font-medium">
            {t("grading.period")}
          </label>
          <select
            id="council-period"
            name="periode"
            defaultValue={council.periodKey}
            className={`${inputClass} bg-white`}
          >
            {council.periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            <option value={ANNUAL}>{t("results.annual")}</option>
          </select>
        </div>
        <button type="submit" className="h-12 rounded-md border border-zinc-400 px-4 font-medium">
          {t("grading.showPeriod")}
        </button>
      </form>

      <section
        className={`flex flex-col gap-3 rounded-md p-4 ${locked ? "bg-zinc-100" : "border border-zinc-300"}`}
      >
        <p>
          {locked
            ? t("council.stateValidated", {
                date: formatDateTime(council.validatedAt as Date),
                nom: council.validatedByName ?? "",
              })
            : council.closed
              ? t("council.stateReady")
              : t("council.stateNotClosed")}
        </p>
        {decides && !locked && council.closed && (
          <ValidateCouncilForm hidden={hidden} className={council.className} />
        )}
        {decides && locked && <ReopenCouncilForm hidden={hidden} />}
      </section>

      <section className="flex flex-col gap-3 rounded-md border border-zinc-300 p-4">
        <h2 className="text-lg font-semibold">{t("bulletins.title")}</h2>
        <p>
          {council.publishedAt
            ? t("bulletins.statePublished", { date: formatDateTime(council.publishedAt) })
            : locked
              ? t("bulletins.stateReady")
              : t("bulletins.stateDraft")}
        </p>
        {locked && !council.publishedAt && can(principal, "reportcards:publish") && (
          <PublishBulletinsForm hidden={hidden} className={council.className} />
        )}
        <DownloadPdfButton
          request={{ kind: "bulletins", classId, periodKey: council.periodKey }}
          label={t(council.publishedAt ? "bulletins.download" : "bulletins.downloadDraft")}
          variant={council.publishedAt ? "primary" : "secondary"}
        />
      </section>

      {council.students.length === 0 ? (
        <p>{t("grading.noStudents")}</p>
      ) : (
        <StudentsBlock locked={locked} hidden={hidden}>
          <ol className="flex flex-col gap-4">
            {council.students.map((s) => (
              <li
                key={`${s.enrollmentId}-${s.generalComment}-${s.mention}-${s.decision}-${locked}`}
                className="flex flex-col gap-3 rounded-md border border-zinc-300 p-3"
              >
                <input type="hidden" name="eleve" value={s.enrollmentId} />
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="w-24 text-sm text-zinc-600">{rankText(s.rank, s.tied)}</span>
                  <span className="flex-1 font-medium">
                    {s.lastName} {s.firstNames}
                  </span>
                  <span className="font-semibold">{num(s.average)}</span>
                </div>
                <p className="text-sm text-zinc-700">
                  {t("council.attendance", {
                    absences: s.attendance.absences,
                    nonjustifiees: s.attendance.unjustified,
                    retards: s.attendance.lates,
                  })}
                </p>
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-blue-800">
                    {t("council.subjectComments", {
                      n: Object.values(s.subjectComments).filter((c) => c !== "").length,
                      total: council.subjects.length,
                    })}
                  </summary>
                  <ul className="mt-2 flex flex-col gap-1 text-sm">
                    {Object.entries(s.subjectComments).map(([id, text]) => (
                      <li key={id}>
                        <span className="font-medium">{subjectName.get(id)} : </span>
                        {text || <span className="text-zinc-500">{t("council.noComment")}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`gen-${s.enrollmentId}`} className="font-medium">
                    {t("council.generalComment")}
                  </label>
                  <textarea
                    id={`gen-${s.enrollmentId}`}
                    name={`generale-${s.enrollmentId}`}
                    defaultValue={s.generalComment}
                    maxLength={COMMENT_MAX}
                    rows={2}
                    disabled={locked}
                    className={`${inputClass} h-auto py-2`}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`men-${s.enrollmentId}`} className="font-medium">
                    {t("council.mention")}
                  </label>
                  {decides && !locked ? (
                    <select
                      id={`men-${s.enrollmentId}`}
                      name={`mention-${s.enrollmentId}`}
                      defaultValue={
                        s.mention === null ? "proposee" : s.mention === "" ? "aucune" : s.mention
                      }
                      className={`${inputClass} bg-white`}
                    >
                      <option value="proposee">
                        {t("council.proposedMention", {
                          mention: s.proposedMention ?? t("council.noMention"),
                        })}
                      </option>
                      <option value="aucune">{t("council.noMention")}</option>
                      {council.mentionChoices.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p id={`men-${s.enrollmentId}`}>
                      {(s.mention ?? s.proposedMention) || t("council.noMention")}
                    </p>
                  )}
                </div>
                {council.annual && (
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`dec-${s.enrollmentId}`} className="font-medium">
                      {t("council.decision")}
                    </label>
                    {decides && !locked ? (
                      <select
                        id={`dec-${s.enrollmentId}`}
                        name={`decision-${s.enrollmentId}`}
                        defaultValue={s.decision ?? ""}
                        className={`${inputClass} bg-white`}
                      >
                        <option value="">{t("council.decisionNone")}</option>
                        {DECISIONS.map((d) => (
                          <option key={d} value={d}>
                            {t(`council.decisions.${d}`)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p id={`dec-${s.enrollmentId}`}>
                        {s.decision
                          ? t(`council.decisions.${s.decision}`)
                          : t("council.decisionNone")}
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </StudentsBlock>
      )}
    </>
  );
}

/** Conseil validé : la liste se lit seulement ; sinon elle s'enregistre. */
function StudentsBlock({
  locked,
  hidden,
  children,
}: {
  locked: boolean;
  hidden: Record<string, string>;
  children: React.ReactNode;
}) {
  return locked ? <>{children}</> : <CouncilForm hidden={hidden}>{children}</CouncilForm>;
}
