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

/**
 * Recorded link-annotation entry on the mock page. Tests assert on this
 * array. The `link` field captures the dictionary literal passed to
 * `page.doc.context.obj(...)` so tests can inspect URI vs Dest links.
 */
export type MockAnnotation = {
  rect: [number, number, number, number];
  // biome-ignore lint/suspicious/noExplicitAny: mock captures arbitrary literal
  dict: any;
};

/** Mock pdf-lib `PDFPage` that records all draw calls into an array.
 *  Also exposes a partial `doc.context` and `node.addAnnot` so the
 *  hyperlink module can use the real pdf-lib annotation pattern in tests. */
export type MockPage = PDFPage & {
  __calls: MockPageCall[];
  __annotations: MockAnnotation[];
};

export function makeMockPage(): MockPage {
  const calls: MockPageCall[] = [];
  const annotations: MockAnnotation[] = [];
  const page = {
    __calls: calls,
    __annotations: annotations,
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

  // Partial `doc.context` + `node.addAnnot` shim wired so that calling
  // `page.doc.context.register(page.doc.context.obj({...})); page.node.addAnnot(ref)`
  // surfaces the dict literal in `page.__annotations`. The shim:
  //   - `obj(literal)` wraps the literal in a tagged ref carrier and
  //     stashes the literal on the carrier so `register` can read it.
  //   - `register(carrier)` returns the same carrier, marking it registered
  //     and pushing it onto a "pending" queue.
  //   - `addAnnot(ref)` pops the pending queue (or accepts the carrier as
  //     `ref`) and pushes its rect + dict into `__annotations`.
  // Production code uses pdf-lib's real APIs; tests rely on the shim.
  type ObjCarrier = {
    __literal: { Rect?: [number, number, number, number]; [k: string]: unknown };
  };
  const pendingDicts: ObjCarrier[] = [];
  const ctxShim = {
    // biome-ignore lint/suspicious/noExplicitAny: shim accepts arbitrary literal
    obj(literal: any): ObjCarrier {
      return { __literal: literal };
    },
    register(carrier: ObjCarrier): ObjCarrier {
      pendingDicts.push(carrier);
      return carrier;
    },
  };
  // Recursively unwrap nested `__literal` carriers produced by `obj`. This
  // lets test assertions inspect the dict like a flat object: `A.S` rather
  // than `A.__literal.S`. Production pdf-lib does the equivalent
  // automatically because `obj` wraps each level into PDFDict.
  // biome-ignore lint/suspicious/noExplicitAny: shim accepts arbitrary literal
  function unwrap(value: any): any {
    if (value && typeof value === "object" && "__literal" in value) {
      return unwrap(value.__literal);
    }
    if (Array.isArray(value)) return value.map(unwrap);
    if (value && typeof value === "object") {
      // biome-ignore lint/suspicious/noExplicitAny: dict literal recursion
      const out: Record<string, any> = {};
      for (const k of Object.keys(value)) out[k] = unwrap(value[k]);
      return out;
    }
    return value;
  }
  const nodeShim = {
    addAnnot(ref: ObjCarrier): void {
      // ref is the same carrier register() returned. Drain the matching
      // entry from the pending queue (in practice the most recent one).
      const idx = pendingDicts.indexOf(ref);
      if (idx >= 0) pendingDicts.splice(idx, 1);
      const lit = unwrap(ref.__literal ?? {});
      const rect = (lit.Rect as [number, number, number, number] | undefined) ?? [0, 0, 0, 0];
      annotations.push({ rect, dict: lit });
    },
  };
  // Attach via Object.defineProperty since these are read-only on the
  // real PDFPage. The cast lets us bypass the type system for the shim.
  Object.defineProperty(page, "doc", { value: { context: ctxShim }, writable: false });
  Object.defineProperty(page, "node", { value: nodeShim, writable: false });

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
