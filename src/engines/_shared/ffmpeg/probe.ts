// src/engines/_shared/ffmpeg/probe.ts
//
// ffmpeg media probe. Two pieces:
//   - parseProbeOutput(text): pure regex parser, vitest-unit-tested.
//   - probeWithFfmpeg(ff, bytes, ext): worker-only thin wrapper that runs
//     `ffmpeg -i <in>` and feeds the captured stderr into parseProbeOutput.
//
// probeWithFfmpeg does NOT call loadFfmpeg() — see Phase 20 §2.5b for the
// rationale. Caller is the worker's own `probe` RPC handler.
//
// Real-ffmpeg coverage of probeWithFfmpeg lives in Playwright E2E, since
// vitest under Node cannot construct the ffmpeg WASM (the `node` package
// condition resolves to a throw-stub).

import type { FFmpeg as FFmpegType } from "@ffmpeg/ffmpeg";

export type ProbeResult = {
  durationSec: number;
  videoCodec: string | null;
  audioCodec: string | null;
  width: number;
  height: number;
  hasAudio: boolean;
};

const DURATION_RE = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/;
const VIDEO_STREAM_RE =
  /Stream\s+#\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?:\s*Video:\s*([a-z0-9_]+)[^\n]*?(\d{2,5})x(\d{2,5})/i;
const AUDIO_STREAM_RE = /Stream\s+#\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?:\s*Audio:\s*([a-z0-9_]+)/i;

/** Pure parser. Given the captured stderr from `ffmpeg -i <input>`,
 *  extract codec / duration / dimensions. Returns an empty-ish result
 *  for unparseable inputs (caller decides how to react). */
export function parseProbeOutput(text: string): ProbeResult {
  let durationSec = 0;
  const dm = text.match(DURATION_RE);
  if (dm?.[1] && dm[2] && dm[3]) {
    durationSec = Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]);
  }

  let videoCodec: string | null = null;
  let width = 0;
  let height = 0;
  // Scan line-by-line so we can check the full line for "(attached pic)"
  // before matching dimensions. Cover-art streams (iTunes MP4s, music
  // videos with embedded thumbnails) emit a mjpeg/jpeg stream first and
  // would preempt the real video stream if we used text.match() directly.
  for (const line of text.split("\n")) {
    if (/\battached pic\b/i.test(line)) continue;
    const vm = line.match(VIDEO_STREAM_RE);
    if (vm?.[1] && vm[2] && vm[3]) {
      videoCodec = vm[1].toLowerCase();
      width = Number(vm[2]);
      height = Number(vm[3]);
      break;
    }
  }

  let audioCodec: string | null = null;
  const am = text.match(AUDIO_STREAM_RE);
  if (am?.[1]) {
    audioCodec = am[1].toLowerCase();
  }

  return {
    durationSec,
    videoCodec,
    audioCodec,
    width,
    height,
    hasAudio: audioCodec !== null,
  };
}

/** Worker-only ffmpeg wrapper. Runs `ffmpeg -i <input>` (which exits 1 with
 *  no output), captures the stderr lines via the log event, and feeds them
 *  to parseProbeOutput. Cleans up MEMFS even if exec rejects. */
export async function probeWithFfmpeg(
  ff: FFmpegType,
  fileBytes: ArrayBuffer,
  fileExtension: string,
): Promise<ProbeResult> {
  const ext = fileExtension.startsWith(".") ? fileExtension : `.${fileExtension || "bin"}`;
  const id = crypto.randomUUID();
  const inName = `probe_${id}${ext}`;

  const lines: string[] = [];
  // The @ffmpeg/ffmpeg log event payload has a `message` field. Inline
  // structural type (avoid the named LogEvent import — its export shape
  // varies across @ffmpeg/ffmpeg minor versions).
  const onLog = (e: { message: string }) => {
    lines.push(e.message);
  };
  ff.on("log", onLog);

  try {
    await ff.writeFile(inName, new Uint8Array(fileBytes));
    // `ffmpeg -i <input>` with no output spec resolves with exit code 1
    // and prints stream info on stderr — we ignore the exit code; only
    // the captured log lines matter. ff.exec resolves with the exit code
    // (it does not reject on non-zero — verified against the other
    // engine workers).
    await ff.exec(["-i", inName]);
  } finally {
    ff.off("log", onLog);
    try {
      await ff.deleteFile(inName);
    } catch {
      /* best-effort */
    }
  }

  return parseProbeOutput(lines.join("\n"));
}
