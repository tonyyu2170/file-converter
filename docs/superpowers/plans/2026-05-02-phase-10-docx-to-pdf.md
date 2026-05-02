# Phase 10 — DOCX → PDF engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task with two-stage review on substantive (architecture-touching) tasks and combined opus review on mechanical extensions. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a client-side `docx-to-pdf` engine that converts Word documents to searchable PDF, preserving paragraphs, headings, runs, lists, hyperlinks, inline images, tables, footnotes/endnotes, headers/footers, multi-column **balanced** layouts, and page setup. Estimated 14–17 days end-to-end.

**Architecture:** Direct OOXML parsing (no mammoth) via `fflate` + `fast-xml-parser`; `pdf-lib` + `@pdf-lib/fontkit` for PDF building with custom-font subset embedding; bundled OSS fonts (Inter, Lora, JetBrains Mono) substituted at conversion time. Worker-only conversion path. Full architecture in spec §3.

**Tech stack additions:**
- Runtime deps: `fflate`, `fast-xml-parser`, `@pdf-lib/fontkit`.
- DevDeps: `fonteditor-core` (font subsetting tool), `docx` (DOCX fixture generator).
- Committed assets: pre-subset TTF font files under `public/fonts/` (~520 KB).

**Spec:** [`docs/superpowers/specs/2026-05-02-docx-to-pdf-engine-design.md`](../specs/2026-05-02-docx-to-pdf-engine-design.md).

**Branch:** `phase-10-docx-to-pdf` (create off updated `main` *after* the docs PR `phase-10-docx-to-pdf-spec` merges).

**Substantive tasks (full two-stage sonnet+opus review):** 4, 5, 7, 8, 9, 10. Each is one focused subagent session. Tasks were sized so a single agent run fits one context window and produces reviewable work; the OOXML parser and the multi-column-plus-trailing-constructs were split into pairs for this reason.

**Mechanical tasks (combined opus review):** 1, 2, 3, 6, 11, 12, 13, 14, 15.

**Critical ordering dependencies:**

- Task 1 (deps) must land first.
- Task 2 (fonts) and Task 3 (DOCX fixtures) are independent of each other but both must land before Task 4 (parser tests need DOCX fixtures; layout tests need fonts).
- Task 4 → Task 5: parser part A is upstream of part B (the body parsers in 5 reuse types and helpers from 4).
- Task 5 → Tasks 7–10: full parser must complete before any layout task.
- Task 6 (font loader) is independent of Tasks 4–5 but must land before Task 7 (layout consumes fonts).
- Tasks 7 → 8 → 9 → 10 are the layout pipeline in order.
- Task 11 (warnings extension) is small; suggested between Task 10 and Task 12 so the engine descriptor in Task 12 can reference it.
- Task 12 (engine descriptor + worker + registry) needs full layout (Task 10).
- Task 13 (route + sidebar) needs Task 12.
- Task 14 (E2E) needs everything else.
- Task 15 is the final gate sweep + push + open PR.

**Branch discipline reminder for implementer subagents:**

- Run `git branch --show-current` BEFORE and AFTER every commit. Verify it reads `phase-10-docx-to-pdf`. STOP if wrong.
- NEVER run: `git branch -m`, `git branch -M`, `git checkout <branch>`, `git switch <branch>`, `git reset --hard`, `git push`, `git push --force`. NEVER use `--no-verify`.
- Allowed: `git status`, `git diff`, `git log`, `git branch --show-current`, `git add <specific files>`, `git commit`, `git rm <specific files>`.
- DO NOT touch `main`. DO NOT rebase. Each task is one commit.

---

## Task 1: Install deps + verify clean baseline

**Goal:** Add three runtime deps and one devDep; verify existing gates still pass.

**Files:** `package.json`, `pnpm-lock.yaml`.

- [ ] **Step 1:** Verify branch.

- [ ] **Step 2:** Add deps.

```bash
pnpm add fflate fast-xml-parser @pdf-lib/fontkit
pnpm add -D fonteditor-core
```

