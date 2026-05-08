// src/engines/video-trim/worker.ts
import { loadFfmpeg } from "@/engines/_shared/ffmpeg";
import { probeWithFfmpeg } from "@/engines/_shared/ffmpeg/probe";
import { extractFrameStripInWorker } from "@/engines/_shared/trim-scrubber/frame-strip";
import type { ConversionProgress, OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import {
  type VideoTrimOptions,
  containerSupportsCodecs,
  outputExtensionFor,
  outputMimeFor,
} from "./options";

function replaceExtension(name: string, newExt: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}-trimmed.${newExt}`;
}

const api = {
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    type: string,
    opts: VideoTrimOptions,
    onProgress?: (p: ConversionProgress) => void,
  ): Promise<OutputItem> {
    if (opts.endSec <= opts.startSec) {
      throw new Error(
        `video-trim: endSec (${opts.endSec}) must be greater than startSec (${opts.startSec})`,
      );
    }

    onProgress?.({ kind: "model-loading", loaded: 0, total: 1 });
    const ff = await loadFfmpeg();
    onProgress?.({ kind: "model-loading", loaded: 1, total: 1 });

    // Derive the input extension before the probe call so we pass a proper
    // extension (e.g. `.mp4`) rather than the full filename.
    const inExt = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "bin").toLowerCase();

    // Defensive convert-time codec/container check. The options-panel
    // disables incompatible container choices in its dropdown, but a
    // stale option value (or a programmatic caller) could slip through.
    if (opts.containerFormat !== "same") {
      const probe = await probeWithFfmpeg(ff, bytes, `.${inExt}`);
      if (!containerSupportsCodecs(opts.containerFormat, probe.videoCodec, probe.audioCodec)) {
        throw new Error(
          `Can't trim into ${opts.containerFormat.toUpperCase()}: this video uses ${probe.videoCodec ?? "an unknown video codec"}${probe.audioCodec ? ` and ${probe.audioCodec}` : ""}. Pick MKV or 'same'.`,
        );
      }
    }

    const progressHandler = ({ progress }: { progress: number; time: number }) => {
      onProgress?.({
        kind: "inference",
        pct: Math.max(0, Math.min(100, progress * 100)),
      });
    };
    ff.on("progress", progressHandler);

    const outExt = outputExtensionFor(opts.containerFormat, name);
    const id = crypto.randomUUID();
    const inName = `in_${id}.${inExt}`;
    const outName = `out_${id}.${outExt}`;

    try {
      await ff.writeFile(inName, new Uint8Array(bytes));
      onProgress?.({ kind: "inference", pct: 0 });

      // -ss before -i for fast keyframe seek.
      const args: string[] = [
        "-ss",
        String(opts.startSec),
        "-to",
        String(opts.endSec),
        "-i",
        inName,
        "-c",
        "copy",
        "-avoid_negative_ts",
        "make_zero",
        outName,
      ];
      const exit = await ff.exec(args);
      if (exit !== 0) {
        throw new Error(`video-trim: ffmpeg exited with code ${exit}`);
      }
      onProgress?.({ kind: "inference", pct: 100 });

      const out = await ff.readFile(outName);
      if (typeof out === "string") {
        throw new Error("video-trim: ffmpeg returned text output unexpectedly");
      }
      const mime = outputMimeFor(opts.containerFormat, type);
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

  async probe(bytes: ArrayBuffer, fileExtension: string) {
    const ff = await loadFfmpeg();
    return probeWithFfmpeg(ff, bytes, fileExtension);
  },

  async extractFrameStrip(args: {
    bytes: ArrayBuffer;
    fileExtension: string;
    durationSec: number;
    sourceWidth: number;
    sourceHeight: number;
    count: number;
    heightPx: number;
  }) {
    const ff = await loadFfmpeg();
    return extractFrameStripInWorker({
      ff,
      fileBytes: args.bytes,
      fileExtension: args.fileExtension,
      durationSec: args.durationSec,
      sourceWidth: args.sourceWidth,
      sourceHeight: args.sourceHeight,
      count: args.count,
      heightPx: args.heightPx,
    });
  },
};

Comlink.expose(api);
