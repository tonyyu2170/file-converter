# Image background-removal engine — design / spec

Phase 16 of the file_converter roadmap. A new `image-bg-remove` engine that
runs an in-browser image-segmentation model to produce a transparent-background
PNG (or a flattened PNG/JPEG over a user-chosen solid color). This document is
the brainstorm-validated design and is the source of truth for the
implementation plan that follows.

This spec also lays the model-loading infrastructure (build-time copy from
npm, same-origin runtime fetch, multi-stage progress events, persistent
worker) that future ML engines (`image-watermark-remove`, `image-upscale`)
will reuse — see §12.

## 1. Scope

One `SingleInputEngine` at `src/engines/image-bg-remove/`, one route
(`/tools/image-bg-remove`), one segmentation model. Output is a single
image: either a PNG with an alpha channel (transparent background) or a
PNG/JPEG flattened over a user-selected solid color.

Inputs: `.png .jpg .jpeg .webp`. The engine does not accept HEIC; users with
HEIC input chain through `image-convert` first. Keeping the input set narrow
in v1 keeps decode paths simple and matches `image-resize`'s posture.

The existing batch flow (drop N files → harness runs them sequentially) is
unchanged. "Multi-file batch" requires no new code — the harness already
handles it for every other `SingleInputEngine`.

## 2. Out of scope (this plan)

- Watermark removal. Different interaction model (interactive mask paint),
  different inference pipeline (inpainting, not segmentation), different
  legal surface. Tracked separately as future scope §12.
- Mask-edit / refinement controls (brush in, brush out, magnifier). v1 has
  no interactive canvas — output is whatever the model produces.
- Background replacement with an *uploaded image* (Canva-style background
  replace). v1 supports transparent or solid color only.
- Auto-detection of "best" model size based on device. Single mid-tier model
  for everyone in v1.
- WebGPU-only mode toggle. Detected automatically with WASM fallback.
- Service Worker / offline-first caching. Across-reload caching relies on
  the browser HTTP cache.
- HEIC input. Out-of-scope decode path; users chain through `image-convert`.

## 3. Architecture

### 3.1 Engine module shape

```
src/engines/image-bg-remove/
  index.ts                  # default export: ConversionEngine
  worker.ts                 # comlink-exposed runtime
  options.ts                # ImageBgRemoveOptions + defaults
  options-panel.tsx         # bg-mode segment, presets, color, format, quality
  model-loader.ts           # singleton transformers.js pipeline factory
  index.test.ts
  options-panel.test.tsx
  model-loader.test.ts
```

Plus the following external touchpoints:

```
src/engines/_shared/registry.ts                # +1 line
src/app/tools/image-bg-remove/page.tsx         # one-line ToolFrame, like every engine
public/models/bg-remove/.gitkeep               # destination for build-copied weights
public/onnx-wasm/.gitkeep                      # destination for build-copied ONNX wasm
scripts/copy-bg-models.mjs                     # prebuild copy step
src/engines/_shared/harness.ts                 # additive: progress + persistent
src/components/tool-frame.tsx                  # render progress bar slot
src/components/layout/sidebar.tsx              # +1 entry
src/app/page.tsx                               # +1 home-grid card
```

`model-loader.ts` lives inside the engine, not under `_shared/`. The moment
a second ML engine is implemented (Phase 17 / watermark-remove), we lift it
to `_shared/transformers/` — same pattern as `_shared/docx/` lifted only
after a second consumer arrived.

### 3.2 Library / runtime

- **Library:** `@huggingface/transformers` (Apache 2.0). Provides the
  `image-segmentation` pipeline, ONNX Runtime Web wiring, and pre/post
  tensor processing.
- **Model:** mid-tier permissively licensed segmentation model in the
  ~80 MB range. Concrete candidates: BiRefNet-lite (MIT), ISNet-DIS (Apache
  2.0). Final selection is decided at implementation time based on a
  side-by-side fixture test — both are permissive and either fits the
  budget. The plan task is "the build copies the chosen model files into
  `public/models/bg-remove/` from a pinned npm or hash-pinned source"; the
  exact filename / hash is fixed in code review.