- [ ] **Step 3:** Verify gates clean.

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

- [ ] **Step 4:** Commit.

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): add fflate, fast-xml-parser, @pdf-lib/fontkit

Runtime deps for the docx-to-pdf engine. fflate for DOCX zip
read; fast-xml-parser for OOXML XML parse; @pdf-lib/fontkit
for custom-font subset embedding. fonteditor-core is dev-only,
used by the font-subsetting tool committed in Task 2."
```

---

## Task 2: Subset bundled fonts + commit

**Goal:** Commit pre-subset TTFs for Inter, Lora, JetBrains Mono. Commit the subsetting tool that produced them.

**Files:**
- Add: `tools/subset-fonts.mjs`, `tools/subset-fonts.README.md`.
- Add: `public/fonts/inter-{regular,bold,italic,bold-italic}.ttf`, `public/fonts/lora-{regular,bold,italic,bold-italic}.ttf`, `public/fonts/jetbrains-mono-{regular,bold}.ttf` (Regular may already exist from Phase 1; only add what's missing in TTF format).

- [ ] **Step 1:** Verify branch.

- [ ] **Step 2:** Inventory existing fonts. `ls public/fonts/`.

- [ ] **Step 3:** Write `tools/subset-fonts.mjs`. Reads source TTF/OTF from a documented local path; writes Latin Extended A subsets to `public/fonts/`. Committed but not run in CI; outputs are committed.

- [ ] **Step 4:** Run locally + commit outputs.

```bash
node tools/subset-fonts.mjs
ls -la public/fonts/  # 40-80 KB per file
```

If any subset > 100 KB, tighten the glyph range.

- [ ] **Step 5:** Verify gates. Build should include the new fonts in the static export.

- [ ] **Step 6:** Commit.

```bash
git add public/fonts/ tools/subset-fonts.mjs tools/subset-fonts.README.md
git commit -m "feat(fonts): bundle subset TTFs for docx-to-pdf

