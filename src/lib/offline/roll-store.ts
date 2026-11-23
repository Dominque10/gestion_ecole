// Appel sur le téléphone (3e) : copies venues du serveur, lignes en attente, choix en cas de conflit.
import {
  callKey,
  markKey,
  rollClassKey,
  type OfflineDb,
  type OfflineRollClass,
  type Owner,
  type PendingMark,
} from "./db";

export type CallRef = {
  classId: string;
  date: string;
  slotId: string;
  classSubjectId: string | null;
};

/** Copie d'une classe pour l'appel (ouverte avec du réseau). */
export async function saveRollClassCopy(
  db: OfflineDb,
  copy: Omit<OfflineRollClass, "key" | "savedAt">,
): Promise<void> {
  await db.rollClasses.put({
    ...copy,
    key: rollClassKey(copy.owner, copy.classId),
    savedAt: Date.now(),
  });
}

/** Appel tel que le serveur vient de l'envoyer. */
export async function saveRollCallCopy(
  db: OfflineDb,
  owner: Owner,
  call: Omit<CallRef, "classSubjectId">,
  values: Record<string, string>,
): Promise<void> {
  await db.rollCalls.put({
    key: callKey(owner, call.classId, call.date, call.slotId),
    owner,
    ...call,
    values,
    savedAt: Date.now(),
  });
}

/**
 * Enregistre des lignes d'appel sur le téléphone. La valeur de référence (`expected`) est celle du
 * serveur au début de l'appel (« » si l'appel n'était pas fait), gardée si la ligne attendait déjà.
 */
export async function recordMarks(
  db: OfflineDb,
  owner: Owner,
  call: CallRef,
  entries: readonly { enrollmentId: string; value: string }[],
): Promise<void> {
  const now = Date.now();
  const ck = callKey(owner, call.classId, call.date, call.slotId);
  await db.transaction("rw", db.marks, db.rollCalls, async () => {
    const known = (await db.rollCalls.get(ck))?.values ?? {};
    for (const entry of entries) {
      const key = markKey(ck, entry.enrollmentId);
      const existing = await db.marks.get(key);
      const expected = existing?.expected ?? known[entry.enrollmentId] ?? "";
      if (existing?.state === "conflict") {
        await db.marks.put({ ...existing, value: entry.value, updatedAt: now });
      } else if (entry.value === expected) {
        if (existing) await db.marks.delete(key);
      } else {
        await db.marks.put({
          key,
          owner,
          callKey: ck,
          ...call,
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
export async function keepMyMark(db: OfflineDb, mark: PendingMark): Promise<void> {
  await db.marks.put({
    ...mark,
    expected: mark.current ?? mark.expected,
    state: "pending",
    current: undefined,
    error: undefined,
    updatedAt: Date.now(),
  });
}

/** Conflit ou refus : abandonner sa saisie ; la valeur du serveur devient la référence. */
export async function discardMark(db: OfflineDb, mark: PendingMark): Promise<void> {
  await db.transaction("rw", db.marks, db.rollCalls, async () => {
    await db.marks.delete(mark.key);
    if (mark.state === "conflict" && mark.current !== undefined) {
      const copy = await db.rollCalls.get(mark.callKey);
      if (copy) {
        await db.rollCalls.put({
          ...copy,
          values: withMark(copy.values, mark.enrollmentId, mark.current),
        });
      }
    }
  });
}

export function withMark(
  values: Record<string, string>,
  enrollmentId: string,
  value: string,
): Record<string, string> {
  const next = { ...values };
  if (value === "") delete next[enrollmentId];
  else next[enrollmentId] = value;
  return next;
}
