import { describe, expect, it } from "vitest";
import { normalizePhone, parseIdentifier } from "./phone";

describe("normalizePhone", () => {
  it.each([
    ["06 123 45 67", "+242061234567"],
    ["061234567", "+242061234567"],
    ["05-123-45-67", "+242051234567"],
    ["242061234567", "+242061234567"],
    ["+242 06 123 45 67", "+242061234567"],
    ["00242061234567", "+242061234567"],
    ["+33612345678", "+33612345678"],
  ])("« %s » → %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["", "abc", "12345", "+2420612345", "6123456789", "+242 06 12"])(
    "refuse « %s »",
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );
});

describe("parseIdentifier", () => {
  it("reconnaît un email et le met en minuscules", () => {
    expect(parseIdentifier("  Directeur@Ecole.CG ")).toEqual({
      kind: "email",
      value: "directeur@ecole.cg",
    });
  });

  it("reconnaît un téléphone", () => {
    expect(parseIdentifier("06 123 45 67")).toEqual({ kind: "phone", value: "+242061234567" });
  });

  it("refuse un identifiant invalide", () => {
    expect(parseIdentifier("pas-un-email@")).toBeNull();
    expect(parseIdentifier("123")).toBeNull();
  });
});
