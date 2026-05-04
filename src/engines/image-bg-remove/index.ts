import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type ImageBgRemoveOptions, defaultImageBgRemoveOptions } from "./options";
import { ImageBgRemoveOptionsPanel } from "./options-panel";

const SUPPORTED_INPUT_MIMES = ["image/png", "image/jpeg", "image/webp"];

// Spec §11.1 — bg-remove-specific 25 MB per-file cap. Tighter than the
// image-category 250 MB hard cap because inference time scales with pixel
// count and a 25 MB JPEG is already a ~25 MP image (close to the §11.1
// pixel cap of 24 MP). This is enforced at validate-time so we never spin
// up the model on a file we'd reject at inference.
const MAX_FILE_BYTES = 25 * 1_000_000;

// Spec §11 — WebAssembly SIMD is required by onnxruntime-web's threaded build.
// Probe once at module load; cache the result. Re-probing is cheap but pointless.
const SIMD_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b, 0x03,
  0x02, 0x01, 0x00, 0x0a, 0x0a, 0x01, 0x08, 0x00, 0x41, 0x00, 0xfd, 0x0f, 0xfd, 0x62, 0x0b,
]);
const SIMD_OK = typeof WebAssembly !== "undefined" && WebAssembly.validate(SIMD_PROBE);

// Module-scoped persistent harness so the model loads once across a batch.
// Disposed by the route page's useEffect cleanup.
let harness: WorkerHarness<ImageBgRemoveOptions> | null = null;
function getHarness(): WorkerHarness<ImageBgRemoveOptions> {
  if (!harness) {
    harness = new WorkerHarness<ImageBgRemoveOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
      { persistent: true },
    );
  }
  return harness;
}

export function disposeBgRemoveHarness(): void {
  harness?.dispose();
  harness = null;
}

const engine: SingleInputEngine<ImageBgRemoveOptions, OutputItem> = {
  id: "image-bg-remove",
  inputAccept: [".png", ".jpg", ".jpeg", ".webp"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "image/png",
  defaultOptions: defaultImageBgRemoveOptions,
  category: "image",
  cardinality: "single",
  OptionsPanel: ImageBgRemoveOptionsPanel,
  validate(file) {
    // Order matters: SIMD probe (capability gate) → MIME/extension match →
    // size cap. A 30 MB GIF should learn it's the wrong format before being
    // told it's too large; the format error is the actionable one.
    if (!SIMD_OK) {
      return {
        ok: false,
        reason: "Browser too old — bg-remove needs WebAssembly SIMD",
      };
    }
    const mimeOk = SUPPORTED_INPUT_MIMES.includes(file.type);
    const extOk = /\.(png|jpe?g|webp)$/i.test(file.name);
    if (!mimeOk && !extOk) {
      return { ok: false, reason: "Expected a PNG, JPEG, or WebP file" };
    }
    if (file.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        reason: `File too large for bg-remove (limit 25 MB; got ${(file.size / 1_000_000).toFixed(1)} MB).`,
      };
    }
    return { ok: true };
  },
  async convert(file, opts, signal, runOpts) {
    // Forward runOpts as-is. With exactOptionalPropertyTypes on, building
    // `{ onProgress: runOpts?.onProgress }` would inject an explicit
    // `onProgress: undefined` and fail to match RunOptions.
    const result = await getHarness().runSingle(file, opts, signal, runOpts);
    if (Array.isArray(result)) {
      const first = result[0];
      if (!first) throw new Error("engine returned empty array");
      return first;
    }
    return result;
  },
};

export default engine;
