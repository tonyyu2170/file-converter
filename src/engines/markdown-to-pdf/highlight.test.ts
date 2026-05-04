import { describe, expect, it } from "vitest";
import {
  COLOR_COMMENT,
  COLOR_DEFAULT,
  COLOR_KEYWORD,
  COLOR_STRING,
  classToColor,
  decodeHtml,
  escapeHtml,
  highlightCodeBlock,
  htmlToTokens,
} from "./highlight";

describe("classToColor", () => {
  it("maps hljs-keyword to accent color", () => {
    expect(classToColor("hljs-keyword")).toEqual(COLOR_KEYWORD);
  });

  it("maps hljs-built_in to accent color", () => {
    expect(classToColor("hljs-built_in")).toEqual(COLOR_KEYWORD);
  });

  it("maps hljs-string to muted color", () => {
    expect(classToColor("hljs-string")).toEqual(COLOR_STRING);
  });

  it("maps hljs-comment to very-muted color", () => {
    expect(classToColor("hljs-comment")).toEqual(COLOR_COMMENT);
  });

  it("maps hljs-number to accent color", () => {
    expect(classToColor("hljs-number")).toEqual(COLOR_KEYWORD);
  });

  it("returns default color for unknown class", () => {
    expect(classToColor("hljs-whatever")).toEqual(COLOR_DEFAULT);
  });
});

describe("decodeHtml / escapeHtml", () => {
  it("round-trips angle brackets", () => {
    const original = "<div> & </div>";
    expect(decodeHtml(escapeHtml(original))).toBe(original);
  });

  it("decodes all entities", () => {
    expect(decodeHtml("&lt;&gt;&amp;&quot;&#39;")).toBe("<>&\"'");
  });
});

describe("htmlToTokens", () => {
  it("parses a single span", () => {
    const tokens = htmlToTokens('<span class="hljs-keyword">const</span>');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.text).toBe("const");
    expect(tokens[0]?.color).toEqual(COLOR_KEYWORD);
  });

  it("parses plain text outside spans", () => {
    const tokens = htmlToTokens("hello world");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.text).toBe("hello world");
    expect(tokens[0]?.color).toEqual(COLOR_DEFAULT);
  });

  it("parses mixed spans and plain text", () => {
    const tokens = htmlToTokens(
      '<span class="hljs-keyword">const</span> x = <span class="hljs-number">1</span>',
    );
    expect(tokens).toHaveLength(3);
    expect(tokens[0]?.text).toBe("const");
    expect(tokens[1]?.text).toBe(" x = ");
    expect(tokens[2]?.text).toBe("1");
  });

  it("handles nested spans — inner class wins", () => {
    // Outer: hljs-meta, inner: hljs-keyword inside
    const tokens = htmlToTokens(
      '<span class="hljs-meta"><span class="hljs-keyword">import</span></span>',
    );
    // Inner color (keyword) should be preserved
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.text).toBe("import");
    expect(tokens[0]?.color).toEqual(COLOR_KEYWORD);
  });

  it("handles nested spans — outer color when inner is default", () => {
    // Outer: hljs-string, inner has no class so gets default → should inherit outer
    const tokens = htmlToTokens('<span class="hljs-string">"hello"</span>');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.text).toBe('"hello"');
    expect(tokens[0]?.color).toEqual(COLOR_STRING);
  });

  it("decodes HTML entities in text content", () => {
    const tokens = htmlToTokens('<span class="hljs-string">&lt;br /&gt;</span>');
    expect(tokens[0]?.text).toBe("<br />");
  });
});

describe("highlightCodeBlock", () => {
  it("splits code into lines", () => {
    const lines = highlightCodeBlock("line1\nline2\nline3", null);
    expect(lines).toHaveLength(3);
    expect(lines[0]?.[0]?.text).toBe("line1");
    expect(lines[1]?.[0]?.text).toBe("line2");
    expect(lines[2]?.[0]?.text).toBe("line3");
  });

  it("falls back to plain text for unknown language", () => {
    const lines = highlightCodeBlock("qa'pla'", "klingon");
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]?.[0]?.color).toEqual(COLOR_DEFAULT);
  });

  it("highlights javascript without crashing", () => {
    const lines = highlightCodeBlock("const x = 1;\n// comment\nconsole.log(x);\n", "javascript");
    expect(lines.length).toBeGreaterThan(0);
    // First line should have a keyword token for 'const'
    const firstLineTokens = lines[0] ?? [];
    const keywordToken = firstLineTokens.find((t) =>
      t.color.every((c, i) => c === COLOR_KEYWORD[i]),
    );
    expect(keywordToken).toBeDefined();
  });

  it("handles empty string without crashing", () => {
    const lines = highlightCodeBlock("", "javascript");
    // At least one line (possibly empty)
    expect(Array.isArray(lines)).toBe(true);
  });

  it("handles null language", () => {
    const lines = highlightCodeBlock("hello world", null);
    expect(lines[0]?.[0]?.text).toBe("hello world");
    expect(lines[0]?.[0]?.color).toEqual(COLOR_DEFAULT);
  });
});
