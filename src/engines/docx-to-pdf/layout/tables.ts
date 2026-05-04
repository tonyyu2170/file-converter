/**
 * Table layout: rectangular grid with cell wrap, gridSpan, and vMerge.
 *
 * Rendering model:
 *
 *   - Each `Table.rows[i].cells[j]` is laid out into a rectangular cell
 *     box positioned by summing column widths.
 *   - `gridSpan` (colspan) widens a cell to span N columns starting at
 *     the current grid position.
 *   - `vMerge` (rowspan) is OOXML's vertical-merge model:
 *       - `"start"` cells begin a vertical merge; their content is laid
 *         out in this row, but the cell visually extends down through any
 *         subsequent rows whose same-column-position cell is `"continue"`.
 *       - `"continue"` cells consume their column slot but draw no content
 *         and no top border (the start cell extends through them).
 *       - `"none"` is a normal cell.
 *
 * Cell content:
 *
 *   - Cells contain a `ParsedBlock[]`. Each block dispatches via
 *     `block-dispatch.ts:layoutBlock` (paragraphs, lists, even nested
 *     tables). We synthesize a temporary `ColumnContext` per cell —
 *     same `ctx.page`, `ctx.fonts`, etc., but a smaller column rect that
 *     matches the cell's interior. The cell's measured height is the
 *     vertical distance the block's draws consumed.
 *   - Borders: 0.5pt hairlines around every cell, drawn AFTER content.
 *     TODO(v1.1): honor `<w:tblBorders>` styles. Suppression for vMerge
 *     "continue" cells: we suppress the top border so the merged cell
 *     reads as one tall box.
 *
 * Pagination:
 *
 *   - Row-atomic split: a row is the splittable unit. If a row doesn't
 *     fit in the current column, return a remainder containing that row
 *     and all later rows. Caller (orchestrator) page-breaks and re-invokes.
 *   - Edge case: a row taller than a full page. We still draw it on the
 *     fresh page (atomic-row rule) and accept it spilling past the column
 *     bottom. v1 trade-off; document a TODO for clipping.
 *   - Cell content overflow inside a row: we lay out the cell's blocks
 *     into a deep "scratch" column with effectively-infinite height.
 *     Block remainders inside a cell are treated as cell content that
 *     "continues" within the same cell box (we just measure total height
 *     and the row gets sized to fit). If a cell's draw-pass nonetheless
 *     produces a remainder (rare — measure and draw use the same
 *     primitives, so the only escape hatch is content blowing past one
 *     page), the remainder is clipped and a warning is pushed to
 *     `deps.warnings` so the orchestrator can surface it to the user.
 */

import type {
  ParsedBlock,
  Table,
  TableCell,
  TableRow,
} from "@/engines/_shared/docx/docx-parser/types";
import type { PDFDocument } from "pdf-lib";
import { rgb } from "pdf-lib";
// Namespace import so tests can `vi.spyOn(blockDispatch, "layoutBlock")`.
// ESM import-bindings are read-only when imported by name, so the named
// form would prevent test-time interception of the dispatch boundary
// without polluting production code with a DI seam.
import * as blockDispatch from "./block-dispatch";
import type { LayoutDeps } from "./block-dispatch";
import { cloneListState } from "./block-dispatch";
import { makeDiscardPage } from "./discard-page";
import type { ColumnContext, ColumnGeometry, Pt } from "./types";
import { wouldOverflow } from "./y-cursor";

/** Hairline border thickness for cells. */
const BORDER_THICKNESS_PT: Pt = 0.5;
/** Padding inside each cell (top/bottom/left/right). */
const CELL_PADDING_PT: Pt = 4;
/** Effectively-infinite column height for measuring cell content. */
const SCRATCH_HEIGHT_PT: Pt = 1_000_000;

export type LayoutTableResult = {
  drawnHeight: Pt;
  /** Set when the table couldn't finish in the current column — caller
   *  page-breaks and re-invokes with the remainder. The remainder is a
   *  proper `Table` block so it can re-enter `layoutBlock` cleanly. */
  remainder?: Table;
};

/**
 * Lay out the table at `ctx.yPt`. Returns the height drawn plus a
 * remainder if some rows didn't fit. Mutates `ctx.yPt` to advance past
 * the drawn rows.
 */
