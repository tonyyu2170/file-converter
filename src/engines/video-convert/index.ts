import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type VideoConvertOptions, defaultVideoConvertOptions } from "./options";
import { VideoConvertOptionsPanel } from "./options-panel";

const SUPPORTED_INPUT_MIMES = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"];

// v2 design §7.1: 100 MB cap. Constrained by ffmpeg.wasm memory and the
// "users will wait" tolerance for browser-side full transcode.
const MAX_FILE_BYTES = 100 * 1024 * 1024;

// Non-persistent harness: each conversion gets a fresh worker so signal.abort()
// terminates the worker — and therefore in-flight ffmpeg — at the OS boundary.
// Audio-convert / audio-trim / video-trim / video-extract-audio all use
// persistent because their passes finish quickly. Video transcodes can run
// for minutes, so honest cancellation matters more than the ~1–2 s WASM
// cold-start cost on each conversion.
const engine: SingleInputEngine<VideoConvertOptions, OutputItem> = {
  id: "video-convert",
  inputAccept: [".mp4", ".mov", ".webm", ".mkv"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "video/mp4",
  defaultOptions: defaultVideoConvertOptions,
  category: "video",
  library: "ffmpeg.wasm",
  license: "GPL-2.0-or-later",
  cardinality: "single",
  isReadyToConvert: (opts) => opts.outputFormat !== null,
  OptionsPanel: VideoConvertOptionsPanel,
  validate(file) {
    const mimeOk = SUPPORTED_INPUT_MIMES.includes(file.type);
    const extOk = /\.(mp4|mov|webm|mkv)$/i.test(file.name);
    if (!mimeOk && !extOk) {
      return { ok: false, reason: "Expected an MP4, MOV, WebM, or MKV file" };
    }
    if (file.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        reason: `File too large for video-convert (limit 100 MB; got ${(file.size / 1_000_000).toFixed(1)} MB).`,
      };
    }
    return { ok: true };
  },
  async convert(file, opts, signal, runOpts) {
    // Per-call ephemeral harness — fresh worker each time, terminates on abort.
    const harness = new WorkerHarness<VideoConvertOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
      { persistent: false },
    );
    try {
      const result = await harness.runSingle(file, opts, signal, runOpts);
      if (Array.isArray(result)) {
        const first = result[0];
        if (!first) throw new Error("video-convert: engine returned empty array");
        return first;
      }
      return result;
    } finally {
      harness.dispose();
    }
  },
};

export default engine;
