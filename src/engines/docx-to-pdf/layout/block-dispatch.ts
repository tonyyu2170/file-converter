/**
 * Single dispatch point for laying out any `ParsedBlock` shape.
 *
 * The orchestrator (Task 10) and table cells (this task) both walk a list
 * of heterogeneous blocks (paragraphs, tables, skip-with-warning markers,
 * or list-paragraphs). Centralizing the per-block call here keeps the
 * call-sites uniform and lets us add new block kinds (e.g., footnote
 * markers in Task 10) without touching every walker.
 *
 * Dispatch matrix:
 *
 *   - `paragraph` with `numPr`     → `layoutListItem` (lists.ts)
 *   - `paragraph` without `numPr`  → `layoutParagraph` (paragraph.ts)
 *   - `table`                       → `layoutTable` (tables.ts)
 *   - `skip-with-warning`           → no-op (the warning was already
 *                                    surfaced by the parser; layout draws
 *                                    nothing here)
 *
 * Inputs:
 *   - `block`     — the parsed block to render.
 *   - `ctx`       — column context (mutated as content is drawn).
 *   - `pdfDoc`    — pdf-lib document, needed for page-break and image
 *                   embedding side-channels.
 *   - `deps`      — engine-wide maps (numbering, relationships) and the
 *                   mutable list-state counter that flows across blocks.
 *
 * The return shape mirrors `layoutParagraph`: `{drawnHeight, remainder?}`.
 * `remainder` is set when a block couldn't finish in the current column
 * — callers (orchestrator, table cell walker) drive the page/column break
 * and re-invoke `layoutBlock` with the remainder.
 */

import type {
  NumberingDef,
  ParsedBlock,
  RelationshipTarget,
} from "@/engines/docx-to-pdf/docx-parser/types";
import type { PDFDocument } from "pdf-lib";
import { layoutListItem } from "./lists";
import type { ListState } from "./lists";
import { layoutParagraph } from "./paragraph";
import { layoutTable } from "./tables";
import type { ColumnContext, Pt } from "./types";

/** Engine-wide dependencies threaded into every block layout call. The
 *  orchestrator (Task 10) builds this once per conversion; tables / lists
 *  pass it down unchanged. */
export type LayoutDeps = {
  /** Map from `<w:num w:numId>` to the resolved numbering definition.
   *  Empty map is fine — list paragraphs without an entry render with the
   *  default bullet marker (see lists.ts). */
  numbering: Map<string, NumberingDef>;
  /** Map from rId to relationship target. Empty map is fine — hyperlinks
   *  whose rId can't resolve render as plain text + warning. */
  relationships: Map<string, RelationshipTarget>;
  /** Mutable list-state counters — flows across calls so consecutive
   *  list paragraphs at the same `(numId, ilvl)` increment correctly. */
  listState: ListState;
  /** Mutable accumulator for non-fatal layout warnings (e.g., a table
   *  cell whose content overflowed its measured row height and was
   *  clipped). The orchestrator (Task 10) reads this after `layoutBlock`
   *  calls return and merges it into `ParsedDocx.warnings`. Layout
   *  modules append; consumers never mutate it back. */
  warnings: string[];
};

export type LayoutBlockResult = {
  drawnHeight: Pt;
  /** Set when the block couldn't finish in the current column. */
  remainder?: ParsedBlock;
};

/** Lay out a single block. Dispatches by `block.kind` and (for paragraphs)
 *  whether the paragraph carries a `numPr` list reference. */
export function layoutBlock(
  block: ParsedBlock,
  ctx: ColumnContext,
  pdfDoc: PDFDocument,
  deps: LayoutDeps,
): LayoutBlockResult {
  if (block.kind === "skip-with-warning") {
    // Parser already accumulated the warning string into `ParsedDocx.warnings`.
    // Layout draws nothing. Returning `drawnHeight: 0` lets the caller's
    // y-cursor advance by zero with no overflow.
    return { drawnHeight: 0 };
  }

  if (block.kind === "paragraph") {
    if (block.numPr !== undefined) {
      const result = layoutListItem(block, ctx, pdfDoc, deps);
      return resultFromList(result);
    }
    const result = layoutParagraph(block, ctx, pdfDoc);
    return resultFromParagraph(result);
  }

  // Table
  return layoutTable(block, ctx, pdfDoc, deps);
}

function resultFromParagraph(r: { drawnHeight: Pt; remainder?: ParsedBlock }): LayoutBlockResult {
  if (r.remainder !== undefined) {
    return { drawnHeight: r.drawnHeight, remainder: r.remainder };
  }
  return { drawnHeight: r.drawnHeight };
}

function resultFromList(r: { drawnHeight: Pt; remainder?: ParsedBlock }): LayoutBlockResult {
  if (r.remainder !== undefined) {
    return { drawnHeight: r.drawnHeight, remainder: r.remainder };
  }
  return { drawnHeight: r.drawnHeight };
}