export function layoutTable(
  table: Table,
  ctx: ColumnContext,
  pdfDoc: PDFDocument,
  deps: LayoutDeps,
): LayoutTableResult {
  const startYPt = ctx.yPt;

  // Resolve column widths. If the parser gave us widths, use them; else
  // distribute the column width equally across the row's cell count.
  const colWidths = resolveColumnWidths(table, ctx);

  // Track each rendered row so the post-loop border pass can draw one
  // hairline per row/column boundary instead of four per cell. Earlier
  // versions kept an `activeMerges` Map here and drew borders inline,
  // which double-stroked every shared edge; v1.1's vMerge bottom-border
  // polish (TODO) will use these same row records.
  const renderedRows: { row: TableRow; topY: Pt; heightPt: Pt }[] = [];
  let remainder: Table | undefined;

  for (let r = 0; r < table.rows.length; r++) {
    const row = table.rows[r];
    if (row === undefined) continue;

    // Pre-measure the row's height (max across cell content heights).
    const rowMeasure = measureRow(row, colWidths, r, ctx, pdfDoc, deps);

    // Atomic-row pagination: if this row doesn't fit AND we've already
    // drawn at least one row, stop and emit a remainder. Borders for
    // the rows we DID render still need to be drawn (below).
    if (wouldOverflow(ctx, rowMeasure.heightPt) && r > 0) {
      remainder = { kind: "table", rows: table.rows.slice(r), columnWidthsPt: colWidths };
      break;
    }

    const rowTopY = ctx.yPt;

    // Draw the row's cell content (each cell into its sub-column).
    drawRowContent(row, r, colWidths, rowMeasure.heightPt, ctx, pdfDoc, deps);

    // Advance y-cursor past this row's height.
    ctx.yPt -= rowMeasure.heightPt;

    renderedRows.push({ row, topY: rowTopY, heightPt: rowMeasure.heightPt });
  }

  // Borders, drawn once across the whole table (one hairline per row
  // boundary, one per column boundary). vMerge "continue" cells suppress
  // their top boundary so the merged cell reads as one tall box.
  drawTableBorders(renderedRows, colWidths, ctx);

  if (remainder !== undefined) {
    return { drawnHeight: startYPt - ctx.yPt, remainder };
  }
  return { drawnHeight: startYPt - ctx.yPt };
}

/* ------------------------------------------------------------------ */
/*   Internals                                                        */
/* ------------------------------------------------------------------ */

/** Resolve final column widths. When the parser supplied per-column widths
 *  they are authoritative — the table grid is fixed at that column count,
 *  and any row whose cell `gridSpan` overflows that count is clamped at
 *  layout time (see `effectiveGridSpan`). Falls back to equal distribution
 *  using the maximum row gridSpan sum when no widths were supplied. */
function resolveColumnWidths(table: Table, ctx: ColumnContext): number[] {
  if (table.columnWidthsPt.length > 0) {
    return table.columnWidthsPt.slice();
  }
  const cellCount = Math.max(...table.rows.map((r) => sumGridSpans(r.cells)), 1);
  // Equal distribution.
  const colW = ctx.column.widthPt / cellCount;
  return Array.from({ length: cellCount }, () => colW);
}

/**
 * Effective gridSpan for a cell given its starting column and the table's
 * column count. Clamps `cell.gridSpan` to `columnCount - currentCol` so a
 * cell can never extend past the right edge of the grid (spec §10:
 * "Table with gridSpan that exceeds row width → clamp + warning").
 *
 * Pure / non-mutating: callers receive the clamped value but the
 * underlying `TableCell` (which may be shared across walks) is unchanged.
 * The warning emit is gated to a single source of truth — `measureRow`
 * (runs once per row before any draw walk) — so we don't double-warn.
 */
function effectiveGridSpan(cell: TableCell, currentCol: number, columnCount: number): number {
  const declared = Math.max(1, cell.gridSpan);
  const remaining = Math.max(1, columnCount - currentCol);
  return Math.min(declared, remaining);
}

function sumGridSpans(cells: TableCell[]): number {
  return cells.reduce((acc, c) => acc + Math.max(1, c.gridSpan), 0);
}

type RowMeasure = {
  heightPt: Pt;
  /** Per-cell measured content height (without padding). Indexed by cell
   *  position in `row.cells`. Used so drawRowContent can position blocks
   *  vertically and so vMerge "start" cells size correctly later. */
  perCellHeightPt: Pt[];
};

/**
 * Pre-measure a row's content height by laying each cell's blocks into a
 * scratch context with effectively-infinite height. Returns the row
 * height (max across cells) plus per-cell heights for vMerge tracking.
 */
