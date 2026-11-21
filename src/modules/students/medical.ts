// Données médicales (décision A4) : lecture et écriture par la direction seule. La base le garantit
// aussi (politique RLS liée au rôle de la session), même si l'application se trompait.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool } from "@/server/db/client";
import { studentMedical, students } from "@/server/db/schema";
import { StudentError } from "./errors";
import { MedicalSchema, type MedicalInput } from "./schemas";

export type Medical = z.output<typeof MedicalSchema>;

const EMPTY: Medical = {
  allergies: null,
  treatments: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  notes: null,
};

function context(principal: Principal, studentId: string) {
  authorize(principal, "students:medical");
  if (!z.uuid().safeParse(studentId).success) throw new StudentError("notFound");
  return { schoolId: principal.schoolId as string, userId: principal.userId };
}

export async function getMedical(principal: Principal, studentId: string): Promise<Medical> {
  const ctx = context(principal, studentId);
  return withSchool(ctx, async (tx) => {
    const [row] = await tx
      .select({
        allergies: studentMedical.allergies,
        treatments: studentMedical.treatments,
        emergencyContactName: studentMedical.emergencyContactName,
        emergencyContactPhone: studentMedical.emergencyContactPhone,
        notes: studentMedical.notes,
      })
      .from(studentMedical)
      .where(
        and(eq(studentMedical.schoolId, ctx.schoolId), eq(studentMedical.studentId, studentId)),
      );
    return row ?? EMPTY;
  });
}

export async function saveMedical(
  principal: Principal,
  studentId: string,
  input: MedicalInput,
): Promise<void> {
  const ctx = context(principal, studentId);
  const data = MedicalSchema.parse(input);
  await withSchool(ctx, async (tx) => {
    const [student] = await tx
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.schoolId, ctx.schoolId), eq(students.id, studentId)));
    if (!student) throw new StudentError("notFound");
    await tx
      .insert(studentMedical)
      .values({ schoolId: ctx.schoolId, studentId, ...data })
      .onConflictDoUpdate({
        target: studentMedical.studentId,
        set: { ...data, updatedAt: new Date() },
      });
  });
}
