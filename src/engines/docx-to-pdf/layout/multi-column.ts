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
import { makeDiscardPage } from "./discard-page";
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

/** Structured warning pushed to `deps.warnings` when any of the per-loop
 *  safety counters exhaust. Surfaced through the orchestrator into
 *  `ParsedDocx.warnings` so the ResultList can communicate possible
 *  truncation to the user. */
const SAFETY_TRIPPED_WARNING =
  "multi-column: layout safety guard tripped (block iteration > MAX); output may be truncated";

// TODO(task-10): Pass 1 reuses the real pdfDoc — its discard-page shim
// absorbs draw calls but NOT pdfDoc.embedPng/embedJpg. When inline-image
// runs are wired through layoutBlock at Task 10, every image in a
// multi-column section will embed twice. Switch Pass 1 to a separate
// PDFDocument.create() *or* pre-embed images at the orchestrator level
// and pass an embedded-image map through ColumnContext (per the
// orchestrator notes in spec §3.7).
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
  /**
   * Pre-reserved height (pt) at the bottom of every page in this section
   * for the footnote area. The orchestrator (Task 10) computes this
   * estimate ahead of time and passes it through; the layout engine
   * adjusts each column's `minYPt` accordingly so body content stops
   * before the reserved band.
   *
   * Optional / defaults to 0 (no reservation). Pre-Task-10 callers omit
   * this; Task-10's orchestrator always supplies it.
   */
  footnoteReservedHeightPt?: Pt;
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
  const reserved = Math.max(0, input.footnoteReservedHeightPt ?? 0);
  const bounds = bodyYBounds(pageGeometry);
  const maxYPt = bounds.maxYPt;
  const minYPt = bounds.minYPt + reserved;
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
      // No-progress detector: same-block remainder with zero drawn
      // height on a fresh page means a retry won't help (the column is
      // already as tall as it'll ever be). Page-breaking and retrying
      // would loop forever (until the safety counter trips after
      // MAX_INNER_ITERATIONS pages), accumulating effectively-blank
      // pages along the way. Surface a truncation warning and bail.
      //
      // The `yBefore === maxYPt` clause is load-bearing: legitimate
      // primitives may return `remainder: p` when they ran out of room
      // for a sub-element (e.g., heading space-before) MID-page; in
      // those cases a fresh-page retry succeeds, so we must NOT
      // false-alarm. Only fire when we were already at top-of-page.
      if (result.remainder === block && drawnHeight <= 1e-6 && yBefore === maxYPt) {
        deps.warnings.push(SAFETY_TRIPPED_WARNING);
        break;
      }
      // Block didn't finish — page-break, push remainder, retry.
      page = pdfDoc.addPage([pageGeometry.widthPt, pageGeometry.heightPt]);
      pagesAdded += 1;
      ctx.page = page;
      ctx.yPt = maxYPt;
      anyContentOnThisPage = false;
      pending.unshift(result.remainder);
    }
  }
  if (safety <= 0 && pending.length > 0) {
    deps.warnings.push(SAFETY_TRIPPED_WARNING);
  }

  return { pagesAdded, endingCtx: ctx };
}

/* ------------------------------------------------------------------ */
/*   Balanced multi-column flow                                       */
/* ------------------------------------------------------------------ */

