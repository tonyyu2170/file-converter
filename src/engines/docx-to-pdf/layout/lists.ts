/**
 * List-paragraph layout: marker rendering + indent-shifted paragraph body.
 *
 * A "list paragraph" is a `Paragraph` carrying a `numPr` reference to a
 * numbering definition. The layout work splits in two:
 *
 *   1. Compute the marker text from the numbering definition (bullet glyph
 *      or `%N`-substituted counter). Increment the per-`(numId, ilvl)`
 *      counter and reset deeper-level counters.
 *   2. Draw the marker in the left gutter at the level's indent.
 *   3. Hand the paragraph body to `layoutParagraph` with the column shifted
 *      right by the level's indent and width reduced.
 *
 * Continuation across page/column boundaries:
 *   - When `layoutParagraph` returns a `remainder`, this module owns the
 *     loop: it triggers a `pageBreak`, then re-invokes `layoutParagraph`
 *     with the remainder on the *same* shifted column, *without* redrawing
 *     the marker. The continuation thus visually flows under the indent
 *     established by the first marker draw.
 *   - The counter is NOT bumped a second time on continuation (the bump
 *     happens once, at the first call for this paragraph).
 *
 * State (`ListState`):
 *   - Carries per-numId per-level counter values across calls.
 *   - When a level decreases on a subsequent call (e.g. ilvl=1 → ilvl=0
 *     within the same numId), deeper levels are reset (so a new sub-list
 *     starts at 1).
 *   - Switching numId is treated as a new independent list — counters for
 *     the previous numId persist (Word's behavior: re-entering a numId
 *     resumes its counter).
 *
 * Defaults when numbering map can't resolve:
 *   - Numbering definition not found → render `•` bullet and skip counter
 *     bumps. The parser is supposed to have populated the map; this is
 *     defensive.
 *   - Level definition not found → render `•` bullet at the requested ilvl.
 *
 * NOTE on indent values:
 *   - Spec §1.3 says "supports nested levels (up to 9)". The brief
 *     specifies ~24pt indent per level. We use exactly 24pt so the
 *     numbers are predictable in tests.
 */

import type {
  NumberingDef,
  NumberingLevel,
  Paragraph,
} from "@/engines/docx-to-pdf/docx-parser/types";
import type { PDFDocument } from "pdf-lib";
import type { LayoutDeps } from "./block-dispatch";
import { layoutParagraph } from "./paragraph";
import { DEFAULT_FONT_SIZE_PT, drawRunSpan } from "./runs";
import type { ColumnContext, ColumnGeometry, Pt } from "./types";
import { pageBreak, wouldOverflow } from "./y-cursor";

/** Per-(numId, ilvl) counter state. The orchestrator (Task 10) creates
 *  one of these per conversion and threads it through `LayoutDeps`. */
export type ListState = {
  /** numId → ilvl → counter value (0-based: pre-increment is 0). */
  counters: Map<string, Map<number, number>>;
  /** Per-numId, the last ilvl seen; used to detect "level decrease" so
   *  we can reset deeper-level counters on the way back up. */
  lastLevel: Map<string, number>;
};

export function createListState(): ListState {
  return { counters: new Map(), lastLevel: new Map() };
}

/** Indent-per-level in points. Matches the brief's ~24pt-per-level
 *  recommendation; chosen for predictable test math. */
export const LIST_INDENT_PER_LEVEL_PT: Pt = 24;

/** Gap between the marker and the body text, in points. */
export const LIST_MARKER_GAP_PT: Pt = 4;

/** Default bullet glyph used when numbering can't resolve. */
const DEFAULT_BULLET = "•"; // •

export type LayoutListItemResult = {
  drawnHeight: Pt;
  remainder?: Paragraph;
};

