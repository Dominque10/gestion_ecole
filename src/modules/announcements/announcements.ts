// Annonces de l'école aux parents (M6, sous-étape 4e) : toute l'école, un niveau ou une classe ; par le
// directeur ou le secrétariat (décision du porteur) ; lisibles dans l'espace parents ; envoyées aussi
// par message si la case est cochée (cochée par défaut) : un seul message par famille.
import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool } from "@/server/db/client";
import {
  academicYears,
  announcements,
  classes,
  enrollments,
  levels,
  studentGuardians,
  users,
} from "@/server/db/schema";
import { scheduleNotice, type NoticeJob } from "@/modules/notifications/notices";
import { SettingsError } from "@/modules/settings/errors";

export const AnnouncementSchema = z
  .object({
    audience: z.enum(["school", "level", "class"]),
    levelId: z.uuid().nullable(),
    classId: z.uuid().nullable(),
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(300),
    sendMessage: z.boolean(),
  })
  .refine(
    (a) =>
      (a.audience === "school" && !a.levelId && !a.classId) ||
      (a.audience === "level" && a.levelId && !a.classId) ||
      (a.audience === "class" && a.classId && !a.levelId),
  );
export type AnnouncementInput = z.input<typeof AnnouncementSchema>;

function context(principal: Principal) {
  authorize(principal, "announcements:send");
  return { schoolId: principal.schoolId as string, userId: principal.userId };
}

/** Publie une annonce dans l'année active ; programme un message par famille si demandé. */
export async function publishAnnouncement(
  principal: Principal,
  input: AnnouncementInput,
  schedule: (job: NoticeJob) => Promise<void> = scheduleNotice,
): Promise<{ id: string; messages: number }> {
  const ctx = context(principal);
  const parsed = AnnouncementSchema.safeParse(input);
  if (!parsed.success) throw new SettingsError("announcementInvalid");
  const data = parsed.data;
  const { id, recipients } = await withSchool(ctx, async (tx) => {
    const [year] = await tx
      .select({ id: academicYears.id })
      .from(academicYears)
      .where(and(eq(academicYears.schoolId, ctx.schoolId), eq(academicYears.status, "active")));
    if (!year) throw new SettingsError("yearNotFound");
    if (data.classId) {
      const [c] = await tx
        .select({ id: classes.id })
        .from(classes)
        .where(and(eq(classes.id, data.classId), eq(classes.academicYearId, year.id)));
      if (!c) throw new SettingsError("classNotFound");
    }
    if (data.levelId) {
      const [l] = await tx
        .select({ id: levels.id })
        .from(levels)
        .where(eq(levels.id, data.levelId));
      if (!l) throw new SettingsError("levelNotFound");
    }
    const [row] = await tx
      .insert(announcements)
      .values({
        schoolId: ctx.schoolId,
        academicYearId: year.id,
        audience: data.audience,
        levelId: data.levelId,
        classId: data.classId,
        title: data.title,
        body: data.body,
        sendMessage: data.sendMessage,
        createdBy: ctx.userId,
      })
      .returning({ id: announcements.id });
    if (!data.sendMessage) return { id: row.id, recipients: [] as string[] };
    // Une famille = un responsable principal : un seul message, au nom de l'un de ses enfants concernés.
    const rows = await tx
      .select({
        guardianId: studentGuardians.guardianId,
        enrollmentId: sql<string>`min(${enrollments.id}::text)`,
      })
      .from(enrollments)
      .innerJoin(
        studentGuardians,
        and(
          eq(studentGuardians.studentId, enrollments.studentId),
          eq(studentGuardians.isPrimary, true),
        ),
      )
      .where(
        and(
          eq(enrollments.academicYearId, year.id),
          ne(enrollments.status, "left"),
          data.levelId ? eq(enrollments.levelId, data.levelId) : undefined,
          data.classId ? eq(enrollments.classId, data.classId) : undefined,
        ),
      )
      .groupBy(studentGuardians.guardianId);
    const list = rows.map((r) => r.enrollmentId);
    await tx
      .update(announcements)
      .set({ messageCount: list.length })
      .where(eq(announcements.id, row.id));
    return { id: row.id, recipients: list };
  });
  for (const enrollmentId of recipients) {
    await schedule({ type: "announcement", ...ctx, enrollmentId, announcementId: id }).catch(
      (error: unknown) =>
        console.error("Message d'annonce non programmé :", (error as Error).message),
    );
  }
  return { id, messages: recipients.length };
}

export type AnnouncementLine = {
  id: string;
  title: string;
  body: string;
  audience: "school" | "level" | "class";
  audienceName: string | null;
  sendMessage: boolean;
  messageCount: number;
  authorName: string;
  createdAt: Date;
};

/** Annonces de l'année active (personnel), de la plus récente à la plus ancienne. */
export async function listAnnouncements(principal: Principal): Promise<AnnouncementLine[]> {
  const ctx = context(principal);
  return withSchool(ctx, (tx) =>
    tx
      .select({
        id: announcements.id,
        title: announcements.title,
        body: announcements.body,
        audience: announcements.audience,
        audienceName: sql<string | null>`coalesce(${classes.name}, ${levels.name})`,
        sendMessage: announcements.sendMessage,
        messageCount: announcements.messageCount,
        authorName: users.name,
        createdAt: announcements.createdAt,
      })
      .from(announcements)
      .innerJoin(academicYears, eq(academicYears.id, announcements.academicYearId))
      .innerJoin(users, eq(users.id, announcements.createdBy))
      .leftJoin(levels, eq(levels.id, announcements.levelId))
      .leftJoin(classes, eq(classes.id, announcements.classId))
      .where(and(eq(announcements.schoolId, ctx.schoolId), eq(academicYears.status, "active")))
      .orderBy(desc(announcements.createdAt))
      .limit(100),
  );
}

export type ChildAnnouncement = { id: string; title: string; body: string; createdAt: Date };

/** Annonces qui concernent un enfant (parent ; la RLS ne lui montre que celles de ses enfants). */
export async function getChildAnnouncements(
  principal: Principal,
  enrollmentId: string,
): Promise<ChildAnnouncement[]> {
  authorize(principal, "parent:view");
  if (!z.uuid().safeParse(enrollmentId).success) return [];
  const ctx = { schoolId: principal.schoolId as string, userId: principal.userId };
  return withSchool(ctx, async (tx) => {
    const [child] = await tx
      .select({
        yearId: enrollments.academicYearId,
        levelId: enrollments.levelId,
        classId: enrollments.classId,
      })
      .from(enrollments)
      .where(eq(enrollments.id, enrollmentId));
    if (!child) return [];
    return tx
      .select({
        id: announcements.id,
        title: announcements.title,
        body: announcements.body,
        createdAt: announcements.createdAt,
      })
      .from(announcements)
      .where(
        and(
          eq(announcements.academicYearId, child.yearId),
          or(
            eq(announcements.audience, "school"),
            and(eq(announcements.audience, "level"), eq(announcements.levelId, child.levelId)),
            child.classId
              ? and(eq(announcements.audience, "class"), eq(announcements.classId, child.classId))
              : undefined,
          ),
        ),
      )
      .orderBy(desc(announcements.createdAt))
      .limit(10);
  });
}
