"use server";

// Actions appelées par l'envoi automatique des saisies faites sur le téléphone (notes 3c, appel 3e).
// Elles ne redirigent jamais : une session expirée est signalée, et les saisies restent sur le téléphone.
import type { SyncReply } from "@/lib/offline/sync";
import {
  createAssessment,
  saveGrades,
  type GradeEntry,
  type SaveGradesResult,
} from "@/modules/grading/assessments";
import {
  saveRollCall,
  type RollCallKey,
  type RollEntry,
  type SaveRollResult,
} from "@/modules/attendance/roll";
import { getSession } from "@/server/auth/session";
import { refusalMessage } from "@/server/forms";

async function principal() {
  const session = await getSession();
  if (!session || session.mustChangePassword || !session.principal.schoolId) return null;
  return session.principal;
}

const sessionLost = { ok: false, code: "session", message: "" } as const;

const text = (value: unknown, max: number) => String(value ?? "").slice(0, max);

export async function syncCreateAssessment(op: {
  id: string;
  classId: string;
  subjectId: string;
  input: unknown;
}): Promise<SyncReply<{ id: string }>> {
  const who = await principal();
  if (!who) return sessionLost;
  try {
    const id = await createAssessment(
      who,
      text(op?.classId, 40),
      text(op?.subjectId, 40),
      op?.input,
      text(op?.id, 40),
    );
    return { ok: true, result: { id } };
  } catch (error) {
    return { ok: false, code: "refused", message: refusalMessage(error) };
  }
}

export async function syncSaveGrades(
  assessmentId: string,
  entries: GradeEntry[],
): Promise<SyncReply<SaveGradesResult>> {
  const who = await principal();
  if (!who) return sessionLost;
  const clean = (Array.isArray(entries) ? entries : []).slice(0, 500).map((e) => ({
    enrollmentId: text(e?.enrollmentId, 40),
    expected: text(e?.expected, 20),
    value: text(e?.value, 20),
  }));
  try {
    return { ok: true, result: await saveGrades(who, text(assessmentId, 40), clean) };
  } catch (error) {
    return { ok: false, code: "refused", message: refusalMessage(error) };
  }
}

export async function syncSaveRollCall(
  call: RollCallKey,
  entries: RollEntry[],
): Promise<SyncReply<SaveRollResult>> {
  const who = await principal();
  if (!who) return sessionLost;
  const clean = (Array.isArray(entries) ? entries : []).slice(0, 500).map((e) => ({
    enrollmentId: text(e?.enrollmentId, 40),
    expected: text(e?.expected, 10),
    value: text(e?.value, 10),
  }));
  try {
    const result = await saveRollCall(
      who,
      {
        classId: text(call?.classId, 40),
        date: text(call?.date, 10),
        slotId: text(call?.slotId, 40),
        classSubjectId: call?.classSubjectId ? text(call.classSubjectId, 40) : null,
      },
      clean,
    );
    return { ok: true, result };
  } catch (error) {
    return { ok: false, code: "refused", message: refusalMessage(error) };
  }
}
