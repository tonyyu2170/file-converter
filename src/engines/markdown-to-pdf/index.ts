import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type MarkdownToPdfOptions, defaultMarkdownToPdfOptions } from "./options";
import { MarkdownToPdfOptionsPanel } from "./options-panel";

const SUPPORTED_INPUT_MIMES = ["text/markdown", "text/x-markdown", ""];

const engine: SingleInputEngine<MarkdownToPdfOptions, OutputItem> = {
  id: "markdown-to-pdf",
  inputAccept: [".md", ".markdown"],
  inputMime: ["text/markdown"],
  outputMime: "application/pdf",
  defaultOptions: defaultMarkdownToPdfOptions,
  category: "document",
  cardinality: "single",
  OptionsPanel: MarkdownToPdfOptionsPanel,
  validate(file) {
    // Markdown MIME varies by browser/OS; many emit empty string.
    // Accept by extension if MIME is missing.
    if (SUPPORTED_INPUT_MIMES.includes(file.type)) return { ok: true };
    if (/\.(md|markdown)$/i.test(file.name)) return { ok: true };
    return { ok: false, reason: "Expected a .md or .markdown file" };
  },
  async convert(file, opts, signal) {
    const harness = new WorkerHarness<MarkdownToPdfOptions>(
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
