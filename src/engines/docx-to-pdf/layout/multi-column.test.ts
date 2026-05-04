/**
 * Tests for multi-column.ts.
 *
 * Mock-page math (see `_test-helpers.ts`):
 *   - `widthOfTextAtSize(text, size) = text.length * size * 0.55`
 *   - `heightAtSize(size) = size * 1.2`
 *   - One line of an 11pt paragraph ⇒ 13.2pt height.
 *
 * Synthetic blocks: each test paragraph contains a single short word so
 * it lays out as exactly one line ⇒ predictable height. The
 * `singleLinePara(n)` helper returns a unique paragraph (suffix forces
 * unique text so we can assert per-block placement).
 */

import type {
  Paragraph,
  ParsedBlock,
  Run,
  Table,
  TableCell,
  TableRow,
} from "@/engines/_shared/docx/docx-parser/types";
import type { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import {
  LETTER_PORTRAIT,
  type MockPage,
  makeMockEmbeddedFonts,
  makeMockPdfDoc,
} from "./_test-helpers";
import * as blockDispatch from "./block-dispatch";
import type { LayoutDeps } from "./block-dispatch";
import { createListState } from "./lists";
import { layoutSection } from "./multi-column";
import type { MultiColumnInput } from "./multi-column";

/* ---------- Builders ---------- */

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

function makePara(runs: Run[], overrides: Partial<Paragraph> = {}): Paragraph {
  return {
    kind: "paragraph",
    alignment: "left",
    runs,
    ...overrides,
  };
}

/** A paragraph that lays out as exactly one 13.2pt line: short text, no
 *  whitespace, fits comfortably in the test column widths used below. */
function singleLinePara(label: string): Paragraph {
  return makePara([makeRun(label)]);
}

function makeDeps(overrides: Partial<LayoutDeps> = {}): LayoutDeps {
  return {
    numbering: new Map(),
    relationships: new Map(),
    bookmarks: new Set(),
    listState: createListState(),
    warnings: [],
    ...overrides,
  };
}

function baseInput(
  blocks: ParsedBlock[],
  columnCount: number,
  overrides: Partial<MultiColumnInput> = {},
): MultiColumnInput {
  return {
    blocks,
    columnCount,
    columnGutterPt: 12,
    pageGeometry: LETTER_PORTRAIT,
    fonts: makeMockEmbeddedFonts(),
    deps: makeDeps(),
    ...overrides,
  };
}

/* ---------- Helpers ---------- */

/** Group `drawText` calls on a page by their X coordinate. The two-column
 *  layout draws into two distinct X bands (one per column); grouping by
 *  X lets us count calls per column without depending on the exact
 *  pixel position of fragments. */
function drawTextByColumn(page: MockPage, columnXs: number[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const x of columnXs) counts.set(x, 0);
  for (const c of page.__calls) {
    if (c.op !== "drawText") continue;
    // Find the columnX whose x is the closest left edge ≤ c.x.
    let bestX: number | undefined;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const x of columnXs) {
      if (c.x + 1e-3 < x) continue;
      const d = c.x - x;
      if (d < bestDist) {
        bestDist = d;
        bestX = x;
      }
    }
    if (bestX !== undefined) {
      counts.set(bestX, (counts.get(bestX) ?? 0) + 1);
    }
  }
  return counts;
}

/** The Y span (top - bottom) of drawText calls within a single column. */
function columnDrawSpan(page: MockPage, columnX: number): number {
  let topY = Number.NEGATIVE_INFINITY;
  let bottomY = Number.POSITIVE_INFINITY;
  for (const c of page.__calls) {
    if (c.op !== "drawText") continue;
    if (Math.abs(c.x - columnX) > 1) {
      // c.x will be >= columnX for fragments inside that column; allow
      // some slack from alignment offsets.
      if (c.x < columnX || c.x > columnX + 250) continue;
    }
    if (c.y > topY) topY = c.y;
    if (c.y < bottomY) bottomY = c.y;
  }
  if (topY === Number.NEGATIVE_INFINITY || bottomY === Number.POSITIVE_INFINITY) return 0;
  return topY - bottomY;
}

