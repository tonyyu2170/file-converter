import type { FFmpeg as FFmpegType } from "@ffmpeg/ffmpeg";

// Side-effecting at module load: nothing. The FFmpeg instance is constructed
// lazily on first loadFfmpeg() call so this module can sit in a worker
// without paying the import cost until a conversion actually runs.
//
// Both URLs are same-origin (`/ffmpeg/...`) — written this way so the worker
// never makes an off-origin fetch during conversion, honoring the project's
// `connect-src 'self'` CSP. Bytes are populated by scripts/copy-ffmpeg-core.mjs
// from node_modules/@ffmpeg/core/dist/umd/.

export type FFmpegProgress = { percent: number; phase?: string };

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
