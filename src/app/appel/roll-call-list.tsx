"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState, useTransition } from "react";
import { FormMessage } from "@/components/form-fields";
import { t } from "@/i18n";
import { callKey, offlineDb, type Owner, type PendingMark } from "@/lib/offline/db";
import {
  discardMark,
  keepMyMark,
  recordMarks,
  saveRollCallCopy,
  type CallRef,
} from "@/lib/offline/roll-store";
import type { RollStatus } from "@/modules/attendance/roll-values";
import { rememberOwner, requestSync } from "@/app/notes/offline/sync-client";

type Student = { enrollmentId: string; lastName: string; firstNames: string };

const statusText = (value: string | undefined) =>
  t(
    value === "present" || value === "absent" || value === "late"
      ? `attendance.status.${value}`
      : "attendance.status.none",
  );

/**
 * Appel d'une classe pour un jour et un créneau, avec ou sans réseau : tous présents par défaut, un
 * toucher par absent ou retardataire. Chaque enregistrement est gardé sur le téléphone, puis envoyé.
 */
export function RollCallList({
  owner,
  call,
  students,
  readOnly = false,
  serverValues,
  justified = [],
}: {
  owner: Owner;
  call: CallRef;
  students: Student[];
  readOnly?: boolean;
  /** Appel enregistré sur le serveur (page ouverte avec du réseau). */
  serverValues?: Record<string, string>;
  justified?: string[];
}) {
  const db = offlineDb();
  const ck = callKey(owner, call.classId, call.date, call.slotId);
  const [choices, setChoices] = useState<Record<string, RollStatus>>({});
  const [message, setMessage] = useState<{ status: string; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [openedAt] = useState(() => Date.now());

  useEffect(() => {
    rememberOwner(owner);
    if (serverValues && !readOnly) void saveRollCallCopy(db, owner, call, serverValues);
    // La copie ne dépend que de l'appel ouvert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, owner, ck, serverValues, readOnly]);

  const stored = useLiveQuery(() => db.rollCalls.get(ck), [ck]);
  const markList = useLiveQuery(() => db.marks.where("callKey").equals(ck).toArray(), [ck]);
  const marks = new Map((markList ?? []).map((m) => [m.enrollmentId, m]));
  const fresh = stored && (!serverValues || (!readOnly && stored.savedAt >= openedAt));
  const base: Record<string, string> =
    (fresh ? stored.values : serverValues) ?? stored?.values ?? {};

  const known = (id: string) => marks.get(id)?.value ?? base[id] ?? "";
  /** Valeur affichée : choix en cours, sinon ligne en attente, sinon serveur, sinon présent. */
  const shown = (id: string): RollStatus => (choices[id] ?? (known(id) || "present")) as RollStatus;
  const taken = Object.keys(base).length > 0;
  const changed = students.filter((s) => shown(s.enrollmentId) !== known(s.enrollmentId));
  const counts = { present: 0, absent: 0, late: 0 };
  for (const s of students) counts[shown(s.enrollmentId)]++;

  useEffect(() => {
    if (Object.keys(choices).length === 0) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [choices]);

  function toggle(id: string, status: "absent" | "late") {
    setChoices((all) => ({ ...all, [id]: shown(id) === status ? "present" : status }));
  }

  function save() {
    if (changed.length === 0) {
      setMessage({ status: "success", text: t("grading.nothingToSave") });
      return;
    }
    const entries = changed.map((s) => ({
      enrollmentId: s.enrollmentId,
      value: shown(s.enrollmentId),
    }));
    startTransition(async () => {
      await recordMarks(db, owner, call, entries);
      setChoices({});
      const outcome = await requestSync(owner);
      const left = await db.marks.where("callKey").equals(ck).toArray();
      const toCheck = left.filter((m) => m.state !== "pending").length;
      if (toCheck > 0)
        setMessage({ status: "error", text: t("attendance.conflicts", { n: toCheck }) });
      else if (outcome.status === "session")
        setMessage({ status: "error", text: t("offline.status.session") });
      else if (left.length > 0)
        setMessage({ status: "success", text: t("attendance.savedOnPhone") });
      else setMessage({ status: "success", text: t("attendance.saved") });
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      className="flex flex-col gap-4"
    >
      {!readOnly && <p className="text-sm text-zinc-700">{t("attendance.help")}</p>}
      {!taken && <p className="text-sm text-zinc-600">{t("attendance.notTaken")}</p>}
      <p aria-live="polite" className="font-medium">
        {t("attendance.summary", {
          presents: counts.present,
          absents: counts.absent,
          retards: counts.late,
        })}
      </p>
      <ol className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-300">
        {students.map((s) => {
          const id = s.enrollmentId;
          const name = `${s.lastName} ${s.firstNames}`;
          const value = shown(id);
          const mark = marks.get(id);
          return (
            <li
              key={id}
              className={`flex flex-col gap-1 px-3 py-2 ${
                value === "absent" ? "bg-red-50" : value === "late" ? "bg-amber-50" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 font-medium">
                  {name}
                  {justified.includes(id) && value !== "present" && (
                    <span className="ml-2 text-sm text-green-800">
                      {t("attendance.justifiedBadge")}
                    </span>
                  )}
                </span>
                {(["absent", "late"] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    disabled={readOnly}
                    aria-pressed={value === status}
                    aria-label={t(
                      status === "absent" ? "attendance.markAbsent" : "attendance.markLate",
                      {
                        nom: name,
                      },
                    )}
                    onClick={() => toggle(id, status)}
                    className={`h-11 min-w-20 rounded-md border px-3 text-sm font-medium ${
                      value === status
                        ? status === "absent"
                          ? "border-red-700 bg-red-700 text-white"
                          : "border-amber-700 bg-amber-600 text-white"
                        : "border-zinc-400 bg-white"
                    }`}
                  >
                    {t(status === "absent" ? "attendance.absent" : "attendance.late")}
                  </button>
                ))}
              </div>
              {mark && <MarkNote mark={mark} />}
            </li>
          );
        })}
      </ol>
      {message && <FormMessage status={message.status} message={message.text} />}
      {!readOnly && (
        <div className="sticky bottom-0 bg-white py-2">
          <button
            type="submit"
            disabled={pending}
            className="h-12 w-full rounded-md bg-blue-700 px-4 text-base font-semibold text-white disabled:opacity-60"
          >
            {pending ? t("attendance.saving") : t("attendance.save")}
          </button>
        </div>
      )}
    </form>
  );
}

function MarkNote({ mark }: { mark: PendingMark }) {
  const db = offlineDb();
  if (mark.state === "pending") {
    return <p className="text-sm text-amber-800">{t("attendance.pending")}</p>;
  }
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-red-800">
        {mark.state === "conflict"
          ? t("attendance.conflictRow", {
              mienne: statusText(mark.value),
              actuel: statusText(mark.current),
            })
          : t("offline.cellRefused", { motif: mark.error ?? "" })}
      </p>
      <div className="flex flex-wrap gap-2">
        {mark.state === "conflict" && (
          <button
            type="button"
            onClick={() => void keepMyMark(db, mark).then(() => requestSync(mark.owner))}
            className="h-10 rounded-md border border-blue-700 px-3 font-medium text-blue-800"
          >
            {t("attendance.keepMine")}
          </button>
        )}
        <button
          type="button"
          onClick={() => void discardMark(db, mark)}
          className="h-10 rounded-md border border-zinc-400 px-3"
        >
          {mark.state === "conflict" ? t("attendance.keepCurrent") : t("offline.discard")}
        </button>
      </div>
    </div>
  );
}
