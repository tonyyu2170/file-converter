import type { FFmpeg as FFmpegType } from "@ffmpeg/ffmpeg";

// Module-load cost: the only top-level statement that references @ffmpeg/ffmpeg
// is `import type`, which is erased at compile time. The runtime
// `await import("@ffmpeg/ffmpeg")` lives inside loadFfmpeg() — DO NOT hoist it
// to a static top-level import, or scripts/check-bundle-isolation.mjs will
// flag this module as leaking @ffmpeg/ffmpeg into the homepage chunk.
//
// Bytes for both the MT and ST cores are populated by
// scripts/copy-ffmpeg-core.mjs from
// node_modules/@ffmpeg/{core-mt,core}/dist/umd/. Same-origin paths only
// (CSP `connect-src 'self'`).

const MT_PATHS = {
  coreURL: "/ffmpeg/mt/ffmpeg-core.js",
  wasmURL: "/ffmpeg/mt/ffmpeg-core.wasm",
  workerURL: "/ffmpeg/mt/ffmpeg-core.worker.js",
} as const;

const ST_PATHS = {
  coreURL: "/ffmpeg/st/ffmpeg-core.js",
  wasmURL: "/ffmpeg/st/ffmpeg-core.wasm",
} as const;

// `crossOriginIsolated` is fixed for the agent cluster's lifetime by the
// COOP/COEP headers received with the top-level document — it cannot change
// mid-session — so memoizing the MT/ST decision into the singleton is safe.
// The `typeof` arm is defensive against runtimes that don't define the
// property (jsdom, non-browser harnesses); lib.dom types it as boolean.
function isCrossOriginIsolated(): boolean {
  return (
    typeof globalThis.crossOriginIsolated !== "undefined" && globalThis.crossOriginIsolated === true
  );
}

let instancePromise: Promise<FFmpegType> | null = null;

export async function loadFfmpeg(): Promise<FFmpegType> {
  if (instancePromise) return instancePromise;
  instancePromise = (async () => {
    // Dynamic import keeps @ffmpeg/ffmpeg out of the homepage chunk.
    // scripts/check-bundle-isolation.mjs gates this at build time.
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const ff = new FFmpeg();
    await ff.load(isCrossOriginIsolated() ? MT_PATHS : ST_PATHS);
    return ff;
  })().catch((err) => {
    // On failure, clear the singleton so the next call retries. Note: the
    // retry will re-evaluate isCrossOriginIsolated() — which hasn't changed
    // — so an MT-load failure retries on MT, not ST. ST-as-fallback for
    // mid-session MT-asset failures is a Phase 22+ concern.
    instancePromise = null;
    throw err;
  });
  return instancePromise;
}

/** Test-only: clear the memoized instance. Do NOT export from any public surface. */
export function __resetForTests(): void {
  instancePromise = null;
}
