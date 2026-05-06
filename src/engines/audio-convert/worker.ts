import { fetchFile } from "@ffmpeg/util";
import * as Comlink from "comlink";
import { loadFfmpeg } from "@/engines/_shared/ffmpeg";
import type { ConversionProgress, OutputItem } from "@/engines/_shared/types";
import {
  type AudioConvertOptions,
  OUTPUT_EXTENSION,
  OUTPUT_MIME,
  isLossy,
} from "./options";

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

    try {
      const inExt = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "bin").toLowerCase();
      const inName = `in.${inExt}`;
      const outExt = OUTPUT_EXTENSION[fmt];
      const outName = `out.${outExt}`;

      await ff.writeFile(inName, await fetchFile(new Blob([bytes])));

      onProgress?.({ kind: "inference", pct: 0 });

      const codec = ffmpegCodec(fmt);
      const args = ["-i", inName];
      if (isLossy(fmt)) {
        args.push("-b:a", `${opts.bitrate}k`);
      }
      args.push("-c:a", codec, outName);
      await ff.exec(args);

      onProgress?.({ kind: "inference", pct: 100 });

      const out = await ff.readFile(outName);
      if (typeof out === "string") {
        throw new Error("audio-convert: ffmpeg returned text output unexpectedly");
      }

      // Best-effort cleanup of virtual FS entries.
      try {
        await ff.deleteFile(inName);
        await ff.deleteFile(outName);
      } catch {
        /* best-effort */
      }

      // Copy into a plain ArrayBuffer — Uint8Array<ArrayBufferLike> cannot be
      // directly accepted by Blob when the underlying buffer is a
      // SharedArrayBuffer (which @ffmpeg/ffmpeg may use for its virtual FS).
      const plainBuf: ArrayBuffer = out.buffer instanceof ArrayBuffer
        ? out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
        : new Uint8Array(out).buffer;
      const blob = new Blob([plainBuf], { type: OUTPUT_MIME[fmt] });
      return {
        filename: replaceExtension(name, OUTPUT_EXTENSION[fmt]),
        mime: OUTPUT_MIME[fmt],
        blob,
      };
    } finally {
      ff.off("progress", progressHandler);
    }
  },
};

Comlink.expose(api);
