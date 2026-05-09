// src/engines/archive-extract/index.ts
import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type ArchiveExtractOptions, defaultArchiveExtractOptions } from "./options";

const MAX_FILE_BYTES = 200 * 1_000_000;

const ACCEPT_EXT = [".zip", ".tar", ".tar.gz", ".tgz"];
const ACCEPT_MIME = [
  "application/zip",
  "application/x-zip-compressed",
  "application/x-tar",
  "application/gzip",
  "application/x-gzip",
  "application/x-compressed-tar",
];

const engine: SingleInputEngine<ArchiveExtractOptions, OutputItem[]> = {
  id: "archive-extract",
  inputAccept: ACCEPT_EXT,
  inputMime: ACCEPT_MIME,
  outputMime: "application/octet-stream",
  defaultOptions: defaultArchiveExtractOptions,
  archiveSuffix: "-extract",
  category: "archive",
  library: "fflate, in-house tar",
  license: "MIT",
  cardinality: "single",
  validate(file) {
    const lowerName = file.name.toLowerCase();
    const extOk = ACCEPT_EXT.some((ext) => lowerName.endsWith(ext));
    const mimeOk = ACCEPT_MIME.includes(file.type);
    if (!extOk && !mimeOk) {
      return { ok: false, reason: "Expected a .zip, .tar, .tar.gz, or .tgz file" };
    }
    if (file.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        reason: `File too large for archive-extract (limit 200 MB; got ${(file.size / 1_000_000).toFixed(1)} MB).`,
      };
    }
    return { ok: true };
  },
  async convert(file, opts, signal) {
    const harness = new WorkerHarness<ArchiveExtractOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    );
    const result = await harness.runSingle(file, opts, signal);
    return Array.isArray(result) ? result : [result];
  },
};

export default engine;