function measureRow(
  row: TableRow,
  colWidths: number[],
  rowIdx: number,
  ctx: ColumnContext,
  pdfDoc: PDFDocument,
  deps: LayoutDeps,
): RowMeasure {
  let maxContent = 0;
  const perCell: Pt[] = [];
  let colIdx = 0;
  const columnCount = colWidths.length;
  for (let c = 0; c < row.cells.length; c++) {
    const cell = row.cells[c];
    if (cell === undefined) {
      perCell.push(0);
      continue;
    }
    const declared = Math.max(1, cell.gridSpan);
    const span = effectiveGridSpan(cell, colIdx, columnCount);
    if (span < declared) {
      // Spec §10: cell whose gridSpan exceeds remaining columns is clamped
      // and the truncation surfaced as a warning. Emit here in measureRow
      // (runs first per row); drawRowContent uses the same `effectiveGridSpan`
      // helper so positioning matches without re-warning.
      deps.warnings.push(`table cell gridSpan clamped (row ${rowIdx})`);
    }
    const cellWidthPt = sliceWidth(colWidths, colIdx, span);
    if (cell.vMerge === "continue") {
      // Continue cells contribute zero own-content; the start cell's
      // height (already drawn / will be drawn) governs.
      perCell.push(0);
    } else {
      const innerHeight = measureCellContent(cell, cellWidthPt, ctx, pdfDoc, deps);
      perCell.push(innerHeight);
      if (innerHeight > maxContent) maxContent = innerHeight;
    }
    colIdx += span;
  }
  // Honor explicit row height when present, but don't shrink below content.
  const explicitH = row.heightPt ?? 0;
  // Min row height = enough for the tallest cell + top + bottom padding.
  const contentRowHeight = maxContent + 2 * CELL_PADDING_PT;
  const heightPt = Math.max(contentRowHeight, explicitH);
  return { heightPt, perCellHeightPt: perCell };
}

function sliceWidth(colWidths: number[], startIdx: number, span: number): number {
  let w = 0;
  for (let k = 0; k < span; k++) {
    const v = colWidths[startIdx + k];
    if (v !== undefined) w += v;
  }
  return w;
}

/**
 * Layout-only-measure: build a scratch ColumnContext with infinite height
 * sized to the cell's interior, walk the cell's blocks via `layoutBlock`,
 * and return the height consumed.
 */
function measureCellContent(
  cell: TableCell,
  cellWidthPt: number,
  parentCtx: ColumnContext,
  pdfDoc: PDFDocument,
  deps: LayoutDeps,
): Pt {
  const interiorWidth = Math.max(1, cellWidthPt - 2 * CELL_PADDING_PT);
  // We DO end up issuing draw calls during measure passes (because
  // layoutBlock draws immediately). To avoid double-drawing, we measure
  // into a no-op discard page (see `./discard-page.ts`).
  const discardPage = makeDiscardPage();
  const ctx: ColumnContext = {
    page: discardPage,
    pageGeometry: parentCtx.pageGeometry,
    column: { xPt: 0, widthPt: interiorWidth },
    yPt: SCRATCH_HEIGHT_PT,
    maxYPt: SCRATCH_HEIGHT_PT,
    minYPt: -SCRATCH_HEIGHT_PT,
    fonts: parentCtx.fonts,
    ...(parentCtx.relationships !== undefined && { relationships: parentCtx.relationships }),
    ...(parentCtx.bookmarks !== undefined && { bookmarks: parentCtx.bookmarks }),
    ...(parentCtx.warnings !== undefined && { warnings: parentCtx.warnings }),
  };
  // Phase 13 F5: clone listState for the measure pass. A list paragraph
  // inside a cell would otherwise bump the global counter twice (once
  // here in measure, once during the real draw), pathological for cells
  // containing lists. Other fields (warnings, bookmarks, embeddedImages,
  // numbering, relationships) intentionally stay shared via the real
  // `deps` reference — those side effects ARE real and should propagate.
  const measureDeps: LayoutDeps = {
    ...deps,
    listState: cloneListState(deps.listState),
  };
  const startY = ctx.yPt;
  let pending: ParsedBlock[] = cell.blocks.slice();
  let safety = 100;
  while (pending.length > 0 && safety > 0) {
    const block = pending.shift();
    if (block === undefined) break;
    const result = blockDispatch.layoutBlock(block, ctx, pdfDoc, measureDeps);
    if (result.remainder !== undefined) {
      pending = [result.remainder, ...pending];
    }
    safety -= 1;
  }
  return startY - ctx.yPt;
}

