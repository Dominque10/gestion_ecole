"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState, useTransition } from "react";
import { FormMessage } from "@/components/form-fields";
import { t } from "@/i18n";
import {
  offlineDb,
  sheetKey,
  type OfflineSheet,
  type Owner,
  type PendingCell,
} from "@/lib/offline/db";
import {
  discardCell,
  keepMine,
  recordCells,
  saveSheetCopy,
  sameCellText,
} from "@/lib/offline/store";
import { parseGradeInput, type GradeInputProblem } from "@/modules/grading/grade-input";
import { rememberOwner, requestSync } from "./offline/sync-client";

export type GridRow = { enrollmentId: string; name: string; editable: boolean };

/**
 * Grille de saisie des notes, avec ou sans réseau. Chaque enregistrement est d'abord gardé sur le
 * téléphone, puis envoyé au serveur dès que possible ; une note changée entre-temps sur le serveur
 * n'est jamais remplacée sans l'accord de l'enseignant.
 */
export function GradeGrid({
  owner,
  assessmentId,
  maxScore,
  rows,
  readOnly,
  serverSheet,
}: {
  owner: Owner;
  assessmentId: string;
  maxScore: number;
  rows: GridRow[];
  readOnly: boolean;
  /** Valeurs fraîches du serveur (page ouverte avec du réseau), gardées sur le téléphone. */
  serverSheet?: Omit<OfflineSheet, "key" | "savedAt">;
}) {
  const db = offlineDb();
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<Record<string, GradeInputProblem>>({});
  const [message, setMessage] = useState<{ status: string; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const fields = useRef<(HTMLInputElement | null)[]>([]);
  const [openedAt] = useState(() => Date.now());

  useEffect(() => {
    rememberOwner(owner);
    // Année archivée : rien à garder sur le téléphone (plus de saisie possible).
    if (serverSheet && !readOnly) void saveSheetCopy(db, serverSheet);
  }, [db, owner, serverSheet, readOnly]);

  const stored = useLiveQuery(
    () => db.sheets.get(sheetKey(owner, assessmentId)),
    [owner, assessmentId],
  );
  const cellList = useLiveQuery(
    () => db.cells.where("[owner+assessmentId]").equals([owner, assessmentId]).toArray(),
    [owner, assessmentId],
  );
  // Valeurs du serveur : celles de la page, puis la copie du téléphone une fois rafraîchie (l'envoi
  // la tient à jour) ; sans réseau, la copie seule.
  const fresh = stored && (!serverSheet || (!readOnly && stored.savedAt >= openedAt));
  const values = (fresh ? stored.values : serverSheet?.values) ?? stored?.values ?? {};
  const cells = new Map((cellList ?? []).map((c) => [c.enrollmentId, c]));

  /** Valeur affichée : saisie en cours, sinon saisie en attente, sinon valeur du serveur. */
  const shown = (id: string) => inputs[id] ?? cells.get(id)?.value ?? values[id] ?? "";
  const base = (id: string) => cells.get(id)?.value ?? values[id] ?? "";
  const dirty = Object.keys(inputs).some((id) => !sameCellText(inputs[id], base(id)));
  const filled = rows.filter((r) => shown(r.enrollmentId).trim() !== "").length;

  // Avertir avant de quitter la page avec une saisie pas encore enregistrée sur le téléphone.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function update(id: string, value: string) {
    setInputs((all) => ({ ...all, [id]: value }));
    const parsed = parseGradeInput(value, maxScore);
    setProblems((all) => {
      const next = { ...all };
      if (parsed.ok) delete next[id];
      else next[id] = parsed.problem;
      return next;
    });
  }

  function save() {
    const edited = Object.entries(inputs).filter(([id, value]) => !sameCellText(value, base(id)));
    if (edited.length === 0) {
      setMessage({ status: "success", text: t("grading.nothingToSave") });
      return;
    }
    if (Object.keys(problems).length > 0) {
      setMessage({ status: "error", text: t("grading.rowProblems") });
      return;
    }
    startTransition(async () => {
      await recordCells(
        db,
        owner,
        assessmentId,
        edited.map(([enrollmentId, value]) => ({ enrollmentId, value })),
      );
      setInputs({});
      const outcome = await requestSync(owner);
      const left = await db.cells
        .where("[owner+assessmentId]")
        .equals([owner, assessmentId])
        .toArray();
      const conflicts = left.filter((c) => c.state !== "pending").length;
      if (conflicts > 0) {
        setMessage({ status: "error", text: t("grading.conflicts", { n: conflicts }) });
      } else if (outcome.status === "session") {
        setMessage({ status: "error", text: t("offline.status.session") });
      } else if (left.length > 0) {
        setMessage({ status: "success", text: t("offline.savedOnPhone", { n: edited.length }) });
      } else {
        setMessage({ status: "success", text: t("grading.saved", { n: edited.length }) });
      }
    });
  }

  let fieldIndex = -1;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      {!readOnly && <p className="text-sm text-zinc-700">{t("grading.help")}</p>}
      <p className="text-sm text-zinc-600">
        {t("grading.count", { n: filled, total: rows.length })}
      </p>
      <ol className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-300">
        {rows.map((row) => {
          const id = row.enrollmentId;
          const cell = cells.get(id);
          const canEdit = row.editable && !readOnly;
          const index = canEdit ? ++fieldIndex : -1;
          const problem = problems[id];
          const noteId = `grade-${id}-note`;
          const parsed = parseGradeInput(shown(id), maxScore);
          const status = parsed.ok ? parsed.value.status : null;
          return (
            <li
              key={id}
              className={`flex flex-col gap-2 px-3 py-2 ${cell && cell.state !== "pending" ? "bg-amber-50" : ""}`}
            >
              <div className="flex items-center gap-3">
                <label htmlFor={`grade-${id}`} className="flex-1">
                  <span className="font-medium">{row.name}</span>
                  {!row.editable && (
                    <span className="block text-sm text-zinc-600">
                      {t("grading.formerStudent")}
                    </span>
                  )}
                </label>
                <input
                  id={`grade-${id}`}
                  ref={(el) => {
                    if (index >= 0) fields.current[index] = el;
                  }}
                  value={shown(id)}
                  onChange={(event) => update(id, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      const next = fields.current[index + 1];
                      next?.focus();
                      next?.select();
                    }
                  }}
                  disabled={!canEdit}
                  inputMode="decimal"
                  enterKeyHint="next"
                  autoComplete="off"
                  maxLength={10}
                  aria-label={t("grading.gradeOf", { nom: row.name })}
                  aria-invalid={problem ? true : undefined}
                  aria-describedby={problem || cell ? noteId : undefined}
                  className={`h-12 w-20 rounded-md border px-2 text-center text-lg ${
                    problem ? "border-red-700" : "border-zinc-400"
                  }`}
                />
              </div>
              {canEdit && (
                <div className="flex gap-2">
                  {(["absent", "excused"] as const).map((kind) => {
                    const active = status === kind;
                    return (
                      <button
                        key={kind}
                        type="button"
                        aria-pressed={active}
                        aria-label={t(
                          kind === "absent" ? "grading.markAbsent" : "grading.markExcused",
                          { nom: row.name },
                        )}
                        onClick={() => update(id, active ? "" : kind === "absent" ? "a" : "d")}
                        className={`h-10 rounded-md border px-3 text-sm ${
                          active ? "border-blue-700 bg-blue-700 text-white" : "border-zinc-400"
                        }`}
                      >
                        {t(kind === "absent" ? "grading.absent" : "grading.excused")}
                      </button>
                    );
                  })}
                </div>
              )}
              <CellNote id={noteId} problem={problem} cell={cell} />
            </li>
          );
        })}
      </ol>
      {message && <FormMessage status={message.status} message={message.text} />}
      {!readOnly && (
        <div className="sticky bottom-0 flex flex-col gap-2 bg-white py-2">
          {dirty && <p className="text-sm text-amber-800">{t("grading.unsaved")}</p>}
          <button
            type="submit"
            disabled={pending}
            className="h-12 rounded-md bg-blue-700 px-4 text-base font-semibold text-white disabled:opacity-60"
          >
            {pending ? t("grading.savingGrades") : t("grading.saveGrades")}
          </button>
        </div>
      )}
    </form>
  );
}

