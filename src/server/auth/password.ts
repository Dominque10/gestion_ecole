import { hash, verify } from "@node-rs/argon2";

// Argon2id, paramètres recommandés par l'OWASP (19 Mio, 2 passes) : adaptés à un petit serveur.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const PASSWORD_MIN_LENGTH = 8;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Empreinte factice : vérifiée quand le compte n'existe pas, pour que le temps de réponse
// ne révèle pas si un identifiant est inscrit.
let dummyHash: Promise<string> | undefined;
export async function verifyDummyPassword(password: string): Promise<void> {
  dummyHash ??= hashPassword("mot-de-passe-factice");
  await verifyPassword(await dummyHash, password);
}
