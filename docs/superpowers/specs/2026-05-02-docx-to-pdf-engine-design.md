# DOCX → PDF engine — design (Phase 10)

**Status:** draft, pending user review
**Owner:** Tony Yu
**Predecessors:** Phase 7 (home-page redesign + universal-hub retirement, merged at `fc09be2`); master spec `2026-04-30-file-converter-design.md` §5.3

## 0. Goal

Ship a `docx-to-pdf` engine: drop a `.docx` file, click Convert, download a searchable PDF that preserves the document's structure (paragraphs, headings, runs, lists, tables, hyperlinks, inline images, footnotes/endnotes, headers/footers, multi-column layouts, page setup) at standard quality. Privacy invariant unchanged — every byte stays in the browser.

Two structural carry-along changes:

- New deps: `fflate` (zip read), `@pdf-lib/fontkit` (custom font embedding). `mammoth` is **not** used — see §3.1.
- New asset bundle: pre-subset OSS font files (Inter, Lora, JetBrains Mono) committed under `public/fonts/` and lazy-fetched from the worker.

## 1. Scope

### 1.1 Engine surface

- New folder `src/engines/docx-to-pdf/` with the standard `SingleInputEngine` descriptor (mirrors `pdf-split`).
- Inputs: `application/vnd.openxmlformats-officedocument.wordprocessingml.document` and `.docx` extension. Validate rejects non-DOCX MIME and missing extension.
- Output: single `OutputItem` — searchable PDF with embedded subset fonts. Filename rule: `<basename>.pdf` (e.g., `resume.docx` → `resume.pdf`).
- Soft size warn at 25 MB, hard block at 100 MB (master spec §11.1 "Document conversion" caps).

### 1.2 Sidebar

