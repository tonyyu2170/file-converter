// src/engines/xml-to-json/index.ts
import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type XmlToJsonOptions, defaultXmlToJsonOptions } from "./options";
import { XmlToJsonOptionsPanel } from "./options-panel";

const MAX_FILE_BYTES = 50 * 1_000_000;

const engine: SingleInputEngine<XmlToJsonOptions, OutputItem> = {
  id: "xml-to-json",
  inputAccept: [".xml"],
  inputMime: ["application/xml", "text/xml"],
  outputMime: "application/json",
  defaultOptions: defaultXmlToJsonOptions,
  category: "data",
  library: "fast-xml-parser",
  license: "MIT",
  cardinality: "single",
  OptionsPanel: XmlToJsonOptionsPanel,
  validate(file) {
    const lowerName = file.name.toLowerCase();
    const extOk = lowerName.endsWith(".xml");
    const mimeOk = file.type === "application/xml" || file.type === "text/xml";
    if (!extOk && !mimeOk) {
      return { ok: false, reason: "Expected an .xml file" };
    }
    if (file.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        reason: `File too large for xml-to-json (limit 50 MB; got ${(file.size / 1_000_000).toFixed(1)} MB).`,
      };
    }
    return { ok: true };
  },
  async convert(file, opts, signal) {
    const harness = new WorkerHarness<XmlToJsonOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    );
    const result = await harness.runSingle(file, opts, signal);
    if (Array.isArray(result)) {
      const first = result[0];
      if (!first) throw new Error("xml-to-json: engine returned empty array");
      return first;
    }
    return result;
  },
};

export default engine;
