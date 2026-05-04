import { describe, expect, it } from "vitest";
import { DEFAULT_MARGIN_PT, PAGE_SIZES_PT, type PdfPageSize, getPageDimensions } from "./index";

describe("PAGE_SIZES_PT", () => {
  it("declares Letter, A4, and Legal in PDF points", () => {
    expect(PAGE_SIZES_PT).toEqual({
      letter: [612, 792],
      a4: [595, 842],
      legal: [612, 1008],
    });
  });
});

describe("getPageDimensions", () => {
  it.each<[PdfPageSize, [number, number]]>([
    ["letter", [612, 792]],
    ["a4", [595, 842]],
    ["legal", [612, 1008]],
  ])("returns %s -> %j", (size, expected) => {
    expect(getPageDimensions(size)).toEqual(expected);
  });
});

describe("DEFAULT_MARGIN_PT", () => {
  it("equals 72 (1 inch)", () => {
    expect(DEFAULT_MARGIN_PT).toBe(72);
  });
});
