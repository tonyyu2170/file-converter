import { describe, expect, it } from "vitest";

import type {
  Paragraph,
  ParsedBlock,
  ParsedDocx,
  RelationshipTarget,
  Run,
  Section,
} from "@/engines/docx-to-pdf/docx-parser/types";
import type { PDFDocument } from "pdf-lib";
import { LETTER_PORTRAIT, makeMockEmbeddedFonts, makeMockPdfDoc } from "./_test-helpers";
import type { LayoutDeps } from "./block-dispatch";
import { renderFooterForPage, renderHeaderForPage } from "./headers-footers";

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

function makePara(text: string): Paragraph {
  return {
    kind: "paragraph",
    alignment: "left",
    runs: [makeRun({ text })],
  };
}

function rel(id: string, target: string): RelationshipTarget {
  return { id, type: "header", target, targetMode: "Internal" };
}

function makeSection(
  opts: {
    headerRefs?: Section["headerRefs"];
    footerRefs?: Section["footerRefs"];
  } = {},
): Section {
  return {
    pageSize: { widthPt: LETTER_PORTRAIT.widthPt, heightPt: LETTER_PORTRAIT.heightPt },
    pageMargins: {
      top: LETTER_PORTRAIT.marginTopPt,
      right: LETTER_PORTRAIT.marginRightPt,
      bottom: LETTER_PORTRAIT.marginBottomPt,
      left: LETTER_PORTRAIT.marginLeftPt,
    },
    columns: { count: 1, spaceBetween: 0 },
    headerRefs: opts.headerRefs ?? {},
    footerRefs: opts.footerRefs ?? {},
    blocks: [],
  };
}