- New `// DOCS` group, single entry `docx→pdf` → `/tools/docx-to-pdf`. Order: IMAGES → PDFS → DOCS in the sidebar (matches the spec's category-ascending convention).

### 1.3 Format support — what's in v1

The OOXML constructs we parse and render:

| OOXML construct | Rendered as | Notes |
|---|---|---|
| `<w:p>` paragraph | Word-wrapped paragraph block | With heading scaling when `pStyle` is `Heading1`–`Heading6` |
| `<w:r>` run | Glyph row, font-aware | Bold (`<w:b/>`), italic (`<w:i/>`), underline (`<w:u/>`), strike (`<w:strike/>`), font (`<w:rFonts>`), size (`<w:sz>`), color (`<w:color>`) |
| `<w:numPr>` numbering reference | Bulleted or ordered list | Reads `word/numbering.xml`; supports nested levels (up to 9) |
| `<w:hyperlink>` | pdf-lib link annotation | Internal anchors and external URLs |
| `<w:tbl>` table | Drawn rectangular grid | With multi-line cell wrap; basic `<w:gridSpan>` (colspan) and `<w:vMerge>` (rowspan) |
| `<w:drawing>` inline image | pdf-lib `drawImage` | PNG, JPEG; positioned inline within the run flow |
| `<w:footnoteReference>` | Footnote marker + bottom-of-page area | Reads `word/footnotes.xml` |
| `<w:endnoteReference>` | Endnote marker + end-of-document area | Reads `word/endnotes.xml` |
| `<w:sectPr>` section properties | Page setup | `<w:pgSz>` (size), `<w:pgMar>` (margins), `<w:cols>` (multi-column), `<w:headerReference>` / `<w:footerReference>` |
| `word/header*.xml`, `word/footer*.xml` | Per-section header/footer | Same paragraph rendering pipeline as body |
| Multi-column flow | Per-column y-cursor with content balancing | Up to 4 columns; respects `<w:cols w:num=…/>` and `<w:cols w:space=…/>` gutter |

### 1.4 Format support — explicit skip-with-warning

Detected on parse, skipped silently in the rendered PDF, surfaced as a one-line warning in the result-list metadata ("3 features unsupported: track changes, equations, drawings"). The conversion does not fail.

- **Track changes** (`<w:ins>`, `<w:del>`, `<w:moveTo>`, `<w:moveFrom>`): applies the *accepted* state — `<w:ins>` content rendered, `<w:del>` content omitted. Comments dropped. (PRD §5.3 already deferred.)
- **Comments** (`<w:commentReference>`): dropped.
- **RTL text** (`<w:bidi/>`, `<w:rtl/>`): pdf-lib has no BiDi engine. Detected, skipped, warning issued.
- **Word equations / OMML** (`<m:oMath>`): no math typesetter. Detected, skipped, warning issued.
- **DrawingML shapes / SmartArt** (`<w:drawing>` with shape children, not inline images): no shape renderer. Detected, skipped, warning issued.
- **Embedded objects** (OLE, ActiveX): always skipped. Privacy-relevant.
- **Form fields** (`<w:fldSimple>`, `<w:fldChar>`): the *current rendered text* is preserved; the field code is dropped.
- **Embedded fonts** (`word/fonts/*.odttf`): we use bundled substitutes regardless. Embedded fonts are obfuscated (Word's ODT extension); decoding is non-trivial and a CSP-irrelevant detail since we never load network fonts.

## 2. Out of scope (deferred to v1.1+)

- RTL text rendering (Arabic, Hebrew). Skip-with-warning in v1.
- Word equations / OMML rendering. Skip-with-warning in v1.
- DrawingML shapes / SmartArt. Skip-with-warning in v1.
- Embedded font extraction (use bundled subs always).
- Page background colors / images / watermarks. Body content only.
- Word's content-aware pagination heuristics (orphan/widow control, keep-with-next, keep-on-same-page). Pure y-cursor naive page-break in v1; revisit if user feedback flags it.
- Custom paragraph indentation beyond first-line indent. (Hanging indents on lists are supported.)
- Drop caps. Rare in personal docs.
- Output filename customization (would require an OptionsPanel; YAGNI for v1).

## 3. Architecture

### 3.1 Why direct OOXML parsing instead of mammoth

[mammoth](https://github.com/mwilliamson/mammoth.js) is the most common DOCX → HTML library. It produces clean, semantic HTML by *stripping* most layout information — section properties, font info, columns, headers/footers, footnote positioning. For a "Standard quality" docx-to-pdf that's expected to handle real personal documents (résumés with two columns, papers with footnotes), mammoth's stripped output is structurally insufficient.

Bypassing mammoth entirely and parsing OOXML directly gives:

- Section properties (multi-column, page setup, headers/footers) without a separate read pass.
- Per-run font information preserved for substitution mapping.
- Footnotes / endnotes positioned correctly.
- Hyperlinks, lists, tables with their original semantics intact.

Bundle math: mammoth is ~150 KB gz + we'd still need a separate DOCX-zip reader for everything mammoth strips. A focused OOXML parser tailored to our supported subset is ~30–50 KB of our own code on top of `fflate` (~10 KB gz). Net smaller, more control.

Trade: we own more code. The DOCX subset we implement is bounded (§1.3, §1.4); the parser is feature-driven, not spec-completion-driven.

### 3.2 fflate-backed DOCX zip read

DOCX is a ZIP container. `fflate` (pure JS, no native modules, ~10 KB gz, MIT, no `eval`) gives us synchronous and async unzip with a tiny worker-compatible API.

```typescript
import { unzipSync, type Unzipped } from "fflate";

function extractDocx(bytes: Uint8Array): Unzipped {
  return unzipSync(bytes);  // sync is fine; DOCX files are small
}
```

ZIP entries we read:

| Path | Purpose |
|---|---|
| `[Content_Types].xml` | Sniff content type to confirm DOCX (vs DOCM with macros — we accept DOCM but ignore VBA project parts) |
| `word/document.xml` | Body paragraphs, runs, tables, sections |
| `word/styles.xml` | Style definitions (Heading1, Normal, etc.) |
| `word/numbering.xml` | List numbering definitions |
| `word/fontTable.xml` | Fonts referenced; informs substitution mapping |
| `word/_rels/document.xml.rels` | Relationship targets (image paths, hyperlink URLs) |
| `word/header*.xml` | Per-section headers |
| `word/footer*.xml` | Per-section footers |
| `word/footnotes.xml` | Footnote definitions |
| `word/endnotes.xml` | Endnote definitions |
| `word/media/*` | Embedded image bytes (decoded by relationship target) |

Anything else (settings.xml, theme/, customXml/, glossary/, vbaProject.bin) is ignored.

### 3.3 OOXML parser

Module tree under `src/engines/docx-to-pdf/docx-parser/`. Each XML file gets its own parser; all share a `types.ts` for the parsed document model.

Parsed document model (sketch — full types in `docx-parser/types.ts`):

```typescript
type ParsedDocx = {
  sections: Section[];           // §3.6 sections from <w:sectPr>
  styles: Map<string, Style>;    // styleId → Style
  numbering: Map<string, NumberingDef>;
  fontTable: Map<string, FontInfo>;
  relationships: Map<string, RelationshipTarget>;
  footnotes: Map<string, ParsedBlock[]>;  // footnote id → blocks
  endnotes: Map<string, ParsedBlock[]>;
  headers: Map<string, ParsedBlock[]>;    // headerId (rId) → blocks
  footers: Map<string, ParsedBlock[]>;
  media: Map<string, MediaAsset>;         // path → bytes + mime
  warnings: string[];                     // skip-with-warning accumulator
};

type Section = {
  pageSize: { widthPt: number; heightPt: number };
  pageMargins: { top: number; right: number; bottom: number; left: number };
  columns: { count: number; spaceBetween: number };  // {count: 1, ...} = single
  headerRefs: { default?: string; first?: string; even?: string };
  footerRefs: { default?: string; first?: string; even?: string };
  blocks: ParsedBlock[];                  // body content for this section
};

type ParsedBlock =
  | Paragraph
  | Table
  | { kind: "skip-with-warning"; reason: string };

type Paragraph = {
  kind: "paragraph";
  styleId?: string;                       // resolves to Style via styles map
  alignment: "left" | "center" | "right" | "justify";
  numPr?: { numId: string; ilvl: number };// list reference
  runs: Run[];
};

type Run = {
  kind: "run";
  text: string;                           // joined <w:t> content
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  fontFamily?: string;                    // raw OOXML font name
  fontSizePt?: number;                    // half-points → pts
  colorHex?: string;
  hyperlinkRel?: string;                  // rId for link annotations
  inlineImage?: { rel: string; widthPt: number; heightPt: number };
  footnoteRef?: string;
  endnoteRef?: string;
};

type Table = {
  kind: "table";
  rows: TableRow[];
  columnWidthsPt: number[];
};

type TableRow = { cells: TableCell[]; heightPt?: number };
type TableCell = {
  blocks: ParsedBlock[];
  gridSpan: number;                       // colspan; default 1
  vMerge: "start" | "continue" | "none";  // rowspan
};
```

XML parsing uses **`fast-xml-parser`** (~30 KB gz, MIT, pure JS, no `eval`, worker-compatible). Configured for namespace-preservation (`w:`, `r:`, `m:`) and attribute capture. Output JSON walked node-by-node into `ParsedBlock`.

The parser is conservative: anything it doesn't recognize gets logged into `warnings` with a structured reason and converted into a `{kind: "skip-with-warning", ...}` placeholder so the layout engine knows to skip cleanly. No throw on unrecognized elements.

### 3.4 HTML walker — not used

This was an early candidate (mammoth → HTML → htmlparser2 walk). Killed in §3.1. Skipping `htmlparser2` from the dep list.

### 3.5 Font strategy

#### Bundled fonts

Three font families, OFL/Apache/SIL licensed (commercial-use OK):

| Family | Source | Weights bundled | Subset | Approx size after subset |
|---|---|---|---|---|
| Inter | rsms.me/inter | Regular, Bold, Italic, Bold Italic | Latin Extended A | ~50 KB × 4 = 200 KB |
| Lora | google fonts (OFL) | Regular, Bold, Italic, Bold Italic | Latin Extended A | ~60 KB × 4 = 240 KB |
| JetBrains Mono | jetbrains.com/lp/mono | Regular, Bold | Latin Extended A | ~40 KB × 2 = 80 KB |

Total: ~520 KB committed under `public/fonts/`. Subset at build time via a one-shot Node script committed at `tools/subset-fonts.mjs` (uses `fonteditor-core` or similar; script committed but not run in CI — fonts are pre-subset in the repo).

Loaded by the worker on first conversion via `fetch("/fonts/<name>.ttf")` (CSP `connect-src 'self'` allows it; same origin for static export). Cached in a worker-module-level `Map<string, ArrayBuffer>` so subsequent conversions on the same worker reuse buffers.

#### Substitution map

```typescript
// fonts/substitution-map.ts
const SUBSTITUTIONS: Record<string, BundledFontFamily> = {
  // Sans-serif → Inter
  "Calibri": "inter",
  "Calibri Light": "inter",
  "Arial": "inter",
  "Helvetica": "inter",
  "Verdana": "inter",
  "Tahoma": "inter",
  "Open Sans": "inter",
  "Roboto": "inter",
  // Serif → Lora
  "Cambria": "lora",
  "Cambria Math": "lora",
  "Times New Roman": "lora",
  "Times": "lora",
  "Georgia": "lora",
  "Garamond": "lora",
  // Monospace → JetBrains Mono
  "Courier New": "jetbrains-mono",
  "Courier": "jetbrains-mono",
  "Consolas": "jetbrains-mono",
  "Monaco": "jetbrains-mono",
  // Default fallback when font name unrecognized
};
const DEFAULT_SUB: BundledFontFamily = "inter";
```

`pickFont(name: string | undefined): BundledFontFamily` returns the substitution. Unrecognized names log a one-time warning per family per conversion.

#### Embedding

Per `pdf-lib`'s docs, custom font embedding requires:

```typescript
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const pdf = await PDFDocument.create();
pdf.registerFontkit(fontkit);
const interRegular = await pdf.embedFont(interRegularBytes, { subset: true });
```

We register fontkit once per worker invocation. `subset: true` ensures only used glyphs ship in the output PDF — keeps output PDF size small even when bundled fonts are 50+ KB each.

### 3.6 Layout engine

The novel piece. Module tree under `src/engines/docx-to-pdf/layout/`. Single-file responsibilities:

```
layout/
├── index.ts                # entry: layoutDocument(parsed: ParsedDocx): PDFBytes
├── types.ts                # PageContext, ColumnContext, LayoutPrimitive
├── y-cursor.ts             # per-column y-cursor tracking + page-break trigger
├── paragraph.ts            # word wrap, line break, alignment, indent
├── runs.ts                 # bold/italic/underline span layout within a line
├── lists.ts                # bullet/number rendering with nesting
├── tables.ts               # rectangular grid w/ cell wrap + colspan/rowspan
├── multi-column.ts         # column-flow with content balancing
├── footnotes.ts            # bottom-of-page footnote area
├── headers-footers.ts      # per-section header/footer layout
├── images.ts               # PNG/JPEG decode + drawImage
└── warnings.ts             # accumulator for unsupported-feature notices
```

#### Pagination model

- A **page** has the page size and margins from the section properties.
- A **column** is a vertical strip within a page — single-column documents have 1 column per page; `<w:cols w:num="2"/>` gives 2 columns side-by-side, etc.
- A **column context** owns a y-cursor (current write position from page top), a max-y (page bottom – footer height – footnote area height), and a "pending blocks" queue.
- Filling a column: pop block from queue → measure block height → if it fits, draw and advance y-cursor; if it doesn't fit but is splittable (paragraph, list, multi-row table), split, draw fitting half, push remainder to next column; if the block is atomic (image, single-line cell), draw on next page if it doesn't fit (or shrink-to-fit at <50% size with a warning if it doesn't fit any column).
- **Column-balancing (v1):** two-pass algorithm. Pass 1 lays out the section single-flow (col 1 fills until exhausted, then col 2, etc.) and records each column's natural height. Pass 2 re-runs the layout with a *balance target height* of `totalNaturalHeight / N`, allowing each column to extend slightly past target only to avoid splitting a paragraph mid-line / a table mid-row (block boundary respected). The implementation lives in `layout/multi-column.ts` as `balance(blocks, columnCount, columnContext)`. Tested with synthetic block streams that exercise even-fill, uneven-fill, and pathological cases (one giant paragraph, sequence of unsplittable images).

#### Page-break trigger

- y-cursor exceeds max-y → start new page (or new column within same page if multi-column and the column index isn't last).
- `<w:br w:type="page"/>` → forced page break.
- `<w:br w:type="column"/>` → forced column break.

#### Multi-column rendering

For a section with `<w:cols w:num="N"/>`:

1. Compute column geometry: `colWidth = (pageWidth - margins - gutter*(N-1)) / N`.
2. Initialize N column contexts, all starting at top of body area.
3. Walk section blocks; for each block, append to column N's queue (default N=0).
4. Within a column, when a column-break or column-fill fires, advance to N+1.
5. When N reaches the last column AND it's full, start a new page with N fresh columns.

Headers and footers are *page-scoped*, not column-scoped. They render once per page above/below the column area.

### 3.7 Worker entry

```typescript
// worker.ts
import * as Comlink from "comlink";
import type { OutputItem } from "@/engines/_shared/types";
import { parseDocx } from "./docx-parser";
import { layoutDocument } from "./layout";

const api = {
  async convertSingle(
    fileBytes: ArrayBuffer,
    fileName: string,
  ): Promise<OutputItem> {
    const parsed = parseDocx(new Uint8Array(fileBytes));
    const pdfBytes = await layoutDocument(parsed);
    return {
      filename: fileName.replace(/\.docx$/i, ".pdf"),
      mime: "application/pdf",
      blob: new Blob([pdfBytes], { type: "application/pdf" }),
    };
  },
};

Comlink.expose(api);
```

Single-input engine, mirrors `pdf-split/worker.ts`. Uses the existing `WorkerHarness.runSingle`.

### 3.8 Engine descriptor

```typescript
const engine: SingleInputEngine<DocxToPdfOptions, OutputItem> = {
  id: "docx-to-pdf",
  inputAccept: [".docx"],
  inputMime: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  outputMime: "application/pdf",
  defaultOptions: defaultDocxToPdfOptions,   // empty object for v1; reserved for future
  cardinality: "single",
  validate(file) {
    const isDocx =
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      file.name.toLowerCase().endsWith(".docx");
    if (!isDocx) return { ok: false, reason: "Expected a .docx file" };
    if (file.size > 100 * 1024 * 1024) return { ok: false, reason: "File exceeds 100 MB" };
    return { ok: true };
  },
  async convert(file, _opts, signal) {
    const harness = new WorkerHarness<DocxToPdfOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    );
    return harness.runSingle(file, _opts, signal);
  },
};
```

No `OptionsPanel` in v1 — there are no user-tunable options for the conversion. The descriptor's `defaultOptions` field is `{}` and reserved for future settings (output filename, page-size override, font-pair override).

## 4. Options

```typescript
export type DocxToPdfOptions = Record<string, never>;
export const defaultDocxToPdfOptions: DocxToPdfOptions = {};
```

Empty in v1. Type kept extensible.

## 5. UI

ToolFrame's existing single-cardinality flow is reused as-is. No new UI components.

The result-list metadata gets one new line for skip-with-warning notices when present:

```
[ DONE ]
resume.pdf — 2 features unsupported: equations, drawings
```

Implementation: extend `OutputItem` with an optional `warnings?: string[]` field (existing tools won't set it; ResultList renders the joined list when present). This is a small, opt-in extension to the existing type.

### 5.1 Sidebar entry

```typescript
// src/components/layout/sidebar.tsx — new group, after PDFS
const TOOLS: ToolEntry[] = [
  // IMAGES (existing)
  // PDFS (existing)
  { id: "docx-to-pdf", href: "/tools/docx-to-pdf", label: "docx→pdf", group: "DOCS" },
];
```

Group iteration order remains "as encountered" — DOCS appears last because it's added last.

### 5.2 Home page

**Phase 10 does NOT add `docx-to-pdf` to the home page.** Phase 7 froze the home-page markup as a four-card 2×2 grid; adding a fifth card without owning the layout redesign would silently reopen that decision. Phase 10 ships sidebar-only access; users reach docx-to-pdf via the `// DOCS` group in the sidebar.

A future phase reworks the home grid (3-wide or paginated) once the tool count justifies it (~6+ tools).

## 6. Validation rules

- Engine `validate(file)`:
  - Wrong MIME and wrong extension → `"Expected a .docx file"`.
  - Size > 100 MB → `"File exceeds 100 MB"`.
  - Else `{ ok: true }`.
- No `isReadyToConvert` — single-cardinality with no options means it's always ready once a file is staged.
- Worker re-validates the zip is a real DOCX (presence of `word/document.xml`); throws `"Not a valid Word document — missing word/document.xml"` if absent.
- Encrypted DOCX (`encryptedPackage` content type): throws `"Word document is password-protected"` — same UX shape as pdf-merge / pdf-split's password-protected handling.

## 7. Output

- One `OutputItem`: `{ filename: "<basename>.pdf", mime: "application/pdf", blob: <PDF bytes>, warnings?: ["…"] }`.
- ResultList renders existing per-row download button + warnings line.
- No archiveSuffix (single output).

## 8. Privacy

Invariant unchanged: zero outbound network during conversion.

- `fflate`: pure JS, no eval, no fetch.
- `fast-xml-parser`: pure JS, no eval, no fetch.
- `@pdf-lib/fontkit`: pure JS, no eval, no fetch.
- `pdf-lib`: already in deps; verified clean in prior phases.
- Bundled fonts: served from `/fonts/` (same origin), `connect-src 'self'` permits the worker fetch. No CDN, no Google Fonts, no third-party.

The existing Biome `no-fetch-in-engines` rule is amended: the lint rule has an allowlist for same-origin font URLs in `src/engines/docx-to-pdf/fonts/load.ts` (whitelist by exact path prefix `/fonts/`). Alternative if that's too special-cased: move font loading to a non-engines module that the worker imports — the lint rule scopes to `src/engines/`, so `src/lib/font-loader.ts` would be lint-allowed. **Lean: move font loading to `src/lib/font-loader.ts`.** Cleaner than special-casing the lint rule.

New E2E privacy-regression spec asserts zero off-origin requests during a representative DOCX → PDF conversion.

## 9. Testing

### 9.1 Unit (vitest, co-located)

- `docx-parser/document-xml.test.ts`: parsing fixtures with paragraphs, runs, lists, tables, sections, hyperlinks. Tabular `it.each`.
- `docx-parser/styles-xml.test.ts`: style inheritance, default styles fallback.
- `docx-parser/numbering-xml.test.ts`: bullet vs decimal vs nested numbering.
- `docx-parser/sections.test.ts`: page size / margin / multi-column extraction; default fallbacks (Letter portrait if missing).
- `fonts/substitution-map.test.ts`: every key in the table maps to expected family; unknown name → DEFAULT_SUB; case-insensitive match.
- `layout/paragraph.test.ts`: word-wrap correctness; alignment cases (left/center/right/justify).
- `layout/y-cursor.test.ts`: page-break trigger; column-break trigger.
- `layout/multi-column.test.ts`: column geometry math; content distribution across N columns.
- `layout/tables.test.ts`: cell rendering; gridSpan/vMerge handling.
- `layout/footnotes.test.ts`: footnote area sizing; reference-marker placement.
- `index.test.ts`: engine `validate` cases (DOCX accepted; non-DOCX rejected; oversized rejected).
- `_shared/registry.test.ts`: append `loadEngine("docx-to-pdf")` test.

### 9.2 Conversion correctness (vitest + real fixtures)

Run the full parser → layout → PDF pipeline in Node against fixture DOCX files. Assert:

- Output bytes start with `%PDF-` and end with `%%EOF`.
- Output page count matches expected (e.g., 3-page DOCX → 3-page PDF).
- Embedded text is searchable: extract via `pdfjs-dist` (already in deps) or `pdf-lib`'s text inspection, verify expected strings appear (`"Tony Yu"` in a résumé fixture, etc.).
- Font subsetting: parse the output PDF, confirm only Inter/Lora/JetBrains-Mono fonts referenced.
- Warnings: equations-fixture surfaces an `equations` warning; drawings-fixture surfaces a `drawings` warning.

### 9.3 E2E (Playwright, all 3 browsers)

`tests/e2e/docx-to-pdf.spec.ts`:

- Happy path: drop simple-paragraphs.docx, click Convert, assert `[ DONE ]`, download, assert `%PDF-` magic + `%%EOF` tail + searchable text.
- Multi-column: drop two-column-resume.docx, convert, download, assert page count + fixture-known-strings appear.
- Tables: drop table-doc.docx, convert, download, assert page count.
- Headers/footers: drop headed-footed.docx, convert, download, assert header-text appears on every page.
- Footnotes: drop footnoted.docx, convert, download, assert footnote markers + text appear.
- Encrypted: drop encrypted.docx, assert error banner with "password-protected".
- Equations / RTL / drawings fixtures: convert, assert `[ DONE ]` + warning text on result row.
- Oversized: assert validate rejects a synthetic >100 MB file.

`tests/e2e/privacy-regression-docx-to-pdf.spec.ts`: zero off-origin during conversion of `simple-paragraphs.docx`.

### 9.4 Fixtures (`tests/fixtures/`)

All committed (each < 50 KB, OOXML compresses well):

- `simple-paragraphs.docx`: 1-page, headings + body paragraphs, no advanced features.
- `multi-page.docx`: 5 pages of paragraphs to exercise pagination.
- `two-column-resume.docx`: 2-column section, contact info on left col, body on right.
- `table-doc.docx`: 2 tables, one with `gridSpan`, one with `vMerge`.
- `headed-footed.docx`: section with header (page number) + footer ("Confidential").
- `footnoted.docx`: 3 footnotes referenced from body.
- `nested-list.docx`: 3-level bulleted list + 2-level numbered list.
- `image-doc.docx`: inline PNG + JPEG.
- `equations-doc.docx`: contains an OMML equation (skipped, warning expected).
- `drawings-doc.docx`: contains a SmartArt diagram (skipped, warning expected).
- `rtl-doc.docx`: contains Arabic paragraph (skipped, warning expected).
- `encrypted.docx`: password-protected. Generated via Word or a one-shot script.

All fixtures generated by a committed script `tests/fixtures/scripts/generate-docx.mjs` using the [`docx`](https://www.npmjs.com/package/docx) npm package (dev-only, not in production deps). Script committed but not run in CI; fixtures pre-generated and committed.

## 10. Edge cases

- **DOCX with zero paragraphs**: outputs a 1-page PDF with empty body. No error.
- **DOCX that's actually a renamed-extension non-DOCX**: zip extraction succeeds (it's a zip), but `word/document.xml` is missing → throw "Not a valid Word document".
- **Paragraph containing only an inline image larger than column**: shrink-to-fit at <100% with a warning.
- **Run with font name we substitute**: silent — the substitution table covers the common cases. Only truly unknown font names emit a warning.
- **Multi-column section followed by single-column section**: section break starts a new page (Word's default). Implement in v1.
- **Document with mixed page sizes across sections**: each section uses its own page size. Implement in v1.
- **Table with gridSpan that exceeds row width**: clamp to row width, log warning.
- **Footnote that itself contains a footnote (Word allows this)**: render the inner footnote inline in the outer footnote — no recursive footnote area.
- **Hyperlink whose target is a `mailto:` or `tel:`**: pdf-lib supports both as URL annotations.
- **Hyperlink to anchor that doesn't exist**: render as plain text, log warning.
- **Image with a relationship target that 404s within the zip**: skip image, log warning, don't fail the whole conversion.

## 11. Bundle accounting

Lazy-loaded only on `/tools/docx-to-pdf`:

| Dep | Size (gz) | Notes |
|---|---|---|
| fflate | ~10 KB | DOCX zip read |
| fast-xml-parser | ~30 KB | OOXML XML parsing |
| @pdf-lib/fontkit | ~70 KB | Custom font embedding |
| pdf-lib | already in deps | reused |
| Our parser code | ~15 KB | docx-parser/ + layout/ source |
| Bundled fonts (TTF, subset) | ~520 KB | served from /public/fonts/, fetched on-demand |
| **Total additional** | **~645 KB** | beyond what's already on the homepage bundle |

Worker-only route bundle: ~125 KB JS (fflate + fast-xml-parser + fontkit + parser/layout). Fonts are async fetches, not in the JS bundle.

## 12. Plan structure preview

Estimated 15 implementation tasks, in dependency order. Estimated 14–17 days end-to-end (multi-column balancing in the layout task adds ~2 days vs the unbalanced fallback considered earlier). Spec + plan land in a separate docs-only PR ahead of the implementation PR.

**Substantive tasks (subagent-suitable, full two-stage review):** 6 (parser part A, parser part B, layout primitives, lists/hyperlinks/tables, multi-column balanced, footnotes+endnotes+headers/footers+orchestrator). The OOXML parser and the multi-column-plus-trailing-constructs were split from single mega-tasks into pairs because each subagent run needs to fit one focused session — a full week of work in one task either runs out of context or quietly cuts corners. **Mechanical tasks (combined opus review):** 9 (deps, fonts, fixtures, font loader, warnings extension, descriptor, route, E2E, final sweep).

1. **Docs commit on impl branch** — spec + plan as first commit (matches Phase 7 pattern).
2. **Install deps** (`fflate`, `fast-xml-parser`, `@pdf-lib/fontkit`). Verify lint, typecheck, build.
3. **Subset bundled fonts + commit** — Inter/Lora/JetBrains-Mono TTF subsets to `public/fonts/`. Commit `tools/subset-fonts.mjs` with SOURCE-of-truth font paths; commit subset outputs.
4. **DOCX fixture generator + fixtures commit** — `tests/fixtures/scripts/generate-docx.mjs` + 12 fixtures listed in §9.4.
5. **OOXML parser** — `docx-parser/` modules: types, document-xml, styles-xml, numbering-xml, sections, relationships, footnotes/endnotes, headers-footers, fontTable. Substantive (full review).
6. **Font loader + substitution map** — `src/lib/font-loader.ts` (worker fetch + cache), `fonts/substitution-map.ts`. Lint-allowlisted location.
7. **Layout engine — paragraph + runs + y-cursor** — `layout/paragraph.ts`, `runs.ts`, `y-cursor.ts`, `images.ts`. Substantive (full review).
8. **Layout engine — lists + hyperlinks + tables** — `layout/lists.ts`, `tables.ts`. Substantive (full review).
9. **Layout engine — multi-column + footnotes + headers/footers** — `layout/multi-column.ts`, `footnotes.ts`, `headers-footers.ts`. Substantive (full review). Most complex single piece.
10. **OutputItem warnings extension** — extend type, ResultList rendering update, opt-in flag.
11. **Engine descriptor + worker entry + registry update** — `index.ts`, `worker.ts`, `_shared/registry.ts` append. Engine-module build probe.
12. **Route + sidebar entry + home-page card** — `app/tools/docx-to-pdf/page.tsx`, sidebar `// DOCS` group, `app/page.tsx` 5th tool card.
13. **E2E specs** — `docx-to-pdf.spec.ts`, `privacy-regression-docx-to-pdf.spec.ts`. Run full suite for regression.
14. **Final gate sweep + push + open PR**.

Substantive (parallel sonnet spec + opus quality review): 5, 7, 8, 9.
Mechanical (combined opus review): 1, 2, 3, 4, 6, 10, 11, 12, 13, 14.

Order matters: 5 must land before 7/8/9 (parser is upstream of layout). 6 (fonts) is independent of 5 and can run parallel. 12 (route) needs 11 (engine descriptor). 13 (E2E) is last because it exercises the full stack.

## 13. Future scope (post-Phase 10)

- RTL text rendering (BiDi engine + Arabic/Hebrew shaping).
- Word equations (KaTeX or MathJax integration; OMML → MathML conversion).
- DrawingML shapes / SmartArt rendering.
- Embedded font extraction (decode Word's ODT-extension obfuscated TTFs).
- Word's content-aware pagination (orphan/widow control, keep-with-next).
- Output filename customization via OptionsPanel.
- Page-size override (force Letter / A4 even when DOCX declares otherwise).
- Watermark stripping option for templates.
- DOCM (macro-enabled) → strip-and-convert pass that explicitly removes VBA before render (currently we ignore VBA implicitly; an explicit option is more honest).
- Document.xml.rels-based external relationships (links to other Word docs in a corpus). Personal use rarely needs this.

## 14. Success criteria

1. `pnpm typecheck && pnpm lint && pnpm test && pnpm build` exit 0 with all new tests passing.
2. New E2E specs pass on Chromium + Firefox + WebKit. Existing E2E suite has zero regressions.
3. Drop a real DOCX résumé (Calibri body, Cambria headings, two-column contact section, basic table) on `/tools/docx-to-pdf`. Convert. Get a downloadable PDF whose content is searchable, whose layout matches the source's structure (column count, headings, lists, hyperlinks, inline images), and whose visual treatment is honest about font substitution (Inter/Lora/JetBrains-Mono in lieu of Calibri/Cambria/Courier).
4. Drop a DOCX with track changes — accepted state renders, no crash, no comments leak.
5. Drop a DOCX with equations — converts successfully, equation regions skipped, warning surfaced on result row.
6. Drop a 100-page DOCX — converts without OOM (< 4 GB worker heap on the 8 GB box).
7. Drop a `.txt` with `.docx` extension — engine `validate` passes (extension match), worker rejects with "Not a valid Word document" on the missing `word/document.xml`.
8. Privacy E2E: zero off-origin network during a DOCX conversion.
9. PR `phase-10-docx-to-pdf → main` opens cleanly; CI green; Vercel preview live.

## 15. Open questions / risks

- **fast-xml-parser performance on large DOCX**: a 100-page DOCX with rich content has ~1 MB of XML. fast-xml-parser's parse-to-JSON step is benchmarked at ~10 MB/s for typical XML. Should comfortably fit within the < 4 s latency target. Verified during Task 5 implementation; if it's slow we revisit (sax-based streaming parser, or hand-rolled state machine).
- **Multi-column balancing fidelity**: our two-pass `naturalHeight / N` algorithm gives visually balanced output for typical content. Word's algorithm is fancier (anticipates orphan/widow rules, anchor positioning, image keep-with-text). We won't match it exactly. Acceptable variance: column heights within ±1 paragraph of each other on real résumés. If a fixture exposes worse, revisit during Task 9.
- **Subset font glyph coverage**: Latin Extended A covers most European personal-use docs. Some user content (Cyrillic, Greek) won't render — characters fall back to `.notdef` (rectangle) glyphs. If this is a real issue, expand subset to Latin Extended B + Cyrillic Basic + Greek Basic at the cost of ~+200 KB total bundle.
- **DOCX format variations across Word versions**: Word's OOXML output has evolved across 2007 / 2010 / 2013 / 2016 / 2019 / 365. Most differences are additive — older versions' OOXML is forward-compatible. v1 targets Word 2013+ output as the primary; older may have edge cases that surface as parser warnings.
- **Font subsetting correctness**: pdf-lib + fontkit's subsetting handles common cases but has known issues with composite glyphs (rare in modern fonts) and some OpenType features. Verified during conversion correctness tests. If a fixture's output PDF fails to render in Acrobat, fall back to `subset: false` with a bundle-cost penalty.
