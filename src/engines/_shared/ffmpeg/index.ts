import type { FFmpeg as FFmpegType } from "@ffmpeg/ffmpeg";

// Module-load cost: the only top-level statement that references @ffmpeg/ffmpeg
// is `import type`, which is erased at compile time. The runtime
// `await import("@ffmpeg/ffmpeg")` lives inside loadFfmpeg() — DO NOT hoist it
// to a static top-level import, or scripts/check-bundle-isolation.mjs will
// flag this module as leaking @ffmpeg/ffmpeg into the homepage chunk.
//
// CORE_URL/WASM_URL are same-origin paths so the worker never makes an off-
// origin fetch during conversion (project's `connect-src 'self'` CSP).
// Bytes are populated by scripts/copy-ffmpeg-core.mjs from
// node_modules/@ffmpeg/core/dist/umd/.

const CORE_URL = "/ffmpeg/ffmpeg-core.js";
const WASM_URL = "/ffmpeg/ffmpeg-core.wasm";

let instancePromise: Promise<FFmpegType> | null = null;

export async function loadFfmpeg(): Promise<FFmpegType> {
  if (instancePromise) return instancePromise;
  instancePromise = (async () => {
    // Dynamic import keeps @ffmpeg/ffmpeg out of the homepage chunk.
    // scripts/check-bundle-isolation.mjs gates this at build time.
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const ff = new FFmpeg();
    await ff.load({ coreURL: CORE_URL, wasmURL: WASM_URL });
    return ff;
  })().catch((err) => {
    instancePromise = null;
    throw err;
  });
  return instancePromise;
}

/** Test-only: clear the memoized instance. Do NOT export from any public surface. */
export function __resetForTests(): void {
  instancePromise = null;
}
