"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { FormMessage } from "@/components/form-fields";
import { t } from "@/i18n";
import {
  formatGradeValue,
  parseGradeInput,
  sameGradeValue,
  type GradeInputProblem,
} from "@/modules/grading/grade-input";
import type { GradeSheetRow } from "@/modules/grading/assessments";
import { saveGradesAction } from "../../actions";

type Cell = {
  value: string;
  /** Valeur enregistrée connue (envoyée au serveur pour détecter une modification entre-temps). */
  original: string;
  problem?: GradeInputProblem;
  /** Valeur trouvée en base lors d'un conflit. */
  conflict?: string;
};

/** Deux textes de case désignent-ils la même valeur (« 12,50 » = « 12,5 ») ? */
function sameText(a: string, b: string, maxScore: number): boolean {
  const pa = parseGradeInput(a, maxScore);
  const pb = parseGradeInput(b, maxScore);
  if (!pa.ok || !pb.ok) return a.trim() === b.trim();
  return sameGradeValue(pa.value, pb.value);
}

export function GradeGrid({
  assessmentId,
  maxScore,
  rows,
  readOnly,
}: {
  assessmentId: string;
  maxScore: number;
  rows: GradeSheetRow[];
  readOnly: boolean;
}) {
  const [cells, setCells] = useState<Record<string, Cell>>(() =>
    Object.fromEntries(rows.map((r) => [r.enrollmentId, { value: r.value, original: r.value }])),
  );
  const [message, setMessage] = useState<{ status: string; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const editable = rows.filter((r) => r.editable && !readOnly);
  const dirty = editable.some((r) => {
    const c = cells[r.enrollmentId];
    return !sameText(c.value, c.original, maxScore);
  });
  const filled = rows.filter((r) => cells[r.enrollmentId].original !== "").length;

  // Avertir avant de quitter la page avec des notes non enregistrées.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function update(enrollmentId: string, value: string) {
    const parsed = parseGradeInput(value, maxScore);
    setCells((all) => ({
      ...all,
      [enrollmentId]: {
        ...all[enrollmentId],
        value,
        problem: parsed.ok ? undefined : parsed.problem,
      },
    }));
  }

  /** Touche Entrée : élève suivant (la note est relue à la sortie de la case). */
  function next(index: number) {
    const target = inputs.current[index + 1];
    if (target) {
      target.focus();
      target.select();
    }
  }

  function save() {
    const entries = editable
      .map((r) => ({ enrollmentId: r.enrollmentId, ...cells[r.enrollmentId] }))
      .filter((c) => !sameText(c.value, c.original, maxScore))
      .map((c) => ({ enrollmentId: c.enrollmentId, expected: c.original, value: c.value }));
    if (entries.length === 0) {
      setMessage({ status: "success", text: t("grading.nothingToSave") });
      return;
    }
    startTransition(async () => {
      const response = await saveGradesAction(assessmentId, entries);
      if (!response.ok) {
        setMessage({ status: "error", text: response.message });
        return;
      }
      const { saved, problems, conflicts } = response.result;
      const problemOf = new Map(problems.map((p) => [p.enrollmentId, p.problem]));
      const conflictOf = new Map(conflicts.map((c) => [c.enrollmentId, c.current]));
      setCells((all) => {
        const nextCells = { ...all };
        for (const entry of entries) {
          const cell = all[entry.enrollmentId];
          if (problemOf.has(entry.enrollmentId)) {
            nextCells[entry.enrollmentId] = { ...cell, problem: problemOf.get(entry.enrollmentId) };
          } else if (problems.length > 0) {
            // Rien n'a été enregistré : la case garde son état.
          } else if (conflictOf.has(entry.enrollmentId)) {
            // La saisie reste affichée ; la valeur en base devient la référence pour un nouvel envoi.
            const current = conflictOf.get(entry.enrollmentId) as string;
            nextCells[entry.enrollmentId] = {
              value: cell.value,
              original: current,
              conflict: current,
            };
          } else {
            const parsed = parseGradeInput(cell.value, maxScore);
            const text = parsed.ok ? formatGradeValue(parsed.value) : cell.value;
            nextCells[entry.enrollmentId] = { value: text, original: text };
          }
        }
        return nextCells;
      });
      if (problems.length > 0) {
        setMessage({ status: "error", text: t("grading.rowProblems") });
      } else if (conflicts.length > 0) {
        setMessage({ status: "error", text: t("grading.conflicts", { n: conflicts.length }) });
      } else {
        setMessage({ status: "success", text: t("grading.saved", { n: saved }) });
      }
    });
  }

  let inputIndex = -1;
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
          const cell = cells[row.enrollmentId];
          const name = `${row.lastName} ${row.firstNames}`;
          const canEdit = row.editable && !readOnly;
          const index = canEdit ? ++inputIndex : -1;
          const errorId = `grade-${row.enrollmentId}-error`;
          const parsed = parseGradeInput(cell.value, maxScore);
          const status = parsed.ok ? parsed.value.status : null;
          return (
            <li
              key={row.enrollmentId}
              className={`flex flex-col gap-2 px-3 py-2 ${cell.conflict !== undefined ? "bg-amber-50" : ""}`}
            >
              <div className="flex items-center gap-3">
                <label htmlFor={`grade-${row.enrollmentId}`} className="flex-1">
                  <span className="font-medium">{name}</span>
                  {!row.editable && (
                    <span className="block text-sm text-zinc-600">
                      {t("grading.formerStudent")}
                    </span>
                  )}
                </label>
                <input
                  id={`grade-${row.enrollmentId}`}
                  ref={(el) => {
                    if (index >= 0) inputs.current[index] = el;
                  }}
                  value={cell.value}
                  onChange={(event) => update(row.enrollmentId, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      next(index);
                    }
                  }}
                  disabled={!canEdit}
                  inputMode="decimal"
                  enterKeyHint="next"
                  autoComplete="off"
                  maxLength={10}
                  aria-label={t("grading.gradeOf", { nom: name })}
                  aria-invalid={cell.problem ? true : undefined}
                  aria-describedby={
                    cell.problem || cell.conflict !== undefined ? errorId : undefined
                  }
                  className={`h-12 w-20 rounded-md border px-2 text-center text-lg ${
                    cell.problem ? "border-red-700" : "border-zinc-400"
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
                          {
                            nom: name,
                          },
                        )}
                        onClick={() =>
                          update(row.enrollmentId, active ? "" : kind === "absent" ? "a" : "d")
                        }
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
              {(cell.problem || cell.conflict !== undefined) && (
                <p id={errorId} className="text-sm text-red-800">
                  {cell.problem
                    ? t(`grading.problems.${cell.problem}`)
                    : t("grading.conflictRow", {
                        valeur: cell.conflict || t("grading.emptyValue"),
                      })}
                </p>
              )}
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
