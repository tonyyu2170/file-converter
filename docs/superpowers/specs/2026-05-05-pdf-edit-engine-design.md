# PDF Edit engine — design (Phase 17 component)

**Status:** approved 2026-05-05
**Owner:** Tony Yu
**Predecessors:** Plan 4 (pdf-merge — established pdf.js thumbnails + dnd-kit retrofit, merged at `62a4cb4`); master spec `2026-04-30-file-converter-design.md` §5.2
**Sibling:** `2026-05-05-v1-closeout.md` (Phase 17 covers both)

## 0. Goal

Drop a single PDF, see all pages as a tray of thumbnails, rotate / reorder / delete pages visually, click Convert to download the edited PDF. Privacy invariant unchanged — every byte stays in the browser.

This engine collapses three §5.2 v1 catalog operations (rotate pages, reorder pages, delete pages) into one tool. Single-input → single-output. No new shared-code abstractions beyond promoting one existing helper.

## 1. Scope

### 1.1 pdf-edit engine

- New folder `src/engines/pdf-edit/` with the standard SingleInputEngine surface (descriptor, worker, options, OptionsPanel).
- Inputs: `application/pdf` only. Validation rejects non-PDF MIME and 0-byte files.
- Output: single PDF, filename `{originalname}-edited.pdf`. No metadata, outline, or attachment carryover (matches pdf-merge precedent).
- Operations:
  - **Rotate** per page in 90° steps; cycles `0 → 90 → 180 → 270 → 0` per click.
  - **Reorder** via drag (dnd-kit, same pattern as pdf-merge StagingArea).
  - **Delete** per page, applied immediately (no soft-delete state, no undo — deliberate per design discussion 2026-05-05).
- Plus a **toolbar "Rotate all 90°"** button that adds 90° to every remaining page's current rotation (stacks with per-page rotations modulo 360°).
- Encrypted PDFs are rejected at validate-time (no password prompt; matches pdf-merge precedent).

### 1.2 Route

- New `src/app/tools/pdf-edit/page.tsx`, same ToolFrame mounting pattern as other single-input engines (e.g., `pdf-to-md/page.tsx`).

### 1.3 Sidebar / homepage grid

- Add `pdf-edit` to the sidebar `PDFS` group (alongside `merge`, `split`).
- Add a card to the homepage grid (registry-driven, same as the recent `feat(home): add 3 missing engines` PR).

### 1.4 Homepage drag routing

Single-PDF drops on `/` currently auto-route to `pdf-split`. With pdf-edit landing, the right destination becomes ambiguous (split vs edit vs to-image vs to-md).

**Resolution for v1:** keep the current `pdf-split` auto-route. pdf-edit is reachable via the home grid card and the sidebar. A unified single-PDF chooser is post-v1 work — a routing rework would expand scope and isn't required by §5.2.

## 2. Out of scope (deferred / future)

- Bookmark / outline preservation across edits (pdf-lib `copyPages` does not carry these).
- Encrypted PDF support with password entry (no privacy-respecting UX, no pdf-lib decrypt API).
- Undo / redo for delete / rotate / reorder. Delete is immediate per spec; misclicks require re-staging.
- Insert blank pages or pages from another PDF.
- Page cropping, scaling, watermarking, redaction, form-flattening, signing.
- Inline page-content editing (text, annotations).
- Multi-PDF input (pdf-merge handles that).
- Single-PDF homepage chooser (see §1.4).

## 3. Architecture

### 3.1 Engine pattern (reference)

Single-input plumbing — ToolFrame's single-cardinality branch, OptionsPanel slot, engine.validate / engine.convert lifecycle, AbortSignal-driven cancellation, in/out size display — was shipped in earlier phases and is reused as-is. No type-system extension required.

### 3.2 Thumbnail renderer (shared promotion)

Promote `src/engines/pdf-merge/render-thumbnail.ts` to `src/engines/_shared/render-pdf-thumbnail.ts`. The pdf-merge spec §3.3 already anticipated this: *"Future PDF tools (split, rotate, PDF→image) will likely promote it to `_shared/`."*

The shared module exposes two entry points:

