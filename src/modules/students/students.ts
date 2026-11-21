// Fiches élèves et responsables légaux (M2, 2a).
import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { normalizePhone } from "@/server/auth/phone";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool, type Tx } from "@/server/db/client";
import { academicYears, guardians, schools, studentGuardians, students } from "@/server/db/schema";
import { todayInBrazzaville } from "@/lib/dates";
import { StudentError } from "./errors";
import { formatMatricule, searchKey } from "./identity";
import { GuardianSchema, StudentSchema, type GuardianInput, type StudentInput } from "./schemas";

/** Rôles qui voient tous les élèves de l'école. */
const ALL_STUDENTS_ROLES = ["director", "secretary", "accountant", "support"] as const;

export function seesAllStudents(principal: Principal): boolean {
  return principal.roles.some((r) => (ALL_STUDENTS_ROLES as readonly string[]).includes(r));
}

/** Peut ouvrir la liste des élèves : toute l'école, ou ses propres élèves pour un enseignant. */
export function canBrowseStudents(principal: Principal): boolean {
  return seesAllStudents(principal) || principal.roles.includes("teacher");
}

export type ReadContext = { schoolId: string; userId: string; teacherOnly: boolean };

/**
 * Lecture des fiches : la direction, le secrétariat, la comptabilité et le Support voient toute
 * l'école ; un enseignant ne voit que les élèves de ses classes (CLAUDE.md §6, Droits).
 */
export function readContext(principal: Principal): ReadContext {
  authorize(principal, "students:read");
  if (!canBrowseStudents(principal)) throw new StudentError("notFound");
  return {
    schoolId: principal.schoolId as string,
    userId: principal.userId,
    teacherOnly: !seesAllStudents(principal),
  };
}

/**
 * Élèves d'un enseignant : inscrits (non partis) dans une année non archivée, dans une classe dont il
 * est professeur principal ou où il enseigne une matière.
 */
export function teacherStudentsFilter(userId: string) {
  return sql`"students"."id" in (
    select e.student_id from enrollments e
    join academic_years y on y.id = e.academic_year_id
    where e.status <> 'left' and y.status <> 'archived'
      and e.class_id in (
        select c.id from classes c where c.head_teacher_id = ${userId}
        union select cs.class_id from class_subjects cs where cs.teacher_id = ${userId}))`;
}

/** Vérifie qu'un élève existe et est visible pour ce lecteur. */
export async function assertVisibleStudent(tx: Tx, ctx: ReadContext, studentId: string) {
  if (!isUuid(studentId)) throw new StudentError("notFound");
  const [row] = await tx
    .select({ id: students.id })
    .from(students)
    .where(
      and(
        eq(students.schoolId, ctx.schoolId),
        eq(students.id, studentId),
        ctx.teacherOnly ? teacherStudentsFilter(ctx.userId) : undefined,
      ),
    );
  if (!row) throw new StudentError("notFound");
}

function writeContext(principal: Principal) {
  authorize(principal, "students:write");
  return { schoolId: principal.schoolId as string, userId: principal.userId };
}

const isUuid = (value: string) => z.uuid().safeParse(value).success;

export type Guardian = {
  id: string;
  fullName: string;
  phone: string;
  otherPhone: string | null;
  relationship: string | null;
  isPrimary: boolean;
};

export type Student = {
  id: string;
  matricule: string;
  lastName: string;
  firstNames: string;
  sex: "M" | "F";
  birthDate: string | null;
  birthPlace: string | null;
  nationality: string | null;
  previousSchool: string | null;
  photoKey: string | null;
  guardians: Guardian[];
};

export type StudentSummary = Pick<
  Student,
  "id" | "matricule" | "lastName" | "firstNames" | "sex" | "photoKey"
> & { primaryGuardianPhone: string | null };

