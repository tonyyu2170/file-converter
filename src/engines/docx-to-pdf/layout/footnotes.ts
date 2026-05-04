/**
 * Footnote / endnote rendering for the docx-to-pdf engine.
 *
 * Footnotes appear at the bottom of the page that contains their
 * reference. Endnotes are deferred to a final dedicated "Endnotes" page
 * appended after all sections.
 *
 * Pipeline (driven by the orchestrator in `index.ts`):
 *
 *   1. Per section, BEFORE drawing: pre-walk the section's blocks to
 *      collect every `Run.footnoteRef` and estimate the worst-case
 *      footnote-area height needed at the bottom of the section's
 *      pages. Use that estimate as a conservative reservation by
 *      raising the section's `minYPt` (passed through
 *      `MultiColumnInput.footnoteReservedHeight`).
 *
 *   2. During drawing: when `paragraph.ts` encounters a footnote/endnote
 *      reference, it calls `deps.onFootnoteRef(kind, noteId, page)`,
 *      which we wire to register the marker into the accumulator
 *      (per-page bucket for footnotes; flat list for endnotes) and
 *      return the assigned label.
 *
 *   3. After section: post-walk the pages just added; flush each page's
 *      accumulated footnotes via `flushFootnoteAreaToPage`.
 *
 *   4. After all sections: render endnote pages via `renderEndnotePages`.
 *
 * Reservation strategy is intentionally simple: we reserve the SUM of
 * all the section's footnote-body heights (plus separator + label
 * spacing) as a single section-wide value. This over-reserves on pages
 * with no footnotes (and slightly under-reserves on the rare case where
 * one page's footnotes exceed the estimate's per-page share), but the
 * total is bounded by total footnote count and matches the v1 "naive
 * pagination" posture of spec §3.6.
 *
 * Heights are measured by laying each footnote body onto a discard page
 * at the section's column width — same technique as `multi-column.ts`
 * uses for Pass-1 natural-height measurement.
 */

import type {
  Paragraph,
  ParsedBlock,
  ParsedDocx,
  Run,
} from "@/engines/_shared/docx/docx-parser/types";
import { makeDiscardPage } from "@/engines/docx-to-pdf/layout/discard-page";
import { layoutParagraph } from "@/engines/docx-to-pdf/layout/paragraph";
import type { PDFDocument, PDFPage } from "pdf-lib";
import type { LayoutDeps } from "./block-dispatch";
import type { ColumnContext, ColumnGeometry, EmbeddedFonts, PageGeometry, Pt } from "./types";
import { bodyYBounds } from "./y-cursor";

/* ------------------------------------------------------------------ */
/*   Layout constants                                                 */
/* ------------------------------------------------------------------ */

/** Footnote body font size, in pt. Word uses ~10pt by default; we use
 *  9pt to match the spec's "reduced font" convention. */
export const FOOTNOTE_FONT_SIZE_PT: Pt = 9;

/** Thickness of the hairline separator drawn above the footnote area. */
const SEPARATOR_THICKNESS_PT: Pt = 0.5;

/** Vertical gap between separator and the first footnote body. */
const SEPARATOR_GAP_PT: Pt = 6;

/** Vertical gap below the footnote area (above the page bottom margin). */
const TRAILING_GAP_PT: Pt = 4;

/** Width of a footnote separator. The separator is drawn as a thin
 *  rectangle spanning ~30% of the column width — matches Word's style. */
const SEPARATOR_WIDTH_FRACTION = 0.3;

/* ------------------------------------------------------------------ */
/*   Accumulator                                                      */
/* ------------------------------------------------------------------ */

/**
 * Mutable state threaded through the orchestrator's section walk.
 *
 * `pageFootnotes` maps a `PDFPage` to the ordered list of footnote
 * marker registrations on that page — populated by `onFootnoteRef` and
 * drained by `flushFootnoteAreaToPage`.
 *
 * `endnoteRefs` is a flat list collected across the whole document; the
 * post-walk `renderEndnotePages` consumes this in order.
 *
 * Counters are monotonically incremented as markers are assigned. Both
 * counters use decimal labels ("1", "2", "3", …) — distinguishable in
 * context because footnote markers appear at the page bottom and
 * endnote markers appear on a dedicated end page.
 */
export type FootnoteAccumulator = {
  pageFootnotes: Map<PDFPage, Array<{ noteId: string; markerLabel: string }>>;
  endnoteRefs: Array<{ noteId: string; markerLabel: string }>;
  pageFootnoteCounter: number;
  endnoteCounter: number;
};

