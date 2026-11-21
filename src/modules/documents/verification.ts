// Liens de vérification des reçus (QR code) : signés avec AUTH_SECRET, pour qu'on ne puisse pas
// parcourir les reçus d'une école en devinant des identifiants.
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 16) {
    throw new Error("AUTH_SECRET manquant ou trop court (voir .env.example)");
  }
  return value;
}

function signature(paymentId: string): string {
  return createHmac("sha256", secret())
    .update(`receipt:${paymentId}`)
    .digest("base64url")
    .slice(0, 22);
}

/** Jeton à placer dans l'URL : identifiant du paiement + signature. */
export function receiptToken(paymentId: string): string {
  return `${paymentId}.${signature(paymentId)}`;
}

/** Renvoie l'identifiant du paiement si le jeton est authentique, sinon null. */
export function verifyReceiptToken(token: string): string | null {
  const [id, sig] = token.split(".");
  if (!id || !sig || !z.uuid().safeParse(id).success) return null;
  const expected = Buffer.from(signature(id));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

/** Adresse publique de vérification d'un reçu. */
export function receiptVerifyUrl(paymentId: string): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/verifier/${receiptToken(paymentId)}`;
}

export type ReceiptCheck = {
  schoolName: string;
  receiptNumber: string;
  amount: number;
  paidAt: Date;
  reversed: boolean;
};

/**
 * Vérification publique d'un reçu : null si le lien est faux ou le reçu inconnu. Ne renvoie jamais
 * l'élève (données de mineur).
 */
export async function checkReceipt(token: string): Promise<ReceiptCheck | null> {
  const paymentId = verifyReceiptToken(token);
  if (!paymentId) return null;
  const { withPublic } = await import("@/server/db/client");
  const { sql } = await import("drizzle-orm");
  const result = await withPublic((tx) =>
    tx.execute<{
      school_name: string;
      receipt_number: string;
      amount: number;
      paid_at: string | Date;
      reversed: boolean;
    }>(sql`select * from app.verify_receipt(${paymentId})`),
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    schoolName: row.school_name,
    receiptNumber: row.receipt_number,
    amount: row.amount,
    paidAt: new Date(row.paid_at),
    reversed: row.reversed,
  };
}
