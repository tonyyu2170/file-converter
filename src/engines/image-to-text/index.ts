import { detectMime } from "@/engines/_shared/file-detection";
import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type ImageToTextOptions, defaultImageToTextOptions } from "./options";
import { ImageToTextOptionsPanel } from "./options-panel";

const SUPPORTED_INPUT_MIMES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

// 25 MB cap — OCR engines have practical limits on image resolution/size.
const MAX_FILE_BYTES = 25 * 1_000_000;

// Module-scoped persistent harness so Tesseract loads once (cold-start is
// expensive) and is reused across conversions on the same page. Mirrors the
// audio-trim pattern.
let harness: WorkerHarness<ImageToTextOptions> | null = null;
export function getImageToTextHarness(): WorkerHarness<ImageToTextOptions> {
  if (!harness) {
    harness = new WorkerHarness<ImageToTextOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
      { persistent: true },
    );
  }
  return harness;
}

export function disposeImageToTextHarness(): void {
  harness?.dispose();
  harness = null;
}

const engine: SingleInputEngine<ImageToTextOptions, OutputItem> = {
  id: "image-to-text",
  inputAccept: [".jpg", ".jpeg", ".png", ".webp", ".heic"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "text/plain",
  defaultOptions: defaultImageToTextOptions,
  // "ocr" category added to EngineCategory in _shared/types.ts as part of
  // Task 3 so that the compile-time union matches at engine registration time.
  // Task 5 wires the UI tab that surfaces this category.
  category: "ocr",
  library: "tesseract.js",
  license: "Apache-2.0",
  cardinality: "single",
  isReadyToConvert: () => true,
  OptionsPanel: ImageToTextOptionsPanel,
  validate(file, _opts) {
    const mimeOk = SUPPORTED_INPUT_MIMES.includes(file.type);
    const extOk = /\.(jpe?g|png|webp|heic)$/i.test(file.name);
    if (!mimeOk && !extOk) {
      return { ok: false, reason: "Expected a JPG, PNG, WebP, or HEIC file" };
    }
    if (file.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        reason: `File too large for image-to-text (limit 25 MB; got ${(file.size / 1_000_000).toFixed(1)} MB).`,
      };
    }
    return { ok: true };
  },
  async convert(file, opts, signal, runOpts) {
    // Strict MIME check — mirrors image-convert/index.ts:30-34.
    // validate() is lenient (accepts extension-only files for Safari HEIC).
    // convert() re-checks bytes so a file with a deceiving extension/type
    // is rejected before the worker spawns.
    const detected = await detectMime(file);
    if (!SUPPORTED_INPUT_MIMES.includes(detected)) {
      throw new Error(`image-to-text: unsupported input MIME: ${detected}`);
    }
    // Dispose the persistent harness on abort so the engine worker (and its
    // child Tesseract worker) terminate rather than leaking. The harness's
    // own abortPromise rejects the in-flight runSingle immediately for instant
    // cancel UX; the disposal here tears down the worker process in parallel.
    // The next convert() call rebuilds the harness via getImageToTextHarness().
    // Each call to convert() receives a fresh AbortController signal from
    // tool-frame.tsx, so the { once: true } listener never fires on a
    // subsequent call.
    if (signal && !signal.aborted) {
      signal.addEventListener("abort", () => disposeImageToTextHarness(), { once: true });
    }
    const result = await getImageToTextHarness().runSingle(file, opts, signal, runOpts ?? {});
    if (Array.isArray(result)) {
      const first = result[0];
      if (!first) throw new Error("image-to-text: engine returned empty array");
      return first;
    }
    return result;
  },
};

export default engine;
