// Totaux d'absences et de retards d'élèves sur une période (conseil de classe 3f, bulletins 3g).
import { and, gte, inArray, lte, sql } from "drizzle-orm";
import type { Tx } from "@/server/db/client";
import { attendance } from "@/server/db/schema";

/** Comptés en créneaux manqués (une demi-journée = un créneau, hypothèse H100). */
export type AttendanceTotals = { absences: number; unjustified: number; lates: number };

export async function attendanceTotals(
  tx: Tx,
  enrollmentIds: readonly string[],
  from: string,
  to: string,
): Promise<Map<string, AttendanceTotals>> {
  const totals = new Map<string, AttendanceTotals>(
    enrollmentIds.map((id) => [id, { absences: 0, unjustified: 0, lates: 0 }]),
  );
  if (enrollmentIds.length === 0) return totals;
  const rows = await tx
    .select({
      enrollmentId: attendance.enrollmentId,
      absences: sql<number>`count(*) filter (where ${attendance.status} = 'absent')::int`,
      unjustified: sql<number>`count(*) filter (where ${attendance.status} = 'absent' and not ${attendance.justified})::int`,
      lates: sql<number>`count(*) filter (where ${attendance.status} = 'late')::int`,
    })
    .from(attendance)
    .where(
      and(
        inArray(attendance.enrollmentId, [...enrollmentIds]),
        gte(attendance.date, from),
        lte(attendance.date, to),
      ),
    )
    .groupBy(attendance.enrollmentId);
  for (const r of rows) {
    totals.set(r.enrollmentId, {
      absences: r.absences,
      unjustified: r.unjustified,
      lates: r.lates,
    });
  }
  return totals;
}
