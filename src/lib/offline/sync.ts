// Envoi des saisies faites sur le téléphone, dès que le réseau le permet (3c).
// Les évaluations créées sur le téléphone partent d'abord, puis les notes, évaluation par évaluation.
// Une note changée sur le serveur entre-temps n'est jamais remplacée : elle passe en « conflit » et
// n'est plus envoyée tant que l'enseignant n'a pas choisi (CLAUDE.md §6, Hors-ligne).
import { t } from "@/i18n";
import type { GradeEntry, SaveGradesResult } from "@/modules/grading/assessments";
import {
  formatGradeValue,
  parseGradeInput,
  type GradeInputProblem,
} from "@/modules/grading/grade-input";
import type { RollCallKey, RollEntry, SaveRollResult } from "@/modules/attendance/roll";
import { sheetKey, type AssessmentDraft, type OfflineDb, type Owner, type PendingMark } from "./db";
import { withMark } from "./roll-store";
import { withValue } from "./store";

/** Réponse d'une action serveur de synchronisation (jamais de redirection). */
export type SyncReply<T> =
  { ok: true; result: T } | { ok: false; code: "session" | "refused"; message: string };

/** Appels au serveur ; une exception = pas de réseau (rien n'est perdu, on réessaiera). */
export type SyncApi = {
  createAssessment(op: {
    id: string;
    classId: string;
    subjectId: string;
    input: AssessmentDraft;
  }): Promise<SyncReply<{ id: string }>>;
  saveGrades(assessmentId: string, entries: GradeEntry[]): Promise<SyncReply<SaveGradesResult>>;
  saveRollCall(call: RollCallKey, entries: RollEntry[]): Promise<SyncReply<SaveRollResult>>;
};

export type SyncOutcome = {
  /** done : tout ce qui pouvait partir est parti ; offline : pas de réseau ; session : se reconnecter. */
  status: "done" | "offline" | "session";
  /** Cases et évaluations acceptées par le serveur pendant cet envoi. */
  sent: number;
};

/** Texte normalisé d'une case (« 12,50 » → « 12,5 »). */
function normalized(value: string): string {
  const parsed = parseGradeInput(value, 100);
  return parsed.ok ? formatGradeValue(parsed.value) : value;
}

