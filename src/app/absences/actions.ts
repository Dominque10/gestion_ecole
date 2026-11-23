"use server";

import { refresh } from "next/cache";
import { t } from "@/i18n";
import type { FormState } from "@/lib/form-state";
import { justifyDay, studentOfEnrollment } from "@/modules/attendance/justify";
import { addStudentDocument } from "@/modules/students/media";
import { requireAction } from "@/server/auth/session";
import { refusalMessage } from "@/server/forms";

const state = (status: "success" | "error", message: string, values = {}): FormState => ({
  status,
  message,
  fieldErrors: {},
  values,
});

/** Justifie la journée d'un élève, avec une photo du justificatif si elle est jointe. */
export async function justifyDayAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("attendance:justify");
  const enrollmentId = String(formData.get("inscription") ?? "");
  const date = String(formData.get("date") ?? "");
  const reason = String(formData.get("motif") ?? "");
  const file = formData.get("file");
  try {
    if (reason.trim().length < 3 || reason.trim().length > 200) {
      return state("error", t("attendance.errors.reasonInvalid"), { motif: reason });
    }
    let documentId: string | null = null;
    if (file instanceof File && file.size > 0) {
      const studentId = await studentOfEnrollment(principal, enrollmentId);
      documentId = await addStudentDocument(principal, studentId, {
        kind: "other",
        label: t("absences.documentLabel", { date: date.split("-").reverse().join("/") }),
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
    }
    await justifyDay(principal, { enrollmentId, date, reason, documentId });
  } catch (error) {
    return state("error", refusalMessage(error), { motif: reason });
  }
  refresh();
  return state("success", t("absences.justified"));
}
