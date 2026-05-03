/**
 * Paragraph-level layout: heading scale, word-wrap, alignment, forced
 * breaks, and "couldn't finish in this column → return remainder."
 *
 * Pipeline per call:
 *
 *   1. Resolve heading scale (size + force-bold) from `p.styleId`.
 *   2. Walk runs left-to-right. For each run:
 *        a. If `pageBreakBefore` is set, advance the cursor via
 *           `pageBreak(...)` and continue laying out the rest of the
 *           paragraph on the new page.
 *        b. If `columnBreakBefore` is set, do the same (TODO: route to
 *           multi-column flow once Task 9 lands).
 *        c. Tokenize the run's text into words + forced-break markers
 *           (a `\n` from a soft `<w:br>`).
 *        d. Greedy-fit tokens onto the current line; on word overflow
 *           start a new line; on column overflow, persist the unprocessed
 *           tail (current run with remaining text + all later runs
 *           untouched) and return the partial draw with `remainder`.
 *   3. Apply alignment per line (left default; center / right
 *      post-position the line as a whole; justify falls back to left in
 *      v1 — TODO).
 *   4. Return `{ drawnHeight, remainder? }` so the caller can advance
 *      `yPt` and decide whether to break.
 *
 * Forced page/column breaks are handled INLINE via `pageBreak(...)`. The
 * `remainder` channel is reserved for *natural* overflow (column ran out
 * of space before the paragraph finished). The two paths never blur.
 *
 * Inline-image runs (`run.inlineImage` set) are out of scope for Task 7
 * — the orchestrator (Task 10) pre-embeds images and threads them in.
 * For now we record a TODO and skip image-only runs cleanly.
 */

import type { Paragraph, Run } from "@/engines/docx-to-pdf/docx-parser/types";
import type { PDFDocument } from "pdf-lib";
import { LINE_HEIGHT_FACTOR, drawRunSpan, measureFragment, runFontSizePt } from "./runs";
import type { ColumnContext, Pt } from "./types";
import { pageBreak, wouldOverflow } from "./y-cursor";

/** Heading-style font sizes, in pt. Indexed by level − 1 (0 = h1). */
const HEADING_SIZES_PT: ReadonlyArray<Pt> = [24, 20, 16, 14, 13, 12];

/** Vertical space (pt) reserved before a heading paragraph. Mirrors
 *  Word's typical "Heading style → space-before". */
const HEADING_SPACE_BEFORE_PT: Pt = 6;

/** Result of laying out a single paragraph. `drawnHeight` is the total
 *  vertical space consumed in the current column (including any spacing
 *  before / after lines). `remainder` is set when the paragraph couldn't
 *  finish in the column — the caller's job is to break the column / page
 *  and re-invoke `layoutParagraph` with the remainder. */
export type LayoutParagraphResult = {
  drawnHeight: Pt;
  remainder?: Paragraph;
};

/**
 * Lay a paragraph onto the current column, advancing `ctx.yPt`. Returns
 * the height consumed plus a remainder paragraph if the column ran out.
 */