export function newFootnoteAccumulator(): FootnoteAccumulator {
  return {
    pageFootnotes: new Map(),
    endnoteRefs: [],
    pageFootnoteCounter: 0,
    endnoteCounter: 0,
  };
}

/**
 * Register a marker for the given (kind, noteId) on `page` and return
 * the assigned label. Called from `paragraph.ts` via the
 * `LayoutDeps.onFootnoteRef` hook.
 *
 * Semantics:
 *   - Footnotes are numbered 1, 2, 3, … globally across the document
 *     (not per-page). This matches Word's "continuous" numbering
 *     default and avoids double-counting if a footnote ref appears
 *     twice (rare but legal in OOXML).
 *   - Endnotes are numbered 1, 2, 3, … globally.
 */
export function registerMarker(
  acc: FootnoteAccumulator,
  kind: "footnote" | "endnote",
  noteId: string,
  page: PDFPage,
): string {
  if (kind === "footnote") {
    acc.pageFootnoteCounter += 1;
    const label = String(acc.pageFootnoteCounter);
    let bucket = acc.pageFootnotes.get(page);
    if (bucket === undefined) {
      bucket = [];
      acc.pageFootnotes.set(page, bucket);
    }
    bucket.push({ noteId, markerLabel: label });
    return label;
  }
  acc.endnoteCounter += 1;
  const label = String(acc.endnoteCounter);
  acc.endnoteRefs.push({ noteId, markerLabel: label });
  return label;
}

/* ------------------------------------------------------------------ */
/*   Pre-section reservation (section-wide estimate)                  */
/* ------------------------------------------------------------------ */

/**
 * Walk a list of blocks and collect every `Run.footnoteRef` noteId, in
 * encounter order. Recurses into table cell blocks. Used by the
 * orchestrator to know which footnotes a section will need so we can
 * reserve room before drawing.
 */
export function collectFootnoteRefsInBlocks(blocks: ParsedBlock[]): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    if (block.kind === "paragraph") {
      collectFromParagraph(block, out);
      continue;
    }
    if (block.kind === "table") {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          out.push(...collectFootnoteRefsInBlocks(cell.blocks));
        }
      }
    }
    // skip-with-warning: nothing to collect
  }
  return out;
}

function collectFromParagraph(p: Paragraph, out: string[]): void {
  for (const r of p.runs) {
    if (r.footnoteRef !== undefined) out.push(r.footnoteRef);
  }
}

/**
 * Estimate the height (pt) needed to render every footnote body for
 * the section's `noteIds` at `columnWidthPt`, plus separator + spacing.
 *
 * Returns 0 when the list is empty.
 *
 * Measurement uses a discard page so no real PDF content is produced;
 * `layoutParagraph` is invoked with a scratch context at the column
 * width.
 */
export function estimateSectionFootnoteHeight(
  noteIds: ReadonlyArray<string>,
  parsed: ParsedDocx,
  fonts: EmbeddedFonts,
  columnWidthPt: Pt,
  pdfDoc: PDFDocument,
): Pt {
  if (noteIds.length === 0) return 0;
  let total = SEPARATOR_GAP_PT + SEPARATOR_THICKNESS_PT + TRAILING_GAP_PT;
  for (const id of noteIds) {
    const blocks = parsed.footnotes.get(id);
    if (blocks === undefined) continue;
    total += measureFootnoteBlocksHeight(blocks, fonts, columnWidthPt, pdfDoc);
  }
  return total;
}

/**
 * Compute the height required for `acc.pageFootnotes` of the current
 * page (NOT the section-wide reservation). Used by tests / future page-
 * level reservation; the orchestrator uses the section-wide estimate.
 *
 * Returns 0 when no footnotes are pending on `page`.
 */
export function reservedFootnoteAreaHeight(
  acc: FootnoteAccumulator,
  page: PDFPage,
  parsed: ParsedDocx,
  fonts: EmbeddedFonts,
  columnWidthPt: Pt,
  pdfDoc: PDFDocument,
): Pt {
  const bucket = acc.pageFootnotes.get(page);
  if (bucket === undefined || bucket.length === 0) return 0;
  let total = SEPARATOR_GAP_PT + SEPARATOR_THICKNESS_PT + TRAILING_GAP_PT;
  for (const entry of bucket) {
    const blocks = parsed.footnotes.get(entry.noteId);
    if (blocks === undefined) continue;
    total += measureFootnoteBlocksHeight(blocks, fonts, columnWidthPt, pdfDoc);
  }
  return total;
}

