/**
 * Integration tests for the markdown-to-pdf pipeline:
 * parseMarkdown → renderBlocksToPdf.
 *
 * NOTE — why these tests don't call engine.convert():
 * Worker spawn requires a browser Worker API that Vitest/jsdom does not
 * provide. The worker boundary (Comlink expose/proxy, loadFonts
 * parallelization, WorkerHarness) is exercised by the Playwright E2E
 * suite in Task 10. This file validates the full conversion pipeline
 * (parse → render → valid PDF) and correct filename extension handling
 * by calling the underlying functions directly.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./parser";
import { renderBlocksToPdf } from "./renderer";
import { replaceExt } from "./worker";

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
    bodyItalic: readFontFile("lora-italic.ttf"),
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
    expect(page).toBeDefined();
    if (!page) return;
    expect(page.getSize()).toEqual({ width: 612, height: 792 });
  });

  it("respects the pageSize option (a4)", async () => {
    const md = readFileSync(path.join(FIXTURES_DIR, "sample.md"), "utf-8");
    const blocks = parseMarkdown(md);
    const fonts = loadFonts();
    const bytes = await renderBlocksToPdf(blocks, { pageSize: "a4" }, fonts);
    const pdf = await PDFDocument.load(bytes);
    const [page] = pdf.getPages();
    expect(page).toBeDefined();
    if (!page) return;
    expect(page.getSize()).toEqual({ width: 595, height: 842 });
  });

  it("output filename uses .pdf extension (replaceExt from worker)", () => {
    // Tests the exported replaceExt from worker.ts directly — no Worker
    // spawn needed. Covers the three cases: normal, dotted, no-extension.
    expect(replaceExt("sample.md", "pdf")).toBe("sample.pdf");
    expect(replaceExt("my.file.markdown", "pdf")).toBe("my.file.pdf");
    expect(replaceExt("noext", "pdf")).toBe("noext.pdf");
  });
});
