# PDF Split + PDF → image — design (Plans 5 & 6)

**Status:** approved 2026-05-02
**Owner:** Tony Yu
**Predecessors:** Plan 4 (pdf-merge + dnd-kit retrofit, merged at `62a4cb4`); master spec `2026-04-30-file-converter-design.md` §5.2 (PDFs catalog), §6.1 (architecture, names `client-zip` as the planned ZIP library)
**Successors:** Plan 5 (PDF Split + multi-output infrastructure), Plan 6 (PDF → image)

## 0. Goal

Ship two single-input, multi-output PDF utilities and the shared infrastructure that lets ResultList offer batch ZIP downloads:

- **PDF Split**: drop a PDF, type `1-3, 5, 7-`, get one downloadable PDF per range token (3 PDFs in this example) plus a "Download all as ZIP" button.
- **PDF → image**: drop a PDF, choose PNG or JPEG, choose DPI (72/150/300), click Convert, get one image per page plus the same ZIP affordance.

Privacy invariant unchanged — every byte stays in the browser. New libraries (`client-zip`, no others) get covered by the existing privacy E2E pattern.

This spec drives **two plans**:
- **Plan 5** ships PDF Split alongside the shared multi-output infrastructure (ResultList ZIP button, `_shared/zip.ts`, `archiveSuffix` field on `EngineMeta`, range.ts promotion to `_shared/`).
- **Plan 6** ships PDF → image and reuses the infrastructure from Plan 5. Promotes `render-thumbnail.ts` to `_shared/pdf-js.ts` so both pdf-merge's StagingArea and pdf-image's worker share the lazy pdf.js loader.

## 1. Scope

### 1.1 PDF Split engine (Plan 5)
- New folder `src/engines/pdf-split/` with `SingleInputEngine<PdfSplitOptions, OutputItem[]>`.
- Inputs: one `application/pdf` file. Output: N PDFs, one per range token.
- OptionsPanel: single text input for Acrobat-syntax page ranges (placeholder `e.g. 1-3, 5, 7-`). Inline syntax error.
- Range syntax = exact reuse of Plan 4's `parseRange`. Empty input is rejected at the engine layer (`isReadyToConvert` returns false), because Split with all pages produces a single output identical to the input.
- Per-token filenames: `pages-N-M.pdf` (multi-page) or `page-N.pdf` (single page) using the **resolved** indices (open-ended `7-` becomes `pages-7-10.pdf` for a 10-page input). Filename collisions on duplicate tokens get `-2`, `-3`, … suffixes (`pages-1-3.pdf`, `pages-1-3-2.pdf`).
- Bound checks happen in the worker (after `PDFDocument.load`) since the OptionsPanel can't see pageCount without a staging step. Bounds errors throw with a clear message; ToolFrame's existing error banner surfaces them.

### 1.2 PDF → image engine (Plan 6)
- New folder `src/engines/pdf-image/` with `SingleInputEngine<PdfImageOptions, OutputItem[]>`.
- Inputs: one `application/pdf` file. Output: N images, one per page.
- OptionsPanel: format radio (PNG / JPEG), DPI `<select>` (72 Screen / 150 Standard / 300 Print), JPEG quality slider (60–95, default 85, **conditionally rendered** when format = jpeg).
- Default options (`png`, 150 DPI) produce sensible output without configuration; `isReadyToConvert` is undefined (engine harness defaults to `true`).
- Filenames: `page-001.png` / `page-001.jpg` etc., zero-padded to 3 digits (handles up to 999 pages without re-sort).
- Encrypted PDFs throw at the worker's `getDocument` step (`PasswordException`); ToolFrame surfaces in the error banner.

### 1.3 Multi-output download infrastructure (Plan 5, reused by Plan 6)
- New `src/engines/_shared/zip.ts` exporting `buildZipBlob(items, archiveName)` that lazy-loads `client-zip` and returns `{ filename, blob }`.
- `src/components/result-list.tsx` gains a `[ download all (N) as zip ]` button rendered only when `items.length > 1`. Reads the engine's `archiveSuffix` (new optional `EngineMeta` field) to compute the archive name as `<originalBasename><archiveSuffix>.zip`.
- The original input filename is plumbed into ResultList from ToolFrame as a new optional `archiveBasename` prop (defaulting to `"output"` when absent — single-cardinality engines pass `inputFile.name` stripped of extension).