function measureFootnoteBlocksHeight(
  blocks: ParsedBlock[],
  fonts: EmbeddedFonts,
  columnWidthPt: Pt,
  pdfDoc: PDFDocument,
): Pt {
  // Build a scratch context against a discard page. y-bounds are
  // arbitrarily large so layout never overflows during measurement.
  const SCRATCH_HEIGHT = 1_000_000;
  const ctx: ColumnContext = {
    page: makeDiscardPage(),
    pageGeometry: {
      widthPt: columnWidthPt + 144,
      heightPt: SCRATCH_HEIGHT,
      marginTopPt: 0,
      marginRightPt: 0,
      marginBottomPt: 0,
      marginLeftPt: 0,
    },
    column: { xPt: 0, widthPt: columnWidthPt },
    yPt: SCRATCH_HEIGHT,
    maxYPt: SCRATCH_HEIGHT,
    minYPt: 0,
    fonts,
  };
  const startY = ctx.yPt;
  for (const block of blocks) {
    if (block.kind !== "paragraph") continue;
    const sized = forceFootnoteSize(block);
    layoutParagraph(sized, ctx, pdfDoc);
  }
  return startY - ctx.yPt;
}

/* ------------------------------------------------------------------ */
/*   Per-page flush                                                   */
/* ------------------------------------------------------------------ */

/**
 * Render the footnote area at the bottom of `page`. Walks
 * `acc.pageFootnotes.get(page)` in order, draws the hairline separator
 * + footnote bodies, then deletes the page's bucket so subsequent calls
 * are no-ops.
 *
 * The footnote area starts at the page's bottom margin and grows
 * upward. Each footnote body is prefixed with its marker label
 * ("1 ", "2 ", …) and rendered at `FOOTNOTE_FONT_SIZE_PT`.
 *
 * `pageGeometry` should match the page's section. `deps` is forwarded
 * to `layoutParagraph` so any nested `onFootnoteRef` calls on footnote
 * bodies are no-ops here (footnotes-in-footnotes are rare; we don't
 * recurse).
 */
export function flushFootnoteAreaToPage(
  page: PDFPage,
  acc: FootnoteAccumulator,
  parsed: ParsedDocx,
  pageGeometry: PageGeometry,
  fonts: EmbeddedFonts,
  deps: LayoutDeps,
  pdfDoc: PDFDocument,
): void {
  const bucket = acc.pageFootnotes.get(page);
  if (bucket === undefined || bucket.length === 0) return;

  const totalHeight = reservedFootnoteAreaHeight(
    acc,
    page,
    parsed,
    fonts,
    bodyColumnWidth(pageGeometry),
    pdfDoc,
  );

  // Footnote area's top edge: pageGeometry.marginBottomPt + totalHeight,
  // i.e. the area ends at the body's bottom margin and extends upward.
  const colWidth = bodyColumnWidth(pageGeometry);
  const areaTopY = pageGeometry.marginBottomPt + totalHeight;
  const separatorY = areaTopY - SEPARATOR_THICKNESS_PT;

  // Hairline separator at the top of the area. Drawn as a thin
  // rectangle to match Word's style; we use ~30% column width.
  page.drawLine({
    start: { x: pageGeometry.marginLeftPt, y: separatorY },
    end: {
      x: pageGeometry.marginLeftPt + colWidth * SEPARATOR_WIDTH_FRACTION,
      y: separatorY,
    },
    thickness: SEPARATOR_THICKNESS_PT,
  });

  // Build a column context for the footnote area. y-cursor starts
  // immediately below the separator (separator gap), increases downward.
  const ctx: ColumnContext = {
    page,
    pageGeometry,
    column: { xPt: pageGeometry.marginLeftPt, widthPt: colWidth },
    yPt: separatorY - SEPARATOR_GAP_PT,
    maxYPt: separatorY - SEPARATOR_GAP_PT,
    minYPt: pageGeometry.marginBottomPt - TRAILING_GAP_PT,
    fonts,
    ...(deps.relationships !== undefined && { relationships: deps.relationships }),
    bookmarks: deps.bookmarks,
    warnings: deps.warnings,
  };

  for (const entry of bucket) {
    const blocks = parsed.footnotes.get(entry.noteId);
    if (blocks === undefined) continue;
    drawFootnoteEntry(entry.markerLabel, blocks, ctx, pdfDoc);
  }

  // Drain so the page isn't double-flushed.
  acc.pageFootnotes.delete(page);
}

/**
 * Draw one footnote entry: prefix the first paragraph with the marker
 * label and lay each block via `layoutParagraph`. Caller has already
 * sized the column context.
 *
 * The marker is rendered inline as the first run of the first
 * paragraph; we do this by mutating a synthesized copy (parsed data is
 * NOT mutated). Subsequent paragraphs render unchanged.
 */
