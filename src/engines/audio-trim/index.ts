import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type AudioTrimOptions, defaultAudioTrimOptions } from "./options";
import { AudioTrimOptionsPanel } from "./options-panel";

const SUPPORTED_INPUT_MIMES = ["audio/mpeg", "audio/wav", "audio/mp4", "audio/flac"];

// Spec §7.1 — 500 MB cap, same as audio-convert.
const MAX_FILE_BYTES = 500 * 1_000_000;
const MIN_TRIM_SEC = 0.1;

// Module-scoped persistent harness so ffmpeg loads once across decode-peaks
// (called from OptionsPanel) AND convert (called from the engine lifecycle).
// Mirrors audio-convert's pattern.
let harness: WorkerHarness<AudioTrimOptions> | null = null;
export function getAudioTrimHarness(): WorkerHarness<AudioTrimOptions> {
  if (!harness) {
    harness = new WorkerHarness<AudioTrimOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
      { persistent: true },
    );
  }
  return harness;
}

export function disposeAudioTrimHarness(): void {
  harness?.dispose();
  harness = null;
}

const engine: SingleInputEngine<AudioTrimOptions, OutputItem> = {
  id: "audio-trim",
  inputAccept: [".mp3", ".wav", ".m4a", ".flac"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "audio/mpeg",
  defaultOptions: defaultAudioTrimOptions,
  category: "audio",
  library: "ffmpeg.wasm (single-threaded core)",
  license: "GPL-2.0-or-later",
  cardinality: "single",
  isReadyToConvert: (opts) =>
    opts.startSec >= 0 &&
    opts.endSec > opts.startSec &&
    opts.endSec - opts.startSec >= MIN_TRIM_SEC,
  OptionsPanel: AudioTrimOptionsPanel,
  validate(file) {
    const mimeOk = SUPPORTED_INPUT_MIMES.includes(file.type);
    const extOk = /\.(mp3|wav|m4a|flac)$/i.test(file.name);
    if (!mimeOk && !extOk) {
      return { ok: false, reason: "Expected an MP3, WAV, M4A, or FLAC file" };
    }
    if (file.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        reason: `File too large for audio-trim (limit 500 MB; got ${(file.size / 1_000_000).toFixed(1)} MB).`,
      };
    }
    return { ok: true };
  },
  async convert(file, opts, signal, runOpts) {
    const result = await getAudioTrimHarness().runSingle(file, opts, signal, runOpts);
    if (Array.isArray(result)) {
      const first = result[0];
      if (!first) throw new Error("audio-trim: engine returned empty array");
      return first;
    }
    return result;
  },
};

export default engine;
