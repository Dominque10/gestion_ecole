import type { FeeProblem } from "./fees-logic";
import type { PeriodsProblem } from "./periods-logic";

/** Refus métier du paramétrage. Le code correspond à un texte `settings.errors.<code>` (i18n). */
export type SettingsErrorCode =
  | "codeTaken"
  | "platformAccount"
  | "alreadyMember"
  | "notMember"
  | "lastDirector"
  | "cannotRemoveSelf"
  | "cannotResetSelf"
  | "otherSchoolAccount"
  | "notFound"
  | "imageMissing"
  | "imageTooLarge"
  | "imageType"
  | "yearLabelTaken"
  | "yearNotFound"
  | "yearArchived"
  | "yearNotUpcoming"
  | "levelNameTaken"
  | "levelNotFound"
  | "levelInUse"
  | "subjectNameTaken"
  | "subjectNotFound"
  | "subjectInUse"
  | "seriesInvalid"
  | "gridInvalid"
  | "gradingInvalid"
  | "subjectHasAssessments"
  | "classNameTaken"
  | "classNotFound"
  | "classInUse"
  | "notTeacher"
  | "timeSlotLabelTaken"
  | "timeSlotNotFound"
  | "timeSlotInUse"
  | "feeNameTaken"
  | "feeNotFound"
  | "registrationExists"
  | "copySameYear"
  | "copyTargetNotEmpty"
  | FeeProblem
  | PeriodsProblem;

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

/** Erreur levée par un garde-fou de la base (code SQLSTATE personnalisé, ex. GS001 = année archivée). */
export function dbGuardCode(error: unknown): string | null {
  const e = error as { code?: string; cause?: { code?: string } };
  const code = e?.code ?? e?.cause?.code;
  return code?.startsWith("GS") ? code : null;
}

/** Violation de clé étrangère : la ligne est encore utilisée ailleurs (ex. niveau qui a des classes). */
export function isForeignKeyViolation(error: unknown, constraint?: string): boolean {
  const e = error as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  };
  const pgError = e?.code === "23503" ? e : e?.cause?.code === "23503" ? e.cause : null;
  return pgError !== null && (!constraint || pgError.constraint === constraint);
}
