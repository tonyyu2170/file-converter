import { describe, expect, it } from "vitest";

import type {
  Paragraph,
  ParsedBlock,
  ParsedDocx,
  Run,
  Section,
} from "@/engines/_shared/docx/docx-parser/types";
import type { PDFDocument } from "pdf-lib";
import { LETTER_PORTRAIT, makeMockEmbeddedFonts, makeMockPdfDoc } from "./_test-helpers";
import type { LayoutDeps } from "./block-dispatch";
import {
  collectFootnoteRefsInBlocks,
  estimateSectionFootnoteHeight,
  flushFootnoteAreaToPage,
  newFootnoteAccumulator,
  registerMarker,
  renderEndnotePages,
} from "./footnotes";

/* ------------------------------------------------------------------ */
/*   Builders                                                          */
/* ------------------------------------------------------------------ */

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    kind: "run",
    text: "",
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    ...overrides,
  };
}

function makePara(runs: Run[], alignment: Paragraph["alignment"] = "left"): Paragraph {
  return { kind: "paragraph", alignment, runs };
}

function makeSection(blocks: ParsedBlock[]): Section {
  return {
    pageSize: { widthPt: LETTER_PORTRAIT.widthPt, heightPt: LETTER_PORTRAIT.heightPt },
    pageMargins: {
      top: LETTER_PORTRAIT.marginTopPt,
      right: LETTER_PORTRAIT.marginRightPt,
      bottom: LETTER_PORTRAIT.marginBottomPt,
      left: LETTER_PORTRAIT.marginLeftPt,
    },
    columns: { count: 1, spaceBetween: 0 },
    headerRefs: {},
    footerRefs: {},
    blocks,
  };
}

function makeParsedDocx(overrides: Partial<ParsedDocx> = {}): ParsedDocx {
  return {
    sections: overrides.sections ?? [],
    styles: overrides.styles ?? new Map(),
    numbering: overrides.numbering ?? new Map(),
    fontTable: overrides.fontTable ?? new Map(),
    relationships: overrides.relationships ?? new Map(),
    footnotes: overrides.footnotes ?? new Map(),
    endnotes: overrides.endnotes ?? new Map(),
    headers: overrides.headers ?? new Map(),
    footers: overrides.footers ?? new Map(),
    media: overrides.media ?? new Map(),
    bookmarks: overrides.bookmarks ?? new Set(),
    warnings: overrides.warnings ?? [],
  };
}

function makeDeps(): LayoutDeps {
  return {
    numbering: new Map(),
    relationships: new Map(),
    bookmarks: new Set(),
    listState: { counters: new Map(), lastLevel: new Map() },
    warnings: [],
  };
}

/* ------------------------------------------------------------------ */
/*   newFootnoteAccumulator                                           */
/* ------------------------------------------------------------------ */