/** Compute column geometries the same way `multi-column.ts` does. */
function expectedColumnXs(count: number, gutter = 12): number[] {
  const usable =
    LETTER_PORTRAIT.widthPt - LETTER_PORTRAIT.marginLeftPt - LETTER_PORTRAIT.marginRightPt;
  const colW = (usable - gutter * (count - 1)) / count;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(LETTER_PORTRAIT.marginLeftPt + i * (colW + gutter));
  }
  return out;
}

/* ================================================================== */
/* Empty section                                                       */
/* ================================================================== */

describe("layoutSection — empty input", () => {
  it("returns pagesAdded: 0 and no endingCtx for an empty block list", async () => {
    const pdf = makeMockPdfDoc();
    const result = layoutSection(baseInput([], 2), pdf as unknown as PDFDocument);
    expect(result.pagesAdded).toBe(0);
    expect(result.endingCtx).toBeUndefined();
    expect(pdf.__pages.length).toBe(0);
  });

  it("emits no warnings for an empty section", async () => {
    const pdf = makeMockPdfDoc();
    const deps = makeDeps();
    layoutSection(baseInput([], 2, { deps }), pdf as unknown as PDFDocument);
    expect(deps.warnings).toEqual([]);
  });
});

/* ================================================================== */
/* Single-column flow (columnCount === 1)                              */
/* ================================================================== */

