import { describe, expect, it } from "vitest";
import { nextLevelId, type OrderedLevel } from "./next-level";

const levels: OrderedLevel[] = [
  { id: "2nde", cycle: "lycee", position: 1 },
  { id: "cm2", cycle: "primary", position: 6 },
  { id: "6e", cycle: "college", position: 1 },
  { id: "3e", cycle: "college", position: 4 },
  { id: "tle", cycle: "lycee", position: 3 },
  { id: "1re", cycle: "lycee", position: 2 },
];

describe("nextLevelId", () => {
  it("passe au niveau suivant, y compris d'un cycle au suivant", () => {
    expect(nextLevelId(levels, "cm2")).toBe("6e");
    expect(nextLevelId(levels, "6e")).toBe("3e");
    expect(nextLevelId(levels, "3e")).toBe("2nde");
    expect(nextLevelId(levels, "1re")).toBe("tle");
  });

  it("aucun niveau après la terminale, ni pour un niveau inconnu", () => {
    expect(nextLevelId(levels, "tle")).toBeNull();
    expect(nextLevelId(levels, "inconnu")).toBeNull();
  });
});
