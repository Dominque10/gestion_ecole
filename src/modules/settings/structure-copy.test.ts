import { describe, expect, it } from "vitest";
import { shiftYears } from "./structure-copy";

describe("shiftYears (échéances d'une année sur l'autre)", () => {
  it("garde le même jour du calendrier", () => {
    expect(shiftYears("2026-10-01", 1)).toBe("2027-10-01");
    expect(shiftYears("2027-01-04", 2)).toBe("2029-01-04");
    expect(shiftYears("2027-01-04", 0)).toBe("2027-01-04");
  });

  it("le 29 février devient le 28 une année non bissextile", () => {
    expect(shiftYears("2028-02-29", 1)).toBe("2029-02-28");
    expect(shiftYears("2028-02-29", 4)).toBe("2032-02-29");
  });
});
