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
