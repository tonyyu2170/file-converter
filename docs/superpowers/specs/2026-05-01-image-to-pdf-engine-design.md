# Image-to-PDF engine + HEIC consolidation — design / spec

Plan 3 of the file_converter roadmap. Source of truth for the implementation plan.

This plan does two things in one shippable unit:

1. **New `image-to-pdf` engine** — first multi-input engine in the project. Accepts 1+ HEIC / PNG / JPEG / WebP files and produces a single combined PDF via `pdf-lib`. Activates ToolFrame's currently-dead multi-cardinality branch and introduces the `StagingArea` engine-pattern extension.
2. **HEIC consolidation** — image-convert engine extends to accept HEIC inputs via a new shared `_shared/decode-image.ts` utility. The dedicated HEIC engine and its route are removed. Sidebar collapses to two image tools.

The two work-streams share the shared decoder, so coupling them in one plan avoids a confusing intermediate state where both image-convert and the HEIC engine accept HEIC.

## 1. Scope

### 1.1 image-to-pdf engine

- Inputs: HEIC, HEIF, PNG, JPEG, WebP — one or more files per conversion.
- Output: single PDF combining all inputs as one image per page.
- Page geometry: Letter (default) or A4, user-selectable. Per-image automatic orientation (landscape image → landscape page, portrait → portrait). Image fit-to-page with aspect-preserved scaling, centered, 12px fixed margin on each axis.
- New library: `pdf-lib` (~250 KB min+gz). Reused by Plan 4 (PDF merge).
- New shared module: `src/engines/_shared/decode-image.ts` — single decoder utility that handles HEIC via libheif-js (lazy-imported) and PNG/JPEG/WebP via browser-native `createImageBitmap`. Both image-to-pdf AND image-convert use it.
- New engine-pattern extension: optional `StagingArea?: ComponentType<StagingAreaProps<TOptions>>` on `MultiInputEngine`, parallel to the `OptionsPanel` field added in Plan 2.

### 1.2 HEIC consolidation

- `image-convert` engine extends to accept HEIC inputs. Output formats unchanged (PNG / JPEG / WebP — `OffscreenCanvas.convertToBlob` cannot encode HEIC).
- Dedicated `heic-to-png` engine deleted entirely.
- Route `/tools/heic-to-png` deleted.
- Sidebar entry `heic→png` removed; sidebar IMAGES group reduces to two entries (`image convert`, `image→pdf`).
- Homepage MIME-detect routing updated: HEIC drops route to `/tools/image-convert` instead of `/tools/heic-to-png`.

## 2. Out of scope

- Per-image fit/fill/crop options (always fit-with-aspect-preserved).
- Custom margins (fixed 12px, no slider).
- User-controllable orientation override (auto per image).
- Output filename customization (always `combined.pdf`; user can rename after download).
- Mid-conversion error recovery (strict abort on first failure; user removes the bad file from staging and retries).
- HEIC encoding (only HEIC decoding).
- Generic engine chaining infrastructure (C2/C3 from brainstorming) — defer to a post-v1 plan.
- Drag-and-drop reordering in the staging area (use ↑↓ buttons; HTML5 DnD or `dnd-kit` is post-v1).
- Per-page orientation override.
- Multi-page-PDF input handling (this engine is image-input only).
- Output JPEG embedding for photo compression (current design always embeds PNG; defer to a future plan that adds a quality option for the PDF).
- Bundle-size budget for libheif loading via shared decoder — Phase 6 hardening.

## 3. Architecture

### 3.1 Shared image decoder

New module `src/engines/_shared/decode-image.ts`:

