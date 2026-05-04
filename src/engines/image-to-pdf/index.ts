import { WorkerHarness } from "@/engines/_shared/harness";
import type { MultiInputEngine, OutputItem } from "@/engines/_shared/types";
import { type ImageToPdfOptions, defaultImageToPdfOptions } from "./options";
import { ImageToPdfOptionsPanel } from "./options-panel";
import { ImageToPdfStagingArea } from "./staging-area";

const SUPPORTED_INPUT_MIMES = ["image/heic", "image/heif", "image/png", "image/jpeg", "image/webp"];

const engine: MultiInputEngine<ImageToPdfOptions, OutputItem> = {
  id: "image-to-pdf",
  inputAccept: [".heic", ".heif", ".png", ".jpg", ".jpeg", ".webp"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "application/pdf",
  defaultOptions: defaultImageToPdfOptions,
  convertButtonLabel: "[ convert to pdf ]",
  category: "image",
  cardinality: "multi",
  OptionsPanel: ImageToPdfOptionsPanel,
  StagingArea: ImageToPdfStagingArea,
  validate(files) {
    if (files.length === 0) {
      return { ok: false, reason: "Drop at least one image" };
    }
    const allValid = files.every((f) => SUPPORTED_INPUT_MIMES.includes(f.type));
    if (!allValid) {
      return { ok: false, reason: "All files must be PNG, JPEG, WebP, or HEIC" };
    }
    return { ok: true };
  },
  async convert(files, opts, signal) {
    const harness = new WorkerHarness<ImageToPdfOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    );
    const result = await harness.runMulti(files, opts, signal);
    if (Array.isArray(result)) {
      const first = result[0];
      if (!first) throw new Error("engine returned empty array");
      return first;
    }
    return result;
  },
};

export default engine;
