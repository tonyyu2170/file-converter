/**
 * Shared test helpers for the layout module. Builds mock fonts, mock
 * pages, and `ColumnContext` instances without requiring a real
 * `PDFDocument` (which is expensive to instantiate in jsdom).
 *
 * The mock font width formula `text.length * size * 0.55` is a rough
 * proxy for typical Latin text — close enough for word-wrap math while
 * keeping assertions deterministic. Tests that need a real width should
 * stand up a real `PDFDocument` (only `images.test.ts` does this).
 */

import type { PDFFont, PDFPage } from "pdf-lib";
import type { ColumnContext, ColumnGeometry, EmbeddedFonts, PageGeometry } from "./types";

/** Recorded call on the mock page. Tests assert on this array. */
export type MockPageCall =
  | {
      op: "drawText";
      text: string;
      x: number;
      y: number;
      size: number;
      font: PDFFont;
      color?: unknown;
    }
  | {
      op: "drawLine";
      start: { x: number; y: number };
      end: { x: number; y: number };
      thickness: number;
      color?: unknown;
    }
  | {
      op: "drawRectangle";
      x: number;
      y: number;
      width: number;
      height: number;
      color?: unknown;
      borderColor?: unknown;
      borderWidth?: number;
    }
  | { op: "drawImage"; x: number; y: number; width: number; height: number };

/** Mock pdf-lib `PDFPage` that records all draw calls into an array. */
export type MockPage = PDFPage & {
  __calls: MockPageCall[];
};

export function makeMockPage(): MockPage {
  const calls: MockPageCall[] = [];
  const page = {
    __calls: calls,
    drawText(
      text: string,
      opts: { x: number; y: number; size: number; font: PDFFont; color?: unknown },
    ) {
      calls.push({
        op: "drawText",
        text,
        x: opts.x,
        y: opts.y,
        size: opts.size,
        font: opts.font,
        ...(opts.color !== undefined && { color: opts.color }),
      });
    },
    drawLine(opts: {
      start: { x: number; y: number };
      end: { x: number; y: number };
      thickness: number;
      color?: unknown;
    }) {
      calls.push({
        op: "drawLine",
        start: opts.start,
        end: opts.end,
        thickness: opts.thickness,
        ...(opts.color !== undefined && { color: opts.color }),
      });
    },
    drawRectangle(opts: {
      x: number;
      y: number;
      width: number;
      height: number;
      color?: unknown;
      borderColor?: unknown;
      borderWidth?: number;
    }) {
      calls.push({
        op: "drawRectangle",
        x: opts.x,
        y: opts.y,
        width: opts.width,
        height: opts.height,
        ...(opts.color !== undefined && { color: opts.color }),
        ...(opts.borderColor !== undefined && { borderColor: opts.borderColor }),
        ...(opts.borderWidth !== undefined && { borderWidth: opts.borderWidth }),
      });
    },
    drawImage(_img: unknown, opts: { x: number; y: number; width: number; height: number }) {
      calls.push({
        op: "drawImage",
        x: opts.x,
        y: opts.y,
        width: opts.width,
        height: opts.height,
      });
    },
    getSize() {
      return { width: 612, height: 792 };
    },
  } as unknown as MockPage;
  return page;
}

/** Mock pdf-lib `PDFFont`. Width = `text.length * size * 0.55`, height =
 *  `size * 1.2`. Sufficient for word-wrap math; deterministic. */
export function makeMockFont(label = "mock"): PDFFont {
  const font = {
    __label: label,
    widthOfTextAtSize(text: string, size: number) {
      return text.length * size * 0.55;
    },
    heightAtSize(size: number) {
      return size * 1.2;
    },
  } as unknown as PDFFont;
  return font;
}

/**
 * Stand up a stub `PDFDocument` for tests that exercise `pageBreak`.
 * Real `PDFDocument.addPage` returns a real `PDFPage` that won't accept
 * our mock fonts in `drawText`. The stub returns fresh `MockPage`s and
 * tracks them, so callers can:
 *   - assert the page count via `__pages.length`
 *   - inspect each page's draw calls via `__pages[n].__calls`
 */
export type MockPdfDoc = {
  /** The pages added so far (most-recent last). Tests inspect this. */
  __pages: MockPage[];
  addPage(_size?: [number, number]): MockPage;
};

export function makeMockPdfDoc(): MockPdfDoc {
  const pages: MockPage[] = [];
  return {
    __pages: pages,
    addPage(_size?: [number, number]) {
      const p = makeMockPage();
      pages.push(p);
      return p;
    },
  };
}

/** Builds a full `EmbeddedFonts` group of mocks. Each font carries a
 *  unique `__label` so tests can assert which slot was selected. */
export function makeMockEmbeddedFonts(): EmbeddedFonts {
  return {
    inter: {
      regular: makeMockFont("inter-regular"),
      bold: makeMockFont("inter-bold"),
      italic: makeMockFont("inter-italic"),
      boldItalic: makeMockFont("inter-bold-italic"),
    },
    lora: {
      regular: makeMockFont("lora-regular"),
      bold: makeMockFont("lora-bold"),
      italic: makeMockFont("lora-italic"),
      boldItalic: makeMockFont("lora-bold-italic"),
    },
    jetbrainsMono: {
      regular: makeMockFont("jetbrains-mono-regular"),
      bold: makeMockFont("jetbrains-mono-bold"),
    },
  };
}

/** Letter portrait, 1-inch margins. */
export const LETTER_PORTRAIT: PageGeometry = {
  widthPt: 612,
  heightPt: 792,
  marginTopPt: 72,
  marginRightPt: 72,
  marginBottomPt: 72,
  marginLeftPt: 72,
};

/** Single column from a `PageGeometry`. */
export function singleColumn(geo: PageGeometry): ColumnGeometry {
  return {
    xPt: geo.marginLeftPt,
    widthPt: geo.widthPt - geo.marginLeftPt - geo.marginRightPt,
  };
}

export type ContextOverrides = {
  pageGeometry?: PageGeometry;
  column?: ColumnGeometry;
  fonts?: EmbeddedFonts;
  /** Override y-bounds. Default uses the body area between top/bottom margins. */
  maxYPt?: number;
  minYPt?: number;
  /** Initial y-cursor; defaults to `maxYPt`. */
  yPt?: number;
};

/** Build a `ColumnContext` with sensible defaults; override individual
 *  fields per-test as needed. */
export function makeColumnContext(overrides: ContextOverrides = {}): ColumnContext {
  const pageGeometry = overrides.pageGeometry ?? LETTER_PORTRAIT;
  const column = overrides.column ?? singleColumn(pageGeometry);
  const fonts = overrides.fonts ?? makeMockEmbeddedFonts();
  const maxYPt = overrides.maxYPt ?? pageGeometry.heightPt - pageGeometry.marginTopPt;
  const minYPt = overrides.minYPt ?? pageGeometry.marginBottomPt;
  const yPt = overrides.yPt ?? maxYPt;
  return {
    page: makeMockPage(),
    pageGeometry,
    column,
    fonts,
    maxYPt,
    minYPt,
    yPt,
  };
}
