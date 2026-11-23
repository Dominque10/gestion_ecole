"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { t } from "@/i18n";
import type { FormState } from "@/lib/form-state";
import {
  createAssessment,
  deleteAssessment,
  updateAssessment,
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
