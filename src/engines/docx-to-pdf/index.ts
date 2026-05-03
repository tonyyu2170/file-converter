import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type DocxToPdfOptions, defaultDocxToPdfOptions } from "./options";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Hard size cap from master spec §11.1 "Document conversion" row. */
const HARD_SIZE_LIMIT_BYTES = 100 * 1024 * 1024;

const engine: SingleInputEngine<DocxToPdfOptions, OutputItem> = {
  id: "docx-to-pdf",
  inputAccept: [".docx"],
  inputMime: [DOCX_MIME],
  outputMime: "application/pdf",
  defaultOptions: defaultDocxToPdfOptions,
  cardinality: "single",
  validate(file) {
    const isDocx = file.type === DOCX_MIME || file.name.toLowerCase().endsWith(".docx");
    if (!isDocx) return { ok: false, reason: "Expected a .docx file" };
    if (file.size > HARD_SIZE_LIMIT_BYTES) {
      return { ok: false, reason: "File exceeds 100 MB" };
    }
    return { ok: true };
  },
  async convert(file, opts, signal) {
    const harness = new WorkerHarness<DocxToPdfOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    );
    const result = await harness.runSingle(file, opts, signal);
    // Worker.convertSingle returns a single OutputItem.
    if (Array.isArray(result)) {
      const first = result[0];
      if (!first) throw new Error("docx-to-pdf: worker returned empty result");
      return first;
    }
    return result;
  },
};

export default engine;
