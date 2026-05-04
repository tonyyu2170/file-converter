/**
 * Layout orchestrator — `layoutDocument(parsed)`.
 *
 * Drives the full ParsedDocx → PDF-bytes pipeline:
 *
 *   1. Create a fresh `PDFDocument`, register fontkit, embed all 10
 *      bundled font slots (Inter ×4, Lora ×4, JetBrains Mono ×2).
 *   2. Pre-embed every PNG/JPEG asset in `parsed.media` as a `PDFImage`
 *      keyed by zip-relative path. Failures (corrupt bytes, unsupported
 *      format) accumulate as `image skipped: …` warnings.
 *   3. Build the orchestrator-scoped `LayoutDeps` with:
 *      - `numbering`, `relationships` from the parser.
 *      - Fresh `listState` and `warnings` accumulators.
 *      - `embeddedImages` map + `resolveImagePath` callback (rId → path).
 *      - `onFootnoteRef` callback bound to a `FootnoteAccumulator`.
 *   4. For each section:
 *      - Pre-walk the section's blocks to collect footnote refs.
 *      - Estimate section-wide footnote-area reservation (a single
 *        `Pt` value passed through `MultiColumnInput`).
 *      - Snapshot `pdfDoc.getPageCount()` before, call `layoutSection`,
 *        diff after to obtain the page refs added.
 *      - Post-walk those page refs: render header/footer per page +
 *        flush any registered footnotes.
 *   5. After all sections: render endnote pages (if any).
 *   6. Save → `Uint8Array`. Dedupe warnings; merge with parser warnings.
 *
 * Async surface: `layoutDocument` is the only `async` in the layout
 * tree. Async work is font fetching, fontkit embedding, and image
 * embedding — all I/O / pdf-lib internals. Every helper called during
 * the section walk is sync.
 *
 * Test injection:
 *   `layoutDocument(parsed, { loadFont })` lets tests substitute the
 *   default `loadFontBytes` (which calls `fetch("/fonts/...")`) with
 *   an fs-backed reader. The worker (Task 12) calls without overrides.
 */

import type { ParsedDocx, RelationshipTarget } from "@/engines/_shared/docx";
import { loadFontBytes as defaultLoadFontBytes } from "@/lib/font-loader";
import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument as PDFDocumentType, PDFImage, PDFPage } from "pdf-lib";
import { PDFDocument } from "pdf-lib";
import type { BundledFontFamily, FontWeight } from "../fonts/types";
import type { LayoutDeps } from "./block-dispatch";
import {
  collectFootnoteRefsInBlocks,
  estimateSectionFootnoteHeight,
  flushFootnoteAreaToPage,
  newFootnoteAccumulator,
  registerMarker,
  renderEndnotePages,
} from "./footnotes";
import { renderFooterForPage, renderHeaderForPage } from "./headers-footers";
import { embedInlineImage, sniffImageFormat } from "./images";
import { layoutSection } from "./multi-column";
import type { EmbeddedFonts, PageGeometry } from "./types";
import { dedupe, imageSkippedWarning } from "./warnings";

/* ------------------------------------------------------------------ */
/*   Public API                                                       */
/* ------------------------------------------------------------------ */

export type LayoutDocumentResult = {
  pdfBytes: Uint8Array;
  warnings: string[];
};

/** Async font loader injection signature — matches `loadFontBytes`. */
export type LoadFontFn = (
  family: BundledFontFamily,
  weight: FontWeight,
  italic: boolean,
) => Promise<ArrayBuffer>;

export type LayoutDocumentOptions = {
  /**
   * Async font loader. Defaults to `loadFontBytes` from
   * `src/lib/font-loader.ts` which fetches `/fonts/<filename>.ttf` from
   * the same origin. Tests override with an fs-backed reader.
   */
  loadFont?: LoadFontFn;
};

/**
 * Top-level orchestrator. Parses Docx → PDF bytes.
 *
 * Throws when font loading fails (without fonts the engine can't run);
 * surfaces parser-detected feature gaps and runtime image-embed
 * failures via the returned `warnings` array.
 */
