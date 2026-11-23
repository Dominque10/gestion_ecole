import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import { AttendanceError } from "@/modules/attendance/errors";
import {
  getRollCall,
  getRollSetup,
  type RollCall,
  type RollSetup,
} from "@/modules/attendance/roll";
import { requireAction } from "@/server/auth/session";
import { refusalMessage } from "@/server/forms";
import { SyncStatus } from "@/app/notes/offline/sync-status";
import { RollCallList } from "../roll-call-list";
import { RollClassCopy } from "../roll-class-copy";

export const metadata: Metadata = { title: t("attendance.title") };

type Props = Pick<PageProps<"/appel/[classId]">, "params" | "searchParams">;

export default function ClassRollCallPage({ params, searchParams }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/appel" className="text-blue-800 underline">
        {t("attendance.backToClasses")}
      </Link>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Créneau en cours à cette heure-ci (Brazzaville), sinon le premier de la journée. */
function currentSlot(slots: RollSetup["slots"]): string | undefined {
  const now = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Brazzaville",
  }).format(new Date());
  return (
    slots.find((s) => s.startTime.slice(0, 5) <= now && now < s.endTime.slice(0, 5)) ?? slots[0]
  )?.id;
}

async function Content({ params, searchParams }: Props) {
  const { principal } = await requireAction("attendance:write");
  const { classId } = await params;
  const query = await searchParams;
  let setup: RollSetup;
  let call: RollCall | null = null;
  let error: string | null = null;
  try {
    setup = await getRollSetup(principal, classId);
  } catch (e) {
    if (e instanceof AttendanceError) return <p role="alert">{refusalMessage(e)}</p>;
    throw e;
  }
  const date = first(query.date) ?? setup.today;
  const slotId =
    setup.slots.find((s) => s.id === first(query.creneau))?.id ?? currentSlot(setup.slots);
  const classSubjectId = setup.subjects.find(
    (s) => s.classSubjectId === first(query.cours),
  )?.classSubjectId;
  if (slotId) {
    try {
      call = await getRollCall(principal, { classId, date, slotId });
    } catch (e) {
      if (!(e instanceof AttendanceError)) throw e;
      error = refusalMessage(e);
    }
  }
  const owner = `${principal.schoolId}:${principal.userId}`;
  const writable = setup.yearStatus === "active";

  return (
    <>
      <h1 className="text-2xl font-semibold">
        {t("attendance.classTitle", { classe: setup.className })}
      </h1>
      {writable && (
        <>
          <RollClassCopy
            owner={owner}
            copy={{
              classId: setup.classId,
              className: setup.className,
              slots: setup.slots,
              subjects: setup.subjects,
              students: setup.students,
              yearStart: setup.yearStart,
              yearEnd: setup.yearEnd,
            }}
          />
          <SyncStatus owner={owner} />
        </>
      )}
      {setup.slots.length === 0 ? (
        <p>{t("attendance.noSlots")}</p>
      ) : (
        <form method="get" className="flex flex-col gap-3 rounded-md bg-zinc-100 p-4">
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor="roll-date" className="font-medium">
                {t("attendance.date")}
              </label>
              <input
                id="roll-date"
                name="date"
                type="date"
                defaultValue={date}
                min={setup.yearStart}
                max={setup.today}
                className={`${inputClass} bg-white`}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor="roll-slot" className="font-medium">
                {t("attendance.slot")}
              </label>
              <select
                id="roll-slot"
                name="creneau"
                defaultValue={slotId}
                className={`${inputClass} bg-white`}
              >
                {setup.slots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {setup.subjects.length > 0 && (
            <div className="flex flex-col gap-1">
              <label htmlFor="roll-subject" className="font-medium">
                {t("attendance.subject")}
              </label>
              <select
                id="roll-subject"
                name="cours"
                defaultValue={classSubjectId ?? ""}
                className={`${inputClass} bg-white`}
              >
                <option value="">{t("attendance.subjectNone")}</option>
                {setup.subjects.map((s) => (
                  <option key={s.classSubjectId} value={s.classSubjectId}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button
            type="submit"
            className="h-12 rounded-md border border-zinc-400 bg-white px-4 font-medium"
          >
            {t("attendance.show")}
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      {call && slotId && (
        <>
          {call.recordedByName && (
            <p className="text-sm text-zinc-600">
              {t("attendance.alreadyTaken", { nom: call.recordedByName })}
            </p>
          )}
          {setup.students.length === 0 ? (
            <p>{t("grading.noStudents")}</p>
          ) : (
            <RollCallList
              key={`${date}-${slotId}`}
              owner={owner}
              call={{ classId, date, slotId, classSubjectId: classSubjectId ?? null }}
              students={setup.students}
              readOnly={!writable}
              serverValues={call.values}
              justified={call.justified}
            />
          )}
        </>
      )}
    </>
  );
}