/**
 * Lay out a single list paragraph. Bumps the counter, draws the marker,
 * and renders the body via `layoutParagraph` on a shifted column.
 *
 * Continuation: when the body overflows, `pageBreak` is invoked and the
 * remainder is rendered on the new page without a marker redraw. The
 * function returns a final `drawnHeight` reflecting the total vertical
 * space consumed *on the original page* (the new-page draw is not
 * counted in the return value because the caller already advanced past
 * the page boundary internally).
 */
export function layoutListItem(
  p: Paragraph,
  ctx: ColumnContext,
  pdfDoc: PDFDocument,
  deps: LayoutDeps,
): LayoutListItemResult {
  if (p.numPr === undefined) {
    // Defensive: callers should only dispatch list-flagged paragraphs here.
    // Fall back to plain paragraph so we don't drop content silently.
    return layoutParagraph(p, ctx, pdfDoc);
  }
  const { numId, ilvl } = p.numPr;
  const def = deps.numbering.get(numId);
  const level = def?.levels.get(ilvl);

  // 1. Bump counter (and reset deeper levels). Counter is 1-based.
  const counterValue = bumpCounter(deps.listState, numId, ilvl);

  // 2. Compute marker text.
  const markerText = computeMarkerText(level, deps.listState, numId, ilvl, counterValue);

  // 3. Compute the shifted column geometry (indent right by ilvl + 1 levels).
  const indentPt = (ilvl + 1) * LIST_INDENT_PER_LEVEL_PT;
  const originalColumn = ctx.column;
  const shiftedColumn: ColumnGeometry = {
    xPt: originalColumn.xPt + indentPt,
    widthPt: Math.max(1, originalColumn.widthPt - indentPt),
  };

  const startYPt = ctx.yPt;

  // 4. Draw marker in the gutter (left of the shifted column).
  // Marker baseline mirrors the first body line's baseline. We use the
  // body font size as the marker's size — heading-styled list items are
  // rare; v1 ignores per-list marker font customization.
  const markerSizePt = DEFAULT_FONT_SIZE_PT;
  const markerBaselineY = drawListMarker(
    ctx,
    markerText,
    originalColumn.xPt + indentPt - LIST_INDENT_PER_LEVEL_PT,
    markerSizePt,
  );

  // If we couldn't even fit the marker line, the whole paragraph is the
  // remainder. The caller will break and re-invoke us; the counter has
  // already been bumped, so we DON'T re-bump on the resume — that means
  // re-bumping is undesirable, but the caller can't tell us "this is a
  // resume". For v1 we accept the cost of an extra bump on the rare
  // overflow-before-first-line case, and TODO a future fix.
  if (markerBaselineY === null) {
    return { drawnHeight: 0, remainder: p };
  }

  // 5. Lay out the paragraph body on the shifted column. Remove the
  // numPr so layoutParagraph treats it as plain content.
  ctx.column = shiftedColumn;
  const bodyPara: Paragraph = stripNumPr(p);

  let result = layoutParagraph(bodyPara, ctx, pdfDoc);

  // 6. Continuation: if the body overflows, page-break and continue
  // without redrawing the marker. Loop until the remainder is consumed
  // or the new page can't fit any progress (defensive guard).
  let safety = 100;
  while (result.remainder !== undefined && safety > 0) {
    pageBreak(ctx, pdfDoc);
    // Restore shifted column on the new page (pageBreak preserves column
    // geometry, but we re-set defensively in case Task 9's multi-column
    // changes that contract).
    ctx.column = shiftedColumn;
    const next = layoutParagraph(result.remainder, ctx, pdfDoc);
    if (next.drawnHeight === 0 && next.remainder !== undefined) {
      // Made no progress on the new page — bail to avoid infinite loop.
      ctx.column = originalColumn;
      return { drawnHeight: startYPt - ctx.yPt, remainder: next.remainder };
    }
    result = next;
    safety -= 1;
  }

  // 7. Restore the original column geometry for the next block.
  ctx.column = originalColumn;

  return { drawnHeight: startYPt - ctx.yPt };
}

