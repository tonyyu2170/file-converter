import { loadFfmpeg } from "@/engines/_shared/ffmpeg";
import { decodePeaksInWorker } from "@/engines/_shared/trim-scrubber/decode-peaks";
import type { ConversionProgress, OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import { type AudioTrimOptions, isLossyOutput, outputExtensionFor, outputMimeFor } from "./options";

// Cancellation note: this worker uses the WorkerHarness in `persistent: true`
// mode (see ./index.ts). In-flight ffmpeg work is NOT terminated when the user
// aborts — the rejected host promise unblocks the UI immediately, but ffmpeg
// keeps grinding inside the worker until the current pass finishes. Trim with
// -c copy is sub-second on typical inputs; re-encode of a long input may take
// seconds. Acceptable for v2; revisit if user-perceivable lag shows up.

function replaceExtension(name: string, newExt: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}-trim.${newExt}`;
}

function ffmpegCodec(fmt: "mp3" | "wav" | "m4a" | "flac"): string {
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
      throw new Error(`audio-trim: unknown output format: ${_exhaustive}`);
    }
  }
}

const api = {
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    type: string,
    opts: AudioTrimOptions,
    onProgress?: (p: ConversionProgress) => void,
  ): Promise<OutputItem> {
    if (opts.endSec <= opts.startSec) {
      throw new Error(
        `audio-trim: endSec (${opts.endSec}) must be greater than startSec (${opts.startSec})`,
      );
    }

    onProgress?.({ kind: "model-loading", loaded: 0, total: 1 });
    const ff = await loadFfmpeg();
    onProgress?.({ kind: "model-loading", loaded: 1, total: 1 });

    const progressHandler = ({ progress }: { progress: number; time: number }) => {
      onProgress?.({ kind: "inference", pct: Math.max(0, Math.min(100, progress * 100)) });
    };
    ff.on("progress", progressHandler);

    const inExt = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "bin").toLowerCase();
    const outExt = outputExtensionFor(opts.outputFormat, name);
    const id = crypto.randomUUID();
    const inName = `in_${id}.${inExt}`;
    const outName = `out_${id}.${outExt}`;

    try {
      await ff.writeFile(inName, new Uint8Array(bytes));
      onProgress?.({ kind: "inference", pct: 0 });

      const args: string[] = ["-i", inName];
      // -ss/-to apply to both -c copy and re-encode pipelines.
      args.push("-ss", String(opts.startSec));
      args.push("-to", String(opts.endSec));
      args.push("-vn");

      if (opts.outputFormat === "same") {
        args.push("-c", "copy");
      } else {
        const codec = ffmpegCodec(opts.outputFormat);
        if (isLossyOutput(opts.outputFormat)) {
          args.push("-b:a", `${opts.bitrate}k`);
        }
        args.push("-c:a", codec);
      }
      args.push(outName);

      const exitCode = await ff.exec(args);
      if (exitCode !== 0) {
        throw new Error(`audio-trim: ffmpeg exited with code ${exitCode}`);
      }

      onProgress?.({ kind: "inference", pct: 100 });

      const out = await ff.readFile(outName);
      if (typeof out === "string") {
        throw new Error("audio-trim: ffmpeg returned text output unexpectedly");
      }

      const mime = outputMimeFor(opts.outputFormat, type);
      const blob = new Blob([out as Uint8Array<ArrayBuffer>], { type: mime });
      return {
        filename: replaceExtension(name, outExt),
        mime,
        blob,
      };
    } finally {
      ff.off("progress", progressHandler);
      try {
        await ff.deleteFile(inName);
      } catch {
        /* best-effort */
      }
      try {
        await ff.deleteFile(outName);
      } catch {
        /* best-effort */
      }
    }
  },

  async decodePeaks(
    bytes: ArrayBuffer,
    fileExtension: string,
    bucketCount: number,
  ): Promise<{ min: Float32Array; max: Float32Array }> {
    const ff = await loadFfmpeg();
    return decodePeaksInWorker(ff, bytes, fileExtension, bucketCount);
  },
};

Comlink.expose(api);
