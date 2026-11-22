import { describe, expect, it } from "vitest";
import { formatGradeValue, gradeValueOf, parseGradeInput, sameGradeValue } from "./grade-input";

describe("Lecture d'une case de la grille des notes", () => {
  it("lit une note avec virgule ou point, deux décimales au plus", () => {
    expect(parseGradeInput("12,5", 20)).toEqual({
      ok: true,
      value: { status: "scored", score: 12.5 },
    });
    expect(parseGradeInput(" 8.25 ", 20)).toEqual({
      ok: true,
      value: { status: "scored", score: 8.25 },
    });
    expect(parseGradeInput("0", 20)).toEqual({ ok: true, value: { status: "scored", score: 0 } });
    expect(parseGradeInput("20", 20)).toEqual({ ok: true, value: { status: "scored", score: 20 } });
  });

  it("refuse une note au-delà du barème de l'évaluation", () => {
    expect(parseGradeInput("20,5", 20)).toEqual({ ok: false, problem: "outOfRange" });
    expect(parseGradeInput("11", 10)).toEqual({ ok: false, problem: "outOfRange" });
    expect(parseGradeInput("35", 40)).toMatchObject({ ok: true });
  });

  it("refuse un texte illisible, une note négative ou trop précise", () => {
    for (const raw of ["douze", "-2", "12,345", "12,", "1e1", "12/20"]) {
      expect(parseGradeInput(raw, 20)).toEqual({ ok: false, problem: "unreadable" });
    }
  });

  it("« a » = absent, « d » = dispensé, vide = pas de note", () => {
    expect(parseGradeInput("A", 20)).toEqual({ ok: true, value: { status: "absent" } });
    expect(parseGradeInput("abs", 20)).toEqual({ ok: true, value: { status: "absent" } });
    expect(parseGradeInput("d", 20)).toEqual({ ok: true, value: { status: "excused" } });
    expect(parseGradeInput("Dispensé", 20)).toEqual({ ok: true, value: { status: "excused" } });
    expect(parseGradeInput("  ", 20)).toEqual({ ok: true, value: { status: "empty" } });
  });

  it("formatage inverse de la lecture", () => {
    for (const raw of ["12,5", "8,25", "0", "a", "d", ""]) {
      const parsed = parseGradeInput(raw, 20);
      expect(parsed.ok && formatGradeValue(parsed.value)).toBe(raw);
    }
  });

  it("compare deux valeurs ; lit une note enregistrée", () => {
    expect(gradeValueOf(undefined)).toEqual({ status: "empty" });
    expect(gradeValueOf({ status: "scored", score: 14 })).toEqual({ status: "scored", score: 14 });
    expect(gradeValueOf({ status: "absent", score: null })).toEqual({ status: "absent" });
    expect(sameGradeValue({ status: "scored", score: 14 }, { status: "scored", score: 14 })).toBe(
      true,
    );
    expect(sameGradeValue({ status: "scored", score: 14 }, { status: "scored", score: 15 })).toBe(
      false,
    );
    expect(sameGradeValue({ status: "absent" }, { status: "excused" })).toBe(false);
  });
});
