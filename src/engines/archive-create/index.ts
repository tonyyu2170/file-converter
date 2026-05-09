import { WorkerHarness } from "@/engines/_shared/harness";
import type { MultiInputEngine, OutputItem } from "@/engines/_shared/types";
import {
  type ArchiveCreateOptions,
  defaultArchiveCreateOptions,
  validateFilename,
} from "./options";
import { ArchiveCreateOptionsPanel } from "./options-panel";
import { ArchiveCreateStagingArea } from "./staging-area";

const MAX_SUM_BYTES = 500 * 1_000_000;

const engine: MultiInputEngine<ArchiveCreateOptions, OutputItem> = {
  id: "archive-create",
  inputAccept: ["*/*"],
  inputMime: ["*/*"],
  outputMime: "application/zip",
  defaultOptions: defaultArchiveCreateOptions,
  convertButtonLabel: "[ create archive ]",
  category: "archive",
  library: "client-zip, fflate, in-house tar",
  license: "MIT",
  cardinality: "multi",
  StagingArea: ArchiveCreateStagingArea,
  OptionsPanel: ArchiveCreateOptionsPanel,
  isReadyToConvert(opts) {
    return validateFilename(opts.filename).ok;
  },
  validate(files) {
    if (files.length === 0) return { ok: false, reason: "Drop at least one file" };
    const sum = files.reduce((s, f) => s + f.size, 0);
    if (sum > MAX_SUM_BYTES) {
      return {
        ok: false,
        reason: `Inputs total too large for archive-create (limit 500 MB; got ${(sum / 1_000_000).toFixed(1)} MB).`,
      };
    }
    return { ok: true };
  },
  async convert(files, opts, signal) {
    const harness = new WorkerHarness<ArchiveCreateOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    );
    const result = await harness.runMulti(files, opts, signal);
    if (Array.isArray(result)) {
      const first = result[0];
      if (!first) throw new Error("archive-create: engine returned empty array");
      return first;
    }
    return result;
  },
};

export default engine;
