# Phase 11 — pdf → image engine

**Goal:** New conversion engine that rasterizes PDF pages to PNG/JPEG. Mirrors pdf-split's shape (single PDF in → N outputs, multi-output ZIP). Reuses pdfjs-dist (pdf-merge thumbnail pattern) and `_shared/range.ts` (pdf-split range parser). Single PR — small enough scope, follows the established engine cadence.

**Spec:** [`docs/superpowers/specs/2026-05-02-pdf-to-image-engine.md`](../specs/2026-05-02-pdf-to-image-engine.md).

**Branch:** `phase-11-pdf-to-image` (off `main` after Phase 8 polish merged at `4de140a`).

**Critical ordering:**
- Task 1 (spec + plan) first
- Task 2 (page-numbers helper) before Task 3 (worker uses it)
- Task 3 (worker + engine descriptor + options + panel) is the substantive task
- Task 4 (route + sidebar + registry) before Task 5 (E2E needs the route)
- Task 5 (E2E + privacy regression) last before final gates

**Branch discipline:** stay on `phase-11-pdf-to-image`. Allowed git: `git status`, `git diff`, `git log`, `git branch --show-current`, `git add <specific files>`, `git commit`. NEVER `git checkout`, `git switch`, `git push --force`, `--no-verify`.

---

## Task 1: Commit spec + plan

```bash
git branch --show-current  # phase-11-pdf-to-image
git add docs/superpowers/specs/2026-05-02-pdf-to-image-engine.md docs/superpowers/plans/2026-05-02-phase-11-pdf-to-image.md
git commit -m "docs(phase-11): spec + plan for pdf → image engine"
```

---

## Task 2: Page-numbers helper + tests

**Goal:** Small pure-function module that converts a range-input string + pageCount into a sorted unique 1-indexed list of page numbers. Empty input = all pages.

**Files:**
- Add: `src/engines/pdf-to-image/page-numbers.ts`
- Add: `src/engines/pdf-to-image/page-numbers.test.ts`

```ts
// page-numbers.ts
import { parseRangeTokens } from "@/engines/_shared/range";

export type PageNumbersResult =
  | { ok: true; pages: number[] }
  | { ok: false; reason: string };

export function computePageNumbers(rangeInput: string, pageCount: number): PageNumbersResult {
  if (!rangeInput.trim()) {
    return { ok: true, pages: Array.from({ length: pageCount }, (_, i) => i + 1) };
  }
  const parsed = parseRangeTokens(rangeInput, pageCount);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const set = new Set<number>();
  for (const token of parsed.tokens) {
    for (const idx of token.indices) set.add(idx + 1); // 0-indexed → 1-indexed
  }
  return { ok: true, pages: Array.from(set).sort((a, b) => a - b) };
}
```

Tests:
- empty input + pageCount=5 → `[1,2,3,4,5]`
- `"1, 3-4"` + pageCount=5 → `[1, 3, 4]`
- `"5,1,3"` + pageCount=5 → `[1, 3, 5]` (sorted unique)
- `"1-3, 2-4"` + pageCount=10 → `[1, 2, 3, 4]` (deduped)
- `"7"` + pageCount=5 → `{ ok: false, reason: ... }` (out of bounds)
- `"abc"` + pageCount=5 → `{ ok: false, reason: ... }` (syntax error)

Commit:

```bash
git add src/engines/pdf-to-image/page-numbers.ts src/engines/pdf-to-image/page-numbers.test.ts
git commit -m "feat(pdf-to-image): page-numbers helper + tests"
```

---

## Task 3: Engine + worker + options + options-panel + tests

**Goal:** The core engine. Single substantive commit.

**Files:**
- Add: `src/engines/pdf-to-image/options.ts`
- Add: `src/engines/pdf-to-image/options-panel.tsx`
- Add: `src/engines/pdf-to-image/options-panel.test.tsx`
- Add: `src/engines/pdf-to-image/worker.ts`
- Add: `src/engines/pdf-to-image/index.ts`
- Add: `src/engines/pdf-to-image/index.test.ts`

### Step 1: `options.ts`

