import { DEFAULT_MARGIN_PT, getPageDimensions } from "@/engines/_shared/pdf-page-setup";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib";
import type { Block, Run } from "./blocks";
import { highlightCodeBlock } from "./highlight";
import type { MarkdownToPdfOptions } from "./options";

export type RendererFonts = {
  body: ArrayBuffer | Uint8Array;
  headings: ArrayBuffer | Uint8Array;
  mono: ArrayBuffer | Uint8Array;
};

const HEADING_SIZES_PT: Record<1 | 2 | 3 | 4 | 5 | 6, number> = {
  1: 32,
  2: 26,
  3: 22,
  4: 18,
  5: 16,
  6: 14,
};

const BODY_SIZE_PT = 11;
const BODY_LINE_HEIGHT_PT = 14;
const CODE_SIZE_PT = 10;
const CODE_LINE_HEIGHT_PT = 13;

export async function renderBlocksToPdf(
  blocks: Block[],
  opts: MarkdownToPdfOptions,
  fonts: RendererFonts,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const bodyFont = await pdf.embedFont(fonts.body);
  const headingsFont = await pdf.embedFont(fonts.headings);
  const monoFont = await pdf.embedFont(fonts.mono);

  const [pageW, pageH] = getPageDimensions(opts.pageSize);
  const margin = DEFAULT_MARGIN_PT;
  const contentW = pageW - margin * 2;
  const topY = pageH - margin;
  const bottomY = margin;

  let page = pdf.addPage([pageW, pageH]);
  let y = topY;

  function newPage() {
    page = pdf.addPage([pageW, pageH]);
    y = topY;
  }

  function ensureSpace(needed: number) {
    if (y - needed < bottomY) newPage();
  }

  for (const block of blocks) {
    if (block.type === "hr") {
      ensureSpace(8);
      page.drawLine({
        start: { x: margin, y: y - 4 },
        end: { x: margin + contentW, y: y - 4 },
        thickness: 0.5,
        color: rgb(0.5, 0.5, 0.5),
      });
      y -= 12;
      continue;
    }

    if (block.type === "image") {
      const text = `[image: ${block.alt}]`;
      ensureSpace(BODY_LINE_HEIGHT_PT);
      page.drawText(text, {
        x: margin,
        y: y - BODY_SIZE_PT,
        size: BODY_SIZE_PT,
        font: bodyFont,
        color: rgb(0.5, 0.5, 0.5),
      });
      y -= BODY_LINE_HEIGHT_PT + 4;
      continue;
    }

    if (block.type === "code-block") {
      const lineH = CODE_LINE_HEIGHT_PT;
      const tokenLines = highlightCodeBlock(block.text, block.language);
      for (const tokens of tokenLines) {
        ensureSpace(lineH);
        let cursor = margin + 8;
        for (const tok of tokens) {
          // JetBrains Mono has ligature glyphs (e.g., "//", "=>") that
          // fontkit fails to measure/render in some environments. Draw
          // character-by-character to bypass ligature lookup.
          cursor = drawMonoText(
            page,
            tok.text,
            cursor,
            y - CODE_SIZE_PT,
            CODE_SIZE_PT,
            monoFont,
            rgb(tok.color[0], tok.color[1], tok.color[2]),
          );
        }
        y -= lineH;
      }
      y -= 6; // block padding
      continue;
    }

    if (block.type === "heading") {
      const size = HEADING_SIZES_PT[block.level];
      const lineH = size * 1.25;
      ensureSpace(lineH + 6);
      const text = block.runs.map((r) => r.text).join("");
      page.drawText(text, {
        x: margin,
        y: y - size,
        size,
        font: headingsFont,
      });
      y -= lineH + 6;
      continue;
    }

    if (block.type === "blockquote") {
      const indent = 24;
      const wrapped = wrapRuns(block.runs, contentW - indent, bodyFont, monoFont, BODY_SIZE_PT);
      for (const lineRuns of wrapped) {
        ensureSpace(BODY_LINE_HEIGHT_PT);
        drawRunsLine(
          page,
          lineRuns,
          margin + indent,
          y - BODY_SIZE_PT,
          bodyFont,
          monoFont,
          BODY_SIZE_PT,
        );
        y -= BODY_LINE_HEIGHT_PT;
      }
      y -= 4;
      continue;
    }

    if (block.type === "list-item") {
      const indent = 18;
      ensureSpace(BODY_LINE_HEIGHT_PT);
      page.drawText("·", {
        x: margin + 4,
        y: y - BODY_SIZE_PT,
        size: BODY_SIZE_PT,
        font: bodyFont,
      });
      const wrapped = wrapRuns(block.runs, contentW - indent, bodyFont, monoFont, BODY_SIZE_PT);
      for (const lineRuns of wrapped) {
        ensureSpace(BODY_LINE_HEIGHT_PT);
        drawRunsLine(
          page,
          lineRuns,
          margin + indent,
          y - BODY_SIZE_PT,
          bodyFont,
          monoFont,
          BODY_SIZE_PT,
        );
        y -= BODY_LINE_HEIGHT_PT;
      }
      y -= 2;
      continue;
    }

    // paragraph
    const wrapped = wrapRuns(block.runs, contentW, bodyFont, monoFont, BODY_SIZE_PT);
    for (const lineRuns of wrapped) {
      ensureSpace(BODY_LINE_HEIGHT_PT);
      drawRunsLine(page, lineRuns, margin, y - BODY_SIZE_PT, bodyFont, monoFont, BODY_SIZE_PT);
      y -= BODY_LINE_HEIGHT_PT;
    }
    y -= 4;
  }

  return await pdf.save();
}

