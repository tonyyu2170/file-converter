# Phase 12 — pdf → md engine (heuristic markdown)

**Goal:** New conversion engine that extracts PDF text and emits Markdown with heuristic structure detection (font-size headings, list markers, bold/italic, paragraph reflow). Single PR.

**Spec:** [`docs/superpowers/specs/2026-05-02-pdf-to-md-engine.md`](../specs/2026-05-02-pdf-to-md-engine.md).

**Branch:** `phase-12-pdf-to-md` (off `main` while Phase 11's PR #18 is still open — small merge conflict on sidebar/registry expected when both land).

**Critical ordering:**
- Task 1 (spec + plan) first
- Task 2 (helper modules + their tests) before Task 3 (worker uses them)
- Task 3 (engine + worker + options + panel + tests) is the substantive task
- Task 4 (route + sidebar + registry) before Task 5 (E2E needs route)
- Task 5 (E2E + privacy regression) last before final gates

**Branch discipline:** stay on `phase-12-pdf-to-md`. Allowed git: `git status`, `git diff`, `git log`, `git branch --show-current`, `git add <specific files>`, `git commit`. NEVER `git checkout`, `git switch`, `git push --force`, `--no-verify`.

---

## Task 1: Commit spec + plan

```bash
git branch --show-current  # phase-12-pdf-to-md
git add docs/superpowers/specs/2026-05-02-pdf-to-md-engine.md docs/superpowers/plans/2026-05-02-phase-12-pdf-to-md.md
git commit -m "docs(phase-12): spec + plan for pdf → md engine"
```

---

## Task 2: Heuristic helper modules + unit tests

**Goal:** Build the pure-function helpers that implement the markdown heuristics. Each helper is independently testable against fabricated data — no PDF needed.

**Files (8 new):**
- `src/engines/pdf-to-md/cluster-font-sizes.ts` + `.test.ts`
- `src/engines/pdf-to-md/detect-list-marker.ts` + `.test.ts`
- `src/engines/pdf-to-md/format-line.ts` + `.test.ts`
- `src/engines/pdf-to-md/to-markdown.ts` + `.test.ts`

### Step 1: Decide the shared `Line` type

Create a shared type used by `extract-text.ts` (Task 3) and consumed by `format-line.ts` + `to-markdown.ts`:

```ts
// inline at the top of to-markdown.ts (or a small shared type file inside the engine folder)
export type Line = {
  text: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  y: number;
};
```

Co-locate this type — don't add to `_shared/types.ts` (it's engine-internal).

### Step 2: `cluster-font-sizes.ts`

```ts
export type FontSizeClassification = {
  body: number;
  headings: number[]; // largest → smallest, max 3 entries
};

export function clusterFontSizes(sizes: number[]): FontSizeClassification {
  // 1. If empty: { body: 0, headings: [] }
  // 2. Compute mode (most frequent size, rounded to 1 decimal)
  // 3. Anything >= mode * 1.4 is a heading candidate
  // 4. Sort heading candidates descending, dedupe, keep top 3
}
```

Tests:
- Empty array → `{ body: 0, headings: [] }`
- All same size [12, 12, 12, 12] → `{ body: 12, headings: [] }`
- Body + 1 heading [12, 12, 12, 12, 18] → `{ body: 12, headings: [18] }`
- Body + 2 heading levels [12]×10 + [16]×2 + [22]×1 → `{ body: 12, headings: [22, 16] }`
- 4+ heading levels → only top 3 kept
- Outlier giant font on cover [12]×100 + [40] → `{ body: 12, headings: [40] }`

### Step 3: `detect-list-marker.ts`

```ts
export type ListMarker =
  | { kind: "unordered"; rest: string }
  | { kind: "ordered"; ordinal: number; rest: string }
  | { kind: "none" };

export function detectListMarker(text: string): ListMarker;
```

