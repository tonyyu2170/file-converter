/**
 * Multi-column section layout (balanced).
 *
 * Spec §3.6 "Column-balancing (v1)": a section with `<w:cols w:num="N"/>`
 * for `N >= 2` is rendered with content visually balanced across the N
 * columns. Algorithm is a per-page two-pass loop:
 *
 *   while blocks remain:
 *     1. Pass 1 (natural fill): lay the remaining blocks into a single
 *        very-tall virtual column on a *no-op discard page* sized to one
 *        real column's width. Record `naturalHeight` and `pass1Tail`
 *        (any blocks that didn't fit in `bodyHeight * N` — these spill
 *        to the next page even with perfect balance).
 *     2. Pass 2 (balance): compute `balanceTarget = min(naturalHeight / N,
 *        bodyHeight)` and re-fill N real columns side-by-side on the real
 *        `pdfDoc`. Switch column when the next block would overshoot the
 *        target AND the boundary is "clean" (the block hadn't been
 *        partially drawn yet — i.e., this is the first block in the
 *        current iteration of the inner loop). Atomic blocks (no
 *        remainder, taller than `balanceTarget * 1.15`) are allowed to
 *        overshoot. Pass-2 overflow into a column that's already at the
 *        page's `minYPt` becomes the new "remaining blocks" for the next
 *        page iteration.
 *     3. `pagesAdded += 1`.
 *
 * Single-column (`columnCount === 1`) bypasses balancing entirely:
 * straight `layoutBlock` walk with page-break propagation, mirroring
 * what Task 10's orchestrator would do for a 1-column section.
 *
 * Forced breaks (handled BEFORE dispatch — see "simplest implementation"
 * in the brief):
 *   - `Run.pageBreakBefore` on a block's first run: finish the current
 *     page (no further columns drawn), start a new page with N fresh
 *     columns, place the (flag-stripped) block in column 0.
 *   - `Run.columnBreakBefore`: advance to the next column inside the
 *     current page; if the current column is the last, start a new page
 *     and place the (flag-stripped) block in column 0.
 *
 * Pathological inputs:
 *   - Single un-splittable paragraph (no whitespace, no breaks) larger
 *     than `balanceTarget`: pass-2 falls back to drawing it at column 0
 *     overflowing into deeper columns; an `unbalanced-by-design` warning
 *     is appended to `deps.warnings`.
 *   - Image larger than `balanceTarget`: ±15% overshoot allowed silently;
 *     beyond that, draw at the column boundary anyway (worst case).
 *
 * Out of scope for THIS module (handled by Task 10's orchestrator):
 *   - Headers / footers (page-scoped, not column-scoped).
 *   - Footnote-area reservation in `minYPt` (page-scoped — at v1, the
 *     orchestrator reserves at the page level; multi-column does NOT
 *     reserve here).
 *
 * TODO(task-10):
 *   - Footnote-area reservation in `bodyHeight`. The current
 *     implementation uses the full body area (top margin → bottom margin)
 *     as the column height. When the orchestrator reserves a footnote
 *     area at the page level, it will need to pass an effective
 *     `minYPt` into this module — easiest done by extending
 *     `MultiColumnInput` with a `footnoteReservedHeight: Pt` knob.
 */

import type { ParsedBlock, Run } from "@/engines/docx-to-pdf/docx-parser/types";
import type { PDFDocument } from "pdf-lib";
import * as blockDispatch from "./block-dispatch";
import type { LayoutDeps } from "./block-dispatch";
import type { ColumnContext, ColumnGeometry, EmbeddedFonts, PageGeometry, Pt } from "./types";
import { bodyYBounds } from "./y-cursor";

/** ±15% overshoot tolerated for atomic blocks larger than the balance
 *  target. Beyond this, the block is drawn anyway at the column we're on
 *  — worst-case overflow rather than a silent drop. */
const OVERSHOOT_TOLERANCE = 0.15;

/** Effectively-infinite column height for the natural-fill measure pass.
 *  Mirrors the constant used in `tables.ts`'s scratch column. */
