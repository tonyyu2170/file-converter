/**
 * Per-page header / footer rendering.
 *
 * OOXML semantics (relevant subset):
 *   - `<w:sectPr>` carries `<w:headerReference w:type="default|first|even" r:id="rIdN"/>`
 *     and the same shape for footers.
 *   - The relationship rId resolves to a target like `header1.xml`
 *     (relative to `word/`), which the parser pre-loaded into
 *     `parsed.headers` keyed by the bare filename (e.g., `header1.xml`).
 *   - Variant selection per page:
 *       • Page 1 of a section uses `first` if defined, else `default`.
 *       • Even-numbered pages use `even` if defined, else `default`.
 *       • All other pages use `default`.
 *
 * Layout:
 *   - Headers render in the top margin, bottom-aligned to ~12pt above
 *     the body's top edge.
 *   - Footers render in the bottom margin, top-aligned to ~12pt below
 *     the body's bottom edge.
 *   - Both use a column whose width equals the body column width
 *     (full page width minus left+right margins).
 *
 * Field-code limitations (PageNumber / NumPages / etc.):
 *   The OOXML parser preserves the *cached rendering* of field codes
 *   (per Task 5) but not the field semantics — so `PAGE` fields carry
 *   their last-seen rendered text (often "1" or "[#]"). We render this
 *   as-is. Spec §1.4 documents this as a known limitation. Don't try
 *   to substitute page numbers here — if the user wants live page
 *   numbers, that's a v1.1 feature.
 *
 * Page numbering (`pageNumber`, `pageCount`) is plumbed through the
 * function signature for forward compatibility but not consumed in v1.
 */

import type { ParsedBlock, ParsedDocx, Section } from "@/engines/docx-to-pdf/docx-parser/types";
import { layoutParagraph } from "@/engines/docx-to-pdf/layout/paragraph";
import { layoutTable } from "@/engines/docx-to-pdf/layout/tables";
import type { PDFDocument, PDFPage } from "pdf-lib";
import type { LayoutDeps } from "./block-dispatch";
import type { ColumnContext, ColumnGeometry, EmbeddedFonts, PageGeometry, Pt } from "./types";

/** Vertical clearance between the header's bottom edge and the body's
 *  top margin. Mirrors Word's typical "12pt below header" inset. */
const HEADER_BODY_GAP_PT: Pt = 12;

/** Vertical clearance between the body's bottom margin and the footer's
 *  top edge. Mirrors the symmetric "12pt above footer" inset. */
const FOOTER_BODY_GAP_PT: Pt = 12;

/* ------------------------------------------------------------------ */
/*   Public API                                                       */
/* ------------------------------------------------------------------ */

/**
 * Render the section's header on `page` based on the page's position
 * within the section (`pageNumber` is 1-indexed within the section).
 * No-op when the section has no applicable header reference.
 */
export function renderHeaderForPage(
  page: PDFPage,
  pageNumber: number,
  pageCount: number,
  section: Section,
  parsed: ParsedDocx,
  pageGeometry: PageGeometry,
  fonts: EmbeddedFonts,
  deps: LayoutDeps,
  pdfDoc: PDFDocument,
): void {
  void pageCount; // reserved for future PAGE-field expansion
  const blocks = pickRefBlocks(
    section.headerRefs,
    pageNumber,
    parsed.headers,
    parsed.relationships,
  );
  if (blocks === undefined) return;
  drawInTopMargin(page, blocks, pageGeometry, fonts, deps, pdfDoc);
}

/**
 * Render the section's footer on `page`. Mirror of `renderHeaderForPage`.
 */
export function renderFooterForPage(
  page: PDFPage,
  pageNumber: number,
  pageCount: number,
  section: Section,
  parsed: ParsedDocx,
  pageGeometry: PageGeometry,
  fonts: EmbeddedFonts,
  deps: LayoutDeps,
  pdfDoc: PDFDocument,
): void {
  void pageCount;
  const blocks = pickRefBlocks(
    section.footerRefs,
    pageNumber,
    parsed.footers,
    parsed.relationships,
  );
  if (blocks === undefined) return;
  drawInBottomMargin(page, blocks, pageGeometry, fonts, deps, pdfDoc);
}

/* ------------------------------------------------------------------ */
/*   Variant selection + relationship resolution                      */
/* ------------------------------------------------------------------ */

/**
 * Resolve the section's `(headerRefs|footerRefs)` to a block list using
 * the variant that matches `pageNumber`:
 *
 *   - page 1 → `first` (fallback `default`)
 *   - even page → `even` (fallback `default`)
 *   - else → `default`
 *
 * Each rId resolves through `parsed.relationships` to a target like
 * `header1.xml`; we look up that bare filename in `partsMap`. Returns
 * `undefined` when no applicable reference is set or the rId/target
 * resolves to nothing.
 */
