import { decodeImage } from "@/engines/_shared/decode-image";
import type { OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import { PDFDocument } from "pdf-lib";
import { type ImageToPdfOptions, PAGE_MARGIN, PAPER_DIMS } from "./options";

const api = {
  async convertMulti(
    files: Array<{ bytes: ArrayBuffer; name: string; type: string }>,
    opts: ImageToPdfOptions,
  ): Promise<OutputItem> {
    if (files.length === 0) {
      throw new Error("image-to-pdf: no input files");
    }

    const pdf = await PDFDocument.create();
    const [paperW, paperH] = PAPER_DIMS[opts.paper];

    for (const [i, f] of files.entries()) {
      const mimeType = f.type || "application/octet-stream";
      const blob = new Blob([f.bytes], { type: mimeType });
      const file = new File([blob], f.name || `page-${i + 1}`, { type: mimeType });

      const bitmap = await decodeImage(file);
      try {
        const isLandscape = bitmap.width > bitmap.height;
        const pageW = isLandscape ? Math.max(paperW, paperH) : Math.min(paperW, paperH);
        const pageH = isLandscape ? Math.min(paperW, paperH) : Math.max(paperW, paperH);

        // Re-encode as PNG for pdf-lib's embedPng. Lossless.
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");
        ctx.drawImage(bitmap, 0, 0);
        const pngBlob = await canvas.convertToBlob({ type: "image/png" });
        const pngBytes = await pngBlob.arrayBuffer();
        const embedded = await pdf.embedPng(pngBytes);

        const page = pdf.addPage([pageW, pageH]);
        const availW = pageW - 2 * PAGE_MARGIN;
        const availH = pageH - 2 * PAGE_MARGIN;
        const scale = Math.min(availW / bitmap.width, availH / bitmap.height);
        const drawW = bitmap.width * scale;
        const drawH = bitmap.height * scale;
        const x = (pageW - drawW) / 2;
        const y = (pageH - drawH) / 2;
        page.drawImage(embedded, { x, y, width: drawW, height: drawH });
      } finally {
        bitmap.close();
      }
    }

    const pdfBytes = await pdf.save();
    return {
      filename: "combined.pdf",
      mime: "application/pdf",
      blob: new Blob([pdfBytes as BlobPart], { type: "application/pdf" }),
    };
  },
};

Comlink.expose(api);
