// src/engines/data-convert/index.ts
import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type DataConvertOptions, defaultDataConvertOptions } from "./options";
import { DataConvertOptionsPanel } from "./options-panel";

const MAX_FILE_BYTES = 50 * 1_000_000;

const ACCEPT_EXT = [".csv", ".json", ".yaml", ".yml"];
const ACCEPT_MIME = [
  "text/csv",
  "application/json",
  "application/yaml",
  "text/yaml",
  "application/x-yaml",
];

const engine: SingleInputEngine<DataConvertOptions, OutputItem> = {
  id: "data-convert",
  inputAccept: ACCEPT_EXT,
  inputMime: ACCEPT_MIME,
  outputMime: "application/json",
  defaultOptions: defaultDataConvertOptions,
  category: "data",
  library: "papaparse, js-yaml",
  license: "MIT",
  cardinality: "single",
  OptionsPanel: DataConvertOptionsPanel,
  validate(file) {
    const lowerName = file.name.toLowerCase();
    const extOk = ACCEPT_EXT.some((ext) => lowerName.endsWith(ext));
    const mimeOk = ACCEPT_MIME.includes(file.type);
    if (!extOk && !mimeOk) {
      return { ok: false, reason: "Expected a .csv, .json, .yaml, or .yml file" };
    }
    if (file.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        reason: `File too large for data-convert (limit 50 MB; got ${(file.size / 1_000_000).toFixed(1)} MB).`,
      };
    }
    return { ok: true };
  },
  async convert(file, opts, signal) {
    const harness = new WorkerHarness<DataConvertOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    );
    const result = await harness.runSingle(file, opts, signal);
    if (Array.isArray(result)) {
      const first = result[0];
      if (!first) throw new Error("data-convert: engine returned empty array");
      return first;
    }
    return result;
  },
};

export default engine;
