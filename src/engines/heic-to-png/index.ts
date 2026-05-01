import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type HeicToPngOptions, defaultHeicToPngOptions } from "./options";

const engine: SingleInputEngine<HeicToPngOptions, OutputItem> = {
  id: "heic-to-png",
  inputAccept: [".heic", ".heif"],
  inputMime: ["image/heic", "image/heif"],
  outputMime: "image/png",
  defaultOptions: defaultHeicToPngOptions,
  cardinality: "single",
  validate(file) {
    const isHeicByName = /\.(heic|heif)$/i.test(file.name);
    const isHeicByMime = file.type === "image/heic" || file.type === "image/heif";
    if (!isHeicByName && !isHeicByMime) {
      return { ok: false, reason: "Expected a .heic or .heif file" };
    }
    return { ok: true };
  },
  async convert(file, opts, signal) {
    const harness = new WorkerHarness<HeicToPngOptions>(
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