- **Inference backend:** WebGPU when `navigator.gpu` is available, WASM
  otherwise. Auto-selected by transformers.js. No user-facing toggle.
- **Worker:** Comlink-exposed, persistent across a batch — see §3.4.

### 3.3 Same-origin model loading (the privacy-load-bearing part)

The PRD's `connect-src 'self'` policy forbids any off-origin fetch from the
client during conversion. Transformers.js defaults to fetching weights from
HuggingFace's CDN; we override that.

**Build-time copy:**

`scripts/copy-bg-models.mjs` runs as a `prebuild` step (and as part of
`pnpm install` via a `postinstall` hook so unit tests can run locally
without an explicit build):

1. Resolves the chosen model files from `node_modules/` (either an npm
   package that distributes the weights, or a hash-pinned local cache
   populated by a separate `fetch-bg-models.mjs` if no clean npm
   distribution exists for the model).
2. Copies model files (`*.onnx` plus any required `config.json` /
   `tokenizer.json` / `preprocessor_config.json`) into
   `public/models/bg-remove/`.
3. Copies ONNX Runtime Web's `.wasm` files from
   `node_modules/onnxruntime-web/dist/*.wasm` into `public/onnx-wasm/`.
4. Hash-verifies each copied file against a manifest committed to the
   repo (`scripts/bg-models-manifest.json`) to catch silent drift between
   the lockfile and the actual bytes.

`.gitignore` adds `public/models/bg-remove/*` (preserving `.gitkeep`) and
`public/onnx-wasm/*` so the binary blobs never enter git history. Vercel
runs `pnpm build`, which triggers `prebuild`, so production deploys always
ship freshly-copied weights.

**Runtime configuration:**

```ts
// model-loader.ts
import { pipeline, env, type ImageSegmentationPipeline } from "@huggingface/transformers";

env.allowRemoteModels = false;          // hard guarantee: no off-origin fetch
env.allowLocalModels  = true;
env.localModelPath    = "/models/";     // resolves /models/bg-remove/...
env.backends.onnx.wasm.wasmPaths = "/onnx-wasm/";

let pipelinePromise: Promise<ImageSegmentationPipeline> | null = null;

export type LoaderProgress =
  | { kind: "model-loading"; loaded: number; total: number }
  | { kind: "ready" };

export function getBgRemovalPipeline(
  onProgress: (p: LoaderProgress) => void,
): Promise<ImageSegmentationPipeline> {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = pipeline("image-segmentation", "bg-remove", {
    device: "webgpu" in navigator ? "webgpu" : "wasm",
    progress_callback: (p) => {
      if (p.status === "progress") onProgress({ kind: "model-loading", loaded: p.loaded, total: p.total });
      if (p.status === "ready")    onProgress({ kind: "ready" });
    },
  }).catch((err) => {
    pipelinePromise = null;             // allow retry on next call
    throw err;
  });
  return pipelinePromise;
}
```

`env.allowRemoteModels = false` is a one-line hard guarantee that prevents
*any* off-origin fetch by the library. Backstopped by the existing
privacy-regression Playwright test (which asserts zero off-origin requests
during a real conversion) plus a new bg-remove-specific privacy test
(§10.2).

### 3.4 Persistent worker (deviation from current harness pattern)

Today's `WorkerHarness` spawns a fresh worker per `runSingle` call and
terminates it after each file. For bg-remove that means a 10-file batch
pays the model cold-load cost 10 times even though the binary is HTTP-
cached — every worker re-instantiates the ONNX session.

`WorkerHarness` gains an additive `persistent?: boolean` constructor
option:

```ts
class WorkerHarness<TOpts> {
  constructor(
    private factory: () => Worker,
    private opts: { persistent?: boolean } = {},
  ) {}
  // when persistent: lazily creates one worker, reuses across runSingle calls,
  // terminates only via dispose() / page-level cleanup.
}
```

Bg-remove's engine creates the harness with `{ persistent: true }`. The
`/tools/image-bg-remove` page-level `useEffect` calls `harness.dispose()`
on unmount so the 200 MB worker doesn't leak when the user navigates away.

Other engines pass nothing → existing per-call worker behavior is unchanged.

