import type { GradeInputProblem } from "./grade-input";

/** Refus métier des notes. Le code correspond à un texte `grading.errors.<code>` (i18n). */
export type GradingErrorCode =
  | "courseNotFound"
  | "assessmentNotFound"
  | "assessmentInvalid"
  | "periodNotFound"
  | "dateOutsideYear"
  | "yearNotActive"
  | "yearArchived"
  | "scoreAboveMax"
  | "studentNotInClass"
  | "periodClosed"
  | "periodNotClosed"
  | "reopenReason"
  | "classNotFound"
  | "commentTooLong"
  | "councilValidated"
  | "councilNotClosed"
  | "decisionMissing"
  | "mentionInvalid"
  | "decisionInvalid"
  | GradeInputProblem;

export class GradingError extends Error {
  constructor(readonly code: GradingErrorCode) {
    super(`Notes : ${code}`);
    this.name = "GradingError";
  }
}
