/**
 * Run-level layout primitives: font selection, measurement, and drawing
 * for a single span of text on a single line.
 *
 * Word-wrap and line breaking happen one level up in `paragraph.ts`. This
 * module ONLY handles "given an (x, baseline-y) on a page, draw the run's
 * text + decorations and report the advance width."
 *
 * Substitution flow:
 *
 *   run.fontFamily ──▶ pickFont (substitution-map) ──▶ BundledFontFamily
 *                                                              │
 *                                                              ▼
 *                       (bold, italic) ──────────────────▶ EmbeddedFonts slot
 *
 * JetBrains Mono ships only Regular + Bold (matches `font-loader`); italic
 * for that family resolves to upright per weight.
 *
 * Decorations (underline, strike) are drawn as thin rectangles after the
 * text is placed — pdf-lib's `drawText` does not own them. Underline sits
 * a small offset below the baseline; strike sits at half x-height.
 */

import type { Run } from "@/engines/docx-to-pdf/docx-parser/types";
import { pickFont } from "@/engines/docx-to-pdf/fonts/substitution-map";
import type { BundledFontFamily } from "@/engines/docx-to-pdf/fonts/types";
import { rgb } from "pdf-lib";
import type { PDFFont } from "pdf-lib";
import { attachLinkAnnotation } from "./hyperlinks";
import type { ColumnContext, EmbeddedFonts, Pt } from "./types";

/** Default body font size in pt. Mirrors Calibri 11pt — Word's typical
 *  body default. Used when the run carries no explicit `fontSizePt`. */
export const DEFAULT_FONT_SIZE_PT: Pt = 11;

/** Line-height multiplier applied to ascent + descent. */
export const LINE_HEIGHT_FACTOR = 1.2;

/** Underline / strike thickness, in points, scaled with font size. The
 *  0.5pt floor matches Word's default underline at body sizes. */
export function decorationThickness(fontSizePt: Pt): Pt {
  return Math.max(0.5, 0.5 * (fontSizePt / DEFAULT_FONT_SIZE_PT));
}

/**
 * Resolve the run's effective font size in points. `Run.fontSizePt` is
 * already in whole points (the parser converts from half-points), so
 * this is just an OR with the default.
 */
export function runFontSizePt(run: Run): Pt {
  return run.fontSizePt ?? DEFAULT_FONT_SIZE_PT;
}

/**
 * Pick the embedded font slot for a run.
 *
 * @param overrides — paragraph-level overrides applied by the caller (e.g.
 *   headings force bold). Each field, if set, supersedes the run's own.
 */
export function pickRunFont(
  run: Run,
  fonts: EmbeddedFonts,
  overrides: { bold?: boolean; italic?: boolean } = {},
): PDFFont {
  const family = pickFont(run.fontFamily);
  const bold = overrides.bold ?? run.bold;
  const italic = overrides.italic ?? run.italic;
  return resolveFontSlot(fonts, family, bold, italic);
}

/** Look up the (family, bold, italic) slot in `EmbeddedFonts`. */
function resolveFontSlot(
  fonts: EmbeddedFonts,
  family: BundledFontFamily,
  bold: boolean,
  italic: boolean,
): PDFFont {
  if (family === "jetbrains-mono") {
    // JetBrains Mono: italic falls back to upright per weight (mirrors
    // `font-loader.resolveFilename` behavior).
    return bold ? fonts.jetbrainsMono.bold : fonts.jetbrainsMono.regular;
  }
  const group = family === "lora" ? fonts.lora : fonts.inter;
  if (bold && italic) return group.boldItalic;
  if (bold) return group.bold;
  if (italic) return group.italic;
  return group.regular;
}

/**
 * Measure a single run's text width + height at its effective font size.
 *
 * `widthPt` is the advance the caller would use to advance an x-cursor.
 * `heightPt` is the line-height (ascent + descent + leading), used by
 * paragraph.ts when computing line vertical spacing.
 *
 * NOTE: only measures the run's *raw text*. Newlines (`\n`) inside the
 * text count as characters — the caller (paragraph.ts) splits on `\n`
 * before calling this.
 */
export function measureRun(
  run: Run,
  fonts: EmbeddedFonts,
  overrides: { bold?: boolean; italic?: boolean; sizePt?: Pt } = {},
): { widthPt: Pt; heightPt: Pt } {
  const font = pickRunFont(run, fonts, overrides);
  const sizePt = overrides.sizePt ?? runFontSizePt(run);
  return {
    widthPt: font.widthOfTextAtSize(run.text, sizePt),
    heightPt: sizePt * LINE_HEIGHT_FACTOR,
  };
}

/** Measure an arbitrary text fragment in the run's resolved font. Useful
 *  for word-by-word measurement during wrapping. */