const SCRATCH_HEIGHT_PT: Pt = 1_000_000;

/** Hard cap on inner-loop iterations within `fillRealColumns` and
 *  `passOneNaturalHeight`. Blocks split into smaller remainders on each
 *  iteration; an unbounded loop would only happen if a block returned
 *  the same remainder twice. The cap is generous so that legitimate
 *  splits never trip it. */
const MAX_INNER_ITERATIONS = 10_000;

export type MultiColumnInput = {
  /** The section's body blocks. The function consumes these top-down. */
  blocks: ParsedBlock[];
  /** Number of columns. 1 ⇒ single-column flow. v1 caps at 4 (spec §1.3). */
  columnCount: number;
  /** Gutter between columns, in points. Ignored when `columnCount === 1`. */
  columnGutterPt: Pt;
  pageGeometry: PageGeometry;
  fonts: EmbeddedFonts;
  deps: LayoutDeps;
};

export type MultiColumnResult = {
  /** Pages added to `pdfDoc` during this call. The orchestrator uses this
   *  for header/footer placement. Always >= 1 for a non-empty section. */
  pagesAdded: number;
  /** Page + y-cursor at the end of the section, so the orchestrator can
   *  pick up the next section. Omitted for empty sections (no work
   *  performed). */
  endingCtx?: ColumnContext;
};

/**
 * Lay out a section's body content across `columnCount` columns with
 * balanced fill. Adds pages to `pdfDoc` as needed. See the module
 * preamble for the full algorithm.
 */
export function layoutSection(input: MultiColumnInput, pdfDoc: PDFDocument): MultiColumnResult {
  if (input.blocks.length === 0) {
    return { pagesAdded: 0 };
  }

  if (input.columnCount <= 1) {
    return layoutSingleColumn(input, pdfDoc);
  }

  return layoutBalanced(input, pdfDoc);
}

/* ------------------------------------------------------------------ */
/*   Single-column flow                                               */
/* ------------------------------------------------------------------ */

/**
 * Single-column layout: walk blocks, page-break on overflow, propagate
 * remainders. Mirrors what `tables.ts` does inside a cell, but with the
 * page-break path enabled.
 */
function layoutSingleColumn(input: MultiColumnInput, pdfDoc: PDFDocument): MultiColumnResult {
  const { pageGeometry, fonts, deps } = input;
  const { maxYPt, minYPt } = bodyYBounds(pageGeometry);
  const column: ColumnGeometry = {
    xPt: pageGeometry.marginLeftPt,
    widthPt: pageGeometry.widthPt - pageGeometry.marginLeftPt - pageGeometry.marginRightPt,
  };

  let pagesAdded = 0;
  let page = pdfDoc.addPage([pageGeometry.widthPt, pageGeometry.heightPt]);
  pagesAdded += 1;
  const ctx: ColumnContext = {
    page,
    pageGeometry,
    column,
    yPt: maxYPt,
    maxYPt,
    minYPt,
    fonts,
    ...(deps.relationships !== undefined && { relationships: deps.relationships }),
  };
  /** Per-page "any content drawn yet" flag — used to swallow leading
   *  forced breaks without emitting a blank page. Reset on every new
   *  page added. */
  let anyContentOnThisPage = false;

  const pending: ParsedBlock[] = input.blocks.slice();
  let safety = MAX_INNER_ITERATIONS;
  while (pending.length > 0 && safety > 0) {
    safety -= 1;
    const block = pending.shift();
    if (block === undefined) break;

    // Forced-break pre-scan on the block's first run. In single-column
    // flow, both `pageBreakBefore` and `columnBreakBefore` map to a
    // page break (there's no other column to break to).
    const breakKind = firstRunBreak(block);
    if (breakKind === "page" || breakKind === "column") {
      // Leading break on a fresh page → no-op (the break is already
      // honored by being on a fresh page). Otherwise add a new page.
      if (anyContentOnThisPage) {
        page = pdfDoc.addPage([pageGeometry.widthPt, pageGeometry.heightPt]);
        pagesAdded += 1;
        ctx.page = page;
        ctx.yPt = maxYPt;
        anyContentOnThisPage = false;
      }
      pending.unshift(stripFirstRunBreaks(block));
      continue;
    }

    const yBefore = ctx.yPt;
    const result = blockDispatch.layoutBlock(block, ctx, pdfDoc, deps);
    const drawnHeight = yBefore - ctx.yPt;
    if (drawnHeight > 1e-6) anyContentOnThisPage = true;
    if (result.remainder !== undefined) {
      // Block didn't finish — page-break, push remainder, retry.
      page = pdfDoc.addPage([pageGeometry.widthPt, pageGeometry.heightPt]);
      pagesAdded += 1;
      ctx.page = page;
      ctx.yPt = maxYPt;
      anyContentOnThisPage = false;
      pending.unshift(result.remainder);
    }
  }

  return { pagesAdded, endingCtx: ctx };
}

