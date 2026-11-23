// Réglages des messages aux parents (4d), par le directeur : canal (SMS ou WhatsApp), plafond mensuel,
// modèles en français ; et le journal des envois avec leur coût.
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { todayInBrazzaville } from "@/lib/dates";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool } from "@/server/db/client";
import { auditLogs, enrollments, notifications, schools, students } from "@/server/db/schema";
import { SettingsError } from "@/modules/settings/errors";
import { checkTemplate, readTemplates, TEMPLATE_KINDS, type TemplateKind } from "./templates";

export type NotificationSettings = {
  channel: "sms" | "whatsapp";
  /** Plafond mensuel en FCFA ; null = sans plafond. */
  monthlyCap: number | null;
  templates: Record<TemplateKind, string>;
};

function context(principal: Principal) {
  authorize(principal, "notifications:templates");
  return { schoolId: principal.schoolId as string, userId: principal.userId };
}

export async function getNotificationSettings(principal: Principal): Promise<NotificationSettings> {
  const ctx = context(principal);
  const [row] = await withSchool(ctx, (tx) =>
    tx
      .select({
        channel: schools.notificationChannel,
        cap: schools.notificationMonthlyCap,
        templates: schools.notificationTemplates,
      })
      .from(schools)
      .where(eq(schools.id, ctx.schoolId)),
  );
  return {
    channel: row.channel === "whatsapp" ? "whatsapp" : "sms",
    monthlyCap: row.cap,
    templates: readTemplates(row.templates),
  };
}

const SettingsSchema = z.object({
  channel: z.enum(["sms", "whatsapp"]),
  monthlyCap: z.number().int().min(0).max(100_000_000).nullable(),
  templates: z.record(z.string(), z.string()),
});

/** Modèle invalide : message d'erreur avec le message concerné (et le champ inconnu, s'il y en a un). */
export class TemplateError extends Error {
  constructor(
    readonly kind: TemplateKind,
    readonly problem: "empty" | "tooLong" | "unknownField",
    readonly field?: string,
  ) {
    super(`Modèle ${kind} : ${problem}`);
    this.name = "TemplateError";
  }
}

export async function updateNotificationSettings(
  principal: Principal,
  input: { channel: string; monthlyCap: number | null; templates: Record<string, string> },
): Promise<void> {
  const ctx = context(principal);
  const parsed = SettingsSchema.safeParse(input);
  if (!parsed.success) throw new SettingsError("notificationsInvalid");
  const templates: Record<string, string> = {};
  for (const kind of TEMPLATE_KINDS) {
    const text = parsed.data.templates[kind] ?? "";
    const problem = checkTemplate(kind, text);
    if (problem) {
      throw new TemplateError(
        kind,
        problem.problem,
        "field" in problem ? problem.field : undefined,
      );
    }
    templates[kind] = text.trim();
  }
  await withSchool(ctx, async (tx) => {
    const [before] = await tx
      .select({
        channel: schools.notificationChannel,
        cap: schools.notificationMonthlyCap,
        templates: schools.notificationTemplates,
      })
      .from(schools)
      .where(eq(schools.id, ctx.schoolId));
    await tx
      .update(schools)
      .set({
        notificationChannel: parsed.data.channel,
        notificationMonthlyCap: parsed.data.monthlyCap,
        notificationTemplates: templates,
        updatedAt: new Date(),
      })
      .where(eq(schools.id, ctx.schoolId));
    await tx.insert(auditLogs).values({
      schoolId: ctx.schoolId,
      actorUserId: ctx.userId,
      action: "school.notifications",
      entityType: "school",
      entityId: ctx.schoolId,
      before,
      after: { channel: parsed.data.channel, cap: parsed.data.monthlyCap, templates },
    });
  });
}

export type SentMessage = {
  id: string;
  createdAt: Date;
  kind: TemplateKind;
  channel: "sms" | "whatsapp";
  status: "sent" | "failed" | "skipped";
  cost: number;
  phone: string;
  body: string;
  studentName: string;
  error: string | null;
};

/** Derniers messages envoyés et dépense du mois en cours. */
export async function listSentMessages(
  principal: Principal,
  limit = 50,
): Promise<{ messages: SentMessage[]; monthCost: number; monthCount: number }> {
  const ctx = context(principal);
  const monthStart = `${todayInBrazzaville().slice(0, 8)}01`;
  return withSchool(ctx, async (tx) => {
    const messages = await tx
      .select({
        id: notifications.id,
        createdAt: notifications.createdAt,
        kind: notifications.kind,
        channel: notifications.channel,
        status: notifications.status,
        cost: notifications.cost,
        phone: notifications.phone,
        body: notifications.body,
        studentName: sql<string>`${students.lastName} || ' ' || ${students.firstNames}`,
        error: notifications.error,
      })
      .from(notifications)
      .innerJoin(enrollments, eq(enrollments.id, notifications.enrollmentId))
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(eq(notifications.schoolId, ctx.schoolId))
      .orderBy(desc(notifications.createdAt))
      .limit(Math.min(Math.max(limit, 1), 200));
    const [month] = await tx
      .select({
        cost: sql<number>`coalesce(sum(${notifications.cost}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.status, "sent"),
          gte(notifications.createdAt, sql`(${monthStart}::date)::timestamptz`),
        ),
      );
    return { messages, monthCost: month.cost, monthCount: month.count };
  });
}
