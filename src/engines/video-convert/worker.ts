import { loadFfmpeg } from "@/engines/_shared/ffmpeg";
import type { ConversionProgress, OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import {
  CRF_BY_QUALITY,
  OUTPUT_EXTENSION,
  OUTPUT_MIME,
  type VideoConvertOptions,
  audioCodec,
  videoCodec,
} from "./options";

// Cancellation note: this worker runs under WorkerHarness in `persistent: false`
// mode, which means signal.abort() at the host terminates this worker — and
// therefore the in-flight ffmpeg pass — at the OS-thread boundary. This is the
// behavior the v2 design §4.5 prescribes for slow engines: cancel must take
// effect, not just unblock the UI.
//
// The cost: each conversion spawns a fresh worker; loadFfmpeg() re-instantiates
// FFmpeg() and re-calls .load(). The WASM bytes are HTTP-cached so this is
// ~1–2 s of cold start, dwarfed by transcode time on any realistic input.

function suffixedFilename(name: string, suffix: string, newExt: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}${suffix}.${newExt}`;
}

function preset(fmt: NonNullable<VideoConvertOptions["outputFormat"]>): string[] {
  if (fmt === "webm") {
    // libvpx (VP8): in @ffmpeg/core's single-threaded build, low -cpu-used
    // values (0–2) are punishingly slow. Use cpu-used 5 with -deadline good
    // for an acceptable quality/speed point in a browser environment.
    return ["-deadline", "good", "-cpu-used", "5"];
  }
  // libx264: medium preset is the standard quality/speed balance.
  return ["-preset", "medium"];
}

const api = {
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    _type: string,
    opts: VideoConvertOptions,
    onProgress?: (p: ConversionProgress) => void,
  ): Promise<OutputItem> {
    if (!opts.outputFormat) {
      throw new Error("video-convert: outputFormat must be set before conversion");
    }
    const fmt = opts.outputFormat;

    onProgress?.({ kind: "model-loading", loaded: 0, total: 1 });
    const ff = await loadFfmpeg();
    onProgress?.({ kind: "model-loading", loaded: 1, total: 1 });

    const progressHandler = ({ progress }: { progress: number; time: number }) => {
      onProgress?.({ kind: "inference", pct: Math.max(0, Math.min(100, progress * 100)) });
    };
    ff.on("progress", progressHandler);

    // Capture the trailing ffmpeg log so a non-zero exit gives an actionable
    // error rather than just "ffmpeg exited with code N".
    const logTail: string[] = [];
    const logHandler = ({ message }: { type: string; message: string }) => {
      logTail.push(message);
      if (logTail.length > 12) logTail.shift();
    };
    ff.on("log", logHandler);

    const inExt = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "bin").toLowerCase();
    const outExt = OUTPUT_EXTENSION[fmt];
    const id = crypto.randomUUID();
    const inName = `in_${id}.${inExt}`;
    const outName = `out_${id}.${outExt}`;

    try {
      await ff.writeFile(inName, new Uint8Array(bytes));
      onProgress?.({ kind: "inference", pct: 0 });

      const args: string[] = [
        "-i",
        inName,
        "-c:v",
        videoCodec(fmt),
        "-crf",
        String(CRF_BY_QUALITY[opts.quality]),
        ...preset(fmt),
        "-c:a",
        audioCodec(fmt),
        // -movflags +faststart only meaningful for mp4/mov; harmless for webm
        // (ffmpeg ignores unknown flags for the matroska/webm muxer).
        ...(fmt === "webm" ? [] : ["-movflags", "+faststart"]),
        outName,
      ];

      const exitCode = await ff.exec(args);
      if (exitCode !== 0) {
        throw new Error(
          `video-convert: ffmpeg exited with code ${exitCode}\n${logTail.join("\n")}`,
        );
      }

      onProgress?.({ kind: "inference", pct: 100 });

      const out = await ff.readFile(outName);
      if (typeof out === "string") {
        throw new Error("video-convert: ffmpeg returned text output unexpectedly");
      }

      const blob = new Blob([out as Uint8Array<ArrayBuffer>], { type: OUTPUT_MIME[fmt] });
      return {
        filename: suffixedFilename(name, "-converted", outExt),
        mime: OUTPUT_MIME[fmt],
        blob,
      };
    } finally {
      ff.off("progress", progressHandler);
      ff.off("log", logHandler);
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
};

Comlink.expose(api);
