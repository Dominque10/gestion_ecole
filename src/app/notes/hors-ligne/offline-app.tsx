"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import { formatDay, todayInBrazzaville } from "@/lib/dates";
import { courseKey, offlineDb, sheetKey, type OfflineCourse, type Owner } from "@/lib/offline/db";
import { createLocalAssessment, discardLocalAssessment } from "@/lib/offline/store";
import { ASSESSMENT_KINDS, type AssessmentKind } from "@/modules/grading/grade-input";
import { GradeGrid } from "../grade-grid";
import { rememberedOwner } from "../offline/sync-client";
import { SyncStatus } from "../offline/sync-status";

// Navigation par l'ancre de l'adresse (#c=classe.matière, #e=évaluation) : la page reste statique,
// gardée par le service worker, et fonctionne sans aucun appel au serveur.
const subscribeHash = (listener: () => void) => {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
};
const readHash = () => window.location.hash.slice(1);
const noSubscription = () => () => {};
const go = (hash: string) => {
  window.location.hash = hash;
  window.scrollTo(0, 0);
};

export function OfflineApp() {
  const hash = useSyncExternalStore(subscribeHash, readHash, () => "");
  // Compte de la dernière page ouverte avec du réseau (lu dans le stockage du navigateur).
  const owner = useSyncExternalStore<Owner | null | undefined>(
    noSubscription,
    rememberedOwner,
    () => undefined,
  );

  if (owner === undefined) return <p>{t("session.loading")}</p>;
  if (owner === null) return <p>{t("offline.noOwner")}</p>;

  const params = new URLSearchParams(hash);
  const course = params.get("c");
  const assessment = params.get("e");
  return (
    <>
      <SyncStatus owner={owner} />
      {assessment ? (
        <SheetView owner={owner} assessmentId={assessment} />
      ) : course ? (
        <CourseView owner={owner} classId={course.split(".")[0]} subjectId={course.split(".")[1]} />
      ) : (
        <Home owner={owner} />
      )}
    </>
  );
}