function makeParsedDocx(overrides: Partial<ParsedDocx> = {}): ParsedDocx {
  return {
    sections: [],
    styles: new Map(),
    numbering: new Map(),
    fontTable: new Map(),
    relationships: new Map(),
    footnotes: new Map(),
    endnotes: new Map(),
    headers: new Map(),
    footers: new Map(),
    media: new Map(),
    bookmarks: new Set(),
    warnings: [],
    ...overrides,
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

function setup() {
  const pdf = makeMockPdfDoc();
  const page = pdf.addPage();
  return { pdf: pdf as unknown as PDFDocument, mockPdf: pdf, page };
}

/* ------------------------------------------------------------------ */
/*   renderHeaderForPage                                              */
/* ------------------------------------------------------------------ */

describe("renderHeaderForPage", () => {
  it("is a no-op when section has no header refs", () => {
    const { pdf, page, mockPdf } = setup();
    const section = makeSection();
    const parsed = makeParsedDocx();
    renderHeaderForPage(
      page,
      1,
      1,
      section,
      parsed,
      LETTER_PORTRAIT,
      makeMockEmbeddedFonts(),
      makeDeps(),
      pdf,
    );
    expect(page.__calls.length).toBe(0);
    expect(mockPdf.__pages.length).toBe(1);
  });

  it("is a no-op when rId resolves but the part isn't in headers map", () => {
    const { pdf, page } = setup();
    const section = makeSection({ headerRefs: { default: "rId1" } });
    const parsed = makeParsedDocx({
      relationships: new Map([["rId1", rel("rId1", "header1.xml")]]),
    });
    renderHeaderForPage(
      page,
      1,
      1,
      section,
      parsed,
      LETTER_PORTRAIT,
      makeMockEmbeddedFonts(),
      makeDeps(),
      pdf,
    );
    expect(page.__calls.length).toBe(0);
  });

  it("draws the default header on page 1 when only default is set", () => {
    const { pdf, page } = setup();
    const section = makeSection({ headerRefs: { default: "rId1" } });
    const blocks: ParsedBlock[] = [makePara("HEAD")];
    const parsed = makeParsedDocx({
      relationships: new Map([["rId1", rel("rId1", "header1.xml")]]),
      headers: new Map([["header1.xml", blocks]]),
    });
    renderHeaderForPage(
      page,
      1,
      1,
      section,
      parsed,
      LETTER_PORTRAIT,
      makeMockEmbeddedFonts(),
      makeDeps(),
      pdf,
    );
    const drawnTexts = page.__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    expect(drawnTexts.join("")).toContain("HEAD");
  });

  it("prefers `first` variant on page 1 when defined", () => {
    const { pdf, page } = setup();
    const section = makeSection({ headerRefs: { default: "rIdD", first: "rIdF" } });
    const parsed = makeParsedDocx({
      relationships: new Map([
        ["rIdD", rel("rIdD", "header1.xml")],
        ["rIdF", rel("rIdF", "header2.xml")],
      ]),
      headers: new Map([
        ["header1.xml", [makePara("DEFAULT")]],
        ["header2.xml", [makePara("FIRST")]],
      ]),
    });
    renderHeaderForPage(
      page,
      1,
      4,
      section,
      parsed,
      LETTER_PORTRAIT,
      makeMockEmbeddedFonts(),
      makeDeps(),
      pdf,
    );
    const drawnTexts = page.__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    expect(drawnTexts.join("")).toContain("FIRST");
    expect(drawnTexts.join("")).not.toContain("DEFAULT");
  });

  it("prefers `even` variant on even-numbered pages when defined", () => {
    const { pdf, page } = setup();
    const section = makeSection({ headerRefs: { default: "rIdD", even: "rIdE" } });
    const parsed = makeParsedDocx({
      relationships: new Map([
        ["rIdD", rel("rIdD", "header1.xml")],
        ["rIdE", rel("rIdE", "header2.xml")],
      ]),
      headers: new Map([
        ["header1.xml", [makePara("D")]],
        ["header2.xml", [makePara("E")]],
      ]),
    });
    renderHeaderForPage(
      page,
      2,
      4,
      section,
      parsed,
      LETTER_PORTRAIT,
      makeMockEmbeddedFonts(),
      makeDeps(),
      pdf,
    );
    const drawnTexts = page.__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    expect(drawnTexts.join("")).toContain("E");
    expect(drawnTexts.join("")).not.toContain("D ");
  });

  it("falls back to default on odd, non-first pages", () => {
    const { pdf, page } = setup();
    const section = makeSection({
      headerRefs: { default: "rIdD", first: "rIdF", even: "rIdE" },
    });
    const parsed = makeParsedDocx({
      relationships: new Map([
        ["rIdD", rel("rIdD", "header1.xml")],
        ["rIdF", rel("rIdF", "header2.xml")],
        ["rIdE", rel("rIdE", "header3.xml")],
      ]),
      headers: new Map([
        ["header1.xml", [makePara("DEF")]],
        ["header2.xml", [makePara("FST")]],
        ["header3.xml", [makePara("EVN")]],
      ]),
    });
    renderHeaderForPage(
      page,
      3,
      5,
      section,
      parsed,
      LETTER_PORTRAIT,
      makeMockEmbeddedFonts(),
      makeDeps(),
      pdf,
    );
    const drawnTexts = page.__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    expect(drawnTexts.join("")).toContain("DEF");
    expect(drawnTexts.join("")).not.toContain("FST");
  });

  it("normalizes targets prefixed with `word/` to bare filename", () => {
    const { pdf, page } = setup();
    const section = makeSection({ headerRefs: { default: "rId1" } });
    const parsed = makeParsedDocx({
      relationships: new Map([["rId1", rel("rId1", "word/header1.xml")]]),
      headers: new Map([["header1.xml", [makePara("HEAD")]]]),
    });
    renderHeaderForPage(
      page,
      1,
      1,
      section,
      parsed,
      LETTER_PORTRAIT,
      makeMockEmbeddedFonts(),
      makeDeps(),
      pdf,
    );
    const drawnTexts = page.__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    expect(drawnTexts.join("")).toContain("HEAD");
  });

  it("normalizes targets with leading slash", () => {
    const { pdf, page } = setup();
    const section = makeSection({ headerRefs: { default: "rId1" } });
    const parsed = makeParsedDocx({
      relationships: new Map([["rId1", rel("rId1", "/word/header1.xml")]]),
      headers: new Map([["header1.xml", [makePara("HEAD")]]]),
    });
    renderHeaderForPage(
      page,
      1,
      1,
      section,
      parsed,
      LETTER_PORTRAIT,
      makeMockEmbeddedFonts(),
      makeDeps(),
      pdf,
    );
    const drawnTexts = page.__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    expect(drawnTexts.join("")).toContain("HEAD");
  });
});

/* ------------------------------------------------------------------ */
/*   renderFooterForPage                                              */
/* ------------------------------------------------------------------ */

describe("renderFooterForPage", () => {
  it("is a no-op when section has no footer refs", () => {
    const { pdf, page } = setup();
    const section = makeSection();
    const parsed = makeParsedDocx();
    renderFooterForPage(
      page,
      1,
      1,
      section,
      parsed,
      LETTER_PORTRAIT,
      makeMockEmbeddedFonts(),
      makeDeps(),
      pdf,
    );
    expect(page.__calls.length).toBe(0);
  });

  it("draws default footer on page 1 when only default is set", () => {
    const { pdf, page } = setup();
    const section = makeSection({ footerRefs: { default: "rId1" } });
    const parsed = makeParsedDocx({
      relationships: new Map([["rId1", rel("rId1", "footer1.xml")]]),
      footers: new Map([["footer1.xml", [makePara("FOOT")]]]),
    });
    renderFooterForPage(
      page,
      1,
      1,
      section,
      parsed,
      LETTER_PORTRAIT,
      makeMockEmbeddedFonts(),
      makeDeps(),
      pdf,
    );
    const drawnTexts = page.__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    expect(drawnTexts.join("")).toContain("FOOT");
  });

  it("does not throw when bottom margin is too small to fit footer band", () => {
    const { pdf, page } = setup();
    const section = makeSection({ footerRefs: { default: "rId1" } });
    const parsed = makeParsedDocx({
      relationships: new Map([["rId1", rel("rId1", "footer1.xml")]]),
      footers: new Map([["footer1.xml", [makePara("FOOT")]]]),
    });
    const tinyGeometry = { ...LETTER_PORTRAIT, marginBottomPt: 4 };
    expect(() =>
      renderFooterForPage(
        page,
        1,
        1,
        section,
        parsed,
        tinyGeometry,
        makeMockEmbeddedFonts(),
        makeDeps(),
        pdf,
      ),
    ).not.toThrow();
    // No drawText emitted because the band collapses.
    expect(page.__calls.filter((c) => c.op === "drawText").length).toBe(0);
  });
});