/** Envoie tout ce qui est en attente pour ce compte. */
export async function syncPending(db: OfflineDb, owner: Owner, api: SyncApi): Promise<SyncOutcome> {
  let sent = 0;

  // 1. Évaluations créées sur le téléphone (celles déjà refusées attendent l'enseignant).
  const drafts = (await db.assessments.where("owner").equals(owner).sortBy("createdAt")).filter(
    (a) => !a.error,
  );
  for (const draft of drafts) {
    let reply: SyncReply<{ id: string }>;
    try {
      reply = await api.createAssessment({
        id: draft.id,
        classId: draft.classId,
        subjectId: draft.subjectId,
        input: draft.input,
      });
    } catch {
      return { status: "offline", sent };
    }
    if (!reply.ok && reply.code === "session") return { status: "session", sent };
    if (reply.ok) {
      await db.assessments.delete(draft.id);
      sent++;
    } else {
      await db.assessments.update(draft.id, { error: reply.message });
    }
  }

  // 2. Notes, par évaluation (pas celles d'une évaluation qui n'est pas encore sur le serveur).
  const waiting = new Set(await db.assessments.where("owner").equals(owner).primaryKeys());
  const cells = (await db.cells.where("owner").equals(owner).toArray()).filter(
    (c) => c.state === "pending" && !waiting.has(c.assessmentId),
  );
  // (Pas de Map.groupBy : absent des navigateurs Android un peu anciens.)
  const byAssessment = new Map<string, typeof cells>();
  for (const c of cells)
    byAssessment.set(c.assessmentId, [...(byAssessment.get(c.assessmentId) ?? []), c]);
  for (const [assessmentId, group] of byAssessment) {
    const entries = group.map((c) => ({
      enrollmentId: c.enrollmentId,
      expected: c.expected,
      value: c.value,
    }));
    let reply: SyncReply<SaveGradesResult>;
    try {
      reply = await api.saveGrades(assessmentId, entries);
    } catch {
      return { status: "offline", sent };
    }
    if (!reply.ok && reply.code === "session") return { status: "session", sent };

    await db.transaction("rw", db.cells, db.sheets, async () => {
      const sKey = sheetKey(owner, assessmentId);
      const sheet = await db.sheets.get(sKey);
      let values = sheet?.values ?? {};
      const problems = reply.ok
        ? new Map(reply.result.problems.map((p) => [p.enrollmentId, p.problem]))
        : new Map<string, GradeInputProblem>();
      const conflicts = reply.ok
        ? new Map(reply.result.conflicts.map((c) => [c.enrollmentId, c.current]))
        : new Map<string, string>();
      for (const sentCell of group) {
        // Relue : l'enseignant a pu modifier la case pendant l'envoi.
        const cell = await db.cells.get(sentCell.key);
        if (!cell) continue;
        const changedMeanwhile = cell.updatedAt !== sentCell.updatedAt;
        if (!reply.ok) {
          if (!changedMeanwhile)
            await db.cells.update(cell.key, { state: "error", error: reply.message });
        } else if (problems.has(cell.enrollmentId)) {
          if (!changedMeanwhile) {
            await db.cells.update(cell.key, {
              state: "error",
              error: t(`grading.problems.${problems.get(cell.enrollmentId) as GradeInputProblem}`),
            });
          }
        } else if (problems.size > 0) {
          // Une case refusée : le serveur n'a rien enregistré, les autres cases attendent.
        } else if (conflicts.has(cell.enrollmentId)) {
          const current = conflicts.get(cell.enrollmentId) as string;
          await db.cells.update(cell.key, { state: "conflict", current });
          values = withValue(values, cell.enrollmentId, current);
        } else {
          // Enregistrée (ou déjà à cette valeur) : la valeur envoyée est celle du serveur.
          const accepted = normalized(sentCell.value);
          values = withValue(values, cell.enrollmentId, accepted);
          if (changedMeanwhile) await db.cells.update(cell.key, { expected: accepted });
          else await db.cells.delete(cell.key);
          sent++;
        }
      }
      if (sheet) await db.sheets.put({ ...sheet, values });
    });
  }
  // 3. Appels (3e), appel par appel.
  const marks = (await db.marks.where("owner").equals(owner).toArray()).filter(
    (m) => m.state === "pending",
  );
  const byCall = new Map<string, PendingMark[]>();
  for (const m of marks) byCall.set(m.callKey, [...(byCall.get(m.callKey) ?? []), m]);
  for (const [ck, group] of byCall) {
    const first = group[0];
    let reply: SyncReply<SaveRollResult>;
    try {
      reply = await api.saveRollCall(
        {
          classId: first.classId,
          date: first.date,
          slotId: first.slotId,
          classSubjectId: first.classSubjectId,
        },
        group.map((m) => ({ enrollmentId: m.enrollmentId, expected: m.expected, value: m.value })),
      );
    } catch {
      return { status: "offline", sent };
    }
    if (!reply.ok && reply.code === "session") return { status: "session", sent };
    await db.transaction("rw", db.marks, db.rollCalls, async () => {
      const copy = await db.rollCalls.get(ck);
      let values = copy?.values ?? {};
      const conflicts = reply.ok
        ? new Map(reply.result.conflicts.map((c) => [c.enrollmentId, c.current as string]))
        : new Map<string, string>();
      for (const sentMark of group) {
        const mark = await db.marks.get(sentMark.key);
        if (!mark) continue;
        const changedMeanwhile = mark.updatedAt !== sentMark.updatedAt;
        if (!reply.ok) {
          if (!changedMeanwhile)
            await db.marks.update(mark.key, { state: "error", error: reply.message });
        } else if (conflicts.has(mark.enrollmentId)) {
          const current = conflicts.get(mark.enrollmentId) as string;
          await db.marks.update(mark.key, { state: "conflict", current });
          values = withMark(values, mark.enrollmentId, current);
        } else {
          values = withMark(values, mark.enrollmentId, sentMark.value);
          if (changedMeanwhile) await db.marks.update(mark.key, { expected: sentMark.value });
          else await db.marks.delete(mark.key);
          sent++;
        }
      }
      // Appel fait sans réseau : la copie du serveur naît ici.
      await db.rollCalls.put({
        key: ck,
        owner,
        classId: first.classId,
        date: first.date,
        slotId: first.slotId,
        values,
        savedAt: copy?.savedAt ?? Date.now(),
      });
    });
  }
  return { status: "done", sent };
}
