# Phase 15 — Small engines: image-resize, docx-to-txt, markdown-to-pdf, txt-to-pdf

Phase 15 of the file_converter roadmap. Four PRD §5 engines that are
each small enough on their own that bundling them into one phase is
cheaper than four sequential phases. None require new abstractions —
each is a `SingleInputEngine` (single output) that drops cleanly into
the existing pattern.

## 1. Scope

Four new engines, each registered in `src/engines/_shared/registry.ts`,
each with a route under `src/app/tools/<id>/`, each surfaced on the
home page TOOLS grid and in the sidebar:

| Engine id | Route | Input accept | Output | Phase 14 category |
|---|---|---|---|---|
| `image-resize` | `/tools/image-resize` | `.png .jpg .jpeg .webp .heic .heif` | image (matches input; HEIC outputs PNG) | `image` |
| `docx-to-txt` | `/tools/docx-to-txt` | `.docx` | `text/plain` | `document` |
| `markdown-to-pdf` | `/tools/markdown-to-pdf` | `.md .markdown` | `application/pdf` | `document` |
| `txt-to-pdf` | `/tools/txt-to-pdf` | `.txt` | `application/pdf` | `document` |

All four are `SingleInputEngine`. None need a `StagingArea`. None
need `estimateOutputBytes` (text/PDF/image transcodes are content-
dependent — better to opt out per the Phase 14 PR #22 contract).

Sidebar grouping: `image-resize` → IMAGES; the other three → DOCS.
No new sidebar group introduced for two text-input engines.

## 2. Out of scope (this phase)

- Markdown extensions: tables, footnotes, definition lists,
  task lists, GFM-flavored syntax. CommonMark core only.
- Markdown-to-PDF table-of-contents generation.
- Image-resize multi-output (e.g., generate 1×, 2×, 3× at once).
- Image-resize crop / rotation / aspect-ratio preset list.
- DOCX-to-txt formatting markers (no `#` headings, no `*` bold).
  Output is plain text, not Markdown.
- TXT-to-PDF font / size / color customization. Monospace 11pt only.
- Per-engine font customization. Defaults are pinned per engine.
- "Save as default" UX for any options. Phase 16 (`use-prefs`)
  introduces the persistence layer.

## 3. Architecture

### 3.1 Shared modules

Two new `_shared` modules so the four engines don't duplicate work.

**`src/engines/_shared/docx/`** — DOCX parsing, lifted out of
`src/engines/docx-to-pdf/`.

The existing `docx-parser.ts` (and any pure-parser dependencies
like the `fast-xml-parser` calls) moves to `_shared/docx/`. The
PDF-specific code (`layout/`, `discard-page.ts`, etc.) stays
inside `docx-to-pdf/`. `docx-to-pdf/worker.ts` updates its import.
`docx-to-txt/worker.ts` imports the same parser.

This makes `_shared/docx/` the canonical home for any future engine
that needs to read DOCX (DOCX → Markdown, DOCX → HTML, etc.).

**`src/engines/_shared/pdf-page-setup/`** — page-size constants and
helpers shared by `markdown-to-pdf` and `txt-to-pdf`.

```ts
export type PdfPageSize = "letter" | "a4" | "legal";

export const PAGE_SIZES_PT: Record<PdfPageSize, [number, number]> = {
  letter: [612, 792],
  a4: [595, 842],
  legal: [612, 1008],
} as const;

export const DEFAULT_MARGIN_PT = 72; // 1 inch

export function getPageDimensions(size: PdfPageSize): [number, number] {
  return PAGE_SIZES_PT[size];
}
```

**`src/engines/_shared/fonts/`** — subsetted font assets shared by
`markdown-to-pdf` and `txt-to-pdf`. Three fonts:

- `source-serif-pro-subset.ttf` — body (markdown-to-pdf only)
- `source-sans-subset.ttf` — headings (markdown-to-pdf only)
- `jetbrains-mono-subset.ttf` — code blocks (markdown-to-pdf) + verbatim text (txt-to-pdf)

Subsetting via the existing `subset-font` dev dependency. Each
file ≤ ~100 KB committed. Estimated total: ~250 KB across the three.

### 3.2 `image-resize`

Single-input engine, single output.

**Options:**
```ts
type ImageResizeOptions = {
  width: number;     // value in px or %, depending on mode
  height: number;
  mode: "px" | "percent";
  lockAspectRatio: boolean;
};

const defaultImageResizeOptions: ImageResizeOptions = {
  width: 1920,
  height: 1080,
  mode: "px",
  lockAspectRatio: true,
};
```

**Worker behavior:**
1. Decode input via the existing `decodeImage` helper (handles HEIC).
2. Compute target dimensions:
   - If `mode === "percent"`, target = `(source × value / 100)`.
   - If `mode === "px"`, target = `(width, height)` directly.
   - If `lockAspectRatio`, **only the width input drives the output**;
     the height is computed from the source aspect ratio. The user-
     supplied height is ignored when lock is on. (See §3.6 for the
     UX rationale — chose worker-side lock over panel-side
     auto-update to avoid extending `OptionsPanelProps`.)
3. Validate target dimensions: reject if < 1px or > 16384px on either
   axis (canvas hard limit).
4. Draw to `OffscreenCanvas` at target dimensions with
   `imageSmoothingQuality: "high"`. Encode via `canvas.convertToBlob`.
5. Output MIME = input MIME, except HEIC inputs output `image/png`
   (no HEIC encoder in canvas).

**Filename:** `vacation.jpg` → `vacation-1280x720.jpg`. Resolution
suffix prevents collision with the original on auto-download.

**Options panel:** width/height number inputs (gated on mode), mode
toggle (`px` / `%`), lock-aspect-ratio toggle. When `lockAspectRatio`
is on, the height input is greyed out with placeholder `auto`.
Note text: `heic outputs png`.

### 3.3 `docx-to-txt`

Single-input engine, single output.

**Options:**
```ts
type DocxToTxtOptions = {
  joinParagraphs: "double-newline" | "single-newline";
};

const defaultDocxToTxtOptions: DocxToTxtOptions = {
  joinParagraphs: "double-newline",
};
```

**Worker behavior:**
1. Call `parseDocx(bytes)` from `_shared/docx/`.
2. Walk paragraphs, runs, and tables. Emit text:
   - Paragraphs joined by `\n\n` (or `\n` if `joinParagraphs: "single-newline"`).
   - Within a paragraph, runs joined directly (no separator).
   - Headings emit only their text content — no `#` markers.
   - Lists emit their item text on its own line, no bullet glyph.
   - Tables: cells joined by `\t`, rows by `\n`. Tables and surrounding
     paragraphs separated by `\n\n` regardless of the join option.
   - Hyperlinks emit anchor text only (no URL, no markdown link syntax).
   - Image runs: skipped (no placeholder).
3. Empty DOCX → empty string output. No error.

**Filename:** `report.docx` → `report.txt`. Output MIME `text/plain`.

**Options panel:** one `<select>` for `joinParagraphs` with the two
modes labeled `// blank line between paragraphs` and `// single line`.

### 3.4 `markdown-to-pdf`

Single-input engine, single output.

**Options:**
```ts
type MarkdownToPdfOptions = {
  pageSize: PdfPageSize;
};

const defaultMarkdownToPdfOptions: MarkdownToPdfOptions = {
  pageSize: "letter",
};
```

**Worker behavior:**
1. Parse markdown via `markdown-it` (default options, no plugins).
2. Convert the token stream to a flat block list:
   `heading | paragraph | list-item | code-block | hr | blockquote |
   image-placeholder`. Inline formatting (bold/italic/code/link) is
   collapsed into per-block run lists with style flags.
3. Render via `pdf-lib`:
   - Page size from option, portrait, 1" margins on all sides.
   - Body: Source Serif Pro 11pt, line-height 14pt.
   - Headings: Source Sans 14/18/22/26/32/38pt for h6→h1.
   - Code (inline + blocks): JetBrains Mono 10pt.
   - Code blocks syntax-highlighted via `highlight.js` core +
     lazy-imported language modules: `javascript`, `typescript`,
     `python`, `bash`, `json`. Highlight tokens map to a small
     palette: keyword (accent), string (muted), comment (very-muted).
   - Lists: bulleted with `·` glyph (matches brutalist aesthetic),
     indented 18pt.
   - Hr: hairline rule, 0.5pt.
   - Blockquote: indented 24pt, italic.
   - Inline links rendered as underlined accent-color text. URL is
     emitted inline in parentheses after the link text *only if* the
     URL differs from the visible text (e.g., `[click here](https://example.com)`
     → `click here (https://example.com)`; `<https://example.com>` → just
     the URL, no parens).
   - Image references: emit a placeholder line `[image: <alt-text>]`.
     Embedding actual images deferred (would require fetching/decoding
     external URLs, which violates the privacy guarantee).
4. Pagination: simple top-to-bottom flow. New page when next block
   would overflow the bottom margin.

**Filename:** `notes.md` → `notes.pdf`. Output MIME `application/pdf`.

**Options panel:** one `<select>` for `pageSize` (letter / a4 / legal).

### 3.5 `txt-to-pdf`

Single-input engine, single output.

**Options:**
```ts
type TxtToPdfOptions = {
  pageSize: PdfPageSize;
};

const defaultTxtToPdfOptions: TxtToPdfOptions = {
  pageSize: "letter",
};
```

**Worker behavior:**
1. Read input as UTF-8 text.
2. Split on `\n`. Tabs in each line expand to 4 spaces.
3. Render verbatim in JetBrains Mono 11pt, line-height 14pt:
   - Page size from option, portrait, 1" margins.
   - Wrap long lines at the right margin (character-width measured
     against the monospace font; no word-break heuristic, just
     hard-wrap at the column limit).
   - Blank input lines render as blank PDF lines.
   - No formatting interpretation — `**bold**` renders as the
     six literal characters.
4. Pagination: same top-to-bottom flow as `markdown-to-pdf`.

**Filename:** `notes.txt` → `notes.pdf`. Output MIME `application/pdf`.

**Options panel:** one `<select>` for `pageSize`.

### 3.6 Aspect-ratio lock — design rationale (image-resize)

The current `OptionsPanelProps` shape exposes only `value` and
`onChange`. It does not give the panel access to the staged file,
so the panel cannot read source dimensions to live-update a locked
height when width changes.

Two ways to support aspect lock:

- **A) Worker-side lock.** When `lockAspectRatio: true`, only the
  width input matters; the worker computes output height from the
  source aspect ratio. The height input is greyed out in the panel
  with a placeholder `auto`.