export function layoutParagraph(
  p: Paragraph,
  ctx: ColumnContext,
  pdfDoc: PDFDocument,
): LayoutParagraphResult {
  const startYPt = ctx.yPt;
  const heading = headingProps(p.styleId);
  const sizeOverride = heading?.sizePt;
  const boldOverride = heading?.forceBold;

  // Apply space-before for headings.
  if (heading !== null) {
    const space = HEADING_SPACE_BEFORE_PT;
    if (wouldOverflow(ctx, space)) {
      // Out of room before we started — the whole paragraph becomes the
      // remainder. (Caller will break and re-invoke us on the new column.)
      return { drawnHeight: 0, remainder: p };
    }
    ctx.yPt -= space;
  }

  // Empty paragraph: lay one blank line at default line-height.
  if (p.runs.length === 0) {
    const blankLineHeight = (sizeOverride ?? 11) * LINE_HEIGHT_FACTOR;
    if (wouldOverflow(ctx, blankLineHeight)) {
      return { drawnHeight: startYPt - ctx.yPt, remainder: p };
    }
    ctx.yPt -= blankLineHeight;
    return { drawnHeight: startYPt - ctx.yPt };
  }

  let currentLine: LineBuf = newLine();

  for (let runIdx = 0; runIdx < p.runs.length; runIdx++) {
    const run = p.runs[runIdx];
    if (run === undefined) break;

    if (run.pageBreakBefore === true || run.columnBreakBefore === true) {
      // Flush whatever line we've built so far, then break.
      // TODO(task-9): route columnBreakBefore through multi-column flow.
      const flush = flushAndAdvance(ctx, currentLine, p.alignment);
      if (flush === "overflow") {
        return overflowAt(p, runIdx, run.text, currentLine, ctx, startYPt);
      }
      currentLine = newLine();
      pageBreak(ctx, pdfDoc);
      // The break-flagged run still needs to render — strip flags and
      // fall through to layoutRunIntoLine.
      const synth = stripBreakFlags(run);
      const outcome = layoutRunIntoLine(
        synth,
        runIdx,
        currentLine,
        ctx,
        sizeOverride,
        boldOverride,
        p.alignment,
      );
      if (outcome.kind === "overflow") {
        return makeOverflowFromTail(
          p,
          runIdx,
          outcome.tailText,
          outcome.unflushedLine,
          ctx,
          startYPt,
        );
      }
      currentLine = outcome.line;
      continue;
    }

    const outcome = layoutRunIntoLine(
      run,
      runIdx,
      currentLine,
      ctx,
      sizeOverride,
      boldOverride,
      p.alignment,
    );
    if (outcome.kind === "overflow") {
      return makeOverflowFromTail(
        p,
        runIdx,
        outcome.tailText,
        outcome.unflushedLine,
        ctx,
        startYPt,
      );
    }
    currentLine = outcome.line;
  }

  // Flush any trailing line.
  if (currentLine.fragments.length > 0) {
    const flush = flushAndAdvance(ctx, currentLine, p.alignment);
    if (flush === "overflow") {
      // The trailing line itself didn't fit. Reconstruct remainder from
      // the line-buf alone (no tail or further runs).
      return makeOverflowFromTail(p, p.runs.length, "", currentLine, ctx, startYPt);
    }
  }

  return { drawnHeight: startYPt - ctx.yPt };
}

/* ------------------------------------------------------------------ */
/* internals                                                          */
/* ------------------------------------------------------------------ */

type LineFragment = {
  run: Run;
  /** Index of `run` within `p.runs`. Used to reconstruct overflow
   *  remainders that span multiple runs on a single un-flushed line. */
  runIdx: number;
  text: string;
  /** Width in pt (already measured at the chosen size). */
  widthPt: Pt;
  /** Height (line-height) at the chosen size. */
  heightPt: Pt;
  /** Per-fragment overrides applied to the run when measuring/drawing. */
  overrides: { bold?: boolean; italic?: boolean; sizePt?: Pt };
};

type LineBuf = {
  fragments: LineFragment[];
  /** Sum of fragment widths. */
  widthPt: Pt;
  /** Max heightPt across fragments — line-height honors the tallest run
   *  on the line per the advisor's note. */
  maxHeightPt: Pt;
};

function newLine(): LineBuf {
  return { fragments: [], widthPt: 0, maxHeightPt: 0 };
}

type RunOutcome =
  | { kind: "ok"; line: LineBuf }
  | {
      kind: "overflow";
      /** The unconsumed tail of the current run's *text*, after the
       *  unflushed line content is accounted for. */
      tailText: string;
      /** The line buffer that couldn't be flushed. */
      unflushedLine: LineBuf;
    };

/**
 * Layout a single run into the current line buffer; may produce multiple
 * lines via word-wrap or `\n` forced breaks. Returns the in-progress
 * line buffer on success, or an overflow record on column underflow.
 */