### 3.5 Multi-stage progress events (deviation from current harness pattern)

`WorkerHarness.runSingle` gains an additive optional `onProgress` callback.
The worker emits structured progress events through Comlink:

```ts
type ConversionProgress =
  | { kind: "model-loading"; loaded: number; total: number }
  | { kind: "inference"; pct: number };
```

ToolFrame renders a determinate progress bar above the existing status text
*only when* the active engine has fired at least one `progress` event in
the current run. Engines that never emit (HEIC, image-convert, etc.) pass
no callback and ToolFrame renders no bar — backward-compatible.

The `pct` for the inference stage is best-effort — transformers.js does
not emit fine-grained inference progress, so the worker emits `{kind:
"inference", pct: 0}` at start and `{kind: "inference", pct: 100}` at end.
A pulsing-rather-than-determinate bar is rendered for that range, with
elapsed-seconds counter.

### 3.6 Composition pipeline (worker-side)

```
File
  → createImageBitmap(file, { imageOrientation: "from-image" })   // EXIF-aware
  → resize-if-needed (preserve aspect, max-side ≤ model input)
  → ImageData → tensor → pipeline(image)
  → alpha mask (HxW float32 0..1)
  → composite:
      bgMode === "transparent":
        4-channel ImageData (RGB from input, A from mask)
        encode PNG
      bgMode === "solid":
        OffscreenCanvas pre-fill with bgColor
        drawImage(input)
        2nd pass: pre-multiply with mask via globalCompositeOperation = 'destination-in' / 'source-over' chain
        encode PNG or JPEG (depending on opts.outputFormat)
  → Blob + filename + mime → return as OutputItem
```

The mask resolution from the model is typically smaller than the input
(e.g., 1024×1024 for BiRefNet-lite). Before composition the mask is
upscaled to input dimensions via canvas `imageSmoothingQuality = 'high'`.
This is the standard approach; tests assert no off-by-one between mask
and input dimensions.

## 4. Options surface

```ts
export type ImageBgRemoveBgMode = "transparent" | "solid";
export type ImageBgRemoveOutputFormat = "png" | "jpeg";

export type ImageBgRemoveOptions = {
  bgMode: ImageBgRemoveBgMode;
  bgColor: string;                      // hex like "#ffffff"; ignored when bgMode === "transparent"
  outputFormat: ImageBgRemoveOutputFormat;
  jpegQuality: number;                  // 0.1–1.0, default 0.92, ignored when outputFormat === "png"
};

export const defaultImageBgRemoveOptions: ImageBgRemoveOptions = {
  bgMode: "transparent",
  bgColor: "#ffffff",
  outputFormat: "png",
  jpegQuality: 0.92,
};
```

### 4.1 Cross-rules

Two state-validity rules enforced by the options panel (and asserted in
unit tests). They are *handled by clamping* in `onChange`, not by surfacing
errors:

- Selecting `bgMode = "transparent"` forces `outputFormat = "png"` (JPEG
  cannot carry alpha).
- Selecting `outputFormat = "jpeg"` forces `bgMode = "solid"` (same
  reason, inverse direction). The "transparent" preset swatch in the panel
  is rendered disabled when `outputFormat === "jpeg"`.

`isReadyToConvert` always returns `true` — there is no "user must pick X
before convert" gate; defaults are valid and produce a transparent PNG,
which is the dominant use case.

## 5. UI

### 5.1 OptionsPanel layout

Single-row panel, matching `image-convert`'s and `image-resize`'s idiom
exactly: hairline border, mono font, uppercase labels, no rounded corners.

Controls, left to right:

1. **BG segmented toggle** — `TRANSPARENT | SOLID`.
2. **PRESETS swatches** — three 22×22 chips: white, black, transparent
   (rendered as a checker pattern). Clicking white/black sets
   `bgMode = "solid"` and `bgColor = "#ffffff"` / `"#000000"`. Clicking
   the transparent chip sets `bgMode = "transparent"` (and clamps
   `outputFormat` to `"png"`). The transparent chip is rendered disabled
   when `outputFormat === "jpeg"`.
