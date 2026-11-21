// Assistant de démarrage (M1) : où en est le paramétrage de l'école, étape par étape.
import { and, arrayOverlaps, count, eq, ne } from "drizzle-orm";
import { authorize, type Principal } from "@/server/auth/permissions";
import { withSchool } from "@/server/db/client";
import {
  academicYears,
  classes,
  feeItems,
  levels,
  levelSubjects,
  memberships,
  schools,
  subjects,
  timeSlots,
} from "@/server/db/schema";

export const SETUP_STEPS = [
  "profile",
  "year",
  "levels",
  "subjects",
  "coefficients",
  "classes",
  "timeSlots",
  "fees",
  "staff",
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export const SETUP_LINKS: Record<SetupStep, string> = {
  profile: "/parametres/ecole",
  year: "/parametres/annees",
  levels: "/parametres/niveaux",
  subjects: "/parametres/matieres",
  coefficients: "/parametres/coefficients",
  classes: "/parametres/classes",
  timeSlots: "/parametres/creneaux",
  fees: "/parametres/frais",
  staff: "/parametres/personnel",
};

export type SetupStatus = {
  steps: { step: SetupStep; done: boolean }[];
  /** Première étape non faite (null : tout est prêt). */
  next: SetupStep | null;
};

/**
 * Critères (hypothèse) : fiche = adresse ou téléphone renseigné ; année = au moins une année non
 * archivée ; coefficients, classes et frais = au moins une ligne pour l'année de travail (en cours,
 * sinon en préparation) ; personnel = au moins une personne en plus du directeur connecté.
 */
export async function getSetupStatus(principal: Principal): Promise<SetupStatus> {
  authorize(principal, "settings:read");
  const schoolId = principal.schoolId as string;
  const done = await withSchool({ schoolId, userId: principal.userId }, async (tx) => {
    const n = async (query: Promise<{ n: number }[]>) => ((await query)[0]?.n ?? 0) > 0;
    const [school] = await tx
      .select({ address: schools.address, phone: schools.phone })
      .from(schools)
      .where(eq(schools.id, schoolId));
    const years = await tx
      .select({ id: academicYears.id, status: academicYears.status })
      .from(academicYears)
      .where(and(eq(academicYears.schoolId, schoolId), ne(academicYears.status, "archived")));
    const workYear =
      years.find((y) => y.status === "active")?.id ??
      years.find((y) => y.status === "upcoming")?.id;
    const inYear = async (
      table: typeof levelSubjects | typeof classes | typeof feeItems,
    ): Promise<boolean> =>
      workYear
        ? n(tx.select({ n: count() }).from(table).where(eq(table.academicYearId, workYear)))
        : false;

    return {
      profile: Boolean(school?.address || school?.phone),
      year: years.length > 0,
      levels: await n(tx.select({ n: count() }).from(levels).where(eq(levels.schoolId, schoolId))),
      subjects: await n(
        tx.select({ n: count() }).from(subjects).where(eq(subjects.schoolId, schoolId)),
      ),
      coefficients: await inYear(levelSubjects),
      classes: await inYear(classes),
      timeSlots: await n(
        tx.select({ n: count() }).from(timeSlots).where(eq(timeSlots.schoolId, schoolId)),
      ),
      fees: await inYear(feeItems),
      staff: await n(
        tx
          .select({ n: count() })
          .from(memberships)
          .where(
            and(
              eq(memberships.schoolId, schoolId),
              ne(memberships.userId, principal.userId),
              arrayOverlaps(memberships.roles, ["director", "secretary", "accountant", "teacher"]),
            ),
          ),
      ),
    } satisfies Record<SetupStep, boolean>;
  });
  const steps = SETUP_STEPS.map((step) => ({ step, done: done[step] }));
  return { steps, next: steps.find((s) => !s.done)?.step ?? null };
}
