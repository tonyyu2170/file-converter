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

// We ship the fp16 ONNX (`model_fp16.onnx`, 114 MB) rather than fp32 (224 MB)
// to keep the same-origin payload small. WebGPU can run fp16 ops only when
// the adapter advertises the `shader-f16` feature; without it, ORT throws
// "The device (webgpu) does not support fp16." at session creation.
//
// Some Chromium environments — older integrated GPUs, certain headless
// configurations — expose `navigator.gpu` but lack `shader-f16`. In that
// case we must fall back to the WASM execution provider, which handles
// fp16 via runtime conversion. This probe runs once per worker context.
//
// Minimal structural type for navigator.gpu — TS' bundled lib.dom.d.ts in
// this project's TS version doesn't ship WebGPU types and we don't want to
// pull in @webgpu/types just for a feature probe.
type GpuFeatureProbe = {
  requestAdapter(): Promise<{ features: { has(name: string): boolean } } | null>;
};
async function pickDevice(): Promise<"webgpu" | "wasm"> {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) return "wasm";
  try {
    const gpu = (navigator as Navigator & { gpu: GpuFeatureProbe }).gpu;
    const adapter = await gpu.requestAdapter();
    if (adapter?.features.has("shader-f16")) return "webgpu";
  } catch {
    // requestAdapter may throw on some configurations; treat as no WebGPU.
  }
  return "wasm";
}

export async function getBgRemovalPipeline(
  onProgress: (p: LoaderProgress) => void,
): Promise<ImageSegmentationPipeline> {
  if (pipelinePromise) return pipelinePromise;
  const device = await pickDevice();
  pipelinePromise = pipeline("image-segmentation", MODEL_ID, {
    // dtype is pinned to "fp16" because public/models/bg-remove/ ships
    // model_fp16.onnx (114 MB) and not model.onnx (224 MB fp32). The
    // upstream config.json declares dtype "fp32"; without this override
    // transformers.js requests the missing fp32 file and (with
    // allowRemoteModels=false) 404s. Keep this in sync with
    // scripts/bg-models-manifest.json#requiredDtype.
    dtype: "fp16",
    device,
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
