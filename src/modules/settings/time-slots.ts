// Créneaux simples de l'école (décisions A1, A8), utilisés par l'appel en M5. Pas un emploi du temps.
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool } from "@/server/db/client";
import { timeSlots } from "@/server/db/schema";
import { isForeignKeyViolation, isUniqueViolation, SettingsError } from "./errors";

/** Heure « 7:30 », « 07:30 » ou « 7h30 » → « 07:30 ». */
const TimeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v, ctx) => {
    const m = /^(\d{1,2})[:h](\d{2})$/.exec(v);
    const hours = m ? Number(m[1]) : NaN;
    const minutes = m ? Number(m[2]) : NaN;
    if (!(hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59)) {
      ctx.addIssue({ code: "custom", message: "time" });
      return z.NEVER;
    }
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  });

export const TimeSlotSchema = z
  .object({
    label: z.string().trim().min(1).max(40),
    startTime: TimeSchema,
    endTime: TimeSchema,
  })
  .refine((s) => s.startTime < s.endTime, { path: ["endTime"], message: "order" });
export type TimeSlotInput = z.input<typeof TimeSlotSchema>;

export type TimeSlot = { id: string; label: string; startTime: string; endTime: string };

function context(principal: Principal, action: "settings:read" | "settings:write") {
  authorize(principal, action);
  return { schoolId: principal.schoolId as string, userId: principal.userId };
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isUniqueViolation(error)) throw new SettingsError("timeSlotLabelTaken");
    if (isForeignKeyViolation(error)) throw new SettingsError("timeSlotInUse");
    throw error;
  }
}

const hhmm = (time: string) => time.slice(0, 5);

export async function listTimeSlots(principal: Principal): Promise<TimeSlot[]> {
  const ctx = context(principal, "settings:read");
  const rows = await withSchool(ctx, (tx) =>
    tx
      .select({
        id: timeSlots.id,
        label: timeSlots.label,
        startTime: timeSlots.startTime,
        endTime: timeSlots.endTime,
      })
      .from(timeSlots)
      .where(eq(timeSlots.schoolId, ctx.schoolId))
      .orderBy(asc(timeSlots.startTime), asc(timeSlots.endTime)),
  );
  return rows.map((r) => ({ ...r, startTime: hhmm(r.startTime), endTime: hhmm(r.endTime) }));
}

export async function createTimeSlot(principal: Principal, input: TimeSlotInput): Promise<string> {
  const ctx = context(principal, "settings:write");
  const data = TimeSlotSchema.parse(input);
  return guarded(() =>
    withSchool(ctx, async (tx) => {
      const [row] = await tx
        .insert(timeSlots)
        .values({ schoolId: ctx.schoolId, ...data })
        .returning({ id: timeSlots.id });
      return row.id;
    }),
  );
}

export async function updateTimeSlot(
  principal: Principal,
  slotId: string,
  input: TimeSlotInput,
): Promise<void> {
  const ctx = context(principal, "settings:write");
  const data = TimeSlotSchema.parse(input);
  if (!z.uuid().safeParse(slotId).success) throw new SettingsError("timeSlotNotFound");
  await guarded(() =>
    withSchool(ctx, async (tx) => {
      const updated = await tx
        .update(timeSlots)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(timeSlots.schoolId, ctx.schoolId), eq(timeSlots.id, slotId)))
        .returning({ id: timeSlots.id });
      if (updated.length === 0) throw new SettingsError("timeSlotNotFound");
    }),
  );
}

/** Supprime un créneau (refusé plus tard s'il a servi à un appel). */
export async function deleteTimeSlot(principal: Principal, slotId: string): Promise<void> {
  const ctx = context(principal, "settings:write");
  if (!z.uuid().safeParse(slotId).success) throw new SettingsError("timeSlotNotFound");
  await guarded(() =>
    withSchool(ctx, async (tx) => {
      const deleted = await tx
        .delete(timeSlots)
        .where(and(eq(timeSlots.schoolId, ctx.schoolId), eq(timeSlots.id, slotId)))
        .returning({ id: timeSlots.id });
      if (deleted.length === 0) throw new SettingsError("timeSlotNotFound");
    }),
  );
}