describe("newFootnoteAccumulator", () => {
  it("returns zeroed counters and empty containers", () => {
    const acc = newFootnoteAccumulator();
    expect(acc.pageFootnoteCounter).toBe(0);
    expect(acc.endnoteCounter).toBe(0);
    expect(acc.pageFootnotes.size).toBe(0);
    expect(acc.endnoteRefs).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*   registerMarker                                                   */
/* ------------------------------------------------------------------ */

describe("registerMarker — footnotes", () => {
  it("assigns sequential decimal labels and buckets by page", () => {
    const pdf = makeMockPdfDoc();
    const pageA = pdf.addPage();
    const pageB = pdf.addPage();
    const acc = newFootnoteAccumulator();
    expect(registerMarker(acc, "footnote", "1", pageA)).toBe("1");
    expect(registerMarker(acc, "footnote", "2", pageA)).toBe("2");
    expect(registerMarker(acc, "footnote", "3", pageB)).toBe("3");
    expect(acc.pageFootnoteCounter).toBe(3);
    expect(acc.pageFootnotes.get(pageA)?.length).toBe(2);
    expect(acc.pageFootnotes.get(pageB)?.length).toBe(1);
    expect(acc.pageFootnotes.get(pageA)?.[0]?.markerLabel).toBe("1");
    expect(acc.pageFootnotes.get(pageB)?.[0]?.markerLabel).toBe("3");
  });
});

describe("registerMarker — endnotes", () => {
  it("collects a flat ordered list, ignores page argument for bucketing", () => {
    const pdf = makeMockPdfDoc();
    const pageA = pdf.addPage();
    const acc = newFootnoteAccumulator();
    expect(registerMarker(acc, "endnote", "10", pageA)).toBe("1");
    expect(registerMarker(acc, "endnote", "11", pageA)).toBe("2");
    expect(registerMarker(acc, "endnote", "12", pageA)).toBe("3");
    expect(acc.endnoteRefs.map((r) => r.markerLabel)).toEqual(["1", "2", "3"]);
    expect(acc.endnoteRefs.map((r) => r.noteId)).toEqual(["10", "11", "12"]);
    expect(acc.pageFootnotes.size).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*   collectFootnoteRefsInBlocks                                      */
/* ------------------------------------------------------------------ */

describe("collectFootnoteRefsInBlocks", () => {
  it("returns empty for plain paragraphs with no refs", () => {
    const blocks: ParsedBlock[] = [makePara([makeRun({ text: "hi" })])];
    expect(collectFootnoteRefsInBlocks(blocks)).toEqual([]);
  });

  it("collects refs from top-level paragraphs in encounter order", () => {
    const blocks: ParsedBlock[] = [
      makePara([
        makeRun({ text: "x" }),
        makeRun({ footnoteRef: "1" }),
        makeRun({ footnoteRef: "2" }),
      ]),
      makePara([makeRun({ footnoteRef: "3" })]),
    ];
    expect(collectFootnoteRefsInBlocks(blocks)).toEqual(["1", "2", "3"]);
  });

  it("recurses into table cells", () => {
    const blocks: ParsedBlock[] = [
      {
        kind: "table",
        columnWidthsPt: [100, 100],
        rows: [
          {
            cells: [
              {
                blocks: [makePara([makeRun({ footnoteRef: "A" })])],
                gridSpan: 1,
                vMerge: "none",
              },
              {
                blocks: [makePara([makeRun({ footnoteRef: "B" })])],
                gridSpan: 1,
                vMerge: "none",
              },
            ],
          },
        ],
      },
    ];
    expect(collectFootnoteRefsInBlocks(blocks)).toEqual(["A", "B"]);
  });

  it("ignores skip-with-warning blocks", () => {
    const blocks: ParsedBlock[] = [{ kind: "skip-with-warning", reason: "x" }];
    expect(collectFootnoteRefsInBlocks(blocks)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*   estimateSectionFootnoteHeight                                    */
/* ------------------------------------------------------------------ */

describe("estimateSectionFootnoteHeight", () => {
  // estimateSectionFootnoteHeight uses a discard page internally; the
  // `pdfDoc` argument is forwarded to layoutParagraph but only consumed
  // by forced-page-break paths (which our footnote bodies don't trigger).
  // A mock PDFDoc is fine here.
  const pdf = makeMockPdfDoc() as unknown as PDFDocument;

  it("returns 0 for an empty noteId list", () => {
    const fonts = makeMockEmbeddedFonts();
    const parsed = makeParsedDocx();
    expect(estimateSectionFootnoteHeight([], parsed, fonts, 400, pdf)).toBe(0);
  });

  it("returns positive height when at least one footnote body exists", () => {
    const fonts = makeMockEmbeddedFonts();
    const parsed = makeParsedDocx({
      footnotes: new Map([["1", [makePara([makeRun({ text: "First footnote" })])]]]),
    });
    const h = estimateSectionFootnoteHeight(["1"], parsed, fonts, 400, pdf);
    expect(h).toBeGreaterThan(0);
  });

  it("scales with multiple footnote bodies", () => {
    const fonts = makeMockEmbeddedFonts();
    const parsed = makeParsedDocx({
      footnotes: new Map([
        ["1", [makePara([makeRun({ text: "one" })])]],
        ["2", [makePara([makeRun({ text: "two" })])]],
      ]),
    });
    const h1 = estimateSectionFootnoteHeight(["1"], parsed, fonts, 400, pdf);
    const h2 = estimateSectionFootnoteHeight(["1", "2"], parsed, fonts, 400, pdf);
    expect(h2).toBeGreaterThan(h1);
  });

  it("returns separator-only height for noteIds without registered bodies", () => {
    const fonts = makeMockEmbeddedFonts();
    const parsed = makeParsedDocx();
    const h = estimateSectionFootnoteHeight(["nope"], parsed, fonts, 400, pdf);
    // Still includes separator overhead.
    expect(h).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/*   flushFootnoteAreaToPage                                          */
/* ------------------------------------------------------------------ */

describe("flushFootnoteAreaToPage", () => {
  it("is a no-op when no footnotes were registered for the page", () => {
    const pdf = makeMockPdfDoc();
    const page = pdf.addPage();
    const acc = newFootnoteAccumulator();
    const parsed = makeParsedDocx();
    const fonts = makeMockEmbeddedFonts();
    const deps = makeDeps();
    // Should not throw and should leave the page empty.
    flushFootnoteAreaToPage(
      page,
      acc,
      parsed,
      LETTER_PORTRAIT,
      fonts,
      deps,
      pdf as unknown as PDFDocument,
    );
    expect(acc.pageFootnotes.size).toBe(0);
  });

  it("drains the page bucket after flush", () => {
    const pdf = makeMockPdfDoc();
    const page = pdf.addPage();
    const acc = newFootnoteAccumulator();
    registerMarker(acc, "footnote", "1", page);
    const parsed = makeParsedDocx({
      footnotes: new Map([["1", [makePara([makeRun({ text: "First footnote" })])]]]),
    });
    const fonts = makeMockEmbeddedFonts();
    const deps = makeDeps();
    flushFootnoteAreaToPage(
      page,
      acc,
      parsed,
      LETTER_PORTRAIT,
      fonts,
      deps,
      pdf as unknown as PDFDocument,
    );
    expect(acc.pageFootnotes.has(page)).toBe(false);
  });

  it("draws a hairline separator and at least one drawText for the marker", () => {
    const pdf = makeMockPdfDoc();
    const page = pdf.addPage();
    const acc = newFootnoteAccumulator();
    registerMarker(acc, "footnote", "1", page);
    const parsed = makeParsedDocx({
      footnotes: new Map([["1", [makePara([makeRun({ text: "Footnote body." })])]]]),
    });
    const fonts = makeMockEmbeddedFonts();
    const deps = makeDeps();
    flushFootnoteAreaToPage(
      page,
      acc,
      parsed,
      LETTER_PORTRAIT,
      fonts,
      deps,
      pdf as unknown as PDFDocument,
    );
    const calls = page.__calls;
    expect(calls.some((c) => c.op === "drawLine")).toBe(true);
    expect(calls.some((c) => c.op === "drawText")).toBe(true);
  });

  it("calling twice on the same page is idempotent (second call is a no-op)", () => {
    const pdf = makeMockPdfDoc();
    const page = pdf.addPage();
    const acc = newFootnoteAccumulator();
    registerMarker(acc, "footnote", "1", page);
    const parsed = makeParsedDocx({
      footnotes: new Map([["1", [makePara([makeRun({ text: "F" })])]]]),
    });
    const fonts = makeMockEmbeddedFonts();
    const deps = makeDeps();
    flushFootnoteAreaToPage(
      page,
      acc,
      parsed,
      LETTER_PORTRAIT,
      fonts,
      deps,
      pdf as unknown as PDFDocument,
    );
    const callsAfterFirst = page.__calls.length;
    flushFootnoteAreaToPage(
      page,
      acc,
      parsed,
      LETTER_PORTRAIT,
      fonts,
      deps,
      pdf as unknown as PDFDocument,
    );
    expect(page.__calls.length).toBe(callsAfterFirst);
    expect(acc.pageFootnotes.size).toBe(0);
  });

  it("does not mutate the parsed footnote bodies", () => {
    const pdf = makeMockPdfDoc();
    const page = pdf.addPage();
    const acc = newFootnoteAccumulator();
    registerMarker(acc, "footnote", "1", page);
    const original = makePara([makeRun({ text: "F" })]);
    const parsed = makeParsedDocx({ footnotes: new Map([["1", [original]]]) });
    const fonts = makeMockEmbeddedFonts();
    const deps = makeDeps();
    flushFootnoteAreaToPage(
      page,
      acc,
      parsed,
      LETTER_PORTRAIT,
      fonts,
      deps,
      pdf as unknown as PDFDocument,
    );
    // Same object reference; runs untouched.
    expect(parsed.footnotes.get("1")?.[0]).toBe(original);
    expect(original.runs.length).toBe(1);
    expect(original.runs[0]?.text).toBe("F");
  });
});

/* ------------------------------------------------------------------ */
/*   renderEndnotePages                                               */
/* ------------------------------------------------------------------ */

describe("renderEndnotePages", () => {
  it("is a no-op when no endnotes were registered", () => {
    const pdf = makeMockPdfDoc();
    const acc = newFootnoteAccumulator();
    const parsed = makeParsedDocx();
    const fonts = makeMockEmbeddedFonts();
    const deps = makeDeps();
    renderEndnotePages(pdf as unknown as PDFDocument, acc, parsed, LETTER_PORTRAIT, fonts, deps);
    expect(pdf.__pages.length).toBe(0);
  });

  it("appends at least one page when endnotes exist", () => {
    const pdf = makeMockPdfDoc();
    const bodyPage = pdf.addPage();
    const acc = newFootnoteAccumulator();
    registerMarker(acc, "endnote", "1", bodyPage);
    const parsed = makeParsedDocx({
      endnotes: new Map([["1", [makePara([makeRun({ text: "End." })])]]]),
    });
    const fonts = makeMockEmbeddedFonts();
    const deps = makeDeps();
    const before = pdf.__pages.length;
    renderEndnotePages(pdf as unknown as PDFDocument, acc, parsed, LETTER_PORTRAIT, fonts, deps);
    expect(pdf.__pages.length).toBeGreaterThan(before);
  });

  it("drains endnoteRefs after render", () => {
    const pdf = makeMockPdfDoc();
    const bodyPage = pdf.addPage();
    const acc = newFootnoteAccumulator();
    registerMarker(acc, "endnote", "1", bodyPage);
    const parsed = makeParsedDocx({
      endnotes: new Map([["1", [makePara([makeRun({ text: "End." })])]]]),
    });
    const fonts = makeMockEmbeddedFonts();
    const deps = makeDeps();
    renderEndnotePages(pdf as unknown as PDFDocument, acc, parsed, LETTER_PORTRAIT, fonts, deps);
    expect(acc.endnoteRefs).toEqual([]);
  });

  it("draws an `Endnotes` heading on the appended page", () => {
    const pdf = makeMockPdfDoc();
    const bodyPage = pdf.addPage();
    const acc = newFootnoteAccumulator();
    registerMarker(acc, "endnote", "1", bodyPage);
    const parsed = makeParsedDocx({
      endnotes: new Map([["1", [makePara([makeRun({ text: "End." })])]]]),
    });
    const fonts = makeMockEmbeddedFonts();
    const deps = makeDeps();
    renderEndnotePages(pdf as unknown as PDFDocument, acc, parsed, LETTER_PORTRAIT, fonts, deps);
    // The heading "Endnotes" + the body "End." should both appear via
    // drawText on subsequent pages.
    const allCalls = pdf.__pages.flatMap((p) => p.__calls);
    const drawnTexts = allCalls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    // Joined letters (drawText is called per word/whitespace fragment).
    const joined = drawnTexts.join("");
    expect(joined).toContain("Endnotes");
  });
});
