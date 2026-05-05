import { WorkerHarness } from "@/engines/_shared/harness";
import type { MultiInputEngine, OutputItem } from "@/engines/_shared/types";
import { type PdfMergeOptions, defaultPdfMergeOptions } from "./options";
import { PdfMergeStagingArea } from "./staging-area";

const SUPPORTED_INPUT_MIMES = ["application/pdf"];

const engine: MultiInputEngine<PdfMergeOptions, OutputItem> = {
  id: "pdf-merge",
  inputAccept: [".pdf"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "application/pdf",
  defaultOptions: defaultPdfMergeOptions,
  convertButtonLabel: "[ merge pdfs ]",
  category: "pdf",
  library: "pdf-lib",
  license: "MIT",
  cardinality: "multi",
  StagingArea: PdfMergeStagingArea,
  isReadyToConvert(opts) {
    if (opts.rows.length < 2) return false;
    return opts.rows.every((r) => r.pageCount !== undefined && !r.encrypted && !r.rangeError);
  },
  estimateOutputBytes(files) {
    if (files.length < 2) return null;
    // pdf-lib usually shaves a few percent off via font/object dedup, so the
    // sum of input sizes is a tight upper bound — close enough to be honest.
    return files.reduce((sum, f) => sum + f.size, 0);
  },
  validate(files) {
    if (files.length === 0) return { ok: false, reason: "Drop at least one PDF" };
    if (files.length === 1) return { ok: false, reason: "Need 2+ PDFs to merge" };
    const allPdf = files.every(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
    );
    if (!allPdf) return { ok: false, reason: "All files must be PDFs" };
    return { ok: true };
  },
  async convert(files, opts, signal) {
    const harness = new WorkerHarness<PdfMergeOptions>(
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
