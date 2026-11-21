import { describe, expect, it } from "vitest";
import { scaledSize } from "./compress-image";

describe("scaledSize (réduction avant envoi)", () => {
  it("ramène le plus grand côté à 800 px en gardant les proportions", () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: 800, height: 600 });
    expect(scaledSize(1000, 2000)).toEqual({ width: 400, height: 800 });
  });

  it("n'agrandit jamais une petite image", () => {
    expect(scaledSize(300, 200)).toEqual({ width: 300, height: 200 });
  });

  it("garde au moins 1 px de côté (image très allongée)", () => {
    expect(scaledSize(10000, 2)).toEqual({ width: 800, height: 1 });
  });
});
