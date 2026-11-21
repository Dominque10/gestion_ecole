import { describe, expect, it } from "vitest";
import { formatTime } from "./dates";

describe("formatTime", () => {
  it("affiche l'heure de Brazzaville (UTC+1)", () => {
    expect(formatTime(new Date("2026-11-21T13:05:00Z"))).toBe("14:05");
  });
});