### 1.4 Range parser promotion (Plan 5)
- Move `src/engines/pdf-merge/range.ts` (+ tests) to `src/engines/_shared/range.ts`. Update pdf-merge's import path. No semantic change to existing `parseRange`.
- Add new export `parseRangeTokens(input, pageCount): RangeTokensResult` that retains per-token grouping (each token preserves its `original` text and `indices: number[]`). Used by pdf-split's worker so each token becomes a separate output PDF. pdf-merge keeps using `parseRange` since it concatenates indices into one merged stream.

### 1.5 pdf.js loader promotion (Plan 6)
- Move/refactor `src/engines/pdf-merge/render-thumbnail.ts` so the lazy pdf.js loader is exported from a shared module: `src/engines/_shared/pdf-js.ts` exports `loadPdfJs(): Promise<typeof import("pdfjs-dist")>` with the worker URL configured once. Both pdf-merge's StagingArea (thumbnail render) and pdf-image's worker (full-page render) consume it.
- Module-level promise cache and `workerConfigured` flag stay; behavior is identical, just lifted.

### 1.6 Sidebar
- The `PDFS` group already exists from Plan 4. Plan 5 adds a `split` entry; Plan 6 adds an `image` entry. Both go in the existing PDFS group, after `merge`.

## 2. Out of scope (deferred / future)

- **Split modes other than range expressions.** Acrobat offers split-every-N-pages, split-at-bookmarks, split-into-equal-parts. Master spec §5.2 names only "page range expressions"; YAGNI for v1.
- **PDF → image format other than PNG / JPEG.** WebP, AVIF, etc. could come later via canvas's `convertToBlob`; v1 ships the spec-listed pair.
- **DPI slider with arbitrary value.** v1 uses 3 presets (72/150/300). 600+ DPI risks producing hundreds of MB silently; if needed, expose later with a memory-aware UI guard.
- **Streaming ZIP download.** `client-zip` supports streaming via `Response.body`, but using it requires File System Access API (Chrome-only) or a streaming-aware download helper. v1 materializes the ZIP blob in memory. For 50-page PDFs at 300 DPI (~150 MB total), this is acceptable; for very large outputs the user can choose individual downloads.
- **JPEG quality presets.** Slider only (60–95) covers 95% of users. Adding `Low / Medium / High` named presets is a Phase 6 polish.
- **Per-page bookmark / outline preservation across Split.** Same pdf-lib limitation as pdf-merge — `copyPages` doesn't carry these. Phase 6 backlog.
- **Per-token output filename customization.** Use the generated `pages-N-M.pdf` pattern.
- **OCR / text extraction from images.** Out of project scope entirely.

## 3. Architecture

### 3.1 Engine pattern reuse

Both engines are `SingleInputEngine<TOptions, OutputItem[]>` per Plan 1's type. ToolFrame's single-cardinality path already handles `OutputItem | OutputItem[]` via `Array.isArray(result)` narrowing — no engine type-system changes are required to ship multi-output. The narrowing was added in Plan 2 (image-convert wraps single-element arrays); v1 of Plan 5/6 produces N elements directly.

### 3.2 EngineMeta extension — `archiveSuffix`

```typescript
// src/engines/_shared/types.ts (existing file, additive change)
export type EngineMeta<TOptions> = {
  id: string;
  inputAccept: string[];
  inputMime: string[];
  outputMime: string;
  defaultOptions: TOptions;
  convertButtonLabel?: string;
  archiveSuffix?: string;      // NEW: e.g. "-split" → archive named "<basename>-split.zip"
};
```

Plan 4 added `convertButtonLabel?` as the precedent. `archiveSuffix?` follows the same pattern.

ResultList reads `archiveSuffix` (passed through from ToolFrame) when computing the ZIP filename. When absent, the archive falls back to `output.zip`. Engines that produce single outputs don't need to set it.

### 3.3 ResultList changes

```tsx
// src/components/result-list.tsx (modified)
type Props = {
  items: OutputItem[];
  archiveBasename?: string;     // e.g. "myfile" (no extension)
  archiveSuffix?: string;       // e.g. "-split"
};

export function ResultList({ items, archiveBasename, archiveSuffix }: Props) {
  if (items.length === 0) return null;

  async function handleDownloadAllAsZip() {
    const { buildZipBlob } = await import("@/engines/_shared/zip");
    const archiveName = `${archiveBasename ?? "output"}${archiveSuffix ?? ""}.zip`;
    const { filename, blob } = await buildZipBlob(items, archiveName);
    download(blob, filename);
  }

  return (
    <ul ...>
      {items.length > 1 && (
        <li className="...border-b...">
          <button
            type="button"
            data-testid="download-all-zip"
            onClick={handleDownloadAllAsZip}
            ...
          >
            [ download all ({items.length}) as zip ]
          </button>
        </li>
      )}
      {items.map((item) => (
        // existing per-row download button
      ))}
    </ul>
  );
}
```

