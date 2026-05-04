import { parseDocx } from "@/engines/_shared/docx";
import type { OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import type { DocxToTxtOptions } from "./options";
import { extractText } from "./text-extractor";

function replaceExt(name: string, newExt: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}.${newExt}`;
  return `${name.slice(0, dot)}.${newExt}`;
}

Comlink.expose({
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    _type: string,
    opts: DocxToTxtOptions,
  ): Promise<OutputItem> {
    const doc = parseDocx(new Uint8Array(bytes));
    const text = extractText(doc, opts);
    const blob = new Blob([text], { type: "text/plain" });
    return {
      filename: replaceExt(name, "txt"),
      mime: "text/plain",
      blob,
    };
  },
});