- **B) Extend `OptionsPanelProps` with optional `stagedFile`.** The
  panel decodes the file (via `Image.naturalWidth/Height` or
  `createImageBitmap`) and live-updates the locked height.

Phase 15 chooses **A**. The engine pattern stays unchanged. UX is
"lock means width drives height," which reads naturally. **B** is the
right choice if two or more future engines need source metadata in
the panel — not the case today.

### 3.7 Routes + home grid + sidebar

Four new route files under `src/app/tools/<id>/page.tsx`, each
following the existing one-liner pattern (load engine, render
ToolFrame).

Home page TOOLS array (`src/app/page.tsx`) gains 4 entries; total goes
7 → 11. Grid is `grid-cols-1 md:grid-cols-2`, so 11 entries = 6 rows
on desktop. Acceptable for v1; future engine adds may motivate
`md:grid-cols-3`.

Sidebar (`src/components/layout/sidebar.tsx`) gains 4 entries:
- IMAGES group: + `image resize`
- DOCS group: + `docx→txt`, `markdown→pdf`, `txt→pdf`

Existing tests assert `TOOLS.length` and group membership — both
will need updates.

## 4. Dependencies

New runtime dependencies (lazy-loaded per engine):

- `markdown-it` (~50 KB) — for `markdown-to-pdf`. Lazy-loaded.
- `highlight.js` core + 5 language registers (~70 KB total) — for
  `markdown-to-pdf`. Lazy-loaded.

