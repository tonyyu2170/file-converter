import { parseRangeTokens } from "@/engines/_shared/range";
import type { OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import { PDFDocument } from "pdf-lib";
import { planSplitFilenames } from "./filenames";
import type { PdfSplitOptions } from "./options";

const api = {
  async convertSingle(
    fileBytes: ArrayBuffer,
    _fileName: string,
    _fileType: string,
    opts: PdfSplitOptions,
  ): Promise<OutputItem[]> {
    let src: PDFDocument;
    try {
      src = await PDFDocument.load(fileBytes);
    } catch (err: unknown) {
      // pdf-lib's EncryptedPDFError doesn't round-trip reliably as
      // instanceof / constructor.name across lazy-loaded bundles. Detect via
      // the thrown message — confirmed in Plan 4 fixture work.
      const isEncrypted = err instanceof Error && /encrypted/i.test(err.message);
      if (isEncrypted) throw new Error("pdf-split: input PDF is password-protected");
      throw err;
    }
    const pageCount = src.getPageCount();

    const tokens = parseRangeTokens(opts.rangeInput, pageCount);
    if (!tokens.ok) {
      throw new Error(`pdf-split: ${tokens.reason}`);
    }
    if (tokens.tokens.length === 0) {
      // Engine.isReadyToConvert should have prevented this; defensive.
      throw new Error("pdf-split: no range tokens (engine gate failed)");
    }

    const filenames = planSplitFilenames(tokens.tokens);
    const outputs: OutputItem[] = [];
    for (const [i, token] of tokens.tokens.entries()) {
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, token.indices);
      for (const page of copied) out.addPage(page);
      const pdfBytes = await out.save();
      outputs.push({
        filename: filenames[i] ?? `part-${i + 1}.pdf`,
        mime: "application/pdf",
        blob: new Blob([pdfBytes as BlobPart], { type: "application/pdf" }),
      });
    }
    return outputs;
  },
};

Comlink.expose(api);
