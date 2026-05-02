import { decodeImage } from "@/engines/_shared/decode-image";
import type { OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import { OUTPUT_EXTENSION, OUTPUT_MIME } from "./options";
import type { ImageConvertOptions } from "./options";

function replaceExt(name: string, newExt: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}.${newExt}`;
  return `${name.slice(0, dot)}.${newExt}`;
}

const api = {
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    type: string,
    opts: ImageConvertOptions,
  ): Promise<OutputItem> {
    if (!opts.output) {
      throw new Error("image-convert: output format not specified");
    }

    const inputBlob = new Blob([bytes], { type });
    const file = new File([inputBlob], name, { type });
    const bitmap = await decodeImage(file);

    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");

      if (opts.output === "jpeg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, bitmap.width, bitmap.height);
      }
      ctx.drawImage(bitmap, 0, 0);

      const outputType = OUTPUT_MIME[opts.output];
      const blob =
        opts.output === "png"
          ? await canvas.convertToBlob({ type: outputType })
          : await canvas.convertToBlob({ type: outputType, quality: opts.quality });

      return {
        filename: replaceExt(name, OUTPUT_EXTENSION[opts.output]),
        mime: outputType,
        blob,
      };
    } finally {
      bitmap.close();
    }
  },
};

Comlink.expose(api);