function Home({ owner }: { owner: Owner }) {
  const courses = useLiveQuery(
    () => offlineDb().courses.where("owner").equals(owner).sortBy("className"),
    [owner],
  );
  if (!courses) return null;
  if (courses.length === 0) return <p>{t("offline.noCourse")}</p>;
  return (
    <>
      <p>{t("offline.homeIntro")}</p>
      <ul className="flex flex-col gap-2">
        {courses.map((c) => (
          <li key={c.key}>
            <a
              href={`#c=${c.classId}.${c.subjectId}`}
              className="flex min-h-12 flex-col justify-center rounded-md border border-zinc-400 px-4 py-2"
            >
              <span className="font-medium">
                {t("grading.courseTitle", { matiere: c.subjectName, classe: c.className })}
              </span>
              <span className="text-sm text-zinc-600">
                {t("offline.copiedOn", {
                  date: formatDay(todayInBrazzaville(new Date(c.savedAt))),
                })}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

function CourseView({
  owner,
  classId,
  subjectId,
}: {
  owner: Owner;
  classId: string;
  subjectId: string;
}) {
  const db = offlineDb();
  const course = useLiveQuery(
    async () => (await db.courses.get(courseKey(owner, classId, subjectId))) ?? null,
    [owner, classId, subjectId],
  );
  const sheets = useLiveQuery(
    () =>
      db.sheets.where("[owner+classId+subjectId]").equals([owner, classId, subjectId]).toArray(),
    [owner, classId, subjectId],
  );
  const drafts = useLiveQuery(() => db.assessments.where("owner").equals(owner).toArray(), [owner]);
  const [periodId, setPeriodId] = useState<string | null>(null);

  if (course === undefined || !sheets || !drafts) return null;
  if (course === null) return <NotOnPhone />;
  const period = periodId ?? course.currentPeriodId ?? course.periods[0]?.id ?? "";
  const notSent = new Map(drafts.map((d) => [d.id, d]));
  const shown = sheets
    .filter((s) => s.periodId === period)
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <>
      <a href="#" className="text-blue-800 underline">
        {t("offline.backHome")}
      </a>
      <h2 className="text-xl font-semibold">
        {t("grading.courseTitle", { matiere: course.subjectName, classe: course.className })}
      </h2>
      <div className="flex flex-col gap-1">
        <label htmlFor="offline-period" className="font-medium">
          {t("grading.period")}
        </label>
        <select
          id="offline-period"
          value={period}
          onChange={(event) => setPeriodId(event.target.value)}
          className={`${inputClass} bg-white`}
        >
          {course.periods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <section className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold">{t("grading.assessmentsTitle")}</h3>
        {shown.length === 0 ? (
          <p>{t("grading.noAssessment")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {shown.map((s) => (
              <li key={s.key}>
                <a
                  href={`#e=${s.assessmentId}`}
                  className="flex min-h-12 flex-col justify-center rounded-md border border-zinc-400 px-4 py-2"
                >
                  <span className="font-medium">
                    {t(`grading.kinds.${s.kind}`)} — {formatDay(s.date)} (
                    {t("grading.onScale", { n: s.maxScore })})
                  </span>
                  {s.title && <span>{s.title}</span>}
                  {notSent.has(s.assessmentId) && (
                    <span className="text-sm text-amber-800">
                      {notSent.get(s.assessmentId)?.error
                        ? t("offline.assessmentRefused")
                        : t("offline.assessmentNotSent")}
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold">{t("grading.newAssessment")}</h3>
        <NewAssessmentForm owner={owner} course={course} periodId={period} />
      </section>
    </>
  );
}

function NewAssessmentForm({
  owner,
  course,
  periodId,
}: {
  owner: Owner;
  course: OfflineCourse;
  periodId: string;
}) {
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const kind = String(data.get("type") ?? "") as AssessmentKind;
    const date = String(data.get("date") ?? "");
    const maxScore = Number(data.get("bareme"));
    const period = String(data.get("periode") ?? "");
    const valid =
      ASSESSMENT_KINDS.includes(kind) &&
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      Number.isInteger(maxScore) &&
      maxScore >= 1 &&
      maxScore <= 100 &&
      course.periods.some((p) => p.id === period);
    if (!valid) {
      setError(t("grading.errors.assessmentInvalid"));
      return;
    }
    const id = await createLocalAssessment(offlineDb(), owner, course, {
      periodId: period,
      kind,
      title: String(data.get("intitule") ?? "").slice(0, 80),
      date,
      maxScore,
    });
    go(`e=${id}`);
  }

  return (
    <form
      key={periodId}
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-4 rounded-md bg-zinc-100 p-4"
      noValidate
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">{t("grading.kind")}</legend>
        <div className="flex flex-wrap gap-2">
          {ASSESSMENT_KINDS.map((kind) => (
            <label
              key={kind}
              className="flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3"
            >
              <input type="radio" name="type" value={kind} className="size-5" />
              {t(`grading.kinds.${kind}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-1">
        <label htmlFor="offline-new-period" className="font-medium">
          {t("grading.period")}
        </label>
        <select
          id="offline-new-period"
          name="periode"
          defaultValue={periodId}
          className={`${inputClass} bg-white`}
        >
          {course.periods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="offline-new-date" className="font-medium">
          {t("grading.date")}
        </label>
        <input
          id="offline-new-date"
          name="date"
          type="date"
          defaultValue={todayInBrazzaville()}
          className={`${inputClass} bg-white`}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="offline-new-scale" className="font-medium">
          {t("grading.maxScore")}
        </label>
        <input
          id="offline-new-scale"
          name="bareme"
          type="number"
          inputMode="numeric"
          min={1}
          max={100}
          defaultValue={course.defaultMaxScore}
          className={`${inputClass} bg-white`}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="offline-new-title" className="font-medium">
          {t("grading.assessmentTitle")}
        </label>
        <input
          id="offline-new-title"
          name="intitule"
          maxLength={80}
          className={`${inputClass} bg-white`}
        />
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      <button type="submit" className="h-12 rounded-md bg-blue-700 px-4 font-semibold text-white">
        {t("grading.create")}
      </button>
    </form>
  );
}

function SheetView({ owner, assessmentId }: { owner: Owner; assessmentId: string }) {
  const db = offlineDb();
  const sheet = useLiveQuery(
    async () => (await db.sheets.get(sheetKey(owner, assessmentId))) ?? null,
    [owner, assessmentId],
  );
  const course = useLiveQuery(
    async () =>
      sheet
        ? ((await db.courses.get(courseKey(owner, sheet.classId, sheet.subjectId))) ?? null)
        : null,
    [owner, sheet?.classId, sheet?.subjectId],
  );
  const draft = useLiveQuery(
    async () => (await db.assessments.get(assessmentId)) ?? null,
    [assessmentId],
  );

  if (sheet === undefined || course === undefined || draft === undefined) return null;
  if (sheet === null || course === null) return <NotOnPhone />;
  const periodLabel = course.periods.find((p) => p.id === sheet.periodId)?.label ?? "";

  return (
    <>
      <a href={`#c=${sheet.classId}.${sheet.subjectId}`} className="text-blue-800 underline">
        {t("grading.backToCourse")}
      </a>
      <div>
        <h2 className="text-xl font-semibold">
          {t("grading.sheetTitle", {
            type: t(`grading.kinds.${sheet.kind}`),
            date: formatDay(sheet.date),
          })}
        </h2>
        {sheet.title && <p className="font-medium">{sheet.title}</p>}
        <p className="text-sm text-zinc-600">
          {t("grading.sheetSubtitle", {
            matiere: course.subjectName,
            classe: course.className,
            periode: periodLabel,
            bareme: sheet.maxScore,
          })}
        </p>
      </div>
      {draft && (
        <div className="flex flex-col gap-2 rounded-md bg-zinc-100 p-3">
          <p>
            {draft.error
              ? t("offline.assessmentRefusedReason", { motif: draft.error })
              : t("offline.assessmentNotSentLong")}
          </p>
          {draft.error && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(t("offline.discardAssessmentConfirm"))) {
                  void discardLocalAssessment(db, owner, assessmentId).then(() =>
                    go(`c=${sheet.classId}.${sheet.subjectId}`),
                  );
                }
              }}
              className="h-11 rounded-md border border-red-700 px-4 font-medium text-red-800"
            >
              {t("offline.discardAssessment")}
            </button>
          )}
        </div>
      )}
      {course.students.length === 0 ? (
        <p>{t("grading.noStudents")}</p>
      ) : (
        <GradeGrid
          key={`${assessmentId}-${sheet.maxScore}`}
          owner={owner}
          assessmentId={assessmentId}
          maxScore={sheet.maxScore}
          rows={course.students.map((s) => ({
            enrollmentId: s.enrollmentId,
            name: `${s.lastName} ${s.firstNames}`,
            editable: true,
          }))}
          readOnly={false}
        />
      )}
    </>
  );
}

function NotOnPhone() {
  return (
    <>
      <a href="#" className="text-blue-800 underline">
        {t("offline.backHome")}
      </a>
      <p>{t("offline.notOnPhone")}</p>
    </>
  );
}
