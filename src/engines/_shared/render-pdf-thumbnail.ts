import type { PDFDocumentProxy } from "pdfjs-dist";

type PdfJsModule = typeof import("pdfjs-dist");

let pdfJsModulePromise: Promise<PdfJsModule> | undefined;
let workerConfigured = false;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("pdfjs-dist");
  }
  const lib = await pdfJsModulePromise;
  if (!workerConfigured) {
    // Webpack URL for the bundled worker; same pattern as engine workers.
    lib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.mjs",
      import.meta.url,
    ).toString();
    workerConfigured = true;
  }
  return lib;
}

export async function renderFirstPageThumbnail(bytes: ArrayBuffer, size: number): Promise<Blob> {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: bytes }).promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const scale = Math.min(size / viewport.width, size / viewport.height);
    const scaledViewport = page.getViewport({ scale });
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.ceil(scaledViewport.width)),
      Math.max(1, Math.ceil(scaledViewport.height)),
    );
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");
    // pdf.js expects a CanvasRenderingContext2D; OffscreenCanvas2D is
    // structurally compatible at runtime.
    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport: scaledViewport,
      canvas: canvas as unknown as HTMLCanvasElement,
    }).promise;
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    await doc.destroy();
  }
}

/**
 * Open a PDF document via pdf.js and return the proxy.
 *
 * Caller owns the lifecycle: call `doc.destroy()` when the doc is no longer
 * needed (file replacement, worker teardown). Do not call `destroy()` while
 * a render is in flight.
 *
 * Lazy-loads pdfjs-dist on first use; subsequent calls reuse the cached
 * module (same pattern as renderFirstPageThumbnail).
 */
export async function loadPdfDocument(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  const lib = await loadPdfJs();
  return lib.getDocument({ data: bytes }).promise;
}

/**
 * Render a single page (0-based) of an already-loaded PDF doc to a PNG
 * blob bounded by `size` (longest edge). Aspect ratio preserved.
 *
 * `pageIndex` is **0-based** (aligns with `pdf-lib` for code that edits
 * PDFs). Other `pdfjs-dist` call sites in this repo (`pdf-to-image`,
 * `pdf-to-md`) use raw **1-based** indices — do not migrate them to this
 * helper without translating.
 */
export async function renderPageThumbnail(
  doc: PDFDocumentProxy,
  pageIndex: number,
  size: number,
): Promise<Blob> {
  // pdf.js page numbers are 1-based.
  const page = await doc.getPage(pageIndex + 1);
  try {
    const viewport = page.getViewport({ scale: 1 });
    const scale = Math.min(size / viewport.width, size / viewport.height);
    const scaledViewport = page.getViewport({ scale });
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.ceil(scaledViewport.width)),
      Math.max(1, Math.ceil(scaledViewport.height)),
    );
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");
    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport: scaledViewport,
      canvas: canvas as unknown as HTMLCanvasElement,
    }).promise;
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    page.cleanup();
  }
}
