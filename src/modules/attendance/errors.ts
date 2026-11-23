/** Refus métier de l'appel. Le code correspond à un texte `attendance.errors.<code>` (i18n). */
export type AttendanceErrorCode =
  | "classNotFound"
  | "slotNotFound"
  | "subjectNotFound"
  | "dateInvalid"
  | "statusInvalid"
  | "studentNotInClass"
  | "yearArchived"
  | "reasonInvalid"
  | "absenceNotFound";

export class AttendanceError extends Error {
  constructor(readonly code: AttendanceErrorCode) {
    super(`Appel : ${code}`);
    this.name = "AttendanceError";
  }
}