/* ------------------------------------------------------------------ */
/*   Balanced multi-column flow                                       */
/* ------------------------------------------------------------------ */

function layoutBalanced(input: MultiColumnInput, pdfDoc: PDFDocument): MultiColumnResult {
  const { pageGeometry, columnCount, columnGutterPt } = input;
  const { maxYPt, minYPt } = bodyYBounds(pageGeometry);
  const bodyHeight = maxYPt - minYPt;

  const columns = computeColumnGeometries(pageGeometry, columnCount, columnGutterPt);
  // First-column geometry seeds Pass 1's natural-fill column width.
  const firstCol = columns[0];
  if (firstCol === undefined) {
    // columnCount >= 2 was guaranteed by caller; defensive fallback.
    return layoutSingleColumn(input, pdfDoc);
  }

  let pending: ParsedBlock[] = input.blocks.slice();
  let pagesAdded = 0;
  let lastCtx: ColumnContext | undefined;

  let safety = MAX_INNER_ITERATIONS;
  while (pending.length > 0 && safety > 0) {
    safety -= 1;

    // Pass 1: measure the natural fill of the remaining blocks at column-1
    // width into a deep scratch column.
    const naturalHeight = passOneNaturalHeight(
      pending,
      firstCol.widthPt,
      pageGeometry,
      input.fonts,
      input.deps,
      pdfDoc,
    );

    // Balance target: split natural height across N columns, but cap to
    // body height so we don't try to fill past the page bottom.
    const rawTarget = naturalHeight / columnCount;
    const balanceTarget = Math.min(Math.max(rawTarget, 1), bodyHeight);

    // Pass 2: real fill across N columns. Overflow into the next page
    // becomes the next iteration's `pending`.
    const page = pdfDoc.addPage([pageGeometry.widthPt, pageGeometry.heightPt]);
    pagesAdded += 1;
    const passResult = fillRealColumns(
      pending,
      page,
      columns,
      pageGeometry,
      maxYPt,
      minYPt,
      balanceTarget,
      input.fonts,
      input.deps,
      pdfDoc,
    );

    pending = passResult.overflow;
    lastCtx = passResult.endingCtx;

    if (passResult.unbalancedByDesign) {
      input.deps.warnings.push(
        "multi-column section unbalanced-by-design (block exceeds balance target with no clean break)",
      );
    }
  }

  return { pagesAdded, ...(lastCtx !== undefined && { endingCtx: lastCtx }) };
}

/* ------------------------------------------------------------------ */
/*   Pass 1 — natural fill (measure)                                  */
/* ------------------------------------------------------------------ */

/**
 * Pass 1: lay out `blocks` into a single very-tall virtual column at the
 * real column's width, on a no-op discard page. Returns the total height
 * consumed. No real PDF content is produced.
 *
 * Forced breaks contribute zero height (they're orchestration markers,
 * not content) but the flag-stripped block following the break still
 * lays out normally.
 */
