import type { OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import { type JsonFormatOptions, indentArg } from "./options";

const BOM = "﻿";

export async function formatJson(
  fileBytes: ArrayBuffer,
  fileName: string,
  opts: JsonFormatOptions,
): Promise<OutputItem> {
  let text = new TextDecoder("utf-8").decode(fileBytes);
  if (text.length === 0) {
    throw new Error("json-format: input is empty");
  }
  if (text.startsWith(BOM)) {
    text = text.slice(BOM.length);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`json-format: input is not valid JSON: ${msg}`);
  }
  const arg = indentArg(opts);
  const stringified = JSON.stringify(value, null, arg);
  const filename = fileName.toLowerCase().endsWith(".json") ? fileName : `${fileName}.json`;
  return {
    filename,
    mime: "application/json",
    blob: new Blob([stringified], { type: "application/json" }),
  };
}

const api = {
  async convertSingle(
    fileBytes: ArrayBuffer,
    fileName: string,
    _fileType: string,
    opts: JsonFormatOptions,
  ): Promise<OutputItem> {
    return formatJson(fileBytes, fileName, opts);
  },
};

Comlink.expose(api);
