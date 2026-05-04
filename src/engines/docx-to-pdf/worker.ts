import { parseDocx } from "@/engines/_shared/docx";
import type { OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import { layoutDocument } from "./layout";
import type { DocxToPdfOptions } from "./options";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const api = {
  async convertSingle(
    fileBytes: ArrayBuffer,
    fileName: string,
    _fileType: string,
    _opts: DocxToPdfOptions,
  ): Promise<OutputItem> {
    // parseDocx throws on encrypted DOCX or missing word/document.xml with
    // the user-displayable messages spec §6 documents.
    const parsed = parseDocx(new Uint8Array(fileBytes));
    const { pdfBytes, warnings } = await layoutDocument(parsed);
    const baseName = fileName.replace(/\.docx$/i, "");
    const item: OutputItem = {
      filename: `${baseName}.pdf`,
      mime: "application/pdf",
      blob: new Blob([pdfBytes as BlobPart], { type: "application/pdf" }),
    };
    if (warnings.length > 0) item.warnings = warnings;
    return item;
  },
};

// Reference DOCX_MIME so it isn't tree-shaken; future validation may
// re-check input mime here.
void DOCX_MIME;

Comlink.expose(api);
