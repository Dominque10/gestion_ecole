import { handlePaymentWebhook } from "@/modules/finance/online";

/**
 * Message de confirmation du prestataire de paiement (4c). Signature vérifiée (en-tête
 * « x-signature », HMAC-SHA256 du corps) ; traitement idempotent : un message rejoué ne paie pas
 * deux fois. Réponse sans détail (le prestataire réessaie tant qu'il n'a pas un 200).
 */
export async function POST(request: Request) {
  const body = (await request.text()).slice(0, 20_000);
  const result = await handlePaymentWebhook(body, request.headers.get("x-signature"));
  return Response.json({ ok: result.status === 200 }, { status: result.status });
}
