import type { OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import type { XmlToJsonOptions } from "./options";

export async function convertXmlToJson(
  fileBytes: ArrayBuffer,
  fileName: string,
  opts: XmlToJsonOptions,
): Promise<OutputItem> {
  const text = new TextDecoder("utf-8").decode(fileBytes);
  const { XMLParser, XMLValidator } = await import("fast-xml-parser");
  const validation = XMLValidator.validate(text);
  if (validation !== true) {
    throw new Error(`xml-to-json: input is not valid XML: ${validation.err.msg}`);
  }
  const parser = new XMLParser({
    attributeNamePrefix: opts.attributePrefix,
    ignoreAttributes: false,
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
  });
  const parsed: unknown = parser.parse(text);
  const stringified = JSON.stringify(parsed, null, 2);
  const baseName = fileName.replace(/\.xml$/i, "");
  return {
    filename: `${baseName}.json`,
    mime: "application/json",
    blob: new Blob([stringified], { type: "application/json" }),
  };
}

const api = {
  async convertSingle(
    fileBytes: ArrayBuffer,
    fileName: string,
    _fileType: string,
    opts: XmlToJsonOptions,
  ): Promise<OutputItem> {
    return convertXmlToJson(fileBytes, fileName, opts);
  },
};

Comlink.expose(api);
