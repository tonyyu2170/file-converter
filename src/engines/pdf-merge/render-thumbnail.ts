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