/**
 * Measure mono-font text character-by-character to sidestep fontkit's
 * failure on ligature glyphs (e.g., "//" and "=>" in JetBrains Mono).
 * Uses the same fallback width (0.6× size) as drawMonoText.
 */
function measureMonoText(text: string, size: number, font: PDFFont): number {
  let width = 0;
  for (const ch of text) {
    try {
      width += font.widthOfTextAtSize(ch, size);
    } catch {
      width += size * 0.6;
    }
  }
  return width;
}

/**
 * Draw mono-font text character-by-character to sidestep fontkit's
 * failure on ligature glyphs (e.g., "//" and "=>" in JetBrains Mono).
 * Returns the new cursor x position after the text.
 */
function drawMonoText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  size: number,
  font: PDFFont,
  color: ReturnType<typeof rgb>,
): number {
  let cursor = x;
  for (const ch of text) {
    try {
      page.drawText(ch, { x: cursor, y, size, font, color });
      cursor += font.widthOfTextAtSize(ch, size);
    } catch {
      // Fallback: use a fixed monospace width (0.6× size is a reliable
      // approximation for most monospace fonts at standard sizes).
      cursor += size * 0.6;
    }
  }
  return cursor;
}

// Naive run-flow wrap: split each run by spaces, accumulate words until
// width exceeds the limit, then start a new line. Code runs use mono font.
function wrapRuns(
  runs: Run[],
  maxWidth: number,
  bodyFont: PDFFont,
  monoFont: PDFFont,
  size: number,
): Run[][] {
  const lines: Run[][] = [];
  let current: Run[] = [];
  let currentWidth = 0;

  for (const run of runs) {
    const words = run.text.split(/(\s+)/);
    for (const word of words) {
      if (!word) continue;
      const w = run.style.code
        ? measureMonoText(word, size, monoFont)
        : bodyFont.widthOfTextAtSize(word, size);
      if (currentWidth + w > maxWidth && current.length > 0) {
        lines.push(current);
        current = [];
        currentWidth = 0;
        if (/^\s+$/.test(word)) continue;
      }
      current.push({ text: word, style: run.style });
      currentWidth += w;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function drawRunsLine(
  page: PDFPage,
  runs: Run[],
  x: number,
  y: number,
  bodyFont: PDFFont,
  monoFont: PDFFont,
  size: number,
) {
  let cursorX = x;
  for (const run of runs) {
    const text = run.text;
    const isLink = !!run.style.link;
    const color = isLink ? rgb(0.0, 0.5, 0.7) : rgb(0, 0, 0);
    let w: number;
    if (run.style.code) {
      // Draw char-by-char to bypass JetBrains Mono ligature crash
      const endX = drawMonoText(page, text, cursorX, y, size, monoFont, color);
      w = endX - cursorX;
    } else {
      page.drawText(text, { x: cursorX, y, size, font: bodyFont, color });
      w = bodyFont.widthOfTextAtSize(text, size);
    }
    if (isLink) {
      page.drawLine({
        start: { x: cursorX, y: y - 1 },
        end: { x: cursorX + w, y: y - 1 },
        thickness: 0.5,
        color,
      });
    }
    cursorX += w;
  }

  // After the line, if any link's URL differs from its text, append "(href)"
  // at the end of the line in muted color.
  for (const run of runs) {
    if (run.style.link?.href && run.style.link.href !== run.text) {
      const text = ` (${run.style.link.href})`;
      const w = bodyFont.widthOfTextAtSize(text, size);
      page.drawText(text, {
        x: cursorX,
        y,
        size,
        font: bodyFont,
        color: rgb(0.4, 0.4, 0.4),
      });
      cursorX += w;
    }
  }
}
