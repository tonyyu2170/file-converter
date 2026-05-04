import { decodeImage } from "@/engines/_shared/decode-image";
import type { OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import { computeTargetDimensions, deriveOutput } from "./dimensions";
import type { ImageResizeOptions } from "./options";

const api = {
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
      const target = computeTargetDimensions({ width: bitmap.width, height: bitmap.height }, opts);
      const output = deriveOutput(name, type, target);

      const canvas = new OffscreenCanvas(target.width, target.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, target.width, target.height);

      const blob = await canvas.convertToBlob({ type: output.mime });
      return {
        filename: output.filename,
        mime: output.mime,
        blob,
      };
    } finally {
      bitmap.close();
    }
  },
};

Comlink.expose(api);