function passOneNaturalHeight(
  blocks: ParsedBlock[],
  columnWidth: Pt,
  pageGeometry: PageGeometry,
  fonts: EmbeddedFonts,
  deps: LayoutDeps,
  pdfDoc: PDFDocument,
): Pt {
  const discardPage = makeDiscardPage();
  const ctx: ColumnContext = {
    page: discardPage,
    pageGeometry,
    column: { xPt: 0, widthPt: columnWidth },
    yPt: SCRATCH_HEIGHT_PT,
    maxYPt: SCRATCH_HEIGHT_PT,
    minYPt: -SCRATCH_HEIGHT_PT,
    fonts,
    ...(deps.relationships !== undefined && { relationships: deps.relationships }),
  };
  const startY = ctx.yPt;
  // Pass 1 must NOT mutate the orchestrator's warnings / list-state. Use
  // a scratch deps so any warnings or counter bumps emitted during
  // measure don't leak into Pass 2.
  const scratchDeps: LayoutDeps = {
    numbering: deps.numbering,
    relationships: deps.relationships,
    listState: { counters: new Map(), lastLevel: new Map() },
    warnings: [],
  };

  const pending: ParsedBlock[] = blocks.slice();
  let safety = MAX_INNER_ITERATIONS;
  while (pending.length > 0 && safety > 0) {
    safety -= 1;
    const block = pending.shift();
    if (block === undefined) break;

    // Forced breaks: zero-height marker. Strip and dispatch.
    const breakKind = firstRunBreak(block);
    if (breakKind === "page" || breakKind === "column") {
      pending.unshift(stripFirstRunBreaks(block));
      continue;
    }

    const result = blockDispatch.layoutBlock(block, ctx, pdfDoc, scratchDeps);
    if (result.remainder !== undefined) {
      // Even with a deep scratch column, splittable blocks may emit a
      // remainder when their internal logic decides a clean break makes
      // sense. Just continue draining.
      pending.unshift(result.remainder);
    }
  }
  return startY - ctx.yPt;
}

/* ------------------------------------------------------------------ */
/*   Pass 2 — real fill across N columns                              */
/* ------------------------------------------------------------------ */

type PassTwoResult = {
  /** Blocks that didn't fit on this page; feed back to the per-page loop. */
  overflow: ParsedBlock[];
  /** Final column context (last column we wrote to). Used by the
   *  orchestrator to know where the section ended. */
  endingCtx: ColumnContext;
  /** True when at least one block on this page hit the
   *  unbalanced-by-design fallback (single un-splittable block taller
   *  than the balance target with no remainder produced). */
  unbalancedByDesign: boolean;
};

