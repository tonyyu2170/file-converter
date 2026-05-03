/**
 * Inline-image layout primitives: byte-sniff PNG/JPEG, embed via pdf-lib,
 * draw with shrink-to-fit semantics.
 *
 * DOCX inline images arrive as `MediaAsset` records (raw bytes + mime).
 * pdf-lib needs an `embedPng` / `embedJpg` call to turn the bytes into a
 * `PDFImage` reference; that's a one-shot per asset. The orchestrator
 * (Task 10) will pre-embed all images at the start of the layout pass
 * and reuse the `PDFImage` across multiple draw sites.
 *
 * Drawing semantics:
 *
 *   - The DOCX `<w:drawing>` carries a target width/height in EMUs which
 *     the parser converts to points and writes into `Run.inlineImage`.
 *   - If the desired width exceeds the column width, scale proportionally
 *     (shrink-to-fit) and emit a `warnings`-channel notice via the
 *     returned struct.
 *   - If the resulting height after fit exceeds 50% of the column body
 *     height, we keep the fit (we still want the document to lay out)
 *     but flag an "image overshrunk" notice — caller decides whether to
 *     surface it.
 *
 * The image's mime is sniffed from the first few bytes; we don't trust
 * the parser's mime heuristic for embedding (PNG and JPEG both have
 * unambiguous signatures).
 */

import type { MediaAsset, Run } from "@/engines/docx-to-pdf/docx-parser/types";
import type { PDFDocument, PDFImage } from "pdf-lib";
import type { ColumnContext, Pt } from "./types";

/** Detected image format. `unknown` indicates an unsupported sniff result —
 *  caller should skip + warn. */
export type ImageFormat = "png" | "jpeg" | "unknown";

/** PNG signature: 89 50 4E 47 0D 0A 1A 0A. */
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
/** JPEG SOI: FF D8 FF. */
const JPEG_SIG = [0xff, 0xd8, 0xff] as const;

/** Sniff PNG vs JPEG vs unknown from the first bytes of an image buffer. */
export function sniffImageFormat(bytes: Uint8Array): ImageFormat {
  if (bytes.length >= PNG_SIG.length && PNG_SIG.every((b, i) => bytes[i] === b)) {
    return "png";
  }
  if (bytes.length >= JPEG_SIG.length && JPEG_SIG.every((b, i) => bytes[i] === b)) {
    return "jpeg";
  }
  return "unknown";
}

/**
 * Embed a `MediaAsset` into `pdfDoc` and return the `PDFImage` reference.
 *
 * Throws if the bytes don't sniff as PNG or JPEG. Callers that want
 * non-fatal handling should sniff first via `sniffImageFormat`.
 */
export async function embedInlineImage(media: MediaAsset, pdfDoc: PDFDocument): Promise<PDFImage> {
  const format = sniffImageFormat(media.bytes);
  if (format === "png") {
    return pdfDoc.embedPng(media.bytes);
  }
  if (format === "jpeg") {
    return pdfDoc.embedJpg(media.bytes);
  }
  throw new Error(`embedInlineImage: unsupported image format for ${media.path}`);
}

export type ShrinkToFitResult = {
  /** Final drawn width in pt. */
  widthPt: Pt;
  /** Final drawn height in pt. */
  heightPt: Pt;
  /** True when the image was scaled down to fit the column. */
  shrunk: boolean;
  /** True when the resulting height >= 50% of the column body height. */
  overshrunk: boolean;
};

/**
 * Compute the on-page draw dimensions for an image, applying shrink-to-fit
 * against the column width and emitting an `overshrunk` flag when the
 * resulting block is taller than half the column body. The two dimensions
 * are scaled proportionally (the image's intrinsic aspect ratio is
 * preserved).
 */
export function fitImageToColumn(
  desiredWidthPt: Pt,
  desiredHeightPt: Pt,
  ctx: ColumnContext,
): ShrinkToFitResult {
  if (desiredWidthPt <= 0 || desiredHeightPt <= 0) {
    return { widthPt: 0, heightPt: 0, shrunk: false, overshrunk: false };
  }
  const colWidth = ctx.column.widthPt;
  const colHeight = ctx.maxYPt - ctx.minYPt;

  let widthPt = desiredWidthPt;
  let heightPt = desiredHeightPt;
  let shrunk = false;

  if (widthPt > colWidth) {
    const scale = colWidth / widthPt;
    widthPt = colWidth;
    heightPt = desiredHeightPt * scale;
    shrunk = true;
  }

  const overshrunk = heightPt >= colHeight * 0.5;
  return { widthPt, heightPt, shrunk, overshrunk };
}

/**
 * Draw an embedded image at `(xPt, topYPt)` (top-left of the image) on
 * `ctx.page`, sized per `run.inlineImage` and the column's width
 * constraint. pdf-lib's `drawImage` takes the *bottom-left* corner, so
 * we offset by the drawn height.
 *
 * Returns the drawn dimensions (post shrink-to-fit) plus the warning
 * flags so the caller can advance its y-cursor and surface notices.
 */
export function drawInlineImage(
  ctx: ColumnContext,
  img: PDFImage,
  run: Run,
  xPt: Pt,
  topYPt: Pt,
): ShrinkToFitResult {
  if (run.inlineImage === undefined) {
    return { widthPt: 0, heightPt: 0, shrunk: false, overshrunk: false };
  }
  const { widthPt: desiredW, heightPt: desiredH } = run.inlineImage;
  const fit = fitImageToColumn(desiredW, desiredH, ctx);

  if (fit.widthPt === 0 || fit.heightPt === 0) {
    return fit;
  }

  ctx.page.drawImage(img, {
    x: xPt,
    y: topYPt - fit.heightPt,
    width: fit.widthPt,
    height: fit.heightPt,
  });

  return fit;
}
