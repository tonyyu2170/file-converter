import { type ImageSegmentationPipeline, env, pipeline } from "@huggingface/transformers";

// Side-effecting at module load — runs exactly once per worker context.
// These are the privacy-load-bearing settings: any deviation makes
// transformers.js attempt off-origin fetches.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = "/models/";
// `env.backends.onnx` is typed `Partial<Env> & { setLogLevel? }`, so
// every nested field including `wasm` is optional. transformers.js
// populates `env.backends.onnx` as a side effect of importing the
// onnx backend, so by the time this module loads `wasm` is defined.
// The cast bypasses the optional-property type without runtime overhead.
(env.backends.onnx as { wasm: { wasmPaths: string } }).wasm.wasmPaths = "/onnx-wasm/";

const MODEL_ID = "bg-remove"; // resolves to /models/bg-remove/

export type LoaderProgress =
  | { kind: "model-loading"; loaded: number; total: number }
  | { kind: "ready" };

let pipelinePromise: Promise<ImageSegmentationPipeline> | null = null;

// We ship the int8 ONNX (`model_quantized.onnx`, ~6.6 MB) — the smallest
// MODNet variant Xenova/modnet publishes. The execution device is hard-pinned
// to "wasm" rather than probed for WebGPU. Reasons:
//
//  1. WebGPU + q8 is empirically unverified on real hardware we control.
//     Playwright Chromium's adapter does not advertise `shader-f16`, so our
//     correctness E2E only ever exercises the WASM path. Shipping a WebGPU
//     branch that no test covers is a privacy/correctness gamble.
//  2. transformers.js has known WebGPU+q8 failure modes for some model
//     classes, and image-segmentation hasn't been verified end-to-end.
//  3. The retry path in `getBgRemovalPipeline` resets `pipelinePromise` on
//     `.catch`, so a WebGPU adapter that throws on inference would loop:
//     each retry re-probes, picks WebGPU again, fails again. WASM avoids
//     the trap entirely.
//
// Reinstate WebGPU only after the path is exercised on real dGPU hardware
// (and after wiring a one-shot fallback to WASM on inference failure).

export async function getBgRemovalPipeline(
  onProgress: (p: LoaderProgress) => void,
): Promise<ImageSegmentationPipeline> {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = pipeline("image-segmentation", MODEL_ID, {
    // dtype is pinned to "q8" because public/models/bg-remove/ ships
    // model_quantized.onnx (the int8-quantized weights) and not model.onnx
    // (fp32). The upstream config.json declares dtype "fp32"; without this
    // override transformers.js requests the missing fp32 file and (with
    // allowRemoteModels=false) 404s. transformers.js maps q8 to the
    // "_quantized" filename suffix. Keep this in sync with
    // scripts/bg-models-manifest.json#requiredDtype.
    dtype: "q8",
    // WebGPU+q8 is unverified on real hardware; wasm is the path our
    // correctness E2E exercises and any environment can run.
    device: "wasm",
    progress_callback: (p: { status: string; loaded?: number; total?: number }) => {
      if (p.status === "progress" && typeof p.loaded === "number" && typeof p.total === "number") {
        onProgress({ kind: "model-loading", loaded: p.loaded, total: p.total });
      } else if (p.status === "ready") {
        onProgress({ kind: "ready" });
      }
    },
  }).catch((err) => {
    pipelinePromise = null;
    throw err;
  });
  return pipelinePromise;
}

/** Test-only: clear the memoized pipeline. Do NOT export from index.ts. */
export function __resetForTests(): void {
  pipelinePromise = null;
}
