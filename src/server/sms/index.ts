// Envoi de SMS derrière une interface interne (décision D1) : faux prestataire de test pour l'instant,
// le vrai prestataire sera branché au M6 (B5) sans toucher au reste de l'application.
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

export interface SmsProvider {
  /** Envoie un SMS ; lève une erreur si le prestataire refuse ou ne répond pas (nouvel essai). */
  send(to: string, body: string): Promise<{ ref: string }>;
}

/** Faux prestataire : n'envoie rien, garde les messages en mémoire et les écrit dans le journal. */
export class FakeSmsProvider implements SmsProvider {
  readonly sent: { to: string; body: string; ref: string }[] = [];
  /** Pour les tests : le prochain envoi échoue. */
  failNext = false;

  async send(to: string, body: string): Promise<{ ref: string }> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("Prestataire SMS indisponible (simulation)");
    }
    const ref = `fake-${randomUUID()}`;
    this.sent.push({ to, body, ref });
    // Tests de bout en bout : boîte d'envoi lisible (jamais en production, où le vrai prestataire sert).
    const outbox = process.env.SMS_FAKE_OUTBOX;
    if (outbox) {
      appendFileSync(outbox, `${JSON.stringify({ to, body, at: new Date().toISOString() })}\n`);
    } else {
      console.log(`[sms factice] → ${to} : ${body}`);
    }
    return { ref };
  }
}

let provider: SmsProvider | undefined;

export function getSmsProvider(): SmsProvider {
  if (provider) return provider;
  const name = process.env.SMS_PROVIDER || "fake";
  if (name !== "fake") throw new Error(`Prestataire SMS inconnu : ${name} (choix au M6)`);
  provider = new FakeSmsProvider();
  return provider;
}

export function setSmsProviderForTests(value: SmsProvider | undefined): void {
  provider = value;
}
