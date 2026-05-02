# PDF Merge engine — design (Plan 4)

**Status:** approved 2026-05-02
**Owner:** Tony Yu
**Predecessors:** Plan 3 (image-to-pdf + HEIC consolidation, merged at `2635e57`); master spec `2026-04-30-file-converter-design.md` §5.2

## 0. Goal

Ship a `pdf-merge` engine: drop 2+ PDFs, optionally specify per-PDF page ranges, reorder via drag-and-drop or ↑↓ buttons, click Convert, download a single merged PDF. Privacy invariant unchanged — every byte stays in the browser.

Includes two structural carry-along changes:
- pdf.js (`pdfjs-dist`) added as a lazy-loaded dependency for first-page thumbnail rendering.
- `@dnd-kit/core` + `@dnd-kit/sortable` added for keyboard-accessible drag reordering, retrofit into `image-to-pdf`'s existing StagingArea so both multi-input tools behave consistently.

## 1. Scope

### 1.1 pdf-merge engine
- New folder `src/engines/pdf-merge/` with the standard MultiInputEngine surface (descriptor, worker, options, StagingArea — no OptionsPanel; merge has no global options).
- Inputs: `application/pdf` only. Validate rejects non-PDF MIME and empty file lists.
- Output: single PDF, fixed filename `merged.pdf`. No metadata, outline, or attachment carryover.
- Per-row controls in staging: drag handle, ↑↓ buttons (kept for keyboard / touch fallback), thumbnail (first page, 32×32), filename, page count or `[ password-protected ]`, optional range field, ×.
- Range syntax: Acrobat-style `1-3, 5, 7-, -3`. Empty field = all pages.
- Encrypted PDFs are rejected per-row inline (no password prompt; no `ignoreEncryption: true`).

### 1.2 image-to-pdf retrofit
- `image-to-pdf/staging-area.tsx` migrates from manual ↑↓ reorder to dnd-kit's `<DndContext>` + `<SortableContext>`. ↑↓ buttons stay in place — drag is additive, not replacement, and existing E2E assertions on `move-up`/`move-down` continue to pass unchanged.

### 1.3 Homepage routing extension
- 2+ `application/pdf` files dropped on `/` → handoff to `/tools/pdf-merge`.
- Single PDF dropped on `/` → "Need 2+ PDFs to merge" error (no PDF-passthrough tool exists).
- Mixed image + PDF drop → "All files must be the same type" error.

### 1.4 Sidebar
- New `PDFS` group, single entry `merge` → `/tools/pdf-merge`.
- Existing `IMAGES` group entries (`image convert`, `image→pdf`) unchanged.

## 2. Out of scope (deferred / future)

- Bookmark / outline preservation across the merge boundary. pdf-lib's `copyPages` does not carry these; preserving them needs manual outline-tree manipulation.
- Encrypted PDF support with password entry. No clean privacy-respecting UX, and pdf-lib has no decrypt API.
- PDF preview at full size (only first-page thumbnail in staging).
- Per-PDF page rotation, splitting, extraction — these are separate engines per master spec §5.2 (Phase 5+).
- Mixed PDF + image input. If you want photos merged into a PDF, run `image-to-pdf` first, then `pdf-merge`.
- Watermarking, redaction, form-flattening, signing.
- Drag reorder across files dropped from the OS file picker (only within the staging list).

## 3. Architecture

### 3.1 Engine pattern (reference)

All multi-input plumbing — ToolFrame's multi-cardinality branch, DropZone `multiple` prop, staged-files handoff, Convert button busy-gate, `engine.isReadyToConvert` — was shipped in Plan 3 and is reused as-is. No type-system extension required.

### 3.2 Range parser

Module: `src/engines/pdf-merge/range.ts`.

```typescript
export type RangeParseResult =
  | { ok: true; indices: number[] }   // 0-indexed page indices, in the order specified
  | { ok: false; reason: string };    // user-displayable reason

export function parseRange(input: string, pageCount: number): RangeParseResult;
```

