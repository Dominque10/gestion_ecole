"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { t } from "@/i18n";
import type { FormState } from "@/lib/form-state";
import {
  createAssessment,
  deleteAssessment,
  saveGrades,
  updateAssessment,
  type GradeEntry,
  type SaveGradesResult,
} from "@/modules/grading/assessments";
import { requireAction } from "@/server/auth/session";
import { readFields, refusalMessage } from "@/server/forms";

const FIELDS = ["periode", "type", "intitule", "date", "bareme"] as const;

const failure = (message: string, values: Record<string, string> = {}): FormState => ({
  status: "error",
  message,
  fieldErrors: {},
  values,
});

function readAssessment(formData: FormData) {
  const values = readFields(formData, FIELDS);
  return {
    values,
    input: {
      periodId: values.periode,
      kind: values.type,
      title: values.intitule,
      date: values.date,
      maxScore: values.bareme,
    },
  };
}

export async function createAssessmentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("assessments:manage");
  const { values, input } = readAssessment(formData);
  let id: string;
  try {
    id = await createAssessment(
      principal,
      String(formData.get("classe") ?? ""),
      String(formData.get("matiere") ?? ""),
      input,
    );
  } catch (error) {
    return failure(refusalMessage(error), values);
  }
  redirect(`/notes/evaluation/${id}`);
}

export async function updateAssessmentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("assessments:manage");
  const { values, input } = readAssessment(formData);
  try {
    await updateAssessment(principal, String(formData.get("evaluation") ?? ""), input);
  } catch (error) {
    return failure(refusalMessage(error), values);
  }
  refresh();
  return { status: "success", message: t("grading.assessmentSaved"), fieldErrors: {}, values };
}

export async function deleteAssessmentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("assessments:manage");
  try {
    await deleteAssessment(principal, String(formData.get("evaluation") ?? ""));
  } catch (error) {
    return failure(refusalMessage(error));
  }
  redirect(`/notes/${String(formData.get("classe"))}/${String(formData.get("matiere"))}`);
}

export type SaveGradesResponse =
  { ok: true; result: SaveGradesResult } | { ok: false; message: string };

/** Enregistre les cases modifiées de la grille (appelée directement par le composant client). */
export async function saveGradesAction(
  assessmentId: string,
  entries: GradeEntry[],
): Promise<SaveGradesResponse> {
  const { principal } = await requireAction("grades:write");
  const clean = (Array.isArray(entries) ? entries : []).slice(0, 500).map((e) => ({
    enrollmentId: String(e?.enrollmentId ?? ""),
    expected: String(e?.expected ?? "").slice(0, 20),
    value: String(e?.value ?? "").slice(0, 20),
  }));
  try {
    return { ok: true, result: await saveGrades(principal, String(assessmentId), clean) };
  } catch (error) {
    return { ok: false, message: refusalMessage(error) };
  }
}
