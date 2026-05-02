import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type PdfSplitOptions, defaultPdfSplitOptions } from "./options";

const SUPPORTED_INPUT_MIMES = ["application/pdf"];

const engine: SingleInputEngine<PdfSplitOptions, OutputItem[]> = {
  id: "pdf-split",
  inputAccept: [".pdf"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "application/pdf",
  defaultOptions: defaultPdfSplitOptions,
  archiveSuffix: "-split",
  cardinality: "single",
  isReadyToConvert(opts) {
    return opts.rangeInput.trim().length > 0;
  },
  validate(file) {
    return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
      ? { ok: true }
      : { ok: false, reason: "Expected a PDF file" };
  },
  async convert(file, opts, signal) {
    const harness = new WorkerHarness<PdfSplitOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    );
    const result = await harness.runSingle(file, opts, signal);
    return Array.isArray(result) ? result : [result];
  },
};

export default engine;