function layoutBalanced(input: MultiColumnInput, pdfDoc: PDFDocument): MultiColumnResult {
  const { pageGeometry, columnCount, columnGutterPt } = input;
  const reserved = Math.max(0, input.footnoteReservedHeightPt ?? 0);
  const bounds = bodyYBounds(pageGeometry);
  const maxYPt = bounds.maxYPt;
  const minYPt = bounds.minYPt + reserved;
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

    // Pass 2: real fill across N columns. The page is added lazily
    // inside `fillRealColumns` on the first successful content draw —
    // an overflow-on-first-block path therefore leaves no blank pages
    // in the PDF. Overflow becomes the next iteration's `pending`.
    const passResult = fillRealColumns(
      pending,
      columns,
      pageGeometry,
      maxYPt,
      minYPt,
      balanceTarget,
      input.fonts,
      input.deps,
      pdfDoc,
    );

    pagesAdded += passResult.pagesAddedHere;
    const pendingBefore = pending;
    pending = passResult.overflow;
    if (passResult.endingCtx !== undefined) {
      lastCtx = passResult.endingCtx;
    }

    if (passResult.unbalancedByDesign) {
      input.deps.warnings.push(
        "multi-column section unbalanced-by-design (block exceeds balance target with no clean break)",
      );
    }

    // No-progress detector: if `fillRealColumns` returned an overflow
    // whose head is the SAME object reference as the input head AND the
    // overflow length didn't shrink, the per-page draw made zero
    // progress (e.g., a layout primitive that always returns
    // `remainder === block` with zero drawn height). Continuing would
    // accumulate one effectively-blank page per outer iteration until
    // the outer safety counter trips at MAX_INNER_ITERATIONS. Break
    // here and surface a structured truncation warning instead.
    //
    // Reference equality on the head is load-bearing: a legitimate
    // splittable block that produces a `remainder` for the next page
    // returns a NEW object (e.g., paragraph slice from `index` onward),
    // so the head reference differs and we don't false-alarm.
    if (
      pending.length >= pendingBefore.length &&
      pending.length > 0 &&
      pending[0] === pendingBefore[0]
    ) {
      input.deps.warnings.push(SAFETY_TRIPPED_WARNING);
      break;
    }
  }
  if (safety <= 0 && pending.length > 0) {
    input.deps.warnings.push(SAFETY_TRIPPED_WARNING);
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
  // TODO(task-10): Pass 1 reuses the real pdfDoc — its discard-page shim
  // absorbs draw calls but NOT pdfDoc.embedPng/embedJpg. When inline-image
  // runs are wired through layoutBlock at Task 10, every image in a
  // multi-column section will embed twice. Switch Pass 1 to a separate
  // PDFDocument.create() *or* pre-embed images at the orchestrator level
  // and pass an embedded-image map through ColumnContext (per the
  // orchestrator notes in spec §3.7).
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
  if (safety <= 0 && pending.length > 0) {
    // Push to the REAL deps.warnings — scratchDeps.warnings is discarded
    // along with Pass 1's other scratch state, but a safety trip means
    // the natural-fill measurement is incomplete and the user-visible
    // output may be truncated.
    deps.warnings.push(SAFETY_TRIPPED_WARNING);
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
   *  orchestrator to know where the section ended. Undefined when no
   *  page was added (e.g., the input collapsed to leading-break-only on
   *  an already-fresh page and produced no real content). */
  endingCtx: ColumnContext | undefined;
  /** True when at least one block on this page hit the
   *  unbalanced-by-design fallback (single un-splittable block taller
   *  than the balance target with no remainder produced). */
  unbalancedByDesign: boolean;
  /** Pages added to `pdfDoc` during this call. 0 when the lazy add never
   *  fired (overflow on first block, or only-leading-break input). The
   *  outer `layoutBalanced` loop accumulates this into the final
   *  `pagesAdded` so the section's page count reflects only pages that
   *  carry content. */
  pagesAddedHere: number;
};

function fillRealColumns(
  blocks: ParsedBlock[],
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

  // Lazy-page tracking. `pdfDoc.addPage` is deferred until the first
  // `layoutBlock` call so an overflow-on-first-block path does not leave
  // a blank page in the PDF. The placeholder page is never drawn into
  // (it satisfies typing for `ColumnContext.page` until the real page
  // exists; once `ensurePageAdded` fires, all subsequent draws hit the
  // real page).
  const placeholderPage = makeDiscardPage();
  let realPage: ColumnContext["page"] | undefined;
  let pagesAddedHere = 0;
  const ensurePageAdded = (): void => {
    if (realPage === undefined) {
      realPage = pdfDoc.addPage([pageGeometry.widthPt, pageGeometry.heightPt]);
      pagesAddedHere = 1;
      ctx.page = realPage;
    }
  };

  // Build the first column's context up-front so we can return it as
  // `endingCtx` even if the very first block overflows. `page` is the
  // placeholder until `ensurePageAdded` swaps in the real page.
  const firstColGeo = columns[0];
  if (firstColGeo === undefined) {
    throw new Error("multi-column: empty column geometries");
  }
  let ctx: ColumnContext = {
    page: placeholderPage,
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
      return {
        overflow: restWithoutFlag,
        endingCtx: realPage !== undefined ? ctx : undefined,
        unbalancedByDesign,
        pagesAddedHere,
      };
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
        return {
          overflow: restWithoutFlag,
          endingCtx: realPage !== undefined ? ctx : undefined,
          unbalancedByDesign,
          pagesAddedHere,
        };
      }
      pending[0] = stripped;
      columnIdx += 1;
      const nextCol = columns[columnIdx];
      if (nextCol === undefined) break;
      ctx = {
        page: realPage ?? placeholderPage,
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
        page: realPage ?? placeholderPage,
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

    // About to draw — materialize the page if we haven't yet.
    ensurePageAdded();

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
        return {
          overflow: pending.slice(),
          endingCtx: ctx,
          unbalancedByDesign,
          pagesAddedHere,
        };
      }
      columnIdx += 1;
      const nextCol = columns[columnIdx];
      if (nextCol === undefined) break;
      ctx = {
        page: realPage ?? placeholderPage,
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
  if (safety <= 0 && pending.length > 0) {
    deps.warnings.push(SAFETY_TRIPPED_WARNING);
  }

  return {
    overflow: pending,
    endingCtx: realPage !== undefined ? ctx : undefined,
    unbalancedByDesign,
    pagesAddedHere,
  };
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
