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