The download-all button is a list item (semantics: it's part of the result list) styled distinctly via the layout. `aria-live="polite"` on the existing `<ul>` lets screen readers announce when results land.

### 3.4 ToolFrame changes

Single edit — pass two new optional props to ResultList:

```tsx
<ResultList
  items={items}
  archiveBasename={inputFile?.name?.replace(/\.[^.]+$/, "") ?? undefined}
  archiveSuffix={engine.archiveSuffix}
/>
```

For multi-cardinality engines, derive `archiveBasename` from the first staged file (or omit entirely — Plan 4 currently has no multi-output multi-cardinality engine). Single-cardinality engines pass the converted file's basename. ToolFrame already tracks the staged file(s) in state.

### 3.5 `_shared/zip.ts`

```typescript
// src/engines/_shared/zip.ts
import type { OutputItem } from "./types";

let clientZipModulePromise: Promise<typeof import("client-zip")> | undefined;

async function loadClientZip() {
  if (!clientZipModulePromise) clientZipModulePromise = import("client-zip");
  return clientZipModulePromise;
}

export async function buildZipBlob(
  items: ReadonlyArray<OutputItem>,
  archiveName: string,
): Promise<{ filename: string; blob: Blob }> {
  if (items.length === 0) throw new Error("buildZipBlob: items is empty");
  const lib = await loadClientZip();
  const entries = items.map((it) => ({ name: it.filename, input: it.blob }));
  const response = lib.downloadZip(entries);
  const blob = await response.blob();
  return { filename: archiveName, blob };
}
```

`client-zip`'s `downloadZip` returns a streaming `Response`; we materialize to a Blob for the v1 download path. Module-level promise cache mirrors the libheif and pdf.js loaders.

### 3.6 Range parser promotion

Plan 5 Task list:
1. `git mv src/engines/pdf-merge/range.ts src/engines/_shared/range.ts`
2. `git mv src/engines/pdf-merge/range.test.ts src/engines/_shared/range.test.ts`
3. Update import in `src/engines/pdf-merge/staging-area.tsx` from `./range` to `@/engines/_shared/range`.
4. Add `parseRangeTokens(input, pageCount): RangeTokensResult` to the same file:

```typescript
export type RangeTokensResult =
  | { ok: true; tokens: Array<{ original: string; indices: number[] }> }
  | { ok: false; reason: string };

export function parseRangeTokens(input: string, pageCount: number): RangeTokensResult;
```

Behavior:
- Empty input → `{ ok: true, tokens: [] }`. (NOT `[{indices: [0..n-1]}]` — empty input means "no tokens", and the engine's `isReadyToConvert` is the gate that prevents it from reaching here.)
- Whitespace-only → same as empty (`tokens: []`).
- Otherwise: split on commas, each token preserves its trimmed original text; indices computed via the same per-token logic as `parseRange`. First failed token short-circuits with its reason.

The existing `parseRange` continues to work — internally it can call `parseRangeTokens` and flatten:

```typescript
export function parseRange(input: string, pageCount: number): RangeParseResult {
  if (input.trim() === "") {
    return { ok: true, indices: Array.from({ length: pageCount }, (_, i) => i) };
  }
  const result = parseRangeTokens(input, pageCount);
  if (!result.ok) return result;
  const indices: number[] = [];
  for (const t of result.tokens) indices.push(...t.indices);
  return { ok: true, indices };
}
```

Note the asymmetry: `parseRange` treats empty as "all pages" (legacy pdf-merge behavior). `parseRangeTokens` treats empty as "no tokens". This is intentional — the two callers have different needs and the asymmetry is small enough to live with.

### 3.7 pdf.js loader promotion (Plan 6)

`src/engines/_shared/pdf-js.ts`:

```typescript
let pdfJsModulePromise: Promise<typeof import("pdfjs-dist")> | undefined;
let workerConfigured = false;

export async function loadPdfJs(): Promise<typeof import("pdfjs-dist")> {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("pdfjs-dist");
  }
  const lib = await pdfJsModulePromise;
  if (!workerConfigured) {
    lib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.mjs",
      import.meta.url,
    ).toString();
    workerConfigured = true;
  }
  return lib;
}
```

`render-thumbnail.ts` becomes:
```typescript
import { loadPdfJs } from "@/engines/_shared/pdf-js";

export async function renderFirstPageThumbnail(bytes: ArrayBuffer, size: number): Promise<Blob> {
  const lib = await loadPdfJs();
  // ... existing render logic
}
```

The promotion is a refactor, not a new feature. Plan 6 Task 1 is "promote pdf.js loader; pdf-merge thumbnail still works". Run pdf-merge tests + E2E to confirm.

## 4. Options surface

### 4.1 PdfSplitOptions
```typescript
export type PdfSplitOptions = { rangeInput: string };
export const defaultPdfSplitOptions: PdfSplitOptions = { rangeInput: "" };
```

### 4.2 PdfImageOptions
```typescript
export type PdfImageFormat = "png" | "jpeg";
export type PdfImageDpi = 72 | 150 | 300;

export type PdfImageOptions = {
  format: PdfImageFormat;
  dpi: PdfImageDpi;
  jpegQuality: number;     // 60..95, only consulted when format === "jpeg"
};

export const defaultPdfImageOptions: PdfImageOptions = {
  format: "png",
  dpi: 150,
  jpegQuality: 85,
};
```

### 4.3 OptionsPanel components

**`pdf-split/options-panel.tsx`:**
- Single labeled `<input type="text">` with placeholder `e.g. 1-3, 5, 7-`.
- No client-side bounds validation (no pageCount until convert). Syntax-only validation via `parseRangeTokens(value, Number.MAX_SAFE_INTEGER)` to surface comma errors and bare-dash errors. (The high pageCount makes "exceeds N" never fire in the panel; bounds errors come from the worker.)
- Inline `data-testid="range-syntax-error"` span beneath the input on parse failure.

Engine `isReadyToConvert(opts)` returns `opts.rangeInput.trim().length > 0`. The Convert button is gated by this; a user with a valid empty-input panel sees Convert disabled.

**`pdf-image/options-panel.tsx`:**
- Format radio (`<input type="radio">` × 2 with `data-testid="format-png"` / `format-jpeg"`).
- DPI `<select>` with three options (`data-testid="dpi"`).
- JPEG quality `<input type="range" min=60 max=95>` rendered ONLY when `options.format === "jpeg"`. `data-testid="jpeg-quality"`. Live value display next to the slider.

## 5. Worker pipelines

### 5.1 PDF Split worker

```typescript
// src/engines/pdf-split/worker.ts
import * as Comlink from "comlink";
import { PDFDocument } from "pdf-lib";
import type { OutputItem } from "@/engines/_shared/types";
import { parseRangeTokens } from "@/engines/_shared/range";
import { planSplitFilenames } from "./filenames";
import type { PdfSplitOptions } from "./options";

const api = {
  async convertSingle(
    fileBytes: ArrayBuffer,
    fileName: string,
    fileType: string,
    opts: PdfSplitOptions,
  ): Promise<OutputItem[]> {
    const src = await PDFDocument.load(fileBytes);
    const pageCount = src.getPageCount();
    const tokens = parseRangeTokens(opts.rangeInput, pageCount);
    if (!tokens.ok) {
      throw new Error(`pdf-split: ${tokens.reason}`);
    }
    if (tokens.tokens.length === 0) {
      throw new Error("pdf-split: no range tokens (engine should have rejected via isReadyToConvert)");
    }

    const filenames = planSplitFilenames(tokens.tokens);

    const outputs: OutputItem[] = [];
    for (const [i, token] of tokens.tokens.entries()) {
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, token.indices);
      for (const page of copied) out.addPage(page);
      const pdfBytes = await out.save();
      outputs.push({
        filename: filenames[i] ?? `part-${i + 1}.pdf`,
        mime: "application/pdf",
        blob: new Blob([pdfBytes as BlobPart], { type: "application/pdf" }),
      });
    }
    return outputs;
  },
};

Comlink.expose(api);
```

Worker is structurally simple. The interesting logic is in `planSplitFilenames`.

### 5.2 PDF Split filename planner

```typescript
// src/engines/pdf-split/filenames.ts
export function planSplitFilenames(
  tokens: ReadonlyArray<{ original: string; indices: number[] }>,
): string[] {
  // First pass: generate base names from resolved indices
  const base = tokens.map((t) => {
    if (t.indices.length === 0) return "page-empty.pdf";
    if (t.indices.length === 1) return `page-${(t.indices[0] ?? 0) + 1}.pdf`;
    const start = (t.indices[0] ?? 0) + 1;
    const end = (t.indices[t.indices.length - 1] ?? 0) + 1;
    return `pages-${start}-${end}.pdf`;
  });

  // Second pass: collision suffixing
  const seen = new Map<string, number>();
  const final: string[] = [];
  for (const name of base) {
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    if (count === 0) {
      final.push(name);
    } else {
      const ext = name.endsWith(".pdf") ? ".pdf" : "";
      const stem = name.slice(0, name.length - ext.length);
      final.push(`${stem}-${count + 1}${ext}`);
    }
  }
  return final;
}
```

Pure function. Trivially testable.

### 5.3 PDF → image worker

```typescript
// src/engines/pdf-image/worker.ts
import * as Comlink from "comlink";
import type { OutputItem } from "@/engines/_shared/types";
import { loadPdfJs } from "@/engines/_shared/pdf-js";
import type { PdfImageOptions } from "./options";

const api = {
  async convertSingle(
    fileBytes: ArrayBuffer,
    fileName: string,
    fileType: string,
    opts: PdfImageOptions,
  ): Promise<OutputItem[]> {
    const lib = await loadPdfJs();
    const doc = await lib.getDocument({ data: fileBytes }).promise;
    try {
      const outputs: OutputItem[] = [];
      const scale = opts.dpi / 72;
      const pad = String(doc.numPages).length;
      const ext = opts.format === "jpeg" ? "jpg" : "png";
      const mime = opts.format === "jpeg" ? "image/jpeg" : "image/png";
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale });
        const canvas = new OffscreenCanvas(
          Math.max(1, Math.ceil(viewport.width)),
          Math.max(1, Math.ceil(viewport.height)),
        );
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");
        await page.render({
          canvasContext: ctx as unknown as CanvasRenderingContext2D,
          viewport,
          canvas: canvas as unknown as HTMLCanvasElement,
        }).promise;
        const blob = opts.format === "jpeg"
          ? await canvas.convertToBlob({ type: mime, quality: opts.jpegQuality / 100 })
          : await canvas.convertToBlob({ type: mime });
        outputs.push({
          filename: `page-${String(i).padStart(Math.max(3, pad), "0")}.${ext}`,
          mime,
          blob,
        });
      }
      return outputs;
    } finally {
      await doc.destroy();
    }
  },
};

Comlink.expose(api);
```

`Math.max(3, pad)` ensures at least 3 digits for typical inputs while supporting >999 pages naturally.

## 6. Validation rules

### 6.1 PDF Split engine
- `validate(file)`: PDF MIME or `.pdf` extension required; otherwise `{ok: false, reason: "Expected a PDF file"}`.
- `isReadyToConvert(opts)`: `opts.rangeInput.trim().length > 0`. Empty → Convert button disabled.
- Worker-side: out-of-bounds tokens, malformed input that escaped the panel, encrypted PDFs all throw with `pdf-split:` prefix; ToolFrame's error banner displays.

### 6.2 PDF → image engine
- `validate(file)`: same as Split.
- `isReadyToConvert`: undefined (defaults always valid).
- Worker-side: encrypted PDFs throw with `pdf-image:` prefix.

## 7. Privacy

Invariant unchanged. Both engines run in Web Workers; no `fetch` / `XHR` / WebSocket. New library `client-zip` is a build-time bundle, no network dependency. New E2E specs in each plan assert zero off-origin during conversion.

## 8. Testing

### 8.1 Plan 5 unit tests
- `_shared/zip.test.ts` — 3 tests: returns blob with right archive name, entries match input filenames, empty-items throws.
- `_shared/range.test.ts` — promoted from pdf-merge/range.test.ts; existing 41 tests carry over. Plus 6 new tests for `parseRangeTokens`: empty-input → no tokens, single token, multi-token, first-token-failure short-circuit, whitespace-only, asymmetric-vs-parseRange behavior on empty.
- `pdf-split/filenames.test.ts` — 10 tests: single page, closed range, open-ended (resolved), `-M` (resolved), single-token list, multi-token list, duplicate token collision, two-pair collision, `pages-1-1.pdf` (single-page closed range — degenerate, defer to single-page form `page-1.pdf`).
- `pdf-split/options-panel.test.tsx` — 3 tests: input renders + onChange fires + syntax error displays inline.
- `pdf-split/index.test.ts` — 5 tests: metadata, validate accept, validate reject, archiveSuffix === "-split", isReadyToConvert false on empty/whitespace and true on non-empty.
- ResultList test additions — 3 tests: hides ZIP button when items.length ≤ 1, shows count, button click invokes the zip helper (mock `buildZipBlob`).
- `_shared/registry.test.ts` — append `loadEngine("pdf-split")` positive-path test.

Approximate new unit count for Plan 5: **30**.

### 8.2 Plan 5 E2E
- `tests/e2e/pdf-split.spec.ts` — happy path: drop 5-page fixture, type `1-3, 5`, click Convert, assert ResultList shows 2 rows with `pages-1-3.pdf` and `page-5.pdf`, click "download all" button, assert ZIP download with name `<basename>-split.zip` containing both entries (verify by re-extracting via JSZip in the test, or by header bytes inspection).
- `tests/e2e/privacy-regression-pdf-split.spec.ts` — zero off-origin during a Split conversion.

### 8.3 Plan 6 unit tests
- `pdf-image/options-panel.test.tsx` — 5 tests: format radio renders, DPI select renders 3 options, JPEG quality slider hidden in PNG mode, slider visible in JPEG mode, slider onChange updates options.
- `pdf-image/index.test.ts` — 4 tests: metadata, validate accept/reject, archiveSuffix === "-images".
- `_shared/pdf-js.test.ts` — 2 tests: lazy-loads pdfjs-dist, configures workerSrc once (run twice, assert single configuration).
- `_shared/registry.test.ts` — append positive-path.

Approximate new unit count for Plan 6: **12**.

### 8.4 Plan 6 E2E
- `tests/e2e/pdf-image.spec.ts` — happy path: drop 5-page fixture, default options (PNG/150), convert, assert 5 rows in ResultList. Toggle to JPEG quality 70, re-convert, assert smaller blob sizes. Switch DPI to 300 (PNG), assert larger blobs vs 150-DPI baseline.
- `tests/e2e/privacy-regression-pdf-image.spec.ts` — zero off-origin during a → image conversion.

### 8.5 Worker correctness
- Plan 5: each downloaded ZIP entry starts with `%PDF-` magic.
- Plan 6: each entry starts with PNG magic (`89 50 4E 47`) or JPEG magic (`FF D8 FF`); pixel dimensions match the chosen DPI scale (allow ±2 px slack for ceiling).

### 8.6 Fixtures
Reuse Plan 4's `sample-1page.pdf`, `sample-2page.pdf`, `sample-5page.pdf`, `sample-encrypted.pdf`. No new fixtures.

## 9. Edge cases

- **Single-token Split.** `1-3` on a 5-page PDF → 1 output PDF (`pages-1-3.pdf`). ResultList shows 1 row, no ZIP button (`items.length === 1`).
- **All-pages Split.** Spec rejects this at the engine layer (`isReadyToConvert` returns false on empty input). User who wants "split into individual pages" must type `1, 2, 3, 4, 5` (which works correctly, producing 5 outputs).
- **Encrypted PDF for either engine.** Worker's `PDFDocument.load` (Split) or `getDocument().promise` (→ image) throws. ToolFrame banner shows `pdf-split: ... is encrypted` or `pdf-image: ... is encrypted` per the existing message-regex pattern.
- **Out-of-bounds range in Split.** Worker throws `pdf-split: page N exceeds <pageCount>`. User retypes; no convert-cycle penalty since the panel's syntax check passes for valid syntax.
- **Duplicate range tokens in Split.** `1-3, 1-3` produces two outputs both containing pages 1-3, with filenames `pages-1-3.pdf` and `pages-1-3-2.pdf`. ZIP entry names are unique.
- **Malformed range token in Split.** Panel shows inline syntax error; Convert stays disabled because `parseRangeTokens` would have failed in the panel's syntax check too. Worker would throw with `pdf-split: <reason>` if somehow reached.
- **0-page document for → image.** `doc.numPages === 0` → loop doesn't execute → empty outputs array. ResultList renders nothing (already handles this — `if (items.length === 0) return null`). Status shows DONE; user is mildly confused. Acceptable v1 behavior; Phase 6 could surface "input had no pages" message.
- **Massive page count.** A 1000-page PDF at 300 DPI in PDF→image would produce ~1000 PNGs each ~3 MB = ~3 GB total. Materializes in memory. v1 doesn't cap; users on 8 GB machines should pick lower DPI. Phase 6 candidate: pre-flight memory estimate + warning dialog.
- **client-zip empty input.** `buildZipBlob([])` throws — defense-in-depth; ResultList only invokes when `items.length > 1`.
- **JPEG quality slider edge values.** Valid range 60–95. Slider min/max enforce; outside-range values impossible from UI. Worker math `quality / 100` produces 0.6–0.95.

## 10. Plan structure preview

### Plan 5 (PDF Split + multi-output infra)
Estimated 11 tasks:

1. **Install client-zip** + verify gates.
2. **Promote range.ts** to `_shared/` (mechanical move + import update + test relocation).
3. **Add `parseRangeTokens`** export with new tests.
4. **Build `_shared/zip.ts`** + tests.
5. **Extend `EngineMeta`** with `archiveSuffix?: string` (types-only change).
6. **Update ResultList** to render the download-all button + accept new optional props. Update ToolFrame to plumb them.
7. **PDF Split engine descriptor + options + filenames module** (substantive).
8. **PDF Split OptionsPanel** + tests.
9. **PDF Split worker** (substantive).
10. **PDF Split route + sidebar entry** + engine-module build probe.
11. **E2E specs**: pdf-split happy path + privacy-regression-pdf-split.

Substantive (full sonnet+opus review): 7, 9. Mechanical (combined opus): 1, 2, 3, 4, 5, 6, 8, 10, 11.

### Plan 6 (PDF → image)
Estimated 8 tasks:

1. **Promote pdf-js loader** to `_shared/pdf-js.ts` (refactor; pdf-merge tests + E2E confirm parity).
2. **PDF → image engine descriptor + options** (substantive).
3. **PDF → image OptionsPanel** + tests.
4. **PDF → image worker** (substantive).
5. **PDF → image route + sidebar entry** + engine-module build probe.
6. **E2E specs**: pdf-image happy path + privacy-regression-pdf-image.
7. **Bundle audit**: confirm pdf.js worker chunk is shared between pdf-merge and pdf-image (no duplicate bundle).
8. **Final regression sweep**: full E2E suite passes; unit count ~210.

Substantive: 2, 4. Mechanical (combined opus): 1, 3, 5, 6, 7, 8.

## 11. Future scope (post-Plans 5/6)

- Bookmark / outline preservation across Split (matches pdf-merge limitation). Phase 6.
- Streaming ZIP download for very large outputs (Chrome-only via File System Access; defer until needed).
- DPI slider with arbitrary value + memory warning. Phase 6.
- JPEG quality presets. Phase 6.
- Page-range UI affordance for → image (e.g. "extract pages 5–10 only"). Phase 6 if requested.
- 0-page input UX message. Phase 6.
- WebP / AVIF output for → image. Phase 6.
- OCR pipeline. Out of project scope.

## 12. Success criteria

1. `pnpm typecheck && pnpm lint && pnpm test && pnpm build` exit 0 for both Plan 5 and Plan 6.
2. New E2E specs pass with `--workers=1`. Existing E2E suite has zero regressions (Plans 1–4 still green).
3. Drop a 5-page PDF on `/`, navigate to `/tools/pdf-split`, type `1-3, 5`, click Convert, see 2 download buttons + 1 "download all (2) as zip" button. Click ZIP, get a `.zip` file containing two valid PDFs.
4. Drop the same PDF on `/tools/pdf-image`, default options (PNG/150), click Convert, see 5 download buttons + ZIP. Click ZIP, get 5 valid PNGs.
5. Switch to JPEG quality 70, re-convert, see 5 JPEG downloads. Files smaller than the PNG version.
6. Switch DPI to 300 (PNG), re-convert, see larger files than 150-DPI baseline.
7. Privacy E2E asserts zero off-origin network during both Split and → image conversions.
8. PR `phase-5-pdf-split → main` opens cleanly, CI green, Vercel preview live.
9. PR `phase-6-pdf-image → main` opens cleanly after Plan 5 merges, CI green, Vercel preview live.
10. Bundle audit shows pdf.js chunk is shared between pdf-merge and pdf-image routes (no duplication).
