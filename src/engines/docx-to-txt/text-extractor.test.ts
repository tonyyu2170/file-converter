import type {
  Paragraph,
  ParsedBlock,
  ParsedDocx,
  Run,
  Section,
  Table,
  TableCell,
  TableRow,
} from "@/engines/_shared/docx";
import { describe, expect, it } from "vitest";
import { extractText } from "./text-extractor";

// ---------------------------------------------------------------------------
// Helpers to build typed ParsedDocx fixtures without the full PDF metadata
// ---------------------------------------------------------------------------

function makeRun(text: string, overrides?: Partial<Run>): Run {
  return {
    kind: "run",
    text,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    ...overrides,
  };
}

function makeParagraph(runs: Run[], styleId?: string): Paragraph {
  return {
    kind: "paragraph",
    alignment: "left",
    runs,
    ...(styleId ? { styleId } : {}),
  };
}

function makeCell(blocks: ParsedBlock[]): TableCell {
  return { blocks, gridSpan: 1, vMerge: "none" };
}

function makeTableRow(cells: TableCell[]): TableRow {
  return { cells };
}

function makeTable(rows: TableRow[]): Table {
  return { kind: "table", rows, columnWidthsPt: [] };
}

const EMPTY_SECTION_PROPS = {
  pageSize: { widthPt: 612, heightPt: 792 },
  pageMargins: { top: 72, right: 72, bottom: 72, left: 72 },
  columns: { count: 1, spaceBetween: 0 },
  headerRefs: {},
  footerRefs: {},
};

function makeDoc(blocks: ParsedBlock[]): ParsedDocx {
  const section: Section = {
    ...EMPTY_SECTION_PROPS,
    blocks,
  };
  return {
    sections: [section],
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
  };
}

