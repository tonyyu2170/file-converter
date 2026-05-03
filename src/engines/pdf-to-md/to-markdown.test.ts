import { describe, expect, it } from "vitest";
import type { Line, PdfToMdOptions } from "./to-markdown";
import { toMarkdown } from "./to-markdown";

const line = (text: string, fontSize: number, y: number, bold = false, italic = false): Line => ({
  text,
  fontSize,
  bold,
  italic,
  y,
});

const HR: PdfToMdOptions = { pageBreaks: "horizontal-rule" };
const NONE: PdfToMdOptions = { pageBreaks: "none" };

describe("toMarkdown — empty / whitespace inputs", () => {
  it("returns empty string for empty pages array", () => {
    expect(toMarkdown([], HR)).toBe("");
  });

  it("returns empty string when every page is empty", () => {
    expect(toMarkdown([[], []], HR)).toBe("");
  });

  it("ends output with a single trailing newline (no extra whitespace)", () => {
    const out = toMarkdown([[line("hi", 12, 100)]], HR);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("toMarkdown — paragraph reflow", () => {
  it("joins close-Y body lines into one paragraph with single spaces", () => {
    const page: Line[] = [line("hello", 12, 100), line("world", 12, 95)];
    expect(toMarkdown([page], HR)).toBe("hello world\n");
  });

  it("breaks gap-separated body lines into multiple paragraphs", () => {
    const page: Line[] = [
      line("first paragraph", 12, 200),
      line("still first", 12, 195),
      line("second paragraph", 12, 100),
    ];
    expect(toMarkdown([page], HR)).toBe("first paragraph still first\n\nsecond paragraph\n");
  });

  it("sorts lines top-to-bottom by descending y", () => {
    // Large Y gap (150) far exceeds 1.5 * 12 = 18 threshold, so this becomes
    // two paragraphs; the test's purpose is to verify the sort, not the gap.
    const page: Line[] = [line("bottom", 12, 50), line("top", 12, 200)];
    expect(toMarkdown([page], HR)).toBe("top\n\nbottom\n");
  });
});

describe("toMarkdown — headings", () => {
  it("surrounds heading lines with blank lines on both sides", () => {
    const page: Line[] = [
      line("intro paragraph", 12, 300),
      line("Big Title", 24, 250),
      line("body after heading", 12, 200),
    ];
    const out = toMarkdown([page], HR);
    expect(out).toBe("intro paragraph\n\n# Big Title\n\nbody after heading\n");
  });

  it("emits a heading at top of page with following paragraph", () => {
    const page: Line[] = [line("Title", 24, 300), line("body", 12, 250)];
    expect(toMarkdown([page], HR)).toBe("# Title\n\nbody\n");
  });
});

describe("toMarkdown — list grouping", () => {
  it("groups consecutive list items with no blank line between them", () => {
    const page: Line[] = [line("• one", 12, 300), line("• two", 12, 280), line("• three", 12, 260)];
    expect(toMarkdown([page], HR)).toBe("- one\n- two\n- three\n");
  });

  it("inserts a blank line when a body line follows a list", () => {
    const page: Line[] = [
      line("• one", 12, 300),
      line("• two", 12, 280),
      line("after list", 12, 260),
    ];
    expect(toMarkdown([page], HR)).toBe("- one\n- two\n\nafter list\n");
  });

  it("inserts a blank line between body and a following list", () => {
    const page: Line[] = [line("body line", 12, 300), line("• item", 12, 280)];
    expect(toMarkdown([page], HR)).toBe("body line\n\n- item\n");
  });

  it("preserves ordered list ordinals", () => {
    const page: Line[] = [line("1. foo", 12, 300), line("2. bar", 12, 280)];
    expect(toMarkdown([page], HR)).toBe("1. foo\n2. bar\n");
  });

  it("treats a heading-sized list line as a list item (matches formatLine precedence)", () => {
    // heading=24, but the list marker takes precedence in formatLine,
    // so renderPage must group with adjacent list items, not split as a heading.
    const page: Line[] = [line("• first", 24, 300), line("• second", 12, 280)];
    expect(toMarkdown([page], HR)).toBe("- first\n- second\n");
  });
});

describe("toMarkdown — page joining", () => {
  it("joins pages with a horizontal rule when pageBreaks=horizontal-rule", () => {
    const p1: Line[] = [line("page one", 12, 100)];
    const p2: Line[] = [line("page two", 12, 100)];
    expect(toMarkdown([p1, p2], HR)).toBe("page one\n\n---\n\npage two\n");
  });

  it("joins pages with a blank line when pageBreaks=none", () => {
    const p1: Line[] = [line("page one", 12, 100)];
    const p2: Line[] = [line("page two", 12, 100)];
    const out = toMarkdown([p1, p2], NONE);
    expect(out).not.toContain("---");
    expect(out).toBe("page one\n\npage two\n");
  });

  it("does not emit a leading or trailing horizontal rule for empty pages", () => {
    const p1: Line[] = [];
    const p2: Line[] = [line("only page", 12, 100)];
    const p3: Line[] = [];
    const out = toMarkdown([p1, p2, p3], HR);
    expect(out).toBe("only page\n");
  });
});

describe("toMarkdown — emphasis integration", () => {
  it("wraps a bold body line with ** via formatLine", () => {
    const page: Line[] = [line("bold body", 12, 100, true, false)];
    expect(toMarkdown([page], HR)).toBe("**bold body**\n");
  });

  it("does not wrap a heading even when bold", () => {
    const page: Line[] = [line("Heading", 24, 200, true, false), line("body", 12, 150)];
    expect(toMarkdown([page], HR)).toBe("# Heading\n\nbody\n");
  });
});