export function measureFragment(
  text: string,
  run: Run,
  fonts: EmbeddedFonts,
  overrides: { bold?: boolean; italic?: boolean; sizePt?: Pt } = {},
): Pt {
  const font = pickRunFont(run, fonts, overrides);
  const sizePt = overrides.sizePt ?? runFontSizePt(run);
  return font.widthOfTextAtSize(text, sizePt);
}

/**
 * Draw a run's text at `(xPt, baselineYPt)` on `ctx.page`. Returns the
 * advance width so the caller can advance its x-cursor.
 *
 * Honors the run's bold/italic via font choice, color via `colorHex` (or
 * defaults to black), underline + strike as thin rectangles drawn after
 * the text.
 *
 * `text` may differ from `run.text` — paragraph-level wrapping calls this
 * once per line-fragment, passing only the substring that belongs on the
 * current line.
 */
export function drawRunSpan(
  ctx: ColumnContext,
  run: Run,
  text: string,
  xPt: Pt,
  baselineYPt: Pt,
  overrides: { bold?: boolean; italic?: boolean; sizePt?: Pt } = {},
): Pt {
  const font = pickRunFont(run, fonts(ctx), overrides);
  const sizePt = overrides.sizePt ?? runFontSizePt(run);
  const color = parseColorHex(run.colorHex);
  const advance = font.widthOfTextAtSize(text, sizePt);

  ctx.page.drawText(text, {
    x: xPt,
    y: baselineYPt,
    size: sizePt,
    font,
    color,
  });

  if (run.underline) {
    drawDecorationLine(ctx, xPt, baselineYPt - underlineOffset(sizePt), advance, sizePt, color);
  }
  if (run.strike) {
    drawDecorationLine(ctx, xPt, baselineYPt + strikeOffset(sizePt), advance, sizePt, color);
  }

  // Hyperlink annotation: attach a clickable rect over the drawn fragment
  // when the run carries a hyperlink target AND the column context has a
  // relationships map to resolve external URLs against. We do NOT change
  // the fragment's color or underline here — those are styling choices the
  // source DOCX already made. Per-fragment attachment yields one rect per
  // visual line, matching reader expectations for wrapped links.
  if (
    (run.hyperlinkRel !== undefined || run.hyperlinkAnchor !== undefined) &&
    ctx.relationships !== undefined
  ) {
    const heightPt = sizePt * LINE_HEIGHT_FACTOR;
    const target: { rel?: string; anchor?: string } = {};
    if (run.hyperlinkRel !== undefined) target.rel = run.hyperlinkRel;
    if (run.hyperlinkAnchor !== undefined) target.anchor = run.hyperlinkAnchor;
    attachLinkAnnotation(ctx.page, xPt, baselineYPt, advance, heightPt, target, ctx.relationships);
  }

  return advance;
}

/* ------------------------------------------------------------------ */
/* internals                                                           */
/* ------------------------------------------------------------------ */

function fonts(ctx: ColumnContext): EmbeddedFonts {
  return ctx.fonts;
}

/**
 * Distance below the baseline at which the underline sits. Word's PDFs
 * place underlines about 1.5pt below the baseline at body sizes; we
 * scale that with font size for visual parity at headings.
 */
function underlineOffset(sizePt: Pt): Pt {
  return Math.max(1.5, 1.5 * (sizePt / DEFAULT_FONT_SIZE_PT));
}

/** Distance above the baseline at which the strike line sits — roughly
 *  half x-height (estimated as 30% of font size). */
function strikeOffset(sizePt: Pt): Pt {
  return sizePt * 0.3;
}

/** Draw a horizontal decoration line at `(xPt, yPt)` of `width` points. */
function drawDecorationLine(
  ctx: ColumnContext,
  xPt: Pt,
  yPt: Pt,
  width: Pt,
  sizePt: Pt,
  color: ReturnType<typeof rgb>,
): void {
  const thickness = decorationThickness(sizePt);
  ctx.page.drawLine({
    start: { x: xPt, y: yPt },
    end: { x: xPt + width, y: yPt },
    thickness,
    color,
  });
}

/**
 * Parse a 6-digit hex color (no leading `#`, uppercase per parser
 * convention) into a pdf-lib `Color`. Falls back to black on `undefined`
 * or any malformed input — never throws (the parser's contract is
 * uppercase 6-digit, but defense-in-depth is cheap).
 */
export function parseColorHex(hex: string | undefined) {
  if (hex === undefined) return rgb(0, 0, 0);
  if (!/^[0-9A-Fa-f]{6}$/.test(hex)) return rgb(0, 0, 0);
  const r = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const g = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const b = Number.parseInt(hex.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}
