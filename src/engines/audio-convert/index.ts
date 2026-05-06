import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type AudioConvertOptions, defaultAudioConvertOptions } from "./options";
import { AudioConvertOptionsPanel } from "./options-panel";

const SUPPORTED_INPUT_MIMES = ["audio/mpeg", "audio/wav", "audio/mp4", "audio/flac"];

// Spec §7.1 — 500 MB cap: typical music files fit comfortably; ffmpeg.wasm
// audio operations are fast at this size on the single-threaded core.
const MAX_FILE_BYTES = 500 * 1_000_000;

// Module-scoped persistent harness so ffmpeg loads once across a batch
// of conversions on the same route. Mirrors image-bg-remove's pattern.
let harness: WorkerHarness<AudioConvertOptions> | null = null;
function getHarness(): WorkerHarness<AudioConvertOptions> {
  if (!harness) {
    harness = new WorkerHarness<AudioConvertOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
      { persistent: true },
    );
  }
  return harness;
}

export function disposeAudioConvertHarness(): void {
  harness?.dispose();
  harness = null;
}

const engine: SingleInputEngine<AudioConvertOptions, OutputItem> = {
  id: "audio-convert",
  inputAccept: [".mp3", ".wav", ".m4a", ".flac"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "audio/mpeg",
  defaultOptions: defaultAudioConvertOptions,
  category: "audio",
  library: "ffmpeg.wasm (single-threaded core)",
  license: "GPL-2.0-or-later",
  cardinality: "single",
  isReadyToConvert: (opts) => opts.outputFormat !== null,
  OptionsPanel: AudioConvertOptionsPanel,
  validate(file) {
    const mimeOk = SUPPORTED_INPUT_MIMES.includes(file.type);
    const extOk = /\.(mp3|wav|m4a|flac)$/i.test(file.name);
    if (!mimeOk && !extOk) {
      return { ok: false, reason: "Expected an MP3, WAV, M4A, or FLAC file" };
    }
    if (file.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        reason: `File too large for audio-convert (limit 500 MB; got ${(file.size / 1_000_000).toFixed(1)} MB).`,
      };
    }
    return { ok: true };
  },
  async convert(file, opts, signal, runOpts) {
    const result = await getHarness().runSingle(file, opts, signal, runOpts);
    if (Array.isArray(result)) {
      const first = result[0];
      if (!first) throw new Error("engine returned empty array");
      return first;
    }
    return result;
  },
};

export default engine;
