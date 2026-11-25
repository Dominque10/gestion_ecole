import { describe, expect, it } from "vitest";
import { compareStorage, ORPHAN_MIN_AGE_HOURS } from "./check";

const now = new Date("2026-11-25T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600 * 1000);

describe("compareStorage", () => {
  it("tout est en ordre quand base et disque correspondent", () => {
    expect(
      compareStorage(
        ["schools/a/logo.png", "schools/a/students/s/photo.webp"],
        [
          { key: "schools/a/logo.png", modifiedAt: hoursAgo(100) },
          { key: "schools/a/students/s/photo.webp", modifiedAt: hoursAgo(1) },
        ],
        now,
      ),
    ).toEqual({ missing: [], orphans: [], recentOrphans: [], ok: 2 });
  });

  it("signale les fichiers référencés mais absents du disque", () => {
    const report = compareStorage(["schools/a/stamp.png", "schools/a/logo.png"], [], now);
    expect(report.missing).toEqual(["schools/a/logo.png", "schools/a/stamp.png"]);
    expect(report.ok).toBe(0);
  });

  it("une même clé référencée deux fois ne compte qu'une fois", () => {
    const report = compareStorage(
      ["schools/a/logo.png", "schools/a/logo.png"],
      [{ key: "schools/a/logo.png", modifiedAt: hoursAgo(5) }],
      now,
    );
    expect(report.ok).toBe(1);
  });

  it("ne propose de supprimer que les orphelins de plus de 24 h (envoi peut-être en cours)", () => {
    const report = compareStorage(
      [],
      [
        { key: "schools/a/vieux.png", modifiedAt: hoursAgo(ORPHAN_MIN_AGE_HOURS) },
        { key: "schools/a/recent.png", modifiedAt: hoursAgo(ORPHAN_MIN_AGE_HOURS - 1) },
      ],
      now,
    );
    expect(report.orphans).toEqual(["schools/a/vieux.png"]);
    expect(report.recentOrphans).toEqual(["schools/a/recent.png"]);
  });
});
