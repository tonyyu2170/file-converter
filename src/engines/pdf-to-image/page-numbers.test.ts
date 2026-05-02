import { describe, expect, it } from "vitest";
import { computePageNumbers } from "./page-numbers";

describe("computePageNumbers", () => {
  it("returns all pages 1..N when range input is empty", () => {
    expect(computePageNumbers("", 5)).toEqual({ ok: true, pages: [1, 2, 3, 4, 5] });
  });

  it("returns all pages when range input is whitespace only", () => {
    expect(computePageNumbers("   ", 3)).toEqual({ ok: true, pages: [1, 2, 3] });
  });

  it("parses a mixed single + range input into a sorted list", () => {
    expect(computePageNumbers("1, 3-4", 5)).toEqual({ ok: true, pages: [1, 3, 4] });
  });

  it("dedupes overlapping tokens", () => {
    expect(computePageNumbers("1-3, 2-4", 10)).toEqual({ ok: true, pages: [1, 2, 3, 4] });
  });

  it("sorts unordered tokens into ascending page numbers", () => {
    expect(computePageNumbers("5,1,3", 5)).toEqual({ ok: true, pages: [1, 3, 5] });
  });

  it("handles open-ended ranges from the parser", () => {
    expect(computePageNumbers("3-", 5)).toEqual({ ok: true, pages: [3, 4, 5] });
    expect(computePageNumbers("-2", 5)).toEqual({ ok: true, pages: [1, 2] });
  });

  it("propagates an out-of-bounds error from the parser", () => {
    const result = computePageNumbers("7", 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/exceeds 5/);
  });

  it("propagates a syntax error from the parser", () => {
    const result = computePageNumbers("abc", 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/can't parse/);
  });
});
