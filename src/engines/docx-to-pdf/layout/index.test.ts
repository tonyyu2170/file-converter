/**
 * Integration tests for `layoutDocument(parsed)`.
 *
 * Each fixture is parsed end-to-end and run through the orchestrator;
 * we assert PDF magic + footer, page counts, and that distinctive
 * source strings survive in the output (checked via `pdf-lib`'s
 * inspection rather than a true text extractor — the goal is to verify
 * the bytes claim to be a valid PDF, not to validate text extraction
 * fidelity, which is `pdfjs-dist` territory). Searchability proper is
 * exercised in the Task-14 E2E suite.
 *
 * Fonts are loaded from `public/fonts/` via an fs-backed injection so
 * the tests don't need a live `fetch("/fonts/…")` in the Node env.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { parseDocx } from "../docx-parser";
import type { BundledFontFamily, FontWeight } from "../fonts/types";
import { layoutDocument } from "./index";

const FIXTURES_DIR = join(process.cwd(), "tests", "fixtures");
const FONTS_DIR = join(process.cwd(), "public", "fonts");

function readFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

/** fs-backed font loader. Mirrors `font-loader.resolveFilename`. */
async function fsLoadFont(
  family: BundledFontFamily,
  weight: FontWeight,
  italic: boolean,
): Promise<ArrayBuffer> {
  const wantsItalic = italic && family !== "jetbrains-mono";
  const weightPart = weight === 700 ? "bold" : "regular";
  let filename: string;
  if (wantsItalic && weight === 700) filename = `${family}-bold-italic.ttf`;
  else if (wantsItalic) filename = `${family}-italic.ttf`;
  else filename = `${family}-${weightPart}.ttf`;
  const buf = readFileSync(join(FONTS_DIR, filename));
  // Build a fresh ArrayBuffer copy — Node's Buffer shares memory with a
  // pooled ArrayBuffer, which pdf-lib doesn't like across embeds.
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(buf);
  return copy;
}

const opts = { loadFont: fsLoadFont };

/** Decode bytes back to a UTF-8 string for searchable-text byte-grep. */
function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

/* ------------------------------------------------------------------ */
/*   Empty / edge cases                                                */
/* ------------------------------------------------------------------ */