export async function layoutDocument(
  parsed: ParsedDocx,
  options: LayoutDocumentOptions = {},
): Promise<LayoutDocumentResult> {
  const loadFont = options.loadFont ?? defaultLoadFontBytes;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const fonts = await embedAllBundledFonts(pdfDoc, loadFont);

  const warnings: string[] = [];
  const { embeddedImages, imageWarnings } = await embedAllMedia(pdfDoc, parsed);
  warnings.push(...imageWarnings);

  const acc = newFootnoteAccumulator();
  const resolveImagePath = makeImagePathResolver(parsed.relationships);
  const onFootnoteRef = (kind: "footnote" | "endnote", noteId: string, page: PDFPage): string =>
    registerMarker(acc, kind, noteId, page);

  // Scratch doc for multi-column Pass 1 (Phase 13 F4). Pass 1 measures
  // block heights against a no-op discard page, but pdf-lib's image
  // embed APIs register on the *document* — without a separate scratch
  // doc, a future synchronous inline-image embed during measure would
  // double-embed in the final PDF. Created once per conversion and
  // reused across all sections; scratch-doc state persists for the
  // lifetime of `layoutDocument` and is discarded at function exit.
  const scratchPdfDoc = await PDFDocument.create();

  const deps: LayoutDeps = {
    numbering: parsed.numbering,
    relationships: parsed.relationships,
    bookmarks: parsed.bookmarks,
    listState: { counters: new Map(), lastLevel: new Map() },
    warnings: [],
    embeddedImages,
    resolveImagePath,
    onFootnoteRef,
  };

  // Section walk.
  for (const section of parsed.sections) {
    const pageGeometry: PageGeometry = {
      widthPt: section.pageSize.widthPt,
      heightPt: section.pageSize.heightPt,
      marginTopPt: section.pageMargins.top,
      marginRightPt: section.pageMargins.right,
      marginBottomPt: section.pageMargins.bottom,
      marginLeftPt: section.pageMargins.left,
    };

    // Pre-walk: collect footnote refs and estimate reserved height.
    const sectionFootnoteIds = collectFootnoteRefsInBlocks(section.blocks);
    const bodyColumnWidth =
      pageGeometry.widthPt - pageGeometry.marginLeftPt - pageGeometry.marginRightPt;
    const reservedRaw = estimateSectionFootnoteHeight(
      sectionFootnoteIds,
      parsed,
      fonts,
      bodyColumnWidth,
      pdfDoc,
    );
    // Cap reserved height at half the body height so a section with
    // pathologically heavy footnotes doesn't completely starve the body.
    const bodyHeight =
      pageGeometry.heightPt - pageGeometry.marginTopPt - pageGeometry.marginBottomPt;
    const footnoteReservedHeightPt = Math.min(reservedRaw, bodyHeight * 0.5);
    if (reservedRaw > bodyHeight * 0.5) {
      deps.warnings.push(
        "footnote area exceeds 50% of page body — content may overlap with footnotes",
      );
    }

    const beforeCount = pdfDoc.getPageCount();
    const result = layoutSection(
      {
        blocks: section.blocks,
        columnCount: Math.max(1, section.columns.count),
        columnGutterPt: section.columns.spaceBetween,
        pageGeometry,
        fonts,
        deps,
        footnoteReservedHeightPt,
        scratchPdfDoc,
      },
      pdfDoc,
    );
    const afterCount = pdfDoc.getPageCount();

    // Post-walk: render header/footer + flush footnotes per page.
    const allPages = pdfDoc.getPages();
    const sectionPages = allPages.slice(beforeCount, afterCount);
    const sectionPageCount = sectionPages.length;
    for (let i = 0; i < sectionPages.length; i++) {
      const page = sectionPages[i];
      if (page === undefined) continue;
      const pageNumber = i + 1; // 1-indexed within the section
      renderHeaderForPage(
        page,
        pageNumber,
        sectionPageCount,
        section,
        parsed,
        pageGeometry,
        fonts,
        deps,
        pdfDoc,
      );
      renderFooterForPage(
        page,
        pageNumber,
        sectionPageCount,
        section,
        parsed,
        pageGeometry,
        fonts,
        deps,
        pdfDoc,
      );
      flushFootnoteAreaToPage(page, acc, parsed, pageGeometry, fonts, deps, pdfDoc);
    }

    // Suppress `result.endingCtx` — the orchestrator doesn't reuse it
    // (each section starts fresh on a new page per OOXML semantics).
    void result;
  }

  // Final endnote pages.
  if (parsed.sections.length > 0) {
    const lastSection = parsed.sections[parsed.sections.length - 1];
    if (lastSection !== undefined) {
      const endnotePageGeometry: PageGeometry = {
        widthPt: lastSection.pageSize.widthPt,
        heightPt: lastSection.pageSize.heightPt,
        marginTopPt: lastSection.pageMargins.top,
        marginRightPt: lastSection.pageMargins.right,
        marginBottomPt: lastSection.pageMargins.bottom,
        marginLeftPt: lastSection.pageMargins.left,
      };
      renderEndnotePages(pdfDoc, acc, parsed, endnotePageGeometry, fonts, deps);
    }
  }

  // Empty-document defense: pdf-lib refuses to save a doc with zero
  // pages. A DOCX with zero sections (or all-empty sections) hits this.
  if (pdfDoc.getPageCount() === 0) {
    const fallbackGeometry: PageGeometry =
      parsed.sections[0] !== undefined
        ? {
            widthPt: parsed.sections[0].pageSize.widthPt,
            heightPt: parsed.sections[0].pageSize.heightPt,
            marginTopPt: parsed.sections[0].pageMargins.top,
            marginRightPt: parsed.sections[0].pageMargins.right,
            marginBottomPt: parsed.sections[0].pageMargins.bottom,
            marginLeftPt: parsed.sections[0].pageMargins.left,
          }
        : {
            widthPt: 612,
            heightPt: 792,
            marginTopPt: 72,
            marginRightPt: 72,
            marginBottomPt: 72,
            marginLeftPt: 72,
          };
    pdfDoc.addPage([fallbackGeometry.widthPt, fallbackGeometry.heightPt]);
  }

  const pdfBytes = await pdfDoc.save();

  // Merge parser warnings + layout warnings, dedupe.
  const allWarnings = dedupe([...parsed.warnings, ...deps.warnings, ...warnings]);

  return { pdfBytes, warnings: allWarnings };
}

