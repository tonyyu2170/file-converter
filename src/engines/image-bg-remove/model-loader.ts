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
// MODNet variant Xenova/modnet publishes. q8 is transformers.js' WASM-default
// dtype and runs there with no special adapter features required, so WASM is
// the safe baseline. WebGPU is an opportunistic upgrade only.
//
// We use `shader-f16` as the WebGPU eligibility proxy even though q8 doesn't
// strictly need fp16 ops: an adapter that advertises `shader-f16` is a recent,
// well-behaved WebGPU implementation, whereas adapters lacking it (older
// integrated GPUs, headless SwiftShader, some Playwright Chromium configs)
// have a pattern of breaking on quantized ops too. Falling back to WASM in
// that case routes those users to the documented-stable q8 path. The probe
// runs once per worker context.
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
    // dtype is pinned to "q8" because public/models/bg-remove/ ships
    // model_quantized.onnx (the int8-quantized weights) and not model.onnx
    // (fp32). The upstream config.json declares dtype "fp32"; without this
    // override transformers.js requests the missing fp32 file and (with
    // allowRemoteModels=false) 404s. transformers.js maps q8 to the
    // "_quantized" filename suffix. Keep this in sync with
    // scripts/bg-models-manifest.json#requiredDtype.
    dtype: "q8",
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