function pickRefBlocks(
  refs: Section["headerRefs"] | Section["footerRefs"],
  pageNumber: number,
  partsMap: Map<string, ParsedBlock[]>,
  relationships: ParsedDocx["relationships"],
): ParsedBlock[] | undefined {
  const rId = pickRid(refs, pageNumber);
  if (rId === undefined) return undefined;
  const target = relationships.get(rId)?.target;
  if (target === undefined) return undefined;
  // Targets are stored as written in the .rels (e.g., "header1.xml" or
  // "/word/header1.xml" depending on the file). Normalize by stripping
  // any leading `/` and any `word/` prefix so we end up with the bare
  // file name the parser indexed under.
  const normalized = target.replace(/^\/+/, "").replace(/^word\//, "");
  const blocks = partsMap.get(normalized);
  if (blocks === undefined || blocks.length === 0) return undefined;
  return blocks;
}

function pickRid(refs: Section["headerRefs"], pageNumber: number): string | undefined {
  if (pageNumber === 1 && refs.first !== undefined) return refs.first;
  if (pageNumber % 2 === 0 && refs.even !== undefined) return refs.even;
  return refs.default;
}

/* ------------------------------------------------------------------ */
/*   Drawing                                                           */
/* ------------------------------------------------------------------ */

function drawInTopMargin(
  page: PDFPage,
  blocks: ParsedBlock[],
  pageGeometry: PageGeometry,
  fonts: EmbeddedFonts,
  deps: LayoutDeps,
  pdfDoc: PDFDocument,
): void {
  const colWidth = pageGeometry.widthPt - pageGeometry.marginLeftPt - pageGeometry.marginRightPt;
  const column: ColumnGeometry = { xPt: pageGeometry.marginLeftPt, widthPt: colWidth };

  // Header lives between the page top (`heightPt`) and the body's top
  // edge (`heightPt - marginTopPt`). Reserve a small gap above the body.
  const maxYPt = pageGeometry.heightPt - 6; // 6pt from page top
  const minYPt = pageGeometry.heightPt - pageGeometry.marginTopPt + HEADER_BODY_GAP_PT;
  if (maxYPt <= minYPt) return; // top margin too small to fit; skip rather than overflow

  drawBlocksInBand(page, blocks, pageGeometry, column, maxYPt, minYPt, fonts, deps, pdfDoc);
}

function drawInBottomMargin(
  page: PDFPage,
  blocks: ParsedBlock[],
  pageGeometry: PageGeometry,
  fonts: EmbeddedFonts,
  deps: LayoutDeps,
  pdfDoc: PDFDocument,
): void {
  const colWidth = pageGeometry.widthPt - pageGeometry.marginLeftPt - pageGeometry.marginRightPt;
  const column: ColumnGeometry = { xPt: pageGeometry.marginLeftPt, widthPt: colWidth };

  // Footer lives between the body's bottom edge (`marginBottomPt`) and
  // the page bottom (0). Top of band = marginBottomPt - FOOTER_BODY_GAP_PT.
  const maxYPt = pageGeometry.marginBottomPt - FOOTER_BODY_GAP_PT;
  const minYPt = 6; // 6pt from page bottom
  if (maxYPt <= minYPt) return;

  drawBlocksInBand(page, blocks, pageGeometry, column, maxYPt, minYPt, fonts, deps, pdfDoc);
}

/**
 * Draw `blocks` into a vertical band on `page` between `maxYPt` and
 * `minYPt`. Uses a fresh column context — header/footer content does
 * NOT participate in the body's y-cursor or footnote area. Overflow
 * within the band is clipped (we don't add additional pages for
 * header/footer overruns; large headers are user error).
 */
function drawBlocksInBand(
  page: PDFPage,
  blocks: ParsedBlock[],
  pageGeometry: PageGeometry,
  column: ColumnGeometry,
  maxYPt: Pt,
  minYPt: Pt,
  fonts: EmbeddedFonts,
  deps: LayoutDeps,
  pdfDoc: PDFDocument,
): void {
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
  for (const block of blocks) {
    if (block.kind === "skip-with-warning") continue;
    if (block.kind === "paragraph") {
      // Header/footer paragraphs typically don't have list refs; even
      // if they do, list state from the body would interfere. We don't
      // pass `deps` so onFootnoteRef/embeddedImages aren't honored
      // inside header/footer (footnotes-in-headers is undefined per
      // Word's model).
      layoutParagraph(block, ctx, pdfDoc);
    } else {
      // table — call layoutTable directly. We DO pass deps for tables
      // so cell-internal hyperlinks resolve.
      layoutTable(block, ctx, pdfDoc, deps);
    }
    if (ctx.yPt <= ctx.minYPt) break;
  }
}
