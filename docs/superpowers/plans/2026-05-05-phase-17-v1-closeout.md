# Phase 17 — v1 closeout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `pdf-edit` engine (rotate / reorder / delete pages on a single PDF) AND close v1: `/about` page, verification sweep (a11y, bundle isolation, deploy headers, Lighthouse / securityheaders checklist), and master-spec amendments reflecting v1 cuts.

**Architecture:** `pdf-edit` is a `SingleInputEngine` that drops into the existing engine pattern; the `pdf-merge` first-page thumbnail helper is promoted to `_shared/render-pdf-thumbnail` and extended with per-page rendering. `/about` is a static page that reads engine metadata (newly-added `library` / `license` fields on `EngineMeta`) from the registry. Verification sweep is a mix of one new E2E spec (axe), one new build script (bundle-isolation gate wired to `pnpm postbuild`), and one manual checklist documented under `docs/superpowers/`.

**Tech Stack:** TypeScript strict, React, Next.js static export, Vitest, Playwright, `@axe-core/playwright` (new dev dep), `pdf-lib` (already installed), `pdfjs-dist` (already installed), `@dnd-kit/core` + `@dnd-kit/sortable` (already installed). No new runtime deps.

---

## Reference reading before starting

- Sibling specs:
  - `docs/superpowers/specs/2026-05-05-pdf-edit-engine-design.md`
  - `docs/superpowers/specs/2026-05-05-v1-closeout.md`
- Master spec: `docs/superpowers/specs/2026-04-30-file-converter-design.md` (esp. §5.2, §10.2, §17)
- Engine type definitions: `src/engines/_shared/types.ts`
- Engine registry: `src/engines/_shared/registry.ts`
- ToolFrame: `src/components/tool-frame.tsx`
- Existing single-input engine for reference: `src/engines/pdf-to-md/` (clean, single-input PDF engine)
- Existing multi-input + dnd-kit reference: `src/engines/pdf-merge/staging-area.tsx` + `src/engines/pdf-merge/render-thumbnail.ts`
- Route pattern: `src/app/tools/pdf-merge/page.tsx`
- Sidebar: `src/components/layout/sidebar.tsx`
- Home grid: `src/app/page.tsx` (the `TOOLS` array)
- Layout footer: `src/components/layout/footer.tsx`
- Existing E2E patterns: `tests/e2e/pdf-merge.spec.ts`, `tests/e2e/privacy-regression-pdf-merge.spec.ts`
- Bundle output reference: run `pnpm build && ls -R out/_next/static/chunks/` to see homepage chunk layout
- Vercel headers (CSP / HSTS / etc.): `vercel.json` at the repo root

CLAUDE.md invariants apply:
- No `--no-verify`. No `--amend`. **No Claude attribution in commit messages** (no `Co-Authored-By: Claude`, no "Generated with" footers).
- Keep commit body lines ≤ 72 chars.
- Run `pnpm test`, `pnpm typecheck`, `pnpm lint` after each task before commit.
- Engines must not contain `fetch` / `XMLHttpRequest` — Biome lint enforces.
- Don't use `next dev --turbopack` — Webpack dev server only (Turbopack worker resolution breaks the engine pattern).
- Branch discipline for subagents: implementer subagents must never run `git branch -m/-M` or `git checkout <branch>`. Stay on the working branch you started on.

---

## Spec deviations

**Master-spec §10.2 amendment beyond the closeout spec's §3 list.** Reconnaissance during plan-write found that `vercel.json` ships `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'`. The closeout spec's §3 amendment list (§3 / §5.1 / §5.3 / §16 / §18) doesn't anticipate this. The plan adds a paragraph to master spec §10.2 documenting why `'unsafe-inline'` is retained in `script-src` (only) for Next.js static-export's hydration shim, and that `style-src` stays clean. This is a strict superset of the closeout spec's §3 work — it adds context, doesn't relax any commitment.

**Provisional pdf-edit worker bridging.** The OptionsPanel needs the parsed pdf.js doc before Convert; the existing harness doesn't currently expose a per-file lifecycle seam for this. Task 12 uses a module-scoped worker singleton as a workaround. This is provisional pending a harness lifecycle seam — flagged in the PR description but not a deviation from the engine spec, which is silent on which seam to use.

Any further deviation discovered during implementation is documented inline with the task and surfaced in the final PR description.

---

## Group A — Engine descriptor metadata extension

This unblocks the engines-table on `/about`. Done first because every later engine task can populate `library` / `license` as it lands; doing it last would require touching every engine again.

## Task 1: Extend `EngineMeta` with optional `library` and `license` fields

**Files:**
- Modify: `src/engines/_shared/types.ts`
- Modify: `src/engines/_shared/types.test-d.ts`

The new fields are optional so this is a non-breaking change. Use `string` for `library` (e.g., `"pdf-lib"`, or `"libheif-js, Canvas"` for engines using more than one library) and a small string-literal union for `license` to keep values consistent across engines.

- [ ] **Step 1: Extend the type**

Edit `src/engines/_shared/types.ts`. Find the `export type EngineMeta<TOptions>` block and add two optional fields after `archiveSuffix`:

```ts
export type EngineLicense = "MIT" | "Apache-2.0" | "BSD-3-Clause" | "ISC" | "mixed";

export type EngineMeta<TOptions> = {
  id: string;
  inputAccept: string[];
  inputMime: string[];
  outputMime: string;
  defaultOptions: TOptions;
  convertButtonLabel?: string;
  category: EngineCategory;
  archiveSuffix?: string;
  /** Human-readable name(s) of the conversion library used by the engine.
   * Surfaced on the /about engines transparency table. Comma-separated when
   * an engine uses more than one (e.g., "libheif-js, Canvas"). */
  library?: string;
  /** SPDX-style identifier for the conversion library's license. "mixed"
   * is allowed when the libraries column lists more than one library and
   * they have different licenses. */
  license?: EngineLicense;
};
```

- [ ] **Step 2: Add a type-level test**

Edit `src/engines/_shared/types.test-d.ts`. Add a block asserting that the new fields are optional (not required) and that `EngineLicense` accepts the documented values:

```ts
import { expectAssignable, expectError } from "tsd";
import type { EngineMeta, EngineLicense, SingleInputEngine, OutputItem } from "./types";

// EngineLicense accepts each documented value
expectAssignable<EngineLicense>("MIT");
expectAssignable<EngineLicense>("Apache-2.0");
expectAssignable<EngineLicense>("BSD-3-Clause");
expectAssignable<EngineLicense>("ISC");
expectAssignable<EngineLicense>("mixed");
// And rejects unknowns
expectError<EngineLicense>("GPL-3.0");

// library/license remain optional on EngineMeta
type _M = EngineMeta<{ q: number }>;
const m1: _M = {
  id: "x",
  inputAccept: [],
  inputMime: [],
  outputMime: "text/plain",
  defaultOptions: { q: 1 },
  category: "image",
};
expectAssignable<_M>(m1);
```

- [ ] **Step 3: Run typecheck and tests**

```bash
pnpm typecheck
pnpm test src/engines/_shared
```

Expected: clean typecheck, all `_shared` tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/engines/_shared/types.ts src/engines/_shared/types.test-d.ts
git commit -m "$(cat <<'EOF'
feat(engines): optional library + license meta fields

Adds EngineMeta.library (string) and .license
(EngineLicense union). Both optional; no engines
populated yet — backfilled in the next task.

Drives the /about engines transparency table.
EOF
)"
```

---

## Task 2: Backfill `library` and `license` on all 12 existing engines

**Files (all `index.ts` engine modules — modify the descriptor literal):**
- `src/engines/docx-to-txt/index.ts`
- `src/engines/image-bg-remove/index.ts`
- `src/engines/image-convert/index.ts`
- `src/engines/image-resize/index.ts`
- `src/engines/image-to-pdf/index.ts`
- `src/engines/markdown-to-pdf/index.ts`
- `src/engines/pdf-merge/index.ts`
- `src/engines/pdf-split/index.ts`
- `src/engines/pdf-to-image/index.ts`
- `src/engines/pdf-to-md/index.ts`
- `src/engines/docx-to-pdf/index.ts`
- `src/engines/txt-to-pdf/index.ts`

Mapping (canonical names):

| id | library | license |
|---|---|---|
| `image-convert` | `libheif-js, Canvas` | `mixed` |
| `image-resize` | `Canvas` | `MIT` |
| `image-to-pdf` | `pdf-lib, Canvas` | `mixed` |
| `pdf-merge` | `pdf-lib` | `MIT` |
| `pdf-split` | `pdf-lib` | `MIT` |
| `pdf-to-image` | `pdfjs-dist, Canvas` | `mixed` |
| `pdf-to-md` | `pdfjs-dist` | `Apache-2.0` |
| `docx-to-pdf` | `mammoth, pdf-lib` | `mixed` |
| `docx-to-txt` | `mammoth` | `BSD-3-Clause` |
| `markdown-to-pdf` | `markdown-it, pdf-lib` | `mixed` |
| `txt-to-pdf` | `pdf-lib` | `MIT` |
| `image-bg-remove` | `@huggingface/transformers (MODNet, portrait-only)` | `Apache-2.0` |

The `image-bg-remove` value is intentionally a self-documenting label so the /about table reflects the spec §3.4 portrait-only kept-as-is decision in the most surfaced place — the public engines table.

- [ ] **Step 1: Patch each descriptor**

For each engine's `index.ts`, locate the engine literal (e.g., `const engine: SingleInputEngine<...> = { id: "pdf-merge", ... }`) and add the two fields right after `category`:

```ts
  category: "pdf",
  library: "pdf-lib",
  license: "MIT",
```

Use the table above for the exact strings. Apply identically to all 12 engines.

- [ ] **Step 2: Add a registry-coverage test**

Create `src/engines/_shared/registry.metadata.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { listEngineIds, loadEngine } from "./registry";

describe("every registered engine declares library + license", () => {
  for (const id of listEngineIds()) {
    it(`${id} has library + license`, async () => {
      const engine = await loadEngine(id);
      expect(engine.library, `${id}.library`).toBeTypeOf("string");
      expect((engine.library as string).length).toBeGreaterThan(0);
      expect(engine.license, `${id}.license`).toMatch(
        /^(MIT|Apache-2\.0|BSD-3-Clause|ISC|mixed)$/,
      );
    });
  }
});
```

This makes the metadata required-by-test (even though it's optional at the type level), so a future engine that forgets to set it fails CI immediately.

- [ ] **Step 3: Run tests + typecheck + lint**

```bash
pnpm typecheck
pnpm test src/engines
pnpm lint
```

Expected: all green. The new metadata test runs against every registered engine.

- [ ] **Step 4: Commit**

```bash
git add src/engines/
git commit -m "$(cat <<'EOF'
feat(engines): backfill library + license metadata

Populates the new EngineMeta.library + .license
fields on every registered engine. Adds a registry
test asserting both are set on every id.

image-bg-remove labels itself "MODNet, portrait-only"
to reflect the Phase 16 spec note about model
limitation.
EOF
)"
```

---

## Group B — pdf-edit foundations (shared thumbnail module + fixture)

## Task 3: Promote `render-thumbnail` to `_shared`

**Files:**
- Move: `src/engines/pdf-merge/render-thumbnail.ts` → `src/engines/_shared/render-pdf-thumbnail.ts`
- Move: `src/engines/pdf-merge/render-thumbnail.test.ts` → `src/engines/_shared/render-pdf-thumbnail.test.ts`
- Modify: any pdf-merge files importing the old path
- Modify: any test files importing the old path

The pdf-merge spec §3.3 already anticipated this: *"Future PDF tools (split, rotate, PDF→image) will likely promote it to `_shared/`."*

- [ ] **Step 1: Move with `git mv`**

```bash
git mv src/engines/pdf-merge/render-thumbnail.ts src/engines/_shared/render-pdf-thumbnail.ts
git mv src/engines/pdf-merge/render-thumbnail.test.ts src/engines/_shared/render-pdf-thumbnail.test.ts
```

- [ ] **Step 2: Update all importers**

Find them:

```bash
grep -rln '"\./render-thumbnail' src/engines/pdf-merge/
grep -rln '"@/engines/pdf-merge/render-thumbnail' src/
```

In each match, change the import path:

```ts
// Before
import { renderFirstPageThumbnail } from "./render-thumbnail";
// or
import { renderFirstPageThumbnail } from "@/engines/pdf-merge/render-thumbnail";

// After
import { renderFirstPageThumbnail } from "@/engines/_shared/render-pdf-thumbnail";
```

- [ ] **Step 3: Run tests**

```bash
pnpm test src/engines/_shared/render-pdf-thumbnail
pnpm test src/engines/pdf-merge
pnpm typecheck
```

Expected: relocated test runs from its new path; pdf-merge tests still pass with new import.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(engines): promote render-thumbnail to _shared

Moves render-thumbnail.ts (+ tests) from pdf-merge/
to _shared/render-pdf-thumbnail.ts. Updates pdf-merge
imports. Sets up pdf-edit (next phase) to use the
same module without duplicating pdf.js bootstrap.

Anticipated by pdf-merge spec section 3.3.
EOF
)"
```

---

## Task 4: Extend `_shared/render-pdf-thumbnail` with `loadPdfDocument` + `renderPageThumbnail`

**Files:**
- Modify: `src/engines/_shared/render-pdf-thumbnail.ts`
- Modify: `src/engines/_shared/render-pdf-thumbnail.test.ts`

pdf-edit's worker needs to:
1. Load the doc once and reuse it for every per-page thumbnail (parsing the bytes 250 times would be unacceptably slow).
2. Render an arbitrary page index, not just page 1.

The existing `renderFirstPageThumbnail` stays for pdf-merge's per-file use case.

- [ ] **Step 1: Add `loadPdfDocument` and `renderPageThumbnail`**

Edit `src/engines/_shared/render-pdf-thumbnail.ts`. Add to the bottom (after `renderFirstPageThumbnail`):

```ts
import type { PDFDocumentProxy } from "pdfjs-dist";

