import type { OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { extractTextFromPage } from "./extract-text";
import type { PdfToMdOptions } from "./options";
import { type Page, toMarkdown } from "./to-markdown";

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
    fileName: string,
    _fileType: string,
    opts: PdfToMdOptions,
  ): Promise<OutputItem> {
    const lib = await loadPdfJs();
    let doc: PDFDocumentProxy;
    try {
      doc = await lib.getDocument({ data: fileBytes }).promise;
    } catch (err: unknown) {
      if (err instanceof Error && /password|encrypted/i.test(err.message)) {
        throw new Error("pdf-to-md: input PDF is password-protected");
      }
      throw err;
    }
    try {
      const pages: Page[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        pages.push(await extractTextFromPage(page));
      }
      const markdown = toMarkdown(pages, opts);
      const baseName = fileName.replace(/\.pdf$/i, "");
      return {
        filename: `${baseName}.md`,
        mime: "text/markdown",
        blob: new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
      };
    } finally {
      await doc.destroy();
    }
  },
};

Comlink.expose(api);
