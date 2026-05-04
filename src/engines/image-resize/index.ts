import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type ImageResizeOptions, defaultImageResizeOptions } from "./options";
import { ImageResizeOptionsPanel } from "./options-panel";

const SUPPORTED_INPUT_MIMES = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];

const engine: SingleInputEngine<ImageResizeOptions, OutputItem> = {
  id: "image-resize",
  inputAccept: [".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "image/png", // declarative default; actual MIME varies by input
  defaultOptions: defaultImageResizeOptions,
  category: "image",
  cardinality: "single",
  OptionsPanel: ImageResizeOptionsPanel,
  validate(file) {
    // Extension fallback for browsers that emit empty file.type for HEIC
    // (Safari especially). Mirrors docx-to-txt, markdown-to-pdf, txt-to-pdf.
    if (SUPPORTED_INPUT_MIMES.includes(file.type)) return { ok: true };
    if (/\.(png|jpe?g|webp|heic|heif)$/i.test(file.name)) return { ok: true };
    return { ok: false, reason: "Expected a PNG, JPEG, WebP, or HEIC file" };
  },
  async convert(file, opts, signal) {
    const harness = new WorkerHarness<ImageResizeOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    );
    const result = await harness.runSingle(file, opts, signal);
    if (Array.isArray(result)) {
      const first = result[0];
      if (!first) throw new Error("engine returned empty array");
      return first;
    }
    return result;
  },
};

export default engine;
