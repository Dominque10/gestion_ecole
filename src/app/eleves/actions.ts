"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { t } from "@/i18n";
import type { FormState } from "@/lib/form-state";
import { parseXAF } from "@/lib/money";
import {
  addMissingMandatoryFees,
  addOptionalFee,
  grantExceptionalDiscount,
  grantScholarship,
} from "@/modules/finance/invoices";
import {
  addStudentDocument,
  deleteStudentDocument,
  DOCUMENT_KINDS,
  setStudentPhoto,
  type DocumentKind,
} from "@/modules/students/media";
import {
  assignClass,
  DepartureSchema,
  preEnroll,
  recordDeparture,
  reEnrollClass,
  validateEnrollment,
} from "@/modules/students/enrollments";
import { saveMedical } from "@/modules/students/medical";
import { GuardianSchema, MedicalSchema, StudentSchema } from "@/modules/students/schemas";
import {
  addGuardian,
  createStudent,
  removeGuardian,
  setPrimaryGuardian,
  updateStudent,
} from "@/modules/students/students";
import { requireAction } from "@/server/auth/session";
import { invalidForm, readFields, refusalMessage } from "@/server/forms";

const STUDENT_FIELDS = [
  "lastName",
  "firstNames",
  "sex",
  "birthDate",
  "birthPlace",
  "nationality",
  "previousSchool",
] as const;
const GUARDIAN_FIELDS = ["fullName", "phone", "otherPhone", "relationship"] as const;
const MEDICAL_FIELDS = [
  "allergies",
  "treatments",
  "emergencyContactName",
  "emergencyContactPhone",
  "notes",
] as const;

const result = (
  status: "success" | "error",
  message: string,
  values: Record<string, string> = {},
): FormState => ({ status, message, fieldErrors: {}, values });

const studentMessages = () => ({
  lastName: t("students.errors.lastName"),
  firstNames: t("students.errors.firstNames"),
  sex: t("students.errors.sex"),
  birthDate: t("students.errors.birthDate"),
});
const guardianMessages = () => ({
  fullName: t("students.errors.guardianName"),
  phone: t("students.errors.phone"),
  otherPhone: t("students.errors.phone"),
});

export async function createStudentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("students:write");
  const student = readFields(formData, STUDENT_FIELDS);
  const guardian = readFields(formData, GUARDIAN_FIELDS);
  const values = { ...student, ...guardian };
  const s = StudentSchema.safeParse(student);
  const g = GuardianSchema.safeParse(guardian);
  if (!s.success || !g.success) {
    const errors = {
      ...(s.success ? {} : invalidForm(s.error, studentMessages()).fieldErrors),
      ...(g.success ? {} : invalidForm(g.error, guardianMessages()).fieldErrors),
    };
    return { status: "error", message: t("form.invalid"), fieldErrors: errors, values };
  }
  let created: Awaited<ReturnType<typeof createStudent>>;
  try {
    created = await createStudent(principal, { student, guardian });
  } catch (error) {
    return result("error", refusalMessage(error), values);
  }
  redirect(`/eleves/${created.id}?cree=${created.existingGuardian ? "parent" : "1"}`);
}

export async function updateStudentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("students:write");
  const values = readFields(formData, STUDENT_FIELDS);
  const parsed = StudentSchema.safeParse(values);
  if (!parsed.success) return invalidForm(parsed.error, studentMessages(), values);
  try {
    await updateStudent(principal, String(formData.get("studentId") ?? ""), values);
    refresh();
    return result("success", t("students.saved"), values);
  } catch (error) {
    return result("error", refusalMessage(error), values);
  }
}

export async function addGuardianAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("students:write");
  const values = readFields(formData, GUARDIAN_FIELDS);
  const parsed = GuardianSchema.safeParse(values);
  if (!parsed.success) return invalidForm(parsed.error, guardianMessages(), values);
  try {
    await addGuardian(principal, String(formData.get("studentId") ?? ""), values);
    refresh();
    return result("success", t("students.guardianAdded"));
  } catch (error) {
    return result("error", refusalMessage(error), values);
  }
}

export async function setPrimaryGuardianAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("students:write");
  try {
    await setPrimaryGuardian(
      principal,
      String(formData.get("studentId") ?? ""),
      String(formData.get("guardianId") ?? ""),
    );
    refresh();
    return result("success", t("students.guardianPrimarySet"));
  } catch (error) {
    return result("error", refusalMessage(error));
  }
}

export async function removeGuardianAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("students:write");
  try {
    await removeGuardian(
      principal,
      String(formData.get("studentId") ?? ""),
      String(formData.get("guardianId") ?? ""),
    );
    refresh();
    return result("success", t("students.guardianRemoved"));
  } catch (error) {
    return result("error", refusalMessage(error));
  }
}

export async function saveMedicalAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("students:medical");
  const values = readFields(formData, MEDICAL_FIELDS);
  const parsed = MedicalSchema.safeParse(values);
  if (!parsed.success) {
    return invalidForm(parsed.error, { emergencyContactPhone: t("students.errors.phone") }, values);
  }
  try {
    await saveMedical(principal, String(formData.get("studentId") ?? ""), values);
    refresh();
    return result("success", t("students.medicalSaved"), values);
  } catch (error) {
    return result("error", refusalMessage(error), values);
  }
}

async function fileBytes(formData: FormData): Promise<Uint8Array> {
  const file = formData.get("file");
  return file instanceof File ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array();
}