function fillRealColumns(
  blocks: ParsedBlock[],
  page: ColumnContext["page"],
  columns: ColumnGeometry[],
  pageGeometry: PageGeometry,
  maxYPt: Pt,
  minYPt: Pt,
  balanceTarget: Pt,
  fonts: EmbeddedFonts,
  deps: LayoutDeps,
  pdfDoc: PDFDocument,
): PassTwoResult {
  let unbalancedByDesign = false;
  const pending: ParsedBlock[] = blocks.slice();
  let columnIdx = 0;
  // Per-column starting Y (top of body). Decreases as content is drawn.
  // We track each column's startY so the balance check uses height
  // *consumed in this column* (not absolute yPt vs minYPt).
  const columnStartY = maxYPt;
  /** True once any block on this page has been drawn. Used to swallow
   *  leading forced breaks (a `pageBreakBefore` on the very first block
   *  of a fresh page is a no-op so we don't emit a spurious blank page). */
  let anyContentOnThisPage = false;

  // Build the first column's context up-front so we can return it as
  // `endingCtx` even if the very first block overflows.
  const firstColGeo = columns[0];
  if (firstColGeo === undefined) {
    throw new Error("multi-column: empty column geometries");
  }
  let ctx: ColumnContext = {
    page,
    pageGeometry,
    column: firstColGeo,
    yPt: columnStartY,
    maxYPt,
    minYPt,
    fonts,
    ...(deps.relationships !== undefined && { relationships: deps.relationships }),
  };

  let safety = MAX_INNER_ITERATIONS;
  while (pending.length > 0 && safety > 0) {
    safety -= 1;
    const block = pending[0];
    if (block === undefined) break;

    // Forced-break handling — pre-scan first run.
    const breakKind = firstRunBreak(block);
    if (breakKind === "page") {
      // Edge case: leading forced page break on a freshly-added page
      // with no content drawn yet → the break is already honored by the
      // act of being on a fresh page. Strip and dispatch normally.
      if (!anyContentOnThisPage && columnIdx === 0) {
        pending[0] = stripFirstRunBreaks(block);
        continue;
      }
      // Otherwise: end of this page. Everything from this block onward
      // becomes the overflow that feeds the next page iteration. Drop
      // the page-break flag on the block so the next page doesn't loop
      // forever.
      const restWithoutFlag = [stripFirstRunBreaks(block), ...pending.slice(1)];
      return { overflow: restWithoutFlag, endingCtx: ctx, unbalancedByDesign };
    }
    if (breakKind === "column") {
      const stripped = stripFirstRunBreaks(block);
      // Edge case: leading column break on column 0 of a fresh page
      // with no content drawn yet → no-op; just strip and continue.
      if (!anyContentOnThisPage && columnIdx === 0) {
        pending[0] = stripped;
        continue;
      }
      // Advance to next column; if we're already on the last column,
      // treat as a page break (overflow to next page).
      if (columnIdx >= columns.length - 1) {
        const restWithoutFlag = [stripped, ...pending.slice(1)];
        return { overflow: restWithoutFlag, endingCtx: ctx, unbalancedByDesign };
      }
      pending[0] = stripped;
      columnIdx += 1;
      const nextCol = columns[columnIdx];
      if (nextCol === undefined) break;
      ctx = {
        page,
        pageGeometry,
        column: nextCol,
        yPt: columnStartY,
        maxYPt,
        minYPt,
        fonts,
        ...(deps.relationships !== undefined && { relationships: deps.relationships }),
      };
      continue;
    }

    // Balance gate: if the column has already consumed at least
    // `balanceTarget`, advance to the next column BEFORE drawing this
    // block (clean boundary — this block hasn't been touched yet).
    const consumedThisColumn = columnStartY - ctx.yPt;
    const isFreshColumn = consumedThisColumn < 1e-6;
    if (consumedThisColumn >= balanceTarget && columnIdx < columns.length - 1) {
      columnIdx += 1;
      const nextCol = columns[columnIdx];
      if (nextCol === undefined) break;
      ctx = {
        page,
        pageGeometry,
        column: nextCol,
        yPt: columnStartY,
        maxYPt,
        minYPt,
        fonts,
        ...(deps.relationships !== undefined && { relationships: deps.relationships }),
      };
      continue;
    }

    const yBefore = ctx.yPt;
    const result = blockDispatch.layoutBlock(block, ctx, pdfDoc, deps);
    const drawnHeight = yBefore - ctx.yPt;

    if (result.remainder !== undefined) {
      // Splittable block produced a remainder. The current column is
      // now full (the block's natural-overflow path took us to minYPt).
      // Replace head with remainder and advance.
      pending[0] = result.remainder;
      if (drawnHeight > 1e-6) anyContentOnThisPage = true;
      if (columnIdx >= columns.length - 1) {
        // Last column on this page is full; remainder + rest spill to
        // next page.
        return { overflow: pending.slice(), endingCtx: ctx, unbalancedByDesign };
      }
      columnIdx += 1;
      const nextCol = columns[columnIdx];
      if (nextCol === undefined) break;
      ctx = {
        page,
        pageGeometry,
        column: nextCol,
        yPt: columnStartY,
        maxYPt,
        minYPt,
        fonts,
        ...(deps.relationships !== undefined && { relationships: deps.relationships }),
      };
      continue;
    }

    // Block drew fully (no remainder). Detect the atomic-overshoot case:
    // the column we just drew into is a fresh column, the block height
    // exceeded `balanceTarget * (1 + tolerance)`, and yet no remainder
    // came back — this is the unbalanced-by-design path.
    if (isFreshColumn && drawnHeight > balanceTarget * (1 + OVERSHOOT_TOLERANCE) + 1e-6) {
      unbalancedByDesign = true;
    }

    if (drawnHeight > 1e-6) {
      anyContentOnThisPage = true;
    }
    pending.shift();
  }

  return { overflow: pending, endingCtx: ctx, unbalancedByDesign };
}