```ts
export type PdfToImageOptions = {
  format: "png" | "jpeg";
  scale: 1 | 2 | 3;
  jpegQuality: number;
  rangeInput: string;
};

export const defaultPdfToImageOptions: PdfToImageOptions = {
  format: "png",
  scale: 2,
  jpegQuality: 90,
  rangeInput: "",
};
```

### Step 2: `options-panel.tsx`

Read `src/engines/pdf-split/options-panel.tsx` first to see the range-input + syntax-feedback pattern. Reuse that structure.

Add (above the range input):
- Format radio group (PNG / JPEG) with `data-testid="pdf-to-image-format"`
- Scale dropdown (screen / print / high-res mapping to 1/2/3) with `data-testid="pdf-to-image-scale"`
- JPEG quality slider — only rendered when format === "jpeg" — with `data-testid="pdf-to-image-quality"`

Range input keeps the same testid pattern as pdf-split (`range-input`, `range-syntax-error`).

### Step 3: `options-panel.test.tsx`

Tests:
- All 4 controls render with default values (PNG, print, range empty)
- Switching format to JPEG reveals the quality slider
- Switching back to PNG hides the quality slider
- Typing a syntactically invalid range shows the syntax error
- Typing an empty range hides the syntax error
- onChange propagates updated options to the parent

### Step 4: `worker.ts`

Implement per spec D8. Use the `loadPdfJs` pattern from `src/engines/pdf-merge/render-thumbnail.ts`:

```ts
type PdfJsModule = typeof import("pdfjs-dist");
let pdfJsModulePromise: Promise<PdfJsModule> | undefined;
let workerConfigured = false;

async function loadPdfJs(): Promise<PdfJsModule> {
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

Then the `convertSingle` body per spec D8.

### Step 5: `index.ts`

Per spec D6 — mirror pdf-split's index.ts almost verbatim, swapping `pdf-split` → `pdf-to-image` and `archiveSuffix: "-split"` → `archiveSuffix: "-images"`.

### Step 6: `index.test.ts`

Engine-descriptor tests + a few fixture-based conversion tests:
- Engine has correct `id`, `inputAccept`, `inputMime`, `outputMime`, `archiveSuffix`, `cardinality`, `defaultOptions`
- `validate` accepts a `.pdf` file, rejects others
- `isReadyToConvert` returns true (range can be empty)
- 5-page PDF + default options → 5 OutputItems with PNG mime + `page-N.png` filenames
- 5-page PDF + range `"1, 3-4"` → 3 OutputItems
- 1-page PDF + JPEG format → 1 OutputItem with JPEG mime + `page-1.jpg` filename
- Encrypted PDF → throws "pdf-to-image: input PDF is password-protected"

Use `tests/fixtures/sample-5page.pdf`, `tests/fixtures/sample-encrypted.pdf`.

### Step 7: Gates

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Engine fixture tests will run pdfjs-dist in jsdom — verify it works. If jsdom doesn't support OffscreenCanvas, may need to mock or move conversion tests to E2E only.

### Step 8: Commit

```bash
git add src/engines/pdf-to-image/
git commit -m "feat(pdf-to-image): engine + worker + options + tests"
```

---

## Task 4: Route + sidebar + registry

**Goal:** Wire the engine into the app. One commit.

**Files:**
- Add: `src/app/tools/pdf-to-image/page.tsx`
- Modify: `src/components/layout/sidebar.tsx` (append entry to PDFS group)
- Modify: `src/engines/_shared/registry.ts` (register pdf-to-image)

### Step 1: Route

Mirror `src/app/tools/pdf-split/page.tsx`:

```tsx
import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/pdf-to-image";