/**
 * Draw a row's cells (each into its own sub-column). Real draw — uses
 * the parent ctx's page. Each cell's content is anchored at the row's
 * top inset, with the row sized to `rowHeightPt`.
 *
 * vMerge "continue" cells consume their column slot but draw no content
 * (the "start" cell upstream already drew). v1's vMerge support stops
 * there: the start cell only spans the visual height of its own row,
 * and the continue cells get suppressed top borders so the merged box
 * reads cleanly. Properly extending the start cell's height across
 * its merge run is a v1.1 polish.
 */
function drawRowContent(
  row: TableRow,
  rowIdx: number,
  colWidths: number[],
  rowHeightPt: Pt,
  parentCtx: ColumnContext,
  pdfDoc: PDFDocument,
  deps: LayoutDeps,
): void {
  let colIdx = 0;
  const rowTopY = parentCtx.yPt;
  const columnCount = colWidths.length;
  for (let c = 0; c < row.cells.length; c++) {
    const cell = row.cells[c];
    if (cell === undefined) continue;
    // Same clamp as `measureRow` — keeps positioning consistent. The
    // warning was already emitted there if a clamp fired.
    const span = effectiveGridSpan(cell, colIdx, columnCount);
    const cellWidthPt = sliceWidth(colWidths, colIdx, span);
    const cellLeftX = parentCtx.column.xPt + sliceLeftOffset(colWidths, colIdx);

    if (cell.vMerge === "continue") {
      // Don't draw content; the start cell handled it. Just consume the slot.
      colIdx += span;
      continue;
    }

    // Synthesize a per-cell column context.
    const innerCol: ColumnGeometry = {
      xPt: cellLeftX + CELL_PADDING_PT,
      widthPt: Math.max(1, cellWidthPt - 2 * CELL_PADDING_PT),
    };
    const cellCtx: ColumnContext = {
      page: parentCtx.page,
      pageGeometry: parentCtx.pageGeometry,
      column: innerCol,
      yPt: rowTopY - CELL_PADDING_PT,
      // Allow cell content to draw within the row box; our measure pass
      // already sized the row to fit. Use a generous minYPt to avoid
      // spurious overflows from small floating-point slop.
      maxYPt: rowTopY - CELL_PADDING_PT,
      minYPt: rowTopY - rowHeightPt + CELL_PADDING_PT - 1, // slack
      fonts: parentCtx.fonts,
      ...(parentCtx.relationships !== undefined && {
        relationships: parentCtx.relationships,
      }),
      ...(parentCtx.bookmarks !== undefined && { bookmarks: parentCtx.bookmarks }),
      ...(parentCtx.warnings !== undefined && { warnings: parentCtx.warnings }),
    };
    const pending: ParsedBlock[] = cell.blocks.slice();
    let safety = 100;
    while (pending.length > 0 && safety > 0) {
      const block = pending.shift();
      if (block === undefined) break;
      const result = blockDispatch.layoutBlock(block, cellCtx, pdfDoc, deps);
      if (result.remainder !== undefined) {
        // Cell content overflowed its measured height. The remainder
        // is silently discarded (v1 doesn't reflow into adjacent rows
        // or page-break inside a cell). Surface a structured warning so
        // the orchestrator can merge it into ParsedDocx.warnings.
        deps.warnings.push(`table cell content clipped (row ${rowIdx}, col ${colIdx})`);
        break;
      }
      safety -= 1;
    }

    colIdx += span;
  }
}

/** Compute the X offset (within the column) for the column slot at `idx`. */
function sliceLeftOffset(colWidths: number[], idx: number): number {
  let off = 0;
  for (let k = 0; k < idx; k++) {
    const v = colWidths[k];
    if (v !== undefined) off += v;
  }
  return off;
}

/**
 * Draw the table's borders as a deduped grid: one hairline per row
 * boundary (horizontal) and one per column boundary (vertical), instead
 * of four borders per cell. This eliminates the double-stroking that
 * used to happen at every shared edge of the per-cell border pass.
 *
 * Boundary rules:
 *
 *   - Outer top, bottom, left, right edges always draw across the full
 *     extent of rendered rows / total grid width.
 *   - Internal horizontal between row r-1 and r: walk row r's cells and
 *     emit one segment per cell whose `vMerge !== "continue"`. A
 *     "continue" cell suppresses its top boundary so the merged cell
 *     reads as one tall box.
 *   - Internal vertical at column boundary c: per row, skip the segment
 *     if a cell at that row spans across c (i.e., a `gridSpan > 1` cell
 *     consumed both sides of the boundary — we don't draw a vertical
 *     line through the middle of a colspan cell).
 *
 * Coordinates:
 *
 *   - All horizontal boundaries lie at the topY of some row (or the
 *     bottom of the last row).
 *   - All vertical boundaries lie at `column.xPt + cumulative-col-width`.
 */