```ts
import { detectMime } from "./file-detection";

let libheifModulePromise: Promise<typeof import("libheif-js/wasm-bundle")> | undefined;

async function loadLibheif() {
  if (!libheifModulePromise) {
    libheifModulePromise = import("libheif-js/wasm-bundle");
  }
  return libheifModulePromise;
}

async function decodeHeic(file: File): Promise<ImageBitmap> {
  const lib = await loadLibheif();
  const decoder = new lib.HeifDecoder();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const data = decoder.decode(bytes);
  if (!data || data.length === 0) {
    throw new Error("libheif: no images decoded from HEIC");
  }
  const first = data[0];
  if (!first) throw new Error("libheif: first image missing");
  const width = first.get_width();
  const height = first.get_height();
  const rgba = await new Promise<Uint8ClampedArray>((resolve, reject) => {
    first.display(
      { data: new Uint8ClampedArray(width * height * 4), width, height },
      (display: { data: Uint8ClampedArray; width: number; height: number } | null) => {
        if (!display) reject(new Error("libheif: display callback received null"));
        else resolve(display.data);
      },
    );
  });
  // Wrap RGBA bytes in an ImageBitmap-compatible surface
  const imageData = new ImageData(rgba, width, height);
  return await createImageBitmap(imageData);
}

export async function decodeImage(file: File): Promise<ImageBitmap> {
  const mime = await detectMime(file);
  if (mime === "image/heic" || mime === "image/heif") {
    return decodeHeic(file);
  }
  return createImageBitmap(file, { imageOrientation: "from-image" });
}
```

Key properties:

- **Lazy libheif load.** The 1.46 MB WASM module is imported only when an HEIC file is encountered. PNG/JPEG/WebP conversions in `image-convert` retain zero new bundle weight.
- **Module-level cache.** `libheifModulePromise` ensures libheif is loaded at most once per worker session.
- **EXIF orientation.** PNG/JPEG/WebP path uses `createImageBitmap(file, { imageOrientation: "from-image" })`. The HEIC path's libheif decoder applies orientation natively per HEIF spec.
- **Returns `ImageBitmap`.** Consumers can `drawImage` it onto an `OffscreenCanvas`. The bitmap holds GPU memory; consumers must call `bitmap.close()` after use.
- **No fetch / XHR.** Same-origin in-memory operations only. The Biome `no-restricted-globals` rule under `src/engines/` continues to pass.

### 3.2 StagingArea engine-pattern extension

The `SingleInputEngine` and `MultiInputEngine` types gain a third optional UI field:

```ts
export type StagingAreaProps<TOptions> = {
  files: File[];
  onChange: (next: File[]) => void;
  options: TOptions;
};

export type SingleInputEngine<TOptions, TOutput> = ... & {
  isReadyToConvert?: (opts: TOptions) => boolean;
  OptionsPanel?: ComponentType<OptionsPanelProps<TOptions>>;
};

export type MultiInputEngine<TOptions, TOutput> = ... & {
  isReadyToConvert?: (opts: TOptions) => boolean;
  OptionsPanel?: ComponentType<OptionsPanelProps<TOptions>>;
  StagingArea?: ComponentType<StagingAreaProps<TOptions>>;
};
```

`StagingArea` is multi-only by intent — single-input engines have no staging step (drop fires immediately). Including the field on `SingleInputEngine` would invite confusion. Future single-engine workflows that genuinely benefit from staging can revisit.

### 3.3 image-to-pdf engine descriptor

```ts
const SUPPORTED_INPUT_MIMES = [
  "image/heic", "image/heif",
  "image/png", "image/jpeg", "image/webp",
];

const engine: MultiInputEngine<ImageToPdfOptions, OutputItem> = {
  id: "image-to-pdf",
  inputAccept: [".heic", ".heif", ".png", ".jpg", ".jpeg", ".webp"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "application/pdf",
  defaultOptions: defaultImageToPdfOptions,
  cardinality: "multi",
  OptionsPanel: ImageToPdfOptionsPanel,
  StagingArea: ImageToPdfStagingArea,
  // isReadyToConvert is omitted: paper size has a default, no blocking option.
  async validate(files) {
    if (files.length === 0) {
      return { ok: false, reason: "Drop at least one image" };
    }
    const mimes = await Promise.all(files.map(detectMime));
    const allSupported = mimes.every((m) => SUPPORTED_INPUT_MIMES.includes(m));
    if (!allSupported) {
      return { ok: false, reason: "All files must be PNG, JPEG, WebP, or HEIC" };
    }
    return { ok: true };
  },
  async convert(files, opts, signal) {
    const harness = new WorkerHarness<ImageToPdfOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    );
    return await harness.runMulti(files, opts, signal);
  },
};
```

### 3.4 image-convert engine refactor