3. **CUSTOM color** — native `<input type="color">` plus a 7-char text
   input (`#RRGGBB`) that mirrors the picker. Both edit `bgColor`. Hex
   text input validates `^#[0-9a-fA-F]{6}$` on blur; invalid input
   reverts to the prior valid value (no error toast, matches the
   project's quiet-failure posture).
4. **OUTPUT segmented toggle** — `PNG | JPEG`.
5. **QUALITY slider** — 0.1–1.0, step 0.05, with tabular-nums readout.
   Hidden when `outputFormat === "png"` (matches image-convert's
   conditional behavior exactly).

Rendering the presets, the custom picker, and the segmented toggles in a
single row keeps the panel under one viewport line on a 1280-wide
desktop. On narrower screens the existing `flex-wrap` reflows them; no
mobile-specific UX is added in v1.

### 5.2 ToolFrame extension — progress bar slot

ToolFrame already renders status text. It gains a determinate
`<progress>` element below the status text, rendered only when the
current run has emitted at least one `progress` event. Two states:

- **Model-loading:** `<progress max={total} value={loaded}>` plus text
  "loading model — X.Y MB / Z.Z MB".
- **Inference:** indeterminate bar with elapsed-seconds counter
  ("inferring — 4.2 s").

Once the run completes (success or failure), the bar is hidden until the
next run.

### 5.3 First-run banner

The first time the user lands on `/tools/image-bg-remove` in a session
*before* dropping a file, a one-line dismissable banner above the
DropZone reads:

> First conversion downloads ~80 MB. After that it's instant.

Banner state lives in `sessionStorage` keyed by `bg-remove-banner-seen`.
Dismissed once → not shown again that session. Not persistent across
tabs/reloads — by design, the warning is most relevant when the user
hasn't yet paid the download.

## 6. Validation

```ts
async validate(file: File, _opts: ImageBgRemoveOptions) {
  const SUPPORTED = ["image/png", "image/jpeg", "image/webp"] as const;
  if (SUPPORTED.includes(file.type as typeof SUPPORTED[number])) return { ok: true };
  if (/\.(png|jpe?g|webp)$/i.test(file.name))                    return { ok: true };
  return { ok: false, reason: "Expected a PNG, JPEG, or WebP file" };
}
```

Mime-or-extension fallback matches `image-convert`'s posture (Safari
emits empty `file.type` for some images dragged from Photos). The worker
re-detects MIME via `_shared/file-detection` before processing — a
polyglot file fails there, not at validation.

## 7. Output

### 7.1 Filename convention

Reuses `_shared/filename.ts`'s `replaceExtension` plus a `-nobg` suffix:

```
input.png   → input-nobg.png
photo.jpg   → photo-nobg.png    (when outputFormat=png)
photo.jpg   → photo-nobg.jpg    (when outputFormat=jpeg)
```

Suffix is `-nobg` (not `-removed`, not `-cutout`) — matches the engine
id and is the most semantically accurate ("the bg has been removed,"
even when a solid color replaces it).

### 7.2 OutputItem shape

Single-output engine. Returns one `OutputItem`:

```ts
{
  filename: <as above>,
  mime: opts.outputFormat === "jpeg" ? "image/jpeg" : "image/png",
  blob: <encoded blob>,
}
```

ResultList renders one row with a manual download button.

## 8. Registry / routing

### 8.1 Registry extension

```ts
// src/engines/_shared/registry.ts
export type EngineId =
  | "docx-to-pdf"
  | "docx-to-txt"
  | "image-bg-remove"           // <-- new
  | "image-convert"
  | "image-resize"
  | "image-to-pdf"
  | "markdown-to-pdf"
  | "pdf-merge"
  | "pdf-split"
  | "pdf-to-image"
  | "pdf-to-md"
  | "txt-to-pdf";

const REGISTRY: Record<EngineId, Loader> = {
  // ...existing...
  "image-bg-remove": () => import("@/engines/image-bg-remove"),
};
```

### 8.2 Homepage routing

