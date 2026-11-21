"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { t } from "@/i18n";
import type { FormState } from "@/lib/form-state";
import {
  assignTeachers,
  ClassSchema,
  createClass,
  deleteClass,
  updateClass,
} from "@/modules/settings/classes";
import { requireAction } from "@/server/auth/session";
import { invalidForm, readFields, refusalMessage } from "@/server/forms";

const CLASS_FIELDS = ["levelId", "series", "name", "capacity", "headTeacherId"] as const;

const result = (
  status: "success" | "error",
  message: string,
  values: Record<string, string> = {},
): FormState => ({ status, message, fieldErrors: {}, values });

function classMessages() {
  return {
    levelId: t("classes.errors.levelId"),
    series: t("classes.errors.series"),
    name: t("classes.errors.name"),
    capacity: t("classes.errors.capacity"),
  };
}

export async function createClassAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  const values = readFields(formData, CLASS_FIELDS);
  const parsed = ClassSchema.safeParse(values);
  if (!parsed.success) return invalidForm(parsed.error, classMessages(), values);
  try {
    await createClass(principal, String(formData.get("annee") ?? ""), values);
    refresh();
    return result("success", t("classes.created", { nom: parsed.data.name }));
  } catch (error) {
    return result("error", refusalMessage(error), values);
  }
}

export async function updateClassAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  const values = readFields(formData, CLASS_FIELDS);
  const parsed = ClassSchema.safeParse(values);
  if (!parsed.success) return invalidForm(parsed.error, classMessages(), values);
  try {
    await updateClass(principal, String(formData.get("classId") ?? ""), values);
    refresh();
    return result("success", t("classes.saved"), values);
  } catch (error) {
    return result("error", refusalMessage(error), values);
  }
}

export async function assignTeachersAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  // Un champ « teacher-<id de la matière> » par matière ; vide = pas d'enseignant.
  const assignments = [...formData.entries()]
    .filter(([key]) => key.startsWith("teacher-"))
    .map(([key, value]) => ({
      subjectId: key.slice("teacher-".length),
      teacherId: String(value) === "" ? null : String(value),
    }));
  try {
    await assignTeachers(principal, String(formData.get("classId") ?? ""), assignments);
    refresh();
    return result("success", t("classes.teachersSaved"));
  } catch (error) {
    return result("error", refusalMessage(error));
  }
}

export async function deleteClassAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  const yearId = String(formData.get("annee") ?? "");
  try {
    await deleteClass(principal, String(formData.get("classId") ?? ""));
  } catch (error) {
    return result("error", refusalMessage(error));
  }
  redirect(`/parametres/classes?annee=${encodeURIComponent(yearId)}`);
}
