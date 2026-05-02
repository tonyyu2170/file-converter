import type { OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import { PDFDocument } from "pdf-lib";
import type { PdfMergeOptions } from "./options";

const api = {
  async convertMulti(
    files: Array<{ bytes: ArrayBuffer; name: string; type: string }>,
    opts: PdfMergeOptions,
  ): Promise<OutputItem> {
    if (files.length < 2) {
      throw new Error("pdf-merge: need 2+ PDFs");
    }
    if (opts.rows.length !== files.length) {
      throw new Error("pdf-merge: row metadata length mismatch");
    }

    const out = await PDFDocument.create();

    for (const [i, f] of files.entries()) {
      const row = opts.rows[i];
      if (!row) {
        throw new Error(`pdf-merge: missing row metadata at index ${i}`);
      }
      if (row.encrypted) {
        throw new Error(`pdf-merge: ${f.name} is password-protected`);
      }
      if (row.rangeError) {
        throw new Error(`pdf-merge: ${f.name} has invalid range — ${row.rangeError}`);
      }

      const src = await PDFDocument.load(f.bytes);
      const indices =
        row.parsedRange.length > 0
          ? row.parsedRange
          : Array.from({ length: src.getPageCount() }, (_, k) => k);
      const copied = await out.copyPages(src, indices);
      for (const page of copied) {
        out.addPage(page);
      }
    }

    const pdfBytes = await out.save();
    return {
      filename: "merged.pdf",
      mime: "application/pdf",
      blob: new Blob([pdfBytes as BlobPart], { type: "application/pdf" }),
    };
  },
};

Comlink.expose(api);