Behavior:
- Empty / whitespace-only input → `ok: true, indices: [0..pageCount-1]`.
- Comma-separated tokens; whitespace tolerated around commas and dashes.
- Tokens accepted: `N`, `N-M`, `N-`, `-M` (1-indexed input).
- Tokens rejected: non-numeric, `N=0` or negative, `M < N`, `N > pageCount`, `M > pageCount`, `N-` with `N > pageCount`, bare `-`, empty token between commas, leading/trailing comma.
- Duplicates and overlaps allowed: `1-3, 2, 5` outputs page 2 twice (both copies in document order). Caller is responsible for any dedup it wants.

Reasons returned are short and user-displayable (e.g., `"page 7 exceeds 5"`, `"5-3 is reversed"`, `"can't parse 'foo'"`).

### 3.3 Thumbnail renderer

Module: `src/engines/pdf-merge/render-thumbnail.ts`.

```typescript
export async function renderFirstPageThumbnail(
  bytes: ArrayBuffer,
  size: number,
): Promise<Blob>;  // PNG blob suitable for object URL
```

- Lazy-loads `pdfjs-dist` via `dynamic import("pdfjs-dist")` on first call. Module-level promise cache so subsequent calls reuse the same module.
- Sets `pdfjsLib.GlobalWorkerOptions.workerSrc` once per page-load. The worker URL is `new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url)`, matching the engine-worker pattern.
- Loads the document (`getDocument(bytes).promise`), gets page 1, computes a fit-aspect viewport at the requested square size, renders to an `OffscreenCanvas`, returns a PNG blob.
- Throws on encryption (pdf.js surfaces `PasswordException`). Caller catches and shows the `?` placeholder; the StagingArea row's encryption state is decided by the parallel pdf-lib load, not the thumbnail.

Module is engine-local for v1. Future PDF tools (split, rotate, PDF→image) will likely promote it to `_shared/`.

### 3.4 dnd-kit integration

Each StagingArea component owns its own `<DndContext>` + `<SortableContext>`. Per-row component calls `useSortable({ id })` and applies the returned `attributes`, `listeners`, `setNodeRef`, `transform`, `transition` to the row's outer element and the drag handle.

- **Row IDs must be stable across reorders.** Each row gets a unique `id: string` allocated on file-add (`crypto.randomUUID()` with a fallback to a monotonic counter for environments without `crypto.randomUUID`), and persisted in the row state across all reorder/edit operations. Using `${file.name}-${index}` would change the id whenever a reorder shifts the index — dnd-kit treats that as a different row and breaks animations / accessibility focus.
- The same id-allocation strategy applies to the image-to-pdf retrofit; that component currently keys its React rendering by `${file.name}-${index}`, which is fine for React's reconciler but insufficient as a dnd-kit id. The retrofit adds an `id` field to its internal row tracking.
- Strategy: `verticalListSortingStrategy`.
- Sensors: `PointerSensor` (with a 4px activation distance to avoid accidental drags from text-row clicks) + `KeyboardSensor` (Tab to grip, Space to grab, arrows to move, Space to drop).
- On drag end: compute new order via `arrayMove`, call `onChange(newOrder)`. The same path that ↑↓ buttons already use.

No shared component is extracted — both StagingAreas remain bespoke. The dnd-kit primitives are the abstraction; wrapping them for two consumers is premature.

### 3.5 pdf-merge engine descriptor

```typescript
const engine: MultiInputEngine<PdfMergeOptions, OutputItem> = {
  id: "pdf-merge",
  inputAccept: [".pdf"],
  inputMime: ["application/pdf"],
  outputMime: "application/pdf",
  defaultOptions: defaultPdfMergeOptions,
  convertButtonLabel: "[ merge pdfs ]",
  cardinality: "multi",
  StagingArea: PdfMergeStagingArea,
  isReadyToConvert: (opts) =>
    opts.rows.length >= 2 &&
    opts.rows.every((r) => r.pageCount !== undefined && !r.encrypted && !r.rangeError),
  validate(files) {
    if (files.length === 0) return { ok: false, reason: "Drop at least one PDF" };
    if (files.length === 1) return { ok: false, reason: "Need 2+ PDFs to merge" };
    return files.every((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"))
      ? { ok: true }
      : { ok: false, reason: "All files must be PDFs" };
  },
  async convert(files, opts, signal) {
    const harness = new WorkerHarness<PdfMergeOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    );
    const result = await harness.runMulti(files, opts, signal);
    if (Array.isArray(result)) {
      const first = result[0];
      if (!first) throw new Error("engine returned empty array");
      return first;
    }
    return result;
  },
};
```

