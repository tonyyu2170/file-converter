import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type PdfToImageOptions, defaultPdfToImageOptions } from "./options";
import { PdfToImageOptionsPanel } from "./options-panel";

const SUPPORTED_INPUT_MIMES = ["application/pdf"];

const engine: SingleInputEngine<PdfToImageOptions, OutputItem[]> = {
  id: "pdf-to-image",
  inputAccept: [".pdf"],
  inputMime: SUPPORTED_INPUT_MIMES,
  // Default for the engine; per-OutputItem `mime` is authoritative when
  // format=jpeg (worker emits "image/jpeg" + .jpg filenames in that case).
  outputMime: "image/png",
  defaultOptions: defaultPdfToImageOptions,
  archiveSuffix: "-images",
  category: "pdf",
  library: "pdfjs-dist, Canvas",
  license: "mixed",
  cardinality: "single",
  OptionsPanel: PdfToImageOptionsPanel,
  isReadyToConvert() {
    return true;
  },
  validate(file) {
    return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
      ? { ok: true }
      : { ok: false, reason: "Expected a PDF file" };
  },
  async convert(file, opts, signal) {
    const harness = new WorkerHarness<PdfToImageOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    );
    const result = await harness.runSingle(file, opts, signal);
    return Array.isArray(result) ? result : [result];
  },
};

export default engine;
