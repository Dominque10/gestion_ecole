"use server";

import { redirect } from "next/navigation";
import { startOnlinePayment } from "@/modules/finance/online";
import { requireAction } from "@/server/auth/session";
import { refusalMessage } from "@/server/forms";

export type PayState = { error: string | null };

/** Lance le paiement en ligne puis ouvre la page qui suit la confirmation. */
export async function payOnlineAction(_prev: PayState, formData: FormData): Promise<PayState> {
  const { principal } = await requireAction("payments:pay-online");
  const enrollmentId = String(formData.get("inscription") ?? "");
  let intentId: string;
  try {
    intentId = await startOnlinePayment(principal, {
      enrollmentId,
      invoiceIds: formData.getAll("echeance").map(String).slice(0, 24),
      phone: String(formData.get("telephone") ?? ""),
      operator: formData.get("operateur") === "mtn" ? "mtn" : "airtel",
    });
  } catch (error) {
    return { error: refusalMessage(error) };
  }
  redirect(`/parent/enfant/${enrollmentId}/paiement/${intentId}`);
}
