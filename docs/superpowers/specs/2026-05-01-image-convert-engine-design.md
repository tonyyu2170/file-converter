# Image-convert engine — design / spec

Plan 2 of the file_converter roadmap. A single generic `image-convert` engine that handles all combinations of PNG / JPEG / WebP. This document is the brainstorm-validated design, source of truth for the implementation plan.

## 1. Scope

One engine, one route (`/tools/image-convert`), nine valid input→output combinations (every pairing of PNG / JPEG / WebP including same-format roundtrips). Same-format roundtrips are intentionally allowed — they let users re-encode JPEGs at lower quality or strip metadata from PNGs.

## 2. Out of scope (this plan)

- Other input formats (GIF, BMP, TIFF, AVIF, HEIC). HEIC has its own dedicated engine; the rest are deferred or non-goals.
- Resizing, cropping, rotation. Pure format conversion only.
- Animated WebP frame-by-frame conversion. Animated WebP inputs silently produce a single static first-frame output. Limitation documented; no runtime warning.
- ICC color management. Browser canvas flattens to sRGB.
- EXIF preservation beyond orientation. Orientation auto-applied to pixels; remaining EXIF (GPS, datetime, camera info) discarded — privacy positive.
- Quality control beyond a single 0.1–1.0 slider for JPEG/WebP output.

## 3. Architecture

### 3.1 Engine pattern extension

The shared `SingleInputEngine<TOpts, TOut>` type gains two optional fields, used here for the first time but available to any future engine:

```ts
type SingleInputEngine<TOpts, TOut> = ... & {
  isReadyToConvert?: (opts: TOpts) => boolean;
  OptionsPanel?: ComponentType<{
    value: TOpts;
    onChange: (next: TOpts) => void;
  }>;
};
```

Engines without options (HEIC) omit both fields. ToolFrame defaults `ready` to `true` and renders no panel slot when `OptionsPanel` is undefined.

### 3.2 Library / runtime

- **Decode**: `createImageBitmap(file, { imageOrientation: "from-image" })` inside the worker. Browser-native, zero new dependencies. The `imageOrientation: "from-image"` option auto-applies EXIF orientation to the pixel data, then the bitmap has no metadata. Supported in Chrome 80+, Firefox 77+, Safari 15+ (well within our browser support matrix).
- **Encode**: `OffscreenCanvas.convertToBlob({ type, quality })`. Quality applied for `image/jpeg` and `image/webp` only — PNG ignores it (lossless format).
- **Worker scaffold**: mirrors `src/engines/heic-to-png/worker.ts` exactly. Comlink-exposed `convertSingle(bytes, name, type, opts) → OutputItem`.

### 3.3 Alpha-on-JPEG handling

When the input has an alpha channel (PNG or WebP) and the output is JPEG, the worker draws onto an opaque white-filled canvas before encoding. Background color is fixed (white) — not user-configurable in v1. Power-user color picker is deferred.

```ts
ctx.fillStyle = "#ffffff";
ctx.fillRect(0, 0, w, h);
ctx.drawImage(bitmap, 0, 0);
const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
```

For PNG and WebP outputs, the canvas is left transparent and `drawImage` happens directly.

## 4. Options surface

```ts
type ImageConvertOutputFormat = "png" | "jpeg" | "webp";

type ImageConvertOptions = {
  output: ImageConvertOutputFormat | null;  // null until user selects
  quality: number;                          // 0.1–1.0
};

const defaultImageConvertOptions: ImageConvertOptions = {
  output: null,
  quality: 0.9,
};
```

- `output` is required (`null` is the unset state). The engine declares `isReadyToConvert: (opts) => opts.output !== null`. ToolFrame disables the DropZone until ready.
- `quality` defaults to 0.9. Slider range 0.1–1.0 (step 0.05). Slider hides in the UI when `output === "png"` (lossless, parameter has no effect).

## 5. UI

### 5.1 OptionsPanel

A small client component rendered by ToolFrame above the DropZone. Two controls:

- A `<select>` for output format. Placeholder option: "Output format". Three real options labeled `PNG`, `JPEG`, `WEBP`.
- A `<input type="range">` for quality, hidden when `output === "png"`. Visible value display next to the slider (e.g., `quality: 0.90`).

Styling matches the brutalist aesthetic: hairline borders, mono font, accent-colored selected states. No gradients, no rounded corners.

### 5.2 ToolFrame extensions

```tsx
const [options, setOptions] = useState(engine.defaultOptions);
const Panel = engine.OptionsPanel;
const ready = engine.isReadyToConvert?.(options) ?? true;

return (
  <main>
    <header>tool: {engine.id} · <StatusIndicator/></header>
    {Panel && <Panel value={options} onChange={setOptions} />}
    <DropZone disabled={!ready} onFiles={(files) => run(files, options)} ... />
    <ResultList items={items} />
  </main>
);
```

