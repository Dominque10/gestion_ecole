/** Refus métier du paramétrage. Le code correspond à un texte `settings.errors.<code>` (i18n). */
export type SettingsErrorCode =
  | "codeTaken"
  | "platformAccount"
  | "alreadyMember"
  | "notMember"
  | "lastDirector"
  | "cannotRemoveSelf"
  | "notFound"
  | "imageMissing"
  | "imageTooLarge"
  | "imageType";

export class SettingsError extends Error {
  constructor(readonly code: SettingsErrorCode) {
    super(`Paramétrage refusé : ${code}`);
    this.name = "SettingsError";
  }
}

/** Violation d'unicité PostgreSQL (éventuellement enveloppée par Drizzle), sur une contrainte donnée. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const e = error as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  };
  const pgError = e?.code === "23505" ? e : e?.cause?.code === "23505" ? e.cause : null;
  return pgError !== null && (!constraint || pgError.constraint === constraint);
}
