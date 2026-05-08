// src/engines/_shared/trim-scrubber/frame-strip.ts
//
// Worker-only frame-strip extractor. Single ffmpeg pass produces N
// evenly-spaced JPEG thumbnails at the requested height with native
// aspect width. Returns raw bytes; the main-thread caller wraps each
// into a Blob + object URL after receiving them.
//
// Three exports:
//   - validateFrameStripArgs(args): throws on invalid input — pure, unit-tested.
//   - computeFrameStripWidthPx(sourceWidth, sourceHeight, heightPx): pure
//     width calculation, unit-tested.
//   - extractFrameStripInWorker(args): integration wrapper. Calls ffmpeg.
//     Real coverage lives in T11 Playwright since vitest can't load ffmpeg
//     under Node.

import type { FFmpeg as FFmpegType } from "@ffmpeg/ffmpeg";

export type FrameStripArgs = {
  ff: FFmpegType;
  fileBytes: ArrayBuffer;
  fileExtension: string;
  durationSec: number;
  sourceWidth: number;
  sourceHeight: number;
  count: number;
  heightPx: number;
};

export type FrameStripResult = {
  frames: Uint8Array[];
  widthPx: number;
};

/** Pure args validator. Throws on invalid input; otherwise returns void.
 *  Extracted so unit tests can exercise the rejection paths without
 *  loading ffmpeg. */
export function validateFrameStripArgs(args: {
  count: number;
  durationSec: number;
  sourceHeight: number;
}): void {
  if (args.count <= 0) throw new Error("frame-strip: count must be positive");
  if (args.durationSec <= 0) throw new Error("frame-strip: durationSec must be positive");
  if (args.sourceHeight <= 0) throw new Error("frame-strip: sourceHeight must be positive");
}

/** Pure width calculation. The frame strip extracts at fixed heightPx
 *  with native aspect, so width is derived per-source. Identical for
 *  every frame in the strip. */
export function computeFrameStripWidthPx(
  sourceWidth: number,
  sourceHeight: number,
  heightPx: number,
): number {
  return Math.round((heightPx * sourceWidth) / sourceHeight);
}

export async function extractFrameStripInWorker(args: FrameStripArgs): Promise<FrameStripResult> {
  const { ff, fileBytes, fileExtension, durationSec, sourceWidth, sourceHeight, count, heightPx } =
    args;
  validateFrameStripArgs({ count, durationSec, sourceHeight });

  const ext = fileExtension.startsWith(".") ? fileExtension : `.${fileExtension || "bin"}`;
  const id = crypto.randomUUID();
  const inName = `strip_${id}${ext}`;
  const outPattern = `frame_${id}_%03d.jpg`;
  // Pre-build the full output filename list so MEMFS cleanup in the
  // finally catches every frame ffmpeg may have written, even if a
  // later readFile rejects mid-loop.
  const outFiles = Array.from(
    { length: count },
    (_, i) => `frame_${id}_${String(i + 1).padStart(3, "0")}.jpg`,
  );

  try {
    // Defensive clone of the input ArrayBuffer — see probe.ts for the
    // underlying ffmpeg.wasm detach behavior. Today's callers always pass
    // fresh per-call buffers from the harness so detachment never bites,
    // but cloning here makes that invariant local rather than depending
    // on caller discipline.
    await ff.writeFile(inName, new Uint8Array(fileBytes.slice(0)));
    // ffmpeg.exec resolves with the exit code (it does not reject) — see
    // probe.ts for the same pattern. We need a clean exit (0) here because
    // a non-zero exit means the JPEGs we want to read won't be there.
    const exit = await ff.exec([
      "-i",
      inName,
      "-vf",
      `fps=${count}/${durationSec},scale=-1:${heightPx}`,
      "-frames:v",
      String(count),
      outPattern,
    ]);
    if (exit !== 0) {
      throw new Error(`frame-strip: ffmpeg exited with code ${exit}`);
    }

    const frames: Uint8Array[] = [];
    for (let i = 0; i < outFiles.length; i++) {
      const name = outFiles[i] as string;
      // Diagnostic wrap: a missing frame here usually means ffmpeg succeeded
      // but produced fewer frames than requested (input shorter than the
      // declared durationSec, or fps math rounded down).
      const data = await ff.readFile(name).catch((cause) => {
        throw new Error(
          `frame-strip: expected ${count} frames; failed to read frame ${i + 1} ` +
            `(input may be shorter than durationSec=${durationSec})`,
          { cause },
        );
      });
      if (typeof data === "string") {
        throw new Error(`frame-strip: ffmpeg returned text for ${name}`);
      }
      frames.push(new Uint8Array(data as Uint8Array));
    }

    const widthPx = computeFrameStripWidthPx(sourceWidth, sourceHeight, heightPx);
    return { frames, widthPx };
  } finally {
    try {
      await ff.deleteFile(inName);
    } catch {
      /* best-effort */
    }
    for (const name of outFiles) {
      try {
        await ff.deleteFile(name);
      } catch {
        /* best-effort */
      }
    }
  }
}
