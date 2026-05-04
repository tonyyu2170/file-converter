import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type PdfToMdOptions, defaultPdfToMdOptions } from "./options";
import { PdfToMdOptionsPanel } from "./options-panel";

const SUPPORTED_INPUT_MIMES = ["application/pdf"];

const engine: SingleInputEngine<PdfToMdOptions, OutputItem> = {
  id: "pdf-to-md",
  inputAccept: [".pdf"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "text/markdown",
  defaultOptions: defaultPdfToMdOptions,
  category: "pdf",
  cardinality: "single",
  OptionsPanel: PdfToMdOptionsPanel,
  isReadyToConvert: () => true,
  validate(file) {
    return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
      ? { ok: true }
      : { ok: false, reason: "Expected a PDF file" };
  },
  async convert(file, opts, signal) {
    const harness = new WorkerHarness<PdfToMdOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    );
    const result = await harness.runSingle(file, opts, signal);
    if (Array.isArray(result)) {
      const first = result[0];
      if (!first) throw new Error("pdf-to-md: worker returned empty array");
      return first;
    }
    return result;
  },
};

export default engine;