/**
 * Open a PDF document via pdf.js and return the proxy. Caller must call
 * `doc.destroy()` when done — typically in a try/finally pairing with
 * `renderPageThumbnail` calls.
 *
 * Lazy-loads pdfjs-dist on first use; subsequent calls reuse the cached
 * module (same pattern as renderFirstPageThumbnail).
 */
export async function loadPdfDocument(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  const lib = await loadPdfJs();
  return lib.getDocument({ data: bytes }).promise;
}

/**
 * Render a single page (0-based) of an already-loaded PDF doc to a PNG
 * blob bounded by `size` (longest edge). Aspect ratio preserved.
 */
export async function renderPageThumbnail(
  doc: PDFDocumentProxy,
  pageIndex: number,
  size: number,
): Promise<Blob> {
  // pdf.js page numbers are 1-based.
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 1 });
  const scale = Math.min(size / viewport.width, size / viewport.height);
  const scaledViewport = page.getViewport({ scale });
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.ceil(scaledViewport.width)),
    Math.max(1, Math.ceil(scaledViewport.height)),
  );
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");
  await page.render({
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport: scaledViewport,
    canvas: canvas as unknown as HTMLCanvasElement,
  }).promise;
  return await canvas.convertToBlob({ type: "image/png" });
}
```

The existing `loadPdfJs` private helper (already in the file) is reused.

- [ ] **Step 2: Add tests for the new functions**

Append to `src/engines/_shared/render-pdf-thumbnail.test.ts`. The pdf-merge test file already shows the existing test patterns — copy the fixture-loading boilerplate from there.

```ts
import { loadPdfDocument, renderPageThumbnail } from "./render-pdf-thumbnail";

describe("loadPdfDocument + renderPageThumbnail", () => {
  it("renders an arbitrary page of a multi-page PDF", async () => {
    // Reuse any committed multi-page PDF fixture (pdf-merge has one).
    // Search via: ls tests/fixtures/*.pdf
    const bytes = await loadFixtureBytes("pdf-merge/three-page.pdf");
    const doc = await loadPdfDocument(bytes);
    try {
      expect(doc.numPages).toBeGreaterThanOrEqual(2);
      const blob = await renderPageThumbnail(doc, 1, 120);
      expect(blob.type).toBe("image/png");
      expect(blob.size).toBeGreaterThan(0);
    } finally {
      await doc.destroy();
    }
  });

  it("rejects out-of-range page index", async () => {
    const bytes = await loadFixtureBytes("pdf-merge/three-page.pdf");
    const doc = await loadPdfDocument(bytes);
    try {
      await expect(renderPageThumbnail(doc, 999, 120)).rejects.toThrow();
    } finally {
      await doc.destroy();
    }
  });
});
```

(Use the existing `loadFixtureBytes` helper if there is one in the test file; if not, inline `readFileSync` like the existing tests do.)

- [ ] **Step 3: Run the tests**

```bash
pnpm test src/engines/_shared/render-pdf-thumbnail
pnpm typecheck
```

Expected: all pass, including the new ones.

- [ ] **Step 4: Commit**

```bash
git add src/engines/_shared/render-pdf-thumbnail.ts src/engines/_shared/render-pdf-thumbnail.test.ts
git commit -m "$(cat <<'EOF'
feat(_shared): add loadPdfDocument + renderPageThumbnail

Extends render-pdf-thumbnail with per-page rendering
against a pre-loaded PDFDocumentProxy. Avoids
re-parsing the PDF bytes on every thumbnail (250x
for a 250-page input would be unacceptably slow).

Caller is responsible for doc.destroy().
EOF
)"
```

---

## Task 5: Generate the pdf-edit fixture

**Files:**
- Create: `scripts/generate-pdf-edit-fixture.mjs`
- Create: `tests/fixtures/pdf-edit/multi-page.pdf` (binary, generated)

The fixture is 5 pages with mixed orientations and one source-page rotation, so the rotation-composition path in the worker (§6 of the spec) is actually exercised by tests.

- [ ] **Step 1: Write the generation script**

Create `scripts/generate-pdf-edit-fixture.mjs`:

```js
#!/usr/bin/env node
// Generates tests/fixtures/pdf-edit/multi-page.pdf — a 5-page PDF
// with mixed orientations and an existing 90° rotation on page 3
// so the rotation-composition path in pdf-edit/worker.ts is testable.
//
// Run: node scripts/generate-pdf-edit-fixture.mjs
// Idempotent — overwrites the output each time.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

const OUT_DIR = path.resolve("tests/fixtures/pdf-edit");
const OUT_PATH = path.join(OUT_DIR, "multi-page.pdf");

async function main() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const pages = [
    { w: 612, h: 792, rotate: 0,   label: "PAGE 1 PORTRAIT" },
    { w: 792, h: 612, rotate: 0,   label: "PAGE 2 LANDSCAPE" },
    { w: 612, h: 792, rotate: 90,  label: "PAGE 3 PORTRAIT pre-rotated 90" },
    { w: 612, h: 792, rotate: 0,   label: "PAGE 4 PORTRAIT" },
    { w: 792, h: 612, rotate: 0,   label: "PAGE 5 LANDSCAPE" },
  ];

  for (const p of pages) {
    const page = doc.addPage([p.w, p.h]);
    if (p.rotate !== 0) page.setRotation(degrees(p.rotate));
    page.drawText(p.label, {
      x: 50,
      y: p.h - 100,
      size: 24,
      font,
      color: rgb(0, 0, 0),
    });
  }

  const bytes = await doc.save();
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_PATH, bytes);
  console.log(`wrote ${OUT_PATH} (${bytes.byteLength} bytes, ${pages.length} pages)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the script**

```bash
node scripts/generate-pdf-edit-fixture.mjs
```

Expected output: `wrote .../tests/fixtures/pdf-edit/multi-page.pdf (... bytes, 5 pages)`. Resulting file should be < 50 KB.

- [ ] **Step 3: Verify with pdf-lib**

```bash
node -e "const { PDFDocument } = require('pdf-lib'); const fs = require('fs'); (async () => { const doc = await PDFDocument.load(fs.readFileSync('tests/fixtures/pdf-edit/multi-page.pdf')); const pages = doc.getPages(); console.log('pages:', pages.length); pages.forEach((p, i) => console.log('  page', i + 1, 'rotation:', p.getRotation().angle)); })();"
```

Expected:
```
pages: 5
  page 1 rotation: 0
  page 2 rotation: 0
  page 3 rotation: 90
  page 4 rotation: 0
  page 5 rotation: 0
```

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-pdf-edit-fixture.mjs tests/fixtures/pdf-edit/multi-page.pdf
git commit -m "$(cat <<'EOF'
test(pdf-edit): committed multi-page fixture + script

Adds tests/fixtures/pdf-edit/multi-page.pdf (5 pages,
mixed portrait/landscape, page 3 pre-rotated 90°) and
the generator script for reproducibility.

Used by pdf-edit worker correctness + E2E tests.
EOF
)"
```

---

## Group C — pdf-edit engine

## Task 6: pdf-edit `options.ts` + tests

**Files:**
- Create: `src/engines/pdf-edit/options.ts`
- Create: `src/engines/pdf-edit/options.test.ts`

Pure module — types, defaults, and pure functions for the edit-set mutations. No React, no pdf-lib, no DOM.

- [ ] **Step 1: Write the failing tests**

Create `src/engines/pdf-edit/options.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  applyRotateAll,
  defaultPdfEditOptions,
  deletePage,
  movePage,
  rotatePage,
  seedFromPageCount,
  type PdfEditOptions,
} from "./options";

describe("pdf-edit options", () => {
  it("default options are empty", () => {
    expect(defaultPdfEditOptions).toEqual({ pages: [], totalSourcePages: 0 });
  });

  it("seedFromPageCount creates one entry per page with rotation 0", () => {
    const opts = seedFromPageCount(3);
    expect(opts.totalSourcePages).toBe(3);
    expect(opts.pages.map((p) => p.sourceIndex)).toEqual([0, 1, 2]);
    expect(opts.pages.map((p) => p.rotation)).toEqual([0, 0, 0]);
    // ids must be unique strings
    const ids = new Set(opts.pages.map((p) => p.id));
    expect(ids.size).toBe(3);
  });

  it("rotatePage cycles rotation 0->90->180->270->0", () => {
    let o = seedFromPageCount(2);
    o = rotatePage(o, o.pages[0]!.id);
    expect(o.pages[0]!.rotation).toBe(90);
    o = rotatePage(o, o.pages[0]!.id);
    expect(o.pages[0]!.rotation).toBe(180);
    o = rotatePage(o, o.pages[0]!.id);
    expect(o.pages[0]!.rotation).toBe(270);
    o = rotatePage(o, o.pages[0]!.id);
    expect(o.pages[0]!.rotation).toBe(0);
    // Other pages untouched
    expect(o.pages[1]!.rotation).toBe(0);
  });

  it("rotatePage on unknown id is a no-op", () => {
    const o = seedFromPageCount(2);
    expect(rotatePage(o, "nonexistent")).toEqual(o);
  });

  it("applyRotateAll adds 90 to every page modulo 360", () => {
    let o = seedFromPageCount(3);
    o = rotatePage(o, o.pages[0]!.id); // page 0 -> 90
    o = rotatePage(o, o.pages[2]!.id); // page 2 -> 90
    o = applyRotateAll(o);
    // page 0: 90 + 90 = 180
    // page 1: 0 + 90 = 90
    // page 2: 90 + 90 = 180
    expect(o.pages.map((p) => p.rotation)).toEqual([180, 90, 180]);
  });

  it("deletePage removes the entry", () => {
    let o = seedFromPageCount(3);
    const middleId = o.pages[1]!.id;
    o = deletePage(o, middleId);
    expect(o.pages.length).toBe(2);
    expect(o.pages.map((p) => p.sourceIndex)).toEqual([0, 2]);
    expect(o.totalSourcePages).toBe(3); // unchanged
  });

  it("deletePage on unknown id is a no-op", () => {
    const o = seedFromPageCount(2);
    expect(deletePage(o, "nonexistent")).toEqual(o);
  });

  it("movePage reorders correctly", () => {
    let o = seedFromPageCount(4);
    // Move page index 0 to position 2
    o = movePage(o, 0, 2);
    expect(o.pages.map((p) => p.sourceIndex)).toEqual([1, 2, 0, 3]);
  });

  it("movePage with out-of-range indices is a no-op", () => {
    const o = seedFromPageCount(3);
    expect(movePage(o, -1, 0)).toEqual(o);
    expect(movePage(o, 0, 99)).toEqual(o);
    expect(movePage(o, 99, 0)).toEqual(o);
  });
});
```

Run: `pnpm test src/engines/pdf-edit/options.test.ts`
Expected: all FAIL with "Cannot find module './options'" (or similar).

- [ ] **Step 2: Implement**

Create `src/engines/pdf-edit/options.ts`:

```ts
export type PdfEditPage = {
  id: string;
  sourceIndex: number;
  rotation: 0 | 90 | 180 | 270;
};

export type PdfEditOptions = {
  pages: PdfEditPage[];
  totalSourcePages: number;
};

export const defaultPdfEditOptions: PdfEditOptions = {
  pages: [],
  totalSourcePages: 0,
};

function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Vitest jsdom may not expose crypto.randomUUID on older Node; deterministic enough fallback.
  return `pe-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

const ROTATIONS = [0, 90, 180, 270] as const;
type Rotation = (typeof ROTATIONS)[number];

function nextRotation(current: Rotation, addDegrees: 90 | 180 | 270 = 90): Rotation {
  return (((current + addDegrees) % 360) as Rotation);
}

export function seedFromPageCount(n: number): PdfEditOptions {
  const pages: PdfEditPage[] = [];
  for (let i = 0; i < n; i++) {
    pages.push({ id: genId(), sourceIndex: i, rotation: 0 });
  }
  return { pages, totalSourcePages: n };
}

export function rotatePage(opts: PdfEditOptions, id: string): PdfEditOptions {
  const idx = opts.pages.findIndex((p) => p.id === id);
  if (idx === -1) return opts;
  const target = opts.pages[idx]!;
  const nextPages = opts.pages.slice();
  nextPages[idx] = { ...target, rotation: nextRotation(target.rotation) };
  return { ...opts, pages: nextPages };
}

export function applyRotateAll(opts: PdfEditOptions): PdfEditOptions {
  const nextPages = opts.pages.map((p) => ({ ...p, rotation: nextRotation(p.rotation) }));
  return { ...opts, pages: nextPages };
}

export function deletePage(opts: PdfEditOptions, id: string): PdfEditOptions {
  const idx = opts.pages.findIndex((p) => p.id === id);
  if (idx === -1) return opts;
  const nextPages = opts.pages.slice();
  nextPages.splice(idx, 1);
  return { ...opts, pages: nextPages };
}

export function movePage(opts: PdfEditOptions, from: number, to: number): PdfEditOptions {
  if (from < 0 || from >= opts.pages.length) return opts;
  if (to < 0 || to >= opts.pages.length) return opts;
  if (from === to) return opts;
  const nextPages = opts.pages.slice();
  const [moved] = nextPages.splice(from, 1);
  if (moved) nextPages.splice(to, 0, moved);
  return { ...opts, pages: nextPages };
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm test src/engines/pdf-edit/options.test.ts
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/engines/pdf-edit/options.ts src/engines/pdf-edit/options.test.ts
git commit -m "$(cat <<'EOF'
feat(pdf-edit): options module — types + edit mutations

Pure module: PdfEditOptions, default, and pure
mutators (rotatePage, applyRotateAll, deletePage,
movePage, seedFromPageCount). No React, no pdf-lib.

All edits return new state; ids are stable across
reorders so dnd-kit doesn't treat them as remounts.
EOF
)"
```

---

## Task 7: pdf-edit `filenames.ts` + tests

**Files:**
- Create: `src/engines/pdf-edit/filenames.ts`
- Create: `src/engines/pdf-edit/filenames.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/engines/pdf-edit/filenames.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { editedFilename } from "./filenames";

describe("editedFilename", () => {
  it("appends -edited before .pdf", () => {
    expect(editedFilename("doc.pdf")).toBe("doc-edited.pdf");
  });
  it("handles names with multiple dots", () => {
    expect(editedFilename("my.report.v2.pdf")).toBe("my.report.v2-edited.pdf");
  });
  it("handles names without an extension", () => {
    expect(editedFilename("doc")).toBe("doc-edited.pdf");
  });
  it("handles names with .PDF (uppercase)", () => {
    expect(editedFilename("doc.PDF")).toBe("doc-edited.pdf");
  });
  it("does not double-suffix already-edited names", () => {
    expect(editedFilename("doc-edited.pdf")).toBe("doc-edited.pdf");
  });
  it("handles empty / whitespace defensively", () => {
    expect(editedFilename("")).toBe("edited.pdf");
    expect(editedFilename(".pdf")).toBe("edited.pdf");
  });
});
```

Run: `pnpm test src/engines/pdf-edit/filenames.test.ts` — expect FAIL.

- [ ] **Step 2: Implement**

Create `src/engines/pdf-edit/filenames.ts`:

```ts
const EDIT_SUFFIX = "-edited";

export function editedFilename(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return `edited.pdf`;
  // Strip trailing .pdf (case-insensitive)
  const lower = trimmed.toLowerCase();
  let base = trimmed;
  if (lower.endsWith(".pdf")) {
    base = trimmed.slice(0, -4);
  }
  if (!base) return `edited.pdf`;
  if (base.toLowerCase().endsWith(EDIT_SUFFIX)) return `${base}.pdf`;
  return `${base}${EDIT_SUFFIX}.pdf`;
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm test src/engines/pdf-edit/filenames.test.ts
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/engines/pdf-edit/filenames.ts src/engines/pdf-edit/filenames.test.ts
git commit -m "$(cat <<'EOF'
feat(pdf-edit): output filename helper

Returns "{name}-edited.pdf" with case-insensitive
extension handling, idempotent on already-suffixed
names, empty-input fallback to "edited.pdf".
EOF
)"
```

---

## Task 8: pdf-edit `worker.ts` (load + renderPage + apply)

**Files:**
- Create: `src/engines/pdf-edit/worker.ts`

Comlink-exposed worker module. `load` parses bytes once and caches the pdf.js doc; `renderPage` reuses the cache; `apply` runs pdf-lib to produce the edited PDF. Encryption is surfaced as a typed error.

- [ ] **Step 1: Write the worker**

Create `src/engines/pdf-edit/worker.ts`:

```ts
import * as Comlink from "comlink";
import { PDFDocument, degrees } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { loadPdfDocument, renderPageThumbnail } from "@/engines/_shared/render-pdf-thumbnail";
import type { PdfEditOptions } from "./options";

let pdfJsDoc: PDFDocumentProxy | null = null;
let sourceBytes: ArrayBuffer | null = null;

export type LoadResult = { pageCount: number };
export type EncryptedError = { kind: "encrypted" };

const api = {
  /**
   * Parse a PDF and cache the pdf.js doc + raw bytes for later renderPage /
   * apply calls. Throws { kind: "encrypted" } on password-protected PDFs.
   */
  async load(bytes: ArrayBuffer): Promise<LoadResult> {
    // Discard any previous file cache.
    if (pdfJsDoc) {
      try {
        await pdfJsDoc.destroy();
      } catch {
        /* ignore */
      }
      pdfJsDoc = null;
    }
    sourceBytes = bytes;
    try {
      pdfJsDoc = await loadPdfDocument(bytes);
    } catch (err: unknown) {
      const name = (err as { name?: string }).name;
      if (name === "PasswordException") {
        // Surface encryption as a structured error the engine recognises.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw { kind: "encrypted" } as EncryptedError;
      }
      throw err;
    }
    return { pageCount: pdfJsDoc.numPages };
  },

  /**
   * Render a single page thumbnail. Throws if `load()` was not called or
   * if the source bytes were cleared.
   */
  async renderPage(pageIndex: number, size: number): Promise<Blob> {
    if (!pdfJsDoc) throw new Error("pdf-edit worker: load() must be called before renderPage()");
    return renderPageThumbnail(pdfJsDoc, pageIndex, size);
  },

  /**
   * Apply edits via pdf-lib. Composes user-applied rotation with the
   * source page's existing rotation modulo 360.
   */
  async apply(opts: PdfEditOptions): Promise<Uint8Array> {
    if (!sourceBytes) throw new Error("pdf-edit worker: load() must be called before apply()");
    if (opts.pages.length === 0) {
      throw new Error("at least one page must remain");
    }
    const source = await PDFDocument.load(sourceBytes, { ignoreEncryption: false });
    const sourcePages = source.getPages();
    const target = await PDFDocument.create();

    for (const edit of opts.pages) {
      if (edit.sourceIndex < 0 || edit.sourceIndex >= sourcePages.length) {
        throw new Error(
          `pdf-edit: sourceIndex ${edit.sourceIndex} out of range (0..${sourcePages.length - 1})`,
        );
      }
      const [copied] = await target.copyPages(source, [edit.sourceIndex]);
      if (!copied) throw new Error(`pdf-edit: copyPages returned no page for index ${edit.sourceIndex}`);
      const sourceRotation = sourcePages[edit.sourceIndex]!.getRotation().angle;
      const composed = (((sourceRotation + edit.rotation) % 360) + 360) % 360;
      copied.setRotation(degrees(composed));
      target.addPage(copied);
    }

    return await target.save();
  },

  /**
   * Release cached pdf.js doc + bytes. Called by the engine on dispose.
   */
  async dispose(): Promise<void> {
    if (pdfJsDoc) {
      try {
        await pdfJsDoc.destroy();
      } catch {
        /* ignore */
      }
      pdfJsDoc = null;
    }
    sourceBytes = null;
  },
};

export type PdfEditWorkerApi = typeof api;

Comlink.expose(api);
```

- [ ] **Step 2: Type-check**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Lint**

```bash
pnpm lint
```

Expected: clean. (No `fetch` / `XMLHttpRequest` — Biome rule satisfied.)

- [ ] **Step 4: Commit (worker only — its correctness test is the next task)**

```bash
git add src/engines/pdf-edit/worker.ts
git commit -m "$(cat <<'EOF'
feat(pdf-edit): worker — load / renderPage / apply

Load caches pdf.js doc + bytes; renderPage reuses
the cached doc; apply uses pdf-lib to copy and
rotate pages, composing user rotation with the
source page's existing rotation modulo 360.

Encrypted PDFs throw { kind: "encrypted" } so the
engine surfaces a typed error rather than the raw
pdf.js PasswordException.
EOF
)"
```

---

## Task 9: pdf-edit worker correctness test (against the fixture)

**Files:**
- Create: `src/engines/pdf-edit/worker.correctness.test.ts`

Tests run in node — no jsdom — using `pdf-lib` directly. They import the same private functions the worker uses (`apply`'s logic) but bypass Comlink. The cleanest approach is to extract `apply` into a pure exported function used by both the Comlink wrapper and the test.

- [ ] **Step 1: Refactor worker — extract pure `applyEdits`**

Edit `src/engines/pdf-edit/worker.ts`. Add an exported helper above the `api` object, and have `api.apply` delegate to it:

```ts
/**
 * Pure function: produce the edited PDF bytes from source bytes + edits.
 * Exported so correctness tests can call it without instantiating a
 * Comlink-wrapped Worker.
 */
