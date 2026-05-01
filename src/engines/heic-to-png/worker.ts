import type { OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import libheif from "libheif-js/wasm-bundle";
import type { HeicToPngOptions } from "./options";

async function bitmapToPngBlob(
  width: number,
  height: number,
  rgba: Uint8ClampedArray<ArrayBuffer>,
): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");
  const imageData = new ImageData(rgba, width, height);
  ctx.putImageData(imageData, 0, 0);
  return await canvas.convertToBlob({ type: "image/png" });
}

const api = {
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    _type: string,
    _opts: HeicToPngOptions,
  ): Promise<OutputItem> {
    const decoder = new libheif.HeifDecoder();
    const data = decoder.decode(new Uint8Array(bytes));
    if (!data || data.length === 0) {
      throw new Error("libheif: no images decoded from HEIC");
    }
    const first = data[0];
    if (!first) throw new Error("libheif: first image missing");
    const width = first.get_width();
    const height = first.get_height();

    // display() writes RGBA pixel data into the target.data buffer and then
    // invokes the callback with the same target object (or null on failure).
    const target = {
      data: new Uint8ClampedArray(new ArrayBuffer(width * height * 4)),
      width,
      height,
    };

    const rgba = await new Promise<Uint8ClampedArray<ArrayBuffer>>((resolve, reject) => {
      first.display(target, (result) => {
        if (!result) {
          reject(new Error("libheif: display callback received null"));
        } else {
          resolve(result.data);
        }
      });
    });

    const blob = await bitmapToPngBlob(width, height, rgba);
    return {
      filename: name.replace(/\.(heic|heif)$/i, ".png"),
      mime: "image/png",
      blob,
    };
  },
};

Comlink.expose(api);
