import type {
  Paragraph,
  ParsedBlock,
  Run,
  Table,
  TableCell,
  TableRow,
} from "@/engines/docx-to-pdf/docx-parser/types";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { type MockPage, makeColumnContext } from "./_test-helpers";
import type { LayoutDeps } from "./block-dispatch";
import { createListState } from "./lists";
import { layoutTable } from "./tables";

function makeRun(text: string, overrides: Partial<Run> = {}): Run {
  return {
    kind: "run",
    text,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    fontSizePt: 11,
    ...overrides,
  };
}

function para(text: string): Paragraph {
  return {
    kind: "paragraph",
    alignment: "left",
    runs: [makeRun(text)],
  };
}

function cell(blocks: ParsedBlock[], opts: Partial<TableCell> = {}): TableCell {
  return {
    blocks,
    gridSpan: 1,
    vMerge: "none",
    ...opts,
  };
}

function row(cells: TableCell[]): TableRow {
  return { cells };
}

function makeTable(rows: TableRow[], columnWidthsPt: number[]): Table {
  return { kind: "table", rows, columnWidthsPt };
}

function makeDeps(): LayoutDeps {
  return {
    numbering: new Map(),
    relationships: new Map(),
    listState: createListState(),
  };
}

async function freshDoc(): Promise<PDFDocument> {
  return PDFDocument.create();
}

/* ---------- Simple grid ---------- */

describe("layoutTable — rectangular grid", () => {
  it("draws a 2x2 table with borders around each cell", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const t = makeTable(
      [row([cell([para("A")]), cell([para("B")])]), row([cell([para("C")]), cell([para("D")])])],
      [200, 200],
    );
    const result = layoutTable(t, ctx, pdf, makeDeps());
    expect(result.remainder).toBeUndefined();
    expect(result.drawnHeight).toBeGreaterThan(0);
    const lineCalls = (ctx.page as MockPage).__calls.filter((c) => c.op === "drawLine");
    // 2 rows × 4 borders/cell × 2 cells/row = 16 borders. (Adjacent
    // cells double-up at shared edges; we don't dedupe in v1.)
    expect(lineCalls.length).toBeGreaterThanOrEqual(16);
  });

  it("draws cell text content", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const t = makeTable([row([cell([para("Hello")]), cell([para("World")])])], [200, 200]);
    layoutTable(t, ctx, pdf, makeDeps());
    const texts = (ctx.page as MockPage).__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    expect(texts).toContain("Hello");
    expect(texts).toContain("World");
  });

  it("positions cells at correct x offsets per column widths", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    // Column widths: 100 + 200.
    const t = makeTable([row([cell([para("L")]), cell([para("R")])])], [100, 200]);
    layoutTable(t, ctx, pdf, makeDeps());
    const drawText = (ctx.page as MockPage).__calls.filter((c) => c.op === "drawText");
    const lCall = drawText.find((c) => c.op === "drawText" && c.text === "L");
    const rCall = drawText.find((c) => c.op === "drawText" && c.text === "R");
    if (lCall?.op !== "drawText" || rCall?.op !== "drawText") {
      throw new Error("expected both calls");
    }
    // Right cell starts at column.x + first-col-width + cell padding.
    const rExpected = 72 + 100 + 4;
    expect(rCall.x).toBeCloseTo(rExpected, 0);
    // Left cell starts at column.x + cell padding.
    expect(lCall.x).toBeCloseTo(72 + 4, 0);
  });
});

/* ---------- gridSpan (colspan) ---------- */

describe("layoutTable — gridSpan", () => {
  it("renders a colspan=2 cell occupying both columns' width", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const t = makeTable(
      [row([cell([para("Wide")], { gridSpan: 2 })]), row([cell([para("L")]), cell([para("R")])])],
      [100, 100],
    );
    layoutTable(t, ctx, pdf, makeDeps());
    const drawText = (ctx.page as MockPage).__calls.filter((c) => c.op === "drawText");
    const wide = drawText.find((c) => c.op === "drawText" && c.text === "Wide");
    expect(wide).toBeDefined();
    if (wide?.op !== "drawText") throw new Error("expected wide call");
    // Wide cell starts at column.x + padding.
    expect(wide.x).toBeCloseTo(72 + 4, 0);
  });
});

/* ---------- vMerge (rowspan) ---------- */

describe("layoutTable — vMerge", () => {
  it("does not draw content for vMerge=continue cells", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const t = makeTable(
      [
        row([cell([para("Top")], { vMerge: "start" }), cell([para("Right1")])]),
        row([cell([], { vMerge: "continue" }), cell([para("Right2")])]),
      ],
      [100, 100],
    );
    layoutTable(t, ctx, pdf, makeDeps());
    const texts = (ctx.page as MockPage).__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    // Top cell content drawn once.
    expect(texts.filter((t) => t === "Top").length).toBe(1);
    expect(texts).toContain("Right1");
    expect(texts).toContain("Right2");
  });

  it("suppresses top border for continue cells", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const t = makeTable(
      [row([cell([para("S")], { vMerge: "start" })]), row([cell([], { vMerge: "continue" })])],
      [100],
    );
    layoutTable(t, ctx, pdf, makeDeps());
    const lines = (ctx.page as MockPage).__calls.filter((c) => c.op === "drawLine");
    // Each cell normally has 4 borders. The continue cell should have 3
    // (top suppressed). So total: 4 + 3 = 7.
    expect(lines.length).toBe(7);
  });
});

