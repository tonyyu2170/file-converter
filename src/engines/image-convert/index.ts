import { detectMime } from "@/engines/_shared/file-detection";
import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type ImageConvertOptions, defaultImageConvertOptions } from "./options";
import { ImageConvertOptionsPanel } from "./options-panel";

const SUPPORTED_INPUT_MIMES = ["image/heic", "image/heif", "image/png", "image/jpeg", "image/webp"];

const engine: SingleInputEngine<ImageConvertOptions, OutputItem> = {
  id: "image-convert",
  inputAccept: [".heic", ".heif", ".png", ".jpg", ".jpeg", ".webp"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "image/png",
  defaultOptions: defaultImageConvertOptions,
  category: "image",
  cardinality: "single",
  isReadyToConvert: (opts) => opts.output !== null,
  OptionsPanel: ImageConvertOptionsPanel,
  validate(file) {
    return SUPPORTED_INPUT_MIMES.includes(file.type)
      ? { ok: true }
      : { ok: false, reason: "Expected an HEIC, PNG, JPEG, or WebP file" };
  },
  async convert(file, opts, signal) {
    const detected = await detectMime(file);
    if (!SUPPORTED_INPUT_MIMES.includes(detected)) {
      throw new Error(`Unsupported input MIME: ${detected}`);
    }
    if (!opts.output) {
      throw new Error("image-convert: output format not specified");
    }
    const harness = new WorkerHarness<ImageConvertOptions>(
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