const defaultOpts = { joinParagraphs: "double-newline" as const };
const singleOpts = { joinParagraphs: "single-newline" as const };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extractText", () => {
  it("returns empty string for empty document (no sections)", () => {
    const doc: ParsedDocx = {
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
    };
    expect(extractText(doc, defaultOpts)).toBe("");
  });

  it("returns empty string for a document with only empty blocks", () => {
    const doc = makeDoc([makeParagraph([])]);
    expect(extractText(doc, defaultOpts)).toBe("");
  });

  it("extracts text from a single paragraph", () => {
    const doc = makeDoc([makeParagraph([makeRun("Hello world")])]);
    expect(extractText(doc, defaultOpts)).toBe("Hello world");
  });

  it("joins multiple runs in a paragraph", () => {
    const doc = makeDoc([makeParagraph([makeRun("Hello"), makeRun(", "), makeRun("world")])]);
    expect(extractText(doc, defaultOpts)).toBe("Hello, world");
  });

  it("joins paragraphs with double-newline by default", () => {
    const doc = makeDoc([makeParagraph([makeRun("First")]), makeParagraph([makeRun("Second")])]);
    expect(extractText(doc, defaultOpts)).toBe("First\n\nSecond");
  });

  it("joins paragraphs with single-newline when option is single-newline", () => {
    const doc = makeDoc([makeParagraph([makeRun("First")]), makeParagraph([makeRun("Second")])]);
    expect(extractText(doc, singleOpts)).toBe("First\nSecond");
  });

  it("heading paragraphs emit text only — no '#' markers", () => {
    const doc = makeDoc([
      makeParagraph([makeRun("Chapter 1")], "Heading1"),
      makeParagraph([makeRun("Body text")]),
    ]);
    const out = extractText(doc, defaultOpts);
    expect(out).not.toMatch(/^#/m);
    expect(out).toContain("Chapter 1");
    expect(out).toContain("Body text");
  });

  it("skips image runs silently", () => {
    const imageRun: Run = {
      kind: "run",
      text: "",
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      inlineImage: { rel: "rId1", widthPt: 100, heightPt: 50 },
    };
    const doc = makeDoc([makeParagraph([makeRun("Before"), imageRun, makeRun("After")])]);
    expect(extractText(doc, defaultOpts)).toBe("BeforeAfter");
  });

  it("hyperlink runs emit run.text only (not anchor/rel fields)", () => {
    const linkRun: Run = {
      kind: "run",
      text: "Click here",
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      hyperlinkRel: "rId2",
    };
    const doc = makeDoc([makeParagraph([linkRun])]);
    expect(extractText(doc, defaultOpts)).toBe("Click here");
  });

  it("skips skip-with-warning blocks silently", () => {
    const doc = makeDoc([
      makeParagraph([makeRun("Before warning")]),
      { kind: "skip-with-warning", reason: "unsupported equation" },
      makeParagraph([makeRun("After warning")]),
    ]);
    const out = extractText(doc, defaultOpts);
    expect(out).toBe("Before warning\n\nAfter warning");
    expect(out).not.toContain("unsupported");
  });

  it("renders a simple table: cells tab-joined, rows newline-joined", () => {
    const doc = makeDoc([
      makeTable([
        makeTableRow([
          makeCell([makeParagraph([makeRun("A")])]),
          makeCell([makeParagraph([makeRun("B")])]),
        ]),
        makeTableRow([
          makeCell([makeParagraph([makeRun("C")])]),
          makeCell([makeParagraph([makeRun("D")])]),
        ]),
      ]),
    ]);
    expect(extractText(doc, defaultOpts)).toBe("A\tB\nC\tD");
  });

  it("separates table from surrounding paragraphs with double-newline always", () => {
    const doc = makeDoc([
      makeParagraph([makeRun("Before")]),
      makeTable([makeTableRow([makeCell([makeParagraph([makeRun("Cell")])])])]),
      makeParagraph([makeRun("After")]),
    ]);
    const out = extractText(doc, singleOpts);
    // Single-newline option does NOT apply between paragraph and table
    expect(out).toBe("Before\n\nCell\n\nAfter");
  });

  it("separates table from table with double-newline", () => {
    const table1 = makeTable([makeTableRow([makeCell([makeParagraph([makeRun("T1")])])])]);
    const table2 = makeTable([makeTableRow([makeCell([makeParagraph([makeRun("T2")])])])]);
    const doc = makeDoc([table1, table2]);
    expect(extractText(doc, singleOpts)).toBe("T1\n\nT2");
  });

  it("handles vMerge continue cells with empty content gracefully", () => {
    const continueCell: TableCell = {
      blocks: [],
      gridSpan: 1,
      vMerge: "continue",
    };
    const doc = makeDoc([
      makeTable([
        makeTableRow([
          makeCell([makeParagraph([makeRun("Top")])]),
          makeCell([makeParagraph([makeRun("Right")])]),
        ]),
        makeTableRow([{ blocks: [], gridSpan: 1, vMerge: "continue" }, continueCell]),
      ]),
    ]);
    // Second row has empty cells — should not throw; columns preserved by \t
    const out = extractText(doc, defaultOpts);
    expect(out).toContain("Top");
    expect(out).toContain("Right");
  });

  it("handles recursive table cells (cells contain ParsedBlock[])", () => {
    // A cell contains a nested paragraph
    const nestedPara = makeParagraph([makeRun("Nested para")]);
    const cell = makeCell([nestedPara]);
    const doc = makeDoc([makeTable([makeTableRow([cell])])]);
    expect(extractText(doc, defaultOpts)).toBe("Nested para");
  });

  it("flattens multiple sections into one block stream", () => {
    const section1: Section = {
      ...EMPTY_SECTION_PROPS,
      blocks: [makeParagraph([makeRun("Section 1")])],
    };
    const section2: Section = {
      ...EMPTY_SECTION_PROPS,
      blocks: [makeParagraph([makeRun("Section 2")])],
    };
    const doc: ParsedDocx = {
      sections: [section1, section2],
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
    };
    const out = extractText(doc, defaultOpts);
    expect(out).toContain("Section 1");
    expect(out).toContain("Section 2");
  });

  it("list items emit text per item with no bullet glyph", () => {
    const doc = makeDoc([
      makeParagraph([makeRun("Item 1")], "ListParagraph"),
      makeParagraph([makeRun("Item 2")], "ListParagraph"),
    ]);
    const out = extractText(doc, defaultOpts);
    expect(out).not.toMatch(/^[-*•]\s/m);
    expect(out).toContain("Item 1");
    expect(out).toContain("Item 2");
  });

  it("multi-paragraph table cells stay on one line (no newlines inside row)", () => {
    // A cell with two paragraphs must not introduce \n inside the row,
    // which would break the tab-separated structure.
    const multiParaCell = makeCell([
      makeParagraph([makeRun("First")]),
      makeParagraph([makeRun("Second")]),
    ]);
    const singleCell = makeCell([makeParagraph([makeRun("Other")])]);
    const doc = makeDoc([makeTable([makeTableRow([multiParaCell, singleCell])])]);
    const out = extractText(doc, defaultOpts);
    // The row must contain exactly one \t (between the two cells)
    const rows = out.split("\n");
    expect(rows.length).toBe(1);
    expect(rows[0]).toContain("\t");
    expect(rows[0]).toContain("First");
    expect(rows[0]).toContain("Second");
    expect(rows[0]).toContain("Other");
  });

  it("collapses consecutive blank paragraphs to a single separator", () => {
    // Three blank paragraphs between two non-empty paragraphs should
    // collapse to the same output as a single blank paragraph.
    const doc = makeDoc([
      makeParagraph([makeRun("First")]),
      makeParagraph([]), // blank
      makeParagraph([]), // blank
      makeParagraph([]), // blank
      makeParagraph([makeRun("Second")]),
    ]);
    const result = extractText(doc, defaultOpts);
    // Collapsed — not "First\n\n\n\n\n\n\n\nSecond"
    expect(result).toBe("First\n\nSecond");
  });

  it("vMerge continue cells emit empty string regardless of content", () => {
    // A continue cell that happens to carry content must still emit ""
    // to preserve column alignment and avoid duplicating merged cell text.
    const doc = makeDoc([
      makeTable([
        makeTableRow([
          { blocks: [makeParagraph([makeRun("Top")])], gridSpan: 1, vMerge: "start" },
          makeCell([makeParagraph([makeRun("Other")])]),
        ]),
        makeTableRow([
          // This cell is a vMerge continuation but has non-empty blocks.
          // The implementation must still emit "" to preserve alignment.
          {
            blocks: [makeParagraph([makeRun("Should not appear")])],
            gridSpan: 1,
            vMerge: "continue",
          },
          makeCell([makeParagraph([makeRun("Bottom")])]),
        ]),
      ]),
    ]);
    const result = extractText(doc, defaultOpts);
    // Row 1: "Top\tOther", Row 2: "\tBottom" (continue cell is empty)
    expect(result).toContain("Top\tOther");
    expect(result).toContain("\tBottom");
    expect(result).not.toContain("Should not appear");
  });
});
