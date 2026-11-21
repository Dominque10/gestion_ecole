/**
 * Normalise un numéro de téléphone congolais au format international (+242XXXXXXXXX).
 * Accepte : « 06 123 45 67 », « 061234567 », « 242061234567 », « +242 06 123 45 67 », « 00242… ».
 * Renvoie null si le numéro n'est pas reconnu.
 *
 * Hypothèse : numéros congolais à 9 chiffres après l'indicatif 242. Les autres indicatifs
 * internationaux sont acceptés tels quels (8 à 15 chiffres).
 */
export function normalizePhone(input: string): string | null {
  let digits = input.trim().replace(/[\s.\-()]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (digits.startsWith("+")) {
    const rest = digits.slice(1);
    if (!/^\d{8,15}$/.test(rest)) return null;
    if (rest.startsWith("242") && rest.length !== 12) return null;
    return `+${rest}`;
  }
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length === 9 && digits.startsWith("0")) return `+242${digits}`;
  if (digits.length === 12 && digits.startsWith("242")) return `+${digits}`;
  return null;
}

/** Un identifiant de connexion est soit un email, soit un numéro de téléphone. */
export function parseIdentifier(
  input: string,
): { kind: "email"; value: string } | { kind: "phone"; value: string } | null {
  const trimmed = input.trim();
  if (trimmed.includes("@")) {
    const email = trimmed.toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { kind: "email", value: email } : null;
  }
  const phone = normalizePhone(trimmed);
  return phone ? { kind: "phone", value: phone } : null;
}
