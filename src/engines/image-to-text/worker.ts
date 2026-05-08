import { disposeTesseract, loadTesseract, setProgressLogger } from "@/engines/_shared/tesseract";
import type { WordBbox } from "@/engines/_shared/tesseract/types";
import type { ConversionProgress, OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import type { ImageToTextOptions } from "./options";

// HEIC/HEIF need libheif decoding; all other formats can go straight to
// tesseract.js as a Blob (Blob is in tesseract.js v7's ImageLike).
const HEIC_MIMES = new Set(["image/heic", "image/heif"]);

// Accepted MIMEs — matches SUPPORTED_INPUT_MIMES in index.ts.
// detectMime is NOT called here; index.ts runs it host-side before dispatch.
const ACCEPTED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

// ---------------------------------------------------------------------------
// HEIC decoding — mirrors _shared/decode-image.ts but returns OffscreenCanvas
// so Tesseract can accept it (ImageBitmap is not in v7's ImageLike union).
// ---------------------------------------------------------------------------

let libheifPromise: Promise<typeof import("libheif-js/wasm-bundle")> | undefined;
async function loadLibheif() {
  if (!libheifPromise) {
    libheifPromise = import("libheif-js/wasm-bundle");
  }
  return libheifPromise;
}

async function decodeHeicToCanvas(bytes: Uint8Array): Promise<OffscreenCanvas> {
  const lib = (await loadLibheif()).default;
  const decoder = new lib.HeifDecoder();
  const data = decoder.decode(bytes);
  if (!data || data.length === 0) {
    throw new Error("libheif: no images decoded from HEIC");
  }
  const first = data[0];
  if (!first) throw new Error("libheif: first image missing");
  const width = first.get_width();
  const height = first.get_height();
  const rgba = await new Promise<Uint8ClampedArray<ArrayBuffer>>((resolve, reject) => {
    first.display(
      { data: new Uint8ClampedArray(new ArrayBuffer(width * height * 4)), width, height },
      (display: { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } | null) => {
        if (!display) reject(new Error("libheif: display callback received null"));
        else resolve(display.data);
      },
    );
  });
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("image-to-text: OffscreenCanvas 2d context unavailable");
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas;
}

// ---------------------------------------------------------------------------
// Main worker API
// ---------------------------------------------------------------------------

const api = {
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    type: string,
    opts: ImageToTextOptions,
    onProgress?: (p: ConversionProgress) => void,
  ): Promise<OutputItem> {
    // Defense-in-depth MIME check — the canonical strict check runs host-side
    // in index.ts convert() via detectMime() before the worker is dispatched.
    // This worker-side guard catches cases where `type` arrives non-empty but
    // outside the accepted set (e.g., direct worker invocation in tests).
    if (type && !ACCEPTED_MIMES.has(type)) {
      throw new Error(`image-to-text: unsupported content type ${type}`);
    }

    // Signal model-loading start.
    onProgress?.({ kind: "model-loading", loaded: 0, total: 1 });

    // Resolve the image input. HEIC requires libheif; everything else passes
    // as a Blob (Blob is in tesseract.js v7's ImageLike).
    const imageInput: OffscreenCanvas | Blob = HEIC_MIMES.has(type)
      ? await decodeHeicToCanvas(new Uint8Array(bytes))
      : new Blob([bytes], { type });

    // Warm/load the persistent Tesseract worker. This is the expensive step
    // on first call; subsequent calls reuse the singleton.
    const worker = await loadTesseract();
    onProgress?.({ kind: "model-loading", loaded: 1, total: 1 });

    // Map Tesseract's logger events to the project's ConversionProgress shape.
    // The spec's `phase`/`etaSec` shape was aspirational — the canonical type
    // in _shared/types.ts uses { kind: "model-loading", loaded, total } and
    // { kind: "inference", pct }. Adapt: warmup phases map to model-loading
    // (with loaded=progress, total=1 since Tesseract reports a 0..1 scalar),
    // the recognize phase maps to inference.
    setProgressLogger((m) => {
      if (!onProgress) return;
      if (m.status === "recognizing text") {
        onProgress({ kind: "inference", pct: Math.max(0, Math.min(100, m.progress * 100)) });
      } else {
        // Covers "loading language traineddata", "initializing api", etc.
        onProgress({ kind: "model-loading", loaded: m.progress, total: 1 });
      }
    });

    let result: Awaited<ReturnType<typeof worker.recognize>>;
    try {
      // Request blocks output for json-with-bboxes; text output is always on
      // by default. In tesseract.js v7 the second arg to recognize() is
      // RecognizeOptions (rectangle/rotate); output format is the third arg.
      const needBlocks = opts.outputFormat === "json-with-bboxes";
      result = await worker.recognize(
        // OffscreenCanvas is in the v7 ImageLike union (via Canvas check);
        // Blob is explicitly listed.
        imageInput as Parameters<typeof worker.recognize>[0],
        undefined,
        needBlocks ? { blocks: true } : undefined,
      );
    } finally {
      setProgressLogger(null);
    }

    onProgress?.({ kind: "inference", pct: 100 });

    const baseName = name.replace(/\.[^.]+$/, "");

    if (opts.outputFormat === "json-with-bboxes") {
      // v7 word shape: result.data.blocks[*].paragraphs[*].lines[*].words[*]
      // Each Word has: { text, confidence, bbox: {x0,y0,x1,y1}, symbols, choices, font_name }
      // Flatten to the WordBbox shape used by Task 3's public API.
      const words: WordBbox[] = [];
      for (const block of result.data.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            for (const word of line.words) {
              words.push({
                text: word.text,
                confidence: word.confidence,
                x: word.bbox.x0,
                y: word.bbox.y0,
                w: word.bbox.x1 - word.bbox.x0,
                h: word.bbox.y1 - word.bbox.y0,
              });
            }
          }
        }
      }
      const blob = new Blob([JSON.stringify({ text: result.data.text, words }, null, 2)], {
        type: "application/json",
      });
      return { filename: `${baseName}.json`, mime: "application/json", blob };
    }

    const blob = new Blob([result.data.text], { type: "text/plain" });
    return { filename: `${baseName}.txt`, mime: "text/plain", blob };
  },
};

Comlink.expose(api);