/** Année « AA » du matricule (hypothèse H38) : début de l'année de travail, sinon l'année civile. */
async function matriculeYear(tx: Tx, schoolId: string): Promise<number> {
  const years = await tx
    .select({ status: academicYears.status, startDate: academicYears.startDate })
    .from(academicYears)
    .where(and(eq(academicYears.schoolId, schoolId), ne(academicYears.status, "archived")));
  const work =
    years.find((y) => y.status === "active") ?? years.find((y) => y.status === "upcoming");
  return Number((work?.startDate ?? todayInBrazzaville()).slice(0, 4));
}

/** Attribue le prochain matricule : compteur de l'école verrouillé, continu, jamais réutilisé. */
async function nextMatricule(tx: Tx, schoolId: string): Promise<string> {
  const [row] = await tx
    .update(schools)
    .set({ lastMatriculeNumber: sql`${schools.lastMatriculeNumber} + 1` })
    .where(eq(schools.id, schoolId))
    .returning({ prefix: schools.matriculePrefix, number: schools.lastMatriculeNumber });
  return formatMatricule(row.prefix, await matriculeYear(tx, schoolId), row.number);
}

/** Retrouve le responsable par son téléphone dans l'école, ou le crée (un parent, plusieurs enfants). */
async function upsertGuardian(
  tx: Tx,
  schoolId: string,
  data: z.output<typeof GuardianSchema>,
): Promise<string> {
  const [existing] = await tx
    .select({ id: guardians.id })
    .from(guardians)
    .where(and(eq(guardians.schoolId, schoolId), eq(guardians.phone, data.phone)));
  if (existing) return existing.id;
  const [created] = await tx
    .insert(guardians)
    .values({ schoolId, ...data })
    .returning({ id: guardians.id });
  return created.id;
}

async function loadGuardians(tx: Tx, studentId: string): Promise<Guardian[]> {
  return tx
    .select({
      id: guardians.id,
      fullName: guardians.fullName,
      phone: guardians.phone,
      otherPhone: guardians.otherPhone,
      relationship: guardians.relationship,
      isPrimary: studentGuardians.isPrimary,
    })
    .from(studentGuardians)
    .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
    .where(eq(studentGuardians.studentId, studentId))
    .orderBy(desc(studentGuardians.isPrimary), asc(guardians.fullName));
}

async function assertStudent(tx: Tx, schoolId: string, studentId: string) {
  if (!isUuid(studentId)) throw new StudentError("notFound");
  const [row] = await tx
    .select({ id: students.id, matricule: students.matricule })
    .from(students)
    .where(and(eq(students.schoolId, schoolId), eq(students.id, studentId)));
  if (!row) throw new StudentError("notFound");
  return row;
}

/**
 * Crée une fiche élève et son responsable principal (retrouvé par téléphone s'il est déjà connu de
 * l'école). Le matricule est attribué dans la même transaction.
 */
export async function createStudent(
  principal: Principal,
  input: { student: StudentInput; guardian: GuardianInput },
): Promise<{ id: string; matricule: string; existingGuardian: boolean }> {
  const ctx = writeContext(principal);
  const student = StudentSchema.parse(input.student);
  const guardian = GuardianSchema.parse(input.guardian);
  return withSchool(ctx, async (tx) => {
    const matricule = await nextMatricule(tx, ctx.schoolId);
    const [row] = await tx
      .insert(students)
      .values({
        schoolId: ctx.schoolId,
        matricule,
        ...student,
        searchText: searchKey(student.lastName, student.firstNames, matricule),
      })
      .returning({ id: students.id });
    const [known] = await tx
      .select({ id: guardians.id })
      .from(guardians)
      .where(and(eq(guardians.schoolId, ctx.schoolId), eq(guardians.phone, guardian.phone)));
    const guardianId = await upsertGuardian(tx, ctx.schoolId, guardian);
    await tx
      .insert(studentGuardians)
      .values({ schoolId: ctx.schoolId, studentId: row.id, guardianId, isPrimary: true });
    return { id: row.id, matricule, existingGuardian: Boolean(known) };
  });
}

