# pdf → md engine — design

**Date:** 2026-05-02
**Phase:** 12 (the second new engine in this stream after Phase 11's pdf-to-image)
**Scope:** New conversion engine that extracts text from a PDF and emits a single Markdown file with **heuristic structure detection** — font-size-based heading levels, list-marker recognition, bold/italic emphasis, paragraph reflow. Single-output engine, no `archiveSuffix`.

## Background

PDFs are "text painted on a canvas" — no semantic structure. Phase 11 (pdf-to-image) is mechanical because rendering a page to canvas doesn't require interpreting the content. PDF → Markdown is fundamentally harder: we have to *guess* what's a heading, what's a list, what's a paragraph break.

The Phase 11 design discussion offered three honest scopes:
- **Scope A** — extract plaintext, paragraph breaks only, output as `.md` (functionally `.txt` with a misleading extension)
- **Scope B** — heuristic markdown with font-size-based headings, list detection, emphasis from font weight (CHOSEN)
- **Scope C** — investigate an existing library

Scope B sits in the middle: meaningfully better than plaintext, doesn't pretend to be a perfect converter. The output will be good for plain prose PDFs, mediocre for complex layouts (multi-column, tables, forms). Limitations are documented in section "Honest limitations" below and will be visible in the engine's options-panel description.

## Decisions

### D1. Engine shape — single-output

`SingleInputEngine<PdfToMdOptions, OutputItem>`. One PDF in → one `.md` file out. No `archiveSuffix` (no multi-output ZIP needed). Cardinality `"single"`. Mirrors image-convert's structure, not pdf-split's.

### D2. Options — minimal

Single option: `pageBreaks: "horizontal-rule" | "none"`.

- `"horizontal-rule"` (default): emit `---\n\n` between pages
- `"none"`: pages run together; only paragraph breaks separate content

Heuristic detection (heading levels, lists, emphasis, paragraph reflow) is **always on**. No toggles. The detection IS the value prop of this engine; toggling it off would just be Scope A in disguise.

```ts
export type PdfToMdOptions = {
  pageBreaks: "horizontal-rule" | "none";
};

export const defaultPdfToMdOptions: PdfToMdOptions = {
  pageBreaks: "horizontal-rule",
};
```

### D3. Filename

`<basename>.md` — strip the `.pdf` extension (case-insensitive), append `.md`. Examples:
- `report.pdf` → `report.md`
- `Annual_Report_2025.PDF` → `Annual_Report_2025.md`

### D4. Encrypted PDFs — error out

Same posture as pdf-split / pdf-to-image. Throws `"pdf-to-md: input PDF is password-protected"`.

### D5. Algorithm — five stages

#### Stage 1: text extraction

Use `pdfjs-dist`'s `page.getTextContent()` per page. Each item has:
- `str` — the text
- `transform` — 6-element matrix; `[3]` is the Y baseline, `[0]` and `[3]` give scale (font size)
- `fontName` — internal font reference; resolve via `commonObjs.get(fontName)` or use the name string directly to detect Bold/Italic markers

Group items by Y baseline (within ±2 units tolerance) into **lines**. Each line carries:
- `text: string` — concatenated item strings (space-separated when items don't already end with whitespace)
- `fontSize: number` — modal item height (most common size in the line)
- `bold: boolean` — true if majority of items have "Bold" in fontName
- `italic: boolean` — true if majority of items have "Italic" or "Oblique" in fontName
- `y: number` — baseline Y (for sort + paragraph-gap detection)

#### Stage 2: heading-level clustering

Across the entire document (all pages), collect the per-line `fontSize` values. Determine the body font size as the **mode** (most-frequently-occurring size). Anything ≥ body × 1.4 is a heading candidate.

Cluster heading-candidate font sizes into up to 3 buckets (largest → `#`, next → `##`, smallest heading → `###`). Cap at h3 — markdown supports more, but heuristic-driven h4+ is rarely meaningful.

Lines that aren't heading candidates are body text.

#### Stage 3: list-marker detection

For each line, examine the leading characters (after stripping leading whitespace):
- `•`, `*`, `-`, `–`, `—` followed by a space → unordered list item, output `- <rest>`
- `\d+\.` or `\d+\)` followed by a space → ordered list item, output `<n>. <rest>`
- `[a-z]\)` or `[ivx]+\.` (lowercase roman) → also unordered, output `- <rest>` (loses sublist semantics — markdown's lettered list support is non-standard)

If no list marker, the line is a paragraph fragment (or heading per Stage 2).

#### Stage 4: emphasis annotation

When emitting a line, wrap text in `**...**` if `bold === true` and `*...*` if `italic === true`. If both, `***...***`. Combined emphasis is line-level, not item-level (item-level inline emphasis is hard to detect reliably in pdfjs output).

Headings already imply visual weight; don't double-wrap heading text in `**`.

#### Stage 5: paragraph reflow + page-break emission

Within a page:
- Lines are sorted top-to-bottom by Y
- Consecutive lines whose Y gap is ≤ 1.5 × line-height (line-height = current line's `fontSize` × 1.2) → same paragraph (joined with single space)
- Larger gap → paragraph break (blank line in markdown)
- Heading lines always get a blank line before AND after
- List items group: consecutive list lines stay grouped (no blank line between them); break out of the list when a non-list line appears

Between pages:
- If `pageBreaks === "horizontal-rule"`: emit `\n\n---\n\n`
- If `pageBreaks === "none"`: emit `\n\n` (treat as paragraph break)

### D6. Module structure

Pure-function helpers tested in isolation; one orchestrator + one worker:

| File | Responsibility |
|---|---|
| `extract-text.ts` | pdfjs-dist adapter — page → array of `Line` objects |
| `cluster-font-sizes.ts` | array of font sizes → `{ body: number; headings: number[] }` mapping (purely numeric, no PDF) |
| `detect-list-marker.ts` | line text → `{ kind: "unordered" | "ordered" | "none"; rest: string; ordinal?: number }` |
| `format-line.ts` | Line + classification → markdown string fragment |
| `to-markdown.ts` | orchestrator — pages of Lines + opts → final markdown string |
| `worker.ts` | Comlink-exposed worker; loads pdfjs-dist, drives `extract-text` + `to-markdown` |
| `index.ts` | engine descriptor |
| `options.ts` | options type + defaults |
| `options-panel.tsx` | UI: page-breaks radio + a small "limitations" disclosure block |

### D7. OptionsPanel — minimal + honest disclosure

Two visible elements:
1. **Page breaks radio:** `horizontal-rule` (default) / `none`. `data-testid="pdf-to-md-page-breaks"`
2. **Limitations disclosure** (small fg-very-muted text below the radio): a one-line explainer like `// best-effort heuristic — multi-column / tables / forms degrade gracefully`. Not a `<details>` widget — just static text. Sets honest expectations without burying the option.

No `range-input` — pdf-to-md always processes the whole document. (A range input could be added in v2 if "extract pages 5-10 as markdown" becomes a real ask.)

### D8. Sidebar position

Append to `// PDFS` group as 4th entry (after Phase 11's pdf→image lands): `merge`, `split`, `pdf→image`, `pdf→md`.

```ts
{ id: "pdf-to-md", href: "/tools/pdf-to-md", label: "pdf→md", group: "PDFS" },
```

## Honest limitations (documented for users)

These belong in the limitations disclosure on the OptionsPanel, in the spec, and possibly in the README:

- **Multi-column layouts:** pdfjs returns text in painting order, not reading order. A two-column PDF will interleave columns into garbled paragraphs.
- **Tables:** become flat sequential paragraphs (each cell becomes its own paragraph). Structure is lost.
- **Forms:** field labels and input boxes appear as scattered text. Not really convertible.
- **Images and diagrams:** not extracted. Only text content makes it through.
- **Footnotes / headers / footers:** appear inline with body text in the order they were painted. No separation.
- **Hyphenated line breaks:** `prob-\nlem` stays as `prob- lem` after reflow. De-hyphenation is its own subfield and is deferred.
- **Right-to-left text:** items have a `dir` property, but v1 ignores it. Output will be in painting order regardless of script direction.

## Invariants preserved

- **No new top-level deps.** pdfjs-dist already in deps for pdf-merge thumbnails (and pdf-to-image as of Phase 11).
- **Static export.** New route is a server-component shell rendering `<ToolFrame engine={engine} />`.
- **CSP.** pdfjs-dist requires `'wasm-unsafe-eval'` (already allowed). No new exceptions needed.
- **No `fetch` / `XMLHttpRequest`** in engine code — privacy regression test asserts this.

## Test plan

### Unit tests (heuristic helpers — pure functions, easy to test against fabricated data)

- `cluster-font-sizes.test.ts`:
  - Single font size → body, no headings
  - One dominant + a few larger → body identified, larger sizes → headings (1-3 levels)
  - Outlier handling (rare giant font on cover page → still becomes h1)
  - Empty input → `{ body: 0, headings: [] }`

- `detect-list-marker.test.ts`:
  - Bullet markers (`•`, `*`, `-`, `–`, `—`) → unordered, rest stripped
  - Numbered markers (`1.`, `2)`, `12.`) → ordered with ordinal extracted
  - Lowercase letter / roman markers → unordered (graceful degrade)
  - No marker → none
  - Marker without trailing space (e.g., `1.foo`) → none (avoid false positives on decimal numbers in body text)

- `format-line.test.ts`:
  - Body line → text as-is
  - Heading-1 line → `# text`
  - Bold line → `**text**`
  - Italic line → `*text*`
  - Bold + italic → `***text***`
  - Heading line that's also bold → just `# text` (no double wrap)
  - List line (unordered) → `- text`
  - List line (ordered) → `1. text` (using detected ordinal)

- `to-markdown.test.ts`:
  - Empty pages → empty string
  - One page of body lines, no gaps → single paragraph
  - One page with gap-separated lines → multiple paragraphs separated by blank lines
  - Heading line → blank line before + after
  - Two pages with `pageBreaks: "horizontal-rule"` → `---` between
  - Two pages with `pageBreaks: "none"` → just paragraph break

`extract-text.ts` won't have a unit test (it's a pdfjs-dist adapter; depends on real PDF input). Coverage comes from E2E.

### Engine descriptor tests

`src/engines/pdf-to-md/index.test.ts`:
- id, accept, mime, defaults, validate (PDF mime / .pdf extension), isReadyToConvert (always true)

### E2E tests

`tests/e2e/pdf-to-md.spec.ts`:
- Drop `sample-5page.pdf`, click Convert → `.md` file downloads, basename matches `sample-5page.md`
- Verify output starts with reasonable markdown content (not empty, contains some text from the fixture)
- Switch `pageBreaks` to `"none"` → output does NOT contain `---`
- Encrypted PDF → error banner

`tests/e2e/privacy-regression-pdf-to-md.spec.ts`:
- Standard pattern: drop fixture, capture network, click Convert, await DONE, assert zero off-origin requests/WebSockets

### Gates

`pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e` — all green. Pre-existing webkit `pdf-split.spec.ts:111` flake may surface; note in PR body, don't fix.

## Files (additions / modifications)

**Add:**
- `src/engines/pdf-to-md/index.ts`
- `src/engines/pdf-to-md/index.test.ts`
- `src/engines/pdf-to-md/options.ts`
- `src/engines/pdf-to-md/options-panel.tsx`
- `src/engines/pdf-to-md/options-panel.test.tsx`
- `src/engines/pdf-to-md/worker.ts`
- `src/engines/pdf-to-md/extract-text.ts`
- `src/engines/pdf-to-md/cluster-font-sizes.ts`
- `src/engines/pdf-to-md/cluster-font-sizes.test.ts`
- `src/engines/pdf-to-md/detect-list-marker.ts`
- `src/engines/pdf-to-md/detect-list-marker.test.ts`
- `src/engines/pdf-to-md/format-line.ts`
- `src/engines/pdf-to-md/format-line.test.ts`
- `src/engines/pdf-to-md/to-markdown.ts`
- `src/engines/pdf-to-md/to-markdown.test.ts`
- `src/app/tools/pdf-to-md/page.tsx`
- `tests/e2e/pdf-to-md.spec.ts`
- `tests/e2e/privacy-regression-pdf-to-md.spec.ts`

**Modify:**
- `src/components/layout/sidebar.tsx` — append pdf-to-md entry to PDFS group
- `src/engines/_shared/registry.ts` — register pdf-to-md
- `src/engines/_shared/registry.test.ts` — add pdf-to-md loadEngine test

## Coordination note

Two parallel work streams will conflict on `sidebar.tsx`, `registry.ts`, `registry.test.ts`:

- Phase 11 (pdf-to-image) — PR #18, mergeable, adds entries to PDFS group
- Phase 12 (pdf-to-md) — this branch, adds entries to PDFS group
- Phase 10 (docx-to-pdf) — other Claude's branch, adds new `// DOCS` group with one entry

All conflicts are "keep both new entries" merges — mechanical, no semantic interaction. Whoever merges third resolves all three.

Phase 12 was branched off `main` while #18 is still open, so this branch's `sidebar.tsx` does NOT have the pdf-to-image entry. After #18 merges, this branch needs a rebase OR the merge conflict gets resolved by adding pdf-to-image alongside pdf-to-md.

## Out of scope (future)

- Page range input (process whole document only in v1)
- De-hyphenation
- Multi-column reading-order detection
- Table detection
- Image extraction (PDF embedded images → markdown image references with alt text)
- Footnote / header / footer separation
- RTL text handling
- Front-matter generation (PDF metadata → YAML)
