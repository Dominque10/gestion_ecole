// Opérations sur la base locale : copies venues du serveur, saisies en attente, choix en cas de conflit.
import { parseGradeInput, sameGradeValue } from "@/modules/grading/grade-input";
import {
  cellKey,
  courseKey,
  sheetKey,
  type AssessmentDraft,
  type OfflineCourse,
  type OfflineDb,
  type OfflineSheet,
  type Owner,
  type PendingCell,
} from "./db";

/** Deux textes de case désignent-ils la même valeur (« 12,50 » = « 12,5 ») ? */
export function sameCellText(a: string, b: string): boolean {
  const pa = parseGradeInput(a, 100);
  const pb = parseGradeInput(b, 100);
  if (!pa.ok || !pb.ok) return a.trim() === b.trim();
  return sameGradeValue(pa.value, pb.value);
}

/** Copie d'une matière et de ses évaluations, telle que le serveur vient de l'envoyer. */
export async function saveCourseCopy(
  db: OfflineDb,
  course: Omit<OfflineCourse, "key" | "savedAt">,
  sheets: Omit<OfflineSheet, "key" | "owner" | "classId" | "subjectId" | "savedAt">[],
): Promise<void> {
  const now = Date.now();
  const { owner, classId, subjectId } = course;
  await db.transaction("rw", db.courses, db.sheets, async () => {
    await db.courses.put({ ...course, key: courseKey(owner, classId, subjectId), savedAt: now });
    await db.sheets.bulkPut(
      sheets.map((s) => ({
        ...s,
        key: sheetKey(owner, s.assessmentId),
        owner,
        classId,
        subjectId,
        savedAt: now,
      })),
    );
  });
}

/** Copie d'une évaluation (page de saisie ouverte avec du réseau). */
export async function saveSheetCopy(
  db: OfflineDb,
  sheet: Omit<OfflineSheet, "key" | "savedAt">,
): Promise<void> {
  await db.sheets.put({
    ...sheet,
    key: sheetKey(sheet.owner, sheet.assessmentId),
    savedAt: Date.now(),
  });
}

/**
 * Crée une évaluation sur le téléphone, avec un identifiant créé ici : elle sera envoyée au retour du
 * réseau (le serveur ne la crée qu'une fois, même envoyée deux fois).
 */
export async function createLocalAssessment(
  db: OfflineDb,
  owner: Owner,
  course: Pick<OfflineCourse, "classId" | "subjectId">,
  input: AssessmentDraft,
  id: string = crypto.randomUUID(),
): Promise<string> {
  const now = Date.now();
  await db.transaction("rw", db.assessments, db.sheets, async () => {
    await db.assessments.put({
      id,
      owner,
      classId: course.classId,
      subjectId: course.subjectId,
      input,
      createdAt: now,
    });
    await db.sheets.put({
      key: sheetKey(owner, id),
      owner,
      assessmentId: id,
      classId: course.classId,
      subjectId: course.subjectId,
      periodId: input.periodId,
      kind: input.kind,
      title: input.title.trim() === "" ? null : input.title.trim(),
      date: input.date,
      maxScore: input.maxScore,
      values: {},
      savedAt: now,
    });
  });
  return id;
}

/** Supprime une évaluation créée sur le téléphone et jamais acceptée, avec ses notes. */
export async function discardLocalAssessment(db: OfflineDb, owner: Owner, id: string) {
  await db.transaction("rw", db.assessments, db.sheets, db.cells, async () => {
    await db.assessments.delete(id);
    await db.sheets.delete(sheetKey(owner, id));
    await db.cells.where("[owner+assessmentId]").equals([owner, id]).delete();
  });
}

/**
 * Enregistre des cases saisies sur le téléphone. La valeur de référence (`expected`) est celle du
 * serveur au début de la saisie : elle est gardée si la case était déjà en attente. Revenir à cette
 * valeur annule la saisie de la case.
 */