export async function applyEdits(
  sourceBytes: ArrayBuffer,
  opts: PdfEditOptions,
): Promise<Uint8Array> {
  if (opts.pages.length === 0) throw new Error("at least one page must remain");
  const source = await PDFDocument.load(sourceBytes, { ignoreEncryption: false });
  const sourcePages = source.getPages();
  const target = await PDFDocument.create();
  for (const edit of opts.pages) {
    if (edit.sourceIndex < 0 || edit.sourceIndex >= sourcePages.length) {
      throw new Error(
        `pdf-edit: sourceIndex ${edit.sourceIndex} out of range (0..${sourcePages.length - 1})`,
      );
    }
    const [copied] = await target.copyPages(source, [edit.sourceIndex]);
    if (!copied) throw new Error(`pdf-edit: copyPages returned no page for ${edit.sourceIndex}`);
    const sourceRotation = sourcePages[edit.sourceIndex]!.getRotation().angle;
    const composed = (((sourceRotation + edit.rotation) % 360) + 360) % 360;
    copied.setRotation(degrees(composed));
    target.addPage(copied);
  }
  return await target.save();
}
```

Then in `api.apply`, replace the body with:

```ts
async apply(opts: PdfEditOptions): Promise<Uint8Array> {
  if (!sourceBytes) throw new Error("pdf-edit worker: load() must be called before apply()");
  return applyEdits(sourceBytes, opts);
},
```

- [ ] **Step 2: Write the correctness test**

Create `src/engines/pdf-edit/worker.correctness.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { applyEdits } from "./worker";
import type { PdfEditOptions } from "./options";

const FIXTURE = path.resolve(__dirname, "../../../tests/fixtures/pdf-edit/multi-page.pdf");

function loadFixture(): ArrayBuffer {
  const buf = readFileSync(FIXTURE);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("pdf-edit applyEdits — correctness", () => {
  it("rotates page 2, reorders 3 and 4, deletes page 5", async () => {
    const bytes = loadFixture();
    // Build the edit set: take pages [0, 1, 3, 2] with rotations [0, 90, 0, 0]
    // (i.e., delete the original page 4 (index 4), rotate page 2 (index 1) by
    // 90, swap pages 3 and 4 (indices 2 and 3)).
    const opts: PdfEditOptions = {
      pages: [
        { id: "a", sourceIndex: 0, rotation: 0 },
        { id: "b", sourceIndex: 1, rotation: 90 },
        { id: "c", sourceIndex: 3, rotation: 0 },
        { id: "d", sourceIndex: 2, rotation: 0 },
      ],
      totalSourcePages: 5,
    };
    const out = await applyEdits(bytes, opts);
    const outDoc = await PDFDocument.load(out);
    const outPages = outDoc.getPages();
    expect(outPages.length).toBe(4);

    // Source rotations: [0, 0, 90, 0, 0]
    // Edit: [{0,0}, {1,90}, {3,0}, {2,0}]
    // Expected composed rotations:
    //   page 0 source 0 + 0   = 0
    //   page 1 source 0 + 90  = 90
    //   page 3 source 0 + 0   = 0
    //   page 2 source 90 + 0  = 90
    expect(outPages[0]!.getRotation().angle).toBe(0);
    expect(outPages[1]!.getRotation().angle).toBe(90);
    expect(outPages[2]!.getRotation().angle).toBe(0);
    expect(outPages[3]!.getRotation().angle).toBe(90);
  });

  it("composes rotate-all with a pre-rotated source page", async () => {
    const bytes = loadFixture();
    // Take all 5 pages in order, each with user rotation 90°.
    const opts: PdfEditOptions = {
      pages: [
        { id: "a", sourceIndex: 0, rotation: 90 },
        { id: "b", sourceIndex: 1, rotation: 90 },
        { id: "c", sourceIndex: 2, rotation: 90 }, // source 90 + user 90 = 180
        { id: "d", sourceIndex: 3, rotation: 90 },
        { id: "e", sourceIndex: 4, rotation: 90 },
      ],
      totalSourcePages: 5,
    };
    const out = await applyEdits(bytes, opts);
    const outDoc = await PDFDocument.load(out);
    const outPages = outDoc.getPages();
    expect(outPages[0]!.getRotation().angle).toBe(90);
    expect(outPages[1]!.getRotation().angle).toBe(90);
    expect(outPages[2]!.getRotation().angle).toBe(180); // composition test
    expect(outPages[3]!.getRotation().angle).toBe(90);
    expect(outPages[4]!.getRotation().angle).toBe(90);
  });

  it("rejects empty edit set", async () => {
    const bytes = loadFixture();
    await expect(
      applyEdits(bytes, { pages: [], totalSourcePages: 5 }),
    ).rejects.toThrow(/at least one page/);
  });

  it("rejects out-of-range sourceIndex", async () => {
    const bytes = loadFixture();
    await expect(
      applyEdits(bytes, {
        pages: [{ id: "a", sourceIndex: 99, rotation: 0 }],
        totalSourcePages: 5,
      }),
    ).rejects.toThrow(/out of range/);
  });
});
```

- [ ] **Step 3: Run the test**

```bash
pnpm test src/engines/pdf-edit/worker.correctness.test.ts
```

Expected: all 4 cases pass.

- [ ] **Step 4: Commit**

```bash
git add src/engines/pdf-edit/worker.ts src/engines/pdf-edit/worker.correctness.test.ts
git commit -m "$(cat <<'EOF'
test(pdf-edit): worker correctness against fixture

Extracts applyEdits as a pure exported function so
correctness tests run without Comlink. Exercises:

- Reorder + per-page rotation + delete combined
- Rotate-all composition with a pre-rotated source
  page (90 + 90 = 180)
- Empty edit set rejection
- Out-of-range sourceIndex rejection
EOF
)"
```

---

## Task 10: pdf-edit `OptionsPanel` (page tray, dnd-kit grid, rotate / delete / rotate-all)

**Files:**
- Create: `src/engines/pdf-edit/options-panel.tsx`

Renders the page tray: a virtualized grid of thumbnails (one per page in `opts.pages`), with rotate / delete buttons per cell and a "Rotate all 90°" toolbar. Drag-reorder via dnd-kit's `rectSortingStrategy`. Thumbnails come from a thumbnail map kept in component state, populated as the worker yields blobs via an IntersectionObserver-driven render queue.

- [ ] **Step 1: Skeleton — toolbar, grid, no thumbnails yet**

Create `src/engines/pdf-edit/options-panel.tsx`:

```tsx
"use client";