function drawTableBorders(
  renderedRows: { row: TableRow; topY: Pt; heightPt: Pt }[],
  colWidths: number[],
  parentCtx: ColumnContext,
): void {
  if (renderedRows.length === 0) return;

  const tableLeftX = parentCtx.column.xPt;
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);
  const tableRightX = tableLeftX + totalWidth;
  const firstRow = renderedRows[0];
  if (firstRow === undefined) return;
  const tableTopY = firstRow.topY;
  const lastRow = renderedRows[renderedRows.length - 1];
  if (lastRow === undefined) return;
  const tableBottomY = lastRow.topY - lastRow.heightPt;

  // Horizontal boundaries.
  // Top edge of the table: always full-width.
  drawHairline(parentCtx, tableLeftX, tableTopY, tableRightX, tableTopY);

  // Internal horizontal boundaries between rows: one per row r >= 1,
  // segmented by columns and suppressed for vMerge="continue" cells.
  for (let r = 1; r < renderedRows.length; r++) {
    const entry = renderedRows[r];
    if (entry === undefined) continue;
    drawHorizontalRowBoundary(parentCtx, entry.row, colWidths, tableLeftX, entry.topY);
  }

  // Bottom edge of the table: always full-width.
  drawHairline(parentCtx, tableLeftX, tableBottomY, tableRightX, tableBottomY);

  // Vertical boundaries.
  // Outer left + right edges: span the entire rendered table height.
  drawHairline(parentCtx, tableLeftX, tableTopY, tableLeftX, tableBottomY);
  drawHairline(parentCtx, tableRightX, tableTopY, tableRightX, tableBottomY);

  // Internal vertical boundaries: for each column boundary c
  // (1..colWidths.length-1), draw one segment per rendered row UNLESS
  // a cell in that row spans across the boundary (gridSpan covers it).
  let xCursor = tableLeftX;
  for (let c = 0; c < colWidths.length - 1; c++) {
    const w = colWidths[c];
    if (w === undefined) continue;
    xCursor += w;
    const boundaryColIdx = c + 1; // 1-based column-boundary index
    for (const entry of renderedRows) {
      if (rowSpansColumnBoundary(entry.row, boundaryColIdx, colWidths.length)) continue;
      drawHairline(parentCtx, xCursor, entry.topY, xCursor, entry.topY - entry.heightPt);
    }
  }
}

/** Draw the horizontal boundary above row `row` whose top sits at
 *  `rowTopY`. Segmented by columns; segments under a "continue" cell
 *  are suppressed (the merged start cell extends through them). */
function drawHorizontalRowBoundary(
  parentCtx: ColumnContext,
  row: TableRow,
  colWidths: number[],
  tableLeftX: Pt,
  rowTopY: Pt,
): void {
  let colIdx = 0;
  const columnCount = colWidths.length;
  for (let c = 0; c < row.cells.length; c++) {
    const cell = row.cells[c];
    if (cell === undefined) continue;
    const span = effectiveGridSpan(cell, colIdx, columnCount);
    const segWidth = sliceWidth(colWidths, colIdx, span);
    if (cell.vMerge !== "continue") {
      const segLeftX = tableLeftX + sliceLeftOffset(colWidths, colIdx);
      drawHairline(parentCtx, segLeftX, rowTopY, segLeftX + segWidth, rowTopY);
    }
    colIdx += span;
  }
}

/** True iff some cell in `row` spans across the column boundary at
 *  `boundaryColIdx` (i.e., its gridSpan covers both sides). */
function rowSpansColumnBoundary(
  row: TableRow,
  boundaryColIdx: number,
  columnCount: number,
): boolean {
  let colIdx = 0;
  for (let c = 0; c < row.cells.length; c++) {
    const cell = row.cells[c];
    if (cell === undefined) continue;
    const span = effectiveGridSpan(cell, colIdx, columnCount);
    // Cell occupies columns [colIdx, colIdx + span). The boundary at
    // boundaryColIdx sits between columns boundaryColIdx-1 and
    // boundaryColIdx. The cell crosses the boundary iff
    // colIdx < boundaryColIdx < colIdx + span.
    if (colIdx < boundaryColIdx && boundaryColIdx < colIdx + span) return true;
    colIdx += span;
  }
  return false;
}

/** Single hairline-stroke helper. */
function drawHairline(parentCtx: ColumnContext, x1: Pt, y1: Pt, x2: Pt, y2: Pt): void {
  parentCtx.page.drawLine({
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    thickness: BORDER_THICKNESS_PT,
    color: rgb(0, 0, 0),
  });
}
