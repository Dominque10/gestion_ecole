/** Refus métier du module élèves. Le code correspond à un texte `students.errors.<code>` (i18n). */
export type StudentErrorCode =
  | "notFound"
  | "guardianNotFound"
  | "guardianAlreadyLinked"
  | "lastGuardian"
  | "documentNotFound"
  | "imageMissing"
  | "imageTooLarge"
  | "imageType"
  | "yearNotFound"
  | "yearArchived"
  | "levelNotFound"
  | "enrollmentNotFound"
  | "alreadyEnrolled"
  | "notPreEnrolled"
  | "notEnrolled"
  | "classNotFound"
  | "classWrongLevel"
  | "classFull"
  | "alreadyLeft"
  | "exitBeforeEntry";

export class StudentError extends Error {
  constructor(readonly code: StudentErrorCode) {
    super(`Élèves : ${code}`);
    this.name = "StudentError";
  }
}
