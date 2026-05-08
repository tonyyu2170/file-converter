// src/engines/video-trim/index.ts
import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type VideoTrimOptions, defaultVideoTrimOptions } from "./options";
import { VideoTrimOptionsPanel } from "./options-panel";

const SUPPORTED_INPUT_MIMES = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"];
const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB
const MIN_TRIM_SEC = 0.1;

// Module-scoped persistent harness so ffmpeg loads once across probe
// (called from OptionsPanel) AND convert (called from the engine lifecycle).
// Mirrors audio-trim's pattern.
let harness: WorkerHarness<VideoTrimOptions> | null = null;
export function getVideoTrimHarness(): WorkerHarness<VideoTrimOptions> {
  if (!harness) {
    harness = new WorkerHarness<VideoTrimOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
      { persistent: true },
    );
  }
  return harness;
}

export function disposeVideoTrimHarness(): void {
  harness?.dispose();
  harness = null;
}

const engine: SingleInputEngine<VideoTrimOptions, OutputItem> = {
  id: "video-trim",
  inputAccept: [".mp4", ".mov", ".webm", ".mkv"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "video/mp4",
  defaultOptions: defaultVideoTrimOptions,
  category: "video",
  library: "ffmpeg.wasm",
  license: "GPL-2.0-or-later",
  cardinality: "single",
  isReadyToConvert: (opts) =>
    opts.startSec >= 0 &&
    opts.endSec > opts.startSec &&
    opts.endSec - opts.startSec >= MIN_TRIM_SEC,
  OptionsPanel: VideoTrimOptionsPanel,
  validate(file) {
    const mimeOk = SUPPORTED_INPUT_MIMES.includes(file.type);
    const extOk = /\.(mp4|mov|webm|mkv)$/i.test(file.name);
    if (!mimeOk && !extOk) {
      return { ok: false, reason: "Expected an MP4, MOV, WebM, or MKV file" };
    }
    if (file.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        reason: `File too large for video-trim (limit 100 MB; got ${(file.size / 1_000_000).toFixed(1)} MB).`,
      };
    }
    return { ok: true };
  },
  async convert(file, opts, signal, runOpts) {
    const result = await getVideoTrimHarness().runSingle(file, opts, signal, runOpts);
    if (Array.isArray(result)) {
      const first = result[0];
      if (!first) throw new Error("video-trim: engine returned empty array");
      return first;
    }
    return result;
  },
};

export default engine;
