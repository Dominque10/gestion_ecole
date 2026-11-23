// Paiement mobile (Airtel Money, MTN MoMo) derrière une interface interne (cahier des charges §9) :
// faux prestataire pour l'instant (décision D1, B4) ; un vrai agrégateur (pawaPay, CinetPay…) prendra
// sa place sans toucher au reste de l'application.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type Operator = "airtel" | "mtn";
export type ProviderStatus = "pending" | "succeeded" | "failed";

/** Événement de paiement, venu d'un message signé du prestataire ou d'une interrogation de statut. */
export type PaymentEvent = {
  providerRef: string;
  status: ProviderStatus;
  /** Référence de l'opérateur (reportée sur le reçu). */
  operatorRef?: string;
  amount?: number;
  failureReason?: string;
};

export interface MobileMoneyProvider {
  readonly name: string;
  /** Demande le paiement : le parent confirme sur son téléphone (code secret mobile money). */
  requestPayment(request: {
    intentId: string;
    amount: number;
    phone: string;
    operator: Operator;
    description: string;
  }): Promise<{ providerRef: string }>;
  /** Statut d'une transaction (quand le message de confirmation tarde). */
  getStatus(providerRef: string): Promise<PaymentEvent>;
  /** Message de confirmation : signature vérifiée, sinon null (rejeté). */
  parseWebhook(rawBody: string, signature: string | null): PaymentEvent | null;
  /** Relevé des transactions d'un jour (réconciliation quotidienne). */
  listTransactions(day: string): Promise<PaymentEvent[]>;
}

/** Signature HMAC-SHA256 (hexadécimal) d'un corps de message. */
export function signBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function verifySignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = Buffer.from(signBody(body, secret), "hex");
  const given = Buffer.from(signature, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const EventSchema = {
  parse(value: unknown): PaymentEvent | null {
    const v = value as Record<string, unknown> | null;
    if (!v || typeof v.providerRef !== "string") return null;
    if (v.status !== "pending" && v.status !== "succeeded" && v.status !== "failed") return null;
    return {
      providerRef: v.providerRef,
      status: v.status,
      operatorRef: typeof v.operatorRef === "string" ? v.operatorRef.slice(0, 60) : undefined,
      amount: typeof v.amount === "number" ? v.amount : undefined,
      failureReason:
        typeof v.failureReason === "string" ? v.failureReason.slice(0, 200) : undefined,
    };
  },
};

/**
 * Faux prestataire : aucune transaction réelle. Les confirmations sont des messages signés avec
 * `PAYMENT_WEBHOOK_SECRET` (les tests les envoient eux-mêmes). Pour simuler l'interrogation de statut :
 * un numéro finissant par 1111 réussit, par 0000 échoue, les autres restent en attente.
 */
export class FakeMobileMoneyProvider implements MobileMoneyProvider {
  readonly name = "fake";
  /** Transactions du relevé (réglables par les tests de réconciliation). */
  statement: PaymentEvent[] = [];

  constructor(private readonly secret = process.env.PAYMENT_WEBHOOK_SECRET ?? "") {}

  async requestPayment(request: { phone: string }): Promise<{ providerRef: string }> {
    return { providerRef: `fake-${randomUUID()}-${request.phone.slice(-4)}` };
  }

  async getStatus(providerRef: string): Promise<PaymentEvent> {
    if (providerRef.endsWith("-1111")) {
      return { providerRef, status: "succeeded", operatorRef: `OP-${providerRef.slice(5, 13)}` };
    }
    if (providerRef.endsWith("-0000")) {
      return { providerRef, status: "failed", failureReason: "Solde insuffisant (simulation)" };
    }
    return { providerRef, status: "pending" };
  }

  parseWebhook(rawBody: string, signature: string | null): PaymentEvent | null {
    if (!verifySignature(rawBody, signature, this.secret)) return null;
    try {
      return EventSchema.parse(JSON.parse(rawBody));
    } catch {
      return null;
    }
  }

  async listTransactions(): Promise<PaymentEvent[]> {
    return this.statement;
  }
}

let provider: MobileMoneyProvider | undefined;

export function getPaymentProvider(): MobileMoneyProvider {
  if (provider) return provider;
  const name = process.env.PAYMENT_PROVIDER || "fake";
  if (name !== "fake") throw new Error(`Prestataire de paiement inconnu : ${name} (choix B4)`);
  provider = new FakeMobileMoneyProvider();
  return provider;
}

export function setPaymentProviderForTests(value: MobileMoneyProvider | undefined): void {
  provider = value;
}
