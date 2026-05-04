import type { ConversionProgress, OutputItem } from "@/engines/_shared/types";
import { RawImage } from "@huggingface/transformers";
import * as Comlink from "comlink";
import { getBgRemovalPipeline } from "./model-loader";
import type { ImageBgRemoveOptions } from "./options";

function replaceExtAddSuffix(name: string, suffix: string, ext: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}${suffix}.${ext}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) return [255, 255, 255];
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

const api = {
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    type: string,
    opts: ImageBgRemoveOptions,
    onProgress?: (p: ConversionProgress) => void,
  ): Promise<OutputItem> {
    // Phase 1: load model (cached after first call). Drop progress events
    // with total <= 0 — transformers.js can emit total: 0 before headers
    // settle, which would render Infinity in the UI's MB label.
    const pipe = await getBgRemovalPipeline((p) => {
      if (p.kind === "model-loading" && p.total > 0) {
        onProgress?.({ kind: "model-loading", loaded: p.loaded, total: p.total });
      }
    });

    // Phase 2: decode
    const bitmap = await createImageBitmap(new Blob([bytes], { type }), {
      imageOrientation: "from-image",
    });

    onProgress?.({ kind: "inference", pct: 0 });

    try {
      // Pixel cap (spec §11.1)
      const pixelCap = 24_000_000;
      if (bitmap.width * bitmap.height > pixelCap) {
        const mp = ((bitmap.width * bitmap.height) / 1_000_000).toFixed(1);
        throw new Error(`Image too large to process (${mp} MP). Resize below 24 MP first.`);
      }

      // Phase 3: inference. transformers.js' image-segmentation pipeline
      // accepts a RawImage. RawImage.fromCanvas() reads pixel data via
      // getImageData internally, so no extra ImageData round-trip is needed.
      const inCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const inCtx = inCanvas.getContext("2d");
      if (!inCtx) throw new Error("OffscreenCanvas 2D context unavailable");
      inCtx.drawImage(bitmap, 0, 0);
      const rawInput = RawImage.fromCanvas(inCanvas);

      // pipeline returns Array<{ label, mask: { data: Uint8Array, width, height } }>.
      // For models without post-processing (e.g. MODNet — the
      // image-segmentation pipeline's "no subtask" code path) `label` is
      // null and the array contains a single segment matching input size.
      // For models that emit labeled segments (e.g. BiRefNet) prefer the
      // segment whose label looks like the foreground subject; fall back
      // to the first segment otherwise.
      const result = (await pipe(rawInput)) as Array<{
        label: string | null;
        mask: { data: Uint8Array; width: number; height: number };
      }>;
      const fg =
        result.find(
          (r) => typeof r.label === "string" && r.label.toLowerCase().includes("subject"),
        ) ?? result[0];
      if (!fg) throw new Error("Model returned no segmentation result");

      // Phase 4: composite
      const outCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const outCtx = outCanvas.getContext("2d");
      if (!outCtx) throw new Error("OffscreenCanvas 2D context unavailable");

      // Upscale mask if smaller than input
      const maskCanvas = new OffscreenCanvas(fg.mask.width, fg.mask.height);
      const maskCtx = maskCanvas.getContext("2d");
      if (!maskCtx) throw new Error("OffscreenCanvas 2D context unavailable");
      const maskImageData = maskCtx.createImageData(fg.mask.width, fg.mask.height);
      for (let i = 0; i < fg.mask.data.length; i++) {
        maskImageData.data[i * 4 + 0] = 255;
        maskImageData.data[i * 4 + 1] = 255;
        maskImageData.data[i * 4 + 2] = 255;
        maskImageData.data[i * 4 + 3] = fg.mask.data[i] ?? 0;
      }
      maskCtx.putImageData(maskImageData, 0, 0);

      if (opts.bgMode === "transparent") {
        // 4-channel output: input pixels with alpha from upscaled mask.
        outCtx.imageSmoothingQuality = "high";
        outCtx.drawImage(bitmap, 0, 0);
        // Apply mask via destination-in
        outCtx.globalCompositeOperation = "destination-in";
        outCtx.drawImage(maskCanvas, 0, 0, bitmap.width, bitmap.height);
        outCtx.globalCompositeOperation = "source-over";
      } else {
        // Solid: pre-fill, then draw input multiplied by mask on top.
        const [r, g, b] = hexToRgb(opts.bgColor);
        outCtx.fillStyle = `rgb(${r},${g},${b})`;
        outCtx.fillRect(0, 0, bitmap.width, bitmap.height);
        // Subject layer on a temporary canvas, then composited over the bg.
        const subjCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const subjCtx = subjCanvas.getContext("2d");
        if (!subjCtx) throw new Error("OffscreenCanvas 2D context unavailable");
        subjCtx.imageSmoothingQuality = "high";
        subjCtx.drawImage(bitmap, 0, 0);
        subjCtx.globalCompositeOperation = "destination-in";
        subjCtx.drawImage(maskCanvas, 0, 0, bitmap.width, bitmap.height);
        outCtx.drawImage(subjCanvas, 0, 0);
      }

      onProgress?.({ kind: "inference", pct: 100 });

      // Phase 5: encode
      const isPng = opts.outputFormat === "png";
      const blob = isPng
        ? await outCanvas.convertToBlob({ type: "image/png" })
        : await outCanvas.convertToBlob({
            type: "image/jpeg",
            quality: opts.jpegQuality,
          });

      return {
        filename: replaceExtAddSuffix(name, "-nobg", isPng ? "png" : "jpg"),
        mime: isPng ? "image/png" : "image/jpeg",
        blob,
      };
    } finally {
      bitmap.close();
    }
  },
};

Comlink.expose(api);