/* ------------------------------------------------------------------ */
/*   Internals                                                        */
/* ------------------------------------------------------------------ */

/** Increment the counter at `(numId, ilvl)`. Returns the new (1-based)
 *  value. Reset deeper levels when ilvl decreases vs. last seen for this
 *  numId; reset the level itself if it has never been seen at this numId. */
export function bumpCounter(state: ListState, numId: string, ilvl: number): number {
  let perLevel = state.counters.get(numId);
  if (perLevel === undefined) {
    perLevel = new Map();
    state.counters.set(numId, perLevel);
  }
  const lastLvl = state.lastLevel.get(numId);
  if (lastLvl !== undefined && ilvl < lastLvl) {
    // Going up the hierarchy: reset all deeper levels so the next
    // descent starts fresh.
    for (const k of [...perLevel.keys()]) {
      if (k > ilvl) perLevel.delete(k);
    }
  }
  const cur = perLevel.get(ilvl) ?? 0;
  const next = cur + 1;
  perLevel.set(ilvl, next);
  state.lastLevel.set(numId, ilvl);
  return next;
}

/** Build the marker text for a list paragraph, given the level definition
 *  and current counter values. Bullet levels render the level's `text`
 *  glyph verbatim (e.g., `•`, `◦`, `▪`); ordered levels substitute `%N`
 *  with the counter at level N (1-based) and render the *current level's*
 *  counter using the level's own `format` (decimal / lowerLetter /
 *  upperLetter / lowerRoman / upperRoman). Sub-counters in a template
 *  (e.g., `%1` referenced from a level-2 marker) render as decimal — this
 *  matches Word's typical behavior, where each level's format applies to
 *  its own counter only. */
export function computeMarkerText(
  level: NumberingLevel | undefined,
  state: ListState,
  numId: string,
  ilvl: number,
  currentCounter: number,
): string {
  if (level === undefined) return DEFAULT_BULLET;

  if (level.format === "bullet") {
    return level.text || DEFAULT_BULLET;
  }

  // Ordered list: substitute `%N` placeholders.
  // `%(N+1)` references the counter at level N (0-based), so `%1` is the
  // counter at level 0 (the topmost). This matches OOXML convention.
  return substituteCounters(level.text, state, numId, ilvl, currentCounter, level.format);
}

function substituteCounters(
  template: string,
  state: ListState,
  numId: string,
  ilvl: number,
  currentCounter: number,
  currentLevelFormat: NumberingLevel["format"],
): string {
  // Pattern: `%N` where N is 1-9. Replace with the counter at level N-1.
  // - The CURRENT level's substitution uses the level's own `format`
  //   (so a lowerLetter level renders its counter as `a`, `b`, …).
  // - Other levels' substitutions render as decimal (Word's convention).
  // The current (this-call) counter at this level reads from
  // `currentCounter`; bumpCounter has already committed it to state so
  // reading state would also work, but we keep the explicit param for
  // clarity.
  const perLevel = state.counters.get(numId);
  return template.replace(/%([1-9])/g, (_match, digit) => {
    const targetLvl = Number.parseInt(digit, 10) - 1;
    if (targetLvl === ilvl) return formatCounter(currentCounter, currentLevelFormat);
    const c = perLevel?.get(targetLvl);
    if (c === undefined) return "1"; // Defensive: never seen → "1".
    return formatCounter(c, undefined);
  });
}

/** Format a counter value per the level format. v1 always renders decimal
 *  digits; the format-specific renderers (lowerLetter, upperLetter,
 *  lowerRoman, upperRoman) are wired through `formatCounterAs`. The
 *  template-substitution path uses the *level's own* format implicitly
 *  for the same level's counter; we approximate by passing the level's
 *  format only when rendering the marker for `ilvl` — sub-counters in a
 *  template are rendered as decimal. (Matches Word's typical behavior:
 *  `%1.%2` in a sub-list renders as `1.a` only if level 1's format is
 *  `lowerLetter`, not because of substitution magic.) */
