import { decodeImage } from "@/engines/_shared/decode-image";
import type { OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import { type ImageResizeOptions, OUTPUT_EXTENSION, OUTPUT_MIME_FOR_INPUT } from "./options";

const MAX_DIMENSION = 16384; // canvas hard limit on most browsers

function replaceExt(name: string, newExt: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}.${newExt}`;
  return `${name.slice(0, dot)}.${newExt}`;
}

function withResolutionSuffix(name: string, w: number, h: number, ext: string): string {
  const base = name.lastIndexOf(".") > 0 ? name.slice(0, name.lastIndexOf(".")) : name;
  return `${base}-${w}x${h}.${ext}`;
}

export const api = {
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    type: string,
    opts: ImageResizeOptions,
  ): Promise<OutputItem> {
    const inputBlob = new Blob([bytes], { type });
    const file = new File([inputBlob], name, { type });
    const bitmap = await decodeImage(file);

    try {
      // Compute target dimensions.
      let targetW: number;
      let targetH: number;

      if (opts.mode === "percent") {
        targetW = Math.round((bitmap.width * opts.width) / 100);
        targetH = opts.lockAspectRatio
          ? Math.round((bitmap.height * opts.width) / 100)
          : Math.round((bitmap.height * opts.height) / 100);
      } else {
        targetW = opts.width;
        targetH = opts.lockAspectRatio
          ? Math.round((bitmap.height * opts.width) / bitmap.width)
          : opts.height;
      }

      // Validate target dimensions.
      if (targetW < 1 || targetH < 1) {
        throw new Error(`Resize target too small: ${targetW}x${targetH}`);
      }
      if (targetW > MAX_DIMENSION || targetH > MAX_DIMENSION) {
        throw new Error(
          `Resize target exceeds canvas limit (${MAX_DIMENSION}px): ${targetW}x${targetH}`,
        );
      }

      // Output MIME — HEIC falls back to PNG.
      const outputType = OUTPUT_MIME_FOR_INPUT[type] ?? "image/png";
      const outputExt = OUTPUT_EXTENSION[outputType] ?? "png";

      const canvas = new OffscreenCanvas(targetW, targetH);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);

      const blob = await canvas.convertToBlob({ type: outputType });

      // If the input was HEIC and we're switching to PNG, swap the extension first.
      const baseName =
        type === "image/heic" || type === "image/heif" ? replaceExt(name, outputExt) : name;
      return {
        filename: withResolutionSuffix(baseName, targetW, targetH, outputExt),
        mime: outputType,
        blob,
      };
    } finally {
      bitmap.close();
    }
  },
};

Comlink.expose(api);