/* ------------------------------------------------------------------ */
/*   Font embedding                                                   */
/* ------------------------------------------------------------------ */

async function embedAllBundledFonts(
  pdfDoc: PDFDocumentType,
  loadFont: LoadFontFn,
): Promise<EmbeddedFonts> {
  const embed = async (family: BundledFontFamily, weight: FontWeight, italic: boolean) => {
    const bytes = await loadFont(family, weight, italic);
    return pdfDoc.embedFont(bytes, { subset: true });
  };

  // Load all bytes in parallel — they're independent. Embedding itself
  // is per-font and pdf-lib serializes the registration internally.
  const [
    interRegular,
    interBold,
    interItalic,
    interBoldItalic,
    loraRegular,
    loraBold,
    loraItalic,
    loraBoldItalic,
    jetRegular,
    jetBold,
  ] = await Promise.all([
    embed("inter", 400, false),
    embed("inter", 700, false),
    embed("inter", 400, true),
    embed("inter", 700, true),
    embed("lora", 400, false),
    embed("lora", 700, false),
    embed("lora", 400, true),
    embed("lora", 700, true),
    embed("jetbrains-mono", 400, false),
    embed("jetbrains-mono", 700, false),
  ]);

  return {
    inter: {
      regular: interRegular,
      bold: interBold,
      italic: interItalic,
      boldItalic: interBoldItalic,
    },
    lora: {
      regular: loraRegular,
      bold: loraBold,
      italic: loraItalic,
      boldItalic: loraBoldItalic,
    },
    jetbrainsMono: {
      regular: jetRegular,
      bold: jetBold,
    },
  };
}

/* ------------------------------------------------------------------ */
/*   Image embedding                                                  */
/* ------------------------------------------------------------------ */

async function embedAllMedia(
  pdfDoc: PDFDocumentType,
  parsed: ParsedDocx,
): Promise<{ embeddedImages: Map<string, PDFImage>; imageWarnings: string[] }> {
  // Parallelize embed calls (Phase 13 F7). pdf-lib's image registration
  // produces an independent `PDFImage` per call; concurrent calls are
  // safe and the parser's pre-decoded bytes mean no shared I/O. A bad
  // asset rejects independently — we use `Promise.allSettled` so one
  // corrupt image doesn't kill the whole batch, mirroring the previous
  // try/catch per-iteration behavior.
  type EmbedTask =
    | { kind: "skip"; path: string; reason: string }
    | { kind: "embed"; path: string; promise: Promise<PDFImage> };
  const tasks: EmbedTask[] = [];
  for (const [path, asset] of parsed.media) {
    const fmt = sniffImageFormat(asset.bytes);
    if (fmt === "unknown") {
      tasks.push({ kind: "skip", path, reason: "unknown format" });
      continue;
    }
    tasks.push({ kind: "embed", path, promise: embedInlineImage(asset, pdfDoc) });
  }
  // Collect resolutions in iteration order so the resulting `Map` is
  // deterministic across runs (matters for golden tests / warning order).
  const out = new Map<string, PDFImage>();
  const warnings: string[] = [];
  const settled = await Promise.allSettled(
    tasks.map((t) => (t.kind === "embed" ? t.promise : Promise.resolve(null))),
  );
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    if (task === undefined) continue;
    if (task.kind === "skip") {
      warnings.push(imageSkippedWarning(task.path, task.reason));
      continue;
    }
    const r = settled[i];
    if (r === undefined) continue;
    if (r.status === "fulfilled" && r.value !== null) {
      out.set(task.path, r.value);
    } else if (r.status === "rejected") {
      const reason = r.reason instanceof Error ? r.reason.message : "embed failed";
      warnings.push(imageSkippedWarning(task.path, reason));
    }
  }
  return { embeddedImages: out, imageWarnings: warnings };
}

/**
 * Build a function that resolves a relationship rId (e.g., "rId5") to
 * the zip-relative media path used as the key in `embeddedImages`.
 *
 * `relationships` stores targets relative to `word/` (e.g.,
 * `media/image1.png`); the parser indexed media under the full path
 * `word/media/image1.png`. We prepend `word/` here to bridge.
 *
 * Returns `undefined` for unresolvable rIds so callers can skip cleanly.
 */
function makeImagePathResolver(
  relationships: Map<string, RelationshipTarget>,
): (rel: string) => string | undefined {
  return (rel: string) => {
    const target = relationships.get(rel);
    if (target === undefined) return undefined;
    if (target.type !== "image") return undefined;
    const t = target.target;
    if (t.startsWith("word/")) return t;
    return `word/${t.replace(/^\/+/, "")}`;
  };
}