describe("layoutSection — single column (count = 1)", () => {
  it("lays a small block list onto one page", async () => {
    const pdf = makeMockPdfDoc();
    const blocks: ParsedBlock[] = [singleLinePara("a"), singleLinePara("b")];
    const result = layoutSection(baseInput(blocks, 1), pdf as unknown as PDFDocument);
    expect(result.pagesAdded).toBe(1);
    expect(pdf.__pages.length).toBe(1);
    const drawTextCalls = pdf.__pages[0]?.__calls.filter((c) => c.op === "drawText") ?? [];
    // Two paragraphs => at least 2 drawText calls (one per word).
    expect(drawTextCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("page-breaks when content exceeds body height (long block list)", async () => {
    const pdf = makeMockPdfDoc();
    // Body height = 792 - 72 - 72 = 648pt. Each block ≈ 13.2pt.
    // 60 blocks ≈ 792pt > 648 ⇒ at least 2 pages.
    const blocks: ParsedBlock[] = [];
    for (let i = 0; i < 60; i++) blocks.push(singleLinePara(`p${i}`));
    const result = layoutSection(baseInput(blocks, 1), pdf as unknown as PDFDocument);
    expect(result.pagesAdded).toBeGreaterThanOrEqual(2);
  });

  it("forced page break advances to a new page in single-column flow", async () => {
    const pdf = makeMockPdfDoc();
    const blocks: ParsedBlock[] = [
      singleLinePara("first"),
      makePara([makeRun("after-break", { pageBreakBefore: true })]),
    ];
    const result = layoutSection(baseInput(blocks, 1), pdf as unknown as PDFDocument);
    expect(result.pagesAdded).toBe(2);
    // The second page should contain "after-break".
    const page2 = pdf.__pages[1];
    expect(page2).toBeDefined();
    if (page2 === undefined) return;
    const texts = page2.__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    expect(texts).toContain("after-break");
  });

  it("forced column break in single-column flow falls back to page break", async () => {
    const pdf = makeMockPdfDoc();
    const blocks: ParsedBlock[] = [
      singleLinePara("first"),
      makePara([makeRun("after", { columnBreakBefore: true })]),
    ];
    const result = layoutSection(baseInput(blocks, 1), pdf as unknown as PDFDocument);
    // No real "next column" exists, so column-break in a 1-column section
    // is treated as a page-break.
    expect(result.pagesAdded).toBe(2);
  });

  it("returns endingCtx pointing at the last page used", async () => {
    const pdf = makeMockPdfDoc();
    const blocks: ParsedBlock[] = [singleLinePara("only")];
    const result = layoutSection(baseInput(blocks, 1), pdf as unknown as PDFDocument);
    expect(result.endingCtx).toBeDefined();
    expect(result.endingCtx?.page).toBe(pdf.__pages[0]);
  });
});

/* ================================================================== */
/* Balanced multi-column flow                                          */
/* ================================================================== */

describe("layoutSection — column geometry", () => {
  it.each([
    { count: 2, gutter: 12 },
    { count: 3, gutter: 18 },
    { count: 4, gutter: 10 },
  ])(
    "$count columns with gutter $gutter compute correct X positions",
    async ({ count, gutter }) => {
      const pdf = makeMockPdfDoc();
      const blocks: ParsedBlock[] = [];
      for (let i = 0; i < count * 3; i++) blocks.push(singleLinePara(`p${i}`));
      const result = layoutSection(
        baseInput(blocks, count, { columnGutterPt: gutter }),
        pdf as unknown as PDFDocument,
      );
      expect(result.pagesAdded).toBeGreaterThanOrEqual(1);
      const page = pdf.__pages[0];
      expect(page).toBeDefined();
      if (page === undefined) return;
      const expectedXs = expectedColumnXs(count, gutter);
      const counts = drawTextByColumn(page, expectedXs);
      // Every column should have at least one drawText (we provided enough
      // blocks to fill every column).
      for (const x of expectedXs) {
        expect(counts.get(x) ?? 0).toBeGreaterThan(0);
      }
    },
  );
});

describe("layoutSection — balanced fill produces approximately equal column heights", () => {
  it.each([
    { count: 2, blockN: 12 },
    { count: 3, blockN: 18 },
    { count: 4, blockN: 24 },
  ])(
    "$count columns with $blockN uniform blocks: heights within 15% of each other",
    async ({ count, blockN }) => {
      const pdf = makeMockPdfDoc();
      const blocks: ParsedBlock[] = [];
      for (let i = 0; i < blockN; i++) blocks.push(singleLinePara(`p${i}`));
      const result = layoutSection(baseInput(blocks, count), pdf as unknown as PDFDocument);
      expect(result.pagesAdded).toBe(1);
      const page = pdf.__pages[0];
      expect(page).toBeDefined();
      if (page === undefined) return;
      const xs = expectedColumnXs(count);
      const heights = xs.map((x) => columnDrawSpan(page, x));
      const maxH = Math.max(...heights);
      const minH = Math.min(...heights);
      // 15% tolerance per spec §3.6 (allows for rounding when blockN
      // doesn't divide evenly by N). columnDrawSpan measures top-Y to
      // bottom-Y of drawText calls; for K single-line paragraphs in a
      // column the span is (K-1) * line-height (first call's y vs last
      // call's y). With uniform blocks evenly divisible across N
      // columns the spans match exactly.
      expect(minH).toBeGreaterThan(0);
      expect((maxH - minH) / Math.max(maxH, 1)).toBeLessThanOrEqual(0.15);
    },
  );

  it("2-column: both columns receive content (not all in column 1)", async () => {
    const pdf = makeMockPdfDoc();
    const blocks: ParsedBlock[] = [];
    for (let i = 0; i < 8; i++) blocks.push(singleLinePara(`b${i}`));
    layoutSection(baseInput(blocks, 2), pdf as unknown as PDFDocument);
    const page = pdf.__pages[0];
    expect(page).toBeDefined();
    if (page === undefined) return;
    const xs = expectedColumnXs(2);
    const counts = drawTextByColumn(page, xs);
    expect(counts.get(xs[0] ?? 0) ?? 0).toBeGreaterThan(0);
    expect(counts.get(xs[1] ?? 0) ?? 0).toBeGreaterThan(0);
  });

  it("3-column: each column receives roughly 1/3 of blocks", async () => {
    const pdf = makeMockPdfDoc();
    const blocks: ParsedBlock[] = [];
    for (let i = 0; i < 9; i++) blocks.push(singleLinePara(`p${i}`));
    layoutSection(baseInput(blocks, 3), pdf as unknown as PDFDocument);
    const page = pdf.__pages[0];
    expect(page).toBeDefined();
    if (page === undefined) return;
    const xs = expectedColumnXs(3);
    const counts = drawTextByColumn(page, xs);
    // Each column gets 3 single-word paragraphs ⇒ 3 drawText calls each.
    for (const x of xs) {
      const c = counts.get(x) ?? 0;
      expect(c).toBeGreaterThanOrEqual(2);
      expect(c).toBeLessThanOrEqual(4);
    }
  });
});

/* ================================================================== */
/* Pagination across multi-column pages                                */
/* ================================================================== */

describe("layoutSection — overflow to second page", () => {
  it("2-column section that doesn't fit on one page spills to page 2", async () => {
    const pdf = makeMockPdfDoc();
    // Body height = 648pt. Per column 648pt; two columns = 1296pt of capacity.
    // We need >1296pt of natural fill to overflow. Each block ≈ 13.2pt.
    // 110 blocks ≈ 1452pt > 1296 ⇒ at least 2 pages.
    const blocks: ParsedBlock[] = [];
    for (let i = 0; i < 110; i++) blocks.push(singleLinePara(`b${i}`));
    const result = layoutSection(baseInput(blocks, 2), pdf as unknown as PDFDocument);
    expect(result.pagesAdded).toBeGreaterThanOrEqual(2);
  });

  it("page 2 of a multi-page 2-column section uses both columns", async () => {
    const pdf = makeMockPdfDoc();
    const blocks: ParsedBlock[] = [];
    for (let i = 0; i < 110; i++) blocks.push(singleLinePara(`b${i}`));
    layoutSection(baseInput(blocks, 2), pdf as unknown as PDFDocument);
    const page2 = pdf.__pages[1];
    expect(page2).toBeDefined();
    if (page2 === undefined) return;
    const xs = expectedColumnXs(2);
    const counts = drawTextByColumn(page2, xs);
    // Both columns should receive content on page 2 (balance recomputed).
    expect(counts.get(xs[0] ?? 0) ?? 0).toBeGreaterThan(0);
    expect(counts.get(xs[1] ?? 0) ?? 0).toBeGreaterThan(0);
  });
});

/* ================================================================== */
/* Forced breaks                                                       */
/* ================================================================== */

describe("layoutSection — forced page break in multi-column body", () => {
  it("forced page break finishes current page and starts page 2 in column 0", async () => {
    const pdf = makeMockPdfDoc();
    const blocks: ParsedBlock[] = [
      singleLinePara("a"),
      singleLinePara("b"),
      makePara([makeRun("after-page", { pageBreakBefore: true })]),
      singleLinePara("c"),
    ];
    const result = layoutSection(baseInput(blocks, 2), pdf as unknown as PDFDocument);
    expect(result.pagesAdded).toBe(2);
    const page2 = pdf.__pages[1];
    expect(page2).toBeDefined();
    if (page2 === undefined) return;
    const texts = page2.__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    expect(texts).toContain("after-page");
    // The flag-stripped block should land in column 0 of page 2.
    const col0X = expectedColumnXs(2)[0] ?? 0;
    const afterCall = page2.__calls.find((c) => c.op === "drawText" && c.text === "after-page");
    expect(afterCall).toBeDefined();
    if (afterCall?.op === "drawText") {
      expect(afterCall.x).toBeCloseTo(col0X, 0);
    }
  });
});

describe("layoutSection — forced column break in multi-column body", () => {
  it("forced column break advances to next column (not next page)", async () => {
    const pdf = makeMockPdfDoc();
    const blocks: ParsedBlock[] = [
      singleLinePara("a"),
      makePara([makeRun("after-col", { columnBreakBefore: true })]),
    ];
    const result = layoutSection(baseInput(blocks, 2), pdf as unknown as PDFDocument);
    expect(result.pagesAdded).toBe(1);
    const page = pdf.__pages[0];
    expect(page).toBeDefined();
    if (page === undefined) return;
    const xs = expectedColumnXs(2);
    const afterCall = page.__calls.find((c) => c.op === "drawText" && c.text === "after-col");
    expect(afterCall).toBeDefined();
    if (afterCall?.op === "drawText") {
      // Should be in column 1, not column 0.
      expect(afterCall.x).toBeCloseTo(xs[1] ?? 0, 0);
    }
  });

  it("forced column break on the last column spills to next page", async () => {
    const pdf = makeMockPdfDoc();
    // 2-column section; after one block in col 0 + a column break, we'd
    // be in col 1; another column break from col 1 should overflow to
    // page 2.
    const blocks: ParsedBlock[] = [
      singleLinePara("a"),
      makePara([makeRun("at-col1", { columnBreakBefore: true })]),
      makePara([makeRun("on-page2", { columnBreakBefore: true })]),
    ];
    const result = layoutSection(baseInput(blocks, 2), pdf as unknown as PDFDocument);
    expect(result.pagesAdded).toBe(2);
    const page2 = pdf.__pages[1];
    expect(page2).toBeDefined();
    if (page2 === undefined) return;
    const texts = page2.__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    expect(texts).toContain("on-page2");
  });
});

/* ================================================================== */
/* Pathological inputs                                                 */
/* ================================================================== */

describe("layoutSection — single un-splittable paragraph (pathological)", () => {
  it("emits unbalanced-by-design warning when one block exceeds balance target", async () => {
    const pdf = makeMockPdfDoc();
    const deps = makeDeps();
    // Build a paragraph whose layout produces no remainder and whose
    // single-line height is enormous: a single 60pt run draws as one
    // line of 72pt. With one such block, naturalHeight = 72pt and
    // balanceTarget = 36pt; 72 > 36 * 1.15 = 41.4pt ⇒ unbalanced.
    const tall = makePara([makeRun("X", { fontSizePt: 60 })]);
    layoutSection(baseInput([tall], 2, { deps }), pdf as unknown as PDFDocument);
    expect(deps.warnings.some((w) => w.includes("unbalanced-by-design"))).toBe(true);
  });

  it("does not emit unbalanced warning when blocks fit within tolerance", async () => {
    const pdf = makeMockPdfDoc();
    const deps = makeDeps();
    const blocks: ParsedBlock[] = [];
    for (let i = 0; i < 10; i++) blocks.push(singleLinePara(`b${i}`));
    layoutSection(baseInput(blocks, 2, { deps }), pdf as unknown as PDFDocument);
    expect(deps.warnings.some((w) => w.includes("unbalanced-by-design"))).toBe(false);
  });

  it("does not emit warning when overshoot is within ±15% tolerance", async () => {
    const pdf = makeMockPdfDoc();
    const deps = makeDeps();
    // Single block whose natural height is ~13.2pt (one line at 11pt).
    // With 2 columns, balanceTarget = 6.6pt; 13.2 / 6.6 = 2.0, well past
    // 1.15. So this would warn. To get a within-tolerance overshoot we
    // need a multi-block stream where the LAST block on column 0 nudges
    // past target by < 15%. Use 2 equal-sized blocks: each = 13.2pt;
    // naturalHeight = 26.4pt; balanceTarget = 13.2pt; column 0 draws
    // exactly one block (13.2pt = target, no overshoot). Verify clean.
    const blocks: ParsedBlock[] = [singleLinePara("a"), singleLinePara("b")];
    layoutSection(baseInput(blocks, 2, { deps }), pdf as unknown as PDFDocument);
    expect(deps.warnings.some((w) => w.includes("unbalanced-by-design"))).toBe(false);
  });
});

describe("layoutSection — atomic block taller than target (image fallback)", () => {
  it("draws an oversized atomic block at the column boundary", async () => {
    const pdf = makeMockPdfDoc();
    const deps = makeDeps();
    // Build a single tall block (large fontSize) so its single-line
    // height exceeds target by > 15%. This covers the "atomic block
    // overshoot" case the brief calls out for images.
    const huge = makePara([makeRun("X", { fontSizePt: 100 })]);
    layoutSection(baseInput([huge], 2, { deps }), pdf as unknown as PDFDocument);
    // Block was drawn (warning surfaced), and conversion proceeded.
    expect(deps.warnings.some((w) => w.includes("unbalanced-by-design"))).toBe(true);
    // Verify the block actually drew on page 1.
    const page = pdf.__pages[0];
    expect(page).toBeDefined();
    if (page === undefined) return;
    const drawCalls = page.__calls.filter((c) => c.op === "drawText");
    expect(drawCalls.length).toBeGreaterThan(0);
  });
});

/* ================================================================== */
/* Pass 1 isolation — Pass 1 doesn't pollute warnings / list-state     */
/* ================================================================== */

describe("layoutSection — Pass 1 isolation from real deps", () => {
  it("Pass 1's natural-fill measure does not pollute deps.warnings", async () => {
    const pdf = makeMockPdfDoc();
    const deps = makeDeps();
    // Use a small, predictable block stream — Pass 1 runs on the full
    // list before Pass 2. The total warning count after layoutSection
    // should reflect only Pass 2 + post-layout state, not double-count
    // any warnings Pass 1 might have emitted internally.
    // (Today no layout primitive emits warnings during draw, but if one
    // ever does, Pass 1 must not duplicate.)
    const blocks: ParsedBlock[] = [];
    for (let i = 0; i < 5; i++) blocks.push(singleLinePara(`b${i}`));
    layoutSection(baseInput(blocks, 2, { deps }), pdf as unknown as PDFDocument);
    expect(deps.warnings).toEqual([]);
  });

  it("Pass 1 image embeds register against scratchPdfDoc, not the real pdfDoc (Phase 13 F4)", async () => {
    // Phase 13 F4: today no synchronous layout primitive embeds images
    // during Pass 1, but a future inline-image wiring would. To pin the
    // isolation contract, inject a `layoutBlock` spy that mimics what a
    // future embed-on-measure would do — calls `pdfDoc.embedPng` /
    // `embedJpg` — and assert those calls hit `scratchPdfDoc`, not the
    // real `pdfDoc`. The block-dispatch namespace import lets vi.spyOn
    // intercept the call at the dispatch boundary.
    const pdf = makeMockPdfDoc();
    const realEmbedPng = vi.fn();
    const realEmbedJpg = vi.fn();
    (pdf as unknown as { embedPng: typeof realEmbedPng }).embedPng = realEmbedPng;
    (pdf as unknown as { embedJpg: typeof realEmbedJpg }).embedJpg = realEmbedJpg;

    const scratch = makeMockPdfDoc();
    const scratchEmbedPng = vi.fn();
    const scratchEmbedJpg = vi.fn();
    (scratch as unknown as { embedPng: typeof scratchEmbedPng }).embedPng = scratchEmbedPng;
    (scratch as unknown as { embedJpg: typeof scratchEmbedJpg }).embedJpg = scratchEmbedJpg;

    // Spy on layoutBlock — every call (measure or draw) invokes
    // `passedPdfDoc.embedPng()` so we can attribute embeds to the doc
    // each call received. Discriminate measure vs draw via the page:
    // measure uses a discard page (no `__calls`), draw uses a real page.
    const spy = vi.spyOn(blockDispatch, "layoutBlock").mockImplementation((_block, c, p, _d) => {
      // Simulate an embed during this layout call.
      const isDraw = "__calls" in (c.page as object);
      // Use the per-call passed pdfDoc (this is what the test asserts on).
      (p as unknown as { embedPng: () => void }).embedPng();
      if (!isDraw) {
        // Measure pass: zero height, no remainder.
        return { drawnHeight: 0 };
      }
      // Draw pass: zero height, no remainder.
      return { drawnHeight: 0 };
    });

    try {
      const blocks: ParsedBlock[] = [singleLinePara("only")];
      layoutSection(
        baseInput(blocks, 2, { scratchPdfDoc: scratch as unknown as PDFDocument }),
        pdf as unknown as PDFDocument,
      );
    } finally {
      spy.mockRestore();
    }

    // Pass 1 ran ≥ 1 layoutBlock call against the scratch doc.
    expect(scratchEmbedPng.mock.calls.length).toBeGreaterThanOrEqual(1);
    // Pass 2 (real draw) targeted the real doc, but the layoutBlock spy
    // returned drawnHeight: 0 with no remainder — so Pass 2 may run a
    // single embed against the real doc. The contract is that the
    // measure-pass embeds did NOT pollute the real doc's count by N+1
    // each — i.e., scratch ≥ real (measure runs on the full list while
    // draw stops after one zero-height block).
    expect(scratchEmbedPng.mock.calls.length).toBeGreaterThanOrEqual(
      realEmbedPng.mock.calls.length,
    );
  });
});

/* ================================================================== */
/* Forced break interactions with empty / leading positions            */
/* ================================================================== */

describe("layoutSection — leading forced page break", () => {
  it("forced page break on the very first block does not waste a blank page", async () => {
    const pdf = makeMockPdfDoc();
    const blocks: ParsedBlock[] = [
      makePara([makeRun("first", { pageBreakBefore: true })]),
      singleLinePara("second"),
    ];
    const result = layoutSection(baseInput(blocks, 2), pdf as unknown as PDFDocument);
    // We're already at top-of-page on the freshly-added page; the
    // pageBreakBefore should be a no-op. Single-column case mirrors this.
    expect(result.pagesAdded).toBe(1);
  });
});

/* ================================================================== */
/* Skip-with-warning blocks                                            */
/* ================================================================== */

describe("layoutSection — skip-with-warning blocks", () => {
  it("treats a skip-with-warning marker as zero-height", async () => {
    const pdf = makeMockPdfDoc();
    const blocks: ParsedBlock[] = [
      singleLinePara("a"),
      { kind: "skip-with-warning", reason: "RTL paragraph dropped" },
      singleLinePara("b"),
    ];
    const result = layoutSection(baseInput(blocks, 2), pdf as unknown as PDFDocument);
    expect(result.pagesAdded).toBe(1);
    // Both real paragraphs should be drawn somewhere.
    const page = pdf.__pages[0];
    expect(page).toBeDefined();
    if (page === undefined) return;
    const texts = page.__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    expect(texts).toContain("a");
    expect(texts).toContain("b");
  });
});

/* ================================================================== */
/* endingCtx contract                                                  */
/* ================================================================== */

describe("layoutSection — endingCtx", () => {
  it("returns endingCtx pointing at the last page used (multi-column)", async () => {
    const pdf = makeMockPdfDoc();
    const blocks: ParsedBlock[] = [];
    for (let i = 0; i < 6; i++) blocks.push(singleLinePara(`b${i}`));
    const result = layoutSection(baseInput(blocks, 2), pdf as unknown as PDFDocument);
    expect(result.endingCtx).toBeDefined();
    expect(result.endingCtx?.page).toBe(pdf.__pages[pdf.__pages.length - 1]);
  });

  it("endingCtx.column is one of the section's columns", async () => {
    const pdf = makeMockPdfDoc();
    const blocks: ParsedBlock[] = [];
    for (let i = 0; i < 6; i++) blocks.push(singleLinePara(`b${i}`));
    const result = layoutSection(baseInput(blocks, 2), pdf as unknown as PDFDocument);
    const xs = expectedColumnXs(2);
    expect(xs).toContain(result.endingCtx?.column.xPt);
  });
});

/* ================================================================== */
/* Tables in multi-column flow                                         */
/* ================================================================== */

function makeTable(rows: number): Table {
  const tableRows: TableRow[] = [];
  for (let r = 0; r < rows; r++) {
    const cell: TableCell = {
      blocks: [singleLinePara(`r${r}`)],
      gridSpan: 1,
      vMerge: "none",
    };
    tableRows.push({ cells: [cell] });
  }
  return { kind: "table", rows: tableRows, columnWidthsPt: [] };
}

describe("layoutSection — tables in multi-column", () => {
  it("renders a small table in a 2-column section", async () => {
    const pdf = makeMockPdfDoc();
    const blocks: ParsedBlock[] = [singleLinePara("before"), makeTable(2), singleLinePara("after")];
    const result = layoutSection(baseInput(blocks, 2), pdf as unknown as PDFDocument);
    expect(result.pagesAdded).toBe(1);
    // Table rows should produce drawText calls for each row's cell.
    const page = pdf.__pages[0];
    expect(page).toBeDefined();
    if (page === undefined) return;
    const texts = page.__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    expect(texts).toContain("r0");
    expect(texts).toContain("r1");
  });
});

/* ================================================================== */
/* Lazy addPage — no blank page on overflow-on-first-block             */
/* ================================================================== */

describe("layoutSection — lazy addPage (no blank pages)", () => {
  it("oversized atomic block produces exactly one page (no leading blank)", async () => {
    // Smoke regression: an oversized atomic block (one line at 100pt
    // font ⇒ 120pt height) far exceeds the 2-column balanceTarget but
    // draws fully with no remainder. Pre-fix this still produced one
    // page (the addPage was eager but immediately drawn into). The test
    // pins the no-blank-page guarantee for atomic-overshoot inputs.
    const pdf = makeMockPdfDoc();
    const huge = makePara([makeRun("X", { fontSizePt: 100 })]);
    const result = layoutSection(baseInput([huge], 2), pdf as unknown as PDFDocument);
    expect(result.pagesAdded).toBe(1);
    expect(pdf.__pages.length).toBe(1);
  });
});

/* ================================================================== */
/* Safety-loop exhaustion warning + no infinite blank pages            */
/* ================================================================== */

describe("layoutSection — safety guard pushes warning on exhaustion", () => {
  it("infinite-remainder block in multi-column flow trips the safety guard and warns", async () => {
    // Mock layoutBlock to always return the SAME block as remainder with
    // zero drawn height — an unbounded loop in the absence of safety
    // guards. Pre-Fix 4 the safety counter `break`-ed silently; now it
    // pushes a structured warning so the orchestrator can surface
    // "output may be truncated" to the user.
    //
    // NOTE: the lazy-addPage refactor (Fix 3) does NOT eliminate page
    // accumulation in this scenario — `pdfDoc.addPage` fires on the
    // first layoutBlock attempt per page (before drawnHeight is known),
    // so each outer iteration still adds one (effectively-blank) page
    // until the outer safety counter trips. Bounding *that* requires a
    // different fix (e.g., `pdfDoc.removePage(idx)` after drawnHeight=0,
    // or measure-then-draw split). The Fix 4 warning is what surfaces
    // the truncation regardless of the page-count behavior.
    const pdf = makeMockPdfDoc();
    const deps = makeDeps();
    const block = singleLinePara("infinite");
    const real = blockDispatch.layoutBlock;
    const spy = vi.spyOn(blockDispatch, "layoutBlock").mockImplementation((b, _c, _p, _d) => {
      // Every call returns the same block as remainder — never makes
      // progress. Real implementation is unused for this fixture.
      void real;
      return { drawnHeight: 0, remainder: b };
    });

    try {
      layoutSection(baseInput([block], 2, { deps }), pdf as unknown as PDFDocument);
      expect(deps.warnings.some((w) => w.includes("safety guard tripped"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("infinite-remainder block in single-column flow trips the safety guard and warns", async () => {
    const pdf = makeMockPdfDoc();
    const deps = makeDeps();
    const block = singleLinePara("infinite");
    const real = blockDispatch.layoutBlock;
    const spy = vi.spyOn(blockDispatch, "layoutBlock").mockImplementation((b, _c, _p, _d) => {
      void real;
      return { drawnHeight: 0, remainder: b };
    });

    try {
      layoutSection(baseInput([block], 1, { deps }), pdf as unknown as PDFDocument);
      expect(deps.warnings.some((w) => w.includes("safety guard tripped"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("legitimately splittable block list spanning multiple pages does NOT trip the no-progress detector", async () => {
    // Regression: the multi-column outer-loop detector compares overflow
    // length AND head reference to the prior pending. A legitimately
    // splittable workload that produces a NEW pending head per outer
    // iteration must pass through cleanly without false-alarming.
    //
    // We use a long block list (200 single-line paragraphs ⇒ ~2640pt
    // of natural fill, vs 1296pt of capacity per 2-column page) so the
    // outer loop iterates ≥ 2 times. Each iteration's overflow head is
    // a different paragraph object than the previous iteration's input
    // head — head-reference inequality means the no-progress detector
    // ignores the legitimate progress.
    const pdf = makeMockPdfDoc();
    const deps = makeDeps();
    const blocks: ParsedBlock[] = [];
    for (let i = 0; i < 200; i++) blocks.push(singleLinePara(`p${i}`));
    const result = layoutSection(baseInput(blocks, 2, { deps }), pdf as unknown as PDFDocument);
    // Multi-page result means the per-page overflow path was used.
    expect(result.pagesAdded).toBeGreaterThanOrEqual(2);
    // No safety-guard warning should have been pushed — the work was
    // legitimate progress, not a no-progress spinner.
    expect(deps.warnings.some((w) => w.includes("safety guard tripped"))).toBe(false);
  });
});