No other engine adds a runtime dep. `pdf-lib`, `fflate`,
`fast-xml-parser`, and `subset-font` are already installed.

`subset-font` is used at build time (or in a one-off subset script
under `scripts/`) to emit the committed font subsets. The font
files themselves are committed binary assets, not generated at
install time.

## 5. UI surface

Per-engine `OptionsPanel` components (4 new), each minimal:

- `image-resize`: width / height number inputs, mode toggle
  (`px` / `%`), lock-aspect-ratio checkbox. ~60 LOC.
- `docx-to-txt`: one `<select>` for paragraph join. ~30 LOC.
- `markdown-to-pdf`: one `<select>` for page size. ~30 LOC.
- `txt-to-pdf`: one `<select>` for page size. ~30 LOC.

Visual style follows the existing brutalist conventions (hairline
borders, mono uppercase labels, accent-colored selected states).
No gradients, no rounded corners.

The four route pages are one-liners that load the engine and
render `<ToolFrame engine={engine} />`. Existing engine routes
follow this pattern verbatim — copy and adapt.

## 6. Testing strategy

### 6.1 Unit (Vitest)

Per existing engine convention (co-located test files):

`src/engines/_shared/docx/index.test.ts` — relocation guard. Use a
committed DOCX fixture from the existing docx-to-pdf suite. Assert
`parseDocx(bytes)` returns the same paragraph count / first-paragraph
text it did before the move. Tripwire only — detailed parser
behavior tests already exist in `docx-to-pdf/`.