Heuristics:
- Strip leading whitespace
- If starts with `•`, `*`, `-`, `–`, `—` followed by `\s+` → unordered, `rest` = everything after the marker + whitespace
- If matches `^\d+\.\s+` or `^\d+\)\s+` → ordered with `ordinal` = parsed integer
- If matches `^[a-z]\)\s+` or `^[ivx]+\.\s+` (lowercase roman) → unordered (graceful degrade)
- Otherwise → none

Important: marker MUST be followed by whitespace. `1.5` (decimal in body text) should return `none`, not `{ kind: "ordered", ordinal: 1, rest: "5" }`.

Tests:
- Each marker type produces the expected result
- Marker without trailing space → none
- Decimal numbers in body text → none
- Empty / whitespace-only input → none

### Step 4: `format-line.ts`

```ts
import type { Line } from "./to-markdown"; // or wherever Line lives
import type { FontSizeClassification } from "./cluster-font-sizes";

export function formatLine(line: Line, classification: FontSizeClassification): string;
```

Logic:
1. Determine heading level from `line.fontSize` against `classification.headings` (1-indexed: heading[0] → `#`, heading[1] → `##`, heading[2] → `###`)
2. If list marker detected (call `detectListMarker(line.text)`), produce list-prefixed line; skip emphasis wrapping (lists are body-level, no emphasis on the marker)
3. Otherwise:
   - If heading: `${"#".repeat(level)} ${text}` — no emphasis wrap
   - If body: wrap in `**...**` / `*...*` / `***...***` per bold/italic flags

Tests cover each branch.

### Step 5: `to-markdown.ts`

```ts
import type { Line } from "./to-markdown"; // or sibling
import type { PdfToMdOptions } from "./options"; // forward-declare or define inline; Task 3 also defines this

export type Page = Line[];

export function toMarkdown(pages: Page[], opts: PdfToMdOptions): string;
```

Orchestrator:
1. Flatten all lines, collect their fontSizes, call `clusterFontSizes`
2. For each page:
   a. Sort lines by `y` ascending (top to bottom)
   b. Walk lines; group into paragraphs based on Y-gap heuristic (gap > 1.5 × line-height = paragraph break)
   c. Group consecutive list lines into a "list block" (no blank line between)
   d. Headings get blank line before AND after
3. Join pages: between each, emit `\n\n---\n\n` if `pageBreaks === "horizontal-rule"`, else `\n\n`
4. Trim trailing whitespace; ensure single trailing newline

Tests cover each major case from spec section "Test plan / unit tests / to-markdown".

### Gates

```bash
pnpm typecheck && pnpm lint && pnpm test src/engines/pdf-to-md/
```

If Biome formatting complains, run `pnpm exec biome check --write src/engines/pdf-to-md/`.

### Commit

```bash
git add src/engines/pdf-to-md/
git commit -m "feat(pdf-to-md): heuristic helpers + unit tests"
```

---

## Task 3: Engine + worker + options + options-panel + tests (substantive)

**Goal:** Wire the helpers into a working engine. Substantive task — gets two-stage review.

**Files (6 new):**
- `src/engines/pdf-to-md/options.ts`
- `src/engines/pdf-to-md/options-panel.tsx`
- `src/engines/pdf-to-md/options-panel.test.tsx`
- `src/engines/pdf-to-md/extract-text.ts`
- `src/engines/pdf-to-md/worker.ts`
- `src/engines/pdf-to-md/index.ts`
- `src/engines/pdf-to-md/index.test.ts`

### Reference files (read these first)

- `src/engines/pdf-to-image/index.ts` — closest analog for engine descriptor (single PDF input)
- `src/engines/pdf-to-image/worker.ts` — closest analog for worker structure + `loadPdfJs` pattern + encrypted-PDF detection
- `src/engines/pdf-merge/render-thumbnail.ts` — same `loadPdfJs` lazy-loading helper
- `src/engines/image-convert/index.ts` — single-output engine descriptor (returns `Promise<OutputItem>` not `Promise<OutputItem[]>`)

