import { describe, expect, it } from "vitest";

import { dedupe, footnoteReservationCappedWarning, imageSkippedWarning } from "./warnings";

describe("dedupe", () => {
  it("returns an empty array for empty input", () => {
    expect(dedupe([])).toEqual([]);
  });

  it("preserves first-seen order for unique strings", () => {
    expect(dedupe(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("collapses consecutive duplicates", () => {
    expect(dedupe(["x", "x", "y"])).toEqual(["x", "y"]);
  });

  it("collapses non-consecutive duplicates while preserving first-seen order", () => {
    expect(dedupe(["x", "y", "x", "z", "y"])).toEqual(["x", "y", "z"]);
  });

  it("treats whitespace-only-different strings as distinct", () => {
    expect(dedupe(["foo", "foo "])).toEqual(["foo", "foo "]);
  });
});

describe("imageSkippedWarning", () => {
  it("formats path + reason consistently", () => {
    expect(imageSkippedWarning("word/media/image1.png", "embed failed")).toBe(
      "image skipped: word/media/image1.png (embed failed)",
    );
  });

  it("preserves arbitrary characters in reason", () => {
    expect(imageSkippedWarning("a.png", "unsupported (XYZ)")).toBe(
      "image skipped: a.png (unsupported (XYZ))",
    );
  });
});

describe("footnoteReservationCappedWarning", () => {
  it("returns a stable string", () => {
    const w = footnoteReservationCappedWarning();
    expect(w).toMatch(/footnote/i);
    expect(w).toMatch(/50%/);
  });
});
