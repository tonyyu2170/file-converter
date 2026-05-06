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
  library: "mammoth",
  license: "BSD-3-Clause",
  cardinality: "single",
  OptionsPanel: DocxToTxtOptionsPanel,
  validate(file) {
    // Extension fallback for browsers that emit empty file.type for .docx
    // (macOS Finder / Safari, some Chrome configs). Mirrors the validate
    // pattern in docx-to-pdf, markdown-to-pdf, and txt-to-pdf.
    if (file.type === DOCX_MIME) return { ok: true };
    if (/\.docx$/i.test(file.name)) return { ok: true };
    return { ok: false, reason: "Expected a .docx file" };
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