- The `run` function signature changes from `(files: File[]) → void` to `(files: File[], opts: TOpts) → void`. Existing HEIC engine adapts trivially (HEIC's options are `{}`).
- Cross-route handoff: ToolFrame's existing `useEffect(takeStagedFile)` consumes the staged file on mount. If `ready` is true, conversion runs immediately. If not (image-convert with no format selected yet), the staged file is held in component state; conversion fires once `ready` becomes true (i.e., the user picks a format). Implementation: a separate `useEffect` watches `ready` AND `pendingFile`, fires `run([pendingFile], options)` and clears `pendingFile`.

### 5.3 DropZone extension

A new optional `disabled?: boolean` prop. When true:
- Visual: muted styling (lower opacity, neutral border, prompt reads "drop a file" but visually de-emphasized).
- Behavior: all event handlers (`onClick`, `onDragOver`, `onDrop`, input `onChange`) no-op. `onDragOver` still calls `preventDefault()` to prevent the browser opening dropped content in the tab.

A new test in `drop-zone.test.tsx` covers the disabled state: prompt renders, `data-state="disabled"` is set, dropping a file does NOT call `onFiles`.

## 6. Validation

```ts
async validate(file: File, _opts: ImageConvertOptions): Promise<ValidationResult> {
  const mime = await detectMime(file);
  if (mime === "image/png" || mime === "image/jpeg" || mime === "image/webp") {
    return { ok: true };
  }
  return { ok: false, reason: "Expected a PNG, JPEG, or WebP file" };
}
```

Magic-byte check via the existing `detectMime` utility. Filename extension is not sufficient — a user-renamed `.txt` containing PNG bytes still works; a `.png` file containing actual text fails. This matches the HEIC engine's posture.

## 7. Output

### 7.1 Filename convention

Reuses `_shared/filename.ts`'s `replaceExtension`. Extension mapping:

| Output | Extension | MIME |
|---|---|---|
| PNG | `.png` | `image/png` |
| JPEG | `.jpg` | `image/jpeg` |
| WebP | `.webp` | `image/webp` |

JPEG uses `.jpg` (more common in practice) rather than `.jpeg`.

### 7.2 OutputItem shape

```ts
{
  filename: replaceExtension(input.name, EXT_MAP[opts.output!]),
  mime: MIME_MAP[opts.output!],
  blob: <encoded blob from convertToBlob>,
}
```

Single-output engine; ResultList renders one row with a manual download button (auto-download was removed in Plan 1).

## 8. Registry / routing

### 8.1 Registry extension

```ts
// src/engines/_shared/registry.ts
export type EngineId = "heic-to-png" | "image-convert";

const REGISTRY: Record<EngineId, Loader> = {
  "heic-to-png": () => import("@/engines/heic-to-png"),
  "image-convert": () => import("@/engines/image-convert"),
};
```

### 8.2 Homepage MIME-detect routing

`src/app/page.tsx`'s `handleFiles` extends to recognize the new MIME types:

```ts
if (mime === "image/heic" || mime === "image/heif") {
  stageFile(f);
  router.push("/tools/heic-to-png");
  return;
}
if (mime === "image/png" || mime === "image/jpeg" || mime === "image/webp") {
  stageFile(f);
  router.push("/tools/image-convert");
  return;
}
setError("No tool for this file type yet. Phase 1 ships HEIC + image-convert only.");
```

The error-banner copy updates to reflect Plan 2's expanded support.

### 8.3 Sidebar entry

`src/components/layout/sidebar.tsx`'s `TOOLS` array gains a second entry:

```ts
const TOOLS: ToolEntry[] = [
  { id: "heic-to-png", href: "/tools/heic-to-png", label: "heic→png", group: "IMAGES" },
  { id: "image-convert", href: "/tools/image-convert", label: "image convert", group: "IMAGES" },
];
```

## 9. Privacy

Same posture as HEIC: worker-only conversion, no `fetch` / `XHR` in the engine code path, enforced by Biome's `no-restricted-globals` rule (already in place under `src/engines/`). The new privacy regression spec (`tests/e2e/privacy-regression-image-convert.spec.ts`) drives a real conversion and asserts zero off-origin requests / WebSockets — same listener pattern as `privacy-regression-heic.spec.ts`. WebSocket assertion uses the host-comparison fix from PR #2.

## 10. Testing strategy

### 10.1 Unit tests

- `src/engines/image-convert/index.test.ts` — engine metadata (id, cardinality, accept lists, mime types), `validate` happy path and error path.
- `src/engines/image-convert/options-panel.test.tsx` — renders, format change calls `onChange`, quality slider calls `onChange`, slider hidden when `output === "png"`.
- `src/components/drop-zone.test.tsx` — extends with: `disabled` prop renders muted state, drop / click events no-op when disabled.
- `src/components/tool-frame.test.tsx` (new) — covers the cardinality-validation-error path that's still uncovered; also covers `ready` gate (panel renders, DropZone disabled when `isReadyToConvert` returns false). This was a deferred item from Plan 1.

### 10.2 E2E tests

- `tests/e2e/image-convert.spec.ts` — JPEG fixture → pick PNG output → drop → click download → assert PNG signature bytes. Same shape as `heic-to-png.spec.ts`.
- `tests/e2e/privacy-regression-image-convert.spec.ts` — same listener pattern as `privacy-regression-heic.spec.ts`, real conversion, zero off-origin assertion.
- `tests/e2e/homepage-handoff.spec.ts` extends to cover image-convert: drop a JPEG on `/`, expect navigation to `/tools/image-convert`, file held until format selected (reasonably exercised by selecting PNG and asserting conversion fires after the selection — covers the "staged-file-waiting-for-options-ready" branch).

### 10.3 Test fixtures

Commit small (~50 KB each) sample files to `tests/fixtures/`:

- `sample.png` — opaque, mid-complexity (suitable for JPEG re-encode without alpha-fill).
- `sample-alpha.png` — transparent (covers the alpha-on-JPEG fill path).
- `sample.jpg` — opaque.
- `sample.jpg` with EXIF orientation tag set to non-1 (covers the auto-rotate path) — could be the same fixture or a separate `sample-rotated.jpg`.
- `sample.webp` — opaque.

Acquisition: small fixtures can be hand-crafted via macOS Preview / `convert` tooling. Plan task documents specific commands.

### 10.4 Pixel correctness

The EXIF-orientation auto-rotate path is the most behavior-sensitive piece (off-by-one on the orientation tag rotates the image incorrectly). Test asserts the OUTPUT image's pixel dimensions match the EXPECTED orientation (e.g., a 200x300 portrait input that's stored as 300x200 with orientation=6 should produce 200x300 output). Not byte-equality — that's browser-dependent for JPEG. Use `createImageBitmap` on the output blob in the test and check `width`/`height`.

