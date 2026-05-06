import * as Comlink from "comlink";
import { loadFfmpeg } from "@/engines/_shared/ffmpeg";
import type { ConversionProgress, OutputItem } from "@/engines/_shared/types";
import {
  type AudioConvertOptions,
  OUTPUT_EXTENSION,
  OUTPUT_MIME,
  isLossy,
} from "./options";

// Cancellation note: this worker uses the WorkerHarness in `persistent: true`
// mode, which means in-flight ffmpeg work is NOT terminated when the user
// aborts — the rejected host promise unblocks the UI immediately, but
// ffmpeg keeps grinding inside the worker until the current pass finishes.
// Audio operations are short enough that the gap is acceptable; revisit if
// large-file workflows expose user-perceivable lag.

function replaceExtension(name: string, newExt: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.${newExt}`;
}

function ffmpegCodec(fmt: NonNullable<AudioConvertOptions["outputFormat"]>): string {
  switch (fmt) {
    case "mp3":
      return "libmp3lame";
    case "wav":
      return "pcm_s16le";
    case "m4a":
      return "aac";
    case "flac":
      return "flac";
    default: {
      const _exhaustive: never = fmt;
      throw new Error(`audio-convert: unknown output format: ${_exhaustive}`);
    }
  }
}

const api = {
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    _type: string,
    opts: AudioConvertOptions,
    onProgress?: (p: ConversionProgress) => void,
  ): Promise<OutputItem> {
    if (!opts.outputFormat) {
      throw new Error("audio-convert: outputFormat must be set before conversion");
    }
    const fmt = opts.outputFormat;

    // Phase 1: load ffmpeg (cached singleton — subsequent calls return the same
    // instance without re-fetching the WASM binary).
    onProgress?.({ kind: "model-loading", loaded: 0, total: 1 });
    const ff = await loadFfmpeg();
    onProgress?.({ kind: "model-loading", loaded: 1, total: 1 });

    const progressHandler = ({ progress }: { progress: number; time: number }) => {
      onProgress?.({ kind: "inference", pct: Math.max(0, Math.min(100, progress * 100)) });
    };
    ff.on("progress", progressHandler);

    const inExt = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "bin").toLowerCase();
    const outExt = OUTPUT_EXTENSION[fmt];
    const id = crypto.randomUUID();
    let inName = `in_${id}.${inExt}`;
    let outName = `out_${id}.${outExt}`;

    try {
      await ff.writeFile(inName, new Uint8Array(bytes));

      onProgress?.({ kind: "inference", pct: 0 });

      const codec = ffmpegCodec(fmt);
      const args = ["-i", inName, "-vn"];
      if (isLossy(fmt)) {
        args.push("-b:a", `${opts.bitrate}k`);
      }
      args.push("-c:a", codec, outName);

      // C1: check exit code — non-zero means ffmpeg failed.
      const exitCode = await ff.exec(args);
      if (exitCode !== 0) {
        throw new Error(`audio-convert: ffmpeg exited with code ${exitCode}`);
      }

      onProgress?.({ kind: "inference", pct: 100 });

      const out = await ff.readFile(outName);
      if (typeof out === "string") {
        throw new Error("audio-convert: ffmpeg returned text output unexpectedly");
      }

      // I2: @ffmpeg/core@0.12.10 is --disable-pthreads (single-threaded UMD);
      // SharedArrayBuffer cannot appear. Blob constructor accepts Uint8Array directly.
      const blob = new Blob([out as Uint8Array<ArrayBuffer>], { type: OUTPUT_MIME[fmt] });
      return {
        filename: replaceExtension(name, OUTPUT_EXTENSION[fmt]),
        mime: OUTPUT_MIME[fmt],
        blob,
      };
    } finally {
      ff.off("progress", progressHandler);
      try { await ff.deleteFile(inName); } catch { /* best-effort */ }
      try { await ff.deleteFile(outName); } catch { /* best-effort */ }
    }
  },
};

Comlink.expose(api);
