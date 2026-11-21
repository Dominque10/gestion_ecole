/** Fuseau d'affichage : les dates sont stockées en UTC et affichées à l'heure de Brazzaville. */
export const DISPLAY_TIMEZONE = "Africa/Brazzaville";

/** Heure au format français, ex. « 14:05 ». */
export function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DISPLAY_TIMEZONE,
  }).format(date);
}

/** Date du jour à Brazzaville, au format AAAA-MM-JJ. */
export function todayInBrazzaville(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DISPLAY_TIMEZONE }).format(now);
}

/** Jour du calendrier (AAAA-MM-JJ) au format français, ex. « 1 oct. 2026 ». */
export function formatDay(day: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

/** Début et fin (exclue) d'une journée de Brazzaville (UTC+1, sans heure d'été), en instants UTC. */
export function brazzavilleDayRange(day: string): { from: Date; to: Date } {
  const from = new Date(`${day}T00:00:00+01:00`);
  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000) };
}

/** Date et heure à Brazzaville, ex. « 21/11/2026 14:05 ». */
export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DISPLAY_TIMEZONE,
  }).format(date);
}
