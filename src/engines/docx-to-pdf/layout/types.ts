/**
 * Layout-engine primitive types.
 *
 * The layout engine consumes a `ParsedDocx` (Tasks 4-5) and emits PDF bytes
 * via `pdf-lib`. This module declares the value-types passed between the
 * sub-modules of `layout/`:
 *
 *   - `EmbeddedFonts`   — the four-style families embedded into a PDF
 *                         (filled in by the orchestrator in Task 10).
 *   - `PageGeometry`    — section page-size + margins, in PostScript points.
 *   - `ColumnGeometry`  — the page-relative box one column occupies.
 *   - `ColumnContext`   — the y-cursor + active page + column geometry +
 *                         fonts. Mutated by `y-cursor.ts` helpers.
 *
 * Coordinate convention follows pdf-lib: origin is the page's bottom-left,
 * Y increases upward. We draw downward by *decreasing* the y-cursor each
 * time a block is laid out. `maxYPt` is the column's "top" allowed Y;
 * `minYPt` is the bottom. A column overflows when the next block's bottom
 * would fall below `minYPt`.
 *
 * Phase 10 Task 7 only needs single-column rendering; multi-column lands
 * in Task 9 and reuses `ColumnGeometry` to seed alternate column boxes.
 */

import type { RelationshipTarget } from "@/engines/docx-to-pdf/docx-parser/types";
import type { PDFFont, PDFPage } from "pdf-lib";

/** All PDF text in the engine is drawn at PostScript points (1/72 in). */
export type Pt = number;

/**
 * The four-style family of embedded fonts that the layout engine draws
 * with. Populated once by the orchestrator (Task 10) via
 * `pdfDoc.embedFont(...)` after registering fontkit, then passed
 * read-only into `ColumnContext`.
 *
 * JetBrains Mono ships only Regular + Bold — italic flag on a code-style
 * run picks Regular/Bold per weight (mirrors `font-loader.resolveFilename`).
 */
export type EmbeddedFonts = {
  inter: {
    regular: PDFFont;
    bold: PDFFont;
    italic: PDFFont;
    boldItalic: PDFFont;
  };
  lora: {
    regular: PDFFont;
    bold: PDFFont;
    italic: PDFFont;
    boldItalic: PDFFont;
  };
  jetbrainsMono: {
    regular: PDFFont;
    bold: PDFFont;
  };
};

/** Page size + margins for a section (resolved from `<w:sectPr>`). */
export type PageGeometry = {
  widthPt: Pt;
  heightPt: Pt;
  marginTopPt: Pt;
  marginRightPt: Pt;
  marginBottomPt: Pt;
  marginLeftPt: Pt;
};

/** A column is a vertical strip on the page, identified by its left edge
 *  and width. Single-column documents have one column whose width is
 *  `pageWidth - leftMargin - rightMargin` and whose `xPt` equals
 *  `marginLeftPt`. Multi-column adds gutters in Task 9. */
export type ColumnGeometry = {
  /** Column's left edge in page coords. */
  xPt: Pt;
  /** Column's width in page coords. */
  widthPt: Pt;
};

/**
 * Per-column flow context. Mutated by `y-cursor.ts` helpers as blocks are
 * drawn. Carries the active page reference so a `pageBreak` reseats it
 * without callers needing to track the page separately.
 */
export type ColumnContext = {
  /** Active pdf-lib page. Reseated by `pageBreak`. */
  page: PDFPage;
  pageGeometry: PageGeometry;
  column: ColumnGeometry;
  /**
   * Current y-cursor in PDF user-space. Decreases as content is drawn
   * top-to-bottom across the page. Always lies in `[minYPt, maxYPt]`
   * unless an overflow is being detected.
   */
  yPt: Pt;
  /** Top of the column (highest allowed Y). */
  maxYPt: Pt;
  /** Bottom of the column (lowest allowed Y). Drawing past this triggers
   *  a page or column break. */
  minYPt: Pt;
  fonts: EmbeddedFonts;
  /**
   * Relationship map for hyperlink resolution. Optional so existing
   * tests (and orchestrator code paths that don't care about hyperlinks)
   * can omit it. When undefined, `drawRunSpan` will skip annotation
   * attachment even for hyperlink-flagged runs (text still draws plainly).
   */
  relationships?: Map<string, RelationshipTarget>;
  /**
   * Bookmark-name set used by `attachLinkAnnotation` to verify that an
   * internal-anchor hyperlink target exists. Threaded through here (rather
   * than as a `drawRunSpan` parameter) to mirror the existing
   * `relationships` plumbing on this type. Optional so tests / non-link
   * code paths can omit it; treated as an empty set when undefined,
   * meaning every anchor lookup misses.
   */
  bookmarks?: Set<string>;
  /**
   * Run-level layout primitives (specifically `drawRunSpan`'s hyperlink
   * resolution) push warnings here when an anchor doesn't exist or a
   * relationship doesn't resolve. The orchestrator wires this to
   * `LayoutDeps.warnings` via the `multi-column.ts` / `tables.ts` /
   * `headers-footers.ts` / `footnotes.ts` callsites that build
   * `ColumnContext`. Optional so existing tests don't have to supply it;
   * when undefined, `drawRunSpan` silently drops the warning (the link
   * still falls through to plain-text rendering, which is the user-visible
   * fallback the warning was about).
   */
  warnings?: string[];
};

/** Return shape for "I drew this much height." Used by paragraph/list/
 *  table renderers so callers can advance the column's y-cursor. */
export type DrawnHeight = { drawnHeight: Pt };
