/**
 * Per-column y-cursor state machine.
 *
 * pdf-lib uses a bottom-left origin with Y increasing upward. We draw
 * documents top-to-bottom across the page, so the y-cursor *decreases*
 * each time a block is laid out. A block overflows the column when its
 * bottom edge would lie below `minYPt`.
 *
 * These helpers are intentionally pure-state-mutators on `ColumnContext`
 * — they do NOT call `page.drawText` / `drawLine` / etc. Drawing is the
 * caller's job (paragraph.ts, runs.ts, images.ts). This separation lets
 * us unit-test the cursor logic without standing up a `PDFDocument`.
 *
 * Page-vs-column distinction:
 *   - `pageBreak(ctx, pdfDoc)` adds a fresh page and reseats `ctx.page`.
 *     Called when the document needs to start a new page (forced break
 *     via `<w:br w:type="page"/>`, single-column overflow, or end of the
 *     last column on a multi-column page).
 *   - `resetForColumn(ctx, column)` keeps the existing page but moves the
 *     cursor into a different column geometry. Used by Task 9's
 *     multi-column layout when the current column fills before the page
 *     does.
 */

import type { PDFDocument } from "pdf-lib";
import type { ColumnContext, ColumnGeometry, PageGeometry, Pt } from "./types";

/** True iff drawing a `height`-tall block at the current `yPt` would push
 *  past `minYPt`. Inclusive at the bottom edge: a block whose bottom lands
 *  exactly on `minYPt` does NOT overflow. */
export function wouldOverflow(ctx: ColumnContext, height: Pt): boolean {
  return ctx.yPt - height < ctx.minYPt - EPSILON;
}

/** Advance the y-cursor downward by `height` (i.e., `yPt -= height`).
 *  Mutates in place. Caller is responsible for any actual `drawText`/etc. */
export function markBlockDrawn(ctx: ColumnContext, height: Pt): void {
  ctx.yPt -= height;
}

/**
 * Add a fresh page to `pdfDoc` matching the current section's page size
 * and reseat `ctx.page` and `ctx.yPt` to the new page's top.
 *
 * Column geometry is preserved (single-column callers get the same
 * left-edge/width back; multi-column callers reset to col 0 themselves
 * via `resetForColumn` after the break).
 *
 * Returns the new page so the caller can wire any per-page setup
 * (header/footer drawing in Task 10).
 */
export function pageBreak(ctx: ColumnContext, pdfDoc: PDFDocument) {
  const { widthPt, heightPt } = ctx.pageGeometry;
  const newPage = pdfDoc.addPage([widthPt, heightPt]);
  ctx.page = newPage;
  ctx.yPt = ctx.maxYPt;
  return newPage;
}

/**
 * Reset the cursor for a new column on the *same* page. Used by Task 9's
 * multi-column flow when col N+1 begins after col N has been filled.
 * Keeps `ctx.page`, `ctx.pageGeometry`, `ctx.maxYPt`, and `ctx.minYPt`;
 * swaps `ctx.column` and snaps `yPt` back to the column top.
 */
export function resetForColumn(ctx: ColumnContext, column: ColumnGeometry): void {
  ctx.column = column;
  ctx.yPt = ctx.maxYPt;
}

/**
 * Convenience: build the standard `(maxYPt, minYPt)` pair from a
 * `PageGeometry`. The column body sits between the top margin and the
 * bottom margin.
 */
export function bodyYBounds(geo: PageGeometry): { maxYPt: Pt; minYPt: Pt } {
  return {
    maxYPt: geo.heightPt - geo.marginTopPt,
    minYPt: geo.marginBottomPt,
  };
}

/** Floating-point slack for the overflow predicate. pdf-lib widths and
 *  heights are computed in floating point; a sub-point underflow shouldn't
 *  trigger a spurious page break. */
const EPSILON = 1e-6;