## 11. Edge cases / known limitations

- **Animated WebP** → static first frame. Documented; no runtime warning.
- **CMYK JPEGs** → undefined behavior. Browsers handle these inconsistently; fixture excluded from v1.
- **Embedded ICC profiles** → flattened to sRGB. Displayed colors will shift slightly for wide-gamut inputs.
- **Very large images** (>100 MP) → may hit OffscreenCanvas size limits or crash the tab. v1 ships without a size cap; future plan adds one per spec §11.1.
- **Same-format quality=1.0** → JPEG→JPEG at quality 1.0 still re-encodes (any quality ≠ 100% literal lossless). Document as an expected outcome of the "always re-encode" approach, not a bug.

## 12. Future scope

These are explicitly NOT in this plan but worth noting for the roadmap:

- **Background removal engine** (`bg-remove`): in-browser ML segmentation (e.g., MediaPipe Selfie Segmentation, ~10 MB model). Single-input PNG/JPEG/WebP → PNG with alpha. Privacy-compatible only if model loads same-origin.
- **Watermark removal engine** (`watermark-remove`): in-browser inpainting model. Larger model files, harder problem, longer runtime. Same privacy constraint.
- **Image upscaling** (`upscale` or per-model-named): browser-side super-resolution model. Same gating concerns.
- **Resize / crop**: deterministic non-ML transforms. Could be options on `image-convert` (`width`, `height`, `resampling`) or a separate engine.
- **Quality preset buttons** alongside the slider ("high / balanced / small file").
- **Custom alpha-on-JPEG background color** as a power-user option.
- **EXIF preservation toggle** (currently always-strip is the privacy-positive default).
- **Bulk conversion** (drop multiple files, get a ZIP of converted outputs). Requires multi-input cardinality work that arrives in Plans 3 + 4.

These are tracked in master spec §16 (post-v1 future scope).

## 13. Plan structure (preview)

The implementation plan that follows this spec will be sequenced roughly:

1. Extend shared types (`SingleInputEngine` + `OptionsPanel` + `isReadyToConvert`).
2. Extend `DropZone` with `disabled` prop + test.
3. Engine module: `options.ts`, `worker.ts`, `index.ts`, `options-panel.tsx`.
4. Engine unit tests + fixtures.
5. ToolFrame extension (panel slot, ready gate, options state, run signature).
6. ToolFrame unit test (deferred from Plan 1, included here).
7. Registry + homepage routing + sidebar extension.
8. E2E happy-path spec.
9. E2E privacy regression spec.
10. CI green; merge.

Estimated 8–10 tasks. Substantive (architecture-touching) tasks: 1, 5, 6 — full two-stage review. Mechanical extensions: combined opus review.

## 14. Success criteria

This plan is done when:

1. A user can navigate to `/tools/image-convert`, select an output format, drop a PNG/JPEG/WebP file, and download a correctly-formatted output.
2. The cross-route handoff works: drop on `/` for any of the three formats lands on `/tools/image-convert` and converts (after format selection) without a second drop.
3. The HEIC engine continues to work unchanged — the engine-pattern extensions are backward-compatible.
4. `pnpm typecheck && pnpm lint && pnpm test && pnpm build` exit 0.
5. All E2E specs pass on chromium locally and against the deployed URL.
6. Privacy regression confirms zero off-origin requests during a real PNG↔JPEG↔WebP conversion.
7. CI green on the PR.