const display = (value: string | undefined) =>
  value === undefined || value === "" ? t("grading.emptyValue") : value;

/** Ligne d'état d'une case : erreur de saisie, en attente d'envoi, conflit ou refus. */
function CellNote({
  id,
  problem,
  cell,
}: {
  id: string;
  problem: GradeInputProblem | undefined;
  cell: PendingCell | undefined;
}) {
  const db = offlineDb();
  if (problem) {
    return (
      <p id={id} className="text-sm text-red-800">
        {t(`grading.problems.${problem}`)}
      </p>
    );
  }
  if (!cell) return null;
  if (cell.state === "pending") {
    return (
      <p id={id} className="text-sm text-amber-800">
        {t("offline.cellPending")}
      </p>
    );
  }
  return (
    <div id={id} className="flex flex-col gap-2 text-sm">
      <p className="text-red-800">
        {cell.state === "conflict"
          ? t("offline.cellConflict", {
              mienne: display(cell.value),
              actuelle: display(cell.current),
            })
          : t("offline.cellRefused", { motif: cell.error ?? "" })}
      </p>
      <div className="flex flex-wrap gap-2">
        {cell.state === "conflict" && (
          <button
            type="button"
            onClick={() => void keepMine(db, cell).then(() => requestSync(cell.owner))}
            className="h-10 rounded-md border border-blue-700 px-3 font-medium text-blue-800"
          >
            {t("offline.keepMine", { valeur: display(cell.value) })}
          </button>
        )}
        <button
          type="button"
          onClick={() => void discardCell(db, cell)}
          className="h-10 rounded-md border border-zinc-400 px-3"
        >
          {cell.state === "conflict"
            ? t("offline.keepCurrent", { valeur: display(cell.current) })
            : t("offline.discard")}
        </button>
      </div>
    </div>
  );
}