- `inputAccept` extends to include `.heic`, `.heif`.
- `inputMime` extends to include `image/heic`, `image/heif`.
- `validate(file)` accepts the new MIMEs.
- `worker.ts` calls `decodeImage(blob)` from the shared decoder instead of inline `createImageBitmap`. Worker imports trim accordingly.
- Output formats unchanged: `"png" | "jpeg" | "webp"`. HEIC encoding remains out of scope.

### 3.5 HEIC engine removal

Files deleted:

- `src/engines/heic-to-png/index.ts`
- `src/engines/heic-to-png/options.ts`
- `src/engines/heic-to-png/worker.ts`
- `src/engines/heic-to-png/index.test.ts`
- `src/app/tools/heic-to-png/page.tsx`

Files modified:

- `src/engines/_shared/registry.ts`: `EngineId` union loses `"heic-to-png"`; registry table loses the entry.
- `src/engines/_shared/registry.test.ts`: drop the HEIC positive-path test.
- `src/components/layout/sidebar.tsx`: remove the `heic→png` entry from `TOOLS`.
- `src/app/page.tsx`: HEIC routing branch updates to push to `/tools/image-convert` (instead of `/tools/heic-to-png`).
- `src/types/libheif-js.d.ts`: keep — still used by the shared decoder.
- `tests/e2e/heic-to-png.spec.ts`: DELETE. Its happy-path coverage migrates to the extended `image-convert.spec.ts` (which gains a HEIC fixture case).
- `tests/e2e/privacy-regression-heic.spec.ts`: DELETE. Coverage migrates to the extended `privacy-regression-image-convert.spec.ts`.
- `tests/e2e/homepage-handoff.spec.ts`: HEIC test updates to expect `/tools/image-convert` URL (instead of `/tools/heic-to-png`).

The `tests/fixtures/sample.heic` fixture is retained — used by the extended image-convert E2E spec.

## 4. Options surface

### 4.1 image-to-pdf options

```ts
export type ImageToPdfPaperSize = "letter" | "a4";

export type ImageToPdfOptions = {
  paper: ImageToPdfPaperSize;
};

export const defaultImageToPdfOptions: ImageToPdfOptions = {
  paper: "letter",
};

export const PAPER_DIMS: Record<ImageToPdfPaperSize, [number, number]> = {
  letter: [612, 792],          // 8.5" × 11" @ 72 DPI
  a4:     [595.28, 841.89],    // 210mm × 297mm @ 72 DPI
};

export const PAGE_MARGIN = 12; // points
```

Paper size is the only user-visible option. `isReadyToConvert` is omitted because `paper` always has a value (defaults to `"letter"`); `ready` resolves to `true` per the optional-method default.

Margin is intentionally a fixed code constant, not an option, until users ask for control. Auto-orientation per image is also intentionally not exposed.

### 4.2 OptionsPanel component

`src/engines/image-to-pdf/options-panel.tsx`. One control: a `<select>` with two options (`Letter`, `A4`). Mirrors the brutalist styling of image-convert's panel. No quality slider (PDF embeds are always lossless PNG in this design — see §6 Worker).

## 5. UI

### 5.1 StagingArea component

`src/engines/image-to-pdf/staging-area.tsx`. Client component. For each file in `files`:

- Decode via shared `decodeImage(file)` (lazy; cached per File reference via `useMemo`)
- Draw bitmap to a 32×32 OffscreenCanvas (aspect-preserved center crop or fit — choose fit so the image is recognizable; resizing-with-crop loses too much info at this size)
- Encode to `image/png` blob → `URL.createObjectURL` → `<img src>`
- Cache the resulting object URL per File. Reuse across re-renders.
- Cleanup: revoke object URLs on unmount AND when files change (reference comparison)

Row layout:

```
┌──────────────────────────────────────────────────────────────┐
│  [1]  [thumb]  vacation-beach.png       142 KB   [↑] [↓] [×] │
│  [2]  [thumb]  vacation-sunset.jpg       88 KB   [↑] [↓] [×] │
│  [3]  [thumb]  vacation-dinner.heic    1.2 MB    [↑] [↓] [×] │
│  [4]  [thumb]  vacation-flight.webp     312 KB   [↑] [↓] [×] │
└──────────────────────────────────────────────────────────────┘
```

