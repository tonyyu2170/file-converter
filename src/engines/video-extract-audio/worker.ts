// src/engines/video-extract-audio/worker.ts
import { loadFfmpeg } from "@/engines/_shared/ffmpeg";
import { probeWithFfmpeg } from "@/engines/_shared/ffmpeg/probe";
import type { ConversionProgress, OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import {
  OUTPUT_EXTENSION,
  OUTPUT_MIME,
  type VideoExtractAudioOptions,
  isLossy,
  sameOutputFor,
} from "./options";

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
      throw new Error(`video-extract-audio: unknown output format: ${_exhaustive}`);
    }
  }
}

function replaceWithSuffix(name: string, newExt: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}-audio.${newExt}`;
}

const api = {
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    _type: string,
    opts: VideoExtractAudioOptions,
    onProgress?: (p: ConversionProgress) => void,
  ): Promise<OutputItem> {
    onProgress?.({ kind: "model-loading", loaded: 0, total: 1 });
    const ff = await loadFfmpeg();
    onProgress?.({ kind: "model-loading", loaded: 1, total: 1 });

    const inExt = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "bin").toLowerCase();

    let outExt: string;
    let outMime: string;
    if (opts.outputFormat === "same") {
      const probe = await probeWithFfmpeg(ff, bytes, `.${inExt}`);
      const target = sameOutputFor(probe.audioCodec);
      outExt = target.ext;
      outMime = target.mime;
    } else {
      outExt = OUTPUT_EXTENSION[opts.outputFormat];
      outMime = OUTPUT_MIME[opts.outputFormat];
    }

    const progressHandler = ({ progress }: { progress: number; time: number }) => {
      onProgress?.({ kind: "inference", pct: Math.max(0, Math.min(100, progress * 100)) });
    };
    ff.on("progress", progressHandler);

    const id = crypto.randomUUID();
    const inName = `in_${id}.${inExt}`;
    const outName = `out_${id}.${outExt}`;

    try {
      await ff.writeFile(inName, new Uint8Array(bytes));
      onProgress?.({ kind: "inference", pct: 0 });

      const args: string[] = ["-i", inName, "-vn"];
      if (opts.outputFormat === "same") {
        args.push("-c:a", "copy");
      } else {
        const codec = ffmpegCodec(opts.outputFormat);
        if (isLossy(opts.outputFormat)) {
          args.push("-b:a", `${opts.bitrate}k`);
        }
        args.push("-c:a", codec);
      }
      args.push(outName);

      const exit = await ff.exec(args);
      if (exit !== 0) {
        throw new Error(`video-extract-audio: ffmpeg exited with code ${exit}`);
      }
      onProgress?.({ kind: "inference", pct: 100 });

      const out = await ff.readFile(outName);
      if (typeof out === "string") {
        throw new Error("video-extract-audio: ffmpeg returned text output unexpectedly");
      }
      const blob = new Blob([out as Uint8Array<ArrayBuffer>], { type: outMime });
      return {
        filename: replaceWithSuffix(name, outExt),
        mime: outMime,
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

  async probe(bytes: ArrayBuffer, fileExtension: string) {
    const ff = await loadFfmpeg();
    return probeWithFfmpeg(ff, bytes, fileExtension);
  },
};

Comlink.expose(api);