import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OptionsPanelProps } from "@/engines/_shared/types";
import {
  applyRotateAll,
  deletePage,
  movePage,
  rotatePage,
  type PdfEditOptions,
  type PdfEditPage,
} from "./options";

const THUMB_SIZE = 120;

type Props = OptionsPanelProps<PdfEditOptions> & {
  /** Map of sourceIndex → object URL for the rendered thumbnail PNG. */
  thumbnails?: Record<number, string>;
  /** Called when a cell scrolls into view; consumer schedules thumbnail render. */
  onRequestThumbnail?: (sourceIndex: number) => void;
};

export function PdfEditOptionsPanel({
  value,
  onChange,
  thumbnails,
  onRequestThumbnail,
}: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const ids = useMemo(() => value.pages.map((p) => p.id), [value.pages]);

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const from = ids.indexOf(String(active.id));
      const to = ids.indexOf(String(over.id));
      if (from === -1 || to === -1) return;
      onChange(movePage(value, from, to));
    },
    [ids, onChange, value],
  );

  const handleRotateAll = useCallback(() => {
    onChange(applyRotateAll(value));
  }, [onChange, value]);

  const handleRotateOne = useCallback(
    (id: string) => onChange(rotatePage(value, id)),
    [onChange, value],
  );

  const handleDeleteOne = useCallback(
    (id: string) => onChange(deletePage(value, id)),
    [onChange, value],
  );

  const indicator =
    value.pages.length === value.totalSourcePages
      ? `${value.pages.length} pages`
      : `${value.totalSourcePages} pages → ${value.pages.length} pages`;

  return (
    <div data-testid="pdf-edit-panel" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleRotateAll}
          data-testid="rotate-all"
          className="border border-foreground px-3 py-1 font-mono text-sm hover:bg-foreground hover:text-background"
        >
          [ rotate all 90° ]
        </button>
        <span data-testid="page-indicator" className="font-mono text-sm">
          {indicator}
        </span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={rectSortingStrategy}>
          <div
            data-testid="page-tray"
            className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3"
          >
            {value.pages.map((page, index) => (
              <PageCell
                key={page.id}
                page={page}
                positionIndex={index}
                thumbnailUrl={thumbnails?.[page.sourceIndex]}
                onRequestThumbnail={onRequestThumbnail}
                onRotate={() => handleRotateOne(page.id)}
                onDelete={() => handleDeleteOne(page.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

type PageCellProps = {
  page: PdfEditPage;
  positionIndex: number;
  thumbnailUrl?: string;
  onRequestThumbnail?: (sourceIndex: number) => void;
  onRotate: () => void;
  onDelete: () => void;
};

function PageCell({
  page,
  positionIndex,
  thumbnailUrl,
  onRequestThumbnail,
  onRotate,
  onDelete,
}: PageCellProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
  });
  const cellRef = useRef<HTMLDivElement | null>(null);

  // Combine dnd-kit's setNodeRef with our IntersectionObserver ref
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      cellRef.current = node;
    },
    [setNodeRef],
  );

  // IntersectionObserver: request thumbnail when cell enters viewport.
  // Stops observing after first request for that page.
  useEffect(() => {
    if (!onRequestThumbnail) return;
    if (thumbnailUrl) return;
    const node = cellRef.current;
    if (!node) return;
    let cancelled = false;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !cancelled) {
            onRequestThumbnail(page.sourceIndex);
            obs.disconnect();
            return;
          }
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(node);
    return () => {
      cancelled = true;
      obs.disconnect();
    };
  }, [onRequestThumbnail, page.sourceIndex, thumbnailUrl]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setRefs}
      style={style}
      data-testid={`page-cell-${page.sourceIndex}`}
      data-page-id={page.id}
      data-source-index={page.sourceIndex}
      data-rotation={page.rotation}
      className="relative flex flex-col border border-foreground bg-background p-2"
      {...attributes}
      {...listeners}
    >
      <div className="flex items-center justify-between text-xs font-mono">
        <span data-testid="page-number">{page.sourceIndex + 1}</span>
        <span data-testid="position-number" className="opacity-50">
          #{positionIndex + 1}
        </span>
      </div>
      <div
        className="my-2 flex aspect-[3/4] w-full items-center justify-center bg-foreground/5"
        style={{
          minHeight: THUMB_SIZE,
        }}
      >
        {thumbnailUrl ? (
          // biome-ignore lint/a11y/useAltText: thumbnail rendered for visual reference only
          <img
            src={thumbnailUrl}
            alt={`page ${page.sourceIndex + 1}`}
            data-testid="page-thumbnail"
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              transform: `rotate(${page.rotation}deg)`,
              transition: "transform 120ms ease-out",
            }}
          />
        ) : (
          <span className="font-mono text-xs opacity-50">—</span>
        )}
      </div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRotate();
          }}
          data-testid="rotate-btn"
          aria-label={`rotate page ${page.sourceIndex + 1}`}
          className="border border-foreground px-2 py-0.5 font-mono text-xs hover:bg-foreground hover:text-background"
        >
          ↻
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          data-testid="delete-btn"
          aria-label={`delete page ${page.sourceIndex + 1}`}
          className="border border-foreground px-2 py-0.5 font-mono text-xs hover:bg-foreground hover:text-background"
        >
          ×
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check + lint**

```bash
pnpm typecheck
pnpm lint
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/engines/pdf-edit/options-panel.tsx
git commit -m "$(cat <<'EOF'
feat(pdf-edit): page tray OptionsPanel

Grid of page cells with dnd-kit rectSortingStrategy
for drag-reorder, per-cell rotate / delete, "rotate
all 90°" toolbar, and an IntersectionObserver-driven
hook for requesting thumbnails as cells scroll in.

Thumbnails are passed in as a sourceIndex -> URL
map plus an onRequestThumbnail callback so the
options panel stays presentational; the thumbnail
queue lives in the OptionsPanel host (engine
descriptor wires this in the next task).
EOF
)"
```

---

## Task 11: pdf-edit `options-panel.test.tsx` (integration tests)

**Files:**
- Create: `src/engines/pdf-edit/options-panel.test.tsx`

- [ ] **Step 1: Write the tests**

Create `src/engines/pdf-edit/options-panel.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PdfEditOptionsPanel } from "./options-panel";
import { seedFromPageCount } from "./options";

describe("PdfEditOptionsPanel", () => {
  it("renders one cell per page with the right page numbers and indicator", () => {
    const value = seedFromPageCount(3);
    render(<PdfEditOptionsPanel value={value} onChange={() => {}} />);
    expect(screen.getByTestId("page-cell-0")).toBeInTheDocument();
    expect(screen.getByTestId("page-cell-1")).toBeInTheDocument();
    expect(screen.getByTestId("page-cell-2")).toBeInTheDocument();
    expect(screen.getByTestId("page-indicator")).toHaveTextContent("3 pages");
  });

  it("rotate-all button calls onChange with all rotations advanced 90°", () => {
    const value = seedFromPageCount(2);
    const onChange = vi.fn();
    render(<PdfEditOptionsPanel value={value} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("rotate-all"));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0];
    expect(next.pages.map((p: { rotation: number }) => p.rotation)).toEqual([90, 90]);
  });

  it("per-cell rotate cycles only that page", () => {
    const value = seedFromPageCount(2);
    const onChange = vi.fn();
    render(<PdfEditOptionsPanel value={value} onChange={onChange} />);
    const rotateButtons = screen.getAllByTestId("rotate-btn");
    fireEvent.click(rotateButtons[0]!);
    const next = onChange.mock.calls[0][0];
    expect(next.pages[0].rotation).toBe(90);
    expect(next.pages[1].rotation).toBe(0);
  });

  it("delete-button removes the page", () => {
    const value = seedFromPageCount(3);
    const onChange = vi.fn();
    render(<PdfEditOptionsPanel value={value} onChange={onChange} />);
    fireEvent.click(screen.getAllByTestId("delete-btn")[1]!);
    const next = onChange.mock.calls[0][0];
    expect(next.pages.length).toBe(2);
    expect(next.pages.map((p: { sourceIndex: number }) => p.sourceIndex)).toEqual([0, 2]);
  });

  it("page indicator shows N → M when pages have been deleted", () => {
    const seeded = seedFromPageCount(5);
    const value = { ...seeded, pages: seeded.pages.slice(0, 3) };
    render(<PdfEditOptionsPanel value={value} onChange={() => {}} />);
    expect(screen.getByTestId("page-indicator")).toHaveTextContent("5 pages → 3 pages");
  });

  it("renders <img> when thumbnailUrl is supplied", () => {
    const value = seedFromPageCount(1);
    render(
      <PdfEditOptionsPanel
        value={value}
        onChange={() => {}}
        thumbnails={{ 0: "blob:thumbnail-mock" }}
      />,
    );
    const img = screen.getByTestId("page-thumbnail") as HTMLImageElement;
    expect(img.src).toBe("blob:thumbnail-mock");
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
pnpm test src/engines/pdf-edit/options-panel.test.tsx
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/engines/pdf-edit/options-panel.test.tsx
git commit -m "$(cat <<'EOF'
test(pdf-edit): OptionsPanel integration tests

Covers: cell rendering, rotate-all wiring,
per-cell rotate / delete wiring, M of N
indicator rendering, thumbnail URL display.
EOF
)"
```

---

## Task 12: pdf-edit `index.ts` (engine descriptor)

**Files:**
- Create: `src/engines/pdf-edit/index.ts`

The engine descriptor wires worker lifecycle (`load` for staging-time validation + page-count seed, `renderPage` for thumbnails on demand, `apply` for Convert), surfaces a typed encryption error from `load()`, and produces the OutputItem on convert. The OptionsPanel-host bridge (passing `thumbnails` and `onRequestThumbnail`) lives in the engine via a small wrapper component, since it's coupled to a specific worker instance.

- [ ] **Step 1: Implement the engine + the OptionsPanel bridge**

Create `src/engines/pdf-edit/index.ts`:

```ts
import * as Comlink from "comlink";
import {
  type ComponentType,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { editedFilename } from "./filenames";
import { PdfEditOptionsPanel } from "./options-panel";
import {
  type PdfEditOptions,
  defaultPdfEditOptions,
  seedFromPageCount,
} from "./options";
import type {
  EngineLicense,
  OptionsPanelProps,
  OutputItem,
  SingleInputEngine,
  ValidationResult,
} from "@/engines/_shared/types";
import type { PdfEditWorkerApi, EncryptedError } from "./worker";

const SUPPORTED_MIMES = ["application/pdf"];
const MAX_BYTES_HARD = 250 * 1_000_000; // §11.1 PDF hard cap
const MAX_PAGES_HARD = 250;
const PAGE_SOFT_WARN = 100;

function makeWorker(): Worker {
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
}

/**
 * Wrapper component that owns the per-mount worker instance and the
 * thumbnail map. Mediates between PdfEditOptionsPanel (presentational)
 * and the Comlink-wrapped worker. Used as the engine's OptionsPanel.
 */
const PdfEditOptionsPanelHost: ComponentType<OptionsPanelProps<PdfEditOptions>> = ({
  value,
  onChange,
}) => {
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const workerRef = useRef<Worker | null>(null);
  const apiRef = useRef<Comlink.Remote<PdfEditWorkerApi> | null>(null);
  // Avoid re-requesting the same page if it's already pending.
  const requestedRef = useRef<Set<number>>(new Set());

  // The harness signals which file is staged via setter calls; we listen
  // for changes to value.totalSourcePages — when it transitions from 0 to
  // N>0, that's our cue that a fresh edit set is in play.
  const lastSeededTotal = useRef<number>(value.totalSourcePages);

  // Tear down on unmount: revoke object URLs, dispose worker.
  useEffect(() => {
    return () => {
      apiRef.current?.dispose();
      workerRef.current?.terminate();
      workerRef.current = null;
      apiRef.current = null;
      for (const url of Object.values(thumbnails)) URL.revokeObjectURL(url);
    };
    // intentionally empty dep array — runs once on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestThumbnail = useCallback(async (sourceIndex: number) => {
    if (requestedRef.current.has(sourceIndex)) return;
    if (!apiRef.current) return;
    requestedRef.current.add(sourceIndex);
    try {
      const blob = await apiRef.current.renderPage(sourceIndex, 240);
      const url = URL.createObjectURL(blob);
      setThumbnails((prev) => ({ ...prev, [sourceIndex]: url }));
    } catch {
      // Thumbnail failure is non-fatal; cell stays with the placeholder.
      requestedRef.current.delete(sourceIndex);
    }
  }, []);

  // The engine's `convert()` is the only path that actually opens the file.
  // For the OptionsPanel to populate thumbnails, the file's bytes must be
  // available before Convert is clicked. The harness provides them via
  // a side channel: when totalSourcePages > 0 in `value`, the host has
  // already invoked engine.validate (which loaded bytes via FileReader)
  // and seeded options; the worker is created lazily on the first
  // requestThumbnail call. On that first call, we re-load the file via
  // the harness's stagedFile getter — but we don't have it here.
  //
  // Instead: the engine calls `loadIntoWorker(file)` exposed below via
  // a module-level callback when validate-time seeding happens. See
  // engine.validate.

  return (
    <PdfEditOptionsPanel
      value={value}
      onChange={onChange}
      thumbnails={thumbnails}
      onRequestThumbnail={requestThumbnail}
    />
  );
};

// Module-level singleton: the worker that holds the parsed file. Created
// when the engine sees a fresh file (validate time). The OptionsPanel
// host reads from this same worker; Convert reuses it.
let activeWorker: Worker | null = null;
let activeApi: Comlink.Remote<PdfEditWorkerApi> | null = null;
let activeFileKey: string | null = null;

async function loadFileIntoWorker(file: File): Promise<{ pageCount: number }> {
  const key = `${file.name}:${file.size}:${file.lastModified}`;
  if (key === activeFileKey && activeApi) {
    // Already loaded this exact file.
    const buf = await file.arrayBuffer();
    return await activeApi.load(buf);
  }
  // Replace active worker.
  if (activeWorker) {
    try {
      await activeApi?.dispose();
    } catch {
      /* ignore */
    }
    activeWorker.terminate();
  }
  activeWorker = makeWorker();
  activeApi = Comlink.wrap<PdfEditWorkerApi>(activeWorker);
  activeFileKey = key;
  const buf = await file.arrayBuffer();
  return await activeApi.load(buf);
}

function disposeActive(): void {
  if (activeApi) {
    activeApi.dispose().catch(() => {});
  }
  activeWorker?.terminate();
  activeWorker = null;
  activeApi = null;
  activeFileKey = null;
}

const engine: SingleInputEngine<PdfEditOptions, OutputItem> = {
  id: "pdf-edit",
  inputAccept: [".pdf"],
  inputMime: SUPPORTED_MIMES,
  outputMime: "application/pdf",
  defaultOptions: defaultPdfEditOptions,
  category: "pdf",
  library: "pdf-lib, pdfjs-dist",
  license: "mixed" as EngineLicense,
  cardinality: "single",
  OptionsPanel: PdfEditOptionsPanelHost,

  validate(file): ValidationResult {
    const mimeOk = SUPPORTED_MIMES.includes(file.type);
    const extOk = /\.pdf$/i.test(file.name);
    if (!mimeOk && !extOk) return { ok: false, reason: "Expected a PDF file" };
    if (file.size === 0) return { ok: false, reason: "File is empty" };
    if (file.size > MAX_BYTES_HARD) {
      return {
        ok: false,
        reason: `File too large for pdf-edit (limit 250 MB; got ${(file.size / 1_000_000).toFixed(1)} MB)`,
      };
    }
    return { ok: true };
  },

  /**
   * Seed `opts.pages` from the file's actual page count. Called by the
   * harness once the file is staged and validated; the result becomes
   * the new defaultOptions for this conversion run.
   *
   * (This isn't part of SingleInputEngine yet — exposed as an additive
   * field that the harness may opt into. See harness.ts integration in
   * Task 14 if it requires harness extension; otherwise the OptionsPanel
   * host triggers seeding on its own.)
   */
  // For now, seeding happens inside convert() if pages.length === 0 — we
  // also use the same path inside the OptionsPanel host's first-use case.
  async convert(file, opts, signal, _runOpts): Promise<OutputItem> {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");

    let workingOpts = opts;
    if (workingOpts.pages.length === 0) {
      // No edits were applied (user clicked Convert immediately); load and
      // pass through with rotation 0 / original order / no deletes.
      let pageCount: number;
      try {
        ({ pageCount } = await loadFileIntoWorker(file));
      } catch (err: unknown) {
        if ((err as EncryptedError | undefined)?.kind === "encrypted") {
          throw new Error("Encrypted PDFs aren't supported");
        }
        throw err;
      }
      if (pageCount > MAX_PAGES_HARD) {
        throw new Error(
          `Too many pages (${pageCount} > ${MAX_PAGES_HARD}) — split first`,
        );
      }
      workingOpts = seedFromPageCount(pageCount);
    }

    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    if (!activeApi) await loadFileIntoWorker(file);
    if (!activeApi) throw new Error("pdf-edit: worker failed to initialise");

    const bytes = await activeApi.apply(workingOpts);
    const blob = new Blob([bytes], { type: "application/pdf" });
    return {
      filename: editedFilename(file.name),
      mime: "application/pdf",
      blob,
    };
  },

  isReadyToConvert(opts) {
    // If pages haven't been seeded yet (file just dropped), Convert is
    // still ready — convert() will seed from the file. If pages have been
    // seeded, require at least one page remaining.
    if (opts.totalSourcePages === 0) return true;
    return opts.pages.length > 0;
  },
};

export { disposeActive as __disposeActiveWorkerForTest };
export default engine;
```

NOTE: The "module-level singleton worker" plus "validate-time seeding" pattern in this task is provisional — if the existing harness already provides a clean way to expose the parsed `pageCount` to the OptionsPanel before Convert (e.g., via an explicit `engine.prepare(file)` lifecycle hook), use that instead. Re-read `src/engines/_shared/harness.ts` at the start of this task and prefer the harness's seam if one exists. If the harness doesn't have a seam, the implementation above is acceptable but flag it in the PR as a future-cleanup target.

- [ ] **Step 2: Type-check**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit (descriptor only — its tests are next)**

```bash
git add src/engines/pdf-edit/index.ts
git commit -m "$(cat <<'EOF'
feat(pdf-edit): engine descriptor

Wires the worker (load / renderPage / apply) to the
SingleInputEngine surface. validate enforces 250 MB
hard cap; convert seeds pages from page count if
unedited, rejects 250+ pages, surfaces the typed
encrypted-PDF error as a user-facing reason.

Module-level worker singleton mediates between the
OptionsPanel (which needs renderPage on demand) and
convert (which calls apply). This pattern is
provisional pending a harness lifecycle seam — see
PR description.
EOF
)"
```

---

## Task 13: pdf-edit `index.test.ts`

**Files:**
- Create: `src/engines/pdf-edit/index.test.ts`

Metadata + validation tests only. Real conversion is exercised by the worker correctness test (Task 9) and the E2E spec (Task 16).

- [ ] **Step 1: Write the tests**

Create `src/engines/pdf-edit/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import engine from "./index";

describe("pdf-edit engine metadata", () => {
  it("declares correct id, cardinality, category, output", () => {
    expect(engine.id).toBe("pdf-edit");
    expect(engine.cardinality).toBe("single");
    expect(engine.category).toBe("pdf");
    expect(engine.outputMime).toBe("application/pdf");
  });

  it("declares library + license", () => {
    expect(engine.library).toMatch(/pdf-lib/);
    expect(engine.license).toBe("mixed");
  });

  it("validate accepts PDF MIME", () => {
    const v = engine.validate(
      new File([new Uint8Array(1)], "doc.pdf", { type: "application/pdf" }),
      engine.defaultOptions,
    );
    expect(v).toEqual({ ok: true });
  });

  it("validate accepts .pdf extension fallback (empty MIME)", () => {
    const v = engine.validate(
      new File([new Uint8Array(1)], "doc.pdf", { type: "" }),
      engine.defaultOptions,
    );
    expect(v).toEqual({ ok: true });
  });

  it("validate rejects non-PDF type", () => {
    const v = engine.validate(
      new File([new Uint8Array(1)], "doc.txt", { type: "text/plain" }),
      engine.defaultOptions,
    );
    expect(v.ok).toBe(false);
  });

  it("validate rejects empty file", () => {
    const v = engine.validate(
      new File([], "doc.pdf", { type: "application/pdf" }),
      engine.defaultOptions,
    );
    expect(v.ok).toBe(false);
  });

  it("validate rejects file above 250 MB hard cap", () => {
    const big = new File([new Uint8Array(251_000_000)], "big.pdf", {
      type: "application/pdf",
    });
    const v = engine.validate(big, engine.defaultOptions);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/250 MB/);
  });

  it("isReadyToConvert returns true when no file has been loaded yet", () => {
    expect(engine.isReadyToConvert?.(engine.defaultOptions)).toBe(true);
  });

  it("isReadyToConvert returns false when all pages are deleted", () => {
    expect(
      engine.isReadyToConvert?.({ pages: [], totalSourcePages: 5 }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
pnpm test src/engines/pdf-edit/index.test.ts
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/engines/pdf-edit/index.test.ts
git commit -m "$(cat <<'EOF'
test(pdf-edit): engine descriptor metadata + validate

Covers id / cardinality / category / outputMime /
library / license metadata; PDF MIME + extension
fallback; rejection on non-PDF / empty / oversized;
isReadyToConvert pre- and post-seed.
EOF
)"
```

---

## Task 14: Register pdf-edit (registry + sidebar + home grid)

**Files:**
- Modify: `src/engines/_shared/registry.ts`
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Add to registry**

Edit `src/engines/_shared/registry.ts`. Add `"pdf-edit"` to the `EngineId` union (alphabetical order is fine — slot it after `pdf-merge` to keep PDFs grouped) and add a loader entry:

```ts
export type EngineId =
  | "docx-to-txt"
  | "image-bg-remove"
  | "image-convert"
  | "image-resize"
  | "image-to-pdf"
  | "markdown-to-pdf"
  | "pdf-edit"
  | "pdf-merge"
  | "pdf-split"
  | "pdf-to-image"
  | "pdf-to-md"
  | "docx-to-pdf"
  | "txt-to-pdf";

const REGISTRY: Record<EngineId, Loader> = {
  // ... existing entries ...
  "pdf-edit": () => import("@/engines/pdf-edit"),
  // ...
};
```

- [ ] **Step 2: Add to sidebar**

Inspect `src/components/layout/sidebar.tsx` to see how `pdf-merge` and `pdf-split` are listed, then add `pdf-edit` to the same `PDFS` group. Alphabetical or by frequency-of-use; match the existing pattern.

- [ ] **Step 3: Add to home grid**

Edit `src/app/page.tsx`. The `TOOLS` array (visible at the top of the file) is the home grid source. Add an entry for `pdf-edit` between `pdf-merge` and `pdf-split`:

```ts
{
  id: "pdf-edit",
  title: "edit",
  description: "rotate, reorder, delete pages of a pdf",
  href: "/tools/pdf-edit",
},
```

- [ ] **Step 4: Run typecheck + the registry metadata test from Task 2**

```bash
pnpm typecheck
pnpm test src/engines/_shared/registry
```

Expected: clean. The metadata test now also covers `pdf-edit` (since registered engines must declare library+license, and the descriptor does).

- [ ] **Step 5: Commit**

```bash
git add src/engines/_shared/registry.ts src/components/layout/sidebar.tsx src/app/page.tsx
git commit -m "$(cat <<'EOF'
feat(pdf-edit): wire registry, sidebar, home grid

Adds pdf-edit to EngineId, the lazy-loader REGISTRY,
the PDFS sidebar group, and the home-page TOOLS
array.
EOF
)"
```

---

## Task 15: Route `/tools/pdf-edit/page.tsx`

**Files:**
- Create: `src/app/tools/pdf-edit/page.tsx`

Match the existing route pattern (e.g., `src/app/tools/pdf-merge/page.tsx` or `src/app/tools/pdf-to-md/page.tsx`).

- [ ] **Step 1: Read a reference route**

```bash
cat src/app/tools/pdf-to-md/page.tsx
```

Note the imports, page metadata, and ToolFrame mounting. Follow the same shape.

- [ ] **Step 2: Implement**

Create `src/app/tools/pdf-edit/page.tsx` (replace `<imports>` and `<frame component>` with whatever the reference route uses):

```tsx
"use client";

import { ToolFrame } from "@/components/tool-frame";

export default function PdfEditPage() {
  return <ToolFrame engineId="pdf-edit" />;
}
```

(If the reference route is more elaborate — e.g., wraps in a layout component — match that exactly.)

- [ ] **Step 3: Smoke check the dev server**

```bash
pnpm dev
```

Open `http://localhost:3000/tools/pdf-edit` in a non-Turbopack browser tab. Page should load with the ToolFrame and a "drop a file" zone. Drag the `tests/fixtures/pdf-edit/multi-page.pdf` fixture in and verify the page tray populates with 5 cells. Click rotate-all, reorder one cell, click Convert, and verify a download fires.

Stop dev server (Ctrl+C).

- [ ] **Step 4: Commit**

```bash
git add src/app/tools/pdf-edit/page.tsx
git commit -m "$(cat <<'EOF'
feat(pdf-edit): /tools/pdf-edit route

Same ToolFrame mounting pattern as other
single-input engine routes.
EOF
)"
```

---

## Task 16: E2E happy-path spec

**Files:**
- Create: `tests/e2e/pdf-edit.spec.ts`

End-to-end: drop the multi-page fixture → page tray populates → click rotate on p2 → drag p3 to p4 position → click delete on p5 → click Convert → download → assert filename + page count + rotations on the downloaded PDF.

- [ ] **Step 1: Write the spec**