function layoutRunIntoLine(
  run: Run,
  runIdx: number,
  initialLine: LineBuf,
  ctx: ColumnContext,
  sizeOverride: Pt | undefined,
  boldOverride: boolean | undefined,
  alignment: Paragraph["alignment"],
): RunOutcome {
  // Inline-image runs are out of scope for Task 7. TODO(task-10): wire
  // image embedding through the orchestrator and call drawInlineImage.
  if (run.inlineImage !== undefined) {
    return { kind: "ok", line: initialLine };
  }

  const overrides = buildOverrides(run, sizeOverride, boldOverride);
  const heightPt = (overrides.sizePt ?? runFontSizePt(run)) * LINE_HEIGHT_FACTOR;
  const colW = ctx.column.widthPt;

  let line = initialLine;
  let i = 0;
  const text = run.text;

  while (i < text.length) {
    const ch = text[i];
    if (ch === undefined) break;

    // Newline: forced line break.
    if (ch === "\n") {
      const flush = flushAndAdvance(ctx, line, alignment);
      if (flush === "overflow") {
        return { kind: "overflow", tailText: text.slice(i), unflushedLine: line };
      }
      line = newLine();
      i += 1;
      continue;
    }

    // Whitespace (other than \n): collapse a run into a single space.
    if (/\s/.test(ch)) {
      let j = i + 1;
      while (j < text.length) {
        const c2 = text[j];
        if (c2 === undefined) break;
        if (c2 === "\n" || !/\s/.test(c2)) break;
        j += 1;
      }
      const wsText = " ";
      const wsW = measureFragment(wsText, run, ctx.fonts, overrides);
      if (line.widthPt + wsW <= colW + 1e-6 && line.fragments.length > 0) {
        pushFragment(line, run, runIdx, wsText, wsW, heightPt, overrides);
      }
      // Else: trailing whitespace at end of line — drop. (Or whitespace at
      // start of a fresh line — also drop.)
      i = j;
      continue;
    }

    // Word: greedy run of non-whitespace.
    let j = i + 1;
    while (j < text.length) {
      const c2 = text[j];
      if (c2 === undefined) break;
      if (c2 === "\n" || /\s/.test(c2)) break;
      j += 1;
    }
    const word = text.slice(i, j);
    const wordW = measureFragment(word, run, ctx.fonts, overrides);

    // Case A: word fits on the current line.
    if (line.widthPt + wordW <= colW + 1e-6) {
      pushFragment(line, run, runIdx, word, wordW, heightPt, overrides);
      i = j;
      continue;
    }

    // Case B: word doesn't fit on current line, but fits on a fresh line.
    if (wordW <= colW + 1e-6) {
      const flush = flushAndAdvance(ctx, line, alignment);
      if (flush === "overflow") {
        return { kind: "overflow", tailText: text.slice(i), unflushedLine: line };
      }
      line = newLine();
      pushFragment(line, run, runIdx, word, wordW, heightPt, overrides);
      i = j;
      continue;
    }

    // Case C: oversized word — char-by-char.
    if (line.fragments.length > 0) {
      // Flush current line first, then split on a fresh line.
      const flush = flushAndAdvance(ctx, line, alignment);
      if (flush === "overflow") {
        return { kind: "overflow", tailText: text.slice(i), unflushedLine: line };
      }
      line = newLine();
    }
    let cursor = 0;
    while (cursor < word.length) {
      const piece = takeFittingPrefix(word, cursor, run, ctx, overrides, colW);
      if (piece.length === 0) break; // defensive; takeFittingPrefix guarantees ≥1
      const pieceW = measureFragment(piece, run, ctx.fonts, overrides);
      pushFragment(line, run, runIdx, piece, pieceW, heightPt, overrides);
      cursor += piece.length;
      if (cursor < word.length) {
        const flush = flushAndAdvance(ctx, line, alignment);
        if (flush === "overflow") {
          // Re-inject the un-split tail of `word` plus the rest of run.text.
          const unsplit = word.slice(cursor) + text.slice(j);
          return {
            kind: "overflow",
            tailText: unsplit,
            unflushedLine: line,
          };
        }
        line = newLine();
      }
    }
    i = j;
  }

  return { kind: "ok", line };
}