export async function uploadPhotoAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("students:write");
  try {
    await setStudentPhoto(
      principal,
      String(formData.get("studentId") ?? ""),
      await fileBytes(formData),
    );
    refresh();
    return result("success", t("students.photoSaved"));
  } catch (error) {
    return result("error", refusalMessage(error));
  }
}

export async function uploadDocumentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("students:write");
  const kindRaw = String(formData.get("kind") ?? "");
  const kind: DocumentKind = (DOCUMENT_KINDS as readonly string[]).includes(kindRaw)
    ? (kindRaw as DocumentKind)
    : "other";
  try {
    await addStudentDocument(principal, String(formData.get("studentId") ?? ""), {
      kind,
      label: String(formData.get("label") ?? ""),
      bytes: await fileBytes(formData),
    });
    refresh();
    return result("success", t("students.documentAdded"));
  } catch (error) {
    return result("error", refusalMessage(error));
  }
}

export async function deleteDocumentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("students:write");
  try {
    await deleteStudentDocument(principal, String(formData.get("documentId") ?? ""));
    refresh();
    return result("success", t("students.documentDeleted"));
  } catch (error) {
    return result("error", refusalMessage(error));
  }
}

// --- Inscriptions (2b) ------------------------------------------------------------------------

export async function preEnrollAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("students:write");
  try {
    await preEnroll(principal, {
      studentId: String(formData.get("studentId") ?? ""),
      academicYearId: String(formData.get("yearId") ?? ""),
      levelId: String(formData.get("levelId") ?? ""),
    });
    refresh();
    return result("success", t("enrollments.preEnrolled"));
  } catch (error) {
    return result("error", refusalMessage(error));
  }
}

export async function validateEnrollmentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("enrollments:validate");
  try {
    await validateEnrollment(principal, String(formData.get("enrollmentId") ?? ""));
    refresh();
    return result("success", t("enrollments.validated"));
  } catch (error) {
    return result("error", refusalMessage(error));
  }
}

export async function assignClassAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("students:write");
  const classId = String(formData.get("classId") ?? "");
  try {
    await assignClass(principal, String(formData.get("enrollmentId") ?? ""), classId || null);
    refresh();
    return result("success", t("enrollments.classAssigned"));
  } catch (error) {
    return result("error", refusalMessage(error));
  }
}

export async function departureAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("students:write");
  const values = readFields(formData, ["reason", "date", "note"]);
  const parsed = DepartureSchema.safeParse(values);
  if (!parsed.success) return result("error", t("enrollments.errors.departure"), values);
  try {
    await recordDeparture(principal, String(formData.get("enrollmentId") ?? ""), values);
    refresh();
    return result("success", t("enrollments.left"));
  } catch (error) {
    return result("error", refusalMessage(error), values);
  }
}

export async function reEnrollAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("students:write");
  // Un champ « decision-<id de l'inscription d'origine> » par élève : id du niveau, ou vide.
  const decisions = [...formData.entries()]
    .filter(([key]) => key.startsWith("decision-"))
    .map(([key, value]) => ({
      enrollmentId: key.slice("decision-".length),
      levelId: String(value) === "" ? null : String(value),
    }));
  try {
    const done = await reEnrollClass(principal, {
      toYearId: String(formData.get("toYearId") ?? ""),
      decisions,
    });
    refresh();
    return result(
      "success",
      t("enrollments.reEnrolled", { n: done.created, deja: done.alreadyEnrolled }),
    );
  } catch (error) {
    return result("error", refusalMessage(error));
  }
}

// --- Échéances (2c) ---------------------------------------------------------------------------

export async function addMissingFeesAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("invoices:manage");
  try {
    const n = await addMissingMandatoryFees(principal, String(formData.get("enrollmentId") ?? ""));
    refresh();
    return result(
      "success",
      n > 0 ? t("finance.addedMissing", { n }) : t("finance.nothingMissing"),
    );
  } catch (error) {
    return result("error", refusalMessage(error));
  }
}

export async function addOptionalFeeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("invoices:manage");
  try {
    await addOptionalFee(
      principal,
      String(formData.get("enrollmentId") ?? ""),
      String(formData.get("feeName") ?? ""),
    );
    refresh();
    return result("success", t("finance.optionalAdded"));
  } catch (error) {
    return result("error", refusalMessage(error));
  }
}

export async function scholarshipAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("invoices:discount");
  const values = readFields(formData, ["percent", "reason"]);
  const percent = Number(values.percent);
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
    return result("error", t("finance.errors.percent"), values);
  }
  if (values.reason.trim().length < 3) return result("error", t("finance.errors.reason"), values);
  try {
    const n = await grantScholarship(principal, String(formData.get("enrollmentId") ?? ""), {
      percent,
      reason: values.reason,
    });
    refresh();
    return result("success", t("finance.scholarshipGranted", { n }));
  } catch (error) {
    return result("error", refusalMessage(error), values);
  }
}

export async function discountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { principal } = await requireAction("invoices:discount");
  const values = readFields(formData, ["invoiceId", "amount", "reason"]);
  const amount = parseXAF(values.amount);
  if (amount === null) return result("error", t("finance.errors.amount"), values);
  if (values.reason.trim().length < 3) return result("error", t("finance.errors.reason"), values);
  try {
    await grantExceptionalDiscount(principal, values.invoiceId, { amount, reason: values.reason });
    refresh();
    return result("success", t("finance.discountGranted"));
  } catch (error) {
    return result("error", refusalMessage(error), values);
  }
}