export async function updateStudent(
  principal: Principal,
  studentId: string,
  input: StudentInput,
): Promise<void> {
  const ctx = writeContext(principal);
  const data = StudentSchema.parse(input);
  await withSchool(ctx, async (tx) => {
    const current = await assertStudent(tx, ctx.schoolId, studentId);
    await tx
      .update(students)
      .set({
        ...data,
        searchText: searchKey(data.lastName, data.firstNames, current.matricule),
        updatedAt: new Date(),
      })
      .where(eq(students.id, studentId));
  });
}

export async function getStudent(principal: Principal, studentId: string): Promise<Student> {
  const ctx = readContext(principal);
  if (!isUuid(studentId)) throw new StudentError("notFound");
  return withSchool(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(students)
      .where(
        and(
          eq(students.schoolId, ctx.schoolId),
          eq(students.id, studentId),
          ctx.teacherOnly ? teacherStudentsFilter(ctx.userId) : undefined,
        ),
      );
    if (!row) throw new StudentError("notFound");
    return {
      id: row.id,
      matricule: row.matricule,
      lastName: row.lastName,
      firstNames: row.firstNames,
      sex: row.sex,
      birthDate: row.birthDate,
      birthPlace: row.birthPlace,
      nationality: row.nationality,
      previousSchool: row.previousSchool,
      photoKey: row.photoKey,
      guardians: await loadGuardians(tx, row.id),
    };
  });
}

export const SEARCH_LIMIT = 50;

/**
 * Recherche instantanée : nom ou prénoms (sans tenir compte des accents), matricule, ou téléphone
 * d'un responsable. Sans texte : les dernières fiches créées.
 */
export async function searchStudents(
  principal: Principal,
  query: string,
): Promise<StudentSummary[]> {
  const ctx = readContext(principal);
  const text = query.trim().slice(0, 80);
  const key = searchKey(text);
  const phone = normalizePhone(text);
  return withSchool(ctx, async (tx) => {
    let byPhone: string[] = [];
    if (phone) {
      const rows = await tx
        .select({ studentId: studentGuardians.studentId })
        .from(studentGuardians)
        .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
        .where(or(eq(guardians.phone, phone), eq(guardians.otherPhone, phone)));
      byPhone = rows.map((r) => r.studentId);
    }
    const words = key.split(" ").filter(Boolean);
    const conditions = [
      ...(words.length > 0
        ? [and(...words.map((w) => ilike(students.searchText, `%${w.replace(/[%_]/g, "")}%`)))]
        : []),
      ...(byPhone.length > 0 ? [inArray(students.id, byPhone)] : []),
    ];
    if (text !== "" && conditions.length === 0) return [];
    const rows = await tx
      .select({
        id: students.id,
        matricule: students.matricule,
        lastName: students.lastName,
        firstNames: students.firstNames,
        sex: students.sex,
        photoKey: students.photoKey,
        primaryGuardianPhone: sql<string | null>`(
          select g.phone from student_guardians sg join guardians g on g.id = sg.guardian_id
          where sg.student_id = "students"."id" and sg.is_primary limit 1)`,
      })
      .from(students)
      .where(
        and(
          eq(students.schoolId, ctx.schoolId),
          ctx.teacherOnly ? teacherStudentsFilter(ctx.userId) : undefined,
          text === "" ? undefined : or(...conditions),
        ),
      )
      .orderBy(
        text === "" ? desc(students.createdAt) : asc(students.lastName),
        asc(students.firstNames),
      )
      .limit(SEARCH_LIMIT);
    return rows;
  });
}

// --- Responsables -----------------------------------------------------------------------------

