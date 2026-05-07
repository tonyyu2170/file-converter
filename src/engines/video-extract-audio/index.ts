// src/engines/video-extract-audio/index.ts
import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import {
  defaultVideoExtractAudioOptions,
  type VideoExtractAudioOptions,
} from "./options";
import { VideoExtractAudioOptionsPanel } from "./options-panel";

const SUPPORTED_INPUT_MIMES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
];
const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

let harness: WorkerHarness<VideoExtractAudioOptions> | null = null;
export function getVideoExtractAudioHarness(): WorkerHarness<VideoExtractAudioOptions> {
  if (!harness) {
    harness = new WorkerHarness<VideoExtractAudioOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
      { persistent: true },
    );
  }
  return harness;
}

export function disposeVideoExtractAudioHarness(): void {
  harness?.dispose();
  harness = null;
}

const engine: SingleInputEngine<VideoExtractAudioOptions, OutputItem> = {
  id: "video-extract-audio",
  inputAccept: [".mp4", ".mov", ".webm", ".mkv"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "audio/mpeg",
  defaultOptions: defaultVideoExtractAudioOptions,
  category: "video",
  library: "ffmpeg.wasm",
  license: "GPL-2.0-or-later",
  cardinality: "single",
  isReadyToConvert: () => true,
  OptionsPanel: VideoExtractAudioOptionsPanel,
  validate(file) {
    const mimeOk = SUPPORTED_INPUT_MIMES.includes(file.type);
    const extOk = /\.(mp4|mov|webm|mkv)$/i.test(file.name);
    if (!mimeOk && !extOk) {
      return { ok: false, reason: "Expected an MP4, MOV, WebM, or MKV file" };
    }
    if (file.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        reason: `File too large for video-extract-audio (limit 100 MB; got ${(file.size / 1_000_000).toFixed(1)} MB).`,
      };
    }
    return { ok: true };
  },
  async convert(file, opts, signal, runOpts) {
    // No-audio guard via cached probe — runProbe deduplicates per File identity.
    const probe = await getVideoExtractAudioHarness().runProbe(file);
    if (!probe.hasAudio) {
      throw new Error("This video has no audio track");
    }
    const result = await getVideoExtractAudioHarness().runSingle(file, opts, signal, runOpts);
    if (Array.isArray(result)) {
      const first = result[0];
      if (!first) throw new Error("video-extract-audio: engine returned empty array");
      return first;
    }
    return result;
  },
};

export default engine;