export default function PdfToImagePage() {
  return <ToolFrame engine={engine} />;
}
```

### Step 2: Sidebar

In `src/components/layout/sidebar.tsx`, append to the TOOLS array:

```ts
{ id: "pdf-to-image", href: "/tools/pdf-to-image", label: "pdf→image", group: "PDFS" },
```

### Step 3: Registry

In `src/engines/_shared/registry.ts`, add:

```ts
"pdf-to-image": () => import("@/engines/pdf-to-image"),
```

(Match the existing import-based dynamic registration pattern.)

### Step 4: Update sidebar.test.tsx if needed

If the existing test asserts a specific count of PDFS entries (e.g., "exactly 2 entries"), update to reflect 3.

### Step 5: Gates

```bash
pnpm typecheck && pnpm lint && pnpm test
```

### Step 6: Commit

```bash
git add src/app/tools/pdf-to-image/page.tsx src/components/layout/sidebar.tsx src/engines/_shared/registry.ts src/components/layout/sidebar.test.tsx
git commit -m "feat(pdf-to-image): route + sidebar entry + registry"
```

---

## Task 5: E2E + privacy regression

**Goal:** Playwright coverage for the happy path + the privacy invariant.

**Files:**
- Add: `tests/e2e/pdf-to-image.spec.ts`
- Add: `tests/e2e/privacy-regression-pdf-to-image.spec.ts`

### Step 1: pdf-to-image.spec.ts

Mirror `tests/e2e/pdf-split.spec.ts`. Tests:

1. **Multi-page PDF + default options (PNG, print scale, all pages) → 5 PNG outputs + ZIP download.** Drop fixture, click Convert, assert `[ DONE ]`, verify per-row download buttons (page-1.png ... page-5.png), verify download-all-zip button, click ZIP, verify ZIP magic bytes (`PK\x03\x04`) and filename pattern `sample-5page-images.zip`.

2. **Format switch to JPEG → outputs use `.jpg` extension.** Drop fixture, switch format to JPEG, click Convert, assert outputs are `page-N.jpg`.

3. **Single-page selection (range "3") → 1 PNG output, no ZIP button.** Drop fixture, type "3" in range, click Convert, assert exactly 1 row visible, no download-all-zip button.

4. **Encrypted PDF → error banner.** Drop encrypted fixture, click Convert, assert `[ ERROR ]` status, assert error message contains "password-protected".

### Step 2: privacy-regression-pdf-to-image.spec.ts

Mirror `tests/e2e/privacy-regression-pdf-split.spec.ts`. Single test:
- Drop fixture, set up off-origin request listener, click Convert, await `[ DONE ]`, assert zero off-origin requests + zero off-origin WebSockets.

### Step 3: Run E2E

```bash
pnpm test:e2e tests/e2e/pdf-to-image.spec.ts tests/e2e/privacy-regression-pdf-to-image.spec.ts
```

Verify across chromium + firefox + webkit. If a webkit-specific failure appears that doesn't reproduce in chromium/firefox, investigate before committing.

### Step 4: Commit

```bash
git add tests/e2e/pdf-to-image.spec.ts tests/e2e/privacy-regression-pdf-to-image.spec.ts
git commit -m "test(e2e): pdf-to-image happy path + privacy regression"
```

---

## Task 6: Final gates + manual smoke + PR

**Goal:** Full gate sweep, manual Chrome smoke, push, open PR.

### Step 1: Manual smoke (controller)

```bash
pnpm dev   # NOT --turbopack
```

Visit `http://localhost:3000/tools/pdf-to-image`:

1. Default state: status `[ READY ]`, format=PNG, scale=print, range empty, dropzone enabled, Convert disabled (no file)
2. Drop a PDF → file shown in `current file:`, Convert enables
3. Click Convert → status flips to `[ CONVERTING ]` then `[ DONE ]`, downloads listed (page-1.png ... page-N.png), download-all-zip button visible
4. Click any per-row download → PNG downloads with right filename
5. Click download-all-zip → ZIP downloads, contains all PNGs
6. Switch format to JPEG → quality slider appears; convert again → outputs are .jpg
7. Type range "1, 3-4" → convert → 3 outputs only

Verify sidebar shows pdf→image entry under PDFS group.

### Step 2: Final gates

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e
```

Expected: all green except possibly the pre-existing webkit `pdf-split.spec.ts:111` flake. Note in PR body, don't fix.

### Step 3: Push + PR

```bash
git push -u origin phase-11-pdf-to-image
gh pr create --title "Phase 11: pdf → image engine" --body "..."
```
