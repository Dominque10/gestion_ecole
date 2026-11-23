// Valeurs de l'appel, utilisables côté client (sans base de données).

export const ROLL_STATUSES = ["present", "absent", "late"] as const;
export type RollStatus = (typeof ROLL_STATUSES)[number];

/** Valeur d'une ligne d'appel : un statut, ou « » (appel pas encore fait pour cet élève). */
export type RollValue = RollStatus | "";

export function isRollStatus(value: string): value is RollStatus {
  return (ROLL_STATUSES as readonly string[]).includes(value);
}