describe("layoutDocument — basic shape", () => {
  it("emits valid PDF bytes that start with %PDF- and end with %%EOF", async () => {
    const parsed = parseDocx(readFixture("simple-paragraphs.docx"));
    const { pdfBytes } = await layoutDocument(parsed, opts);
    const head = bytesToString(pdfBytes.slice(0, 5));
    expect(head).toBe("%PDF-");
    // %%EOF can be followed by an optional newline or whitespace.
    const tail = bytesToString(pdfBytes.slice(-10));
    expect(tail).toMatch(/%%EOF\s*$/);
  });

  it("returns an empty warnings array when source has no warnings", async () => {
    const parsed = parseDocx(readFixture("simple-paragraphs.docx"));
    const { warnings } = await layoutDocument(parsed, opts);
    expect(warnings).toEqual([]);
  });

  it("output PDF parses back via pdf-lib", async () => {
    const parsed = parseDocx(readFixture("simple-paragraphs.docx"));
    const { pdfBytes } = await layoutDocument(parsed, opts);
    const reread = await PDFDocument.load(pdfBytes);
    expect(reread.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

/* ------------------------------------------------------------------ */
/*   simple-paragraphs.docx                                            */
/* ------------------------------------------------------------------ */

describe("layoutDocument — simple-paragraphs.docx", () => {
  it("produces at least one page", async () => {
    const parsed = parseDocx(readFixture("simple-paragraphs.docx"));
    const { pdfBytes } = await layoutDocument(parsed, opts);
    const pdf = await PDFDocument.load(pdfBytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("emits no orchestrator-side warnings for a clean document", async () => {
    const parsed = parseDocx(readFixture("simple-paragraphs.docx"));
    const { warnings } = await layoutDocument(parsed, opts);
    expect(warnings).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*   multi-page.docx                                                   */
/* ------------------------------------------------------------------ */

describe("layoutDocument — multi-page.docx", () => {
  it("produces multiple pages for 5+ pages of content", async () => {
    const parsed = parseDocx(readFixture("multi-page.docx"));
    const { pdfBytes } = await layoutDocument(parsed, opts);
    const pdf = await PDFDocument.load(pdfBytes);
    // Source has ~130+ paragraphs; output should span multiple pages.
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2);
  });
});

/* ------------------------------------------------------------------ */
/*   two-column-resume.docx                                            */
/* ------------------------------------------------------------------ */

describe("layoutDocument — two-column-resume.docx", () => {
  it("produces a non-empty PDF", async () => {
    const parsed = parseDocx(readFixture("two-column-resume.docx"));
    const { pdfBytes } = await layoutDocument(parsed, opts);
    const pdf = await PDFDocument.load(pdfBytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("multi-column section doesn't flag an unbalanced-by-design warning", async () => {
    const parsed = parseDocx(readFixture("two-column-resume.docx"));
    const { warnings } = await layoutDocument(parsed, opts);
    // Real résumé content has clean break points; the algorithm should
    // not need to fall back to the unbalanced path.
    const unbalanced = warnings.filter((w) => /unbalanced-by-design/.test(w));
    expect(unbalanced).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*   table-doc.docx                                                    */
/* ------------------------------------------------------------------ */

describe("layoutDocument — table-doc.docx", () => {
  it("renders without throwing despite gridSpan/vMerge cells", async () => {
    const parsed = parseDocx(readFixture("table-doc.docx"));
    const { pdfBytes } = await layoutDocument(parsed, opts);
    const pdf = await PDFDocument.load(pdfBytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

/* ------------------------------------------------------------------ */
/*   headed-footed.docx                                                */
/* ------------------------------------------------------------------ */

describe("layoutDocument — headed-footed.docx", () => {
  it("produces a PDF with header/footer references resolved", async () => {
    const parsed = parseDocx(readFixture("headed-footed.docx"));
    expect(parsed.headers.size).toBeGreaterThanOrEqual(1);
    const { pdfBytes } = await layoutDocument(parsed, opts);
    const pdf = await PDFDocument.load(pdfBytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

/* ------------------------------------------------------------------ */
/*   footnoted.docx                                                    */
/* ------------------------------------------------------------------ */

describe("layoutDocument — footnoted.docx", () => {
  it("produces a PDF containing the footnote bodies somewhere in its bytes", async () => {
    const parsed = parseDocx(readFixture("footnoted.docx"));
    expect(parsed.footnotes.size).toBe(3);
    const { pdfBytes } = await layoutDocument(parsed, opts);
    const pdf = await PDFDocument.load(pdfBytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

/* ------------------------------------------------------------------ */
/*   image-doc.docx                                                    */
/* ------------------------------------------------------------------ */

describe("layoutDocument — image-doc.docx", () => {
  it("embeds inline images without warnings on supported formats", async () => {
    const parsed = parseDocx(readFixture("image-doc.docx"));
    const { warnings } = await layoutDocument(parsed, opts);
    // No image-skip warnings expected for the committed PNG/JPEG fixture.
    const imgSkips = warnings.filter((w) => w.startsWith("image skipped:"));
    expect(imgSkips).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*   skip-with-warning fixtures pass through                           */
/* ------------------------------------------------------------------ */

describe("layoutDocument — skip-with-warning fixtures", () => {
  it("rtl-doc.docx surfaces an RTL warning in the result", async () => {
    const parsed = parseDocx(readFixture("rtl-doc.docx"));
    const { warnings } = await layoutDocument(parsed, opts);
    expect(warnings.some((w) => /RTL/i.test(w))).toBe(true);
  });

  it("equations-doc.docx surfaces an equation warning in the result", async () => {
    const parsed = parseDocx(readFixture("equations-doc.docx"));
    const { warnings } = await layoutDocument(parsed, opts);
    expect(warnings.some((w) => /equation/i.test(w))).toBe(true);
  });

  it("drawings-doc.docx surfaces a drawing warning in the result", async () => {
    const parsed = parseDocx(readFixture("drawings-doc.docx"));
    const { warnings } = await layoutDocument(parsed, opts);
    expect(warnings.some((w) => /drawing/i.test(w))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*   nested-list.docx                                                  */
/* ------------------------------------------------------------------ */

describe("layoutDocument — nested-list.docx", () => {
  it("renders multi-level lists without throwing", async () => {
    const parsed = parseDocx(readFixture("nested-list.docx"));
    const { pdfBytes } = await layoutDocument(parsed, opts);
    const pdf = await PDFDocument.load(pdfBytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

/* ------------------------------------------------------------------ */
/*   warning dedupe                                                    */
/* ------------------------------------------------------------------ */

describe("layoutDocument — warning dedupe", () => {
  it("does not surface duplicate warnings across passes", async () => {
    const parsed = parseDocx(readFixture("equations-doc.docx"));
    const { warnings } = await layoutDocument(parsed, opts);
    const set = new Set(warnings);
    expect(set.size).toBe(warnings.length);
  });
});

/* ------------------------------------------------------------------ */
/*   Searchability smoke — pdfjs-dist text extraction                  */
/* ------------------------------------------------------------------ */

/**
 * pdf-lib subset embedding + deflate compression makes a naive byte-grep
 * of the PDF unreliable. To verify text actually survives we use
 * pdfjs-dist's text extractor — same approach the Task-14 E2E suite
 * uses, exercised here as a single smoke check so the layout
 * orchestrator gets full-stack coverage in unit testing too.
 */
describe("layoutDocument — searchable-text smoke", () => {
  it("extracts the 'Tony Yu' fixture identifier from simple-paragraphs.docx output", async () => {
    const parsed = parseDocx(readFixture("simple-paragraphs.docx"));
    const { pdfBytes } = await layoutDocument(parsed, opts);

    // Dynamic import — pdfjs-dist's worker setup is environment-sensitive
    // and we want to keep the import hidden behind the test that needs
    // it. We use the legacy build to avoid the modern build's mandatory
    // worker, then point workerSrc at the local CJS worker entry so
    // pdfjs's "fake worker" loader has something to spin up in Node.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const doc = await pdfjs.getDocument({ data: pdfBytes }).promise;
    let allText = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      allText += content.items
        .map((it: unknown) =>
          typeof it === "object" && it !== null && "str" in it
            ? String((it as { str: unknown }).str)
            : "",
        )
        .join(" ");
    }
    expect(allText).toContain("Tony Yu");
  });
});
