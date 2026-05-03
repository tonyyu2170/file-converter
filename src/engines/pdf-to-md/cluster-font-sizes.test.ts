import { describe, expect, it } from "vitest";
import { clusterFontSizes } from "./cluster-font-sizes";

describe("clusterFontSizes", () => {
  it("returns zero body and no headings for empty input", () => {
    expect(clusterFontSizes([])).toEqual({ body: 0, headings: [] });
  });

  it("returns body with no headings when all sizes are equal", () => {
    expect(clusterFontSizes([12, 12, 12, 12])).toEqual({ body: 12, headings: [] });
  });

  it("identifies a single heading level above 1.4x body", () => {
    expect(clusterFontSizes([12, 12, 12, 12, 18])).toEqual({ body: 12, headings: [18] });
  });

  it("identifies two heading levels sorted descending", () => {
    // threshold = 12 * 1.4 = 16.8; 17 and 22 both clear it.
    expect(clusterFontSizes([12, 12, 12, 17, 17, 22])).toEqual({
      body: 12,
      headings: [22, 17],
    });
  });

  it("caps heading levels at three (largest three kept)", () => {
    const sizes = [12, 12, 12, 12, 12, 17, 20, 24, 30];
    const result = clusterFontSizes(sizes);
    expect(result.body).toBe(12);
    expect(result.headings).toEqual([30, 24, 20]);
  });

  it("treats a single giant outlier as a heading", () => {
    const sizes = [...Array.from({ length: 100 }, () => 12), 40];
    expect(clusterFontSizes(sizes)).toEqual({ body: 12, headings: [40] });
  });

  it("rounds floating-point sizes to one decimal place", () => {
    const result = clusterFontSizes([12.001, 12.002, 12.0049, 18.5]);
    expect(result.body).toBe(12);
    expect(result.headings).toEqual([18.5]);
  });

  it("breaks mode ties in favor of the smaller value", () => {
    expect(clusterFontSizes([10, 14])).toEqual({ body: 10, headings: [14] });
  });

  it("returns body equal to mode even when heading-sized text dominates", () => {
    // Documents the heuristic limitation: pages where heading-style text
    // outnumbers body collapses both into "body" with no headings.
    expect(clusterFontSizes([12, 18, 18])).toEqual({ body: 18, headings: [] });
  });

  it("dedupes repeated heading sizes", () => {
    const result = clusterFontSizes([12, 12, 12, 18, 18, 18, 24]);
    expect(result.headings).toEqual([24, 18]);
  });
});