/* ------------------------------------------------------------------ */
/*   Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Compute geometry for N side-by-side columns within the page's body. */
function computeColumnGeometries(
  pageGeometry: PageGeometry,
  count: number,
  gutterPt: Pt,
): ColumnGeometry[] {
  const usableWidth = pageGeometry.widthPt - pageGeometry.marginLeftPt - pageGeometry.marginRightPt;
  const totalGutter = gutterPt * Math.max(0, count - 1);
  const columnWidth = (usableWidth - totalGutter) / count;
  const out: ColumnGeometry[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      xPt: pageGeometry.marginLeftPt + i * (columnWidth + gutterPt),
      widthPt: columnWidth,
    });
  }
  return out;
}

/**
 * Inspect a block's first run for a `pageBreakBefore` or
 * `columnBreakBefore` flag. Returns the break kind, or `null` for "no
 * break / not a paragraph / no runs". Tables don't carry break flags
 * (forced breaks live on runs inside paragraphs); a table's
 * `pageBreakBefore` would be expressed by a preceding empty paragraph
 * with the flag, so we don't need to peek into rows.
 */
function firstRunBreak(block: ParsedBlock): "page" | "column" | null {
  if (block.kind !== "paragraph") return null;
  const firstRun: Run | undefined = block.runs[0];
  if (firstRun === undefined) return null;
  if (firstRun.pageBreakBefore === true) return "page";
  if (firstRun.columnBreakBefore === true) return "column";
  return null;
}

/**
 * Return a copy of the block with `pageBreakBefore` /
 * `columnBreakBefore` cleared on its first run. Mirrors the strip helper
 * used inside `paragraph.ts` (which is module-private there). Honors
 * `exactOptionalPropertyTypes` by destructuring rather than setting to
 * `undefined`.
 */
function stripFirstRunBreaks(block: ParsedBlock): ParsedBlock {
  if (block.kind !== "paragraph") return block;
  const firstRun = block.runs[0];
  if (firstRun === undefined) return block;
  // Rebuild without the break flags.
  const { pageBreakBefore: _pb, columnBreakBefore: _cb, ...rest } = firstRun;
  const newRuns: Run[] = [rest, ...block.runs.slice(1)];
  return { ...block, runs: newRuns };
}

/**
 * Build a no-op page shim that absorbs draw + annotation calls without
 * polluting any real PDF content. Mirrors `tables.ts`'s `makeDiscardPage`
 * — keep the two implementations in sync.
 *
 * The shim must absorb `drawText` / `drawLine` / `drawRectangle` /
 * `drawImage` (the layout primitives' draw vocabulary) and the pdf-lib
 * annotation API surface (`doc.context.obj`, `doc.context.register`,
 * `node.addAnnot`) so hyperlink runs encountered during the measure pass
 * don't double-register.
 */
function makeDiscardPage(): ColumnContext["page"] {
  const noopContext = {
    obj<T>(literal: T): T {
      return literal;
    },
    register<T>(_obj: T): { __discard: true } {
      return { __discard: true };
    },
  };
  const shim = {
    drawText() {},
    drawLine() {},
    drawRectangle() {},
    drawImage() {},
    getSize() {
      return { width: 612, height: 792 };
    },
    doc: { context: noopContext },
    node: { addAnnot(_ref: unknown) {} },
  };
  return shim as unknown as ColumnContext["page"];
}
