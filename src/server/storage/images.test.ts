import { describe, expect, it } from "vitest";
import { detectImageType, imageExtension, imageTypeFromKey } from "./images";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

describe("detectImageType (type lu dans le contenu)", () => {
  it("reconnaît PNG, JPEG et WebP", () => {
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(
      "image/png",
    );
    expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(detectImageType(bytes(...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WEBP")))).toBe(
      "image/webp",
    );
  });

  it("refuse tout le reste, même déguisé (SVG, PDF, HTML, fichier vide)", () => {
    for (const content of ["<svg xmlns=", "%PDF-1.7", "<html>", "RIFF1234WAVE", ""]) {
      expect(detectImageType(bytes(...ascii(content)))).toBeNull();
    }
  });

  it("associe extension et type dans les deux sens", () => {
    expect(imageExtension("image/webp")).toBe("webp");
    expect(imageTypeFromKey("schools/x/logo-1.jpg")).toBe("image/jpeg");
    expect(imageTypeFromKey("schools/x/logo-1.svg")).toBeNull();
  });
});
