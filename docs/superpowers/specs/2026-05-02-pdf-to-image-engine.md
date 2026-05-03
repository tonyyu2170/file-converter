# pdf → image engine — design

**Date:** 2026-05-02
**Phase:** 11 (next engine after Phase 5's pdf-split; Phase 8/8b were home-page polish, not engines)
**Scope:** New conversion engine that rasterizes each page of a PDF to a PNG or JPEG. Multi-output ZIP via the existing `archiveSuffix` infrastructure. No changes to engine pattern, no new top-level dependencies.

## Background

`image-to-pdf` ships (Phase 3); the inverse is missing. Users routinely want to extract a PDF's pages as images — for inclusion in slide decks, social posts, or further image editing. Phase 11 fills this gap as the symmetric counterpart.

The implementation is a clean composition of existing infrastructure: pdf-split's engine shape (single PDF in → N outputs out, multi-output ZIP), pdf-merge's `render-thumbnail.ts` rendering pattern (pdfjs-dist + OffscreenCanvas), and pdf-split's `_shared/range.ts` for optional page selection.

## Decisions

### D1. Output format — PNG default, JPEG optional

User picks via `OptionsPanel`. PNG is the default (lossless, supports transparency, matches image-convert's default). JPEG mode unlocks a quality slider (1–100, default 90).

### D2. Resolution — 3 presets

Dropdown with three named scales. Internally these map to pdfjs-dist's `getViewport({ scale: N })`:

| Label | Scale | DPI equivalent | Use case |
|---|---|---|---|
| `screen` | 1× | 96 DPI | Web preview, social media |
| `print` | 2× | 192 DPI | Documents, slide decks (default) |
| `high-res` | 3× | 288 DPI | Print, archival |

Default `print`. Three presets is friendlier than a numeric input; covers the realistic span without inviting weird values.

### D3. Page range — optional, reuses `_shared/range.ts`

Same range-input field pattern as pdf-split (`1-3, 5, 7-10`). Empty input = all pages. Range parser is already shared infrastructure.

`isReadyToConvert` returns true when there's a file staged AND (range is empty OR range is syntactically valid). Empty range is valid (means "all pages").

Hmm — actually, the engine's `isReadyToConvert(opts)` only sees options, not the staged file. Phase 6 unified single-cardinality engines onto stage-then-Convert flow. The Convert button is disabled when `stagedFiles.length === 0 || !ready`. Engine can use `isReadyToConvert(opts)` to gate on options validity. So: range is always considered "ready" if either empty (=all pages) or syntactically valid.

For format/scale/quality, all are required and have defaults — always satisfied.

### D4. Filenames

`page-1.png`, `page-2.png`, etc. (or `.jpg` if JPEG selected). No zero-padding (matches pdf-split's `page-5.pdf` convention).

When a range is supplied, filenames still reflect the original page numbers (e.g., range `5,7-9` produces `page-5.png`, `page-7.png`, `page-8.png`, `page-9.png`).

ZIP archive name: `<basename>-images.zip` (mirrors pdf-split's `<basename>-split.zip` via `archiveSuffix: "-images"`).

### D5. Encrypted PDFs — error out

Same as pdf-split (and pdf-merge): if pdfjs-dist throws on an encrypted PDF, surface a clear error message: `"pdf-to-image: input PDF is password-protected"`. Decryption is out of scope.

### D6. Engine shape

```ts
const engine: SingleInputEngine<PdfToImageOptions, OutputItem[]> = {
  id: "pdf-to-image",
  inputAccept: [".pdf"],
  inputMime: ["application/pdf"],
  outputMime: "image/png",  // default; JPEG outputs override per-item
  defaultOptions: defaultPdfToImageOptions,
  archiveSuffix: "-images",
  cardinality: "single",
  OptionsPanel: PdfToImageOptionsPanel,
  isReadyToConvert(opts) {
    if (!opts.rangeInput.trim()) return true;
    // Defer full parse to worker; here just check the input isn't garbage.
    // (parseRangeTokens is sync and cheap — we could call it directly.)
    return true;
  },
  validate(file) {
    return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
      ? { ok: true }
      : { ok: false, reason: "Expected a PDF file" };
  },
  async convert(file, opts, signal) {
    const harness = new WorkerHarness<PdfToImageOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    );
    const result = await harness.runSingle(file, opts, signal);
    return Array.isArray(result) ? result : [result];
  },
};
```

Mirrors `pdf-split/index.ts` almost verbatim. The shape is well-trodden.

### D7. Options shape

```ts
export type PdfToImageOptions = {
  format: "png" | "jpeg";
  scale: 1 | 2 | 3;
  jpegQuality: number; // 1..100, only relevant when format === "jpeg"
  rangeInput: string;
};

export const defaultPdfToImageOptions: PdfToImageOptions = {
  format: "png",
  scale: 2,
  jpegQuality: 90,
  rangeInput: "",
};
```

### D8. Worker — render loop

```ts
async convertSingle(fileBytes, _fileName, _fileType, opts) {
  const lib = await loadPdfJs(); // pattern from pdf-merge/render-thumbnail.ts
  let doc;
  try {
    doc = await lib.getDocument({ data: fileBytes }).promise;
  } catch (err) {
    if (err instanceof Error && /password|encrypted/i.test(err.message)) {
      throw new Error("pdf-to-image: input PDF is password-protected");
    }
    throw err;
  }
  try {
    const pageCount = doc.numPages;
    const pageNumbers = computePageNumbers(opts.rangeInput, pageCount); // throws on bad range
    const outputs: OutputItem[] = [];
    for (const pageNum of pageNumbers) {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: opts.scale });
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
      const mime = opts.format === "jpeg" ? "image/jpeg" : "image/png";
      const blob = await canvas.convertToBlob(
        opts.format === "jpeg"
          ? { type: mime, quality: opts.jpegQuality / 100 }
          : { type: mime },
      );
      const ext = opts.format === "jpeg" ? "jpg" : "png";
      outputs.push({
        filename: `page-${pageNum}.${ext}`,
        mime,
        blob,
      });
    }
    return outputs;
  } finally {
    await doc.destroy();
  }
}
```

`computePageNumbers(rangeInput, pageCount)`: returns `[1..pageCount]` if input is empty, otherwise calls `parseRangeTokens` from `_shared/range.ts` and flattens the per-token indices into a sorted unique 1-indexed list. (Range tokens are already 0-indexed in the parser; convert to 1-indexed for display + pdfjs-dist's API.)

### D9. OptionsPanel

Three controls + 1 conditional:

1. **Format radio:** PNG / JPEG
2. **Resolution dropdown:** screen / print (default) / high-res
3. **JPEG quality slider** (only visible when format === "jpeg"): 1–100, default 90
4. **Page range input:** text field, optional, with syntax validation feedback (mirror pdf-split's panel)

Mirrors `pdf-split/options-panel.tsx` for the range input + syntax feedback. Add the format/scale/quality controls above the range input.

### D10. Sidebar

Append `pdf→image` to `// PDFS` group as the 3rd entry (after merge, split). When pdf→md ships next (Phase 12), it goes 4th.

```ts
{ id: "pdf-to-image", href: "/tools/pdf-to-image", label: "pdf→image", group: "PDFS" }
```

### D11. Registry

One line in `src/engines/_shared/registry.ts`:

```ts
"pdf-to-image": () => import("@/engines/pdf-to-image"),
```

## Invariants preserved

- **No new top-level deps.** `pdfjs-dist` (already in deps for pdf-merge thumbnails). `client-zip` (already in deps for multi-output ZIP).
- **Static export.** New route is a server component shell rendering `<ToolFrame engine={engine} />`; engine module is dynamically imported.
- **CSP.** `pdfjs-dist` requires `'wasm-unsafe-eval'` (already allowed). No `'unsafe-eval'`, no `'unsafe-inline'`. Worker is launched via `new Worker(new URL(...))` — same pattern as other engines.
- **No `fetch` / `XMLHttpRequest`** in engine code. Privacy regression test asserts this.

## Test plan

### Unit tests

- `src/engines/pdf-to-image/index.test.ts` — engine descriptor: id, accept, mime, archiveSuffix, defaults, validate, isReadyToConvert
- `src/engines/pdf-to-image/options-panel.test.tsx` — controls render, JPEG quality only visible when format=jpeg, range syntax validation feedback

### Engine fixture tests

`src/engines/pdf-to-image/index.test.ts` (or split into a worker-level test if it gets large):
- 5-page PDF + empty range → 5 PNG outputs, named `page-1.png` ... `page-5.png`
- 5-page PDF + range `1, 3-4` → 3 PNG outputs, named `page-1.png`, `page-3.png`, `page-4.png`
- 1-page PDF + format=jpeg + quality=80 → 1 JPEG output, named `page-1.jpg`
- Encrypted PDF → throws "pdf-to-image: input PDF is password-protected"

Reuses fixtures: `tests/fixtures/sample-5page.pdf`, `tests/fixtures/sample-encrypted.pdf` (already in tree).

### E2E tests

`tests/e2e/pdf-to-image.spec.ts`:
- Drop 5-page PDF, default options (PNG, print scale, all pages) → 5 outputs visible, ZIP download produces a valid ZIP file
- Same but JPEG format → outputs have `.jpg` extension
- Single-page selection (range "3") → 1 output, no ZIP button
- Encrypted PDF → error banner

`tests/e2e/privacy-regression-pdf-to-image.spec.ts`:
- Standard pattern: capture network requests during conversion, assert zero off-origin

### Gates

`pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e` — all green. Pre-existing webkit `pdf-split.spec.ts:111` flake may surface; note in PR body, don't fix.

## Files (additions / modifications)

**Add:**
- `src/engines/pdf-to-image/index.ts`
- `src/engines/pdf-to-image/index.test.ts`
- `src/engines/pdf-to-image/options.ts`
- `src/engines/pdf-to-image/options-panel.tsx`
- `src/engines/pdf-to-image/options-panel.test.tsx`
- `src/engines/pdf-to-image/worker.ts`
- `src/engines/pdf-to-image/page-numbers.ts` (small helper for `computePageNumbers`)
- `src/engines/pdf-to-image/page-numbers.test.ts`
- `src/app/tools/pdf-to-image/page.tsx`
- `tests/e2e/pdf-to-image.spec.ts`
- `tests/e2e/privacy-regression-pdf-to-image.spec.ts`

**Modify:**
- `src/components/layout/sidebar.tsx` — append pdf→image entry to PDFS group
- `src/engines/_shared/registry.ts` — register pdf-to-image

**Optional new fixture:** none. `tests/fixtures/sample-5page.pdf` and `sample-encrypted.pdf` already exist (committed for pdf-split / pdf-merge tests).

## Out of scope (future)

- Per-page format selection (e.g., page 1 as PNG, page 2 as JPEG)
- Custom DPI numeric input (the 3 presets cover realistic needs)
- Image post-processing (rotation, crop, filters)
- Decryption of password-protected PDFs
- WebP output (could add later — adds one option)
- Progress bar (engine pattern doesn't currently support streaming progress; would need harness changes)

## Coordination note

The other Claude is working on Phase 9 (E2E flake fixes) and Phase 10 (docx-to-pdf) in `~/file_converter-quality/`. Their Phase 10 will also touch:
- `src/components/layout/sidebar.tsx` — add docx-to-pdf entry (1 line)
- `src/engines/_shared/registry.ts` — add docx-to-pdf entry (1 line)

Trivial 3-way merge expected on both files. Whichever PR merges second handles the conflict (just keep both entries).