The home page's "Images" group gains a fourth card linking to
`/tools/image-bg-remove`. Drag-drop MIME routing on `/` does *not*
auto-route PNG/JPEG/WebP to bg-remove — image-convert remains the
default route for those MIMEs (existing behavior). Bg-remove is a
deliberate destination, not a default.

### 8.3 Sidebar entry

`src/components/layout/sidebar.tsx`'s `TOOLS` array gains:

```ts
{ id: "image-bg-remove", href: "/tools/image-bg-remove", label: "image bg remove", group: "IMAGES" },
```

## 9. Privacy

Same posture as every other engine, with one new wrinkle (model fetch
is to same origin):

- **No `fetch` / `XHR` in `src/engines/image-bg-remove/`** — Biome's
  `no-restricted-globals` rule (already in place under `src/engines/`)
  enforces this. Transformers.js itself is *not* in the engine
  directory; its fetch calls (model-loader uses `env.localModelPath`)
  resolve to same-origin URLs only.
- **`env.allowRemoteModels = false`** — set in `model-loader.ts` at
  module scope. This is a hard guarantee that transformers.js will
  never attempt a CDN fetch even if the local path is missing.
- **CSP unchanged.** `connect-src 'self'` already covers same-origin
  model fetches. `'wasm-unsafe-eval'` already permits ONNX Runtime
  Web's WASM execution. No header changes needed in `vercel.json`.
- **Cache-Control** for `/models/bg-remove/*` and `/onnx-wasm/*`:
  `public, max-age=31536000, immutable`. Set in `vercel.json` as a
  `headers` rule.
- **Privacy regression test** (`tests/e2e/privacy-regression-image-bg-remove.spec.ts`):
  drives a real conversion, asserts zero off-origin requests *and zero
  off-origin WebSockets* during the entire flow including model load.
  Reuses the existing host-comparison pattern from
  `privacy-regression-image-convert.spec.ts`.

## 10. Testing strategy

### 10.1 Unit tests

- `index.test.ts` — engine metadata (`id`, `cardinality`, `inputAccept`,
  `inputMime`, `category`); `validate` truth table (all supported MIMEs,
  extension-only fallback, rejection); options-cross-rule clamping.
- `options-panel.test.tsx` — initial render; segmented toggle
  interactions; preset clicks set `bgColor` correctly; transparent
  preset disabled when `outputFormat === "jpeg"`; quality slider
  hidden when `outputFormat === "png"`; hex text input validation
  (valid hex commits, invalid hex reverts on blur).
- `model-loader.test.ts` — `pipelinePromise` is memoized across calls;
  on first failure `pipelinePromise` is reset so a retry creates a new
  promise; progress callback is invoked with `model-loading` and
  `ready` events in order. Mocks `pipeline()` from transformers.js —
  the real pipeline is exercised in correctness + E2E tests.

### 10.2 Correctness tests (vitest, gated on model files present)

Three fixtures committed to `tests/fixtures/bg-remove/` (each
< 1 MB, sourced from Unsplash CC0 with the source attribution
recorded in `tests/fixtures/bg-remove/SOURCES.md`):

- `product-on-white.jpg` — e-commerce-style product, easy edges.
- `portrait-cluttered-bg.jpg` — person against a cluttered background
  with hair detail (the hardest realistic case).
- `transparent-glass.jpg` — glass / transparency / fine detail (the
  failure-mode fixture; we don't expect perfect results, we expect the
  engine to not crash and to produce a decodable output).

For each fixture, assertions:

- Output is a decodable PNG (or JPEG when configured); no decode error.
- Output dimensions match input dimensions exactly.
- Alpha-mask coverage falls in a fixture-specific expected range. For
  the portrait fixture, expected alpha coverage is 18–35%; if a model
  regression drops coverage to <5% or jumps to >70%, the test fails
  with a clear message ("alpha coverage 4% — model output is empty —
  check model-loader path").
- For `solid` mode runs, the composited output has zero pixels with
  alpha < 255 (no leftover transparency).

The correctness suite skips with a clear console message if
`public/models/bg-remove/` is empty (e.g., a fresh checkout that
hasn't run `pnpm install` yet). CI runs the model-copy script as part
of `pnpm install`, so CI never skips.

### 10.3 E2E tests (Playwright)

- `tests/e2e/image-bg-remove.spec.ts` — happy path. Drag-drop a JPEG,
  observe model-loading progress event, observe inference event,
  observe download button enabled, click download, decode resulting
  PNG, assert dimensions match input. Runs on chromium only in v1
  (firefox + webkit deferred — transformers.js's WebGPU path is
  chromium-stable, and the WASM path on the other engines passes
  through the same code).
- `tests/e2e/privacy-regression-image-bg-remove.spec.ts` — same shape
  as `privacy-regression-image-convert.spec.ts`. Asserts every
  outbound request URL is same-origin during the full flow including
  model load.
- *Should-have, defer-OK:* `tests/e2e/image-bg-remove-model-retry.spec.ts`
  — block the model URL once via Playwright's `page.route` interception,
  drive a conversion, assert the second attempt succeeds. Documents the
  retry contract from §3.3 explicitly. Defer to a follow-up if it
  proves flaky on first implementation.

### 10.4 Test fixtures

| Fixture | Size | Purpose |
|---|---|---|
| `tests/fixtures/bg-remove/product-on-white.jpg` | <300 KB | easy case, product photography |
| `tests/fixtures/bg-remove/portrait-cluttered-bg.jpg` | <500 KB | hair-edge / hard case |
| `tests/fixtures/bg-remove/transparent-glass.jpg` | <300 KB | model failure-mode case |
| `tests/fixtures/bg-remove/SOURCES.md` | — | Unsplash URLs + photographer credits |

## 11. Edge cases / failure modes

| Failure | Handling |
|---|---|
| Browser missing `OffscreenCanvas` or WebAssembly SIMD | `validate()` returns `{ ok: false, reason: "Browser too old — bg-remove needs WebAssembly SIMD" }` at file-add time. Probe via `WebAssembly.validate(simdProbe)` once on engine load; cached. |
| Model fetch fails mid-download (network blip) | Retry once with 1 s linear backoff. On second failure throw `"Could not load background-removal model. Refresh and try again."`. `pipelinePromise` reset so subsequent attempts retry cleanly. |
| Inference throws (OOM on a 25–50 MP input that snuck past the §11.1 pixel cap) | Catch, throw `"Image too large to process (X MP). Resize below 24 MP first."`. No auto-retry — user must act. |
| User aborts (cancel button, beforeunload) | Existing `AbortSignal` flow. Worker checks `signal.aborted` between preprocess / inference / postprocess. Inference itself is uninterruptible — accepted, since worst case is ~6 s of orphaned work in a worker about to be terminated. |
| Decoded image is corrupted / 1×1 | `createImageBitmap` rejects → engine throws `"Could not decode input image"`. Same shape as `image-convert`. |
| `bgColor` text input contains invalid hex | OptionsPanel reverts to prior valid value on blur. No error surfaced — quiet-failure posture. |

### 11.1 Size cap

Phase 14's `_shared/size-limits.ts` is extended with bg-remove-specific
caps:

- **Per-file input size cap: 25 MB.** Rejects at file-add time, no
  model spin-up. Covers any reasonable phone photo at full res.
- **Per-file pixel cap: 24 megapixels** (≈ 6000×4000). Enforced after
  decode, before inference. Above this, the engine throws a typed
  error suggesting `image-resize` first; we do not auto-downscale —
  that hides quality loss.
- **Total batch cap:** existing default in `size-limits.ts`, no
  bg-remove-specific override.

## 12. Future scope

These are explicitly NOT in this plan but are natural follow-ons that
inherit the model-loading infrastructure built here:

- **`image-watermark-remove`** (Phase 17 candidate). Inpainting model
  (LaMa or similar, ~100 MB), `onnxruntime-web` direct (transformers.js
  has no inpainting pipeline today). Requires a new interactive
  "paint mask" canvas component — substantially larger UX surface than
  any current engine. Reuses: build-time model copy, same-origin model
  loading config, multi-stage progress events, persistent worker.
- **`image-upscale`** (super-resolution, e.g. Real-ESRGAN ONNX). Same
  segmentation-style pipeline as bg-remove, no interactive UI. Reuses:
  everything in §3.3, §3.4, §3.5.
- **Background replacement with uploaded image** (Canva-style "drop your
  bg image"). Sits naturally on top of bg-remove — adds a third
  `bgMode = "image"` option and a second drop target on the options
  panel. Considered post-v1 because it changes the engine cardinality
  (multi-input).
- **Model-tier picker** (Fast / Standard / High at convert time,
  loading a different model per tier). Considered and rejected for v1
  in brainstorming; likely never lands unless user feedback says
  otherwise.
- **WebGPU-only mode toggle / device picker.** Auto-detection works;
  surface area not justified for v1.
- **Service Worker for offline-first model caching.** Browser HTTP
  cache covers the 95% case. SW is a much larger surface than this
  engine warrants.

These are tracked in master spec §16 under "AI image transforms."

## 13. Plan structure (preview)

The implementation plan that follows this spec will be sequenced
roughly:

1. **Model selection + build infrastructure.** Run a side-by-side
   fixture test of BiRefNet-lite (MIT) vs ISNet-DIS (Apache 2.0)
   against the three §10.4 fixtures locally; pick the better-edged
   one and pin its source (npm package + version, or HuggingFace
   repo + commit hash). Then: `scripts/copy-bg-models.mjs`,
   `scripts/bg-models-manifest.json` with the pinned hashes,
   `prebuild` + `postinstall` hooks, `.gitignore` entries,
   `vercel.json` Cache-Control rule. The model decision is
   recorded in the task PR description.
2. **Harness deviations** — additive `persistent` constructor option
   and `onProgress` callback on `WorkerHarness`. Backward-compatible
   tests for existing engines.
3. **ToolFrame progress slot** — render `<progress>` when an engine
   emits progress events; render nothing when it doesn't. Test that
   existing engines render no progress UI.
4. **Model-loader module** — `model-loader.ts` + `model-loader.test.ts`
   with mocked transformers.js pipeline; memoization, retry, progress
   callback wiring.
5. **Engine module** — `options.ts`, `options-panel.tsx`, `worker.ts`,
   `index.ts`, plus their unit tests.
6. **Route + sidebar + home grid** — `/tools/image-bg-remove/page.tsx`,
   sidebar entry, home grid card.
7. **Test fixtures** — commit Unsplash CC0 fixtures + SOURCES.md.
8. **Correctness tests** — `image-bg-remove.test.ts` driving real
   inference against fixtures (gated on model files present).
9. **E2E happy path** — `image-bg-remove.spec.ts`.
10. **E2E privacy regression** — `privacy-regression-image-bg-remove.spec.ts`.
11. **(Optional, defer-OK)** model-retry E2E.
12. **CI green; merge.**

Estimated 10–12 tasks. Architecture-touching tasks (1, 2, 3, 4) get
full two-stage review (sonnet spec + opus quality, per
`feedback_review_dispatch_pattern.md`). Mechanical tasks combined
under a single opus review.

## 14. Success criteria

This plan is done when:

1. A user can navigate to `/tools/image-bg-remove`, drop a PNG/JPEG/WebP,
   see a model-loading progress bar on the first run, see an inference
   indicator on subsequent runs, and download a transparent-background
   PNG.
2. Switching `bgMode` to `solid` and selecting white produces a PNG
   (or JPEG, with quality slider visible) with the cutout composited
   over the chosen color.
3. The cross-rules (`transparent` + `jpeg`, `solid` + `transparent
   preset`) clamp options correctly without surfacing errors.
4. A 10-file batch loads the model exactly once and processes
   sequentially without re-loading per file.
5. `pnpm typecheck && pnpm lint && pnpm test && pnpm build` exit 0.
6. All E2E specs pass on chromium locally and against the deployed URL.
7. The privacy regression spec confirms zero off-origin requests during
   a real conversion *including* the model download.
8. Switching to a different tool page disposes the persistent worker
   (asserted via a leak test or manual DevTools verification).
9. CI green on the PR.
10. The `image-watermark-remove` future-scope entry lists every piece
    of bg-remove's infrastructure it can reuse, so Phase 17's plan
    can be written without re-deriving the model-loading design.