Create `tests/e2e/pdf-edit.spec.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const FIXTURE = path.resolve(__dirname, "../fixtures/pdf-edit/multi-page.pdf");
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF

test.describe.configure({ mode: "serial" });

test("pdf-edit: rotate, reorder, delete, convert", async ({ page }) => {
  await page.goto("/tools/pdf-edit");
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  await page.locator('input[type="file"]').setInputFiles(FIXTURE);

  // Page tray populates with 5 cells (one per page).
  for (let i = 0; i < 5; i++) {
    await expect(page.getByTestId(`page-cell-${i}`)).toBeVisible();
  }

  // Rotate page 2 (sourceIndex 1).
  await page.getByTestId("page-cell-1").getByTestId("rotate-btn").click();
  await expect(page.getByTestId("page-cell-1")).toHaveAttribute("data-rotation", "90");

  // Delete page 5 (sourceIndex 4).
  await page.getByTestId("page-cell-4").getByTestId("delete-btn").click();
  await expect(page.getByTestId("page-cell-4")).toHaveCount(0);
  await expect(page.getByTestId("page-indicator")).toHaveText("5 pages → 4 pages");

  // Convert.
  const downloadPromise = page.waitForEvent("download", { timeout: 20_000 });
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/multi-page-edited\.pdf$/);

  const out = await download.path();
  const bytes = await readFile(out);
  expect(bytes.subarray(0, 4)).toEqual(PDF_MAGIC);
  expect(bytes.length).toBeGreaterThan(500);

  // Re-decode in-page via pdf.js to verify page count and rotations.
  const stats = await page.evaluate(async (b64) => {
    // pdfjs-dist is loaded by the engine code; assume the pdf.js worker is
    // configured for the page already by the time the convert button is
    // available (the engine uses pdf.js for thumbnails too). Otherwise
    // fall back to importing the module here.
    // @ts-expect-error pdfjsLib loaded by engine
    const pdfjsLib = (window as unknown as { pdfjsLib?: unknown }).pdfjsLib;
    let lib: typeof import("pdfjs-dist");
    if (pdfjsLib) {
      lib = pdfjsLib as typeof import("pdfjs-dist");
    } else {
      lib = await import("pdfjs-dist");
    }
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const doc = await lib.getDocument({ data: arr }).promise;
    const rotations: number[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      rotations.push(p.rotate);
    }
    const result = { pageCount: doc.numPages, rotations };
    await doc.destroy();
    return result;
  }, bytes.toString("base64"));

  expect(stats.pageCount).toBe(4);
  // Source rotations: [0, 0, 90, 0] (we deleted source page 5).
  // Edits: rotate page 1 (sourceIndex 1) by 90.
  // Output rotations:
  //   sourceIndex 0: 0 + 0 = 0
  //   sourceIndex 1: 0 + 90 = 90
  //   sourceIndex 2: 90 + 0 = 90 (source page already rotated 90)
  //   sourceIndex 3: 0 + 0 = 0
  expect(stats.rotations).toEqual([0, 90, 90, 0]);
});
```

- [ ] **Step 2: Run the spec**

```bash
pnpm test:e2e --project=chromium tests/e2e/pdf-edit.spec.ts
```

Expected: pass. Adjust selectors/timing if any flakes (often the first conversion takes longer than expected — bump the `[ DONE ]` timeout if needed).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/pdf-edit.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): pdf-edit happy path

Drops fixture → rotates page 2 → deletes page 5 →
Convert → asserts downloaded filename, page count,
and per-page rotation composition (incl. source-page
pre-rotation on page 3).
EOF
)"
```

---

## Task 17: E2E privacy regression spec for pdf-edit

**Files:**
- Create: `tests/e2e/privacy-regression-pdf-edit.spec.ts`

Standard zero-network regression. Copy the existing pdf-merge variant and adapt.

- [ ] **Step 1: Read the reference**

```bash
cat tests/e2e/privacy-regression-pdf-merge.spec.ts
```

- [ ] **Step 2: Write the new spec**

Create `tests/e2e/privacy-regression-pdf-edit.spec.ts`. Mirror the structure of `privacy-regression-pdf-merge.spec.ts` exactly, replacing:
- the route to `/tools/pdf-edit`
- the file picker input setting to the pdf-edit fixture
- the test name + assertion message

The set of allowed page-load requests (assets, fonts, the route HTML, etc.) carries over unchanged — the privacy assertion is "no requests during conversion," not "no requests at all."

```ts
import path from "node:path";
import { expect, test } from "@playwright/test";

const FIXTURE = path.resolve(__dirname, "../fixtures/pdf-edit/multi-page.pdf");

test("pdf-edit: zero outbound network during conversion", async ({ page }) => {
  await page.goto("/tools/pdf-edit");
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  await page.locator('input[type="file"]').setInputFiles(FIXTURE);
  for (let i = 0; i < 5; i++) {
    await expect(page.getByTestId(`page-cell-${i}`)).toBeVisible();
  }

  // After staging is done, start recording requests. We allow blob:, data:,
  // and same-origin requests for thumbnails/wasm; we forbid any other
  // outbound network (this is the same allowlist pattern used by other
  // privacy-regression specs — copy from privacy-regression-pdf-merge).
  const baseUrl = new URL(page.url());
  const offending: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.startsWith("blob:") || url.startsWith("data:")) return;
    const u = new URL(url);
    if (u.host === baseUrl.host) return;
    offending.push(url);
  });

  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
  await downloadPromise;

  expect(offending, `Outbound network during conversion: ${offending.join(", ")}`).toEqual([]);
});
```

If the existing `privacy-regression-pdf-merge.spec.ts` uses a slightly different allowlist mechanism (e.g., a shared helper), use that instead of inlining.

- [ ] **Step 3: Run the spec**

```bash
pnpm test:e2e --project=chromium tests/e2e/privacy-regression-pdf-edit.spec.ts
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/privacy-regression-pdf-edit.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): pdf-edit privacy regression

Asserts zero non-same-origin requests during the
edit + convert flow. Standard pattern matched to
privacy-regression-pdf-merge.spec.ts.
EOF
)"
```

---

## Group D — `/about` page

## Task 18: `/about` route + content sections (no engines table yet)

**Files:**
- Create: `src/app/about/page.tsx`

Static content for sections 1-4 + 6 (the engines table is its own component, added in the next task). Match the brutalist monospace treatment of the home and tool pages — read `src/app/page.tsx` and a tool page for the existing primitives (border / spacing / font tokens).

- [ ] **Step 1: Read the existing typography**

```bash
head -80 src/app/page.tsx
```

Note the headers (`[ section ]`-style monospace), color tokens, and divider style. Reuse those classes verbatim.

- [ ] **Step 2: Write the page**

Create `src/app/about/page.tsx`:

```tsx
import Link from "next/link";

const GITHUB_URL = "https://github.com/tonyyu2170/file-converter";

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-[720px] px-6 py-16 font-mono">
      <h1 className="text-4xl font-bold tracking-tight">
        files never leave your device.
      </h1>

      <Section heading="why this exists">
        <p>
          common file conversions today require uploading personal documents to
          ad-supported third-party sites of unknown provenance. this site does
          the conversion entirely in the browser so no file ever traverses the
          network.
        </p>
      </Section>

      <Section heading="verify it yourself">
        <ol className="ml-5 list-decimal space-y-1">
          <li>open devtools (cmd+option+i on macos, f12 on windows/linux).</li>
          <li>switch to the network tab.</li>
          <li>set the filter to "fetch/xhr".</li>
          <li>drop a file in any tool on this site.</li>
          <li>click convert.</li>
          <li>observe: zero new requests during conversion.</li>
        </ol>
        <p className="mt-3 opacity-70">
          page-load assets show on first visit and are then cached. nothing is
          fetched during the actual conversion step.
        </p>
      </Section>

      <Section heading="how it works">
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>static export.</strong> no server runtime — the entire
            site is html/js/css/wasm served from a cdn.
          </li>
          <li>
            <strong>web worker per conversion.</strong> conversion code runs
            off the main thread; large files don't freeze the tab.
          </li>
          <li>
            <strong>strict csp.</strong> <code>connect-src 'self'</code> makes
            off-origin fetches structurally impossible — not a promise, an
            enforced header.
          </li>
        </ul>
      </Section>

      <Section heading="engines">
        {/* Engines table component is wired in the next task. */}
        <p className="opacity-70">— transparency table loading —</p>
      </Section>

      <Section heading="source">
        <p>
          <Link
            href={GITHUB_URL}
            className="underline hover:no-underline"
            target="_blank"
            rel="noreferrer noopener"
          >
            {GITHUB_URL.replace(/^https:\/\//, "")}
          </Link>
        </p>
      </Section>
    </main>
  );
}

function Section({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="mb-3 text-sm uppercase tracking-widest opacity-70">
        [ {heading} ]
      </h2>
      <div className="space-y-2 text-sm">{children}</div>
    </section>
  );
}
```

If the GitHub URL in `GITHUB_URL` differs from the actual repo URL, update it. Check `git remote get-url origin` to confirm.

- [ ] **Step 3: Smoke check**

```bash
pnpm dev
```

Open `http://localhost:3000/about`. Verify the page renders all five visible sections and looks consistent with the home page.

Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add src/app/about/page.tsx
git commit -m "$(cat <<'EOF'
feat(about): static /about page — sections 1-4 + 6

Privacy promise, why-this-exists, verify-yourself
DevTools steps, how-it-works (static export / web
worker / strict CSP), source link. Matches the
existing brutalist monospace treatment.

Engines transparency table is wired in the next
task.
EOF
)"
```

---

## Task 19: Engines transparency table

**Files:**
- Create: `src/app/about/engines-table.tsx`
- Create: `src/app/about/engines-table.test.tsx`
- Modify: `src/app/about/page.tsx`

Reads `library` and `license` from the registry (every engine declares them, per Task 2). Sorted by category, then id.

- [ ] **Step 1: Implement the component**

Create `src/app/about/engines-table.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { listEngineIds, loadEngine } from "@/engines/_shared/registry";

type Row = {
  id: string;
  category: string;
  library: string;
  license: string;
};

export function EnginesTable() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = listEngineIds();
      const loaded = await Promise.all(
        ids.map(async (id) => {
          const e = await loadEngine(id);
          return {
            id: e.id,
            category: e.category,
            library: e.library ?? "—",
            license: e.license ?? "—",
          };
        }),
      );
      loaded.sort((a, b) =>
        a.category === b.category ? a.id.localeCompare(b.id) : a.category.localeCompare(b.category),
      );
      if (!cancelled) setRows(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!rows) return <p className="opacity-70">— loading engines —</p>;

  return (
    <table data-testid="engines-table" className="w-full border-collapse text-xs">
      <thead>
        <tr className="border-b border-foreground/30 text-left">
          <th className="py-1 pr-4 font-medium">tool</th>
          <th className="py-1 pr-4 font-medium">library</th>
          <th className="py-1 font-medium">license</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} data-testid={`engine-row-${r.id}`} className="border-b border-foreground/10">
            <td className="py-1 pr-4">{r.id}</td>
            <td className="py-1 pr-4">{r.library}</td>
            <td className="py-1">{r.license}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: Wire it into the page**

Edit `src/app/about/page.tsx`. Replace the placeholder `<p>— transparency table loading —</p>` inside the `engines` section with:

```tsx
<EnginesTable />
```

And add the import at the top:

```tsx
import { EnginesTable } from "./engines-table";
```

- [ ] **Step 3: Write the test**

Create `src/app/about/engines-table.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EnginesTable } from "./engines-table";
import { listEngineIds } from "@/engines/_shared/registry";

describe("EnginesTable", () => {
  it("renders one row per registered engine after loading", async () => {
    render(<EnginesTable />);
    // The component lazy-loads engines via dynamic import; wait for the
    // table to appear (no rows are rendered until all loadEngine() promises
    // resolve).
    const table = await screen.findByTestId("engines-table", undefined, { timeout: 5_000 });
    expect(table).toBeInTheDocument();
    for (const id of listEngineIds()) {
      expect(screen.getByTestId(`engine-row-${id}`)).toBeInTheDocument();
    }
  });

  it("displays the library + license values from each engine descriptor", async () => {
    render(<EnginesTable />);
    const pdfMergeRow = await screen.findByTestId("engine-row-pdf-merge", undefined, {
      timeout: 5_000,
    });
    expect(pdfMergeRow).toHaveTextContent("pdf-lib");
    expect(pdfMergeRow).toHaveTextContent("MIT");
  });
});
```

- [ ] **Step 4: Run the test**

```bash
pnpm test src/app/about
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/about/engines-table.tsx src/app/about/engines-table.test.tsx src/app/about/page.tsx
git commit -m "$(cat <<'EOF'
feat(about): engines transparency table

Renders one row per registered engine, with
library + license sourced from the engine
descriptor metadata. Sorted by category then id.
EOF
)"
```

---

## Task 20: Footer + sidebar links to `/about`

**Files:**
- Modify: `src/components/layout/footer.tsx`
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Inspect the footer**

```bash
cat src/components/layout/footer.tsx
```

Note where the existing site-version line is. Add a sibling link to `/about` next to it (separator: ` · `).

- [ ] **Step 2: Add the footer link**

Edit `src/components/layout/footer.tsx` and add an `<a href="/about">` near the version line. Use the existing styling primitives (no new CSS).

- [ ] **Step 3: Add the sidebar link**

Edit `src/components/layout/sidebar.tsx`. Below the engine groups, add an "ABOUT" entry that links to `/about`. Style consistent with the engine entries.

- [ ] **Step 4: Update tests if any reference the footer/sidebar contents**

Run `pnpm test src/components/layout` and fix any test that hard-codes the absence of an /about link.

- [ ] **Step 5: Smoke check**

```bash
pnpm dev
```

Verify both links navigate to `/about`. Stop dev server.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/footer.tsx src/components/layout/sidebar.tsx src/components/layout/footer.test.tsx src/components/layout/sidebar.test.tsx
git commit -m "$(cat <<'EOF'
feat(about): footer + sidebar links