Inter, Lora, JetBrains Mono — Latin Extended A subset.
Total ~520 KB committed under public/fonts/. The committed
tool subset-fonts.mjs reproduces the outputs from OSS source
fonts; the tool is not run in CI."
```

---

## Task 3: DOCX fixture generator + fixtures

**Goal:** Generate 12 DOCX fixtures covering the full feature matrix; commit a generator script + the fixture files.

**Files:** `tests/fixtures/scripts/generate-docx.mjs`, 12 `.docx` files in `tests/fixtures/`.

- [ ] **Step 1:** Verify branch.

- [ ] **Step 2:** Add devDep.

```bash
pnpm add -D docx
```

- [ ] **Step 3:** Write generator. Generates the 12 fixtures from spec §9.4. For features the `docx` package can't produce (encrypted, OMML equations, DrawingML), inject by mutating zip contents. Encrypted fixture is generated manually via Word; document this in the script preamble.

- [ ] **Step 4:** Run generator + smoke-check fixtures (open one in Word/LibreOffice).

- [ ] **Step 5:** Verify gates.

- [ ] **Step 6:** Commit.

```bash
git add tests/fixtures/*.docx tests/fixtures/scripts/generate-docx.mjs package.json pnpm-lock.yaml
git commit -m "test(fixtures): add docx-to-pdf DOCX fixtures + generator

12 fixtures covering paragraphs, multi-page, multi-column,
tables, headers/footers, footnotes, nested lists, images,
and the three skip-with-warning categories (equations,
drawings, RTL). Encrypted fixture is manually generated."
```

---

## Task 4: OOXML parser — part A (small parsers)

**Substantive — full two-stage review.**

**Goal:** Implement the small / leaf OOXML parsers. These are short, well-bounded, and feed the body parser in Task 5.

**Files:**
- Add: `src/engines/docx-to-pdf/docx-parser/types.ts` — full type model from spec §3.3 (anchors the entire parser).
- Add: `src/engines/docx-to-pdf/docx-parser/relationships.ts` + test.
- Add: `src/engines/docx-to-pdf/docx-parser/font-table-xml.ts` + test.
- Add: `src/engines/docx-to-pdf/docx-parser/styles-xml.ts` + test.
- Add: `src/engines/docx-to-pdf/docx-parser/numbering-xml.ts` + test.
- Add: `src/engines/docx-to-pdf/docx-parser/sections.ts` + test.

- [ ] **Step 1:** Verify branch.

- [ ] **Step 2:** Implement `types.ts`. Match spec §3.3 exactly.

- [ ] **Step 3:** Implement leaf parsers in this order: relationships → font-table-xml → styles-xml → numbering-xml → sections.

Each module exports `parseFooXml(xmlString, ...context): ParsedFoo`. Use `fast-xml-parser` configured with namespace preservation (`w:`, `r:`).

- [ ] **Step 4:** Per-module tests.

`it.each` tabular tests for each parser:
- Happy path.
- Missing optional fields → defaults applied.
- Malformed XML → safe default + warning, no throw.

- [ ] **Step 5:** Verify gates.

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Test count grows by ~25–35.

- [ ] **Step 6:** Commit.

```bash
git add src/engines/docx-to-pdf/docx-parser/
git commit -m "feat(engines): docx-to-pdf parser — leaf modules

types.ts anchors the full parsed-document model.
relationships, font-table, styles, numbering, sections
are the small / leaf parsers consumed by the body parser
in the next task."
```

---

## Task 5: OOXML parser — part B (body parsers + entry)

**Substantive — full two-stage review.**

**Goal:** Body content parser, footnote/endnote parser, header/footer parser, and the `parseDocx` entry that orchestrates them with Task 4's leaves.

**Files:**
- Add: `src/engines/docx-to-pdf/docx-parser/document-xml.ts` + test (paragraphs, runs, tables, sections from body XML).
- Add: `src/engines/docx-to-pdf/docx-parser/footnotes.ts` + test (footnote/endnote definitions).
- Add: `src/engines/docx-to-pdf/docx-parser/headers-footers.ts` + test.
- Add: `src/engines/docx-to-pdf/docx-parser/index.ts` + test (`parseDocx` entry: unzip → call all parsers → merge).

- [ ] **Step 1:** Verify branch.

- [ ] **Step 2:** Implement `document-xml.ts`. The hardest single module — walks `<w:p>`, `<w:r>`, `<w:tbl>`, `<w:hyperlink>`, `<w:drawing>`, `<w:sectPr>`. Detects skip-with-warning constructs (`<m:oMath>`, `<w:bidi/>`, DrawingML shapes) and emits structured warnings.

- [ ] **Step 3:** Implement `footnotes.ts` and `headers-footers.ts`. Each delegates to `document-xml.ts`'s block-level walker for the footnote / header / footer body content.

- [ ] **Step 4:** Implement `index.ts` `parseDocx(bytes)` orchestrator. Unzips via `fflate.unzipSync`. Calls each parser in dependency order. Merges into `ParsedDocx`.

- [ ] **Step 5:** Per-module tests + parser integration test.

`document-xml.test.ts`: tabular over paragraph/run/table/hyperlink scenarios.
`index.test.ts`: parses all 12 committed DOCX fixtures via `parseDocx`. Snapshot-test the resulting `ParsedDocx` summaries (section count, block count by kind, warning count). Snapshots committed.

- [ ] **Step 6:** Verify gates.

Test count grows by ~30–50.

- [ ] **Step 7:** Commit.

```bash
git add src/engines/docx-to-pdf/docx-parser/
git commit -m "feat(engines): docx-to-pdf parser — body + entry

document-xml walks the body content (paragraphs, runs,
tables, hyperlinks, drawings) and detects skip-with-warning
constructs. footnotes and headers-footers reuse the same
block walker. parseDocx is the entry; full integration test
parses all 12 DOCX fixtures into ParsedDocx snapshots."
```

---

## Task 6: Font loader + substitution map

**Goal:** Worker-fetch + cache for bundled fonts; substitution map from spec §3.5.

**Files:**
- Add: `src/lib/font-loader.ts` + test.
- Add: `src/engines/docx-to-pdf/fonts/types.ts`, `fonts/substitution-map.ts` + test.

- [ ] **Step 1:** Verify branch.

- [ ] **Step 2:** Implement `font-loader.ts`. `loadFontBytes(family, weight, italic)` → `fetch("/fonts/<resolved>.ttf").then(r => r.arrayBuffer())`. Module-level `Map` cache. Lives outside `src/engines/` so the `no-fetch-in-engines` lint rule scopes cleanly.

- [ ] **Step 3:** Implement `substitution-map.ts`. Pure data + `pickFont(name): BundledFontFamily`. Case-insensitive. Unknown name → `DEFAULT_SUB`.

- [ ] **Step 4:** Tests. Mock `fetch` for cache verification; tabular over the substitution table; case-insensitivity assertions.

- [ ] **Step 5:** Verify gates.

- [ ] **Step 6:** Commit.

```bash
git add src/lib/font-loader.ts src/lib/font-loader.test.ts src/engines/docx-to-pdf/fonts/
git commit -m "feat(fonts): font loader + substitution map

Worker-compatible fetch + cache for the bundled Inter/Lora/
JetBrains-Mono TTFs. Substitution map covers Calibri/Arial/
Cambria/Times-NR/Courier-NR → bundled family.

Loader at src/lib/font-loader.ts (outside src/engines) so
no-fetch-in-engines lint rule continues to scope cleanly."
```

---

## Task 7: Layout — paragraph, runs, y-cursor, images

**Substantive — full two-stage review.**

**Goal:** Foundational layout primitives.

**Files:**
- Add: `src/engines/docx-to-pdf/layout/types.ts`.
- Add: `layout/y-cursor.ts` + test.
- Add: `layout/runs.ts` + test (bold/italic/underline/strike/color/font run measurement + draw).
- Add: `layout/paragraph.ts` + test (word-wrap, alignment, first-line indent, paragraph spacing, remainder for split).
- Add: `layout/images.ts` + test (PNG/JPEG embed + shrink-to-fit).

- [ ] **Step 1:** Verify branch.

- [ ] **Step 2:** Implement primitives in dependency order. `types.ts` → `y-cursor.ts` → `runs.ts` → `paragraph.ts` → `images.ts`.

`paragraph.ts` exposes:

```typescript
layoutParagraph(p: Paragraph, ctx: ColumnContext, fonts: EmbeddedFonts):
  { drawnHeight: number; remainder?: Paragraph };
```

The remainder path is what enables column-flow + page-break splitting.

- [ ] **Step 3:** Per-module tests.

`y-cursor.test.ts`: state transitions, multi-page break, column-boundary behavior.
`runs.test.ts`: `widthOfTextAtSize` parity; bold/italic propagation.
`paragraph.test.ts`: word-wrap correctness against fixture strings; alignment math; remainder generation.
`images.test.ts`: shrink-to-fit math; PNG vs JPEG decode.

- [ ] **Step 4:** Verify gates.

- [ ] **Step 5:** Commit.

```bash
git add src/engines/docx-to-pdf/layout/
git commit -m "feat(engines): docx-to-pdf layout primitives

Paragraph word-wrap with multi-run styling; y-cursor with
page-break trigger; PNG/JPEG inline images with shrink-to-fit.
Lists/hyperlinks/tables/multi-column build on these in the
next two tasks."
```

---

## Task 8: Layout — lists, hyperlinks, tables

**Substantive — full two-stage review.**

**Goal:** Higher-level layout constructs.

**Files:**
- Add: `layout/lists.ts` + test (up to 9-level nesting; continuation across pages).
- Add: `layout/hyperlinks.ts` + test (pdf-lib link annotation overlay).
- Add: `layout/tables.ts` + test (rectangular grid; cell wrap; gridSpan; vMerge).

- [ ] **Step 1:** Verify branch.

- [ ] **Step 2:** Implement `lists.ts`. Reads `numPr.numId/ilvl`; consults `numbering` map; renders marker in left gutter + body via `paragraph.ts`. Numbering state persists across page breaks.

- [ ] **Step 3:** Implement `hyperlinks.ts`. External URL → pdf-lib `PDFLink` overlay. Internal anchor → internal jump if target exists, else plain text + warning.

- [ ] **Step 4:** Implement `tables.ts`. Cell wrap via `paragraph.ts` remainder mechanism. `gridSpan` (colspan), `vMerge` (rowspan). Border rectangles drawn after content.

- [ ] **Step 5:** Per-module tests + verify gates.

- [ ] **Step 6:** Commit.

```bash
git add src/engines/docx-to-pdf/layout/
git commit -m "feat(engines): docx-to-pdf lists, hyperlinks, tables

Lists support 9-level nesting and continuation across page
boundaries. Hyperlinks become pdf-lib link annotations.
Tables render as rectangular grids with cell wrap, gridSpan,
and vMerge."
```

---

## Task 9: Layout — multi-column (balanced)

**Substantive — full two-stage review. Most complex single task.**

**Goal:** Two-pass balanced multi-column algorithm per spec §3.6.

**Files:**
- Add: `layout/multi-column.ts` + test.

- [ ] **Step 1:** Verify branch.

- [ ] **Step 2:** Implement two-pass algorithm:

**Pass 1 (natural fill):** lay blocks into a single very-tall column; record `naturalHeight`.

**Pass 2 (balance):** reset; compute `balanceTarget = naturalHeight / N`; fill N columns with the constraint: switch column when `currentHeight >= balanceTarget` AND next block's start is a clean break (paragraph / list-item / table-row boundary). If unsplittable (image), allow ±15% overshoot.

- [ ] **Step 3:** Tests. Synthetic block streams covering:
- Even fill (3 paragraphs of equal size).
- Uneven fill (1 long + many short).
- Pathological: single giant paragraph (no clean breaks → return pass-1 result + `unbalanced-by-design` warning).
- Pathological: one image larger than `balanceTarget` (overshoot allowed).
- Empty section (no-op).

- [ ] **Step 4:** Verify gates.

- [ ] **Step 5:** Commit.

```bash
git add src/engines/docx-to-pdf/layout/multi-column.ts src/engines/docx-to-pdf/layout/multi-column.test.ts
git commit -m "feat(engines): docx-to-pdf multi-column balanced layout

Two-pass algorithm: pass 1 measures natural fill, pass 2
re-fills with naturalHeight/N target while honoring block
boundaries. Up to 4 columns with gutter spacing.

Pathological inputs (single giant paragraph, oversized image)
fall back to pass-1 output with a structured warning."
```

---

## Task 10: Layout — footnotes, endnotes, headers/footers, orchestrator

**Substantive — full two-stage review.**

**Goal:** Bottom-of-page footnote area; end-of-document endnotes; per-section headers/footers; the `layoutDocument` orchestrator.

**Files:**
- Add: `layout/footnotes.ts` + test (handles both `<w:footnoteReference>` and `<w:endnoteReference>`).
- Add: `layout/headers-footers.ts` + test.
- Add: `layout/index.ts` + integration test (`layoutDocument(parsed): Promise<Uint8Array>` orchestrator).
- Add: `layout/warnings.ts` (small; warning accumulator).

- [ ] **Step 1:** Verify branch.

- [ ] **Step 2:** Implement `footnotes.ts`. Reserve footnote area in `y-cursor.ts` `max-y` calculation. Markers superscript at reference site; footnote text rendered via `paragraph.ts` at page bottom with hairline separator. Endnotes collect to a final dedicated "Endnotes" page.

- [ ] **Step 3:** Implement `headers-footers.ts`. Per-section `<w:headerReference>` / `<w:footerReference>` with first/even/default variants per OOXML.

- [ ] **Step 4:** Implement `layout/index.ts` orchestrator:

1. Create `PDFDocument`, register fontkit, embed all bundled fonts (`subset: true`).
2. For each section in `parsed.sections`:
   - `columns.count === 1` → single-column flow.
   - Else → invoke `multi-column.ts` balance pipeline.
3. Render headers/footers per page; render footnotes when present.
4. Return `pdf.save()`.

- [ ] **Step 5:** Integration test. Run `layoutDocument` against parsed fixtures from Task 5; assert output is `%PDF-...%%EOF`, expected page counts, embedded text searchable.

- [ ] **Step 6:** Verify gates.

- [ ] **Step 7:** Commit.

```bash
git add src/engines/docx-to-pdf/layout/
git commit -m "feat(engines): docx-to-pdf footnotes, headers/footers, orchestrator

Footnotes render at page bottom; the area's height reserves
column max-y. Endnotes collect to a final dedicated page.
Headers/footers render per-section with first/even/default
variants. layoutDocument(parsed) is the worker entry's call
target — full pipeline from ParsedDocx to PDF bytes."
```

---

## Task 11: OutputItem warnings extension

**Goal:** Extend `OutputItem` with `warnings?: string[]`. Surface in `ResultList`.

**Files:**
- Modify: `src/engines/_shared/types.ts`.
- Modify: `src/components/result-list.tsx` + test.

- [ ] **Step 1:** Verify branch.

- [ ] **Step 2:** Append `warnings?: string[]` to `OutputItem`. Optional; existing engines unaffected.

- [ ] **Step 3:** ResultList renders extra line below filename when `warnings.length > 0`: `— ${warnings.length} features unsupported: ${warnings.slice(0, 3).join(", ")}${warnings.length > 3 ? ", …" : ""}`.

- [ ] **Step 4:** Tests cover no-warnings, 1–3 warnings, 4+ warnings (truncation).

- [ ] **Step 5:** Verify gates.

- [ ] **Step 6:** Commit.

```bash
git add src/engines/_shared/types.ts src/components/result-list.tsx src/components/result-list.test.tsx
git commit -m "feat(types): OutputItem.warnings opt-in field

Engines that detect skipped features (docx-to-pdf seeing
equations or drawings it can't render) attach a warnings
array to the output. ResultList renders a tight one-line
notice. Existing engines unaffected — field is optional."
```

---

## Task 12: Engine descriptor + worker entry + registry

**Goal:** Wire parser + layout into the standard engine descriptor + Comlink worker. Append registry entry.

**Files:**
- Add: `src/engines/docx-to-pdf/index.ts`, `index.test.ts`, `options.ts`, `worker.ts`.
- Modify: `src/engines/_shared/registry.ts`, `_shared/registry.test.ts`.

- [ ] **Step 1:** Verify branch.

- [ ] **Step 2:** Implement `options.ts` and `index.ts`. Mirror `pdf-split/index.ts` shape. `validate` per spec §6. No `OptionsPanel`.

- [ ] **Step 3:** Implement `worker.ts`:

```typescript
import * as Comlink from "comlink";
import { parseDocx } from "./docx-parser";
import { layoutDocument } from "./layout";

const api = {
  async convertSingle(fileBytes: ArrayBuffer, fileName: string) {
    const parsed = parseDocx(new Uint8Array(fileBytes));
    const pdfBytes = await layoutDocument(parsed);
    const item: OutputItem = {
      filename: fileName.replace(/\.docx$/i, ".pdf"),
      mime: "application/pdf",
      blob: new Blob([pdfBytes], { type: "application/pdf" }),
    };
    if (parsed.warnings.length > 0) item.warnings = parsed.warnings;
    return item;
  },
};

Comlink.expose(api);
```

- [ ] **Step 4:** Append registry entry + load test.

- [ ] **Step 5:** Engine-module build probe. `pnpm build`; inspect chunk size — confirm ~125 KB JS for the route.

- [ ] **Step 6:** Verify gates.

- [ ] **Step 7:** Commit.

```bash
git add src/engines/docx-to-pdf/index.ts src/engines/docx-to-pdf/index.test.ts src/engines/docx-to-pdf/options.ts src/engines/docx-to-pdf/worker.ts src/engines/_shared/registry.ts src/engines/_shared/registry.test.ts
git commit -m "feat(engines): docx-to-pdf engine descriptor + worker

Single-cardinality engine wired through WorkerHarness.runSingle.
The worker owns the full parse + layout pipeline; the descriptor
is small. Registry append + load test."
```

---

## Task 13: Route + sidebar entry

**Goal:** Make the engine reachable. Add `/tools/docx-to-pdf` page; sidebar entry under new `// DOCS` group. **No home-page card** — Phase 7 froze the home grid; home redesign waits for a future phase (~6+ tools).

**Files:**
- Add: `src/app/tools/docx-to-pdf/page.tsx`.
- Modify: `src/components/layout/sidebar.tsx`.

- [ ] **Step 1:** Verify branch.

- [ ] **Step 2:** Add the route page. Mirror `src/app/tools/pdf-split/page.tsx`:

```typescript
"use client";
import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/docx-to-pdf";
export default function DocxToPdfPage() {
  return <ToolFrame engine={engine} />;
}
```

- [ ] **Step 3:** Sidebar update. Append a new `DOCS` group with one entry `docx→pdf`. Iteration order remains IMAGES → PDFS → DOCS.

- [ ] **Step 4:** Verify gates. Build should produce 8 routes (was 7 after Phase 7).

- [ ] **Step 5:** Commit.

```bash
git add src/app/tools/docx-to-pdf/page.tsx src/components/layout/sidebar.tsx
git commit -m "feat(ui): docx-to-pdf route + sidebar entry

New /tools/docx-to-pdf route reachable via the sidebar's
new // DOCS group. Home-page card deliberately not added in
this phase — Phase 7 froze the home grid markup; home
redesign waits for a separate phase once tool count grows."
```

---

## Task 14: E2E specs

**Goal:** Conversion correctness + privacy regression for docx-to-pdf.

**Files:**
- Add: `tests/e2e/docx-to-pdf.spec.ts`.
- Add: `tests/e2e/privacy-regression-docx-to-pdf.spec.ts`.

- [ ] **Step 1:** Verify branch.

- [ ] **Step 2:** Write `docx-to-pdf.spec.ts` per spec §9.3. One `test(...)` per scenario:
- Happy path (simple-paragraphs.docx).
- Multi-column (two-column-resume.docx).
- Tables (table-doc.docx).
- Headers/footers (headed-footed.docx).
- Footnotes (footnoted.docx).
- Encrypted (rejected with "password-protected").
- Equations / drawings / RTL fixtures (DONE + warning text on result row).
- Oversized (rejected pre-conversion).

Assertions: `%PDF-` + `%%EOF`; page count via `pdf-lib` `PDFDocument.load` in test runner; searchable text via `pdfjs-dist`'s text-extraction; warning text present.

- [ ] **Step 3:** Write `privacy-regression-docx-to-pdf.spec.ts`. Mirror existing privacy specs; assert zero off-origin during conversion of `simple-paragraphs.docx`.

- [ ] **Step 4:** Run E2E.

**Coordinate with the user before running** — ask "OK to run E2E?" if another Claude session may be active.

```bash
pnpm test:e2e --project=chromium tests/e2e/docx-to-pdf.spec.ts
pnpm test:e2e tests/e2e/docx-to-pdf.spec.ts tests/e2e/privacy-regression-docx-to-pdf.spec.ts
pnpm test:e2e   # full suite regression check
```

- [ ] **Step 5:** Commit.

```bash
git add tests/e2e/docx-to-pdf.spec.ts tests/e2e/privacy-regression-docx-to-pdf.spec.ts
git commit -m "test(e2e): docx-to-pdf happy path + privacy + edge cases

Covers happy path, multi-column résumé, tables, headers/footers,
footnotes, encrypted-DOCX rejection, oversized rejection, and
the three skip-with-warning categories. Plus privacy regression."
```

---

## Task 15: Final gate sweep + push + open PR

- [ ] **Step 1:** Verify branch + log.

```bash
git branch --show-current  # phase-10-docx-to-pdf
git log main..HEAD --oneline  # expect: 14 commits (Tasks 1–14)
git status  # clean
```

- [ ] **Step 2:** Full gate sweep. Coordinate with user before E2E.

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e
```

- [ ] **Step 3:** Bundle size check.

```bash
ls -la out/_next/static/chunks/ | head -20
```

Confirm docx-to-pdf chunk is in expected ~125 KB range (compressed).

- [ ] **Step 4:** Manual Chrome smoke (controller, not subagent).

```bash
pnpm dev
```

Visit `http://localhost:3000/tools/docx-to-pdf`:
1. Drop a real `.docx`. Click `[ convert ]`. Verify download.
2. Inspect output PDF: searchable? layout reasonable? font substitution clean?
3. Multi-column DOCX → balanced columns.
4. Footnoted DOCX → footnotes at page bottom.
5. Equations DOCX → DONE + warning on result row.
6. Non-`.docx` → validation error.

If anything looks off, screenshot and discuss before pushing.

- [ ] **Step 5:** Push and open PR.

```bash
git push -u origin phase-10-docx-to-pdf
gh pr create --title "Phase 10: docx-to-pdf engine + custom-font + multi-column" --body "$(cat <<'EOF'
## Summary

- New \`docx-to-pdf\` engine: client-side DOCX → searchable PDF with paragraphs, headings, runs, lists, hyperlinks, inline images, tables, footnotes/endnotes, headers/footers, multi-column **balanced** layouts, and page setup. Privacy invariant unchanged.
- Direct OOXML parsing (no mammoth) via fflate + fast-xml-parser.
- Custom font embedding via @pdf-lib/fontkit + bundled OSS subsets (Inter, Lora, JetBrains Mono).
- New \`// DOCS\` sidebar group. **No home-page card** — Phase 7 froze the grid; home redesign deferred to a future phase.
- Skip-with-warning for RTL, equations, DrawingML — surfaces in result-row metadata.

Spec: \`docs/superpowers/specs/2026-05-02-docx-to-pdf-engine-design.md\`
Plan: \`docs/superpowers/plans/2026-05-02-phase-10-docx-to-pdf.md\`

## Commits

1. chore(deps): add fflate, fast-xml-parser, @pdf-lib/fontkit
2. feat(fonts): bundle subset TTFs
3. test(fixtures): docx-to-pdf DOCX fixtures + generator
4. feat(engines): docx-to-pdf parser — leaf modules
5. feat(engines): docx-to-pdf parser — body + entry
6. feat(fonts): font loader + substitution map
7. feat(engines): docx-to-pdf layout primitives
8. feat(engines): docx-to-pdf lists, hyperlinks, tables
9. feat(engines): docx-to-pdf multi-column balanced layout
10. feat(engines): docx-to-pdf footnotes, headers/footers, orchestrator
11. feat(types): OutputItem.warnings opt-in
12. feat(engines): docx-to-pdf engine descriptor + worker
13. feat(ui): docx-to-pdf route + sidebar entry
14. test(e2e): docx-to-pdf happy path + privacy + edge cases

## Manual smoke checklist

\`\`\`bash
pnpm dev
\`\`\`

1. \`/tools/docx-to-pdf\` accepts a .docx drop.
2. Convert produces a downloadable searchable PDF.
3. Multi-column section renders balanced.
4. Footnotes appear at page bottom.
5. Headers/footers render per page.
6. Equations/drawings/RTL fixtures produce DONE + warning text on the result row.
7. Encrypted DOCX surfaces password-protected error.
8. Sidebar // DOCS group present; home page unchanged at 4 cards.

## Test plan

- [x] \`pnpm typecheck\`
- [x] \`pnpm lint\`
- [x] \`pnpm test\` — net delta ~+150 unit tests
- [x] \`pnpm build\` — 8 routes, docx-to-pdf chunk ~125 KB
- [x] \`pnpm test:e2e\` — new specs + zero regressions
- [ ] Manual Chrome smoke (deferred to reviewer per checklist above)
EOF
)"
```

Expected: PR URL is returned. Do NOT merge — that's the user's call.