```typescript
// pdf-merge keeps its existing usage
export async function renderFirstPageThumbnail(
  bytes: ArrayBuffer,
  size: number,
): Promise<Blob>;

// new for pdf-edit
export async function renderPageThumbnail(
  doc: PdfJsDocument,        // pre-loaded pdf.js doc — avoids reparsing 250x
  pageIndex: number,         // 0-based
  size: number,
): Promise<Blob>;

export async function loadPdfDocument(
  bytes: ArrayBuffer,
): Promise<PdfJsDocument>;   // wraps getDocument().promise + module-load cache
```

Updates to the existing pdf-merge importer are mechanical (one import path swap). The promotion is part of this phase; pdf-merge's existing tests must stay green.

### 3.3 dnd-kit integration

PdfEditOptionsPanel owns its own `<DndContext>` + `<SortableContext>` — same pattern as pdf-merge StagingArea. Differences:

- **Strategy:** `rectSortingStrategy` (grid layout, ~5–6 columns desktop) instead of `verticalListSortingStrategy`.
- **Row IDs:** `crypto.randomUUID()` per page entry on file-add, persisted across reorders. Same rationale as pdf-merge §3.4 — ids must be stable so dnd-kit doesn't treat reorders as remounts.
- **Sensors:** `PointerSensor` (4px activation distance) + `KeyboardSensor` (Tab to grip, Space to grab, arrows to move, Space to drop).
- **On drag end:** `arrayMove(pages, from, to)`, propagate via `onChange`.

### 3.4 pdf-edit engine descriptor

```typescript
const engine: SingleInputEngine<PdfEditOptions, OutputItem> = {
  id: "pdf-edit",
  inputAccept: [".pdf"],
  inputMime: ["application/pdf"],
  outputMime: "application/pdf",
  defaultOptions: defaultPdfEditOptions,   // empty page list — populated on file-add
  category: "pdf",
  cardinality: "single",
  OptionsPanel: PdfEditOptionsPanel,
  validate(file) { ... },                  // size + MIME + extension; encryption checked async during render
  convert(file, opts, signal, runOpts) { ... },
};
```

## 4. Options

```typescript
type PdfEditPage = {
  id: string;                              // crypto.randomUUID(), stable across reorders
  sourceIndex: number;                     // 0-based index into the original document
  rotation: 0 | 90 | 180 | 270;            // accumulated rotation
};

export type PdfEditOptions = {
  pages: PdfEditPage[];                    // current edit set; order = output order
  totalSourcePages: number;                // populated on file-add for the "M of N" indicator
};

export const defaultPdfEditOptions: PdfEditOptions = {
  pages: [],
  totalSourcePages: 0,
};
```

Mutations:

- **Reorder:** `arrayMove(pages, from, to)`.
- **Rotate single:** `pages[i].rotation = ((pages[i].rotation + 90) % 360) as 0|90|180|270`.
- **Rotate all:** map across `pages`, applying the same +90° step.
- **Delete:** `pages.splice(i, 1)` (immediate; no flag).

Initial population: when a file is staged, the engine reads the page count and seeds `pages` with `{ id, sourceIndex: i, rotation: 0 }` for `i = 0..N-1` and sets `totalSourcePages = N`.

## 5. UI

### 5.1 PdfEditOptionsPanel

Layout:

```
┌─────────────────────────────────────────────────────────────┐
│  [ rotate all 90° ]              N pages → M pages          │
├─────────────────────────────────────────────────────────────┤
│  ┌────┐  ┌────┐  ┌────┐  ┌────┐  ┌────┐  ┌────┐             │
│  │ 1  │  │ 2  │  │ 3  │  │ 4  │  │ 5  │  │ 6  │             │
│  │[↻] │  │[↻] │  │[↻] │  │[↻] │  │[↻] │  │[↻] │             │
│  │ ×  │  │ ×  │  │ ×  │  │ ×  │  │ ×  │  │ ×  │             │
│  └────┘  └────┘  └────┘  └────┘  └────┘  └────┘             │
│  ...                                                         │
└─────────────────────────────────────────────────────────────┘
```

Per cell:
- Page-number badge (top-left), shows current source-document page number, not the post-reorder index.
- Rotate button (`[↻]`); current rotation shown by transform on the thumbnail itself.
- Delete button (`×`, distinct from "remove file"); applies immediately.
- Whole cell is the drag target; drag handle indicator surfaces on hover.

Indicator text:
- `N pages → M pages` when `M < N`. When `M === N`, show only `N pages`.

### 5.2 Loading state

