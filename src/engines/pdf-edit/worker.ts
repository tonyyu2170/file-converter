import * as Comlink from "comlink";
import { PDFDocument, degrees } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";

import { loadPdfDocument, renderPageThumbnail } from "@/engines/_shared/render-pdf-thumbnail";
import type { PdfEditOptions } from "./options";

let pdfJsDoc: PDFDocumentProxy | null = null;
let sourceBytes: ArrayBuffer | null = null;

export type LoadResult = { pageCount: number };
export type EncryptedError = { kind: "encrypted" };

/**
 * Apply edits via pdf-lib. Exported as a pure function (no module-level
 * state) so the Task 9 correctness test can exercise this path without
 * instantiating a Comlink-wrapped Worker.
 *
 * Composes user-applied rotation with the source page's existing rotation
 * modulo 360. Double-modulo handles negative values (JS % preserves sign).
 */
export async function applyEdits(
  bytes: ArrayBuffer | Uint8Array,
  opts: PdfEditOptions,
): Promise<Uint8Array> {
  if (opts.pages.length === 0) {
    throw new Error("at least one page must remain");
  }
  const source = await PDFDocument.load(bytes, { ignoreEncryption: false });
  const sourcePages = source.getPages();
  const target = await PDFDocument.create();

  for (const edit of opts.pages) {
    const sourcePage = sourcePages[edit.sourceIndex];
    if (!sourcePage) {
      throw new Error(
        `pdf-edit: sourceIndex ${edit.sourceIndex} out of range (0..${sourcePages.length - 1})`,
      );
    }
    const [copied] = await target.copyPages(source, [edit.sourceIndex]);
    if (!copied) {
      throw new Error(`pdf-edit: copyPages returned no page for index ${edit.sourceIndex}`);
    }
    const sourceRotation = sourcePage.getRotation().angle;
    const composed = (((sourceRotation + edit.rotation) % 360) + 360) % 360;
    copied.setRotation(degrees(composed));
    target.addPage(copied);
  }

  return target.save();
}

const api = {
  /**
   * Parse a PDF and cache the pdf.js doc + raw bytes for later renderPage /
   * apply calls. Throws { kind: "encrypted" } on password-protected PDFs.
   */
  async load(bytes: ArrayBuffer): Promise<LoadResult> {
    // Discard any previous file cache.
    if (pdfJsDoc) {
      try {
        await pdfJsDoc.destroy();
      } catch {
        /* ignore */
      }
      pdfJsDoc = null;
    }
    sourceBytes = bytes;
    try {
      // pdf.js transfers the underlying ArrayBuffer to its internal worker,
      // detaching the original. Pass a copy so `sourceBytes` stays usable
      // for the later apply() / applyEdits() path.
      pdfJsDoc = await loadPdfDocument(bytes.slice(0));
    } catch (err: unknown) {
      sourceBytes = null;
      pdfJsDoc = null;
      const name = (err as { name?: string }).name;
      if (name === "PasswordException") {
        // Surface encryption as a structured error the engine recognises.
        throw { kind: "encrypted" } as EncryptedError;
      }
      throw err;
    }
    return { pageCount: pdfJsDoc.numPages };
  },

  /**
   * Render a single page thumbnail. Throws if load() was not called first.
   */
  async renderPage(pageIndex: number, size: number): Promise<Blob> {
    if (!pdfJsDoc) {
      throw new Error("pdf-edit worker: load() must be called before renderPage()");
    }
    return renderPageThumbnail(pdfJsDoc, pageIndex, size);
  },

  /**
   * Apply edits; delegates to the exported pure function applyEdits().
   */
  async apply(opts: PdfEditOptions): Promise<Uint8Array> {
    if (!sourceBytes) {
      throw new Error("pdf-edit worker: load() must be called before apply()");
    }
    return applyEdits(sourceBytes, opts);
  },

  /**
   * Release cached pdf.js doc + bytes. Called by the engine on dispose.
   */
  async dispose(): Promise<void> {
    if (pdfJsDoc) {
      try {
        await pdfJsDoc.destroy();
      } catch {
        /* ignore */
      }
      pdfJsDoc = null;
    }
    sourceBytes = null;
  },
};

export type PdfEditWorkerApi = typeof api;

// Test-only export. The api is normally accessed via a Comlink-wrapped
// Worker; tests use this direct reference to exercise the load → apply
// integration without spinning up a Worker.
export { api as __apiForTest };

Comlink.expose(api);