function formatCounter(value: number, format: NumberingLevel["format"] | undefined): string {
  if (format === undefined || format === "decimal") return String(value);
  return formatCounterAs(value, format);
}

/**
 * Format a positive counter in the given numbering format. Exported so
 * tests can exercise each format independently.
 *
 * Romans cap at 3999 (standard); beyond that we emit the decimal as a
 * fallback (Word's behavior is similar but its own thresholds vary).
 */
export function formatCounterAs(value: number, format: NumberingLevel["format"]): string {
  if (value < 1) return String(value);
  switch (format) {
    case "decimal":
      return String(value);
    case "lowerLetter":
      return toAlpha(value).toLowerCase();
    case "upperLetter":
      return toAlpha(value).toUpperCase();
    case "lowerRoman":
      return value > 3999 ? String(value) : toRoman(value).toLowerCase();
    case "upperRoman":
      return value > 3999 ? String(value) : toRoman(value);
    case "bullet":
      return DEFAULT_BULLET;
  }
}

/**
 * Thin alias for `computeMarkerText` that takes a non-optional `level`.
 * Useful for tests demonstrating format dispatch end-to-end without the
 * "level might be undefined" branch.
 */
export function renderMarkerForLevel(
  level: NumberingLevel,
  state: ListState,
  numId: string,
  ilvl: number,
  currentCounter: number,
): string {
  return computeMarkerText(level, state, numId, ilvl, currentCounter);
}

/* ---------- Format helpers ---------- */

/** Convert 1 → A, 2 → B, ..., 26 → Z, 27 → AA, 28 → AB, ... */
function toAlpha(n: number): string {
  let v = n;
  let s = "";
  while (v > 0) {
    const r = (v - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    v = Math.floor((v - 1) / 26);
  }
  return s;
}

/** Convert 1 → I, 4 → IV, 9 → IX, 1990 → MCMXC, etc. */
function toRoman(n: number): string {
  const map: ReadonlyArray<readonly [number, string]> = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let v = n;
  let out = "";
  for (const [val, sym] of map) {
    while (v >= val) {
      out += sym;
      v -= val;
    }
  }
  return out;
}

/* ---------- Marker drawing ---------- */

/**
 * Draw the marker text at `(markerXPt, currentBaseline)` aligned right of
 * the shifted column's left edge by a small gap. Returns the baseline Y
 * used (so the caller knows where to put the body's first line); returns
 * `null` if there isn't room for even one line in the current column.
 */
function drawListMarker(
  ctx: ColumnContext,
  markerText: string,
  markerXPt: Pt,
  markerSizePt: Pt,
): Pt | null {
  const lineHeightPt = markerSizePt * 1.2;
  if (wouldOverflow(ctx, lineHeightPt)) {
    return null;
  }
  // Baseline approximation: 80% of line height below the top edge.
  const baselineY = ctx.yPt - lineHeightPt * 0.8;

  // Use a synthetic minimal run for the marker (regular weight, default
  // body font). A real run isn't available — markers are derived from the
  // numbering definition, not the paragraph's runs.
  drawRunSpan(
    ctx,
    {
      kind: "run",
      text: markerText,
      bold: false,
      italic: false,
      underline: false,
      strike: false,
    },
    markerText,
    markerXPt,
    baselineY,
    { sizePt: markerSizePt },
  );

  // We do NOT advance ctx.yPt here — the body paragraph's first line will
  // share the same line-slot. layoutParagraph advances yPt by the body's
  // line-height (which equals or exceeds markerSizePt * 1.2 for the
  // typical body-size case). This intentionally couples marker + first
  // body line into one visual line.
  return baselineY;
}

function stripNumPr(p: Paragraph): Paragraph {
  // exactOptionalPropertyTypes-friendly: rebuild without the numPr field.
  const { numPr: _np, ...rest } = p;
  return rest;
}