### Step 1: `options.ts`

Per spec D2 — single option, defaults `{ pageBreaks: "horizontal-rule" }`.

### Step 2: `extract-text.ts`

pdfjs-dist adapter. Takes a `pdfjs.PDFPageProxy` and returns a `Page` (`Line[]`).

```ts
import type { Line, Page } from "./to-markdown"; // wherever Line/Page live

export async function extractTextFromPage(page: PDFPageProxy): Promise<Page>;
```

Logic:
1. `const content = await page.getTextContent({ disableCombineTextItems: false })`
2. For each item, derive: `text = item.str`, `fontSize = Math.abs(item.transform[3])` (or `item.height` if available), `y = item.transform[5]`, fontName lookup
3. Determine bold/italic from fontName: `/bold/i` and `/italic|oblique/i`
4. Group items by Y baseline (within ±2 unit tolerance) into Lines
5. For each Line: text = items joined with space (collapse double spaces), fontSize = mode of item heights, bold = majority of items bold, italic = majority of items italic, y = baseline (mean Y)
6. Sort lines by Y descending? — pdfjs Y origin is bottom-left; bigger Y = higher on page. Sort descending = top-to-bottom. (Verify by inspecting actual values from a fixture.)

This module is the only one in pdf-to-md that touches pdfjs-dist directly. Keep its scope tight.

No unit test for this file (depends on pdfjs-dist runtime which doesn't run cleanly in jsdom). Coverage from E2E.

### Step 3: `worker.ts`

```ts
import * as Comlink from "comlink";
import type { OutputItem } from "@/engines/_shared/types";
import { extractTextFromPage } from "./extract-text";
import { toMarkdown, type Page } from "./to-markdown";
import type { PdfToMdOptions } from "./options";

type PdfJsModule = typeof import("pdfjs-dist");
let pdfJsModulePromise: Promise<PdfJsModule> | undefined;
let workerConfigured = false;

async function loadPdfJs(): Promise<PdfJsModule> {
  // identical pattern to pdf-merge/render-thumbnail.ts and pdf-to-image/worker.ts
}

const api = {
  async convertSingle(
    fileBytes: ArrayBuffer,
    fileName: string,
    _fileType: string,
    opts: PdfToMdOptions,
  ): Promise<OutputItem> {
    const lib = await loadPdfJs();
    let doc;
    try {
      doc = await lib.getDocument({ data: fileBytes }).promise;
    } catch (err: unknown) {
      if (err instanceof Error && /password|encrypted/i.test(err.message)) {
        throw new Error("pdf-to-md: input PDF is password-protected");
      }
      throw err;
    }
    try {
      const pages: Page[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        pages.push(await extractTextFromPage(page));
      }
      const markdown = toMarkdown(pages, opts);
      const baseName = fileName.replace(/\.pdf$/i, "");
      return {
        filename: `${baseName}.md`,
        mime: "text/markdown",
        blob: new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
      };
    } finally {
      await doc.destroy();
    }
  },
};

Comlink.expose(api);
```

### Step 4: `options-panel.tsx`

Per spec D7. Two visible elements:
1. Page-breaks radio (testid `pdf-to-md-page-breaks`) with options `horizontal-rule` (default) and `none`
2. Below the radio, a small static disclosure line in `text-[var(--color-fg-very-muted)]` text:
   ```
   // best-effort heuristic — multi-column / tables / forms degrade gracefully
   ```

Match the visual treatment of pdf-to-image's panel — same hairline border, same `var(--color-*)` tokens.

### Step 5: `options-panel.test.tsx`

Tests:
- Both radio options render with default selected
- Switching radio to `"none"` propagates onChange
- Disclosure text renders

### Step 6: `index.ts`

```ts
import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type PdfToMdOptions, defaultPdfToMdOptions } from "./options";
import { PdfToMdOptionsPanel } from "./options-panel";

const SUPPORTED_INPUT_MIMES = ["application/pdf"];

const engine: SingleInputEngine<PdfToMdOptions, OutputItem> = {
  id: "pdf-to-md",
  inputAccept: [".pdf"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "text/markdown",
  defaultOptions: defaultPdfToMdOptions,
  cardinality: "single",
  OptionsPanel: PdfToMdOptionsPanel,
  isReadyToConvert: () => true,
  validate(file) {
    return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
      ? { ok: true }
      : { ok: false, reason: "Expected a PDF file" };
  },
  async convert(file, opts, signal) {
    const harness = new WorkerHarness<PdfToMdOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    );
    const result = await harness.runSingle(file, opts, signal);
    if (Array.isArray(result)) {
      const first = result[0];
      if (!first) throw new Error("pdf-to-md: worker returned empty array");
      return first;
    }
    return result;
  },
};

export default engine;
```

Note: `outputMime: "text/markdown"`. Single OutputItem, so the result is `OutputItem` not `OutputItem[]`. Mirror image-convert's narrowing pattern (the `if (Array.isArray) ... return first` block) for safety.

### Step 7: `index.test.ts`

Engine-descriptor tests matching pdf-to-image's pattern. No fixture-based conversion tests (pdfjs in jsdom doesn't work).