`src/engines/_shared/pdf-page-setup/index.test.ts` — assert
`getPageDimensions("letter")` → `[612, 792]`, etc.

`src/engines/image-resize/index.test.ts` — engine metadata (id,
inputAccept, inputMime, outputMime, category, defaults), filename
rewrite logic.

`src/engines/image-resize/worker.test.ts`:
- 1000×500 PNG, request `width: 200, height: 100, mode: "px",
  lockAspectRatio: false` → output is 200×100.
- Same input, request `width: 200, lockAspectRatio: true` → output is
  200×100 (height auto-computed).
- Same input, request `width: 50, mode: "percent",
  lockAspectRatio: false` → output is 500×250.
- HEIC fixture → output MIME is `image/png`.
- Out-of-range dims (0, 16385) → validation rejects with reason.

`src/engines/docx-to-txt/index.test.ts` — engine metadata, filename
swap.

`src/engines/docx-to-txt/worker.test.ts`:
- A simple paragraph DOCX → text matches the source paragraphs
  joined by `\n\n`.
- A DOCX with bold and italic runs → text omits formatting markers
  (no `#`, no `**`, no `*`).
- A DOCX with a 2×2 table → cells joined by `\t`, rows by `\n`.
- A DOCX with a heading and a body paragraph → heading text appears
  before the body paragraph, separated by `\n\n`.
- An empty DOCX → empty string output, no error.

`src/engines/markdown-to-pdf/index.test.ts` — engine metadata,
filename swap, default page size.

`src/engines/markdown-to-pdf/worker.test.ts`:
- Minimal markdown fixture (heading + paragraph + list + code block +
  hr + link) → output is a valid PDF (parseable by `pdf-lib`),
  page count > 0.
