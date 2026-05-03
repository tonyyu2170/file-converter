import type { OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import type { PdfToImageOptions } from "./options";
import { computePageNumbers } from "./page-numbers";

type PdfJsModule = typeof import("pdfjs-dist");
let pdfJsModulePromise: Promise<PdfJsModule> | undefined;
let workerConfigured = false;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("pdfjs-dist");
  }
  const lib = await pdfJsModulePromise;
  if (!workerConfigured) {
    lib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.mjs",
      import.meta.url,
    ).toString();
    workerConfigured = true;
  }
  return lib;
}

const api = {
  async convertSingle(
    fileBytes: ArrayBuffer,
    _fileName: string,
    _fileType: string,
    opts: PdfToImageOptions,
  ): Promise<OutputItem[]> {
    const lib = await loadPdfJs();

    let doc: Awaited<ReturnType<typeof lib.getDocument>["promise"]>;
    try {
      doc = await lib.getDocument({ data: fileBytes }).promise;
    } catch (err: unknown) {
      if (err instanceof Error && /password|encrypted/i.test(err.message)) {
        throw new Error("pdf-to-image: input PDF is password-protected");
      }
      throw err;
    }

    try {
      const pageCount = doc.numPages;
      const result = computePageNumbers(opts.rangeInput, pageCount);
      if (!result.ok) throw new Error(`pdf-to-image: ${result.reason}`);
      const pageNumbers = result.pages;

      const outputs: OutputItem[] = [];
      for (const pageNum of pageNumbers) {
        const page = await doc.getPage(pageNum);
        const viewport = page.getViewport({ scale: opts.scale });
        const canvas = new OffscreenCanvas(
          Math.max(1, Math.ceil(viewport.width)),
          Math.max(1, Math.ceil(viewport.height)),
        );
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");
        await page.render({
          canvasContext: ctx as unknown as CanvasRenderingContext2D,
          viewport,
          canvas: canvas as unknown as HTMLCanvasElement,
        }).promise;
        const mime = opts.format === "jpeg" ? "image/jpeg" : "image/png";
        const blob = await canvas.convertToBlob(
          opts.format === "jpeg" ? { type: mime, quality: opts.jpegQuality / 100 } : { type: mime },
        );
        const ext = opts.format === "jpeg" ? "jpg" : "png";
        outputs.push({
          filename: `page-${pageNum}.${ext}`,
          mime,
          blob,
        });
      }
      return outputs;
    } finally {
      await doc.destroy();
    }
  },
};

Comlink.expose(api);
