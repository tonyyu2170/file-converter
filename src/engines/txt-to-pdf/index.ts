import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type TxtToPdfOptions, defaultTxtToPdfOptions } from "./options";
import { TxtToPdfOptionsPanel } from "./options-panel";

const engine: SingleInputEngine<TxtToPdfOptions, OutputItem> = {
  id: "txt-to-pdf",
  inputAccept: [".txt"],
  inputMime: ["text/plain"],
  outputMime: "application/pdf",
  defaultOptions: defaultTxtToPdfOptions,
  category: "document",
  library: "pdf-lib",
  license: "MIT",
  cardinality: "single",
  OptionsPanel: TxtToPdfOptionsPanel,
  validate(file) {
    if (file.type === "text/plain") return { ok: true };
    if (/\.txt$/i.test(file.name)) return { ok: true };
    return { ok: false, reason: "Expected a .txt file" };
  },
  async convert(file, opts, signal) {
    const harness = new WorkerHarness<TxtToPdfOptions>(
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
