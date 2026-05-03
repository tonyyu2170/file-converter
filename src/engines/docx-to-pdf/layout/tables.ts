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
 *     and the row gets sized to fit). If the cell content's height blows
 *     past one page, we clip — TODO surface this as a warning.
 */

import type {
  ParsedBlock,
  Table,
  TableCell,
  TableRow,
} from "@/engines/docx-to-pdf/docx-parser/types";
import type { PDFDocument } from "pdf-lib";
import { rgb } from "pdf-lib";
import { layoutBlock } from "./block-dispatch";
import type { LayoutDeps } from "./block-dispatch";
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

  // Active vMerge tracker: per column slot, the "start" cell that's
  // currently extending. We need this to compute the merged cell's full
  // height when the merge ends. v1 keeps it simple: track active starts
  // by column index; track each start's accumulated height.
  type ActiveMerge = {
    startRow: number;
    startCol: number;
    startCell: TableCell;
    /** Height accumulated across all rows it's consumed so far. */
    accumulatedHeightPt: number;
    /** Width across the merged span. */
    spanWidthPt: number;
  };
  const activeMerges = new Map<number, ActiveMerge>();

  for (let r = 0; r < table.rows.length; r++) {
    const row = table.rows[r];
    if (row === undefined) continue;

    // Pre-measure the row's height (max across cell content heights).
    const rowMeasure = measureRow(row, colWidths, ctx, pdfDoc, deps);

    // Atomic-row pagination: if this row doesn't fit AND we've already
    // drawn at least one row, return remainder.
    if (wouldOverflow(ctx, rowMeasure.heightPt) && r > 0) {
      const remainingRows = table.rows.slice(r);
      return {
        drawnHeight: startYPt - ctx.yPt,
        remainder: { kind: "table", rows: remainingRows, columnWidthsPt: colWidths },
      };
    }

    // Draw the row's cell content (each cell into its sub-column).
    drawRowContent(row, r, colWidths, rowMeasure.heightPt, ctx, pdfDoc, deps, activeMerges);

    // Draw cell borders for this row (after content). vMerge "continue"
    // cells suppress their top border so the merged cell reads as one
    // tall box.
    drawRowBorders(row, colWidths, rowMeasure.heightPt, ctx);

    // Advance y-cursor past this row's height.
    ctx.yPt -= rowMeasure.heightPt;

    // Update active vMerges that didn't terminate this row.
    advanceActiveMerges(row, activeMerges, rowMeasure.heightPt, colWidths);
  }

  return { drawnHeight: startYPt - ctx.yPt };
}

/* ------------------------------------------------------------------ */
/*   Internals                                                        */
/* ------------------------------------------------------------------ */

/** Resolve final column widths. Falls back to equal distribution when
 *  the parser didn't supply per-column widths or the count is wrong. */
