import { describe, expect, it } from "vitest";
import type { FontSizeClassification } from "./cluster-font-sizes";
import { formatLine } from "./format-line";
import type { Line } from "./to-markdown";

const line = (text: string, fontSize: number, bold = false, italic = false, y = 0): Line => ({
  text,
  fontSize,
  bold,
  italic,
  y,
});

const noHeadings: FontSizeClassification = { body: 12, headings: [] };
const oneHeading: FontSizeClassification = { body: 12, headings: [24] };
const twoHeadings: FontSizeClassification = { body: 12, headings: [24, 18] };
const threeHeadings: FontSizeClassification = { body: 12, headings: [30, 22, 16] };

describe("formatLine — body text", () => {
  it("returns plain text when no emphasis and no headings", () => {
    expect(formatLine(line("hello", 12), noHeadings)).toBe("hello");
  });

  it("wraps bold text in **", () => {
    expect(formatLine(line("hello", 12, true), noHeadings)).toBe("**hello**");
  });

  it("wraps italic text in *", () => {
    expect(formatLine(line("hello", 12, false, true), noHeadings)).toBe("*hello*");
  });

  it("wraps bold+italic text in ***", () => {
    expect(formatLine(line("hello", 12, true, true), noHeadings)).toBe("***hello***");
  });

  it("does not promote any line to a heading when classification has no headings", () => {
    expect(formatLine(line("big", 100), noHeadings)).toBe("big");
  });
});

describe("formatLine — headings", () => {
  it("emits H1 for the largest heading size", () => {
    expect(formatLine(line("Title", 24), oneHeading)).toBe("# Title");
  });

  it("emits H2 for the second-largest heading size", () => {
    expect(formatLine(line("Sub", 18), twoHeadings)).toBe("## Sub");
  });

  it("emits H3 for the third-largest heading size", () => {
    expect(formatLine(line("Subsub", 16), threeHeadings)).toBe("### Subsub");
  });

  it("does not double-wrap bold headings", () => {
    expect(formatLine(line("Title", 24, true), oneHeading)).toBe("# Title");
  });

  it("does not double-wrap italic headings", () => {
    expect(formatLine(line("Title", 24, false, true), oneHeading)).toBe("# Title");
  });

  it("snaps a between-bucket fontSize to the nearest heading", () => {
    // 20 is between 16 and 22 in threeHeadings; closer to 22 (distance 2 vs 4)
    expect(formatLine(line("Mid", 20), threeHeadings)).toBe("## Mid");
  });

  it("treats fontSize below smallest heading as body", () => {
    expect(formatLine(line("body", 14), threeHeadings)).toBe("body");
  });

  it("treats fontSize above the largest heading as H1", () => {
    expect(formatLine(line("Huge", 50), threeHeadings)).toBe("# Huge");
  });

  it("ties between two heading buckets resolve to the larger heading", () => {
    // fontSize=21 is equidistant from headings [24, 18] (3 from each).
    // Tie-break documented in format-line.ts: ties go to the larger heading.
    const tieHeadings = { body: 12, headings: [24, 18] };
    expect(formatLine(line("Tie", 21), tieHeadings)).toBe("# Tie");
  });
});

describe("formatLine — list items", () => {
  it("formats unordered list items, dropping leading bullet", () => {
    expect(formatLine(line("• foo", 12), noHeadings)).toBe("- foo");
  });

  it("formats ordered list items, preserving the original ordinal", () => {
    expect(formatLine(line("3. bar", 12), noHeadings)).toBe("3. bar");
  });

  it("does not wrap list items in emphasis even when bold", () => {
    expect(formatLine(line("• foo", 12, true), noHeadings)).toBe("- foo");
  });

  it("does not promote list items to headings even when font is large", () => {
    expect(formatLine(line("• foo", 24), oneHeading)).toBe("- foo");
  });

  it("formats lowercase letter markers as unordered (graceful degrade)", () => {
    expect(formatLine(line("a) foo", 12), noHeadings)).toBe("- foo");
  });
});
