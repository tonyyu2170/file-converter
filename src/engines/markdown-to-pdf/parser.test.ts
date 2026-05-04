import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./parser";

describe("parseMarkdown", () => {
  it("parses a heading", () => {
    const blocks = parseMarkdown("# Hello");
    expect(blocks).toEqual([
      {
        type: "heading",
        level: 1,
        runs: [{ text: "Hello", style: {} }],
      },
    ]);
  });

  it("parses a paragraph with bold and italic", () => {
    const blocks = parseMarkdown("Plain **bold** *italic* text.");
    const para = blocks[0];
    expect(para?.type).toBe("paragraph");
    if (para?.type !== "paragraph") return;
    // Concatenate run texts for simplicity.
    const text = para.runs.map((r) => r.text).join("");
    expect(text).toBe("Plain bold italic text.");
    // The bold and italic words should have the corresponding flags.
    expect(para.runs.find((r) => r.text === "bold")?.style.bold).toBe(true);
    expect(para.runs.find((r) => r.text === "italic")?.style.italic).toBe(true);
  });

  it("parses inline code and links", () => {
    const blocks = parseMarkdown("See `foo()` and [docs](https://example.com).");
    const para = blocks[0];
    if (para?.type !== "paragraph") throw new Error("expected paragraph");
    const code = para.runs.find((r) => r.text === "foo()");
    expect(code?.style.code).toBe(true);
    const link = para.runs.find((r) => r.text === "docs");
    expect(link?.style.link?.href).toBe("https://example.com");
  });

  it("parses a fenced code block with language", () => {
    const blocks = parseMarkdown("```javascript\nconst x = 1;\n```");
    expect(blocks).toEqual([
      {
        type: "code-block",
        language: "javascript",
        text: "const x = 1;\n",
      },
    ]);
  });

  it("parses a code block without language as language=null", () => {
    const blocks = parseMarkdown("```\nplain text\n```");
    expect(blocks[0]?.type).toBe("code-block");
    expect((blocks[0] as { language: string | null }).language).toBeNull();
  });

  it("parses a horizontal rule", () => {
    const blocks = parseMarkdown("---");
    expect(blocks).toEqual([{ type: "hr" }]);
  });

  it("parses a list", () => {
    const blocks = parseMarkdown("- one\n- two\n- three");
    expect(blocks).toHaveLength(3);
    expect(blocks.every((b) => b.type === "list-item")).toBe(true);
  });

  it("parses a blockquote", () => {
    const blocks = parseMarkdown("> quoted");
    expect(blocks[0]?.type).toBe("blockquote");
  });

  it("parses an image as a placeholder block", () => {
    const blocks = parseMarkdown("![alt text](http://example.com/foo.png)");
    expect(blocks).toEqual([{ type: "image", alt: "alt text" }]);
  });

  it("parses heading levels 1-6", () => {
    for (let i = 1; i <= 6; i++) {
      const blocks = parseMarkdown(`${"#".repeat(i)} title`);
      expect(blocks[0]?.type).toBe("heading");
      expect((blocks[0] as { level: number }).level).toBe(i);
    }
  });
});
