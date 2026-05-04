import type { OutputItem } from "@/engines/_shared/types";
import { loadFontByFilename } from "@/lib/font-loader";
import * as Comlink from "comlink";
import type { MarkdownToPdfOptions } from "./options";
import { parseMarkdown } from "./parser";
import { type RendererFonts, renderBlocksToPdf } from "./renderer";

export function replaceExt(name: string, newExt: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}.${newExt}`;
  return `${name.slice(0, dot)}.${newExt}`;
}

async function loadFonts(): Promise<RendererFonts> {
  const [body, bodyItalic, headings, mono] = await Promise.all([
    loadFontByFilename("lora-regular.ttf"),
    loadFontByFilename("lora-italic.ttf"),
    loadFontByFilename("inter-regular.ttf"),
    loadFontByFilename("jetbrains-mono-regular.ttf"),
  ]);
  return { body, bodyItalic, headings, mono };
}

const api = {
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    _type: string,
    opts: MarkdownToPdfOptions,
  ): Promise<OutputItem> {
    const text = new TextDecoder("utf-8").decode(bytes);
    const blocks = parseMarkdown(text);
    const fonts = await loadFonts();
    const pdfBytes = await renderBlocksToPdf(blocks, opts, fonts);
    const blob = new Blob([pdfBytes as BlobPart], { type: "application/pdf" });
    return {
      filename: replaceExt(name, "pdf"),
      mime: "application/pdf",
      blob,
    };
  },
};

Comlink.expose(api);
