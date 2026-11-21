// Calculs sur les années et les périodes (fonctions pures, testées unitairement).
// Dates au format « AAAA-MM-JJ » : ce sont des jours du calendrier, sans heure ni fuseau.

export type PeriodKind = "trimester" | "semester";
export type PeriodDraft = { position: number; label: string; startDate: string; endDate: string };

export const PERIOD_COUNT: Record<PeriodKind, number> = { trimester: 3, semester: 2 };

const DAY_MS = 24 * 60 * 60 * 1000;
const toDays = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const fromDays = (days: number) => new Date(days * DAY_MS).toISOString().slice(0, 10);

/** Vrai pour une date réelle au format AAAA-MM-JJ (refuse le 30 février). */
export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && fromDays(time / DAY_MS) === value;
}

/** « 1er trimestre », « 2e semestre »… (libellé par défaut, modifiable par l'école). */
export function defaultPeriodLabel(kind: PeriodKind, position: number): string {
  const ordinal = position === 1 ? "1er" : `${position}e`;
  return `${ordinal} ${kind === "trimester" ? "trimestre" : "semestre"}`;
}

/** Dernier jour du mois (mois de 1 à 12). */
const lastDayOfMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();
const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const monthStart = (index: number) =>
  `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
const monthEnd = (index: number) => {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${lastDayOfMonth(year, month)}`;
};

/**
 * Découpage proposé par défaut, sans trou. Si l'année va du 1er d'un mois au dernier jour d'un mois,
 * les périodes sont en mois entiers (ex. octobre-décembre, janvier-mars, avril-juin) ; sinon, en
 * durées égales au jour près. L'école ajuste ensuite les dates (vacances, compositions…).
 */
export function proposePeriods(
  kind: PeriodKind,
  startDate: string,
  endDate: string,
): PeriodDraft[] {
  const count = PERIOD_COUNT[kind];
  const label = (i: number) => defaultPeriodLabel(kind, i + 1);
  const firstMonth = monthIndex(startDate);
  const months = monthIndex(endDate) - firstMonth + 1;
  const wholeMonths =
    startDate.endsWith("-01") && endDate === monthEnd(monthIndex(endDate)) && months >= count;

  return Array.from({ length: count }, (_, i) => {
    if (wholeMonths) {
      const from = firstMonth + Math.floor((months * i) / count);
      const to = firstMonth + Math.floor((months * (i + 1)) / count) - 1;
      return {
        position: i + 1,
        label: label(i),
        startDate: monthStart(from),
        endDate: monthEnd(to),
      };
    }
    const start = toDays(startDate);
    const total = toDays(endDate) - start + 1;
    const from = start + Math.floor((total * i) / count);
    const to = start + Math.floor((total * (i + 1)) / count) - 1;
    return { position: i + 1, label: label(i), startDate: fromDays(from), endDate: fromDays(to) };
  });
}

/**
 * Année proposée à la création. Hypothèse : rentrée le 1er octobre, fin le 30 juin.
 * À partir de juillet, on propose l'année qui commence à l'automne suivant.
 */
export function proposeYear(today: string): { label: string; startDate: string; endDate: string } {
  const [year, month] = today.split("-").map(Number);
  const first = month >= 7 ? year : year - 1;
  return {
    label: `${first}-${first + 1}`,
    startDate: `${first}-10-01`,
    endDate: `${first + 1}-06-30`,
  };
}

export type PeriodsProblem =
  "periodsCount" | "periodDates" | "periodsOutsideYear" | "periodsOverlap" | "periodLabel";

/**
 * Vérifie les périodes d'une année : bon nombre, numérotées 1…n, dates valides, comprises dans
 * l'année, dans l'ordre et sans chevauchement (un trou entre deux périodes est permis : vacances).
 */
export function checkPeriods(
  year: { startDate: string; endDate: string; periodKind: PeriodKind },
  periods: readonly PeriodDraft[],
): PeriodsProblem | null {
  const sorted = [...periods].sort((a, b) => a.position - b.position);
  if (sorted.length !== PERIOD_COUNT[year.periodKind]) return "periodsCount";
  if (sorted.some((p, i) => p.position !== i + 1)) return "periodsCount";
  if (sorted.some((p) => p.label.trim().length === 0 || p.label.length > 60)) return "periodLabel";
  if (sorted.some((p) => !isValidDate(p.startDate) || !isValidDate(p.endDate)))
    return "periodDates";
  if (sorted.some((p) => p.startDate > p.endDate)) return "periodDates";
  if (sorted.some((p) => p.startDate < year.startDate || p.endDate > year.endDate)) {
    return "periodsOutsideYear";
  }
  if (sorted.some((p, i) => i > 0 && p.startDate <= sorted[i - 1].endDate)) return "periodsOverlap";
  return null;
}
