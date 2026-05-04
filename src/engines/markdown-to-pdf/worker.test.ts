/**
 * Integration tests for the markdown-to-pdf pipeline:
 * parseMarkdown → renderBlocksToPdf.
 *
 * Worker spawn (via engine.convert) requires a browser Worker API that
 * Vitest/jsdom does not provide — that path is exercised by E2E tests.
 * This file exercises the full conversion pipeline directly.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./parser";
import { renderBlocksToPdf } from "./renderer";

const FONTS_DIR = path.resolve(process.cwd(), "public", "fonts");
const FIXTURES_DIR = path.resolve(process.cwd(), "tests", "fixtures");

function readFontFile(filename: string): ArrayBuffer {
  const buf = readFileSync(path.join(FONTS_DIR, filename));
  // Build a fresh ArrayBuffer copy — Node's Buffer shares memory with a
  // pooled ArrayBuffer, which pdf-lib doesn't like across embeds.
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(buf);
  return copy;
}

function loadFonts() {
  return {
    body: readFontFile("lora-regular.ttf"),
    headings: readFontFile("inter-regular.ttf"),
    mono: readFontFile("jetbrains-mono-regular.ttf"),
  };
}

describe("markdown-to-pdf pipeline", () => {
  it("converts the sample.md fixture to a valid PDF", async () => {
    const md = readFileSync(path.join(FIXTURES_DIR, "sample.md"), "utf-8");
    const blocks = parseMarkdown(md);
    expect(blocks.length).toBeGreaterThan(0);

    const fonts = loadFonts();
    const bytes = await renderBlocksToPdf(blocks, { pageSize: "letter" }, fonts);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);

    const [page] = pdf.getPages();
    expect(page!.getSize()).toEqual({ width: 612, height: 792 });
  });

  it("respects the pageSize option (a4)", async () => {
    const md = readFileSync(path.join(FIXTURES_DIR, "sample.md"), "utf-8");
    const blocks = parseMarkdown(md);
    const fonts = loadFonts();
    const bytes = await renderBlocksToPdf(blocks, { pageSize: "a4" }, fonts);
    const pdf = await PDFDocument.load(bytes);
    const [page] = pdf.getPages();
    expect(page!.getSize()).toEqual({ width: 595, height: 842 });
  });

  it("output filename would be 'sample.pdf' for input 'sample.md'", () => {
    // Mirrors the replaceExt logic in worker.ts without spawning a Worker.
    function replaceExt(name: string, newExt: string): string {
      const dot = name.lastIndexOf(".");
      if (dot <= 0) return `${name}.${newExt}`;
      return `${name.slice(0, dot)}.${newExt}`;
    }
    expect(replaceExt("sample.md", "pdf")).toBe("sample.pdf");
    expect(replaceExt("my.file.markdown", "pdf")).toBe("my.file.pdf");
    expect(replaceExt("noext", "pdf")).toBe("noext.pdf");
  });
});
