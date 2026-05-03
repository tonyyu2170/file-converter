/**
 * Hyperlink support: build pdf-lib link annotations over drawn run rects.
 *
 * Run shape (from the parser):
 *   - `run.hyperlinkRel` — relationship id; resolves via the relationships
 *     map to an external URL.
 *   - `run.hyperlinkAnchor` — internal anchor (named destination).
 *   When both are set, the parser already chose `hyperlinkRel` and emitted
 *   a warning; we honor that here by checking `rel` first.
 *
 * pdf-lib annotation pattern:
 *
 *   const linkDict = page.doc.context.obj({
 *     Type:    "Annot",
 *     Subtype: "Link",
 *     Rect:    [x1, y1, x2, y2],
 *     Border:  [0, 0, 0],     // no visible border
 *     A: { Type: "Action", S: "URI", URI: PDFString.of(url) }, // for URI
 *     // OR for an internal jump:
 *     Dest: PDFName.of(anchor),
 *   });
 *   const ref = page.doc.context.register(linkDict);
 *   page.node.addAnnot(ref);
 *
 * Per-line-fragment attachment: a hyperlink that wraps across two visual
 * lines yields two `attachLinkAnnotation` calls (once per fragment), each
 * with its own rect. This matches what real PDF readers expect — Acrobat
 * draws a hover highlight per rect, not over the bounding box of all
 * fragments.
 *
 * Resolution failure paths:
 *   - `rel` not in relationships map → warn (return), no annotation drawn.
 *     The caller has already drawn the run text; the user sees the link
 *     text but no clickable target.
 *   - `rel` present but not `targetMode === "External"` → warn, no
 *     annotation. (Internal-relationship targets aren't PDF-jump targets
 *     by default; we route via `anchor` for that.)
 *   - `anchor` set but no rel and no anchor lookup mechanism in v1 — we
 *     emit a `Dest` annotation with the anchor name; consumers that want
 *     to jump within the PDF need the document's NamedDest table populated
 *     by the orchestrator (Task 10).
 */

import type { RelationshipTarget } from "@/engines/docx-to-pdf/docx-parser/types";
import { PDFName, PDFString } from "pdf-lib";
import type { PDFPage } from "pdf-lib";
import type { Pt } from "./types";

export type LinkTarget = {
  rel?: string;
  anchor?: string;
};

export type AttachResult =
  | { kind: "uri"; url: string }
  | { kind: "dest"; anchor: string }
  | { kind: "skipped"; reason: string };

/**
 * Attach a link annotation rectangle at `(xPt, baselineYPt)` of the given
 * width and height to `page`. Resolves `target` against `relationships`
 * and emits the appropriate annotation kind:
 *   - rel resolves to External URL → URI action link
 *   - rel resolves to Internal target → skipped (we don't support
 *     internal-rel jumps in v1)
 *   - rel doesn't resolve → skipped
 *   - anchor only → Dest link (named destination)
 *   - neither resolves → skipped
 *
 * Returns the result kind so the caller can surface warnings.
 *
 * Rect math: PDF rect is `[llx, lly, urx, ury]` (lower-left + upper-right
 * in absolute page coords). Given a baseline at `baselineYPt` and a
 * line-height of `heightPt`, the rect's bottom is `baselineYPt - descent`
 * (we approximate as `baselineYPt - heightPt * 0.2`) and the top is
 * `baselineYPt + heightPt * 0.8`. Width is the run's measured advance.
 */
export function attachLinkAnnotation(
  page: PDFPage,
  xPt: Pt,
  baselineYPt: Pt,
  widthPt: Pt,
  heightPt: Pt,
  target: LinkTarget,
  relationships: Map<string, RelationshipTarget>,
): AttachResult {
  if (widthPt <= 0 || heightPt <= 0) {
    return { kind: "skipped", reason: "zero-size rect" };
  }

  const rect = computeLinkRect(xPt, baselineYPt, widthPt, heightPt);

  // Resolve. rel takes precedence over anchor when both are set.
  if (target.rel !== undefined) {
    const resolved = relationships.get(target.rel);
    if (resolved === undefined) {
      return { kind: "skipped", reason: `unresolved hyperlink rel ${target.rel}` };
    }
    if (resolved.targetMode !== "External") {
      return {
        kind: "skipped",
        reason: `internal-rel hyperlink target not supported: ${target.rel}`,
      };
    }
    writeUriAnnotation(page, rect, resolved.target);
    return { kind: "uri", url: resolved.target };
  }

  if (target.anchor !== undefined) {
    writeDestAnnotation(page, rect, target.anchor);
    return { kind: "dest", anchor: target.anchor };
  }

  return { kind: "skipped", reason: "no rel and no anchor" };
}

/**
 * Compute the PDF rect for a link annotation given the fragment's draw
 * coordinates. Exported for test math.
 *
 * Convention:
 *   - `(xPt, baselineYPt)` is the lower-left of the *baseline*; pdf-lib's
 *     `drawText` uses this as the text origin.
 *   - The rect extends slightly below the baseline (descent area) and up
 *     above the baseline by ~80% of the line-height (ascent + leading).
 *   - The 20%/80% split mirrors `paragraph.ts:drawLine` baseline math.
 */
export function computeLinkRect(
  xPt: Pt,
  baselineYPt: Pt,
  widthPt: Pt,
  heightPt: Pt,
): [number, number, number, number] {
  const descent = heightPt * 0.2;
  const ascent = heightPt * 0.8;
  const llx = xPt;
  const lly = baselineYPt - descent;
  const urx = xPt + widthPt;
  const ury = baselineYPt + ascent;
  return [llx, lly, urx, ury];
}

/* ------------------------------------------------------------------ */
/*   Annotation builders                                              */
/* ------------------------------------------------------------------ */

function writeUriAnnotation(
  page: PDFPage,
  rect: [number, number, number, number],
  url: string,
): void {
  const ctx = page.doc.context;
  const dict = ctx.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: rect,
    Border: [0, 0, 0],
    A: ctx.obj({
      Type: "Action",
      S: "URI",
      URI: PDFString.of(url),
    }),
  });
  const ref = ctx.register(dict);
  page.node.addAnnot(ref);
}

function writeDestAnnotation(
  page: PDFPage,
  rect: [number, number, number, number],
  anchor: string,
): void {
  const ctx = page.doc.context;
  const dict = ctx.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: rect,
    Border: [0, 0, 0],
    Dest: PDFName.of(anchor),
  });
  const ref = ctx.register(dict);
  page.node.addAnnot(ref);
}