/* ---------- multi-line cell content ---------- */

describe("layoutTable — multi-line cell content", () => {
  it("wraps long text within a narrow cell, growing the row height", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    // Narrow cell — text must wrap.
    const longText = "the quick brown fox jumps over the lazy dog the quick brown fox jumps";
    const t = makeTable([row([cell([para(longText)])])], [80]);
    const result = layoutTable(t, ctx, pdf, makeDeps());
    // The table should have measurable height > one line.
    expect(result.drawnHeight).toBeGreaterThan(20);
    // Multiple drawText calls should appear (one per word fragment).
    const drawText = (ctx.page as MockPage).__calls.filter((c) => c.op === "drawText");
    expect(drawText.length).toBeGreaterThan(5);
  });
});

/* ---------- Pagination ---------- */

describe("layoutTable — pagination", () => {
  it("returns a remainder when a row doesn't fit and at least one row was drawn", async () => {
    // Tight column: enough for 1 row, not 3.
    const ctx = makeColumnContext({ yPt: 100, minYPt: 50, maxYPt: 700 });
    const pdf = await freshDoc();
    const t = makeTable(
      [row([cell([para("R1")])]), row([cell([para("R2")])]), row([cell([para("R3")])])],
      [100],
    );
    const result = layoutTable(t, ctx, pdf, makeDeps());
    expect(result.remainder).toBeDefined();
    expect(result.remainder?.rows.length).toBeLessThan(3);
  });

  it("draws first row even when column is tight (atomic-row rule)", async () => {
    // Even with small space, the first row draws — the atomic-row rule.
    const ctx = makeColumnContext({ yPt: 80, minYPt: 50, maxYPt: 700 });
    const pdf = await freshDoc();
    const t = makeTable([row([cell([para("R1")])]), row([cell([para("R2")])])], [100]);
    const result = layoutTable(t, ctx, pdf, makeDeps());
    const texts = (ctx.page as MockPage).__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    expect(texts).toContain("R1");
    // R2 must not have been drawn (it's in remainder).
    if (result.remainder !== undefined) {
      expect(texts).not.toContain("R2");
    }
  });
});

/* ---------- Defaults / edge cases ---------- */

describe("layoutTable — defaults", () => {
  it("falls back to equal column widths when columnWidthsPt is empty", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const t = makeTable([row([cell([para("A")]), cell([para("B")])])], []);
    const result = layoutTable(t, ctx, pdf, makeDeps());
    expect(result.remainder).toBeUndefined();
    const drawText = (ctx.page as MockPage).__calls.filter((c) => c.op === "drawText");
    expect(drawText.find((c) => c.op === "drawText" && c.text === "A")).toBeDefined();
    expect(drawText.find((c) => c.op === "drawText" && c.text === "B")).toBeDefined();
  });

  it("handles a single-cell single-row table", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const t = makeTable([row([cell([para("Solo")])])], [200]);
    const result = layoutTable(t, ctx, pdf, makeDeps());
    expect(result.remainder).toBeUndefined();
    expect(result.drawnHeight).toBeGreaterThan(0);
  });

  it("does not double-attach hyperlink annotations from cell content", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    ctx.relationships = new Map([
      [
        "rId1",
        {
          id: "rId1",
          type: "hyperlink" as const,
          target: "https://example.com",
          targetMode: "External" as const,
        },
      ],
    ]);
    const pdf = await freshDoc();
    const linkPara: Paragraph = {
      kind: "paragraph",
      alignment: "left",
      runs: [makeRun("link", { hyperlinkRel: "rId1" })],
    };
    const t = makeTable([row([cell([linkPara])])], [200]);
    layoutTable(t, ctx, pdf, makeDeps());
    // The measure pass uses a discard page; the real draw pass uses
    // the parent ctx's page. Only the latter records annotations.
    expect((ctx.page as MockPage).__annotations.length).toBe(1);
  });

  it("handles a row containing a paragraph and a nested table", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const nested = makeTable([row([cell([para("nested")])])], [60]);
    const t = makeTable([row([cell([para("p1"), nested])])], [200]);
    const result = layoutTable(t, ctx, pdf, makeDeps());
    expect(result.remainder).toBeUndefined();
    const texts = (ctx.page as MockPage).__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    expect(texts).toContain("p1");
    expect(texts).toContain("nested");
  });
});
