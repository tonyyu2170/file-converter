import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";

const stub: SingleInputEngine<Record<string, never>, OutputItem> = {
  id: "json-format",
  inputAccept: [],
  inputMime: [],
  outputMime: "application/octet-stream",
  defaultOptions: {},
  category: "data",
  library: "built-in JSON",
  license: "MIT",
  cardinality: "single",
  validate: () => ({ ok: false, reason: "stub" }),
  convert: () => Promise.reject(new Error("stub")),
};

export default stub;