- Heading text appears in the rendered PDF (extract via `pdf-lib`'s
  text iteration).
- Code block in a registered language → rendered (don't assert
  highlight color, just that the code text is present).
- Page size option → output PDF dimensions match expected
  (`letter` → `[612, 792]`, etc.).

`src/engines/txt-to-pdf/index.test.ts` — engine metadata, filename
swap.

`src/engines/txt-to-pdf/worker.test.ts`:
- Short text → 1-page PDF, text content present.
- 200-char single line → wraps to multiple visual lines (assert page
  has more lines than the input had).
- Tab character → expands to 4 spaces.
- Empty input → 1-page PDF, no text content.

`src/components/page.test.tsx` — extend to assert all 11 tool cards
render and link to correct routes.

`src/components/layout/sidebar.test.tsx` — extend to assert the 4
new sidebar entries appear in the right groups.

### 6.2 E2E (Playwright)

Per-engine specs:

`tests/e2e/image-resize.spec.ts` — drop a fixture, set 100×100, click
Convert, assert download with the suffixed filename, decode via the
download stream and assert pixel dimensions.

`tests/e2e/docx-to-txt.spec.ts` — drop a fixture, click Convert,
assert download contains a known paragraph text.

`tests/e2e/markdown-to-pdf.spec.ts` — drop a markdown fixture, click
Convert, assert PDF download is non-empty and parseable.

`tests/e2e/txt-to-pdf.spec.ts` — drop a text fixture, click Convert,
assert PDF download is non-empty.

Per-engine privacy-regression specs (instances of the existing
pattern):

- `tests/e2e/privacy-regression-image-resize.spec.ts`
- `tests/e2e/privacy-regression-docx-to-txt.spec.ts`
- `tests/e2e/privacy-regression-markdown-to-pdf.spec.ts`
- `tests/e2e/privacy-regression-txt-to-pdf.spec.ts`

Each asserts zero off-origin requests during the entire flow.

### 6.3 Fixtures to add (committed, < 100 KB each)

- `tests/fixtures/sample-1000x500.png` — for image-resize tests if
  none of the existing PNG fixtures match.
- `tests/fixtures/sample.md` — minimal markdown with each construct
  (heading, paragraph, list, code, hr, link, blockquote).
- `tests/fixtures/sample.txt` — minimal text including a long line
  for wrap testing.

Reuse where possible:
- HEIC fixture exists already (`sample.heic`).
- DOCX fixtures exist already in the docx-to-pdf test suite.

### 6.4 Bundle assertion

CI's existing bundle-size check (if present) verifies that loading
`/tools/markdown-to-pdf` doesn't pull markdown/highlight onto any
other route. If a check doesn't exist yet, this phase doesn't add
one — the lazy-load pattern is enforced by the registry's dynamic
imports, which is structural.

## 7. Files to create / modify

**Create (engines):**

```
src/engines/_shared/docx/index.ts                  (re-export from new location)
src/engines/_shared/docx/index.test.ts             (relocation guard)
src/engines/_shared/pdf-page-setup/index.ts
src/engines/_shared/pdf-page-setup/index.test.ts
src/engines/_shared/fonts/source-serif-pro-subset.ttf
src/engines/_shared/fonts/source-sans-subset.ttf
src/engines/_shared/fonts/jetbrains-mono-subset.ttf

src/engines/image-resize/index.ts
src/engines/image-resize/options.ts
src/engines/image-resize/options-panel.tsx
src/engines/image-resize/options-panel.test.tsx
src/engines/image-resize/worker.ts
src/engines/image-resize/index.test.ts
src/engines/image-resize/worker.test.ts

src/engines/docx-to-txt/index.ts
src/engines/docx-to-txt/options.ts
src/engines/docx-to-txt/options-panel.tsx
src/engines/docx-to-txt/options-panel.test.tsx
src/engines/docx-to-txt/worker.ts
src/engines/docx-to-txt/index.test.ts
src/engines/docx-to-txt/worker.test.ts

src/engines/markdown-to-pdf/index.ts
src/engines/markdown-to-pdf/options.ts
src/engines/markdown-to-pdf/options-panel.tsx
src/engines/markdown-to-pdf/options-panel.test.tsx
src/engines/markdown-to-pdf/worker.ts
src/engines/markdown-to-pdf/index.test.ts
src/engines/markdown-to-pdf/worker.test.ts

src/engines/txt-to-pdf/index.ts
src/engines/txt-to-pdf/options.ts
src/engines/txt-to-pdf/options-panel.tsx
src/engines/txt-to-pdf/options-panel.test.tsx
src/engines/txt-to-pdf/worker.ts
src/engines/txt-to-pdf/index.test.ts
src/engines/txt-to-pdf/worker.test.ts
```