/** Ajoute un responsable à l'élève (retrouvé par téléphone s'il est déjà connu de l'école). */
export async function addGuardian(
  principal: Principal,
  studentId: string,
  input: GuardianInput,
  makePrimary = false,
): Promise<void> {
  const ctx = writeContext(principal);
  const data = GuardianSchema.parse(input);
  await withSchool(ctx, async (tx) => {
    await assertStudent(tx, ctx.schoolId, studentId);
    const guardianId = await upsertGuardian(tx, ctx.schoolId, data);
    const [linked] = await tx
      .select({ id: studentGuardians.id })
      .from(studentGuardians)
      .where(
        and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.guardianId, guardianId)),
      );
    if (linked) throw new StudentError("guardianAlreadyLinked");
    if (makePrimary) {
      await tx
        .update(studentGuardians)
        .set({ isPrimary: false })
        .where(eq(studentGuardians.studentId, studentId));
    }
    await tx
      .insert(studentGuardians)
      .values({ schoolId: ctx.schoolId, studentId, guardianId, isPrimary: makePrimary });
  });
}

/** Modifie un responsable : le changement vaut pour tous ses enfants dans l'école. */
export async function updateGuardian(
  principal: Principal,
  guardianId: string,
  input: GuardianInput,
): Promise<void> {
  const ctx = writeContext(principal);
  const data = GuardianSchema.parse(input);
  if (!isUuid(guardianId)) throw new StudentError("guardianNotFound");
  await withSchool(ctx, async (tx) => {
    const [clash] = await tx
      .select({ id: guardians.id })
      .from(guardians)
      .where(
        and(
          eq(guardians.schoolId, ctx.schoolId),
          eq(guardians.phone, data.phone),
          ne(guardians.id, guardianId),
        ),
      );
    if (clash) throw new StudentError("guardianAlreadyLinked");
    const updated = await tx
      .update(guardians)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(guardians.schoolId, ctx.schoolId), eq(guardians.id, guardianId)))
      .returning({ id: guardians.id });
    if (updated.length === 0) throw new StudentError("guardianNotFound");
  });
}

export async function setPrimaryGuardian(
  principal: Principal,
  studentId: string,
  guardianId: string,
): Promise<void> {
  const ctx = writeContext(principal);
  if (!isUuid(guardianId)) throw new StudentError("guardianNotFound");
  await withSchool(ctx, async (tx) => {
    await assertStudent(tx, ctx.schoolId, studentId);
    const links = await tx
      .select({ guardianId: studentGuardians.guardianId })
      .from(studentGuardians)
      .where(eq(studentGuardians.studentId, studentId));
    if (!links.some((l) => l.guardianId === guardianId)) throw new StudentError("guardianNotFound");
    await tx
      .update(studentGuardians)
      .set({ isPrimary: false })
      .where(eq(studentGuardians.studentId, studentId));
    await tx
      .update(studentGuardians)
      .set({ isPrimary: true })
      .where(
        and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.guardianId, guardianId)),
      );
  });
}

/** Retire un responsable de l'élève (il en reste toujours au moins un ; le principal passe au suivant). */
export async function removeGuardian(
  principal: Principal,
  studentId: string,
  guardianId: string,
): Promise<void> {
  const ctx = writeContext(principal);
  if (!isUuid(guardianId)) throw new StudentError("guardianNotFound");
  await withSchool(ctx, async (tx) => {
    await assertStudent(tx, ctx.schoolId, studentId);
    const links = await tx
      .select({ guardianId: studentGuardians.guardianId, isPrimary: studentGuardians.isPrimary })
      .from(studentGuardians)
      .where(eq(studentGuardians.studentId, studentId))
      .for("update");
    const target = links.find((l) => l.guardianId === guardianId);
    if (!target) throw new StudentError("guardianNotFound");
    if (links.length === 1) throw new StudentError("lastGuardian");
    await tx
      .delete(studentGuardians)
      .where(
        and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.guardianId, guardianId)),
      );
    if (target.isPrimary) {
      const next = links.find((l) => l.guardianId !== guardianId)!;
      await tx
        .update(studentGuardians)
        .set({ isPrimary: true })
        .where(
          and(
            eq(studentGuardians.studentId, studentId),
            eq(studentGuardians.guardianId, next.guardianId),
          ),
        );
    }
  });
}