- Page number (1-indexed): accent-colored.
- Thumbnail: 32×32 with `--color-hairline` border.
- Filename: monospace, truncated with `title` attribute for the full name.
- Size: human-readable (KB / MB), `--color-fg-muted`.
- ↑/↓: disabled at the boundary (↑ on row 1, ↓ on the last row).
- ×: removes the row; calls `onChange(filesWithoutThis)`.

Reorder logic: ↑ swaps with the previous row, ↓ with the next. Calls `onChange(reordered)`.

Errors during thumbnail decode (e.g., a corrupt image): render a placeholder thumb (small `?` or X icon) and let the row remain in staging. Conversion-time failure will surface a real error from the engine's `convert`. Don't pre-validate via the staging thumbnail — that's the engine's responsibility.

### 5.2 ToolFrame multi-cardinality changes

Extends Plan 2's ToolFrame with a multi-input branch:

- New state: `stagedFiles: File[]`.
- `Panel = engine.OptionsPanel` (existing, unchanged).
- `Staging = engine.StagingArea` (new).
- For multi-cardinality engines:
  - DropZone gets `multiple={true}`. `onFiles={(files) => setStagedFiles([...stagedFiles, ...files])}` (append-on-drop, not replace).
  - Render `<Staging files={stagedFiles} onChange={setStagedFiles} options={options} />` between OptionsPanel and DropZone (when staging non-empty).
  - "Convert" button below DropZone. Disabled when `stagedFiles.length === 0 || !ready`. `onClick={() => run(stagedFiles, options)}`.
- For single-cardinality engines: behavior unchanged (DropZone fires `run(files, options)` immediately).
- `run` signature is already `(files: File[], opts: TOptions) => void` (Plan 2). For multi engines, `files = stagedFiles` (the full array). For single engines, `files` comes from the DropZone's onFiles callback (one file, possibly more if user drops several — single-input engines take `files[0]` per existing logic).

Cross-route handoff:
- Mount-effect (`consumedRef`-guarded): consumes `takeStagedFiles()`. Returns `File[]`.
- Watcher effect:
  - For single: `if (pendingFiles.length > 0 && ready) { run([pendingFiles[0]], options); setPendingFiles([]); }`
  - For multi: `if (pendingFiles.length > 0) { setStagedFiles(pendingFiles); setPendingFiles([]); }` — does NOT auto-fire conversion. User reviews the staged files in the StagingArea, then clicks Convert.

The `pendingFiles` state replaces Plan 1/2's `pendingFile: File | null` — single-input branches use `pendingFiles[0]` post-deref.

### 5.3 Convert button visual

```
         ┌─────────────────────┐
         │ [ CONVERT TO PDF ]  │  ← button border + text in --color-accent when enabled,
         └─────────────────────┘    --color-fg-very-muted when disabled
```

Same hairline-border brutalist treatment as the rest of the UI. `disabled={stagedFiles.length === 0 || !ready}`.

### 5.4 DropZone behavior

- `multiple={true}` for multi-input engines (pass-through from ToolFrame).
- `onFiles` callback semantics now depend on consumer:
  - Single-input ToolFrame: still calls `run(files, options)` immediately (HEIC and image-convert behavior).
  - Multi-input ToolFrame: appends to stagedFiles (no immediate conversion).
- DropZone itself remains unchanged from Plan 2 — the differentiation lives in the ToolFrame's `onFiles` handler.

## 6. Worker (image-to-pdf)

