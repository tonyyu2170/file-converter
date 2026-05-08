import type { TesseractWorker } from "./types";

// Module-load cost: only `import type` references tesseract.js; the runtime
// `await import("tesseract.js")` lives inside loadTesseract() — DO NOT hoist
// to a static top-level import, or scripts/check-bundle-isolation.mjs will
// flag this module as leaking tesseract.js into the homepage chunk.
//
// All assets are populated by scripts/copy-tesseract-assets.mjs from
// node_modules/tesseract.js{,-core} into public/tesseract/. Same-origin
// paths only (CSP `connect-src 'self'`).
//
// Tesseract.js v7 createWorker signature (observed in Step 2.0):
//   createWorker(
//     langs?: string | string[] | Lang[],  // default "eng"
//     oem?: OEM,                           // default OEM.LSTM_ONLY (1)
//     options?: Partial<WorkerOptions>,    // workerPath, corePath, langPath,
//                                          // logger, etc.
//     config?: string | Partial<InitOptions>,
//   ): Promise<Worker>
//
// The logger is bound at createWorker() time and fires for every progress
// event on the worker's lifetime. We delegate through the `activeLogger` ref
// so callers can swap progress callbacks per-conversion without recreating the
// expensive persistent worker.

export type TesseractLogEvent = { status: string; progress: number };
export type TesseractLogger = (e: TesseractLogEvent) => void;

// OEM.LSTM_ONLY === 1 (from tesseract.js/src/constants/OEM.js).
const OEM_LSTM_ONLY = 1;

// Tesseract.js v7 browser default has workerBlobURL=true, which creates a
// blob URL containing `importScripts("${workerPath}")`. A root-relative
// path like "/tesseract/worker.min.js" is invalid in a blob worker context
// because blob URLs have no origin to resolve against. Use an absolute URL
// built from self.location.origin so the path resolves correctly regardless
// of whether loadTesseract() runs in a page or a nested Web Worker.
//
// corePath is set to the explicit simd-lstm variant rather than the
// directory. When getCore.js receives a path ending in ".js" it loads that
// file directly, bypassing its own WASM-feature-detect heuristic. The
// relaxedsimd-lstm binary in tesseract.js-core v7 contains native x86 SSE
// code (via emscripten) that crashes on ARM (Apple Silicon / CI) even when
// wasm-feature-detect.relaxedSimd() returns true. The simd-lstm variant is
// pure WASM SIMD and works on any modern browser regardless of host arch.
//
// langPath still points to the directory; Tesseract appends "eng.traineddata"
// or "eng.traineddata.gz" to it internally.
const origin = typeof self !== "undefined" ? self.location.origin : "";
const PATHS = {
  workerPath: `${origin}/tesseract/worker.min.js`,
  corePath: `${origin}/tesseract/tesseract-core-simd-lstm.wasm.js`,
  langPath: `${origin}/tesseract/`,
};

let instancePromise: Promise<TesseractWorker> | null = null;
let activeLogger: TesseractLogger | null = null;

/** Install a progress callback for the next/in-flight recognize call.
 *  Pass null to silence. Tesseract.js binds the logger at createWorker time,
 *  so we delegate through this mutable ref to support per-conversion progress
 *  on a persistent worker. */
export function setProgressLogger(cb: TesseractLogger | null): void {
  activeLogger = cb;
}

export function loadTesseract(): Promise<TesseractWorker> {
  if (instancePromise) return instancePromise;
  instancePromise = (async () => {
    // Dynamic import keeps tesseract.js out of the homepage chunk.
    // scripts/check-bundle-isolation.mjs gates this at build time.
    const { createWorker } = await import("tesseract.js");
    return createWorker("eng", OEM_LSTM_ONLY, {
      ...PATHS,
      // Narrow the full LoggerMessage to the public TesseractLogEvent shape
      // so callers don't need to know about v7's internal jobId/workerId
      // fields.
      logger: (msg) => activeLogger?.({ status: msg.status, progress: msg.progress }),
    });
  })().catch((err) => {
    // On failure, clear the singleton so the next call retries.
    instancePromise = null;
    throw err;
  });
  return instancePromise;
}

export async function disposeTesseract(): Promise<void> {
  const p = instancePromise;
  instancePromise = null;
  activeLogger = null;
  if (!p) return;
  const worker = await p.catch(() => null);
  if (worker) await worker.terminate();
}

/** Test-only: clear the memoized instance. Do NOT export from any public surface. */
export function __resetForTests(): void {
  instancePromise = null;
  activeLogger = null;
}