Thumbnails render lazily via `IntersectionObserver`. Until a cell's thumbnail is ready, the cell shows a skeleton (matching brutalist border, "—" placeholder). The Convert button is enabled as soon as the page list is populated; it does not wait for all thumbnails to render (rendering all is incidental UX, not a correctness gate).

### 5.3 Empty / disabled states

- After all deletes leave 0 pages: Convert disabled with inline reason "at least one page must remain".
- During render: same Convert behavior as other engines (busy-gate).
- Re-staging the file (or staging a different file) resets the edit state to defaults.

### 5.4 Keyboard

- `Tab` traverses cells.
- Inside a cell: `R` rotates that page; `Delete` / `Backspace` deletes.
- `Space` on a cell engages dnd-kit keyboard drag; arrows move; `Space` drops.

## 6. Worker

Module: `src/engines/pdf-edit/worker.ts`. Comlink-exposed API:

```typescript
type ThumbnailEvent = { index: number; png: Blob };

const api = {
  // Lazy-loads pdf.js, parses the PDF once, returns metadata for OptionsPanel seed.
  async load(bytes: ArrayBuffer): Promise<{ pageCount: number }>,

  // Renders a single page on demand. Caller throttles via IntersectionObserver.
  // Reuses the doc loaded by `load()` (per-worker cache).
  async renderPage(pageIndex: number, size: number): Promise<Blob>,

  // Apply edits via pdf-lib; emit one Uint8Array.
  async apply(opts: PdfEditOptions): Promise<Uint8Array>,
};
```

Rationale for splitting `load` / `renderPage` / `apply`:
- The OptionsPanel needs `pageCount` *immediately* after staging to seed its grid.
- Thumbnails arrive over time, lazily, as the user scrolls.
- `apply` runs once on Convert, after `load` has already cached the doc.

The worker holds a per-instance `pdfDoc` (from pdf.js, used for thumbnails) and calls `pdf-lib`'s `PDFDocument.load(bytes).copyPages(...)` for the apply step. Both consume the same `bytes` buffer; the engine passes it through in `convert()`.

`apply()` algorithm:
1. Load source via `PDFDocument.load(bytes, { ignoreEncryption: false })`.
2. Create empty target via `PDFDocument.create()`.
3. For each `{ sourceIndex, rotation }` in `opts.pages` in order:
   - `copyPages(source, [sourceIndex])` → returns `[copiedPage]`.
   - Apply rotation: `copiedPage.setRotation(degrees(currentRotation + rotation) % 360)` to compose with the source page's existing rotation.
   - `target.addPage(copiedPage)`.
4. `target.save()` → Uint8Array.

The composition of source-page existing rotation and user-applied rotation matters: a source PDF that already has page 3 stored at 90° must, when the user clicks "rotate all 90°" once, end up as 180°. This is verified in correctness E2E.

## 7. Validation

- File MIME `application/pdf` OR `.pdf` extension fallback (matches existing engines).
- File size: inherit §11.1 PDF caps (100 MB soft, 250 MB hard) via the existing `size-limits.ts` utility.
- Page count, checked after `load()`:
  - Soft warn above **100** pages (UI shows "rendering may take a moment", proceeds). 100 itself does not warn.
  - Hard reject above **250** pages (error: "Too many pages — split first"). 250 itself is allowed; 251+ is rejected.
- Encrypted PDFs: pdf.js raises `PasswordException` during `load()`. Engine surfaces "Encrypted PDFs aren't supported". Same error category as pdf-merge.
- Empty file (0 bytes): rejected at validate-time before worker spin-up.

## 8. Output

- Single output, filename `{originalname-without-extension}-edited.pdf`, MIME `application/pdf`.
- Same OutputItem shape as pdf-merge / pdf-split.

## 9. Privacy

- All pdf.js / pdf-lib calls occur inside `src/engines/pdf-edit/worker.ts`. No `fetch` / `XMLHttpRequest`. The Biome lint rule (master spec §10.2) catches regressions automatically.
- Standard privacy regression E2E (zero outbound network during a real edit).

## 10. Testing

### 10.1 Unit (vitest, co-located)

- `options.test.ts`: edit-set normalization (rotation modulo 360, reorder array bounds, delete preserves remaining ids).
- `filenames.test.ts`: `{name}-edited.pdf` from various input names (with/without dots, with multiple extensions).
- `index.test.ts`: validate rejects non-PDF, empty file, oversized file. Engine metadata matches descriptor type.

### 10.2 Worker correctness