```ts
import * as Comlink from "comlink";
import { PDFDocument } from "pdf-lib";
import type { OutputItem } from "@/engines/_shared/types";
import { decodeImage } from "@/engines/_shared/decode-image";
import { PAGE_MARGIN, PAPER_DIMS, type ImageToPdfOptions } from "./options";

const api = {
  async convertMulti(
    files: Array<{ bytes: ArrayBuffer; name: string; type: string }>,
    opts: ImageToPdfOptions,
  ): Promise<OutputItem> {
    if (files.length === 0) {
      throw new Error("image-to-pdf: no input files");
    }

    const pdf = await PDFDocument.create();
    const [paperW, paperH] = PAPER_DIMS[opts.paper];

    for (const [i, f] of files.entries()) {
      const mimeType = f.type || "application/octet-stream";
      const blob = new Blob([f.bytes], { type: mimeType });
      const file = new File([blob], f.name || `page-${i + 1}`, { type: mimeType });

      const bitmap = await decodeImage(file);
      try {
        const isLandscape = bitmap.width > bitmap.height;
        const pageW = isLandscape ? Math.max(paperW, paperH) : Math.min(paperW, paperH);
        const pageH = isLandscape ? Math.min(paperW, paperH) : Math.max(paperW, paperH);

        // Re-encode bitmap as PNG for pdf-lib's embedPng. Lossless.
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");
        ctx.drawImage(bitmap, 0, 0);
        const pngBlob = await canvas.convertToBlob({ type: "image/png" });
        const pngBytes = await pngBlob.arrayBuffer();
        const embedded = await pdf.embedPng(pngBytes);

        const page = pdf.addPage([pageW, pageH]);
        const availW = pageW - 2 * PAGE_MARGIN;
        const availH = pageH - 2 * PAGE_MARGIN;
        const scale = Math.min(availW / bitmap.width, availH / bitmap.height);
        const drawW = bitmap.width * scale;
        const drawH = bitmap.height * scale;
        const x = (pageW - drawW) / 2;
        const y = (pageH - drawH) / 2;
        page.drawImage(embedded, { x, y, width: drawW, height: drawH });
      } finally {
        bitmap.close();
      }
    }

    const pdfBytes = await pdf.save();
    return {
      filename: "combined.pdf",
      mime: "application/pdf",
      blob: new Blob([pdfBytes as BlobPart], { type: "application/pdf" }),
    };
  },
};

Comlink.expose(api);
```

Key notes:

- **Always embed as PNG**. pdf-lib's `embedPng` requires raw PNG bytes; `embedJpg` requires JPEG. We re-encode every input as PNG via OffscreenCanvas. Lossless. JPEG embedding (smaller for photos) is deferred — it would need a per-image format choice and adds branching for limited gain in v1.
- **One image per page**. No multi-image grids. Page geometry derived from input image aspect.
- **Page size** picks the longer dimension as height for portrait, vice versa for landscape. Letter portrait = 612×792; Letter landscape = 792×612.
- **Margins** 12px on each side; image scaled to fit within the available area, preserving aspect, centered.
- **Memory**: each `decodeImage` returns an ImageBitmap holding GPU memory. The `finally` block closes it before moving to the next file. The OffscreenCanvas is garbage-collected when the loop iteration ends.
- **AbortSignal**: the engine's `convert` receives an AbortSignal. The harness terminates the worker on abort. The worker doesn't need explicit signal handling beyond what the harness provides.
- **Error path**: any thrown error in the loop bubbles up; the harness rejects the promise; ToolFrame surfaces the error message and sets status to error. Strict abort semantics — no skip-and-continue.

## 7. Cross-route handoff API change

Plan 1's `handoff.ts` slot moves from `File | null` to `File[]`:

```ts
let staged: File[] = [];

export function stageFiles(files: File[]): void {
  staged = files;
}

export function takeStagedFiles(): File[] {
  const r = staged;
  staged = [];
  return r;
}
```

The previous `stageFile` / `takeStagedFile` exports are removed. Migrate callsites:

- `src/app/page.tsx`: each branch of `handleFiles` calls `stageFiles(files)` (multi) or `stageFiles([f])` (single).
- `src/components/tool-frame.tsx`: replace `pendingFile: File | null` with `pendingFiles: File[]`. Mount-effect calls `takeStagedFiles()`. Watcher effect:
  - Single-cardinality: when `pendingFiles.length > 0 && ready`, fire `run([pendingFiles[0]], options)` and clear.
  - Multi-cardinality: when `pendingFiles.length > 0`, set `stagedFiles` and clear. No auto-fire.
- `src/lib/handoff.test.ts`: tests update to the new API. Add multi-file test cases.

## 8. Homepage MIME-detect routing

```ts
async function handleFiles(files: File[]) {
  setError(null);
  if (files.length === 0) return;

  const mimes = await Promise.all(files.map(detectMime));
  const SUPPORTED = new Set([
    "image/heic", "image/heif",
    "image/png", "image/jpeg", "image/webp",
  ]);
  const allImages = mimes.every((m) => SUPPORTED.has(m));

  if (!allImages) {
    setError("No tool for this file type yet. Phase 3 supports HEIC, PNG, JPEG, WebP.");
    return;
  }

  if (files.length >= 2) {
    stageFiles(files);
    router.push("/tools/image-to-pdf");
    return;
  }

  // Single file: HEIC + PNG/JPEG/WebP all → image-convert (after consolidation)
  stageFiles(files);
  router.push("/tools/image-convert");
}
```

