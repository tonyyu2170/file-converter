// src/engines/json-format/index.ts
import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type JsonFormatOptions, defaultJsonFormatOptions } from "./options";
import { JsonFormatOptionsPanel } from "./options-panel";

const MAX_FILE_BYTES = 50 * 1_000_000;

const engine: SingleInputEngine<JsonFormatOptions, OutputItem> = {
  id: "json-format",
  inputAccept: [".json"],
  inputMime: ["application/json"],
  outputMime: "application/json",
  defaultOptions: defaultJsonFormatOptions,
  convertButtonLabel: "[ format json ]",
  category: "data",
  library: "built-in JSON",
  license: "MIT",
  cardinality: "single",
  OptionsPanel: JsonFormatOptionsPanel,
  validate(file) {
    const lowerName = file.name.toLowerCase();
    const extOk = lowerName.endsWith(".json");
    const mimeOk = file.type === "application/json";
    if (!extOk && !mimeOk) {
      return { ok: false, reason: "Expected a .json file" };
    }
    if (file.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        reason: `File too large for json-format (limit 50 MB; got ${(file.size / 1_000_000).toFixed(1)} MB).`,
      };
    }
    return { ok: true };
  },
  async convert(file, opts, signal) {
    const harness = new WorkerHarness<JsonFormatOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    );
    const result = await harness.runSingle(file, opts, signal);
    if (Array.isArray(result)) {
      const first = result[0];
      if (!first) throw new Error("json-format: engine returned empty array");
      return first;
    }
    return result;
  },
};

export default engine;
