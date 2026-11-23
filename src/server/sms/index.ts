// Envoi de messages (SMS et WhatsApp) derrière une interface interne (décision D1) : faux prestataires
// de test pour l'instant ; les vrais (B5) seront branchés sans toucher au reste de l'application.
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

export type Channel = "sms" | "whatsapp";

export interface SmsProvider {
  readonly channel: Channel;
  /** Coût unitaire indicatif en FCFA (vérification du plafond avant l'envoi). */
  readonly unitCost: number;
  /** Envoie un message ; lève une erreur si le prestataire refuse ou ne répond pas (nouvel essai). */
  send(to: string, body: string): Promise<{ ref: string; cost: number }>;
}

/**
 * Faux prestataire : n'envoie rien, garde les messages en mémoire et les écrit dans le journal (ou
 * dans le fichier `SMS_FAKE_OUTBOX`, lu par les tests de bout en bout). Coûts : hypothèse H120.
 */
export class FakeSmsProvider implements SmsProvider {
  readonly sent: { to: string; body: string; ref: string }[] = [];
  /** Pour les tests : le prochain envoi échoue. */
  failNext = false;

  constructor(
    readonly channel: Channel = "sms",
    readonly unitCost = channel === "sms" ? 25 : 15,
  ) {}

  async send(to: string, body: string): Promise<{ ref: string; cost: number }> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error(`Prestataire ${this.channel.toUpperCase()} indisponible (simulation)`);
    }
    const ref = `fake-${randomUUID()}`;
    this.sent.push({ to, body, ref });
    const outbox = process.env.SMS_FAKE_OUTBOX;
    if (outbox) {
      appendFileSync(
        outbox,
        `${JSON.stringify({ to, body, channel: this.channel, at: new Date().toISOString() })}\n`,
      );
    } else {
      console.log(`[${this.channel} factice] → ${to} : ${body}`);
    }
    return { ref, cost: this.unitCost };
  }
}

const providers: Partial<Record<Channel, SmsProvider>> = {};

/** Prestataire d'un canal (SMS : codes de connexion et alertes ; WhatsApp : au choix de l'école). */
export function getMessageProvider(channel: Channel): SmsProvider {
  const existing = providers[channel];
  if (existing) return existing;
  const name =
    (channel === "sms" ? process.env.SMS_PROVIDER : process.env.WHATSAPP_PROVIDER) || "fake";
  if (name !== "fake") throw new Error(`Prestataire ${channel} inconnu : ${name} (choix B5)`);
  providers[channel] = new FakeSmsProvider(channel);
  return providers[channel];
}

export function getSmsProvider(): SmsProvider {
  return getMessageProvider("sms");
}

export function setSmsProviderForTests(
  value: SmsProvider | undefined,
  channel: Channel = "sms",
): void {
  if (value) providers[channel] = value;
  else delete providers[channel];
}
