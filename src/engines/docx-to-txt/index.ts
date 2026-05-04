import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type DocxToTxtOptions, defaultDocxToTxtOptions } from "./options";
import { DocxToTxtOptionsPanel } from "./options-panel";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const engine: SingleInputEngine<DocxToTxtOptions, OutputItem> = {
  id: "docx-to-txt",
  inputAccept: [".docx"],
  inputMime: [DOCX_MIME],
  outputMime: "text/plain",
  defaultOptions: defaultDocxToTxtOptions,
  category: "document",
  cardinality: "single",
  OptionsPanel: DocxToTxtOptionsPanel,
  validate(file) {
    return file.type === DOCX_MIME ? { ok: true } : { ok: false, reason: "Expected a .docx file" };
  },
  async convert(file, opts, signal) {
    const harness = new WorkerHarness<DocxToTxtOptions>(
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