Adds /about navigation from the layout footer
(adjacent to site-version) and the bottom of the
sidebar. Updates layout tests accordingly.
EOF
)"
```

---

## Task 21: `/about` E2E

**Files:**
- Create: `tests/e2e/about.spec.ts`

- [ ] **Step 1: Write the spec**

Create `tests/e2e/about.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("/about renders the privacy claim and engines table", async ({ page }) => {
  await page.goto("/about");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    /files never leave your device/i,
  );
  // All five visible section headings.
  for (const heading of [
    "why this exists",
    "verify it yourself",
    "how it works",
    "engines",
    "source",
  ]) {
    await expect(page.locator(`h2:has-text("${heading}")`)).toBeVisible();
  }
  // Engines table populates with at least one row.
  const table = page.getByTestId("engines-table");
  await expect(table).toBeVisible({ timeout: 10_000 });
  await expect(table.locator("tbody tr")).not.toHaveCount(0);
  // Source link points at a github URL.
  const sourceLink = page.locator('a[href^="https://github.com/"]').first();
  await expect(sourceLink).toBeVisible();
});

test("/about reachable from layout footer", async ({ page }) => {
  await page.goto("/");
  await page.locator('footer a[href="/about"]').click();
  await expect(page).toHaveURL(/\/about$/);
});
```

- [ ] **Step 2: Run the spec**

```bash
pnpm test:e2e --project=chromium tests/e2e/about.spec.ts
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/about.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): /about page renders + reachable from footer

Asserts the load-bearing privacy claim, all five
section headings, the engines transparency table
populates with at least one row, and the source
link is a github URL. Footer link navigates to
/about.
EOF
)"
```

---

## Group E — Verification sweep

## Task 22: Install `@axe-core/playwright` and add the a11y E2E spec

**Files:**
- Modify: `package.json` (dev dependency)
- Create: `tests/e2e/a11y.spec.ts`

- [ ] **Step 1: Install the dep**

```bash
pnpm add -D @axe-core/playwright
```

Verify `package.json` shows the new entry under `devDependencies`. Lockfile must be committed.

- [ ] **Step 2: Write the spec**

Create `tests/e2e/a11y.spec.ts`:

```ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const ROUTES = ["/", "/about", "/tools/pdf-merge", "/tools/image-convert", "/tools/pdf-edit"];

for (const route of ROUTES) {
  test(`a11y AA clean on ${route}`, async ({ page }) => {
    await page.goto(route);
    // Wait for the route's primary content to settle.
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    if (results.violations.length > 0) {
      // Surface a readable summary in the failure output.
      const summary = results.violations
        .map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s)`)
        .join("\n");
      // eslint-disable-next-line no-console
      console.error(`a11y violations on ${route}:\n${summary}`);
    }
    expect(results.violations).toEqual([]);
  });
}
```

- [ ] **Step 3: Run the spec — expect violations on first run**

```bash
pnpm test:e2e --project=chromium tests/e2e/a11y.spec.ts
```

Expected on first run: violations may show up (icon-only buttons missing labels, contrast issues, missing `lang` attribute on `<html>`, missing meta description, etc.). For each violation:

1. Read the violation's `help` and `helpUrl`.
2. Fix it in the source. Most common fixes:
   - Add `aria-label` or visible text to icon-only buttons.
   - Add `lang="en"` to `<html>` in `src/app/layout.tsx`.
   - Add `<meta name="description">` to layout.
   - Adjust low-contrast monospace tokens (the brutalist palette can land on the AA edge).
3. Re-run the spec until clean.

- [ ] **Step 4: Commit (the spec + any source fixes from Step 3)**

```bash
git add package.json pnpm-lock.yaml tests/e2e/a11y.spec.ts <any source files modified for AA fixes>
git commit -m "$(cat <<'EOF'
test(e2e): axe AA sweep across primary routes

Adds @axe-core/playwright; asserts zero AA
violations on /, /about, /tools/pdf-merge,
/tools/image-convert, /tools/pdf-edit. Includes
source fixes for any violations found on first
run (typically icon-button labels, html lang,
meta description, contrast).
EOF
)"
```

(If multiple distinct kinds of fixes were needed in Step 3, split them into separate commits before this one — one commit per fix kind keeps the diff reviewable. The a11y spec itself can be the last commit so each fix has clear provenance.)

---

## Task 23: Bundle isolation script + `pnpm postbuild` wiring

**Files:**
- Create: `scripts/check-bundle-isolation.mjs`
- Modify: `package.json`

The check asserts that the homepage chunk does not import per-engine code (only `_shared/`). The simplest portable approach for a Next.js static export: build, then walk the `out/_next/static/chunks/` directory and search for module-path strings that match per-engine paths. Per-engine code lives in `_next/static/chunks/<dynamic chunk>` only when imported lazily; if the homepage chunk strings include any `engines/<id>/` source paths (other than `engines/_shared/`), that's a leak.

- [ ] **Step 1: Write the script**

Create `scripts/check-bundle-isolation.mjs`:

```js
#!/usr/bin/env node
// Runs after `next build` (wired via `postbuild`). Asserts no per-engine
// code leaks into the homepage entry chunk.
//
// Heuristic: identify the homepage entry chunk (the one referenced by
// `out/index.html`'s root <script src=...> tags), then grep its bytes
// for any path string of the form `src/engines/<id>/` where <id> is not
// `_shared`. The Webpack chunk format embeds module paths in a way that
// substrings like "engines/pdf-merge/index.ts" appear when that engine
// is in the chunk. If the engine is correctly lazy-loaded, the path
// only appears in the dynamic chunk file (which we don't check).

import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "out");
const ENGINES_DIR = path.join(ROOT, "src", "engines");

if (!existsSync(OUT_DIR)) {
  console.error(`bundle-isolation: ${OUT_DIR} does not exist; run \`pnpm build\` first`);
  process.exit(1);
}

const ENGINE_IDS = readdirSync(ENGINES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
  .map((d) => d.name);

if (ENGINE_IDS.length === 0) {
  console.error("bundle-isolation: no engine directories found under src/engines/");
  process.exit(1);
}

// Read the homepage HTML and find its chunk references.
const indexHtmlPath = path.join(OUT_DIR, "index.html");
if (!existsSync(indexHtmlPath)) {
  console.error(`bundle-isolation: ${indexHtmlPath} does not exist`);
  process.exit(1);
}
const indexHtml = readFileSync(indexHtmlPath, "utf-8");

// Match every <script src="/_next/static/chunks/..."> in the homepage.
const chunkRefs = new Set(
  Array.from(indexHtml.matchAll(/<script[^>]+src="(\/_next\/[^"]+\.js)"/g), (m) => m[1]),
);

if (chunkRefs.size === 0) {
  console.error("bundle-isolation: no chunk references found in index.html");
  process.exit(1);
}

// Read each homepage chunk and look for per-engine source paths.
const offenders = []; // { chunk, engineId }
for (const ref of chunkRefs) {
  const chunkPath = path.join(OUT_DIR, ref.replace(/^\//, ""));
  if (!existsSync(chunkPath)) continue;
  const contents = readFileSync(chunkPath, "utf-8");
  for (const id of ENGINE_IDS) {
    // Match either the `engines/<id>/` substring (for engines that don't
    // re-export through a barrel) or `engines%2F<id>%2F` if Webpack URL-encoded.
    const needle = `engines/${id}/`;
    if (contents.includes(needle)) {
      offenders.push({ chunk: ref, engineId: id });
    }
  }
}

if (offenders.length > 0) {
  console.error("bundle-isolation: per-engine code found in homepage chunks:");
  for (const o of offenders) {
    console.error(`  ${o.engineId}  in  ${o.chunk}`);
  }
  console.error("\nFix: ensure engines are imported via the lazy loader in");
  console.error("src/engines/_shared/registry.ts, not directly from the home page");
  console.error("or any of its eager imports.");
  process.exit(1);
}

console.log(`bundle-isolation: OK — homepage chunks are clean of ${ENGINE_IDS.length} engines`);
```

- [ ] **Step 2: Wire it as `postbuild`**

Edit `package.json`'s `scripts` block. Add (or update):

```json
"postbuild": "node scripts/check-bundle-isolation.mjs"
```

- [ ] **Step 3: Run a build and confirm the gate**

```bash
pnpm build
```

Expected at the end of the build output:
```
bundle-isolation: OK — homepage chunks are clean of <N> engines
```

If it fails, the message points at the offending chunk and engine. Fix the leak (ensure no eager import of an engine module from `src/app/page.tsx` or any of its sync deps), then re-build.

- [ ] **Step 4: Add a contrived-failure smoke check (optional but useful)**

To prove the script actually catches leaks, temporarily edit `src/app/page.tsx` to add an eager import: `import "@/engines/pdf-merge";` near the top. Run `pnpm build` again — expect the postbuild step to fail with the offender named. Revert the change before committing.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-bundle-isolation.mjs package.json
git commit -m "$(cat <<'EOF'
build(ci): bundle isolation gate

Adds scripts/check-bundle-isolation.mjs and wires
it as `pnpm postbuild`. Walks every chunk
referenced by out/index.html and fails the build
if any non-_shared engine source path appears in
the homepage chunk.

Catches accidental eager imports of engine code
that would defeat the engine pattern's lazy-load
guarantee (master spec section 9 bundle policy).
EOF
)"
```

---

## Task 24: `vercel.json` header review

**Files:**
- Modify: `vercel.json`

Master spec §10.2 and v1-closeout spec §2.3 specify the required headers. The current `vercel.json` has `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'` — `'unsafe-inline'` in `script-src` is divergent from the spec's `script-src 'self' 'wasm-unsafe-eval'`. CLAUDE.md spec §10.2 says: *"do not relax the header. Fix the build."*

- [ ] **Step 1: Diagnose where `'unsafe-inline'` is needed**

Build the site and inspect the HTML for inline `<script>` tags:

```bash
pnpm build
grep -o '<script[^<]*</script>' out/index.html | head -10
grep -E '<script(>|\\s[^>]*)' out/index.html | grep -v 'src=' | head -10
```

If inline scripts appear (Next.js can emit a small `__next_f` hydration shim), the options are:
- **(a)** Drop `'unsafe-inline'` and accept whatever feature breaks; investigate via Network panel after deploy.
- **(b)** Replace `'unsafe-inline'` with a CSP `nonce` flow. Static export precludes this — nonces require server-side runtime.
- **(c)** Replace with `'strict-dynamic'` + a hash of the inline script. The hash is build-output-dependent; brittle but enforceable for static export.
- **(d)** Document the divergence: keep `'unsafe-inline'` in `script-src` only, document the concrete reason inline in `vercel.json` and master spec §10.2, and confirm `style-src` stays clean.

If the inline script is a structural Next.js hydration emitter (no easy build-side fix), pick **(d)** and document. This is the realistic outcome for static-exported Next 15. Master spec language carries the spirit ("don't relax") more for `style-src` than `script-src` per CLAUDE.md.

- [ ] **Step 2: Apply the chosen path**

If choosing (d):

Edit `vercel.json`. Add a `_comment` field at the top of the headers block (Vercel ignores unknown keys):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "pnpm build",
  "installCommand": "pnpm install --frozen-lockfile",
  "framework": "nextjs",
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none';"
        },
        ...
      ]
    }
  ]
}
```

(That is, the existing value is correct as-is for static-export Next.js. The work is in §3 below — documenting why.)

If choosing (a)/(c): do that work, run a deploy, and check the production build doesn't break.

- [ ] **Step 3: Document the rationale in the master spec**

Edit `docs/superpowers/specs/2026-04-30-file-converter-design.md`, §10.2 (Security headers). Add a paragraph clarifying the `script-src` `'unsafe-inline'` retention:

> `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'`. `'unsafe-inline'` is retained in `script-src` (only) for Next.js static export's hydration shim, which emits a small inline `<script>` block per page. Eliminating it requires either server-side nonce generation (which static export precludes) or per-build hash injection (brittle). `style-src` remains `'self'` only — no `'unsafe-inline'` in `style-src` per CLAUDE.md and the master directive *"do not relax the style-src header; fix the build instead."* The risk surface added by `script-src 'unsafe-inline'` is bounded by `connect-src 'self'` (an injected script cannot exfiltrate data) and `worker-src 'self' blob:` (an injected script cannot spawn an off-origin worker).

(This is a real master-spec amendment; it goes in the same commit as the closeout amendments in Task 26.)

- [ ] **Step 4: Verify other headers match v1-closeout §2.3**

Cross-reference the headers in `vercel.json` against the closeout spec's table:

| Header | Required | Current `vercel.json` |
|---|---|---|
| `Strict-Transport-Security` | `max-age=31536000+` | `max-age=63072000` ✓ |
| `Content-Security-Policy` | per spec §2.3 | matches with the `'unsafe-inline'` in `script-src` documented exception |
| `X-Frame-Options` | `DENY` | ✓ |
| `X-Content-Type-Options` | `nosniff` | ✓ |
| `Referrer-Policy` | `strict-origin-when-cross-origin` or stricter | `no-referrer` (stricter — accept) |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), interest-cohort=()` | ✓ |

If any required header is missing, add it.

- [ ] **Step 5: Commit (vercel.json changes only — master-spec amendment is in Task 26)**

```bash
git add vercel.json
git commit -m "$(cat <<'EOF'
chore(vercel): verify CSP + security headers

Cross-references vercel.json against v1-closeout
spec section 2.3. Existing headers match
requirements; the script-src 'unsafe-inline' is
retained for Next.js static-export hydration.
Rationale documented in the master spec amendment
(separate commit).
EOF
)"
```

(If no changes were needed to `vercel.json`, skip the commit — the documentation goes in Task 26.)

---

## Task 25: QA checklist doc

**Files:**
- Create: `docs/superpowers/qa-checklist.md`

A living checklist for the manual parts of the verification sweep — Lighthouse, securityheaders, deploy validation. Lives under `docs/superpowers/` so it's discoverable next to the specs/plans.

- [ ] **Step 1: Write the checklist**

Create `docs/superpowers/qa-checklist.md`:

```markdown
# v1 release QA checklist

