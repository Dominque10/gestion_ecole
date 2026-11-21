"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { t } from "@/i18n";
import type { FormState } from "@/lib/form-state";
import { formatXAF, parseXAF } from "@/lib/money";
import { closeCash, reopenClosure } from "@/modules/finance/closures";
import {
  collectPayment,
  decideCancellation,
  PAYMENT_METHODS,
  requestCancellation,
  type PaymentMethod,
} from "@/modules/finance/payments";
import { requireAction } from "@/server/auth/session";
import { readFields, refusalMessage } from "@/server/forms";

const result = (
  status: "success" | "error",
  message: string,
  values: Record<string, string> = {},
): FormState => ({ status, message, fieldErrors: {}, values });

export async function collectPaymentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("payments:collect");
  const values = readFields(formData, ["enrollmentId", "amount", "method", "reference", "note"]);
  const amount = parseXAF(values.amount);
  if (amount === null) {
    return {
      ...result("error", t("finance.errors.paymentAmount"), values),
      fieldErrors: { amount: t("finance.errors.paymentAmount") },
    };
  }
  const method: PaymentMethod = (PAYMENT_METHODS as readonly string[]).includes(values.method)
    ? (values.method as PaymentMethod)
    : "cash";
  let done: Awaited<ReturnType<typeof collectPayment>>;
  try {
    done = await collectPayment(principal, {
      enrollmentId: values.enrollmentId,
      amount,
      method,
      reference: values.reference,
      note: values.note,
    });
  } catch (error) {
    return result("error", refusalMessage(error), values);
  }
  redirect(`/caisse/recus/${done.paymentId}${done.autoValidated ? "?inscription=validee" : ""}`);
}

export async function requestCancellationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("payments:cancel:request");
  const reason = String(formData.get("reason") ?? "");
  if (reason.trim().length < 3) return result("error", t("finance.errors.reason"), { reason });
  try {
    await requestCancellation(principal, String(formData.get("paymentId") ?? ""), reason);
    refresh();
    return result("success", t("finance.cancelRequested"));
  } catch (error) {
    return result("error", refusalMessage(error), { reason });
  }
}

export async function decideCancellationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("payments:cancel:approve");
  const approve = formData.get("decision") === "approve";
  try {
    await decideCancellation(principal, String(formData.get("cancellationId") ?? ""), {
      approve,
      note: String(formData.get("note") ?? ""),
    });
  } catch (error) {
    return result("error", refusalMessage(error));
  }
  // La demande disparaît de la liste une fois décidée : la confirmation s'affiche sur la page.
  redirect(`/caisse/annulations?decision=${approve ? "validee" : "refusee"}`);
}

export async function closeCashAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("cash:close");
  const values = readFields(formData, ["day", "countedCash", "note"]);
  const counted = values.countedCash.trim() === "0" ? 0 : parseXAF(values.countedCash);
  if (counted === null) {
    return {
      ...result("error", t("closure.errors.counted"), values),
      fieldErrors: { countedCash: t("closure.errors.counted") },
    };
  }
  try {
    const done = await closeCash(principal, {
      day: values.day,
      countedCash: counted,
      note: values.note,
    });
    refresh();
    return result("success", t("closure.done", { ecart: formatXAF(done.difference) }));
  } catch (error) {
    return result("error", refusalMessage(error), values);
  }
}

export async function reopenClosureAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("cash:reopen");
  const reason = String(formData.get("reason") ?? "");
  if (reason.trim().length < 3) return result("error", t("closure.errors.reason"), { reason });
  try {
    await reopenClosure(principal, String(formData.get("closureId") ?? ""), reason);
  } catch (error) {
    return result("error", refusalMessage(error), { reason });
  }
  redirect("/caisse/clotures?rouverte=1");
}
