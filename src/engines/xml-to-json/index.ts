import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";

const stub: SingleInputEngine<Record<string, never>, OutputItem> = {
  id: "xml-to-json",
  inputAccept: [],
  inputMime: [],
  outputMime: "application/octet-stream",
  defaultOptions: {},
  category: "data",
  library: "fast-xml-parser",
  license: "MIT",
  cardinality: "single",
  validate: () => ({ ok: false, reason: "stub" }),
  convert: () => Promise.reject(new Error("stub")),
};

export default stub;
