import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { Block } from "./blocks";
import { renderBlocksToPdf } from "./renderer";

const FONTS_DIR = join(process.cwd(), "public", "fonts");

function readFontFile(filename: string): ArrayBuffer {
  const buf = readFileSync(join(FONTS_DIR, filename));
  // Build a fresh ArrayBuffer copy — Node's Buffer shares memory with a
  // pooled ArrayBuffer, which pdf-lib doesn't like across embeds.
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(buf);
  return copy;
}

function loadFontsForTest() {
  return {
    body: readFontFile("lora-regular.ttf"),
    headings: readFontFile("inter-regular.ttf"),
    mono: readFontFile("jetbrains-mono-regular.ttf"),
  };
}

describe("renderBlocksToPdf", () => {
  it("renders a single heading + paragraph to a valid PDF", async () => {
    const blocks: Block[] = [
      { type: "heading", level: 1, runs: [{ text: "Hello", style: {} }] },
      { type: "paragraph", runs: [{ text: "World.", style: {} }] },
    ];
    const fonts = loadFontsForTest();
    const bytes = await renderBlocksToPdf(blocks, { pageSize: "letter" }, fonts);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    const [page] = pdf.getPages();
    const { width, height } = page!.getSize();
    expect(width).toBe(612);
    expect(height).toBe(792);
  });

  it("uses the requested page size (a4)", async () => {
    const blocks: Block[] = [{ type: "paragraph", runs: [{ text: "x", style: {} }] }];
    const fonts = loadFontsForTest();
    const bytes = await renderBlocksToPdf(blocks, { pageSize: "a4" }, fonts);
    const pdf = await PDFDocument.load(bytes);
    const [page] = pdf.getPages();
    const { width, height } = page!.getSize();
    expect(width).toBe(595);
    expect(height).toBe(842);
  });

  it("paginates when content exceeds one page", async () => {
    const longText = Array.from({ length: 200 }, (_, i) => `paragraph ${i}.`);
    const blocks: Block[] = longText.map((text) => ({
      type: "paragraph" as const,
      runs: [{ text, style: {} }],
    }));
    const fonts = loadFontsForTest();
    const bytes = await renderBlocksToPdf(blocks, { pageSize: "letter" }, fonts);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
  });

  it("renders a syntax-highlighted code block without crashing (smoke test)", async () => {
    const blocks: Block[] = [
      {
        type: "code-block",
        language: "javascript",
        text: "const x = 1;\n// comment\nconsole.log(x);\n",
      },
    ];
    const fonts = loadFontsForTest();
    const bytes = await renderBlocksToPdf(blocks, { pageSize: "letter" }, fonts);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    // Highlighting paths run without error; we don't assert on the
    // visual output (would be brittle), only that the engine produces
    // a valid PDF when the highlight tokenizer is exercised.
  });

  it("renders an unknown-language code block as plain mono (no crash)", async () => {
    const blocks: Block[] = [{ type: "code-block", language: "klingon", text: "qa'pla'" }];
    const fonts = loadFontsForTest();
    const bytes = await renderBlocksToPdf(blocks, { pageSize: "letter" }, fonts);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
  });

  it("renders inline code with ligature chars without crashing", async () => {
    const blocks: Block[] = [
      {
        type: "paragraph",
        runs: [
          { text: "use ", style: {} },
          { text: "// comment", style: { code: true } },
          { text: " syntax", style: {} },
        ],
      },
    ];
    const fonts = loadFontsForTest();
    const bytes = await renderBlocksToPdf(blocks, { pageSize: "letter" }, fonts);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
  });
});