export async function recordCells(
  db: OfflineDb,
  owner: Owner,
  assessmentId: string,
  entries: readonly { enrollmentId: string; value: string }[],
): Promise<void> {
  const now = Date.now();
  await db.transaction("rw", db.cells, db.sheets, async () => {
    const sheet = await db.sheets.get(sheetKey(owner, assessmentId));
    for (const entry of entries) {
      const key = cellKey(owner, assessmentId, entry.enrollmentId);
      const existing = await db.cells.get(key);
      const expected = existing?.expected ?? sheet?.values[entry.enrollmentId] ?? "";
      if (existing?.state === "conflict") {
        // Le conflit reste à trancher : seule la saisie change.
        await db.cells.put({ ...existing, value: entry.value, updatedAt: now });
      } else if (sameCellText(entry.value, expected)) {
        if (existing) await db.cells.delete(key);
      } else {
        await db.cells.put({
          key,
          owner,
          assessmentId,
          enrollmentId: entry.enrollmentId,
          expected,
          value: entry.value,
          state: "pending",
          updatedAt: now,
        });
      }
    }
  });
}

/** Conflit : garder sa saisie, en connaissance de la valeur actuelle du serveur. */
export async function keepMine(db: OfflineDb, cell: PendingCell): Promise<void> {
  await db.cells.put({
    ...cell,
    expected: cell.current ?? cell.expected,
    state: "pending",
    current: undefined,
    error: undefined,
    updatedAt: Date.now(),
  });
}

/** Conflit ou refus : abandonner sa saisie ; la valeur du serveur (si connue) devient la référence. */
export async function discardCell(db: OfflineDb, cell: PendingCell): Promise<void> {
  await db.transaction("rw", db.cells, db.sheets, async () => {
    await db.cells.delete(cell.key);
    if (cell.state === "conflict" && cell.current !== undefined) {
      const key = sheetKey(cell.owner, cell.assessmentId);
      const sheet = await db.sheets.get(key);
      if (sheet) {
        await db.sheets.put({
          ...sheet,
          values: withValue(sheet.values, cell.enrollmentId, cell.current),
        });
      }
    }
  });
}

export function withValue(
  values: Record<string, string>,
  enrollmentId: string,
  value: string,
): Record<string, string> {
  const next = { ...values };
  if (value === "") delete next[enrollmentId];
  else next[enrollmentId] = value;
  return next;
}

/**
 * À la déconnexion : efface les copies (noms d'élèves, notes) de ce compte. Les saisies pas encore
 * envoyées sont gardées, pour ne rien perdre (hypothèse H83).
 */
export async function clearCopies(db: OfflineDb, owner: Owner): Promise<void> {
  const tables = [
    db.courses,
    db.sheets,
    db.assessments,
    db.cells,
    db.rollClasses,
    db.rollCalls,
    db.marks,
  ];
  await db.transaction("rw", tables, async () => {
    const pendingCalls = new Set(
      (await db.marks.where("owner").equals(owner).toArray()).map((m) => m.callKey),
    );
    await db.rollClasses.where("owner").equals(owner).delete();
    await db.rollCalls
      .where("owner")
      .equals(owner)
      .filter((c) => !pendingCalls.has(c.key))
      .delete();
    const pendingSheets = new Set([
      ...(await db.assessments.where("owner").equals(owner).primaryKeys()),
      ...(await db.cells.where("owner").equals(owner).toArray()).map((c) => c.assessmentId),
    ]);
    await db.courses.where("owner").equals(owner).delete();
    await db.sheets
      .where("owner")
      .equals(owner)
      .filter((s) => !pendingSheets.has(s.assessmentId))
      .delete();
  });
}

/** Nombre de saisies en attente pour ce compte (évaluations créées, cases de notes, lignes d'appel). */
export async function countPending(db: OfflineDb, owner: Owner) {
  const [assessments, cells, marks] = await Promise.all([
    db.assessments.where("owner").equals(owner).toArray(),
    db.cells.where("owner").equals(owner).toArray(),
    db.marks.where("owner").equals(owner).toArray(),
  ]);
  const lines = [...cells, ...marks];
  return {
    pending: lines.filter((c) => c.state === "pending").length,
    conflicts: lines.filter((c) => c.state === "conflict").length,
    errors:
      lines.filter((c) => c.state === "error").length + assessments.filter((a) => a.error).length,
    assessments: assessments.length,
  };
}
