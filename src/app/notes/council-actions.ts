"use server";

import { refresh } from "next/cache";
import { t } from "@/i18n";
import type { FormState } from "@/lib/form-state";
import {
  DECISIONS,
  reopenCouncil,
  saveCouncil,
  saveSubjectComments,
  validateCouncil,
  type CouncilEntry,
  type Decision,
} from "@/modules/grading/council";
import { publishBulletins } from "@/modules/grading/bulletins";
import { can } from "@/server/auth/permissions";
import { requireAction } from "@/server/auth/session";
import { refusalMessage } from "@/server/forms";

const state = (status: "success" | "error", message: string): FormState => ({
  status,
  message,
  fieldErrors: {},
  values: {},
});

/** Identifiants d'élèves présents dans le formulaire (champ caché « eleve », répété). */
const students = (formData: FormData) => formData.getAll("eleve").map(String).slice(0, 200);

export async function saveSubjectCommentsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("grades:write");
  try {
    await saveSubjectComments(
      principal,
      String(formData.get("classe") ?? ""),
      String(formData.get("matiere") ?? ""),
      String(formData.get("periode") ?? ""),
      students(formData).map((id) => ({
        enrollmentId: id,
        text: String(formData.get(`appreciation-${id}`) ?? ""),
      })),
    );
  } catch (error) {
    return state("error", refusalMessage(error));
  }
  refresh();
  return state("success", t("council.commentsSaved"));
}

/** Valeur du choix de mention : « proposee » = suivre la proposition, « aucune » = pas de mention. */
const PROPOSED = "proposee";
const NONE = "aucune";

export async function saveCouncilAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("grades:write");
  const decides = can(principal, "reportcards:council");
  const entries: CouncilEntry[] = students(formData).map((id) => {
    const entry: CouncilEntry = {
      enrollmentId: id,
      generalComment: String(formData.get(`generale-${id}`) ?? ""),
    };
    if (decides && formData.has(`mention-${id}`)) {
      const mention = String(formData.get(`mention-${id}`));
      entry.mention = mention === PROPOSED ? null : mention === NONE ? "" : mention;
    }
    if (decides && formData.has(`decision-${id}`)) {
      const decision = String(formData.get(`decision-${id}`));
      entry.decision = (DECISIONS as readonly string[]).includes(decision)
        ? (decision as Decision)
        : null;
    }
    return entry;
  });
  try {
    await saveCouncil(
      principal,
      String(formData.get("classe") ?? ""),
      String(formData.get("periode") ?? ""),
      entries,
    );
  } catch (error) {
    return state("error", refusalMessage(error));
  }
  refresh();
  return state("success", t("council.saved"));
}

export async function validateCouncilAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("reportcards:council");
  try {
    await validateCouncil(
      principal,
      String(formData.get("classe") ?? ""),
      String(formData.get("periode") ?? ""),
    );
  } catch (error) {
    return state("error", refusalMessage(error));
  }
  refresh();
  return state("success", t("council.validated"));
}

export async function reopenCouncilAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("reportcards:council");
  try {
    await reopenCouncil(
      principal,
      String(formData.get("classe") ?? ""),
      String(formData.get("periode") ?? ""),
    );
  } catch (error) {
    return state("error", refusalMessage(error));
  }
  refresh();
  return state("success", t("council.reopened"));
}

export async function publishBulletinsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("reportcards:publish");
  let count: number;
  try {
    count = await publishBulletins(
      principal,
      String(formData.get("classe") ?? ""),
      String(formData.get("periode") ?? ""),
    );
  } catch (error) {
    return state("error", refusalMessage(error));
  }
  refresh();
  return state("success", t("bulletins.published", { n: count }));
}