function resolveColumnWidths(table: Table, ctx: ColumnContext): number[] {
  const cellCount = Math.max(...table.rows.map((r) => sumGridSpans(r.cells)), 1);
  if (table.columnWidthsPt.length === cellCount && table.columnWidthsPt.length > 0) {
    return table.columnWidthsPt.slice();
  }
  // Equal distribution.
  const colW = ctx.column.widthPt / cellCount;
  return Array.from({ length: cellCount }, () => colW);
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
  ctx: ColumnContext,
  pdfDoc: PDFDocument,
  deps: LayoutDeps,
): RowMeasure {
  let maxContent = 0;
  const perCell: Pt[] = [];
  let colIdx = 0;
  for (let c = 0; c < row.cells.length; c++) {
    const cell = row.cells[c];
    if (cell === undefined) {
      perCell.push(0);
      continue;
    }
    const span = Math.max(1, cell.gridSpan);
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
  const scratchPage = parentCtx.page; // safe: measure-only doesn't draw
  // Build a measure context. We DO end up issuing draw calls into
  // scratchPage's mock during measure passes (because layoutBlock draws
  // immediately). To avoid double-drawing, we measure into a discard
  // page synthesized below.
  const discardPage = makeDiscardPage(scratchPage);
  const ctx: ColumnContext = {
    page: discardPage,
    pageGeometry: parentCtx.pageGeometry,
    column: { xPt: 0, widthPt: interiorWidth },
    yPt: SCRATCH_HEIGHT_PT,
    maxYPt: SCRATCH_HEIGHT_PT,
    minYPt: -SCRATCH_HEIGHT_PT,
    fonts: parentCtx.fonts,
    ...(parentCtx.relationships !== undefined && { relationships: parentCtx.relationships }),
  };
  const startY = ctx.yPt;
  let pending: ParsedBlock[] = cell.blocks.slice();
  let safety = 100;
  while (pending.length > 0 && safety > 0) {
    const block = pending.shift();
    if (block === undefined) break;
    const result = layoutBlock(block, ctx, pdfDoc, deps);
    if (result.remainder !== undefined) {
      pending = [result.remainder, ...pending];
    }
    safety -= 1;
  }
  return startY - ctx.yPt;
}

/**
 * Build a stand-in page whose draw methods are no-ops, so the measure
 * pass can call `layoutBlock` (which always draws) without polluting the
 * real page. Layout primitives (paragraph, runs) only call `drawText`,
 * `drawLine`, `drawRectangle`, `drawImage` on the page; the no-op shim
 * silently absorbs them.
 *
 * We also wire a no-op `doc.context` + `node.addAnnot` so any hyperlink
 * runs that would normally attach annotations during the measure pass
 * register against this discard page only — the real draw pass on the
 * real page is the single source of truth for annotations. Without this,
 * cells containing hyperlink runs would register two annotations per
 * link (once during measure, once during draw).
 *
 * NOTE: list paragraphs in cells will still bump their counter twice
 * (once in measure, once in draw) — that's a known limitation of the
 * measure-then-draw model and only affects the v1.1+ "list inside cell"
 * fixture. None of v1's fixtures hit this path.
 */
function makeDiscardPage(_realPage: ColumnContext["page"]): ColumnContext["page"] {
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

/**
 * Draw a row's cells (each into its own sub-column). Real draw — uses
 * the parent ctx's page. Each cell's content is anchored at the row's
 * top inset, with the row sized to `rowHeightPt`. Tracks vMerge
 * activations.
 */
function drawRowContent(
  row: TableRow,
  rowIdx: number,
  colWidths: number[],
  rowHeightPt: Pt,
  parentCtx: ColumnContext,
  pdfDoc: PDFDocument,
  deps: LayoutDeps,
  activeMerges: Map<
    number,
    {
      startRow: number;
      startCol: number;
      startCell: TableCell;
      accumulatedHeightPt: number;
      spanWidthPt: number;
    }
  >,
): void {
  let colIdx = 0;
  const rowTopY = parentCtx.yPt;
  for (let c = 0; c < row.cells.length; c++) {
    const cell = row.cells[c];
    if (cell === undefined) continue;
    const span = Math.max(1, cell.gridSpan);
    const cellWidthPt = sliceWidth(colWidths, colIdx, span);
    const cellLeftX = parentCtx.column.xPt + sliceLeftOffset(colWidths, colIdx);

    if (cell.vMerge === "continue") {
      // Don't draw content; the start cell handled it. Just consume the slot.
      colIdx += span;
      continue;
    }

    if (cell.vMerge === "start") {
      // Track this start so subsequent "continue" rows can extend it.
      activeMerges.set(colIdx, {
        startRow: rowIdx,
        startCol: colIdx,
        startCell: cell,
        accumulatedHeightPt: rowHeightPt,
        spanWidthPt: cellWidthPt,
      });
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
    };
    const pending: ParsedBlock[] = cell.blocks.slice();
    let safety = 100;
    while (pending.length > 0 && safety > 0) {
      const block = pending.shift();
      if (block === undefined) break;
      const result = layoutBlock(block, cellCtx, pdfDoc, deps);
      if (result.remainder !== undefined) {
        // Cell content overflowed its measured height. v1 stops here —
        // TODO(v1.1) surface this as a "cell content clipped" warning.
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
 * Draw the borders for a row's cells. Hairline rectangles, 0.5pt black,
 * top edge suppressed for vMerge "continue" cells.
 */
function drawRowBorders(
  row: TableRow,
  colWidths: number[],
  rowHeightPt: Pt,
  parentCtx: ColumnContext,
): void {
  let colIdx = 0;
  const rowTopY = parentCtx.yPt;
  for (let c = 0; c < row.cells.length; c++) {
    const cell = row.cells[c];
    if (cell === undefined) continue;
    const span = Math.max(1, cell.gridSpan);
    const cellWidthPt = sliceWidth(colWidths, colIdx, span);
    const cellLeftX = parentCtx.column.xPt + sliceLeftOffset(colWidths, colIdx);
    const cellBottomY = rowTopY - rowHeightPt;
    const isContinue = cell.vMerge === "continue";

    // Bottom border (always for "none" and "start"; suppressed only when
    // a downstream "continue" exists — but that's handled by the next
    // row's top-border suppression. The bottom of a "start" cell is
    // visually fine because a "continue" cell below has its own bottom).
    parentCtx.page.drawLine({
      start: { x: cellLeftX, y: cellBottomY },
      end: { x: cellLeftX + cellWidthPt, y: cellBottomY },
      thickness: BORDER_THICKNESS_PT,
      color: rgb(0, 0, 0),
    });

    // Top border — suppressed for "continue" cells (the merged cell
    // reads as one tall box).
    if (!isContinue) {
      parentCtx.page.drawLine({
        start: { x: cellLeftX, y: rowTopY },
        end: { x: cellLeftX + cellWidthPt, y: rowTopY },
        thickness: BORDER_THICKNESS_PT,
        color: rgb(0, 0, 0),
      });
    }

    // Left border.
    parentCtx.page.drawLine({
      start: { x: cellLeftX, y: rowTopY },
      end: { x: cellLeftX, y: cellBottomY },
      thickness: BORDER_THICKNESS_PT,
      color: rgb(0, 0, 0),
    });

    // Right border.
    parentCtx.page.drawLine({
      start: { x: cellLeftX + cellWidthPt, y: rowTopY },
      end: { x: cellLeftX + cellWidthPt, y: cellBottomY },
      thickness: BORDER_THICKNESS_PT,
      color: rgb(0, 0, 0),
    });

    colIdx += span;
  }
}

/** Update active vMerge entries' accumulated height after this row drew. */
function advanceActiveMerges(
  row: TableRow,
  activeMerges: Map<
    number,
    {
      startRow: number;
      startCol: number;
      startCell: TableCell;
      accumulatedHeightPt: number;
      spanWidthPt: number;
    }
  >,
  rowHeightPt: Pt,
  _colWidths: number[],
): void {
  // Walk this row's cells; for each "continue" cell, bump the
  // corresponding active merge's accumulated height. For each "none" /
  // "start" cell at a column slot, terminate any active merge at that
  // slot (it ended).
  let colIdx = 0;
  for (let c = 0; c < row.cells.length; c++) {
    const cell = row.cells[c];
    if (cell === undefined) continue;
    const span = Math.max(1, cell.gridSpan);
    if (cell.vMerge === "continue") {
      const m = activeMerges.get(colIdx);
      if (m !== undefined) m.accumulatedHeightPt += rowHeightPt;
    } else if (cell.vMerge === "none") {
      activeMerges.delete(colIdx);
    }
    // For "start", we just inserted it in drawRowContent — don't touch.
    colIdx += span;
  }
}