function pushFragment(
  line: LineBuf,
  run: Run,
  runIdx: number,
  text: string,
  widthPt: Pt,
  heightPt: Pt,
  overrides: { bold?: boolean; italic?: boolean; sizePt?: Pt },
): void {
  line.fragments.push({ run, runIdx, text, widthPt, heightPt, overrides });
  line.widthPt += widthPt;
  if (heightPt > line.maxHeightPt) line.maxHeightPt = heightPt;
}

/** Try to flush a line. Returns "overflow" when the line height
 *  exceeds remaining column space (without advancing yPt). On "ok" the
 *  line is drawn and yPt is decreased by line height. Empty lines are a
 *  no-op (return "ok" with no draw). */
function flushAndAdvance(
  ctx: ColumnContext,
  line: LineBuf,
  alignment: Paragraph["alignment"],
): "ok" | "overflow" {
  if (line.fragments.length === 0) return "ok";
  const lineHeight = line.maxHeightPt;
  if (wouldOverflow(ctx, lineHeight)) return "overflow";
  drawLine(ctx, line, alignment);
  ctx.yPt -= lineHeight;
  return "ok";
}

/**
 * Draw the fragments of a line, starting at the column's left edge with
 * an offset for center / right alignment. Justified alignment falls back
 * to left in v1 — TODO(post-task-7): proper justified word-spacing.
 */
function drawLine(ctx: ColumnContext, line: LineBuf, alignment: Paragraph["alignment"]): void {
  const slack = ctx.column.widthPt - line.widthPt;
  let xOffset: Pt;
  switch (alignment) {
    case "center":
      xOffset = Math.max(0, slack / 2);
      break;
    case "right":
      xOffset = Math.max(0, slack);
      break;
    case "justify":
      // TODO(post-task-7): inter-word spacing distribution. Falls back
      // to left alignment for v1.
      xOffset = 0;
      break;
    default:
      xOffset = 0;
  }
  let xPt = ctx.column.xPt + xOffset;
  for (const frag of line.fragments) {
    // Approximate ascent as 80% of line-height (Latin fonts) — close
    // enough to keep glyphs above descenders for our subset fonts.
    const ascent = frag.heightPt * 0.8;
    const baselineY = ctx.yPt - ascent;
    drawRunSpan(ctx, frag.run, frag.text, xPt, baselineY, frag.overrides);
    xPt += frag.widthPt;
  }
}

/** Char-by-char prefix extraction: greatest prefix of `word.slice(start)`
 *  that fits within `colW`. Always returns at least one character to
 *  avoid infinite loops on extreme cases. */
function takeFittingPrefix(
  word: string,
  start: number,
  run: Run,
  ctx: ColumnContext,
  overrides: { bold?: boolean; italic?: boolean; sizePt?: Pt },
  colW: Pt,
): string {
  let fit = "";
  for (let k = start; k < word.length; k++) {
    const candidate = fit + word[k];
    const w = measureFragment(candidate, run, ctx.fonts, overrides);
    if (w > colW + 1e-6 && fit.length > 0) break;
    fit = candidate;
    if (w > colW + 1e-6) break; // single char already overflows; accept and stop
  }
  return fit;
}

/* ---------- Heading scale ---------- */

function headingProps(styleId: string | undefined): { sizePt: Pt; forceBold: boolean } | null {
  if (styleId === undefined) return null;
  const m = /^Heading([1-6])$/.exec(styleId);
  if (m === null) return null;
  const level = Number.parseInt(m[1] ?? "1", 10);
  const idx = Math.min(Math.max(level - 1, 0), HEADING_SIZES_PT.length - 1);
  const sizePt = HEADING_SIZES_PT[idx] ?? 12;
  return { sizePt, forceBold: true };
}

/* ---------- Overrides ---------- */

