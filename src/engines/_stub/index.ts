import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";

const meta = {
  id: "_stub",
  inputAccept: [".bin"],
  inputMime: ["application/octet-stream"],
  outputMime: "application/octet-stream",
  defaultOptions: {} as Record<string, never>,
};

const engine: SingleInputEngine<Record<string, never>, OutputItem> = {
  ...meta,
  cardinality: "single",
  validate: () => ({ ok: true }),
  async convert(file, opts, signal) {
    const harness = new WorkerHarness<Record<string, never>>(
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