Note: `isReadyToConvert` reads from `opts.rows` (see §4 Options). The StagingArea writes its row state into options on every change.

## 4. Options

`pdf-merge` has no user-facing options panel. The `options` object is used internally as the channel that carries StagingArea row state into `engine.isReadyToConvert` and the worker.

```typescript
export type PdfMergeRow = {
  // identity (stable across reorders; required by dnd-kit)
  id: string;                          // crypto.randomUUID() allocated on add
  fileName: string;                    // for display + worker pageIndex traceability
  // metadata loaded from pdf-lib
  pageCount: number | undefined;       // undefined = still loading
  encrypted: boolean;                  // true if PDFDocument.load threw EncryptedPDFError
  // user-controlled
  rangeInput: string;                  // raw text from the input field
  parsedRange: number[];               // 0-indexed page indices to copy
  rangeError: string | undefined;      // displayable error or undefined when ok
};

export type PdfMergeOptions = {
  rows: PdfMergeRow[];
};

export const defaultPdfMergeOptions: PdfMergeOptions = { rows: [] };
```

Rationale: ToolFrame already passes `options` to both `isReadyToConvert(opts)` and the worker via `engine.convert(files, opts, signal)`. Putting the row metadata here is the cheapest way to wire row-level errors into the Convert-button gate without inventing a new validation channel. The StagingArea component is the sole writer of `rows`; ToolFrame is the single reader passed through to validation + worker.

## 5. UI

### 5.1 PdfMergeStagingArea

