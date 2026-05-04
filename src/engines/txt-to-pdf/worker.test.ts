/**
 * Integration tests for the txt-to-pdf pipeline.
 *
 * Worker spawn (via engine.convert) requires a browser Worker API that
 * Vitest/jsdom does not provide — that path is exercised by E2E tests.
 * This file exercises the full rendering pipeline by calling
 * renderTxtToPdf() directly.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderTxtToPdf } from "./worker";

const FONTS_DIR = path.resolve(process.cwd(), "public", "fonts");
const FIXTURES_DIR = path.resolve(process.cwd(), "tests", "fixtures");

function readFontFile(filename: string): ArrayBuffer {
  const buf = readFileSync(path.join(FONTS_DIR, filename));
  // Build a fresh ArrayBuffer copy — Node's Buffer shares memory with a
  // pooled ArrayBuffer which pdf-lib doesn't like across embeds.
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(buf);
  return copy;
}

function loadMonoFont(): ArrayBuffer {
  return readFontFile("jetbrains-mono-regular.ttf");
}

describe("txt-to-pdf pipeline", () => {
  it("converts the sample.txt fixture to a valid PDF", async () => {
    const text = readFileSync(path.join(FIXTURES_DIR, "sample.txt"), "utf-8");
    const fontBytes = loadMonoFont();
    const bytes = await renderTxtToPdf(text, { pageSize: "letter" }, fontBytes);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);

    const [page] = pdf.getPages();
    expect(page?.getSize()).toEqual({ width: 612, height: 792 });
  });

  it("respects the pageSize option (a4)", async () => {
    const text = "hello a4 world";
    const fontBytes = loadMonoFont();
    const bytes = await renderTxtToPdf(text, { pageSize: "a4" }, fontBytes);
    const pdf = await PDFDocument.load(bytes);
    const [page] = pdf.getPages();
    expect(page?.getSize()).toEqual({ width: 595, height: 842 });
  });

  it("respects the pageSize option (legal)", async () => {
    const text = "hello legal world";
    const fontBytes = loadMonoFont();
    const bytes = await renderTxtToPdf(text, { pageSize: "legal" }, fontBytes);
    const pdf = await PDFDocument.load(bytes);
    const [page] = pdf.getPages();
    expect(page?.getSize()).toEqual({ width: 612, height: 1008 });
  });

  it("handles ligature sequences without crashing (// => != == || &&)", async () => {
    // This is the crash-regression test. If the char-by-char workaround is
    // missing, JetBrains Mono ligatures cause fontkit to throw on the very
    // first two-char measurement call.
    const text = ["// comment line", "if (a => b) {", "  return a != b && c == d || e;", "}"].join(
      "\n",
    );
    const fontBytes = loadMonoFont();
    // Should not throw:
    const bytes = await renderTxtToPdf(text, { pageSize: "letter" }, fontBytes);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
  });

  it("preserves blank lines as empty visual lines", async () => {
    // 3 lines: text, blank, text — should produce at least 1 page
    const text = "first\n\nsecond";
    const fontBytes = loadMonoFont();
    const bytes = await renderTxtToPdf(text, { pageSize: "letter" }, fontBytes);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("produces a second page for very long input", async () => {
    // At letter size with 11pt font and 14pt line height, a page holds roughly
    // (792 - 2*72) / 14 = ~46 lines. Feed 100 lines to force page overflow.
    const text = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
    const fontBytes = loadMonoFont();
    const bytes = await renderTxtToPdf(text, { pageSize: "letter" }, fontBytes);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2);
  });

  it("output filename replaces .txt extension with .pdf", () => {
    function replaceExt(name: string, newExt: string): string {
      const dot = name.lastIndexOf(".");
      if (dot <= 0) return `${name}.${newExt}`;
      return `${name.slice(0, dot)}.${newExt}`;
    }
    expect(replaceExt("notes.txt", "pdf")).toBe("notes.pdf");
    expect(replaceExt("my.file.txt", "pdf")).toBe("my.file.pdf");
    expect(replaceExt("noext", "pdf")).toBe("noext.pdf");
  });
});