function drawFootnoteEntry(
  markerLabel: string,
  blocks: ParsedBlock[],
  ctx: ColumnContext,
  pdfDoc: PDFDocument,
): void {
  let prefixApplied = false;
  for (const block of blocks) {
    if (block.kind !== "paragraph") continue;
    const sized = forceFootnoteSize(block);
    const withMarker = prefixApplied ? sized : prependMarkerRun(sized, `${markerLabel} `);
    prefixApplied = true;
    layoutParagraph(withMarker, ctx, pdfDoc);
  }
}

/**
 * Coerce a footnote-body paragraph to render at `FOOTNOTE_FONT_SIZE_PT`
 * by stamping that size onto each run that didn't carry an explicit
 * `fontSizePt`. Runs with explicit sizes are left alone (the source
 * DOCX may override on per-run basis — rare for footnotes but legal).
 */
function forceFootnoteSize(p: Paragraph): Paragraph {
  const sizedRuns = p.runs.map((r) =>
    r.fontSizePt === undefined ? { ...r, fontSizePt: FOOTNOTE_FONT_SIZE_PT } : r,
  );
  return { ...p, runs: sizedRuns };
}

function prependMarkerRun(p: Paragraph, label: string): Paragraph {
  const markerRun: Run = {
    kind: "run",
    text: label,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    fontSizePt: FOOTNOTE_FONT_SIZE_PT,
  };
  return { ...p, runs: [markerRun, ...p.runs] };
}

function bodyColumnWidth(geo: PageGeometry): Pt {
  return geo.widthPt - geo.marginLeftPt - geo.marginRightPt;
}

/* ------------------------------------------------------------------ */
/*   End-of-document endnotes                                         */
/* ------------------------------------------------------------------ */

/**
 * Append one or more "Endnotes" pages to `pdfDoc` containing every
 * registered endnote, in registration order. Each entry is rendered as
 * `<label> <body>`. A final "Endnotes" heading paragraph is drawn
 * at the top of the first page.
 *
 * No-op when `acc.endnoteRefs` is empty.
 */
export function renderEndnotePages(
  pdfDoc: PDFDocument,
  acc: FootnoteAccumulator,
  parsed: ParsedDocx,
  pageGeometry: PageGeometry,
  fonts: EmbeddedFonts,
  deps: LayoutDeps,
): void {
  if (acc.endnoteRefs.length === 0) return;

  const { maxYPt, minYPt } = bodyYBounds(pageGeometry);
  const colWidth = bodyColumnWidth(pageGeometry);
  const column: ColumnGeometry = { xPt: pageGeometry.marginLeftPt, widthPt: colWidth };

  let page = pdfDoc.addPage([pageGeometry.widthPt, pageGeometry.heightPt]);
  const ctx: ColumnContext = {
    page,
    pageGeometry,
    column,
    yPt: maxYPt,
    maxYPt,
    minYPt,
    fonts,
    ...(deps.relationships !== undefined && { relationships: deps.relationships }),
    bookmarks: deps.bookmarks,
    warnings: deps.warnings,
  };

  // Heading: "Endnotes" at h2 size.
  const heading: Paragraph = {
    kind: "paragraph",
    styleId: "Heading1",
    alignment: "left",
    runs: [
      {
        kind: "run",
        text: "Endnotes",
        bold: true,
        italic: false,
        underline: false,
        strike: false,
      },
    ],
  };
  layoutParagraph(heading, ctx, pdfDoc);

  for (const entry of acc.endnoteRefs) {
    const blocks = parsed.endnotes.get(entry.noteId);
    if (blocks === undefined) continue;

    let prefixApplied = false;
    for (const block of blocks) {
      if (block.kind !== "paragraph") continue;
      const sized = forceFootnoteSize(block);
      const withMarker = prefixApplied ? sized : prependMarkerRun(sized, `${entry.markerLabel} `);
      prefixApplied = true;

      // Page-break if needed before drawing.
      if (ctx.yPt <= ctx.minYPt) {
        page = pdfDoc.addPage([pageGeometry.widthPt, pageGeometry.heightPt]);
        ctx.page = page;
        ctx.yPt = maxYPt;
      }
      const result = layoutParagraph(withMarker, ctx, pdfDoc, deps);
      let remainder = result.remainder;
      while (remainder !== undefined) {
        page = pdfDoc.addPage([pageGeometry.widthPt, pageGeometry.heightPt]);
        ctx.page = page;
        ctx.yPt = maxYPt;
        const next = layoutParagraph(remainder, ctx, pdfDoc, deps);
        remainder = next.remainder;
      }
    }
  }

  // Drain so subsequent calls are no-ops.
  acc.endnoteRefs = [];
}