**Create (routes):**

```
src/app/tools/image-resize/page.tsx
src/app/tools/docx-to-txt/page.tsx
src/app/tools/markdown-to-pdf/page.tsx
src/app/tools/txt-to-pdf/page.tsx
```

**Create (E2E + fixtures):**

```
tests/e2e/image-resize.spec.ts
tests/e2e/docx-to-txt.spec.ts
tests/e2e/markdown-to-pdf.spec.ts
tests/e2e/txt-to-pdf.spec.ts
tests/e2e/privacy-regression-image-resize.spec.ts
tests/e2e/privacy-regression-docx-to-txt.spec.ts
tests/e2e/privacy-regression-markdown-to-pdf.spec.ts
tests/e2e/privacy-regression-txt-to-pdf.spec.ts
tests/fixtures/sample-1000x500.png
tests/fixtures/sample.md
tests/fixtures/sample.txt
```

**Modify:**

```
src/engines/_shared/registry.ts          (4 new entries)
src/engines/docx-to-pdf/worker.ts        (import parseDocx from new location)
src/engines/docx-to-pdf/(parser tests)   (update import path)
src/app/page.tsx                         (4 new TOOLS entries)
src/app/page.test.tsx                    (count assertion + link assertions)
src/components/layout/sidebar.tsx        (4 new entries)
src/components/layout/sidebar.test.tsx   (link assertions)
package.json                             (markdown-it, highlight.js)
pnpm-lock.yaml                           (regenerated)
```

**Move (no logical change):**

```
src/engines/docx-to-pdf/docx-parser.ts → src/engines/_shared/docx/docx-parser.ts
```

(plus any pure-parser dependencies that don't belong inside docx-to-pdf)

## 8. Migration / rollout

No flag, no migration. Each engine is an independent route; until
its registry entry, route file, sidebar entry, and home-page entry
all land, the engine isn't reachable.

The DOCX parser relocation is a same-PR refactor. After the move,
`docx-to-pdf` and `docx-to-txt` both import from `_shared/docx/`.
CI is the gate.

## 9. Success criteria

1. Each of the four engines is reachable from the home grid and
   sidebar, decodes its input, and produces a valid output.
2. `image-resize` correctly preserves source aspect ratio when
   `lockAspectRatio` is on, regardless of the user-supplied height.
3. `docx-to-txt` produces text that matches the document's reading
   order (paragraphs in order, table cells in row-major order),
   without formatting markers.
4. `markdown-to-pdf` renders all CommonMark core constructs into a
   valid PDF, with code blocks syntax-highlighted in the five named
   languages.
5. `txt-to-pdf` produces a valid PDF with verbatim text in JetBrains
   Mono 11pt, with long lines wrapped at the right margin.
6. All four privacy-regression specs pass: zero off-origin requests
   during conversion.
7. Existing test suite stays green; new unit + E2E coverage is
   green.
8. Bundle: opening any single tool route does not pull bytes from
   another tool's bundle (verified by the existing dynamic-import
   pattern; no new lazy-loading work needed).
