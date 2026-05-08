# Phase 23 — Tesseract shared infra + `image-to-text` engine

**Date:** 2026-05-07
**Status:** draft (pending approval)
**Source of truth:** `docs/superpowers/specs/2026-05-05-v2-design.md` §3.5 (`image-to-text`), §4.5 (slow-engine progress + cancel), §5 (phasing — Phase 23), §6 (testing strategy), §7 (caps + latency). Phase 19 (`2026-05-05-phase-19-ffmpeg-infra-and-audio-convert.md`) established the "shared WASM infra + first engine" template that this phase mirrors for Tesseract. Phase 18 (`2026-05-05-phase-18-bg-remove-model-swap.md`) established the same-origin large-asset acquisition pattern (`scripts/copy-bg-remove-model.mjs`, `public/models/bg-remove/`, gitignored body + checked-in `.gitkeep`).

## 1. Goal

Ship Tesseract.js as a shared module under `src/engines/_shared/tesseract/` and the v2 OCR engine `image-to-text` that consumes it. Concretely:

1. `src/engines/_shared/tesseract/`: `loadTesseract()` singleton (mirrors `_shared/ffmpeg/index.ts`'s `loadFfmpeg()`). Worker-only. Returns a Tesseract.js worker pre-initialized with the English language pack from same-origin `/tesseract/`.
2. `src/engines/image-to-text/`: single-input engine accepting `.jpg`, `.jpeg`, `.png`, `.webp`, `.heic` (HEIC reuses `_shared/decode-image.ts`'s libheif path). 25 MB cap. Output `.txt` (default) or `.json` with per-word bounding boxes.
3. `scripts/copy-tesseract-assets.mjs`: build-time script that copies tesseract-core WASM from `node_modules` and downloads `tessdata_best/eng.traineddata.gz` from the official GitHub release into `public/tesseract/`. `public/tesseract/` is gitignored (mirrors `public/ffmpeg/`, `public/models/bg-remove/`).
4. Slow-engine UX commitments from v2 §4.5: phased progress + ETA, Convert→Cancel button via `signal.abort()` wired to `worker.terminate()`.

Out of scope: any non-English language pack, JSON→text output beyond the documented schema, image preprocessing knobs (deskew, threshold, dpi), and OCR-quality tuning beyond the engine defaults. Adding language packs in v3 is purely additive — pick a language code in the OptionsPanel and the same shared loader fetches `<lang>.traineddata.gz`.

## 2. Resolved design decisions

### 2.1 Language data: `tessdata_best/eng.traineddata.gz`, fetched from the official GitHub repo

`tessdata_best` (LSTM-best, ~22 MB gzipped) is selected over `tessdata_fast` (~4 MB) and `tessdata` (~10 MB). The 25 MB engine cap puts the page firmly in slow-engine territory regardless; trading 18 MB of one-time download for materially better recognition on photos and screenshots is the right call for an OCR engine that will be judged on accuracy. The same-origin asset is `/tesseract/eng.traineddata.gz` (Tesseract.js loads `.traineddata.gz` directly — no client-side gunzip needed).

The asset is fetched at build/install time by `scripts/copy-tesseract-assets.mjs` from `https://github.com/tesseract-ocr/tessdata_best/raw/<pinned-tag>/eng.traineddata` (gzip happens in the script — Tesseract.js requires `.gz`). The git tag and SHA-256 are pinned in `scripts/tesseract-manifest.json` and verified after download; mismatch fails the build, mirroring `scripts/ffmpeg-manifest.json`.

### 2.2 Worker is persistent across conversions on the engine route

`/tools/image-to-text` allocates a Tesseract.js worker the first time a conversion fires and reuses it for every subsequent file in the session. Disposed on route unmount via the same `dispose<EngineId>Harness` pattern audio-trim / video-trim use. Cold init (~5–10 s on the first run, dominated by `eng.traineddata.gz` load) is paid once; warm runs only pay recognition.

### 2.3 Cancel = `worker.terminate()` + harness rebuild on next run

Tesseract.js exposes no fine-grained "cancel current `recognize()`." On `signal.abort()` the engine calls `worker.terminate()` and clears the harness singleton. The next run pays cold init again, which is the correct trade-off — cancel is rare, and the alternative (waiting out the in-flight recognition) defeats the user's intent. The Convert→Cancel button transformation is identical to v2 §4.5's contract for ffmpeg engines.

### 2.4 Output schema

**`txt`** (default): plain UTF-8 text from `result.data.text`. Trailing newline preserved as Tesseract emits it. Output filename: `<basename>.txt`.

**`json-with-bboxes`**: trim-and-rename of Tesseract's word-level data, NOT a verbatim pass-through. Schema:

```ts
type ImageToTextJsonOutput = {
  text: string;          // result.data.text, byte-identical to txt mode
  words: Array<{
    text: string;
    confidence: number;  // 0..100, Tesseract's native scale
    x: number;           // word.bbox.x0
    y: number;           // word.bbox.y0
    w: number;           // word.bbox.x1 - word.bbox.x0
    h: number;           // word.bbox.y1 - word.bbox.y0
  }>;
};
```

Output filename: `<basename>.json`. Stable schema decoupled from Tesseract internals; line/block-level structure is omitted because users who want it can derive it from word bboxes, and including it doubles JSON size for marginal value.

### 2.5 Progress mapping

Tesseract.js's `logger` callback emits `{ status: string, progress: number }` events with statuses including `loading tesseract core`, `initializing tesseract`, `loading language traineddata`, `initializing api`, `recognizing text`. The engine's `ConversionProgress` reports two phases:

- **`warmup`** — every event with status ≠ `recognizing text`. Reported only on the first conversion (subsequent runs reuse the warmed worker). Percent passed through from Tesseract's progress.
- **`recognize`** — `recognizing text` events. Percent passed through. ETA computed as `elapsed * (1 - p) / p` where `p ∈ (0, 1)`; `null` until `p > 0.05` to avoid wild estimates from the first few percent.

### 2.6 HEIC reuse path

`image-to-text` accepts `.heic` and routes through the existing `_shared/decode-image.ts:decodeImage(file)` which already handles libheif. `decodeImage` returns an `ImageBitmap`. Tesseract.js's `recognize()` accepts `ImageBitmap` directly inside a worker — no extra round-trip via `<canvas>` or blob. For non-HEIC inputs `decodeImage` short-paths to `createImageBitmap(file)`, so this single code path covers all five accepted formats.

### 2.7 Validation

- Extension allowlist: `.jpg`, `.jpeg`, `.png`, `.webp`, `.heic`.
- MIME sniff via `_shared/file-detection.detectMime`. Mismatch between extension and detected MIME → reject with the standard `"<file>: extension says X but content is Y"` error.
- Size: 25 MB hard cap (matches v2 §7.1).
- Empty file rejected pre-decode.

### 2.8 Persistent harness ownership of cancel + dispose

The engine exports a persistent harness via `_shared/harness.ts`'s factory (mirrors `audio-trim`, `video-trim`). The page (`src/app/tools/image-to-text/page.tsx`) calls `disposeImageToTextHarness()` in a `useEffect` cleanup. The harness's `runConvertSingle` accepts `signal`; on abort, the harness terminates the worker and clears its instance promise — the next call allocates fresh.

## 3. Architecture / file layout

```
src/
  engines/
    _shared/
      tesseract/
        index.ts                 ← NEW (loadTesseract singleton; worker-only)
        index.test.ts            ← NEW (real recognize against fixture; reset for tests; CDN-bypass assertion)
        types.ts                 ← NEW (TesseractWorker type re-exports + WordBbox shape)
    image-to-text/               ← NEW
      index.ts                   ← engine descriptor (SingleInputEngine), persistent harness factory, disposeImageToTextHarness
      index.test.ts              ← validation + correctness (real OCR against committed fixtures)
      options.ts                 ← ImageToTextOptions, defaults, outputExtensionFor, outputMimeFor
      options.test.ts            ← option-shape unit tests
      options-panel.tsx          ← OptionsPanel: outputFormat <select> + tooltip
      options-panel.test.tsx     ← render + interaction tests
      worker.ts                  ← Comlink-exposed worker; convertSingle wraps loadTesseract().recognize()
  app/
    page.tsx                     ← MODIFIED (1 new tool card under OCR section, or unsorted until Phase 26)
    tools/
      image-to-text/page.tsx     ← NEW (<ToolFrame engine={engine} /> + dispose effect)

scripts/
  copy-tesseract-assets.mjs      ← NEW (mirrors copy-ffmpeg-core.mjs / copy-bg-remove-model.mjs)
  tesseract-manifest.json        ← NEW (pinned source URLs + SHA-256s)
  check-bundle-isolation.mjs     ← MODIFIED (extend to assert tesseract.js + tesseract-core not present in homepage chunk)

public/
  tesseract/                     ← NEW (gitignored; .gitkeep checked in)
    .gitkeep
    tesseract-core.wasm.js       ← copied from node_modules/tesseract.js-core
    tesseract-core.wasm          ← copied from node_modules/tesseract.js-core
    tesseract-core-simd.wasm.js  ← copied (SIMD variant)
    tesseract-core-simd.wasm     ← copied
    worker.min.js                ← copied from node_modules/tesseract.js
    eng.traineddata.gz           ← downloaded by copy-tesseract-assets.mjs (~22 MB)

tests/
  e2e/
    image-to-text.spec.ts                           ← NEW (route + UI E2E; no real OCR)
    image-to-text-correctness.spec.ts               ← NEW (real OCR; gated by RUN_IMAGE_TO_TEXT_CORRECTNESS=1)
    privacy-regression-image-to-text.spec.ts        ← NEW (zero off-origin during real OCR)
  fixtures/
    image-to-text/                                  ← NEW
      scanned-receipt.png                           ← committed, < 1 MB
      screenshot.png                                ← committed, < 1 MB
      photo-with-text.jpg                           ← committed, < 1 MB
      screenshot.heic                               ← committed, < 1 MB (exercises libheif reuse)
      SOURCES.md                                    ← provenance + regeneration commands

.gitignore                                          ← MODIFIED (add public/tesseract/* allowlisting .gitkeep)
package.json                                        ← MODIFIED (postinstall + prebuild hooks for copy-tesseract-assets)
src/engines/_shared/registry.ts                     ← MODIFIED (register image-to-text)
```

## 4. Tesseract.js loader — the shared module

Mirrors `loadFfmpeg()` exactly in shape:

```ts
// src/engines/_shared/tesseract/index.ts (SKETCH)
import type { Worker as TesseractWorker } from "tesseract.js";

const PATHS = {
  workerPath: "/tesseract/worker.min.js",
  corePath:   "/tesseract/", // tesseract.js picks tesseract-core{,-simd}.wasm.js
  langPath:   "/tesseract/", // resolves to /tesseract/eng.traineddata.gz
} as const;

let instancePromise: Promise<TesseractWorker> | null = null;

export async function loadTesseract(): Promise<TesseractWorker> {
  if (instancePromise) return instancePromise;
  instancePromise = (async () => {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng", 1 /* OEM.LSTM_ONLY */, PATHS);
    return worker;
  })().catch((err) => {
    instancePromise = null;
    throw err;
  });
  return instancePromise;
}

export async function disposeTesseract(): Promise<void> {
  if (!instancePromise) return;
  const worker = await instancePromise.catch(() => null);
  instancePromise = null;
  if (worker) await worker.terminate();
}

/** Test-only: clear the memoized instance. Do NOT export from any public surface. */
export function __resetForTests(): void {
  instancePromise = null;
}
```

Two things this enforces vs. the Tesseract.js defaults:

1. **`langPath: "/tesseract/"` (same-origin).** The default is `https://tessdata.projectnaptha.com/4.0.0/`, which violates `connect-src 'self'`. Setting `langPath` redirects the lang fetch to our same-origin asset. The privacy regression test asserts no off-origin request fires.
2. **`corePath: "/tesseract/"` (same-origin).** Default is jsDelivr. Same fix.
3. **`workerPath: "/tesseract/worker.min.js"`** (same-origin). Default is jsDelivr.

The `import("tesseract.js")` is dynamic so the homepage chunk stays clean. `scripts/check-bundle-isolation.mjs` extends to fail the build if `tesseract` shows up in any non-engine entrypoint.

## 5. Engine descriptor + worker

```ts
// src/engines/image-to-text/index.ts (SHAPE)
import type { SingleInputEngine } from "@/engines/_shared/types";
import { createPersistentHarness } from "@/engines/_shared/harness";
import type { ImageToTextOptions } from "./options";

const harness = createPersistentHarness(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

export const disposeImageToTextHarness = () => harness.dispose();

const engine: SingleInputEngine<ImageToTextOptions> = {
  id: "image-to-text",
  // ...metadata...
  validate: (file) => { /* extension + MIME + size */ },
  convert: ({ file, options, signal, onProgress }) =>
    harness.runConvertSingle({ file, options, signal, onProgress }),
};
export default engine;
```

The worker:

```ts
// src/engines/image-to-text/worker.ts (SHAPE)
import { loadTesseract } from "@/engines/_shared/tesseract";
import { decodeImage } from "@/engines/_shared/decode-image";

async function convertSingle({ file, options, signal, onProgress }) {
  signal?.throwIfAborted();
  const bitmap = await decodeImage(file); // libheif-or-browser
  signal?.throwIfAborted();

  const worker = await loadTesseract();
  worker.setLogger((m) => onProgress(mapTesseractStatus(m, t0)));

  const result = await worker.recognize(bitmap);
  signal?.throwIfAborted();

  return options.outputFormat === "json-with-bboxes"
    ? jsonOutput(result, file.name)
    : txtOutput(result, file.name);
}
```

Cancellation: the engine route's harness wires `signal` to `disposeTesseract()` so an aborted run kills the worker rather than waiting for `recognize()` to return.

## 6. Asset acquisition script

`scripts/copy-tesseract-assets.mjs` runs on `postinstall` AND `prebuild` (same as `copy-ffmpeg-core.mjs`):

1. Read `scripts/tesseract-manifest.json` (pinned versions + SHA-256s).
2. Copy `node_modules/tesseract.js/dist/worker.min.js` → `public/tesseract/`.
3. Copy `node_modules/tesseract.js-core/tesseract-core{,-simd}.wasm{,.js}` → `public/tesseract/`.
4. Hash-check copied files against manifest.
5. If `public/tesseract/eng.traineddata.gz` already exists and SHA-256 matches manifest, skip download. Otherwise download from pinned GitHub raw URL, gzip the result (the GitHub raw asset is uncompressed `.traineddata`; Tesseract.js loads `.gz`), hash-check against manifest.
6. Idempotent — re-running the script after a successful run is a no-op.

`scripts/tesseract-manifest.json` shape mirrors `ffmpeg-manifest.json`:

```json
{
  "tesseract_js_version": "5.x.y",
  "tesseract_core_version": "5.x.y",
  "tessdata_source": {
    "url": "https://github.com/tesseract-ocr/tessdata_best/raw/<sha-or-tag>/eng.traineddata",
    "sha256_uncompressed": "...",
    "sha256_gzipped": "..."
  },
  "files": {
    "worker.min.js":            { "sha256": "..." },
    "tesseract-core.wasm.js":   { "sha256": "..." },
    "tesseract-core.wasm":      { "sha256": "..." },
    "tesseract-core-simd.wasm.js": { "sha256": "..." },
    "tesseract-core-simd.wasm": { "sha256": "..." }
  }
}
```

CI runs `pnpm install` which triggers `postinstall`, which downloads + hash-checks. On a first checkout the developer pays the ~22 MB download once; subsequent installs are no-ops.

## 7. Bundle isolation + privacy

**Bundle isolation gate** (`scripts/check-bundle-isolation.mjs` extension):

- Fail if `tesseract.js`, `tesseract.js-core`, or `tesseract` appears in the homepage chunk.
- Fail if `tessdata.projectnaptha.com` or `cdn.jsdelivr.net` appears in any built JS chunk (catches a misconfigured `langPath`/`corePath`/`workerPath`).
- Existing engines auto-enroll; this phase adds two new patterns to the existing fail list.

**Privacy regression** (`tests/e2e/privacy-regression-image-to-text.spec.ts`):

- Boot Playwright with network monitoring. Navigate to `/tools/image-to-text`. Drop a fixture. Click Convert. Wait for completion.
- Assert: zero requests to off-origin hosts during the entire flow. The only network requests permitted are same-origin GETs to `/tesseract/*` and `/tools/image-to-text` itself.

**CSP review:** `'wasm-unsafe-eval'` is already in `script-src` (Phase 19). Tesseract.js's worker is loaded from same-origin `/tesseract/worker.min.js`. No CSP changes required.

## 8. Test fixtures

| Path | Source | Asserted substring (case-insensitive) |
|---|---|---|
| `tests/fixtures/image-to-text/scanned-receipt.png` | Hand-collected, hand-rendered receipt | `"TOTAL"`, plus one numeric token like `"$"` |
| `tests/fixtures/image-to-text/screenshot.png` | Cropped editor or terminal screenshot | one short identifier (e.g. function name) |
| `tests/fixtures/image-to-text/photo-with-text.jpg` | Phone photo of signage / book page | one common word from the text |
| `tests/fixtures/image-to-text/screenshot.heic` | Same content as `screenshot.png` exported HEIC | identical substring assertion (verifies HEIC path) |
| `tests/fixtures/image-to-text/SOURCES.md` | — | provenance + regeneration commands |

Substring-only assertions per v2 §6.2: exact-match is brittle on OCR. Each fixture < 1 MB.

## 9. UX surfaces

### 9.1 OptionsPanel

Single `<select>`:

```
Output format: [ Plain text (.txt)  ▾ ]
                 Plain text (.txt)
                 JSON with bounding boxes (.json)

ⓘ Best on scanned documents and screenshots; lower quality on photos.
```

Tooltip text is the v2 spec's exact phrasing.

### 9.2 Convert button → Cancel button

Per v2 §4.5: while a conversion is in flight, the Convert button reads `Cancel`. Clicking it calls `signal.abort()`. The harness terminates the worker; the next conversion pays cold init.

### 9.3 Progress UI

`ConversionProgress` events drive the existing progress bar with phase + percent + ETA strings. Tesseract.js emits enough events to make this feel responsive — the `recognizing text` phase ticks every few hundred ms on most images.

## 10. Performance and limits

| Metric | Target | Notes |
|---|---|---|
| Cold init (first conversion) | ≤ 10 s on dev box, ≤ 6 s on a fast machine | Dominated by `eng.traineddata.gz` parse. Cached by browser after first request (HTTP cache headers via `vercel.json` already cover `/tesseract/*`). |
| Warm recognition (1080p screenshot, ~500 chars) | ≤ 4 s | tessdata_best is slower than fast; this is the conscious accuracy tradeoff. |
| Memory ceiling | ≤ 250 MB resident during recognize | Warmed worker holds traineddata; recognize allocates per-image scratch. |
| Size cap | 25 MB | v2 §7.1. Larger images would not OOM but UX latency is unacceptable. |

8 GB dev box discipline (per `feedback_low_ram_dev_box`): correctness E2E runs serial, single worker. The harness's persistent worker is a single resident allocation per test process.

## 11. Out of scope for Phase 23

- Any language other than English. Adding language packs is a Phase ≥ 27 concern; the same `loadTesseract()` would gain a `lang` parameter and `copy-tesseract-assets.mjs` would download additional `.traineddata.gz` files.
- Image preprocessing options (binarize, deskew, dpi hint, region selection). v2 §3.5 explicitly omits these.
- Layout / table extraction (TSV output, paragraph reconstruction). The exposed JSON schema is word-level only.
- PDF as input. The v2 design path for PDF→text is `pdf-to-md` (already shipped) for vector PDFs; raster-PDF OCR would be a separate engine that calls `pdf-to-image` then `image-to-text`, deferred.
- Configurable confidence threshold. JSON output reports raw confidence; filtering is a downstream user concern.
- Cancel-while-recognizing fine-grained pause. `worker.terminate()` is good enough.

## 12. Verification gates (must all pass before merge)

1. `pnpm typecheck` — clean.
2. `pnpm lint` — clean (Biome rules including the no-fetch-in-engines rule).
3. `pnpm test` — clean (unit + integration, including the new tesseract-loader test that verifies `langPath`/`corePath` are same-origin).
4. `pnpm test:e2e` — clean. Three new specs (`image-to-text.spec.ts`, `image-to-text-correctness.spec.ts` gated by `RUN_IMAGE_TO_TEXT_CORRECTNESS=1`, `privacy-regression-image-to-text.spec.ts`).
5. `pnpm build` — clean. `scripts/check-bundle-isolation.mjs` enforces:
   - `tesseract` not in homepage chunk.
   - No `tessdata.projectnaptha.com` / `cdn.jsdelivr.net` strings in any built JS.
6. Manual: open `/tools/image-to-text`, drop each fixture (including HEIC), confirm:
   - Cold first run shows `warmup` phase with progress.
   - Subsequent runs skip warmup phase.
   - Cancel button terminates and is recoverable.
   - JSON output schema matches §2.4 word-by-word for `screenshot.png`.
7. `securityheaders.com` scan unchanged from v1 (still grade A; no header weakened).

## 13. Branch, commits, and execution

- Branch name: `phase-23-tesseract-and-image-to-text`.
- Per-task commits, body lines ≤ 72 chars, never `--amend`, never `--no-verify`. No Claude attribution (project memory `feedback_no_claude_in_commits`).
- Implementation via `superpowers:subagent-driven-development` (per project posture for substantive tasks). Implementer subagents must NOT run `git branch -m/-M` or `git checkout <branch>` (project memory `feedback_branch_discipline`). Verify before each commit: `git rev-parse --abbrev-ref HEAD` prints `phase-23-tesseract-and-image-to-text`.

## 14. Open questions for review

- **Tesseract.js major version pin.** v5 (current stable) vs v6 (if released by phase start). Pin in `package.json` to whatever `pnpm add tesseract.js` resolves at branch start; record in manifest.
- **OEM mode default.** `LSTM_ONLY` (1) vs `DEFAULT` (3, which combines legacy + LSTM). Recommend `LSTM_ONLY` with `tessdata_best` since legacy data isn't shipped — saves init time. Verify in benchmark before commit.
- **`worker.min.js` vs `worker.js`.** Tesseract.js ships both. `min.js` is what we want; the script copies that variant explicitly.