Per-row layout, left to right:
- **Drag handle** (1ch wide, `≡` glyph, `cursor: grab`, dnd-kit listeners attached). Visible at all times.
- **Page number** (1-indexed position in the merge order; the existing image-to-pdf staging already shows this).
- **Thumbnail** (32×32 image of the first page, or `?` placeholder while loading / on render error). Border: `[var(--color-hairline)]`.
- **Filename** (truncated, `title` attribute for tooltip).
- **Page count or status**: `12 pages` / `1 page` / `[ password-protected ]` / `loading...` (during pdf-lib load).
- **Range input** (`<input type="text" />`, narrow, monospace). Placeholder: `all`. Inline `rangeError` text below input in `[var(--color-accent)]` (the project's red).
- **↑↓ buttons** with `data-testid="move-up"` and `move-down` (matching image-to-pdf's existing pattern), disabled at edges.
- **× button** with `data-testid="remove"` (matching image-to-pdf).

The drag handle has `data-testid="drag-handle"` so E2E tests can target it.

State machine per row (`PdfMergeRow`):
- File added → `pageCount: undefined, encrypted: false, rangeInput: "", parsedRange: [], rangeError: undefined`. Two parallel async tasks fire:
  - `PDFDocument.load(bytes)` → on success, set `pageCount`, recompute `parsedRange` from `rangeInput`. On `EncryptedPDFError`, set `encrypted: true, pageCount: 0`.
  - `renderFirstPageThumbnail(bytes, 32)` → set `thumbnailUrl` on success, leave `undefined` on failure.
- Range input changes → re-run `parseRange(rangeInput, pageCount)`. Update `parsedRange` + `rangeError` synchronously.
- Reorder (drag or ↑↓) → swap `rows[i]` and `rows[j]`; no metadata recompute.
- Remove (×) → revoke thumbnail object URL, drop row.
- Unmount → revoke all thumbnail object URLs (existing image-to-pdf cleanup pattern).

The Strict-Mode-safe pattern from Plan 3 Task 9 carries over: gate metadata commits on a `"loading"` sentinel, hold side effects outside `setState` updaters.

### 5.2 image-to-pdf StagingArea retrofit

Same dnd-kit wrapper layer (DndContext + SortableContext + useSortable), drag handle added on the left, thumbnail/filename/size/↑↓/× layout otherwise unchanged. Reorder logic moves from the existing `moveUp` / `moveDown` callbacks into the dnd-kit `onDragEnd` path — but the buttons themselves still call the original handlers, so existing tests for `move-up` / `move-down` test IDs continue to pass.

### 5.3 ToolFrame changes

None. Plan 3's multi-cardinality plumbing is unchanged. `isReadyToConvert(opts)` already gates the Convert button; pdf-merge's implementation reads `opts.rows`.

### 5.4 Sidebar

```typescript
const TOOLS: ToolEntry[] = [
  { id: "image-convert", href: "/tools/image-convert", label: "image convert", group: "IMAGES" },
  { id: "image-to-pdf",  href: "/tools/image-to-pdf",  label: "image→pdf",     group: "IMAGES" },
  { id: "pdf-merge",     href: "/tools/pdf-merge",     label: "merge",         group: "PDFS"   },
];
```

The group iteration order is "as encountered" via `Object.entries(groups)` — IMAGES will render before PDFS because IMAGES is first in the array. No explicit ordering field needed for two groups.

## 6. Worker (pdf-merge)

```typescript
import * as Comlink from "comlink";
import { PDFDocument } from "pdf-lib";
import type { OutputItem } from "@/engines/_shared/types";
import type { PdfMergeOptions } from "./options";

const api = {
  async convertMulti(
    files: Array<{ bytes: ArrayBuffer; name: string; type: string }>,
    opts: PdfMergeOptions,
  ): Promise<OutputItem> {
    if (files.length < 2) throw new Error("pdf-merge: need 2+ PDFs");
    if (opts.rows.length !== files.length) {
      throw new Error("pdf-merge: row metadata length mismatch");
    }

    const out = await PDFDocument.create();

    for (const [i, f] of files.entries()) {
      const row = opts.rows[i];
      if (!row) throw new Error(`pdf-merge: missing row metadata at ${i}`);
      if (row.encrypted) throw new Error(`pdf-merge: ${f.name} is password-protected`);
      if (row.rangeError) throw new Error(`pdf-merge: ${f.name} has invalid range`);

      const src = await PDFDocument.load(f.bytes);
      const indices = row.parsedRange.length > 0
        ? row.parsedRange
        : Array.from({ length: src.getPageCount() }, (_, k) => k);
      const copied = await out.copyPages(src, indices);
      for (const page of copied) out.addPage(page);
    }

    const pdfBytes = await out.save();
    return {
      filename: "merged.pdf",
      mime: "application/pdf",
      blob: new Blob([pdfBytes as BlobPart], { type: "application/pdf" }),
    };
  },
};

Comlink.expose(api);
```

The worker re-validates row state defensively (StagingArea is the source of truth, but the Convert-button gate could conceivably be bypassed by direct DOM manipulation; better to throw a clean error than ship junk). Errors here surface in ToolFrame's existing error banner.

## 7. Cross-route handoff

Unchanged from Plan 3. The handoff slot in `src/lib/handoff.ts` (`File[]`) is reused. ToolFrame's mount-time `takeStagedFiles()` consumption fires once, then the multi-cardinality append flow takes over.

## 8. Homepage MIME-detect routing

`src/app/page.tsx` `handleFiles` extends to four branches. Pseudocode:

```
mimes = await Promise.all(files.map(detectMime));

const allImages = mimes.every(m => IMAGE_MIMES.has(m));
const allPdfs   = mimes.every(m => m === "application/pdf");

if (allImages) {
  if (files.length >= 2) → /tools/image-to-pdf
  else                   → /tools/image-convert
} else if (allPdfs) {
  if (files.length >= 2) → /tools/pdf-merge
  else setError("Need 2+ PDFs to merge")
} else {
  setError("All files must be the same type")
}
```

The "mixed" error is the only user-visible new message. Existing image-only error messages survive verbatim.

## 9. Sidebar

Already covered in §5.4.

## 10. Validation rules

- Engine `validate(files)`:
  - empty → `{ok: false, reason: "Drop at least one PDF"}`
  - length 1 → `{ok: false, reason: "Need 2+ PDFs to merge"}`
  - any non-PDF MIME and non-`.pdf` extension → `{ok: false, reason: "All files must be PDFs"}`
  - else `{ok: true}`
- Engine `isReadyToConvert(opts)`:
  - `opts.rows.length >= 2`
  - every row has `pageCount !== undefined` (loaded), `encrypted === false`, `rangeError === undefined`.
- Per-row inline errors are owned by the StagingArea, not by `validate`.

## 11. Output

- One `OutputItem`: `{filename: "merged.pdf", mime: "application/pdf", blob: ...}`.
- ResultList renders the existing download button. No new UI.
- No filename customization in v1 (would add an OptionsPanel; YAGNI).

## 12. Privacy

Invariant unchanged: zero outbound network during conversion. New libraries verified by the new privacy-regression spec:
- pdf.js worker URL is constructed from the bundled `.mjs` — no CDN.
- pdf-lib makes no network calls.
- @dnd-kit/core makes no network calls.

The existing Biome `no-fetch-in-engines` rule (Plan 1) covers `src/engines/pdf-merge/`. New E2E spec asserts zero off-origin requests during a 2-PDF merge.

## 13. Testing

### 13.1 Unit (vitest, co-located)
- `range.test.ts`: tabular `it.each` covering all accept/reject cases from §3.2 and §10.
- `staging-area.test.tsx`: render rows, fire input changes, mock `PDFDocument.load` for healthy + encrypted, mock `renderFirstPageThumbnail` to assert `?` fallback. Strict-Mode test included.
- `index.test.ts`: metadata + `validate` cases (empty, single, all-PDF, mixed, non-PDF rejected).
- `_shared/registry.test.ts`: append `loadEngine("pdf-merge")` positive-path test.

### 13.2 Worker correctness
Deferred to E2E (jsdom has no PDF runtime). Same posture as Plan 3 Task 10.

### 13.3 E2E (Playwright, chromium, `--workers=1`)
- `pdf-merge.spec.ts`:
  - Happy path: drop 3 PDFs, drag-reorder, convert, assert `%PDF-` magic + `%%EOF` tail + total page count = sum of inputs.
  - Range slicing: drop 2 PDFs, set `1-2` and `3-`, convert, assert page count = expected.
  - Encrypted PDF: drop healthy + encrypted, assert `[ password-protected ]` text + Convert disabled.
  - Bad range UX: type `7-10` on a 5-page PDF, assert inline error + Convert disabled, fix range, assert Convert re-enables.
- `privacy-regression-pdf-merge.spec.ts`: zero off-origin during a 2-PDF merge.
- `multi-file-handoff-pdf.spec.ts`: drop 2 PDFs on `/`, assert handoff to `/tools/pdf-merge`, assert staging populated, click Convert, assert download.
- `image-to-pdf.spec.ts`: add one drag-reorder assertion to cover the retrofit. Existing `move-up` / `move-down` assertions remain unchanged.

### 13.4 Fixtures
- `tests/fixtures/sample-1page.pdf`, `sample-2page.pdf`, `sample-5page.pdf`, `sample-encrypted.pdf`. Generate via a one-shot pdf-lib script committed under `tests/fixtures/scripts/` (similar to how image fixtures are generated). All under 10 KB.

## 14. Edge cases

- **2 PDFs, empty range on both**: merges all pages of both. Standard happy path.
- **2 PDFs, range `1-2, 1-2` (duplicate token within one row)**: outputs each page twice. Spec-permitted.
- **3 PDFs, middle one encrypted**: Convert disabled; fixing requires removing the encrypted row.
- **Range spans entire document**: `1-N` on an N-page PDF behaves identically to empty.
- **Reorder during async load**: drag fires while pageCount is still loading. Reorder updates the array; the in-flight load callback uses the row's `id` (file reference), not its index, so the eventual `setRow` correctly targets the now-relocated row.
- **Remove during async load**: standard cleanup; ignore the load result if the row is gone (gate on `id` presence in current state).
- **Identical filename twice**: each row's dnd-kit `id` is a fresh UUID allocated on add (see §3.4), so two rows with the same `fileName` are unambiguously distinct to dnd-kit and to React. The same file added twice produces two rows with two different ids — the user gets the same content twice in the merged output, which matches the duplicates-allowed semantics for ranges.

## 15. Plan structure preview

Estimated 10 tasks, in dependency order:

1. **Install deps** — `pdfjs-dist`, `@dnd-kit/core`, `@dnd-kit/sortable`. Verify lint, typecheck, build.
2. **Range parser** — `range.ts` + `range.test.ts`. Substantive (full review).
3. **Thumbnail renderer** — `render-thumbnail.ts`. Lazy-loads pdf.js. Unit test mocks the lazy import.
4. **PDF fixtures script + commit** — generate sample 1/2/5-page + encrypted PDFs under `tests/fixtures/`.
5. **PdfMergeStagingArea component** — `staging-area.tsx` + tests. Substantive (full review). Most complex piece.
6. **pdf-merge worker** — `worker.ts`. Substantive (full review).
7. **pdf-merge engine descriptor + registry** — `index.ts`, `index.test.ts`, registry update + test. Engine-module build probe.
8. **pdf-merge route + sidebar entry + homepage routing** — `app/tools/pdf-merge/page.tsx`, `sidebar.tsx`, `app/page.tsx` extension.
9. **image-to-pdf StagingArea retrofit (dnd-kit)** — same wrapping as pdf-merge; preserve all existing tests.
10. **E2E specs** — `pdf-merge.spec.ts`, `privacy-regression-pdf-merge.spec.ts`, `multi-file-handoff-pdf.spec.ts`, drag-reorder assertion in `image-to-pdf.spec.ts`. Run full suite for regression.

Substantive (parallel sonnet spec + opus quality review): 2, 5, 6.
Mechanical (combined opus review): 1, 3, 4, 7, 8, 9, 10.

Order matters: tasks 5 and 6 both depend on 3 (thumbnail) and 4 (fixtures). Task 9 (retrofit) is independent of 5 (which uses dnd-kit fresh) and could be done before 5, but clustering both dnd-kit consumers after the pattern is established in pdf-merge avoids re-engineering.

## 16. Future scope (post-Plan 4)

- Bookmark / outline preservation across merges (Phase 6 backlog).
- Output filename customization via OptionsPanel.
- Drag reorder during in-flight conversion (currently disabled by Convert button busy-gate; could surface as an explicit affordance).
- Promote `render-thumbnail.ts` to `_shared/` once a second consumer (PDF→image, PDF rotate) lands.
- pdf.js bundle audit — pdf-lib + pdf.js together is ~600 KB min+gz on the PDF tools route. Acceptable for v1; revisit if the route gets sluggish on cold load.

## 17. Success criteria

1. `pnpm typecheck && pnpm lint && pnpm test && pnpm build` exit 0 with all new tests passing.
2. New E2E specs pass with `--workers=1`. Existing E2E suite has zero regressions.
3. Drop 2 PDFs on `/`, get redirected to `/tools/pdf-merge` with staging populated. Click Convert. Get a downloadable PDF with `%PDF-` magic bytes and combined page count.
4. Drop 1 PDF on `/`, see "Need 2+ PDFs to merge" error.
5. Drop 1 PDF + 1 PNG on `/`, see "All files must be the same type" error.
6. Drag-reorder a row in pdf-merge — order persists in the merged output.
7. Drag-reorder a row in image-to-pdf — order persists in the resulting PDF (regression check on retrofit).
8. Privacy E2E asserts zero off-origin network during a 2-PDF merge.
9. PR `phase-4-pdf-merge → main` opens cleanly, CI green, Vercel preview live.