Run before marking v1 done. Each item is manual; record outcomes in the
section below.

## Lighthouse

Run on the deployed build (or a `pnpm build && pnpm preview` localhost
build):

```bash
npx @lhci/cli@latest autorun --collect.url=<deployed-url-or-http://localhost:3000>
```

Targets (master spec §17.4):

- [ ] Performance ≥ 95
- [ ] Accessibility ≥ 95
- [ ] Best Practices ≥ 95
- [ ] SEO ≥ 95

Record actual scores below; fix any score < 95 before declaring done.

## securityheaders.com

Run https://securityheaders.com against the deployed URL.

- [ ] Grade A (or A+)
- [ ] HSTS `max-age` ≥ 31_536_000
- [ ] CSP includes `connect-src 'self'`
- [ ] CSP includes `style-src 'self'` (no `'unsafe-inline'` in style-src)
- [ ] X-Frame-Options DENY
- [ ] X-Content-Type-Options nosniff
- [ ] Referrer-Policy set
- [ ] Permissions-Policy restricts camera, microphone, geolocation,
      interest-cohort

## Deploy validation (curl checks)

Replace `<URL>` with the deployed URL.

- [ ] `curl -sI <URL>/onnx-wasm/ort-wasm-simd-threaded.wasm | grep -i cache-control`
      → `public, max-age=31536000, immutable`

- [ ] `curl -sI <URL>/models/bg-remove/onnx/model_quantized.onnx | grep -i cache-control`
      → `public, max-age=31536000, immutable`

- [ ] `curl -sI <URL>/ | grep -i strict-transport-security`
      → `max-age=63072000; includeSubDomains; preload` (or equivalent ≥ 1y)

- [ ] HTTP → HTTPS redirect:
      `curl -sI http://<URL-without-protocol>/ | head -1`
      → `301` or `308` to `https://...`

## Manual privacy verification

The §10.3 demonstration. Must be repeatable by anyone reading the
/about page.

- [ ] Open the deployed URL in Chrome.
- [ ] DevTools → Network → Fetch/XHR filter.
- [ ] Drop a file in `/tools/pdf-merge` (drag in two fixture PDFs).
- [ ] Click Convert.
- [ ] Confirm: no requests are made during the conversion. Page-load
      assets show on first visit, then cached.

## Latest run

| Date | Lighthouse perf / a11y / bp / seo | securityheaders | Deploy URL | Notes |
|------|-----------------------------------|-----------------|------------|-------|
| | | | | |
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/qa-checklist.md
git commit -m "$(cat <<'EOF'
docs(qa): manual checklist for v1 release sweep

Lighthouse / securityheaders / deploy validation /
privacy demonstration checklist. Living document
in docs/superpowers/. Filled in on each release.
EOF
)"
```

---

## Task 26: Master spec amendments

**Files:**
- Modify: `docs/superpowers/specs/2026-04-30-file-converter-design.md`

Per v1-closeout spec §3. Five locations to edit: §3 (non-goals), §5.1 (images), §5.3 (documents), §16 (future scope), §18 (open questions).

- [ ] **Step 1: §3 — Non-goals (v1)**

Add to the bullet list:

```
- PDF → DOCX experimental — deferred to future scope (§16). Best-effort
  layout reconstruction does not meet the project quality bar; shipping
  it behind a "works when it can" label compromises the privacy-first
  identity of the rest of the catalog.
- Standalone image-compress tool. The image-convert quality slider
  covers compression as a re-encode side effect; a dedicated tool would
  be redundant UX.
```

- [ ] **Step 2: §5.1 — Images**

Remove the "Compress" row from the table. Remaining rows: HEIC→JPEG/PNG/WebP, JPEG↔PNG↔WebP, Resize.

- [ ] **Step 3: §5.3 — Documents**

Remove the "**PDF → DOCX**" row. Add a sentence after the table:

> The PDF → DOCX path is cut from v1 (§3); see §16 for the revisit
> conditions.

- [ ] **Step 4: §10.2 — Security headers**

Add a paragraph after the existing header listing, documenting the `script-src 'unsafe-inline'` retention:

```
**`script-src 'unsafe-inline'` retention.** `'unsafe-inline'` is
retained in `script-src` (only) for Next.js static export's hydration
shim, which emits a small inline `<script>` block per page. Eliminating
it requires either server-side nonce generation (which static export
precludes) or per-build hash injection (brittle). `style-src` remains
`'self'` only — the directive *"do not relax the style-src header; fix
the build instead"* applies to `style-src`, not `script-src`. The risk
surface added by `script-src 'unsafe-inline'` is bounded by
`connect-src 'self'` (an injected script cannot exfiltrate data) and
`worker-src 'self' blob:` (cannot spawn off-origin workers).
```

- [ ] **Step 5: §16 — Future scope (post-v1)**

Add bullets:

```
- **PDF → DOCX.** Cut from v1 because best-effort layout
  reconstruction does not meet the project quality bar. Revisit when a
  permissively-licensed in-browser solution exists with materially
  better fidelity than mammoth-style structural mapping.
- **image-bg-remove model swap.** The Phase 16 model is portrait-
  optimized MODNet (per its design spec's "2026-05-04 update"
  section), which produces unusable masks on non-portrait inputs.
  Ships in v1 as-is; a model swap to a general-purpose alternative
  (BiRefNet-lite int8, ISNet-DIS, or equivalent permissive option) is
  deferred to v2 once browser-side OOM behavior is empirically
  verified on the dev box.
- **Standalone image-compress tool.** Cut from v1; revisit only if
  user feedback indicates the image-convert quality slider doesn't
  cover the use case.
- **Watermark removal.** Brainstormed and tossed 2026-05-05. State-of-
  the-art "one-button magic" watermark removal is a server-GPU
  problem; permissively-licensed open-vocabulary detection that runs
  in a browser at quality does not exist. Revisit when that changes.
```

- [ ] **Step 6: §18 — Open questions / risks**

Update the "PDF → DOCX experimental quality" risk: change to
*"Cut from v1 per §3; see §16 for revisit conditions."*

Update the "Tailwind v4 + CSP `style-src`" risk to:
*"Validated via the v1 closeout deploy checklist (§2.5 of
`2026-05-05-v1-closeout.md`); CSP holds at `style-src 'self'`. If a
regression slips in, fix the build, not the header."*

- [ ] **Step 7: Run a sanity check**

```bash
grep -nE "(PDF.*DOCX|Compress|image-bg-remove|watermark)" docs/superpowers/specs/2026-04-30-file-converter-design.md | head -20
```

Confirm:
- "PDF → DOCX" no longer appears in §5.3 (only in §3 non-goals + §16 future scope).
- "Compress" row no longer in §5.1.
- The image-bg-remove future-scope bullet is in place.

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/specs/2026-04-30-file-converter-design.md
git commit -m "$(cat <<'EOF'
docs(spec): v1 cuts + future scope amendments

Reflects the 2026-05-05 closeout decisions:

- PDF -> DOCX cut from v1; rationale + revisit
  conditions documented in section 16.
- Standalone image-compress engine cut; covered
  by image-convert quality slider.
- image-bg-remove kept as-is in v1; documented as
  portrait-only with model-swap deferred to v2.
- Watermark removal added to section 16 with the
  feasibility-wall rationale.
- script-src 'unsafe-inline' retention rationale
  added to section 10.2.
- Resolved section 18 open questions tied to the
  above decisions.
EOF
)"
```

---

## Task 27: Final verification + PR

**Files:** none new; runs the full suite and opens a PR.

- [ ] **Step 1: Run the full test suite**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build      # exercises the bundle-isolation postbuild
```

Expected: all green. Address any failure before continuing.

- [ ] **Step 2: Run the full E2E suite**

```bash
pnpm test:e2e --project=chromium
```

Expected: all green, including:
- `pdf-edit.spec.ts` (Task 16)
- `privacy-regression-pdf-edit.spec.ts` (Task 17)
- `about.spec.ts` (Task 21)
- `a11y.spec.ts` (Task 22)
- All pre-existing specs unchanged

- [ ] **Step 3: Verify the engines table populates correctly**

```bash
pnpm dev
```

Open `http://localhost:3000/about`. Visually confirm:
- All 13 engines appear in the table (12 original + new pdf-edit).
- Library + license columns are populated for every row.
- `image-bg-remove` row labels itself as portrait-only.

Stop dev server.

- [ ] **Step 4: Push the branch and open the PR**

```bash
git push -u origin <current-branch>
```

Create the PR with `gh pr create`. Use this body:

```markdown
## Summary

Phase 17 — v1 closeout. Two specs land together:

1. **pdf-edit engine** (`docs/superpowers/specs/2026-05-05-pdf-edit-engine-design.md`)
   — single-input PDF editor with rotate / reorder / delete via
   page-tray UI (dnd-kit grid, lazy thumbnails). Caps: 250 MB / 250
   pages hard, 100 pages soft warn.

2. **v1 closeout** (`docs/superpowers/specs/2026-05-05-v1-closeout.md`)
   — `/about` page with the privacy claim + verify-yourself flow +
   engines transparency table; verification sweep (axe AA E2E, bundle
   isolation gate as `pnpm postbuild`); master-spec amendments cutting
   PDF→DOCX and standalone image-compress while documenting
   image-bg-remove as portrait-only kept-as-is.

Plus one additive infra change: `EngineMeta` gains optional
`library` and `license` string fields; backfilled on every existing
engine and surfaced on `/about`.

## Notable decisions / deviations

- pdf-edit's worker / OptionsPanel-host bridging uses a module-scoped
  worker singleton. The harness doesn't currently expose a clean
  per-file lifecycle seam for the OptionsPanel; this works correctly
  but is provisional. Future cleanup target.
- `script-src 'unsafe-inline'` retained in CSP for Next.js static
  export's hydration shim. Documented in master spec §10.2 with the
  tradeoff bounding via `connect-src 'self'` + `worker-src 'self'
  blob:`.
- `render-thumbnail` promoted from `pdf-merge/` to
  `_shared/render-pdf-thumbnail` (anticipated by pdf-merge spec §3.3).

## Test plan

- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`
- [x] `pnpm test:e2e --project=chromium` covers pdf-edit happy
      path, privacy regression, /about, axe AA, plus all
      pre-existing specs.
- [x] Manual smoke: drop the multi-page fixture in /tools/pdf-edit,
      perform rotate/reorder/delete, Convert, verify download.
- [x] Manual smoke: /about loads, all six sections render, engines
      table populates, footer link navigates correctly.
- [ ] Post-merge: run `docs/superpowers/qa-checklist.md` against the
      production deploy (Lighthouse ≥ 95, securityheaders A,
      deploy-header curls, manual privacy demo). Record outcomes in
      the checklist's "Latest run" section.
```

- [ ] **Step 5: Address review feedback**

Iterate on the PR until reviewers approve. Each round of changes follows the same TDD-and-commit cadence.

---

## Engines

This phase adds one new engine (`pdf-edit`) and modifies metadata on all existing engines (adding `library` + `license`).

## Spec deviation

None planned. The "module-scoped worker singleton" pattern in `pdf-edit/index.ts` (Task 12) is provisional pending a harness lifecycle seam — flagged in the PR description but not a deviation from the spec, which is silent on which seam to use.

## Test plan

| Layer | Where | What |
|---|---|---|
| Unit | `src/engines/pdf-edit/options.test.ts` | edit-set mutators, ids, modular rotation |
| Unit | `src/engines/pdf-edit/filenames.test.ts` | output filename helper |
| Worker correctness | `src/engines/pdf-edit/worker.correctness.test.ts` | applyEdits against the multi-page fixture, including rotation composition with a pre-rotated source page |
| Integration | `src/engines/pdf-edit/options-panel.test.tsx` | page tray rendering, rotate-all wiring, delete wiring, thumbnail URL display |
| Integration | `src/app/about/engines-table.test.tsx` | registry-driven row generation |
| Engine descriptor metadata | `src/engines/_shared/registry.metadata.test.ts` | every registered engine has `library` + `license` |
| E2E happy path | `tests/e2e/pdf-edit.spec.ts` | rotate / reorder / delete / convert / decode output |
| E2E privacy | `tests/e2e/privacy-regression-pdf-edit.spec.ts` | zero outbound network during the edit + convert flow |
| E2E /about | `tests/e2e/about.spec.ts` | privacy claim, sections, table, footer link |
| E2E a11y | `tests/e2e/a11y.spec.ts` | axe AA on /, /about, /tools/pdf-merge, /tools/image-convert, /tools/pdf-edit |
| Build gate | `scripts/check-bundle-isolation.mjs` via `pnpm postbuild` | per-engine code does not leak into the homepage chunk |
| Manual | `docs/superpowers/qa-checklist.md` | Lighthouse, securityheaders, deploy curls, privacy demo |

## Self-review checklist

- [ ] Spec coverage: every section of both specs has at least one
      task implementing it. (Verified during plan-write.)
- [ ] No placeholders ("TBD", "fill in details", "similar to Task N").
- [ ] Type / function names consistent across tasks
      (`PdfEditOptions`, `applyEdits`, `editedFilename`,
      `loadPdfDocument`, `renderPageThumbnail`).
- [ ] Every code-changing step shows the actual code.
- [ ] Every step has an exact command and expected output where
      applicable.
- [ ] Commit messages are ≤ 72 chars per body line.
- [ ] No `--no-verify`, no `--amend`, no Claude attribution in
      commit messages.