Notes:

- Mixed-image-type drops (e.g., one HEIC + one PNG, or 3 PNGs + 2 JPEGs) all route to `/tools/image-to-pdf` if `files.length >= 2`. The engine's validate accepts any combination of supported MIMEs.
- Single-HEIC, single-PNG, single-JPEG, single-WebP all route to `/tools/image-convert`.
- Image-convert handles HEIC inputs after the refactor.

## 9. Sidebar

After this plan:

```
// IMAGES
image convert
image→pdf
```

Two entries under one group. The `heic→png` entry is removed.

## 10. Validation rules

- `image-to-pdf.validate(files, _opts)`: at least one file; all files must have a supported image MIME (magic-byte check via `detectMime`). Strict — mixed input with even one non-image rejects with a clear reason.
- `image-convert.validate(file, _opts)`: file MIME (from `file.type`) is one of the five supported image MIMEs. Magic-byte verification is left to the engine's `convert` path (consistent with Plan 2's posture).

## 11. Output

- `image-to-pdf` returns `{ filename: "combined.pdf", mime: "application/pdf", blob }`.
- One row in the ResultList per conversion; manual download (auto-download was removed in Plan 1).
- No `combined-1.pdf` / `combined-2.pdf` collision handling — re-converting overwrites the staged output (`setItems(out)` in ToolFrame's run already replaces the previous result). User triggers a new download per output.

## 12. Privacy

Same posture as HEIC and image-convert. Worker-only conversion, no `fetch` / `XHR` in the engine code path, enforced by Biome's `no-restricted-globals` rule under `src/engines/`. The shared decoder's `import("libheif-js/wasm-bundle")` is a same-origin module load (the wasm chunk ships in the static export bundle) — verified previously by Plan 1's privacy regression. New regression spec `tests/e2e/privacy-regression-image-to-pdf.spec.ts` drives a real multi-image conversion (including a HEIC input to exercise the lazy decoder load path) and asserts zero off-origin requests / WebSockets.

WebSocket assertion uses host-comparison (PR #2 fix).

## 13. Testing strategy

### 13.1 Unit tests

- `src/engines/_shared/decode-image.test.ts` (new) — decoder dispatches: `image/heic` → libheif path (mock the dynamic import), `image/png` → `createImageBitmap` path. 4 tests.
- `src/engines/image-to-pdf/options.ts` — types-only, no test file (consistent with image-convert/options.ts).
- `src/engines/image-to-pdf/index.test.ts` — engine metadata; OptionsPanel + StagingArea declared; validate cases (empty array, all-supported, one unsupported, mixed-supported HEIC+PNG). 6 tests.
- `src/engines/image-to-pdf/options-panel.test.tsx` — renders, paper-size change calls onChange. 3 tests.
- `src/engines/image-to-pdf/staging-area.test.tsx` — renders rows, ↑/↓ reorders, × removes, page numbers update on reorder, decoder failure produces placeholder thumb. 6 tests. (Mock the decoder.)
- `src/engines/image-convert/index.test.ts` — UPDATED: validate accepts HEIC (one new case).
- `src/components/tool-frame.test.tsx` — extends with: multi-cardinality renders StagingArea, Convert button gates on stagedFiles.length and ready, button calls run with stagedFiles. 3 new tests on top of Plan 2's existing.
- `src/lib/handoff.test.ts` — UPDATED: tests for the new `File[]` API. 3 tests (was 3, count unchanged but content rewritten).

Net unit test impact: +22 new, ~3 rewritten, total expected ~92 (was 70 on main).

### 13.2 E2E tests

New:

- `tests/e2e/image-to-pdf.spec.ts`:
  - Test 1 — happy path: drop 3 mixed-format files (PNG + JPEG + WebP), reorder one via ↑, click Convert, assert PDF download (`%PDF-` magic bytes), assert ≥3 pages embedded.
  - Test 2 — HEIC input: drop sample.heic + sample.png, click Convert, assert PDF download. Validates the shared decoder path.
- `tests/e2e/privacy-regression-image-to-pdf.spec.ts`: real multi-image conversion (PNG + HEIC, to exercise the lazy libheif load path), assert zero off-origin.
- `tests/e2e/multi-file-handoff.spec.ts`: drop 3 PNGs on `/`, expect navigation to `/tools/image-to-pdf` with files staged in the StagingArea, click Convert, assert PDF download.

Modified:

- `tests/e2e/image-convert.spec.ts` — append a HEIC → PNG test (drop sample.heic, pick PNG, download, assert PNG signature). Validates the consolidated HEIC path.
- `tests/e2e/privacy-regression-image-convert.spec.ts` — append a HEIC → PNG conversion case to the listener-watching window.
- `tests/e2e/homepage-handoff.spec.ts` — UPDATE: HEIC test now expects `/tools/image-convert` URL. ADD: multi-image-handoff test (drop 3 PNGs, expect /tools/image-to-pdf).

Deleted:

- `tests/e2e/heic-to-png.spec.ts` — coverage migrates to extended image-convert spec.
- `tests/e2e/privacy-regression-heic.spec.ts` — coverage migrates to extended image-convert privacy spec.

Net E2E spec count: 8 → 9 (added image-to-pdf + privacy-image-to-pdf + multi-file-handoff = +3; deleted heic-to-png + privacy-heic = -2; modified specs stay at 1 each).

### 13.3 Test fixtures

No new fixtures required. Existing fixtures (Plan 2 + Plan 1) suffice:

- `tests/fixtures/sample.heic` (Plan 1, 130 KB) — HEIC input for image-convert and image-to-pdf
- `tests/fixtures/sample.png` (Plan 2, 1.3 KB) — PNG input
- `tests/fixtures/sample-alpha.png` (Plan 2, 1.4 KB) — alpha PNG
- `tests/fixtures/sample.jpg` (Plan 2, 1.2 KB) — JPEG input
- `tests/fixtures/sample-rotated.jpg` (Plan 2, 1.3 KB) — EXIF-rotated JPEG
- `tests/fixtures/sample.webp` (Plan 2, 386 B) — WebP input

### 13.4 Pixel correctness

- The shared decoder's HEIC path produces the same RGBA bytes as Plan 1's HEIC engine did. The image-convert + HEIC-input E2E test should produce a PNG visually equivalent to Plan 1's output. Asserted by PNG signature + non-zero size; full pixel comparison is fragile across browsers and not worth the test complexity.
- The image-to-pdf output is a PDF; the most we assert is `%PDF-` magic bytes and a sensible byte count. Visual correctness (image actually appears on the page) is verified by manual QA during Chrome QA workflow.

## 14. Edge cases / known limitations

- **Empty staging.** Convert button disabled. User cannot trigger a no-op conversion.
- **Single-file drop on `/tools/image-to-pdf`.** Staging gets one file. Convert produces a one-page PDF. Valid use case.
- **Reorder while conversion in flight.** ToolFrame's run is async. If the user reorders during conversion, the StagingArea's onChange fires but stagedFiles is decoupled from the in-flight run (which captured the file list at click time). No race. Re-clicking Convert after re-order is fine — second click triggers a new run.
- **Drop while conversion in flight.** Pre-existing race from Plan 1 (carried over): ToolFrame's run fires regardless. Concurrent runs may interleave. Documented; not addressed in this plan. Phase 6 hardening backlog.
- **Same file dropped twice.** The staging area accepts duplicates (each File reference is distinct even if name matches). User can add the same image twice for a "two-page" effect; not blocked.
- **Very large PDF outputs.** No size cap. A 50-image conversion at high-res could produce a 500 MB PDF that crashes the tab. v1 ships without limits; future plan adds caps per spec §11.1.
- **Animated WebP / GIF**: animated inputs produce a single first-frame static page (consistent with image-convert from Plan 2). Documented limitation.
- **EXIF Orientation only** is preserved across the shared decoder. Other EXIF (GPS, datetime, camera) is stripped — privacy positive.
- **HEIC → PDF with libheif failing** (malformed file): worker throws, conversion aborts with an error message identifying which file failed (by name, in the error string). User removes from staging and retries.
- **Bookmarked `/tools/heic-to-png` URL** post-consolidation: 404 (or Next.js's "page not found"). Acceptable break — tracked in §16 if we want a redirect later.

## 15. Plan structure (preview)

The implementation plan that follows this spec will be sequenced roughly:

1. Shared `_shared/decode-image.ts` + tests.
2. Refactor `image-convert` worker to use the shared decoder; extend its `inputAccept`/`inputMime`/`validate` for HEIC.
3. Update Plan 2's `image-convert.spec.ts` (HEIC case) + `privacy-regression-image-convert.spec.ts` (HEIC case).
4. Delete the HEIC engine, route, sidebar entry; update registry; update homepage routing.
5. Delete `tests/e2e/heic-to-png.spec.ts` and `tests/e2e/privacy-regression-heic.spec.ts`. Update `homepage-handoff.spec.ts` HEIC test.
6. Migrate `handoff.ts` from `File | null` → `File[]` API; update `page.tsx` and `tool-frame.tsx` callsites; update `handoff.test.ts`.
7. Extend engine type system: `StagingArea?` field on MultiInputEngine + `StagingAreaProps` helper.
8. ToolFrame multi-cardinality plumbing: stagedFiles state, append-on-drop for multi engines, render StagingArea, Convert button, watcher for multi-engine handoff.
9. Install `pdf-lib`. Add `src/engines/image-to-pdf/options.ts`.
10. `image-to-pdf` worker: pdf-lib pipeline, decode + embed + page sizing.
11. `image-to-pdf` OptionsPanel + StagingArea components + tests.
12. `image-to-pdf` engine descriptor + registry entry + index.test.
13. `image-to-pdf` route page + sidebar entry.
14. New E2E specs (image-to-pdf, privacy-image-to-pdf, multi-file-handoff).
15. Final regression sweep + commit + PR.

Estimated 13–15 tasks. Substantive (architecture-touching) tasks: 1, 6, 7, 8, 10. Mechanical tasks: 2–5, 9, 11–15.

## 16. Future scope

Captured in master spec §16 over time:

- **Generic engine chaining infrastructure** (C2/C3 from brainstorming): declarative engine pipelines, runtime resolver that chains engines based on input MIME requirements. Replaces the per-engine "shared decoder" pattern with first-class composition.
- **Per-image fit/fill/crop options** for image-to-pdf.
- **Custom margins, custom page sizes, per-page orientation override.**
- **Output filename input field.**
- **JPEG embedding branch** in the worker (smaller PDFs for photo-heavy inputs).
- **Drag-and-drop reordering** via HTML5 DnD or `dnd-kit` (replace ↑↓ buttons).
- **Bulk staging optimization**: defer thumbnail decode for files beyond the visible window (virtualized list at e.g. >50 files).
- **PDF metadata customization** (title, author, subject, keywords).
- **Page-size budget** for very-large-image guards in the engine `validate`.
- **Redirect** for the deleted `/tools/heic-to-png` route (Next.js redirects config or a thin redirect page) — for users with bookmarks.
- **Multi-page-PDF input → image extraction** (different engine; Plan 5+).

## 17. Success criteria

This plan is done when:

1. A user can navigate to `/tools/image-to-pdf`, drop multiple HEIC/PNG/JPEG/WebP files, reorder via ↑↓, remove via ×, click Convert, and download a single PDF combining all pages.
2. The cross-route handoff works: drop 2+ images on `/` → navigate to `/tools/image-to-pdf` with files staged → user clicks Convert → PDF downloads.
3. Image-convert accepts HEIC inputs end-to-end. Drop HEIC on `/` → navigate to `/tools/image-convert` → pick PNG/JPEG/WebP → conversion runs.
4. The dedicated HEIC engine is gone: no `/tools/heic-to-png`, no `heic→png` sidebar entry, no `src/engines/heic-to-png/` directory.
5. `pnpm typecheck && pnpm lint && pnpm test && pnpm build` exit 0.
6. All E2E specs pass on chromium locally and against the deployed URL (with `--workers=1` to avoid the libheif cold-start race).
7. Privacy regression confirms zero off-origin requests during real multi-image conversion (including HEIC input).
8. CI green on the PR.
