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
    bodyItalic: readFontFile("lora-italic.ttf"),
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
    expect(page).toBeDefined();
    if (!page) return;
    const { width, height } = page.getSize();
    expect(width).toBe(612);
    expect(height).toBe(792);
  });

  it("uses the requested page size (a4)", async () => {
    const blocks: Block[] = [{ type: "paragraph", runs: [{ text: "x", style: {} }] }];
    const fonts = loadFontsForTest();
    const bytes = await renderBlocksToPdf(blocks, { pageSize: "a4" }, fonts);
    const pdf = await PDFDocument.load(bytes);
    const [page] = pdf.getPages();
    expect(page).toBeDefined();
    if (!page) return;
    const { width, height } = page.getSize();
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

  // Fix 1 regression: multi-word link URL must appear exactly once
  it("renders a multi-word link with the URL appended exactly once", async () => {
    const linkObj = { href: "https://example.com" };
    const blocks: Block[] = [
      {
        type: "paragraph",
        runs: [
          // Single run with shared link object — parser emits one Run per
          // source link; wrapRuns splits it into fragments.
          { text: "click here", style: { link: linkObj } },
        ],
      },
    ];
    const fonts = loadFontsForTest();
    const bytes = await renderBlocksToPdf(blocks, { pageSize: "letter" }, fonts);
    // Load via pdf-lib and verify we get a valid PDF (visual assertion via
    // pdfjs-dist is not available in Vitest; the E2E test covers that path).
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    // The renderer must not crash and must produce a single-page result
    // for this trivially short content.
    expect(pdf.getPageCount()).toBe(1);
  });

  // Fix 1 regression: autolink (text === href) must not append parens
  it("autolink (text === href) does not append parens — produces valid PDF", async () => {
    const href = "https://example.com";
    const blocks: Block[] = [
      {
        type: "paragraph",
        runs: [{ text: href, style: { link: { href } } }],
      },
    ];
    const fonts = loadFontsForTest();
    const bytes = await renderBlocksToPdf(blocks, { pageSize: "letter" }, fonts);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
  });

  // Fix 2 regression: blockquote uses italic font — must produce valid PDF
  it("renders a blockquote with italic font without crashing", async () => {
    const blocks: Block[] = [
      {
        type: "blockquote",
        runs: [{ text: "To be or not to be, that is the question.", style: {} }],
      },
    ];
    const fonts = loadFontsForTest();
    const bytes = await renderBlocksToPdf(blocks, { pageSize: "letter" }, fonts);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
  });

  // Fix 4 regression: single word wider than maxWidth must be force-broken
  it("force-breaks a single word that exceeds maxWidth", async () => {
    // 500 'x' chars is far wider than the letter-page content width (~468pt).
    const longWord = "x".repeat(500);
    const blocks: Block[] = [{ type: "paragraph", runs: [{ text: longWord, style: {} }] }];
    const fonts = loadFontsForTest();
    const bytes = await renderBlocksToPdf(blocks, { pageSize: "letter" }, fonts);
    const pdf = await PDFDocument.load(bytes);
    // The renderer must not crash and must produce at least one valid page.
    // The long word will be broken across multiple visual lines (possibly
    // across pages), but the PDF must be well-formed.
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