function buildOverrides(
  run: Run,
  sizeOverride: Pt | undefined,
  boldOverride: boolean | undefined,
): { bold?: boolean; italic?: boolean; sizePt?: Pt } {
  const result: { bold?: boolean; italic?: boolean; sizePt?: Pt } = {};
  // Heading size override applies only when the run carries no explicit
  // fontSizePt (per the brief: "default scale … in absence of explicit
  // runProps.fontSizePt").
  if (sizeOverride !== undefined && run.fontSizePt === undefined) {
    result.sizePt = sizeOverride;
  }
  // Heading bold override forces bold on heading runs (advisor: heading
  // forces bold; explicit non-bold runs in headings are rare).
  if (boldOverride === true) {
    result.bold = true;
  }
  return result;
}

function stripBreakFlags(run: Run): Run {
  // exactOptionalPropertyTypes: avoid setting flags to undefined; rebuild
  // without them.
  const { pageBreakBefore: _pb, columnBreakBefore: _cb, ...rest } = run;
  return rest;
}

/* ---------- Overflow / remainder ---------- */

/** When overflow is detected at a flush boundary inside `layoutRunIntoLine`,
 *  build the paragraph remainder by:
 *   1. Group the unflushed line's fragments by their original run-index.
 *      Each group's joined text becomes the prefix of that run's
 *      remainder text. Earlier-run fragments produce extra leading runs;
 *      later-run fragments don't exist (we don't pre-place them).
 *   2. Append the current run's remaining `tailText` after the line-buf
 *      tail for run `currentRunIdx`.
 *   3. Append all `p.runs[currentRunIdx + 1 ..]` verbatim.
 *
 *  Caller passes `currentRunIdx === p.runs.length` and `tailText === ""`
 *  for the trailing-line-flush overflow case, where only the line buffer
 *  needs to be re-converted.
 */
function makeOverflowFromTail(
  p: Paragraph,
  currentRunIdx: number,
  tailText: string,
  unflushedLine: LineBuf,
  ctx: ColumnContext,
  startYPt: Pt,
): LayoutParagraphResult {
  // Group fragment text by runIdx, preserving order.
  const groups = new Map<number, { run: Run; text: string }>();
  for (const frag of unflushedLine.fragments) {
    const existing = groups.get(frag.runIdx);
    if (existing === undefined) {
      groups.set(frag.runIdx, { run: frag.run, text: frag.text });
    } else {
      existing.text += frag.text;
    }
  }

  const remainderRuns: Run[] = [];

  // Earlier-run fragments (runIdx < currentRunIdx) contribute leading
  // runs in the remainder. Iterate in ascending order.
  const sortedGroupIdxs = [...groups.keys()].sort((a, b) => a - b);
  for (const idx of sortedGroupIdxs) {
    if (idx >= currentRunIdx) continue;
    const g = groups.get(idx);
    if (g === undefined) continue;
    remainderRuns.push({ ...g.run, text: g.text });
  }

  // The current run's remainder = its line-buf tail + un-tokenized tail.
  if (currentRunIdx < p.runs.length) {
    const currentRun = p.runs[currentRunIdx];
    if (currentRun !== undefined) {
      const lineTail = groups.get(currentRunIdx)?.text ?? "";
      const fullText = lineTail + tailText;
      if (fullText.length > 0) {
        remainderRuns.push({ ...currentRun, text: fullText });
      }
    }
  }

  // Later runs verbatim.
  for (let k = currentRunIdx + 1; k < p.runs.length; k++) {
    const r = p.runs[k];
    if (r !== undefined) remainderRuns.push(r);
  }

  return {
    drawnHeight: startYPt - ctx.yPt,
    remainder: { ...p, runs: remainderRuns },
  };
}

/**
 * Variant for the "overflow before line was even started" case
 * (forced-break flush ahead of the run we couldn't flush). Caller
 * supplies the run's text wholesale; line buffer is the unflushed one.
 */
function overflowAt(
  p: Paragraph,
  currentRunIdx: number,
  remainingText: string,
  unflushedLine: LineBuf,
  ctx: ColumnContext,
  startYPt: Pt,
): LayoutParagraphResult {
  return makeOverflowFromTail(p, currentRunIdx, remainingText, unflushedLine, ctx, startYPt);
}