- Real fixture (`tests/fixtures/pdf-edit/multi-page.pdf`, 5 pages, mixed orientations and existing rotations — see §10.5).
- Apply edit: rotate p2 by 90, reorder p3↔p4, delete p5.
- Decode output via pdf-lib, assert:
  - Output page count is 4.
  - Page rotation matches expected composition (source-page rotation + user rotation, mod 360).
  - Page order matches the requested sourceIndex sequence.

### 10.3 Integration (vitest + jsdom)

- `options-panel.test.tsx`: thumbnails render in cells; rotate-click cycles state; delete-click removes cell; rotate-all-button mutates all remaining pages; "M of N" indicator updates correctly; Convert disabled at 0 pages.
- `dnd-kit-reorder.test.tsx`: drag-and-drop simulation reorders pages and dispatches onChange (same testing pattern as pdf-merge `staging-area.test.tsx`).

### 10.4 E2E (Playwright, chromium, `--workers=1`)

- `tests/e2e/pdf-edit.spec.ts`: drop fixture → page tray populates → click rotate on p2 → drag p3 to p4 position → click delete on p5 → click Convert → download → assert filename pattern → re-decode in-page via pdf.js → assert page count and rotations.
- `tests/e2e/privacy-regression-pdf-edit.spec.ts`: standard zero-outbound-network assertion during the same flow.

### 10.5 Fixtures

- `tests/fixtures/pdf-edit/multi-page.pdf` (~50 KB, 5 pages, mixed portrait/landscape, page 3 stored at 90° rotation in the source so the rotation-composition test actually verifies composition rather than just additive math).
- Generated via a one-off `pdf-lib` script committed alongside, so the fixture is reproducible.

## 11. Edge cases

- **Single-page PDF:** all operations are well-defined; rotate-all and reorder are no-ops on N=1; delete leaves 0 pages → Convert disabled.
- **250-page PDF:** soft-warn fires; thumbnails lazy-load on scroll; Convert is enabled before all thumbnails render.
- **251-page PDF:** rejected pre-render with the "Too many pages" message.
- **0 pages remaining after deletes:** Convert disabled with explicit reason; clearing the file via "× clear" resets state.
- **File replaced (user drops a different PDF after editing):** edit state is reset to the new file's defaults; no leftover edits from the prior file.
- **Rapid rotate clicks:** state cycles cleanly; no race because mutations go through React state updaters, not the worker.
- **Source page already rotated (e.g., page stored as 90°):** user rotations compose with the stored rotation; verified in §10.2.
- **Encrypted PDF:** pdf.js `PasswordException` surfaces as the standard "Encrypted PDFs aren't supported" error and clears the staged file.

## 12. Plan structure preview

This engine is one of two deliverables in Phase 17. Indicative task ordering for the engine-only subset:

1. Promote `render-thumbnail.ts` to `_shared/render-pdf-thumbnail.ts`; update pdf-merge importer; existing tests stay green.
2. Add `loadPdfDocument` and `renderPageThumbnail` to the shared module with unit tests.
3. pdf-edit engine descriptor + options + validation + unit tests.
4. Worker (`load`, `renderPage`, `apply`) + correctness test against `multi-page.pdf`.
5. PdfEditOptionsPanel (page tray, dnd-kit grid, rotate / delete / rotate-all).
6. Route `/tools/pdf-edit/page.tsx` + sidebar entry + home grid card.
7. E2E correctness + privacy regression specs.

The full plan (engine + closeout) is generated by the `superpowers:writing-plans` skill from this spec and the sibling closeout spec.

## 13. Future scope (post-v1)

- Bookmark / outline preservation through edits.
- Insert blank pages; insert pages from another PDF.
- Page cropping, scaling.
- Encrypted PDF support with password entry.
- Undo / redo stack for delete / rotate / reorder.
- Single-PDF homepage tool chooser (see §1.4).

## 14. Success criteria

- A 50-page test PDF can be edited (rotate, reorder, delete) and converted in under 30 seconds wall clock on the dev box.
- Output PDF opens in Acrobat, Chrome, and Preview without warnings.
- Page rotation in the output matches user-applied rotation composed with source-page existing rotation.
- Privacy regression E2E green; no outbound network during edit.
- Bundle isolation CI (Phase 17 closeout deliverable) confirms `pdf-edit` code does not appear in the homepage chunk.
- All existing tests stay green through the `_shared/render-pdf-thumbnail` promotion.
