import { type ImageSegmentationPipeline, env, pipeline } from "@huggingface/transformers";

// Side-effecting at module load — runs exactly once per worker context.
// These are the privacy-load-bearing settings: any deviation makes
// transformers.js attempt off-origin fetches.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = "/models/";
// `env.backends.onnx.wasm` is typed as `readonly` on the upstream
// onnxruntime-common `Env`, but transformers.js itself mutates
// `wasm.wasmPaths` at runtime (see node_modules/@huggingface/transformers/
// src/backends/onnx.js). The onnx backend module populates `wasm` as a
// side effect of being imported, so by the time this module loads, `wasm`
// is defined. The cast bypasses the misleading readonly type.
(env.backends.onnx as { wasm: { wasmPaths: string } }).wasm.wasmPaths = "/onnx-wasm/";

const MODEL_ID = "bg-remove"; // resolves to /models/bg-remove/

export type LoaderProgress =
  | { kind: "model-loading"; loaded: number; total: number }
  | { kind: "ready" };

let pipelinePromise: Promise<ImageSegmentationPipeline> | null = null;

export function getBgRemovalPipeline(
  onProgress: (p: LoaderProgress) => void,
): Promise<ImageSegmentationPipeline> {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = pipeline("image-segmentation", MODEL_ID, {
    // dtype is pinned to "fp16" because public/models/bg-remove/ ships
    // model_fp16.onnx (114 MB) and not model.onnx (224 MB fp32). The
    // upstream config.json declares dtype "fp32"; without this override
    // transformers.js requests the missing fp32 file and (with
    // allowRemoteModels=false) 404s. Keep this in sync with
    // scripts/bg-models-manifest.json#requiredDtype.
    dtype: "fp16",
    device: typeof navigator !== "undefined" && "gpu" in navigator ? "webgpu" : "wasm",
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
