"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { t } from "@/i18n";
import type { FormState } from "@/lib/form-state";
import { parseXAF } from "@/lib/money";
import { deleteFee, FEE_KINDS, saveFee, type FeeKind } from "@/modules/settings/fees";
import { requireAction } from "@/server/auth/session";
import { refusalMessage } from "@/server/forms";

const result = (
  status: "success" | "error",
  message: string,
  fieldErrors: Record<string, string> = {},
  values: Record<string, string> = {},
): FormState => ({ status, message, fieldErrors, values });

export async function saveFeeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  const yearId = String(formData.get("annee") ?? "");
  const originalName = String(formData.get("originalName") ?? "") || undefined;
  const name = String(formData.get("name") ?? "").trim();
  const kindRaw = String(formData.get("kind") ?? "");
  const kind: FeeKind = (FEE_KINDS as readonly string[]).includes(kindRaw)
    ? (kindRaw as FeeKind)
    : "other";
  const levelIds = formData.getAll("levelIds").map(String);
  const count = Number(formData.get("count") ?? 0);

  const errors: Record<string, string> = {};
  if (name.length < 2 || name.length > 60) errors.name = t("fees.errors.name");
  if (levelIds.length === 0) errors.levels = t("fees.errors.levels");
  const installments = Array.from(
    { length: Number.isInteger(count) ? Math.min(count, 12) : 0 },
    (_, i) => {
      const n = i + 1;
      return {
        number: n,
        amount: parseXAF(String(formData.get(`amount-${n}`) ?? "")),
        dueDate: String(formData.get(`due-${n}`) ?? ""),
      };
    },
  );
  if (installments.length === 0) errors.installments = t("fees.errors.compute");
  else if (installments.some((p) => p.amount === null))
    errors.installments = t("fees.errors.amounts");
  else if (installments.some((p) => p.dueDate === "")) errors.installments = t("fees.errors.dates");
  // Renvoyées au formulaire en cas d'erreur (React vide les champs non contrôlés après l'envoi).
  const values = {
    name,
    levelIds: levelIds.join(","),
    mandatory: formData.get("mandatory") === "on" ? "on" : "",
  };
  if (Object.keys(errors).length > 0) return result("error", t("form.invalid"), errors, values);

  try {
    await saveFee(
      principal,
      yearId,
      {
        name,
        kind,
        mandatory: formData.get("mandatory") === "on",
        levelIds,
        installments: installments.map((p) => ({ ...p, amount: p.amount as number })),
      },
      originalName,
    );
  } catch (error) {
    return result("error", refusalMessage(error), {}, values);
  }
  if (originalName) redirect(`/parametres/frais?annee=${encodeURIComponent(yearId)}`);
  refresh();
  return result("success", t("fees.saved", { nom: name }));
}

export async function deleteFeeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("settings:write");
  try {
    await deleteFee(
      principal,
      String(formData.get("annee") ?? ""),
      String(formData.get("levelId") ?? ""),
      String(formData.get("name") ?? ""),
    );
    refresh();
    return result("success", t("fees.deleted"));
  } catch (error) {
    return result("error", refusalMessage(error));
  }
}
