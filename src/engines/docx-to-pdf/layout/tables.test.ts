import type {
  NumberingDef,
  Paragraph,
  ParsedBlock,
  Run,
  Table,
  TableCell,
  TableRow,
} from "@/engines/_shared/docx";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { type MockPage, makeColumnContext } from "./_test-helpers";
import * as blockDispatch from "./block-dispatch";
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
    bookmarks: new Set(),
    listState: createListState(),
    warnings: [],
  };
}

async function freshDoc(): Promise<PDFDocument> {
  return PDFDocument.create();
}

/* ---------- Simple grid ---------- */

describe("layoutTable — rectangular grid", () => {
  it("draws a 2x2 table with deduped grid borders (no double strokes)", async () => {
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
    // Deduped border model:
    //   horizontals: outer top (1) + internal row-1 boundary
    //     segmented per non-continue cell (2 segments) + outer bottom
    //     (1) = 4
    //   verticals: outer left (1) + outer right (1) + internal column
    //     boundary segmented per row (2 segments, no gridSpan crosses)
    //     = 4
    // Total: 8. Earlier per-cell model emitted 16 with shared edges
    // double-stroked.
    expect(lineCalls.length).toBe(8);
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

  it("suppresses bottom border on a vMerge=start cell when next row's same column is continue (multi-column case, Phase 13 F6)", async () => {
    // 2-column table. Column 0: row 0 is "start", row 1 is "continue"
    // (visually merged). Column 1: both rows are normal cells.
    // The boundary between row 0 and row 1 should NOT draw a horizontal
    // hairline through the merged column-0 cell — it should only span
    // column 1's segment.
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const t = makeTable(
      [
        row([cell([para("Top")], { vMerge: "start" }), cell([para("R0c1")])]),
        row([cell([], { vMerge: "continue" }), cell([para("R1c1")])]),
      ],
      [100, 100],
    );
    layoutTable(t, ctx, pdf, makeDeps());
    const lines = (ctx.page as MockPage).__calls.filter((c) => c.op === "drawLine");
    const horizontals = lines.filter(
      (l) => l.op === "drawLine" && Math.abs(l.start.y - l.end.y) < 1e-6,
    );
    // The outer top + outer bottom are full-width hairlines at the
    // table's extremes (y = 700 and y = 700 - totalHeight). The
    // boundary between row 0 and row 1 sits strictly between them.
    // Find the unique y-values for horizontals; interior y is anything
    // not at min or max.
    const yValues = horizontals
      .map((h) => (h.op === "drawLine" ? h.start.y : 0))
      .sort((a, b) => a - b);
    const yMin = yValues[0] ?? 0;
    const yMax = yValues[yValues.length - 1] ?? 0;
    const tableLeftX = 72;
    const col0Right = tableLeftX + 100;
    const interiorHorizontals = horizontals.filter(
      (l) =>
        l.op === "drawLine" &&
        Math.abs(l.start.y - yMin) > 1e-6 &&
        Math.abs(l.start.y - yMax) > 1e-6,
    );
    // Each interior horizontal must NOT span column 0 (F6: the merged
    // start cell's bottom border is suppressed in column 0).
    for (const h of interiorHorizontals) {
      if (h.op !== "drawLine") continue;
      const overlapsCol0 = h.start.x < col0Right - 0.5 && h.end.x > tableLeftX + 0.5;
      expect(overlapsCol0).toBe(false);
    }
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
    // Deduped border model with vMerge suppression:
    //   - outer top + outer bottom = 2 horizontals
    //   - internal horizontal at row 1: row 1's only cell is "continue"
    //     → suppressed (0 segments)
    //   - outer left + outer right = 2 verticals
    //   - no internal vertical (single column)
    // Total: 4. Earlier per-cell model emitted 7 (start cell's 4 +
    // continue cell's 3 with top suppressed).
    expect(lines.length).toBe(4);
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

/* ---------- ListState measure-pass isolation (Phase 13 F5) ---------- */

describe("layoutTable — list paragraphs in cells (counter isolation)", () => {
  it("does not double-bump list counters in cells (measure-pass clones listState)", async () => {
    // Build a numbering def that exists for numId="1" ilvl=0 so
    // bumpCounter actually advances (lists.ts gates bumping on a
    // resolvable level — without a def it short-circuits to default
    // bullet without touching state).
    const numbering: Map<string, NumberingDef> = new Map([
      [
        "1",
        {
          numId: "1",
          levels: new Map([[0, { ilvl: 0, format: "decimal", text: "%1." }]]),
        },
      ],
    ]);
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const deps: LayoutDeps = {
      numbering,
      relationships: new Map(),
      bookmarks: new Set(),
      listState: createListState(),
      warnings: [],
    };
    // Two list paragraphs at numId="1", ilvl=0 inside a single cell.
    const listPara1: Paragraph = {
      kind: "paragraph",
      alignment: "left",
      runs: [makeRun("First")],
      numPr: { numId: "1", ilvl: 0 },
    };
    const listPara2: Paragraph = {
      kind: "paragraph",
      alignment: "left",
      runs: [makeRun("Second")],
      numPr: { numId: "1", ilvl: 0 },
    };
    const t = makeTable([row([cell([listPara1, listPara2])])], [200]);
    layoutTable(t, ctx, pdf, deps);
    // Post-table state: counter at (numId="1", ilvl=0) should be 2 (one
    // bump per paragraph, real-draw pass only). Pre-fix, the measure
    // pass's bumps leaked into the same listState so the counter ended
    // at 4 (2 measure + 2 draw).
    const counter = deps.listState.counters.get("1")?.get(0);
    expect(counter).toBe(2);
  });
});

/* ---------- gridSpan overflow clamp (spec §10) ---------- */

describe("layoutTable — gridSpan overflow clamp", () => {
  it("clamps a cell whose gridSpan exceeds the remaining columns and emits a warning", async () => {
    // 3-column grid (authoritative columnWidthsPt), single row whose only
    // cell declares gridSpan: 5. Spec §10: clamp + warn rather than letting
    // the cell silently expand the table.
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const deps = makeDeps();
    const t = makeTable([row([cell([para("Wide")], { gridSpan: 5 })])], [80, 80, 80]);
    layoutTable(t, ctx, pdf, deps);
    // Warning surfaced once (not double-warned by measure + draw).
    expect(deps.warnings.filter((w) => w.includes("gridSpan clamped")).length).toBe(1);
    expect(deps.warnings[0]).toMatch(/row 0/);
    // The cell should have been positioned/sized using the clamped span:
    // total table width = 240pt (3 × 80). Drawn text starts at column.x +
    // padding (72 + 4 = 76), and the cell width is 240pt. We can't
    // directly inspect the cell width without a draw, but we can verify
    // the table's outer borders span exactly 3 column widths.
    const lines = (ctx.page as MockPage).__calls.filter((c) => c.op === "drawLine");
    // Top edge should run from tableLeftX to tableLeftX + 240.
    const topEdge = lines.find(
      (l) => l.op === "drawLine" && Math.abs(l.start.y - l.end.y) < 1e-6 && l.start.y > 600,
    );
    expect(topEdge).toBeDefined();
    if (topEdge?.op === "drawLine") {
      const span = topEdge.end.x - topEdge.start.x;
      expect(span).toBeCloseTo(240, 0);
    }
  });

  it("clamps a mid-row cell whose gridSpan would push the row past columnCount", async () => {
    // Row: [span=1, span=1, span=5] in a 3-column grid → third cell clamps
    // to span=1 (3 - 2 remaining).
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const deps = makeDeps();
    const t = makeTable(
      [row([cell([para("a")]), cell([para("b")]), cell([para("c")], { gridSpan: 5 })])],
      [80, 80, 80],
    );
    layoutTable(t, ctx, pdf, deps);
    expect(deps.warnings.filter((w) => w.includes("gridSpan clamped")).length).toBe(1);
    // All three cells drew their text — the clamp didn't drop content.
    const texts = (ctx.page as MockPage).__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    expect(texts).toContain("a");
    expect(texts).toContain("b");
    expect(texts).toContain("c");
  });

  it("does not warn when gridSpan fits within the column count", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const deps = makeDeps();
    const t = makeTable(
      [row([cell([para("a")]), cell([para("b")], { gridSpan: 2 })])],
      [80, 80, 80],
    );
    layoutTable(t, ctx, pdf, deps);
    expect(deps.warnings.filter((w) => w.includes("gridSpan clamped")).length).toBe(0);
  });
});

/* ---------- Cell-clip warning ---------- */

describe("layoutTable — cell content clipping", () => {
  it("does not warn when content fits the cell", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const deps = makeDeps();
    const t = makeTable([row([cell([para("fits")])])], [200]);
    layoutTable(t, ctx, pdf, deps);
    expect(deps.warnings).toEqual([]);
  });

  it("emits a structured warning when a cell block returns a remainder", async () => {
    // measure & draw use the same primitives, so natural content can't
    // produce a draw-pass remainder. Spy on layoutBlock to inject a
    // one-shot remainder during the DRAW pass — measure runs first via
    // the discard page, draw runs second on the real page. The shared
    // counter ensures we discriminate "first draw call" without
    // touching the measure pass at all.
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const deps = makeDeps();
    const t = makeTable([row([cell([para("Top")]), cell([para("Right")])])], [200, 200]);

    const real = blockDispatch.layoutBlock;
    let drawCallsSeen = 0;
    const spy = vi.spyOn(blockDispatch, "layoutBlock").mockImplementation((block, c, p, d) => {
      // Measure pass uses a discard page (page.__calls absent on the
      // shim object). Real draw pass runs against ctx.page (a MockPage
      // with __calls). Discriminate by presence of __calls.
      const isDraw = "__calls" in (c.page as object);
      if (isDraw) {
        drawCallsSeen += 1;
        if (drawCallsSeen === 1) {
          // First draw-pass cell: synthesize a remainder so the
          // table layer's clip-warning code runs.
          return { drawnHeight: 0, remainder: block };
        }
      }
      return real(block, c, p, d);
    });

    try {
      layoutTable(t, ctx, pdf, deps);
    } finally {
      spy.mockRestore();
    }

    expect(deps.warnings.length).toBe(1);
    expect(deps.warnings[0]).toContain("table cell content clipped");
    expect(deps.warnings[0]).toMatch(/row 0/);
    expect(deps.warnings[0]).toMatch(/col 0/);
  });
});
