import { describe, expect, it } from "vitest";
import {
  brazzavilleDayRange,
  formatDateTime,
  formatDay,
  formatTime,
  todayInBrazzaville,
} from "./dates";

describe("formatTime", () => {
  it("affiche l'heure de Brazzaville (UTC+1)", () => {
    expect(formatTime(new Date("2026-11-21T13:05:00Z"))).toBe("14:05");
  });
});

describe("todayInBrazzaville / formatDay", () => {
  it("donne le jour à Brazzaville (UTC+1), même juste avant minuit UTC", () => {
    expect(todayInBrazzaville(new Date("2026-11-21T23:30:00Z"))).toBe("2026-11-22");
    expect(todayInBrazzaville(new Date("2026-11-21T22:30:00Z"))).toBe("2026-11-21");
  });

  it("affiche un jour du calendrier en français, sans décalage de fuseau", () => {
    expect(formatDay("2026-10-01")).toBe("1 oct. 2026");
  });
});

describe("brazzavilleDayRange / formatDateTime", () => {
  it("la journée de Brazzaville commence à 23 h UTC la veille", () => {
    const { from, to } = brazzavilleDayRange("2026-11-21");
    expect(from.toISOString()).toBe("2026-11-20T23:00:00.000Z");
    expect(to.toISOString()).toBe("2026-11-21T23:00:00.000Z");
  });

  it("affiche date et heure de Brazzaville", () => {
    expect(formatDateTime(new Date("2026-11-21T13:05:00Z"))).toBe("21/11/2026 14:05");
  });
});