### Step 8: Gates

```bash
pnpm typecheck && pnpm lint && pnpm test src/engines/pdf-to-md/
```

### Step 9: Commit

```bash
git add src/engines/pdf-to-md/
git commit -m "feat(pdf-to-md): engine + worker + options + tests"
```

---

## Task 4: Route + sidebar + registry

**Files:**
- Add: `src/app/tools/pdf-to-md/page.tsx`
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/engines/_shared/registry.ts`
- Modify: `src/engines/_shared/registry.test.ts`

Mirror pdf-to-image's wiring (Phase 11). Single commit.

```bash
git add src/app/tools/pdf-to-md/page.tsx src/components/layout/sidebar.tsx src/engines/_shared/registry.ts src/engines/_shared/registry.test.ts
git commit -m "feat(pdf-to-md): route + sidebar entry + registry"
```

---

## Task 5: E2E + privacy regression

**Files:**
- Add: `tests/e2e/pdf-to-md.spec.ts`
- Add: `tests/e2e/privacy-regression-pdf-to-md.spec.ts`

Mirror pdf-to-image's E2E patterns. Read `tests/e2e/pdf-to-image.spec.ts` for the convert-button + status-indicator + download-event pattern.

Tests in `pdf-to-md.spec.ts`:
1. **Default options → .md download with non-empty content.** Drop sample-5page.pdf, click Convert, await DONE, click download, read file, assert non-empty + assert it contains some recognizable text from the fixture (need to know what's in sample-5page.pdf — could just assert byte count > 100 if content is unknown).
2. **`pageBreaks: "none"` produces output without horizontal rules.** Drop fixture, switch radio, convert, download, assert downloaded text does NOT contain `\n---\n`.
3. **Encrypted PDF surfaces error banner.** Same shape as pdf-to-image's encrypted test.

Privacy regression: copy from `tests/e2e/privacy-regression-pdf-to-image.spec.ts`, swap paths.

```bash
pnpm test:e2e tests/e2e/pdf-to-md.spec.ts tests/e2e/privacy-regression-pdf-to-md.spec.ts
git add tests/e2e/pdf-to-md.spec.ts tests/e2e/privacy-regression-pdf-to-md.spec.ts
git commit -m "test(e2e): pdf-to-md happy path + privacy regression"
```

---

## Task 6: Final gates + manual smoke + PR

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e
git push -u origin phase-12-pdf-to-md
gh pr create --title "Phase 12: pdf → md engine (heuristic markdown)" --body "..."
```

PR body should document:
- Branch was created off main while #18 was open — sidebar/registry merge expected
- Pre-existing flake awareness
- Honest limitations of the heuristic approach (link to spec section)
- Manual smoke checklist
