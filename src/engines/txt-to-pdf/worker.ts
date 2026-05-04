import { DEFAULT_MARGIN_PT, getPageDimensions } from "@/engines/_shared/pdf-page-setup";
import type { OutputItem } from "@/engines/_shared/types";
import { loadFontByFilename } from "@/lib/font-loader";
import fontkit from "@pdf-lib/fontkit";
import * as Comlink from "comlink";
import { PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib";
import type { TxtToPdfOptions } from "./options";
import { wrapLine } from "./wrap";

const FONT_SIZE_PT = 11;
const LINE_HEIGHT_PT = 14;
/**
 * JetBrains Mono is a fixed-pitch font. 0.6× the font size is a reliable
 * approximation of the advance width for glyphs at standard sizes.
 * Using this fixed ratio (instead of font.widthOfTextAtSize) sidesteps the
 * fontkit crash on ligature sequences like "//", "=>", "!=", "||", "&&".
 */
const MONO_CHAR_ADVANCE_RATIO = 0.6;

function replaceExt(name: string, newExt: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}.${newExt}`;
  return `${name.slice(0, dot)}.${newExt}`;
}

function expandTabs(line: string): string {
  return line.replace(/\t/g, "    ");
}

/**
 * Draw mono-font text character-by-character to sidestep fontkit's failure
 * on JetBrains Mono ligature glyphs (e.g., "//", "=>", "!=", "||", "&&").
 * Returns the new cursor x position after the last character.
 */
function drawMonoText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  size: number,
  font: PDFFont,
): number {
  let cursor = x;
  for (const ch of text) {
    try {
      page.drawText(ch, { x: cursor, y, size, font, color: rgb(0, 0, 0) });
      cursor += font.widthOfTextAtSize(ch, size);
    } catch {
      // Fallback: use a fixed monospace advance (0.6× size) when fontkit
      // fails on a ligature glyph.
      cursor += size * MONO_CHAR_ADVANCE_RATIO;
    }
  }
  return cursor;
}

/**
 * Render decoded text to a PDF byte array.
 * Exported so worker.test.ts can call it directly without spawning a Worker.
 */
export async function renderTxtToPdf(
  text: string,
  opts: TxtToPdfOptions,
  fontBytes: ArrayBuffer,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes);

  const [pageW, pageH] = getPageDimensions(opts.pageSize);
  const margin = DEFAULT_MARGIN_PT;
  const contentW = pageW - margin * 2;
  const topY = pageH - margin;
  const bottomY = margin;

  // Compute column count using the same fixed advance ratio used by wrapLine.
  const maxColumns = Math.floor(contentW / (FONT_SIZE_PT * MONO_CHAR_ADVANCE_RATIO));

  let page = pdf.addPage([pageW, pageH]);
  let y = topY;

  function newPage() {
    page = pdf.addPage([pageW, pageH]);
    y = topY;
  }

  const rawLines = text.split("\n");
  for (const rawLine of rawLines) {
    const expanded = expandTabs(rawLine);
    const visualLines = wrapLine(expanded, maxColumns);
    for (const visualLine of visualLines) {
      if (y - LINE_HEIGHT_PT < bottomY) newPage();
      drawMonoText(page, visualLine, margin, y - FONT_SIZE_PT, FONT_SIZE_PT, font);
      y -= LINE_HEIGHT_PT;
    }
  }

  return await pdf.save();
}

Comlink.expose({
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    _type: string,
    opts: TxtToPdfOptions,
  ): Promise<OutputItem> {
    const text = new TextDecoder("utf-8").decode(bytes);
    const fontBytes = await loadFontByFilename("jetbrains-mono-regular.ttf");
    const pdfBytes = await renderTxtToPdf(text, opts, fontBytes);
    const blob = new Blob([pdfBytes as BlobPart], { type: "application/pdf" });
    return {
      filename: replaceExt(name, "pdf"),
      mime: "application/pdf",
      blob,
    };
  },
});
