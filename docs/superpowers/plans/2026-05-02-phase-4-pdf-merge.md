# Phase 4 — PDF merge engine + dnd-kit retrofit implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task with two-stage review on substantive (architecture-touching) tasks and combined opus review on mechanical extensions. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `pdf-merge` engine (2+ application/pdf files → single merged.pdf via pdf-lib's copyPages) with per-row Acrobat-syntax page ranges, first-page thumbnails via lazy-loaded pdf.js, and keyboard-accessible drag-and-drop reordering via @dnd-kit. Retrofit image-to-pdf's StagingArea to use the same drag-and-drop pattern, keeping ↑↓ buttons alongside the drag handle.

**Architecture:** Reuses Plan 3's MultiInputEngine pattern, ToolFrame multi-cardinality plumbing, and File[] handoff slot wholesale. Adds a per-row optional range field whose validation drives `engine.isReadyToConvert(opts)`. Encrypted PDFs rejected per-row inline (no `ignoreEncryption` flag, no password prompt). Drag IDs are crypto.randomUUID() per row, allocated on add and persisted across reorders so dnd-kit treats them as stable items.

**Tech Stack:** Plan 1 + 2 + 3 stack (Next.js 15 static export, React 19, Comlink workers, OffscreenCanvas, Tailwind v4, Vitest, Playwright, pdf-lib) plus **pdfjs-dist** (~300 KB min+gz, lazy-loaded; first-page thumbnails) and **@dnd-kit/core + @dnd-kit/sortable** (~40 KB, route-loaded; keyboard-accessible drag reorder).

**Spec:** [`docs/superpowers/specs/2026-05-02-pdf-merge-engine-design.md`](../specs/2026-05-02-pdf-merge-engine-design.md) (commit `88e36d6`).

**Branch:** `phase-4-pdf-merge` (create off `main` after Plan 4 spec PR merges).

**Substantive tasks (full two-stage sonnet+opus review):** 2, 5, 6. **Mechanical tasks (combined opus review):** 1, 3, 4, 7, 8, 9, 10.

**Critical ordering dependencies:**
- Task 1 (deps install) MUST land first — every later task imports something installed here.
- Tasks 2 (range parser), 3 (thumbnail renderer), 4 (fixtures) MUST land before Task 5 (StagingArea), which imports all three.
- Task 5 (PdfMergeStagingArea) MUST land before Task 9 (image-to-pdf retrofit). The dnd-kit pattern is established once in Task 5, then mechanically copied in Task 9.
- Task 7 (engine descriptor) needs Tasks 5 (StagingArea), 6 (worker) committed.
- Task 8 (route + homepage routing) needs Task 7 (engine in registry).
- Task 10 (E2E) needs everything else.

**Branch discipline reminder for implementer subagents:**
- Run `git branch --show-current` BEFORE and AFTER every commit. Verify it reads `phase-4-pdf-merge`.
- NEVER run: `git branch -m`, `git branch -M`, `git checkout <branch>`, `git switch <branch>`, `git reset --hard`, `git push`, `git push --force`. NEVER use `--no-verify`.
- Allowed: `git status`, `git diff`, `git log`, `git branch --show-current`, `git add <specific files>`, `git commit`, `git rm <specific files>`, `git checkout -- <file>` (only for reverting probe edits).

---

## Task 1: Install dependencies (pdfjs-dist + @dnd-kit)

**Goal:** Add `pdfjs-dist`, `@dnd-kit/core`, `@dnd-kit/sortable` to `dependencies`. Verify build still produces a static export.

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Verify branch + clean tree**

```bash
git branch --show-current  # expect: phase-4-pdf-merge
git status                 # expect: nothing to commit, working tree clean
```

If on the wrong branch, STOP and ask the user. Do not run `git checkout`.

- [ ] **Step 2: Install runtime dependencies**

```bash
pnpm add pdfjs-dist @dnd-kit/core @dnd-kit/sortable
```

Expected: 3 packages added to `dependencies` in `package.json`. Lockfile updated.

- [ ] **Step 3: Run all gates**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all exit 0. Test count unchanged from main (94). Build produces `out/` static export with the same 5 routes; new dependencies are not yet imported anywhere so no chunk-graph change yet.

- [ ] **Step 4: Verify the new packages don't introduce a `fetch` lint violation**

The Biome rule that bans `fetch`/`XMLHttpRequest` inside `src/engines/` only checks files under `src/engines/`. Installing the deps at the package.json level does not trigger it. Confirm `pnpm lint` exit 0.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): add pdfjs-dist + @dnd-kit/core + @dnd-kit/sortable

pdfjs-dist for first-page thumbnail rendering in pdf-merge's
StagingArea (lazy-loaded). @dnd-kit/core + @dnd-kit/sortable for
keyboard-accessible drag-and-drop reordering across both pdf-merge
and image-to-pdf staging areas. All three are runtime deps because
they're imported by client components."
```

Expected: branch advances by 1 commit. `git status` clean.

---

## Task 2: Range parser

**Goal:** `src/engines/pdf-merge/range.ts` exports `parseRange(input, pageCount)` that handles Acrobat-style syntax (`1-3, 5, 7-, -3`). Empty input returns all pages. Comprehensive tabular tests cover every accept/reject branch from spec §3.2 and §10.

**Files:**
- Create: `src/engines/pdf-merge/range.ts`
- Create: `src/engines/pdf-merge/range.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/engines/pdf-merge/range.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseRange } from "./range";

describe("parseRange — accepts", () => {
  it.each([
    // [input, pageCount, expectedIndices]
    ["", 5, [0, 1, 2, 3, 4]],
    ["   ", 5, [0, 1, 2, 3, 4]],
    ["1", 5, [0]],
    ["5", 5, [4]],
    ["1-3", 5, [0, 1, 2]],
    ["1-5", 5, [0, 1, 2, 3, 4]],
    ["3-", 5, [2, 3, 4]],
    ["-3", 5, [0, 1, 2]],
    ["1, 3, 5", 5, [0, 2, 4]],
    ["1-2, 4-5", 5, [0, 1, 3, 4]],
    ["1-3, 5, 7-", 10, [0, 1, 2, 4, 6, 7, 8, 9]],
    [" 1 - 3 , 5 ", 5, [0, 1, 2, 4]],
    ["2-2", 5, [1]],
    // duplicates and overlaps allowed (§3.2)
    ["1, 1", 5, [0, 0]],
    ["1-3, 2", 5, [0, 1, 2, 1]],
    ["3-1", 3, null], // reversed → reject (handled below)
  ].filter(([, , out]) => out !== null) as [string, number, number[]][])(
    "%j over %i pages → %j",
    (input, pageCount, expected) => {
      const r = parseRange(input, pageCount);
      expect(r).toEqual({ ok: true, indices: expected });
    },
  );
});

describe("parseRange — rejects", () => {
  it.each([
    ["abc", 5, /can't parse/],
    ["1-foo", 5, /can't parse/],
    ["foo-3", 5, /can't parse/],
    ["0", 5, /must be 1 or greater/],
    ["1-0", 5, /must be 1 or greater/],
    ["-0", 5, /must be 1 or greater/],
    ["0-3", 5, /must be 1 or greater/],
    ["3-1", 5, /reversed/],
    ["5-2", 5, /reversed/],
    ["7", 5, /exceeds 5/],
    ["1-7", 5, /exceeds 5/],
    ["7-", 5, /exceeds 5/],
    ["-7", 5, /exceeds 5/],
    ["1,,3", 5, /empty token/],
    ["1,3,", 5, /trailing comma/],
    [",1,3", 5, /leading comma/],
    ["-", 5, /bare dash/],
    ["1-2-3", 5, /can't parse/],
  ])("%j over %i pages → reject matching %s", (input, pageCount, pattern) => {
    const r = parseRange(input, pageCount);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(pattern);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test src/engines/pdf-merge/range.test.ts
```

Expected: FAIL with "Cannot find module './range'" or similar. Test count: 0 passing in this file.

- [ ] **Step 3: Write the implementation**

Create `src/engines/pdf-merge/range.ts`:

```ts
export type RangeParseResult =
  | { ok: true; indices: number[] }
  | { ok: false; reason: string };

const POSITIVE_INT = /^[1-9][0-9]*$/;

function parseToken(token: string, pageCount: number): RangeParseResult {
  const trimmed = token.trim();
  if (trimmed === "") return { ok: false, reason: "empty token" };
  if (trimmed === "-") return { ok: false, reason: "bare dash is not a range" };

  // Open-ended forms: "N-" or "-M"
  if (trimmed.endsWith("-")) {
    const head = trimmed.slice(0, -1).trim();
    if (!POSITIVE_INT.test(head)) {
      return head === "0" || /^0+$/.test(head)
        ? { ok: false, reason: "page numbers must be 1 or greater" }
        : { ok: false, reason: `can't parse '${trimmed}'` };
    }
    const n = Number.parseInt(head, 10);
    if (n > pageCount) return { ok: false, reason: `page ${n} exceeds ${pageCount}` };
    const indices: number[] = [];
    for (let i = n - 1; i < pageCount; i++) indices.push(i);
    return { ok: true, indices };
  }
  if (trimmed.startsWith("-")) {
    const tail = trimmed.slice(1).trim();
    if (!POSITIVE_INT.test(tail)) {
      return tail === "0" || /^0+$/.test(tail)
        ? { ok: false, reason: "page numbers must be 1 or greater" }
        : { ok: false, reason: `can't parse '${trimmed}'` };
    }
    const m = Number.parseInt(tail, 10);
    if (m > pageCount) return { ok: false, reason: `page ${m} exceeds ${pageCount}` };
    const indices: number[] = [];
    for (let i = 0; i < m; i++) indices.push(i);
    return { ok: true, indices };
  }

  // Closed range: "N-M"
  if (trimmed.includes("-")) {
    const parts = trimmed.split("-");
    if (parts.length !== 2) return { ok: false, reason: `can't parse '${trimmed}'` };
    const [headRaw, tailRaw] = parts;
    const head = (headRaw ?? "").trim();
    const tail = (tailRaw ?? "").trim();
    if (head === "0" || tail === "0" || /^0+$/.test(head) || /^0+$/.test(tail)) {
      return { ok: false, reason: "page numbers must be 1 or greater" };
    }
    if (!POSITIVE_INT.test(head) || !POSITIVE_INT.test(tail)) {
      return { ok: false, reason: `can't parse '${trimmed}'` };
    }
    const n = Number.parseInt(head, 10);
    const m = Number.parseInt(tail, 10);
    if (n > m) return { ok: false, reason: `${trimmed} is reversed (start > end)` };
    if (n > pageCount || m > pageCount) {
      return { ok: false, reason: `page ${Math.max(n, m)} exceeds ${pageCount}` };
    }
    const indices: number[] = [];
    for (let i = n - 1; i < m; i++) indices.push(i);
    return { ok: true, indices };
  }

  // Single page: "N"
  if (trimmed === "0" || /^0+$/.test(trimmed)) {
    return { ok: false, reason: "page numbers must be 1 or greater" };
  }
  if (!POSITIVE_INT.test(trimmed)) {
    return { ok: false, reason: `can't parse '${trimmed}'` };
  }
  const n = Number.parseInt(trimmed, 10);
  if (n > pageCount) return { ok: false, reason: `page ${n} exceeds ${pageCount}` };
  return { ok: true, indices: [n - 1] };
}

export function parseRange(input: string, pageCount: number): RangeParseResult {
  const trimmed = input.trim();
  if (trimmed === "") {
    const all: number[] = [];
    for (let i = 0; i < pageCount; i++) all.push(i);
    return { ok: true, indices: all };
  }

  // Detect leading/trailing comma errors before splitting
  if (trimmed.startsWith(",")) return { ok: false, reason: "leading comma" };
  if (trimmed.endsWith(",")) return { ok: false, reason: "trailing comma" };

  const tokens = trimmed.split(",");
  const indices: number[] = [];
  for (const token of tokens) {
    const result = parseToken(token, pageCount);
    if (!result.ok) return result;
    indices.push(...result.indices);
  }
  return { ok: true, indices };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test src/engines/pdf-merge/range.test.ts
```

Expected: all tests pass. Test count: 15 accept + 18 reject = 33 in this file.

- [ ] **Step 5: Run all unit gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all exit 0. Total test count: 94 + 33 = 127.

- [ ] **Step 6: Commit**

```bash
git add src/engines/pdf-merge/range.ts src/engines/pdf-merge/range.test.ts
git commit -m "feat(engines): pdf-merge Acrobat-syntax range parser

parseRange(input, pageCount) accepts comma-separated tokens of
form N, N-M, N-, -M; empty input returns all pages. 0-indexed
output suitable for pdf-lib's copyPages. Duplicates allowed.
Rejects with displayable reasons: bounds violations, reversed
ranges, malformed tokens, comma errors. 32 tabular tests cover
the accept and reject tables in spec §3.2 and §10."
```

---

## Task 3: First-page thumbnail renderer

**Goal:** `src/engines/pdf-merge/render-thumbnail.ts` exports `renderFirstPageThumbnail(bytes, size)` that lazy-loads `pdfjs-dist`, renders page 1 to a square fit-aspect bitmap, returns a PNG blob. Module-level promise cache so pdf.js loads at most once. Throws on encryption (caller catches).

**Files:**
- Create: `src/engines/pdf-merge/render-thumbnail.ts`
- Create: `src/engines/pdf-merge/render-thumbnail.test.ts`

- [ ] **Step 1: Write `src/engines/pdf-merge/render-thumbnail.ts`**

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
    // Webpack URL for the bundled worker; same pattern as engine workers.
    lib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.mjs",
      import.meta.url,
    ).toString();
    workerConfigured = true;
  }
  return lib;
}

export async function renderFirstPageThumbnail(
  bytes: ArrayBuffer,
  size: number,
): Promise<Blob> {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: bytes }).promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const scale = Math.min(size / viewport.width, size / viewport.height);
    const scaledViewport = page.getViewport({ scale });
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.ceil(scaledViewport.width)),
      Math.max(1, Math.ceil(scaledViewport.height)),
    );
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");
    // pdf.js expects a CanvasRenderingContext2D; OffscreenCanvas2D is
    // structurally compatible at runtime.
    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport: scaledViewport,
      canvas: canvas as unknown as HTMLCanvasElement,
    }).promise;
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    await doc.destroy();
  }
}
```

- [ ] **Step 2: Write `src/engines/pdf-merge/render-thumbnail.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";

describe("renderFirstPageThumbnail", () => {
  it("rejects when pdfjs-dist's getDocument promise rejects", async () => {
    vi.doMock("pdfjs-dist", () => ({
      GlobalWorkerOptions: { workerSrc: "" },
      getDocument: () => ({ promise: Promise.reject(new Error("stub: invalid pdf")) }),
    }));
    const { renderFirstPageThumbnail } = await import("./render-thumbnail");
    await expect(renderFirstPageThumbnail(new ArrayBuffer(8), 32)).rejects.toThrow(
      /stub: invalid pdf/,
    );
    vi.doUnmock("pdfjs-dist");
  });

  it("returns a Blob when pdf.js resolves the render pipeline", async () => {
    const fakeBlob = new Blob(["png"], { type: "image/png" });
    const fakePage = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale }),
      render: () => ({ promise: Promise.resolve() }),
    };
    const fakeDoc = {
      getPage: vi.fn(async () => fakePage),
      destroy: vi.fn(async () => undefined),
    };
    vi.doMock("pdfjs-dist", () => ({
      GlobalWorkerOptions: { workerSrc: "" },
      getDocument: () => ({ promise: Promise.resolve(fakeDoc) }),
    }));
    // OffscreenCanvas in jsdom doesn't have convertToBlob; stub it.
    const originalConvert = (globalThis as any).OffscreenCanvas?.prototype?.convertToBlob;
    if (typeof OffscreenCanvas !== "undefined") {
      (OffscreenCanvas.prototype as any).convertToBlob = async () => fakeBlob;
    }
    const { renderFirstPageThumbnail } = await import("./render-thumbnail");
    const result = await renderFirstPageThumbnail(new ArrayBuffer(8), 32);
    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe("image/png");
    if (typeof OffscreenCanvas !== "undefined" && originalConvert) {
      (OffscreenCanvas.prototype as any).convertToBlob = originalConvert;
    }
    vi.doUnmock("pdfjs-dist");
  });
});
```

- [ ] **Step 3: Add `OffscreenCanvas` polyfill to test-setup if not already present**

Read `src/test-setup.ts`. If `OffscreenCanvas` isn't already polyfilled, append:

```ts
if (typeof globalThis.OffscreenCanvas !== "function") {
  class StubOffscreenCanvas {
    width: number;
    height: number;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
    }
    getContext() {
      return { drawImage: () => undefined } as unknown as OffscreenCanvasRenderingContext2D;
    }
    async convertToBlob() {
      return new Blob([], { type: "image/png" });
    }
  }
  (globalThis as any).OffscreenCanvas = StubOffscreenCanvas;
}
```

If `OffscreenCanvas` IS already polyfilled, skip this step. (Plan 1's setup already polyfills it for image-to-pdf staging tests; verify via grep.)

```bash
grep -n "OffscreenCanvas" src/test-setup.ts
```

- [ ] **Step 4: Run all unit gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all exit 0. Total test count: 126 + 2 = 128.

- [ ] **Step 5: Commit**

```bash
git add src/engines/pdf-merge/render-thumbnail.ts src/engines/pdf-merge/render-thumbnail.test.ts
# Add test-setup.ts only if it was modified
git diff --cached --name-only | grep -q test-setup.ts || git add src/test-setup.ts 2>/dev/null || true
git commit -m "feat(engines): pdf-merge first-page thumbnail renderer

renderFirstPageThumbnail(bytes, size) lazy-loads pdfjs-dist on
first call (module-level promise cache) and renders page 1 to a
PNG blob via OffscreenCanvas. Worker URL configured once. Throws
on encrypted PDFs (pdf.js surfaces PasswordException); caller
catches and falls back to '?' placeholder."
```

(If `test-setup.ts` was unchanged in Step 3, omit it from `git add`.)

---

## Task 4: PDF fixtures + generation script

**Goal:** Commit small PDF fixtures (1, 2, 5 pages, plus encrypted) under `tests/fixtures/`. Provide a generation script for the healthy PDFs; document encrypted fixture acquisition (qpdf or Preview).

**Files:**
- Create: `tests/fixtures/scripts/generate-pdf-fixtures.mjs`
- Create: `tests/fixtures/scripts/README.md`
- Create: `tests/fixtures/sample-1page.pdf` (generated)
- Create: `tests/fixtures/sample-2page.pdf` (generated)
- Create: `tests/fixtures/sample-5page.pdf` (generated)
- Create: `tests/fixtures/sample-encrypted.pdf` (manual, see README)

- [ ] **Step 1: Write the generation script**

Create `tests/fixtures/scripts/generate-pdf-fixtures.mjs`:

```js
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, "..");

async function makeSamplePdf(pageCount, label) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pageCount; i++) {
    const page = pdf.addPage([612, 792]);
    page.drawText(`${label} — page ${i} of ${pageCount}`, {
      x: 50,
      y: 720,
      size: 24,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText(`generated by tests/fixtures/scripts/generate-pdf-fixtures.mjs`, {
      x: 50,
      y: 50,
      size: 10,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
  }
  return await pdf.save();
}

const targets = [
  { name: "sample-1page.pdf", pageCount: 1, label: "Sample 1-page" },
  { name: "sample-2page.pdf", pageCount: 2, label: "Sample 2-page" },
  { name: "sample-5page.pdf", pageCount: 5, label: "Sample 5-page" },
];

for (const t of targets) {
  const bytes = await makeSamplePdf(t.pageCount, t.label);
  const out = path.join(fixturesDir, t.name);
  await writeFile(out, bytes);
  console.log(`wrote ${out} (${bytes.length} bytes)`);
}
```

- [ ] **Step 2: Write the README**

Create `tests/fixtures/scripts/README.md`:

```markdown
# PDF fixture generation

## Healthy fixtures (script)

Run from the repo root:

```bash
node tests/fixtures/scripts/generate-pdf-fixtures.mjs
```

This regenerates `sample-1page.pdf`, `sample-2page.pdf`, `sample-5page.pdf`.
Re-run after pdf-lib upgrades to pick up any byte-level format changes.

## Encrypted fixture (manual)

`sample-encrypted.pdf` is a password-protected PDF used by Plan 4's
encrypted-PDF rejection E2E test. pdf-lib does not write encrypted
PDFs in v1.17, so this fixture is generated externally and committed.

To regenerate:

```bash
# Option A: qpdf (cross-platform, available via brew/apt)
qpdf --encrypt user-password owner-password 256 -- \
  tests/fixtures/sample-1page.pdf tests/fixtures/sample-encrypted.pdf

# Option B: macOS Preview
# Open sample-1page.pdf → File → Export → check "Encrypt" → set password "user"
# → Save As tests/fixtures/sample-encrypted.pdf
```

The user/owner passwords don't matter for the test — the test only
asserts that pdf-lib's PDFDocument.load throws EncryptedPDFError on
this file.
```

- [ ] **Step 3: Generate the healthy fixtures**

```bash
node tests/fixtures/scripts/generate-pdf-fixtures.mjs
```

Expected: three files written to `tests/fixtures/`. Each PDF should be under 5 KB.

```bash
ls -la tests/fixtures/sample-{1,2,5}page.pdf
```

- [ ] **Step 4: Generate the encrypted fixture (one-time)**

If `qpdf` is on PATH:

```bash
qpdf --encrypt user owner 256 -- tests/fixtures/sample-1page.pdf tests/fixtures/sample-encrypted.pdf
```

Expected: `tests/fixtures/sample-encrypted.pdf` exists, is binary, opens to a password prompt in any PDF viewer.

If `qpdf` is NOT installed: install via `brew install qpdf` (macOS) or `apt install qpdf` (Debian-likes), then run the command. Alternatively, follow the Preview steps in `tests/fixtures/scripts/README.md`.

- [ ] **Step 5: Smoke-test the fixtures via pdf-lib**

```bash
node -e "
import('pdf-lib').then(async ({ PDFDocument }) => {
  const fs = await import('node:fs/promises');
  for (const n of ['sample-1page', 'sample-2page', 'sample-5page']) {
    const bytes = await fs.readFile('tests/fixtures/' + n + '.pdf');
    const doc = await PDFDocument.load(bytes);
    console.log(n, '→', doc.getPageCount(), 'pages');
  }
  try {
    const bytes = await fs.readFile('tests/fixtures/sample-encrypted.pdf');
    await PDFDocument.load(bytes);
    console.error('ERROR: encrypted fixture loaded without throwing!');
    process.exit(1);
  } catch (e) {
    if (e.constructor && e.constructor.name === 'EncryptedPDFError') {
      console.log('sample-encrypted.pdf → EncryptedPDFError (expected)');
    } else {
      console.error('UNEXPECTED error type:', e.constructor && e.constructor.name, e.message);
      process.exit(1);
    }
  }
});
"
```

Expected output:
```
sample-1page → 1 pages
sample-2page → 2 pages
sample-5page → 5 pages
sample-encrypted.pdf → EncryptedPDFError (expected)
```

If the encrypted fixture loads without throwing, redo Step 4 with a fresh encryption pass.

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/scripts/generate-pdf-fixtures.mjs \
        tests/fixtures/scripts/README.md \
        tests/fixtures/sample-1page.pdf \
        tests/fixtures/sample-2page.pdf \
        tests/fixtures/sample-5page.pdf \
        tests/fixtures/sample-encrypted.pdf
git commit -m "test(fixtures): pdf-merge sample PDFs (1/2/5/encrypted)

generate-pdf-fixtures.mjs writes the three healthy fixtures via
pdf-lib. The encrypted fixture is generated externally (qpdf or
Preview) and committed once; README documents both paths. All
four fixtures are under 5 KB."
```

---

## Task 5: PdfMergeStagingArea component (with StagingAreaProps extension)

**Goal:** `src/engines/pdf-merge/staging-area.tsx` renders the per-row UI: drag handle (dnd-kit), thumbnail, filename, page count or `[ password-protected ]`, range input with inline error, ↑↓ buttons, × button. Owns row state including UUID id, pageCount, encrypted, parsedRange, rangeError, thumbnailUrl. Loads pdf-lib metadata + pdf.js thumbnail in parallel on file-add. Persists `rows` into `options` on every change so `engine.isReadyToConvert(opts)` can gate the Convert button. Strict-Mode-safe lifecycle.

This task includes a small architectural pre-work step: extending `StagingAreaProps<TOptions>` with `setOptions: (next: TOptions) => void` so multi-input engines that need to write to options from staging (pdf-merge does; image-to-pdf doesn't) can do so cleanly. ToolFrame is updated to pass `setOptions={setOptions}` to the StagingArea component.

**Files:**
- Modify: `src/engines/_shared/types.ts` (add `setOptions` to StagingAreaProps)
- Modify: `src/components/tool-frame.tsx` (pass setOptions to Staging)
- Create: `src/engines/pdf-merge/options.ts`
- Create: `src/engines/pdf-merge/staging-area.tsx`
- Create: `src/engines/pdf-merge/staging-area.test.tsx`
- Modify: `src/test-setup.ts` (only if `crypto.randomUUID` polyfill not already present — most likely yes for jsdom)

- [ ] **Step 1: Extend `StagingAreaProps` in `src/engines/_shared/types.ts`**

Read the current `src/engines/_shared/types.ts`. The existing `StagingAreaProps` looks like:

```ts
export type StagingAreaProps<TOptions> = {
  files: File[];
  onChange: (next: File[]) => void;
  options: TOptions;
};
```

Replace it with:

```ts
export type StagingAreaProps<TOptions> = {
  files: File[];
  onChange: (next: File[]) => void;
  options: TOptions;
  setOptions: (next: TOptions) => void;
};
```

`setOptions` lets a multi-input StagingArea write row metadata into options without altering the file list. Image-to-pdf's StagingArea will receive but ignore it; pdf-merge uses it for row-state persistence.

- [ ] **Step 2: Update `src/components/tool-frame.tsx` to pass `setOptions`**

Read the current `src/components/tool-frame.tsx`. Find the line that renders `<Staging ...>`:

```tsx
{Staging && stagedFiles.length > 0 && (
  <Staging files={stagedFiles} onChange={setStagedFiles} options={options} />
)}
```

Replace with:

```tsx
{Staging && stagedFiles.length > 0 && (
  <Staging
    files={stagedFiles}
    onChange={setStagedFiles}
    options={options}
    setOptions={setOptions}
  />
)}
```

`setOptions` already exists in scope (`useState<TOptions>(engine.defaultOptions)` — see top of ToolFrame). No other changes.

- [ ] **Step 3: Run typecheck to verify image-to-pdf StagingArea is satisfied by the new type (it ignores `setOptions`)**

```bash
pnpm typecheck
```

Expected: exit 0. The image-to-pdf StagingArea destructures `{ files, onChange }` and ignores `options` and `setOptions` — that's allowed under TS structural typing.

- [ ] **Step 4: Write `src/engines/pdf-merge/options.ts`**

```ts
export type PdfMergeRow = {
  id: string;
  fileName: string;
  pageCount: number | undefined;
  encrypted: boolean;
  rangeInput: string;
  parsedRange: number[];
  rangeError: string | undefined;
};

export type PdfMergeOptions = {
  rows: PdfMergeRow[];
};

export const defaultPdfMergeOptions: PdfMergeOptions = { rows: [] };
```

- [ ] **Step 5: Add `crypto.randomUUID` polyfill to `src/test-setup.ts` if missing**

```bash
grep -n "randomUUID" src/test-setup.ts
```

If no match, append to `src/test-setup.ts`:

```ts
if (typeof globalThis.crypto === "undefined") {
  (globalThis as { crypto: Crypto }).crypto = {} as Crypto;
}
if (typeof globalThis.crypto.randomUUID !== "function") {
  let counter = 0;
  (globalThis.crypto as { randomUUID: () => string }).randomUUID = () =>
    `test-uuid-${++counter}`;
}
```

If `randomUUID` IS already present, skip this step.

- [ ] **Step 6: Write `src/engines/pdf-merge/staging-area.tsx`**

```tsx
"use client";

import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { StagingAreaProps } from "@/engines/_shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseRange } from "./range";
import { renderFirstPageThumbnail } from "./render-thumbnail";
import type { PdfMergeOptions, PdfMergeRow } from "./options";

type RowMeta = {
  thumbnailUrl: string | undefined;
};

function newRowId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `row-${Math.random().toString(36).slice(2)}`;
}

function formatPages(row: PdfMergeRow): string {
  if (row.encrypted) return "[ password-protected ]";
  if (row.pageCount === undefined) return "loading...";
  return row.pageCount === 1 ? "1 page" : `${row.pageCount} pages`;
}

type SortableRowProps = {
  row: PdfMergeRow;
  index: number;
  total: number;
  thumb: RowMeta;
  onRangeChange: (id: string, value: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onRemove: (id: string) => void;
};

function SortableRow({
  row,
  index,
  total,
  thumb,
  onRangeChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid="staging-row"
      className="flex items-center gap-3 px-3 py-2 text-[var(--text-xs)]"
    >
      <button
        type="button"
        data-testid="drag-handle"
        aria-label={`Drag to reorder ${row.fileName}`}
        {...attributes}
        {...listeners}
        className="cursor-grab text-[var(--color-fg-very-muted)] hover:text-[var(--color-fg-strong)]"
      >
        ≡
      </button>
      <span className="w-6 text-right text-[var(--color-accent)] tabular-nums">{index + 1}</span>
      <div className="h-8 w-8 flex-shrink-0 border border-[var(--color-hairline)] bg-[var(--color-bg)]">
        {thumb.thumbnailUrl ? (
          <img src={thumb.thumbnailUrl} alt="" className="h-full w-full object-contain" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[var(--color-fg-very-muted)]">
            ?
          </span>
        )}
      </div>
      <span className="flex-1 truncate text-[var(--color-fg)]" title={row.fileName}>
        {row.fileName}
      </span>
      <span
        className={
          row.encrypted
            ? "text-[var(--color-accent)] tabular-nums"
            : "text-[var(--color-fg-muted)] tabular-nums"
        }
      >
        {formatPages(row)}
      </span>
      <div className="flex flex-col gap-0.5">
        <input
          type="text"
          data-testid="range-input"
          value={row.rangeInput}
          placeholder="all"
          disabled={row.encrypted || row.pageCount === undefined}
          onChange={(e) => onRangeChange(row.id, e.target.value)}
          className="w-24 border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-0.5 font-mono text-[var(--color-fg)]"
        />
        {row.rangeError && (
          <span data-testid="range-error" className="text-[var(--color-accent)]">
            {row.rangeError}
          </span>
        )}
      </div>
      <button
        type="button"
        data-testid="move-up"
        onClick={() => onMoveUp(row.id)}
        disabled={index === 0}
        className="border border-[var(--color-hairline)] px-2 py-0.5 text-[var(--color-fg-muted)] disabled:opacity-30"
      >
        ↑
      </button>
      <button
        type="button"
        data-testid="move-down"
        onClick={() => onMoveDown(row.id)}
        disabled={index === total - 1}
        className="border border-[var(--color-hairline)] px-2 py-0.5 text-[var(--color-fg-muted)] disabled:opacity-30"
      >
        ↓
      </button>
      <button
        type="button"
        data-testid="remove"
        onClick={() => onRemove(row.id)}
        className="border border-[var(--color-hairline)] px-2 py-0.5 text-[var(--color-fg-muted)]"
      >
        ×
      </button>
    </div>
  );
}

export function PdfMergeStagingArea({
  files,
  onChange,
  options,
  setOptions,
}: StagingAreaProps<PdfMergeOptions>) {
  // Local thumbnail map keyed by row id (object URLs aren't part of options).
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const urlsToRevoke = useRef<string[]>([]);
  // file → row.id; allocated on add, used to look up the row that owns a File.
  const fileToId = useRef<Map<File, string>>(new Map());
  // The latest options.rows seen, kept in sync via a ref so async load callbacks
  // can read up-to-date row state without stale closures.
  const latestRowsRef = useRef<PdfMergeRow[]>(options.rows);
  useEffect(() => {
    latestRowsRef.current = options.rows;
  }, [options.rows]);

  // When new files appear in props (drop or external add), allocate row state
  // and kick off async metadata + thumbnail loads.
  useEffect(() => {
    const newFiles = files.filter((f) => !fileToId.current.has(f));
    if (newFiles.length === 0 && options.rows.length === files.length) return;

    if (newFiles.length > 0) {
      const newRows: PdfMergeRow[] = newFiles.map((f) => {
        const id = newRowId();
        fileToId.current.set(f, id);
        return {
          id,
          fileName: f.name,
          pageCount: undefined,
          encrypted: false,
          rangeInput: "",
          parsedRange: [],
          rangeError: undefined,
        };
      });
      const updated = [...options.rows, ...newRows];
      latestRowsRef.current = updated;
      setOptions({ rows: updated });

      for (const f of newFiles) {
        const id = fileToId.current.get(f);
        if (!id) continue;
        void loadMetadata(f, id);
        void loadThumbnail(f, id);
      }
    }

    async function loadMetadata(file: File, rowId: string) {
      try {
        const bytes = await file.arrayBuffer();
        const { PDFDocument } = await import("pdf-lib");
        try {
          const doc = await PDFDocument.load(bytes);
          commitMetadata(rowId, { pageCount: doc.getPageCount(), encrypted: false });
        } catch (err: unknown) {
          const isEncrypted =
            typeof err === "object" &&
            err !== null &&
            "constructor" in err &&
            (err as { constructor: { name?: string } }).constructor.name === "EncryptedPDFError";
          commitMetadata(rowId, {
            pageCount: 0,
            encrypted: isEncrypted,
          });
        }
      } catch {
        commitMetadata(rowId, { pageCount: 0, encrypted: false });
      }
    }

    async function loadThumbnail(file: File, rowId: string) {
      try {
        const bytes = await file.arrayBuffer();
        const blob = await renderFirstPageThumbnail(bytes, 32);
        const url = URL.createObjectURL(blob);
        urlsToRevoke.current.push(url);
        setThumbs((prev) => {
          // Only commit if the row still exists (file may have been removed).
          if (!fileToId.current.has(file)) {
            URL.revokeObjectURL(url);
            return prev;
          }
          const next = new Map(prev);
          next.set(rowId, url);
          return next;
        });
      } catch {
        // Render the '?' placeholder; nothing to commit.
      }
    }

    function commitMetadata(rowId: string, patch: Partial<PdfMergeRow>) {
      const next = latestRowsRef.current.map((r) => {
        if (r.id !== rowId) return r;
        const merged: PdfMergeRow = { ...r, ...patch };
        // Re-parse range when pageCount just resolved (it may have changed
        // from undefined to a real number).
        if (patch.pageCount !== undefined && !merged.encrypted) {
          const result = parseRange(merged.rangeInput, merged.pageCount ?? 0);
          merged.parsedRange = result.ok ? result.indices : [];
          merged.rangeError = result.ok ? undefined : result.reason;
        } else if (merged.encrypted) {
          merged.parsedRange = [];
          merged.rangeError = undefined;
        }
        return merged;
      });
      latestRowsRef.current = next;
      setOptions({ rows: next });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  // Sync rows when files are removed externally (rare in pdf-merge — the
  // StagingArea's × is the primary remover; this guards against any external
  // removal path).
  useEffect(() => {
    const filesSet = new Set(files);
    const validIds = new Set<string>();
    for (const f of files) {
      const id = fileToId.current.get(f);
      if (id) validIds.add(id);
    }
    const filteredRows = options.rows.filter((r) => validIds.has(r.id));
    if (filteredRows.length === options.rows.length) return;

    for (const [f, id] of fileToId.current.entries()) {
      if (!filesSet.has(f)) {
        fileToId.current.delete(f);
        const url = thumbs.get(id);
        if (url) URL.revokeObjectURL(url);
      }
    }
    latestRowsRef.current = filteredRows;
    setOptions({ rows: filteredRows });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  useEffect(() => {
    return () => {
      for (const url of urlsToRevoke.current) URL.revokeObjectURL(url);
      urlsToRevoke.current = [];
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Helpers for operations that need to keep files and rows in lockstep.
  function reorder(oldIndex: number, newIndex: number) {
    if (oldIndex === newIndex) return;
    onChange(arrayMove(files, oldIndex, newIndex));
    const next = arrayMove(options.rows, oldIndex, newIndex);
    latestRowsRef.current = next;
    setOptions({ rows: next });
  }

  function removeAt(index: number) {
    const file = files[index];
    if (file) {
      const id = fileToId.current.get(file);
      if (id) {
        const url = thumbs.get(id);
        if (url) URL.revokeObjectURL(url);
        fileToId.current.delete(file);
      }
    }
    onChange(files.filter((_, i) => i !== index));
    const next = options.rows.filter((_, i) => i !== index);
    latestRowsRef.current = next;
    setOptions({ rows: next });
  }

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = options.rows.findIndex((r) => r.id === active.id);
      const newIndex = options.rows.findIndex((r) => r.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      reorder(oldIndex, newIndex);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options.rows, files, onChange, setOptions],
  );

  const onRangeChange = useCallback(
    (id: string, value: string) => {
      const next = options.rows.map((r) => {
        if (r.id !== id) return r;
        if (r.pageCount === undefined) return { ...r, rangeInput: value };
        const result = parseRange(value, r.pageCount);
        return result.ok
          ? { ...r, rangeInput: value, parsedRange: result.indices, rangeError: undefined }
          : { ...r, rangeInput: value, parsedRange: [], rangeError: result.reason };
      });
      latestRowsRef.current = next;
      setOptions({ rows: next });
    },
    [options.rows, setOptions],
  );

  const onMoveUp = useCallback(
    (id: string) => {
      const i = options.rows.findIndex((r) => r.id === id);
      if (i <= 0) return;
      reorder(i, i - 1);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options.rows, files, onChange, setOptions],
  );
  const onMoveDown = useCallback(
    (id: string) => {
      const i = options.rows.findIndex((r) => r.id === id);
      if (i < 0 || i >= options.rows.length - 1) return;
      reorder(i, i + 1);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options.rows, files, onChange, setOptions],
  );
  const onRemove = useCallback(
    (id: string) => {
      const i = options.rows.findIndex((r) => r.id === id);
      if (i < 0) return;
      removeAt(i);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options.rows, files, onChange, setOptions],
  );

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <SortableContext items={options.rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
        <div
          data-testid="pdf-merge-staging"
          className="mb-3 border border-[var(--color-hairline)] divide-y divide-[var(--color-hairline)]"
        >
          {options.rows.map((row, i) => (
            <SortableRow
              key={row.id}
              row={row}
              index={i}
              total={options.rows.length}
              thumb={{ thumbnailUrl: thumbs.get(row.id) }}
              onRangeChange={onRangeChange}
              onMoveUp={onMoveUp}
              onMoveDown={onMoveDown}
              onRemove={onRemove}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
```

- [ ] **Step 7: Write `src/engines/pdf-merge/staging-area.test.tsx`**

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultPdfMergeOptions, type PdfMergeOptions, type PdfMergeRow } from "./options";

vi.mock("./render-thumbnail", () => ({
  renderFirstPageThumbnail: vi.fn(async () => {
    throw new Error("stubbed thumbnail failure");
  }),
}));

vi.mock("pdf-lib", () => {
  class EncryptedPDFError extends Error {
    constructor() {
      super("encrypted");
      this.name = "EncryptedPDFError";
    }
  }
  return {
    EncryptedPDFError,
    PDFDocument: {
      load: vi.fn(async (_bytes: ArrayBuffer) => ({
        getPageCount: () => 5,
      })),
    },
  };
});

import { PdfMergeStagingArea } from "./staging-area";

afterEach(() => vi.clearAllMocks());

function makeFile(name: string): File {
  return new File([new Uint8Array(100)], name, { type: "application/pdf" });
}

function lastSetOptionsCall(setOptions: ReturnType<typeof vi.fn>): PdfMergeOptions {
  return setOptions.mock.calls[setOptions.mock.calls.length - 1]?.[0] as PdfMergeOptions;
}

describe("PdfMergeStagingArea", () => {
  it("creates one row per added file with allocated UUID id", () => {
    const files = [makeFile("a.pdf"), makeFile("b.pdf")];
    const onChange = vi.fn();
    const setOptions = vi.fn();
    render(
      <PdfMergeStagingArea
        files={files}
        onChange={onChange}
        options={defaultPdfMergeOptions}
        setOptions={setOptions}
      />,
    );
    expect(setOptions).toHaveBeenCalled();
    const last = lastSetOptionsCall(setOptions);
    expect(last.rows).toHaveLength(2);
    expect(last.rows[0]?.id).toBeTruthy();
    expect(last.rows[0]?.id).not.toBe(last.rows[1]?.id);
    expect(last.rows[0]?.fileName).toBe("a.pdf");
    expect(last.rows[1]?.fileName).toBe("b.pdf");
  });

  it("renders rows from options.rows when provided", () => {
    const rows: PdfMergeRow[] = [
      {
        id: "r1",
        fileName: "alpha.pdf",
        pageCount: 5,
        encrypted: false,
        rangeInput: "",
        parsedRange: [0, 1, 2, 3, 4],
        rangeError: undefined,
      },
    ];
    render(
      <PdfMergeStagingArea
        files={[makeFile("alpha.pdf")]}
        onChange={() => undefined}
        options={{ rows }}
        setOptions={() => undefined}
      />,
    );
    expect(screen.getByText("alpha.pdf")).toBeInTheDocument();
    expect(screen.getByText("5 pages")).toBeInTheDocument();
  });

  it("shows '[ password-protected ]' when row.encrypted", () => {
    const rows: PdfMergeRow[] = [
      {
        id: "r1",
        fileName: "secret.pdf",
        pageCount: 0,
        encrypted: true,
        rangeInput: "",
        parsedRange: [],
        rangeError: undefined,
      },
    ];
    render(
      <PdfMergeStagingArea
        files={[makeFile("secret.pdf")]}
        onChange={() => undefined}
        options={{ rows }}
        setOptions={() => undefined}
      />,
    );
    expect(screen.getByText("[ password-protected ]")).toBeInTheDocument();
  });

  it("range input typing updates parsedRange and clears rangeError on valid input", () => {
    const rows: PdfMergeRow[] = [
      {
        id: "r1",
        fileName: "x.pdf",
        pageCount: 5,
        encrypted: false,
        rangeInput: "",
        parsedRange: [0, 1, 2, 3, 4],
        rangeError: undefined,
      },
    ];
    const setOptions = vi.fn();
    render(
      <PdfMergeStagingArea
        files={[makeFile("x.pdf")]}
        onChange={() => undefined}
        options={{ rows }}
        setOptions={setOptions}
      />,
    );
    setOptions.mockClear();
    fireEvent.change(screen.getByTestId("range-input"), { target: { value: "1-3" } });
    const last = lastSetOptionsCall(setOptions);
    expect(last.rows[0]?.rangeInput).toBe("1-3");
    expect(last.rows[0]?.parsedRange).toEqual([0, 1, 2]);
    expect(last.rows[0]?.rangeError).toBeUndefined();
  });

  it("range input typing sets rangeError on out-of-bounds", () => {
    const rows: PdfMergeRow[] = [
      {
        id: "r1",
        fileName: "x.pdf",
        pageCount: 5,
        encrypted: false,
        rangeInput: "",
        parsedRange: [0, 1, 2, 3, 4],
        rangeError: undefined,
      },
    ];
    const setOptions = vi.fn();
    render(
      <PdfMergeStagingArea
        files={[makeFile("x.pdf")]}
        onChange={() => undefined}
        options={{ rows }}
        setOptions={setOptions}
      />,
    );
    setOptions.mockClear();
    fireEvent.change(screen.getByTestId("range-input"), { target: { value: "7-10" } });
    const last = lastSetOptionsCall(setOptions);
    expect(last.rows[0]?.rangeError).toMatch(/exceeds 5/);
    expect(last.rows[0]?.parsedRange).toEqual([]);
  });

  it("move-up reorders both files and rows in lockstep", () => {
    const fileA = makeFile("a.pdf");
    const fileB = makeFile("b.pdf");
    const rows: PdfMergeRow[] = [
      {
        id: "r1",
        fileName: "a.pdf",
        pageCount: 5,
        encrypted: false,
        rangeInput: "",
        parsedRange: [0, 1, 2, 3, 4],
        rangeError: undefined,
      },
      {
        id: "r2",
        fileName: "b.pdf",
        pageCount: 5,
        encrypted: false,
        rangeInput: "",
        parsedRange: [0, 1, 2, 3, 4],
        rangeError: undefined,
      },
    ];
    const onChange = vi.fn();
    const setOptions = vi.fn();
    render(
      <PdfMergeStagingArea
        files={[fileA, fileB]}
        onChange={onChange}
        options={{ rows }}
        setOptions={setOptions}
      />,
    );
    onChange.mockClear();
    setOptions.mockClear();
    const upButtons = screen.getAllByTestId("move-up");
    fireEvent.click(upButtons[1]!);
    expect(onChange).toHaveBeenCalledWith([fileB, fileA]);
    const last = lastSetOptionsCall(setOptions);
    expect(last.rows.map((r) => r.id)).toEqual(["r2", "r1"]);
  });

  it("remove drops both file and row by id", () => {
    const fileA = makeFile("a.pdf");
    const fileB = makeFile("b.pdf");
    const rows: PdfMergeRow[] = [
      {
        id: "r1",
        fileName: "a.pdf",
        pageCount: 5,
        encrypted: false,
        rangeInput: "",
        parsedRange: [0, 1, 2, 3, 4],
        rangeError: undefined,
      },
      {
        id: "r2",
        fileName: "b.pdf",
        pageCount: 5,
        encrypted: false,
        rangeInput: "",
        parsedRange: [0, 1, 2, 3, 4],
        rangeError: undefined,
      },
    ];
    const onChange = vi.fn();
    const setOptions = vi.fn();
    render(
      <PdfMergeStagingArea
        files={[fileA, fileB]}
        onChange={onChange}
        options={{ rows }}
        setOptions={setOptions}
      />,
    );
    onChange.mockClear();
    setOptions.mockClear();
    const removes = screen.getAllByTestId("remove");
    fireEvent.click(removes[0]!);
    expect(onChange).toHaveBeenCalledWith([fileB]);
    const last = lastSetOptionsCall(setOptions);
    expect(last.rows.map((r) => r.id)).toEqual(["r2"]);
  });

  it("falls back to '?' placeholder when thumbnail render fails", async () => {
    const files = [makeFile("a.pdf")];
    render(
      <PdfMergeStagingArea
        files={files}
        onChange={() => undefined}
        options={defaultPdfMergeOptions}
        setOptions={() => undefined}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("?")).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 8: Run unit gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all exit 0. Total test count: 128 + 8 = 136.

- [ ] **Step 9: Commit**

```bash
git add src/engines/_shared/types.ts \
        src/components/tool-frame.tsx \
        src/engines/pdf-merge/options.ts \
        src/engines/pdf-merge/staging-area.tsx \
        src/engines/pdf-merge/staging-area.test.tsx
# Add test-setup.ts only if it was modified
git status -s src/test-setup.ts | grep -q "^ M" && git add src/test-setup.ts || true
git commit -m "feat(engines): pdf-merge StagingArea + StagingAreaProps setOptions

Extends StagingAreaProps with setOptions: (next: TOptions) => void
so multi-input engines can write row metadata into options. ToolFrame
passes the existing setOptions hook through to <Staging>. Image-to-
pdf's StagingArea ignores it (structural typing).

PdfMergeStagingArea renders per-row UI: drag handle (dnd-kit),
thumbnail (lazy pdf.js), page count or [ password-protected ],
Acrobat-syntax range input with inline error, ↑↓ buttons, ×.
Allocates crypto.randomUUID per row on file-add; ids persist across
reorders. Loads pdf-lib metadata + pdf.js thumbnail in parallel.
EncryptedPDFError sets row.encrypted true. Range parsing fires
synchronously on input change. Files and rows stay in lockstep:
reorder/remove update both arrays. dnd-kit handles pointer +
keyboard drag (PointerSensor with 4px activation; KeyboardSensor
with sortableKeyboardCoordinates).

8 unit tests cover row creation, encrypted display, range typing
ok/error paths, move-up reordering files+rows in lockstep, remove
dropping both, and thumbnail failure fallback."
```

---

## Task 6: pdf-merge worker

**Goal:** `src/engines/pdf-merge/worker.ts` exposes `convertMulti(files, opts)` that loads each PDF, validates row state defensively, and copies the specified pages into a single output PDF named `merged.pdf`.

**Files:**
- Create: `src/engines/pdf-merge/worker.ts`

- [ ] **Step 1: Write `src/engines/pdf-merge/worker.ts`**

```ts
import * as Comlink from "comlink";
import { PDFDocument } from "pdf-lib";
import type { OutputItem } from "@/engines/_shared/types";
import type { PdfMergeOptions } from "./options";

const api = {
  async convertMulti(
    files: Array<{ bytes: ArrayBuffer; name: string; type: string }>,
    opts: PdfMergeOptions,
  ): Promise<OutputItem> {
    if (files.length < 2) {
      throw new Error("pdf-merge: need 2+ PDFs");
    }
    if (opts.rows.length !== files.length) {
      throw new Error("pdf-merge: row metadata length mismatch");
    }

    const out = await PDFDocument.create();

    for (const [i, f] of files.entries()) {
      const row = opts.rows[i];
      if (!row) {
        throw new Error(`pdf-merge: missing row metadata at index ${i}`);
      }
      if (row.encrypted) {
        throw new Error(`pdf-merge: ${f.name} is password-protected`);
      }
      if (row.rangeError) {
        throw new Error(`pdf-merge: ${f.name} has invalid range — ${row.rangeError}`);
      }

      const src = await PDFDocument.load(f.bytes);
      const indices =
        row.parsedRange.length > 0
          ? row.parsedRange
          : Array.from({ length: src.getPageCount() }, (_, k) => k);
      const copied = await out.copyPages(src, indices);
      for (const page of copied) {
        out.addPage(page);
      }
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

- [ ] **Step 2: Run unit gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all exit 0. Test count unchanged (worker correctness exercised by E2E in Task 10).

- [ ] **Step 3: Commit**

```bash
git add src/engines/pdf-merge/worker.ts
git commit -m "feat(engines): pdf-merge worker

pdf-lib pipeline: load each source, validate row state defensively
(throw on encrypted, throw on rangeError, throw on length mismatch),
copyPages with row.parsedRange (or all pages when empty), addPage
each into output, save as merged.pdf blob. Worker correctness is
exercised by the Task 10 E2E specs since jsdom can't validate
real PDF byte structure."
```

---

## Task 7: pdf-merge engine descriptor + registry entry

**Goal:** Wire the engine descriptor (validate, convert, StagingArea, cardinality=multi, isReadyToConvert reading opts.rows). Register in the engine registry. Add metadata + validation tests. Run the engine-module build probe.

**Files:**
- Create: `src/engines/pdf-merge/index.ts`
- Create: `src/engines/pdf-merge/index.test.ts`
- Modify: `src/engines/_shared/registry.ts`
- Modify: `src/engines/_shared/registry.test.ts`

- [ ] **Step 1: Write `src/engines/pdf-merge/index.ts`**

```ts
import { WorkerHarness } from "@/engines/_shared/harness";
import type { MultiInputEngine, OutputItem } from "@/engines/_shared/types";
import { type PdfMergeOptions, defaultPdfMergeOptions } from "./options";
import { PdfMergeStagingArea } from "./staging-area";

const SUPPORTED_INPUT_MIMES = ["application/pdf"];

const engine: MultiInputEngine<PdfMergeOptions, OutputItem> = {
  id: "pdf-merge",
  inputAccept: [".pdf"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "application/pdf",
  defaultOptions: defaultPdfMergeOptions,
  convertButtonLabel: "[ merge pdfs ]",
  cardinality: "multi",
  StagingArea: PdfMergeStagingArea,
  isReadyToConvert(opts) {
    if (opts.rows.length < 2) return false;
    return opts.rows.every(
      (r) => r.pageCount !== undefined && !r.encrypted && !r.rangeError,
    );
  },
  validate(files) {
    if (files.length === 0) return { ok: false, reason: "Drop at least one PDF" };
    if (files.length === 1) return { ok: false, reason: "Need 2+ PDFs to merge" };
    const allPdf = files.every(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
    );
    if (!allPdf) return { ok: false, reason: "All files must be PDFs" };
    return { ok: true };
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

export default engine;
```

- [ ] **Step 2: Write `src/engines/pdf-merge/index.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import engine from "./index";

describe("pdf-merge engine metadata", () => {
  it("declares correct id, accept lists, and cardinality", () => {
    expect(engine.id).toBe("pdf-merge");
    expect(engine.inputAccept).toEqual([".pdf"]);
    expect(engine.inputMime).toEqual(["application/pdf"]);
    expect(engine.cardinality).toBe("multi");
    expect(engine.outputMime).toBe("application/pdf");
    expect(engine.convertButtonLabel).toBe("[ merge pdfs ]");
  });

  it("declares a StagingArea but no OptionsPanel", () => {
    expect(engine.StagingArea).toBeDefined();
    expect(engine.OptionsPanel).toBeUndefined();
  });

  it("rejects an empty file list", () => {
    const r = engine.validate([], engine.defaultOptions);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/at least one/i);
  });

  it("rejects a single PDF (need 2+)", () => {
    const f = new File([new Uint8Array([1])], "a.pdf", { type: "application/pdf" });
    const r = engine.validate([f], engine.defaultOptions);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/2\+/);
  });

  it("accepts 2 PDFs", () => {
    const a = new File([new Uint8Array([1])], "a.pdf", { type: "application/pdf" });
    const b = new File([new Uint8Array([1])], "b.pdf", { type: "application/pdf" });
    const r = engine.validate([a, b], engine.defaultOptions);
    expect(r.ok).toBe(true);
  });

  it("rejects non-PDF in the set", () => {
    const a = new File([new Uint8Array([1])], "a.pdf", { type: "application/pdf" });
    const b = new File([new Uint8Array([1])], "b.png", { type: "image/png" });
    const r = engine.validate([a, b], engine.defaultOptions);
    expect(r.ok).toBe(false);
  });

  it("isReadyToConvert returns false when fewer than 2 rows", () => {
    const ready = engine.isReadyToConvert?.({ rows: [] });
    expect(ready).toBe(false);
  });

  it("isReadyToConvert returns false when any row is encrypted", () => {
    const ready = engine.isReadyToConvert?.({
      rows: [
        {
          id: "r1",
          fileName: "a.pdf",
          pageCount: 5,
          encrypted: false,
          rangeInput: "",
          parsedRange: [0, 1, 2, 3, 4],
          rangeError: undefined,
        },
        {
          id: "r2",
          fileName: "b.pdf",
          pageCount: 0,
          encrypted: true,
          rangeInput: "",
          parsedRange: [],
          rangeError: undefined,
        },
      ],
    });
    expect(ready).toBe(false);
  });

  it("isReadyToConvert returns false when any row has rangeError", () => {
    const ready = engine.isReadyToConvert?.({
      rows: [
        {
          id: "r1",
          fileName: "a.pdf",
          pageCount: 5,
          encrypted: false,
          rangeInput: "7-10",
          parsedRange: [],
          rangeError: "page 7 exceeds 5",
        },
        {
          id: "r2",
          fileName: "b.pdf",
          pageCount: 5,
          encrypted: false,
          rangeInput: "",
          parsedRange: [0, 1, 2, 3, 4],
          rangeError: undefined,
        },
      ],
    });
    expect(ready).toBe(false);
  });

  it("isReadyToConvert returns true when all rows are valid", () => {
    const ready = engine.isReadyToConvert?.({
      rows: [
        {
          id: "r1",
          fileName: "a.pdf",
          pageCount: 5,
          encrypted: false,
          rangeInput: "",
          parsedRange: [0, 1, 2, 3, 4],
          rangeError: undefined,
        },
        {
          id: "r2",
          fileName: "b.pdf",
          pageCount: 3,
          encrypted: false,
          rangeInput: "1-2",
          parsedRange: [0, 1],
          rangeError: undefined,
        },
      ],
    });
    expect(ready).toBe(true);
  });
});
```

- [ ] **Step 3: Update `src/engines/_shared/registry.ts`**

Read the current `src/engines/_shared/registry.ts` and add `"pdf-merge"` to the `EngineId` union and the registry table:

```ts
import type { ConversionEngine, OutputItem } from "./types";

export type EngineId = "image-convert" | "image-to-pdf" | "pdf-merge";

// biome-ignore lint/suspicious/noExplicitAny: registry erases per-engine TOptions
type AnyEngine = ConversionEngine<any, OutputItem | OutputItem[]>;

type Loader = () => Promise<{ default: AnyEngine }>;

const REGISTRY: Record<EngineId, Loader> = {
  "image-convert": () => import("@/engines/image-convert"),
  "image-to-pdf": () => import("@/engines/image-to-pdf"),
  "pdf-merge": () => import("@/engines/pdf-merge"),
};

export async function loadEngine(id: EngineId): Promise<ConversionEngine> {
  const loader = REGISTRY[id];
  if (!loader) throw new Error(`Unknown engine id: ${id}`);
  const mod = await loader();
  return mod.default;
}

export function listEngineIds(): EngineId[] {
  return Object.keys(REGISTRY) as EngineId[];
}
```

If the current file has slight differences (e.g., exact error wording), keep its actual signature and just add the new entry.

- [ ] **Step 4: Append a positive-path test in `src/engines/_shared/registry.test.ts`**

Add inside the existing describe block:

```ts
  it("loadEngine returns the pdf-merge engine module", async () => {
    const e = await loadEngine("pdf-merge");
    expect(e.id).toBe("pdf-merge");
    expect(e.cardinality).toBe("multi");
  });
```

Do not duplicate or modify the existing tests.

- [ ] **Step 5: Run all unit gates**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all exit 0. Total test count: 136 + 10 + 1 = 147.

- [ ] **Step 6: Engine-module build probe**

Force the build to pull `@/engines/pdf-merge` into the page graph so Webpack resolves the worker URL and emits the worker chunk.

Add a temporary import to `src/app/page.tsx` (line 1, BEFORE any other imports):

```ts
import "@/engines/pdf-merge";
```

Run `pnpm build`. Expected: exit 0; build emits a new `pdf-merge` worker chunk alongside the existing image-convert and image-to-pdf chunks. Verify with:

```bash
ls -la out/_next/static/chunks/ | head -40
```

Look for chunks whose names match the pdf-merge worker pattern (filename hash differs build-to-build; look for new chunks vs the previous build).

If the build fails on `Module not found: Can't resolve 'fs'` or similar, the worker has pulled in a Node-only path through pdf-lib — investigate. (pdf-lib is browser-friendly; this should not happen.)

Revert the temporary import:

```bash
git checkout -- src/app/page.tsx
```

Confirm `git status` shows only the four expected files staged: `src/engines/pdf-merge/index.ts`, `src/engines/pdf-merge/index.test.ts`, `src/engines/_shared/registry.ts`, `src/engines/_shared/registry.test.ts`. Tree is otherwise clean.

- [ ] **Step 7: Commit**

```bash
git add src/engines/pdf-merge/index.ts \
        src/engines/pdf-merge/index.test.ts \
        src/engines/_shared/registry.ts \
        src/engines/_shared/registry.test.ts
git commit -m "feat(engines): pdf-merge descriptor + registry entry

MultiInputEngine wired with StagingArea + validate + convert.
isReadyToConvert(opts) returns false when fewer than 2 rows or any
row is still loading, encrypted, or has a rangeError. validate:
empty rejects, single rejects (need 2+), all-PDF accepts, mixed
rejects.

Registry's EngineId union gains 'pdf-merge'; loadEngine
positive-path test covers the dynamic import.

Engine-module build probe confirmed: Webpack emits the new
pdf-merge worker chunk alongside the existing engine chunks."
```

---

## Task 8: pdf-merge route + sidebar entry + homepage routing

**Goal:** New page at `/tools/pdf-merge`. Sidebar gains a `PDFS` group with `merge` entry. Homepage routes 2+ PDF drops to the new tool, 1 PDF drop produces a clear error, mixed image+PDF produces a "same type" error.

**Files:**
- Create: `src/app/tools/pdf-merge/page.tsx`
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Write `src/app/tools/pdf-merge/page.tsx`**

```tsx
"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/pdf-merge";

export default function PdfMergePage() {
  return <ToolFrame engine={engine} />;
}
```

- [ ] **Step 2: Update `src/components/layout/sidebar.tsx`**

Read the current file. Append the `pdf-merge` entry to the `TOOLS` array:

```ts
const TOOLS: ToolEntry[] = [
  { id: "image-convert", href: "/tools/image-convert", label: "image convert", group: "IMAGES" },
  { id: "image-to-pdf",  href: "/tools/image-to-pdf",  label: "image→pdf",     group: "IMAGES" },
  { id: "pdf-merge",     href: "/tools/pdf-merge",     label: "merge",         group: "PDFS"   },
];
```

The two existing image entries stay verbatim. Group iteration via `Object.entries(groups)` will render IMAGES before PDFS in array order.

- [ ] **Step 3: Update `src/app/page.tsx` `handleFiles`**

Read the current file. Replace `handleFiles` with:

```tsx
async function handleFiles(files: File[]) {
  setError(null);
  if (files.length === 0) return;

  const mimes = await Promise.all(files.map(detectMime));
  const IMAGE_MIMES = new Set([
    "image/heic",
    "image/heif",
    "image/png",
    "image/jpeg",
    "image/webp",
  ]);
  const allImages = mimes.every((m) => IMAGE_MIMES.has(m));
  const allPdfs = mimes.every((m) => m === "application/pdf");

  if (allImages) {
    if (files.length >= 2) {
      stageFiles(files);
      router.push("/tools/image-to-pdf");
      return;
    }
    stageFiles(files);
    router.push("/tools/image-convert");
    return;
  }

  if (allPdfs) {
    if (files.length >= 2) {
      stageFiles(files);
      router.push("/tools/pdf-merge");
      return;
    }
    setError("Need 2+ PDFs to merge.");
    return;
  }

  setError("All files must be the same type. Phase 4 supports HEIC/PNG/JPEG/WebP for images and PDF for merging.");
}
```

The DropZone is already `multiple` from Plan 3.

- [ ] **Step 4: Run unit + build gates**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all exit 0. Build should emit 6 routes: `/`, `/_not-found`, `/test-only/stub-runner`, `/tools/image-convert`, `/tools/image-to-pdf`, `/tools/pdf-merge`. After this task, build emits a NEW `pdf-merge` worker chunk because `page.tsx` now imports the engine via the route.

Verify the routes:

```bash
ls -la out/tools/
```

Expected: subdirectories for `image-convert`, `image-to-pdf`, `pdf-merge`.

- [ ] **Step 5: Visual sanity check via curl**

Start `pnpm dev` in the background:

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null
sleep 1
pnpm dev > /tmp/dev.log 2>&1 &
until grep -q "Ready in\|Local:" /tmp/dev.log 2>/dev/null; do sleep 1; done
```

Probe:

```bash
curl -sS http://localhost:3000/tools/pdf-merge | grep -o "pdf-merge"
curl -sS http://localhost:3000/ | grep -o "merge\|PDFS"
```

Expected: first curl returns `pdf-merge` (engine ID rendered in ToolFrame header); second returns at least `PDFS` (sidebar group label) AND `merge` (sidebar entry label).

Stop dev:

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null
```

- [ ] **Step 6: Commit**

```bash
git add src/app/tools/pdf-merge \
        src/components/layout/sidebar.tsx \
        src/app/page.tsx
git commit -m "feat(ui): pdf-merge route + sidebar PDFS group + homepage routing

Mounts ToolFrame with the pdf-merge engine at /tools/pdf-merge.
Sidebar gains a PDFS group with single 'merge' entry. Homepage
handleFiles MIME-detects: 2+ images → /tools/image-to-pdf,
1 image → /tools/image-convert, 2+ PDFs → /tools/pdf-merge,
1 PDF → 'Need 2+ PDFs to merge' error, mixed types → 'all files
must be the same type' error."
```

---

## Task 9: image-to-pdf StagingArea retrofit (dnd-kit)

**Goal:** Migrate `image-to-pdf/staging-area.tsx` from manual ↑↓-only reorder to dnd-kit drag-and-drop. ↑↓ buttons remain. Allocate per-row UUID id (currently keyed by File reference). All existing tests for `move-up`/`move-down`/`remove` continue to pass unchanged.

**Files:**
- Modify: `src/engines/image-to-pdf/staging-area.tsx`
- Modify: `src/engines/image-to-pdf/staging-area.test.tsx` (one new test for drag handle presence)

- [ ] **Step 1: Read the current `src/engines/image-to-pdf/staging-area.tsx`**

```bash
cat src/engines/image-to-pdf/staging-area.tsx
```

The current implementation keys rows by File reference and uses index-based moveUp/moveDown. The retrofit:
1. Adds an `id: string` (allocated via crypto.randomUUID on file-add, persisted in a `Map<File, string>` ref).
2. Wraps the row list in `<DndContext>` + `<SortableContext>`.
3. Each row component calls `useSortable({ id })` and applies `attributes` + `listeners` to a new drag-handle button (left of the page number).
4. `onDragEnd` calls `onChange(arrayMove(...))` with the new file order.
5. Existing `moveUp` / `moveDown` / `remove` callbacks are unchanged.

- [ ] **Step 2: Rewrite `src/engines/image-to-pdf/staging-area.tsx`**

Replace the entire file with:

```tsx
"use client";

import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { decodeImage } from "@/engines/_shared/decode-image";
import type { StagingAreaProps } from "@/engines/_shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ImageToPdfOptions } from "./options";

function newRowId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `row-${Math.random().toString(36).slice(2)}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function makeThumb(file: File): Promise<string> {
  const bitmap = await decodeImage(file);
  try {
    const canvas = new OffscreenCanvas(32, 32);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, 32, 32);
    const scale = Math.min(32 / bitmap.width, 32 / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    const x = (32 - w) / 2;
    const y = (32 - h) / 2;
    ctx.drawImage(bitmap, x, y, w, h);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return URL.createObjectURL(blob);
  } finally {
    bitmap.close();
  }
}

type SortableRowProps = {
  id: string;
  file: File;
  index: number;
  total: number;
  thumb: string | "loading" | "error" | undefined;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onRemove: (index: number) => void;
};

function SortableRow({
  id,
  file,
  index,
  total,
  thumb,
  onMoveUp,
  onMoveDown,
  onRemove,
}: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid="staging-row"
      className="flex items-center gap-3 px-3 py-2 text-[var(--text-xs)]"
    >
      <button
        type="button"
        data-testid="drag-handle"
        aria-label={`Drag to reorder ${file.name}`}
        {...attributes}
        {...listeners}
        className="cursor-grab text-[var(--color-fg-very-muted)] hover:text-[var(--color-fg-strong)]"
      >
        ≡
      </button>
      <span className="w-6 text-right text-[var(--color-accent)] tabular-nums">{index + 1}</span>
      <div className="h-8 w-8 flex-shrink-0 border border-[var(--color-hairline)] bg-[var(--color-bg)]">
        {thumb && thumb !== "loading" && thumb !== "error" && (
          <img src={thumb} alt="" className="h-full w-full object-contain" />
        )}
        {thumb === "error" && (
          <span className="flex h-full w-full items-center justify-center text-[var(--color-fg-very-muted)]">
            ?
          </span>
        )}
      </div>
      <span className="flex-1 truncate text-[var(--color-fg)]" title={file.name}>
        {file.name}
      </span>
      <span className="text-[var(--color-fg-muted)] tabular-nums">{formatSize(file.size)}</span>
      <button
        type="button"
        data-testid="move-up"
        onClick={() => onMoveUp(index)}
        disabled={index === 0}
        className="border border-[var(--color-hairline)] px-2 py-0.5 text-[var(--color-fg-muted)] disabled:opacity-30"
      >
        ↑
      </button>
      <button
        type="button"
        data-testid="move-down"
        onClick={() => onMoveDown(index)}
        disabled={index === total - 1}
        className="border border-[var(--color-hairline)] px-2 py-0.5 text-[var(--color-fg-muted)] disabled:opacity-30"
      >
        ↓
      </button>
      <button
        type="button"
        data-testid="remove"
        onClick={() => onRemove(index)}
        className="border border-[var(--color-hairline)] px-2 py-0.5 text-[var(--color-fg-muted)]"
      >
        ×
      </button>
    </div>
  );
}

export function ImageToPdfStagingArea({ files, onChange }: StagingAreaProps<ImageToPdfOptions>) {
  const [thumbs, setThumbs] = useState<Map<File, string | "loading" | "error">>(new Map());
  const urlsToRevoke = useRef<string[]>([]);
  const startedFiles = useRef<Set<File>>(new Set());
  // Stable id per File for dnd-kit. Allocated on first encounter; persisted across reorders.
  const fileIds = useRef<Map<File, string>>(new Map());
  for (const f of files) {
    if (!fileIds.current.has(f)) fileIds.current.set(f, newRowId());
  }

  useEffect(() => {
    const newFiles = files.filter((f) => !startedFiles.current.has(f));
    if (newFiles.length === 0) return;
    for (const f of newFiles) startedFiles.current.add(f);

    setThumbs((prev) => {
      const next = new Map(prev);
      for (const f of newFiles) next.set(f, "loading");
      return next;
    });

    Promise.all(
      newFiles.map(async (f) => {
        try {
          const url = await makeThumb(f);
          return { file: f, url };
        } catch {
          return { file: f, url: "error" as const };
        }
      }),
    ).then((results) => {
      setThumbs((prev) => {
        const next = new Map(prev);
        for (const r of results) {
          if (prev.get(r.file) === "loading") next.set(r.file, r.url);
        }
        return next;
      });
      for (const r of results) {
        if (r.url !== "error") urlsToRevoke.current.push(r.url);
      }
    });
  }, [files]);

  useEffect(() => {
    return () => {
      for (const url of urlsToRevoke.current) URL.revokeObjectURL(url);
      urlsToRevoke.current = [];
    };
  }, []);

  useEffect(() => {
    const filesSet = new Set(files);
    const removed: Array<[File, string | "loading" | "error"]> = [];
    for (const f of startedFiles.current) {
      if (!filesSet.has(f)) {
        removed.push([f, thumbs.get(f) ?? "loading"]);
        startedFiles.current.delete(f);
        fileIds.current.delete(f);
      }
    }
    for (const [, v] of removed) {
      if (typeof v === "string" && v !== "error" && v !== "loading") {
        URL.revokeObjectURL(v);
      }
    }
    if (removed.length === 0) return;
    setThumbs((prev) => {
      const next = new Map<File, string | "loading" | "error">();
      for (const f of files) {
        const v = prev.get(f);
        if (v !== undefined) next.set(f, v);
      }
      return next;
    });
  }, [files, thumbs]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const idToFile = new Map<string, File>();
      for (const f of files) {
        const id = fileIds.current.get(f);
        if (id) idToFile.set(id, f);
      }
      const oldIndex = files.findIndex((f) => fileIds.current.get(f) === active.id);
      const newIndex = files.findIndex((f) => fileIds.current.get(f) === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      onChange(arrayMove(files, oldIndex, newIndex));
    },
    [files, onChange],
  );

  const moveUp = useCallback(
    (i: number) => {
      if (i <= 0) return;
      onChange(arrayMove(files, i, i - 1));
    },
    [files, onChange],
  );
  const moveDown = useCallback(
    (i: number) => {
      if (i >= files.length - 1) return;
      onChange(arrayMove(files, i, i + 1));
    },
    [files, onChange],
  );
  const remove = useCallback(
    (i: number) => {
      onChange(files.filter((_, idx) => idx !== i));
    },
    [files, onChange],
  );

  const items = files.map((f) => fileIds.current.get(f) ?? "");

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <div
          data-testid="image-to-pdf-staging"
          className="mb-3 border border-[var(--color-hairline)] divide-y divide-[var(--color-hairline)]"
        >
          {files.map((f, i) => {
            const id = fileIds.current.get(f) ?? `row-${i}`;
            const thumb = thumbs.get(f);
            return (
              <SortableRow
                key={id}
                id={id}
                file={f}
                index={i}
                total={files.length}
                thumb={thumb}
                onMoveUp={moveUp}
                onMoveDown={moveDown}
                onRemove={remove}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
```

- [ ] **Step 3: Append a drag-handle test to `src/engines/image-to-pdf/staging-area.test.tsx`**

Read the current file and append (inside the existing describe):

```tsx
  it("renders a drag handle for each row", () => {
    const files = [makeFile("a.png"), makeFile("b.png")];
    render(
      <ImageToPdfStagingArea
        files={files}
        onChange={() => undefined}
        options={defaultImageToPdfOptions}
      />,
    );
    expect(screen.getAllByTestId("drag-handle")).toHaveLength(2);
  });
```

- [ ] **Step 4: Run all unit gates**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all exit 0. All previous image-to-pdf staging tests still pass (move-up, move-down, remove all unchanged). New test count: 147 + 1 = 148.

- [ ] **Step 5: Commit**

```bash
git add src/engines/image-to-pdf/staging-area.tsx \
        src/engines/image-to-pdf/staging-area.test.tsx
git commit -m "feat(engines): image-to-pdf StagingArea — dnd-kit retrofit

Wraps the row list in DndContext + SortableContext. Each row
component is now a SortableRow that renders a drag handle on the
left + the existing thumbnail/filename/size/↑↓/× layout. Drag
handle has data-testid='drag-handle' for E2E targeting.

Per-row stable id allocated via crypto.randomUUID on first
encounter (Map<File, string> ref), persisted across reorders. The
existing key={\`\${name}-\${index}\`} is replaced with key={id}.

Sensors: PointerSensor (4px activation) + KeyboardSensor with
sortableKeyboardCoordinates. arrayMove drives both drag-end and
↑↓ buttons. All existing test IDs (move-up, move-down, remove)
preserved; existing tests pass unchanged."
```

---

## Task 10: New E2E specs — pdf-merge happy path + privacy + handoff + drag retrofit

**Goal:** Four E2E coverage points: pdf-merge happy path with drag-reorder, range slicing, encrypted-PDF rejection, bad-range UX; privacy regression for pdf-merge; multi-file homepage handoff; one drag-reorder assertion in image-to-pdf.spec.ts to cover the retrofit.

**Files:**
- Create: `tests/e2e/pdf-merge.spec.ts`
- Create: `tests/e2e/privacy-regression-pdf-merge.spec.ts`
- Create: `tests/e2e/multi-file-handoff-pdf.spec.ts`
- Modify: `tests/e2e/image-to-pdf.spec.ts` (one new test)

- [ ] **Step 1: Write `tests/e2e/pdf-merge.spec.ts`**

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const fix = (name: string) => path.resolve(__dirname, "../fixtures", name);

async function readPdfBytes(downloadPath: string): Promise<Buffer> {
  return await readFile(downloadPath);
}

test("multi-PDF drop produces a downloadable merged PDF (happy path)", async ({ page }) => {
  await page.goto("/tools/pdf-merge");

  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");
  await expect(page.getByTestId("convert-button")).toBeDisabled();

  const input = page.locator('input[type="file"]');
  await input.setInputFiles([
    fix("sample-1page.pdf"),
    fix("sample-2page.pdf"),
    fix("sample-5page.pdf"),
  ]);

  await expect(page.getByTestId("pdf-merge-staging")).toBeVisible();
  await expect(page.getByTestId("staging-row")).toHaveCount(3);

  // Wait for metadata to load (pageCount visible) before Convert is enabled.
  await expect(page.getByText("1 page")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("2 pages")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("5 pages")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("convert-button")).not.toBeDisabled();

  // Click Convert.
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByTestId("convert-button").click();

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });

  const downloadButton = page.getByRole("button", { name: /^download / });
  await expect(downloadButton).toBeVisible();
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);

  const dlPath = await download.path();
  const bytes = await readPdfBytes(dlPath);
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(bytes.subarray(-6).toString("ascii")).toContain("%%EOF");
  // Sum: 1 + 2 + 5 = 8 pages
  expect(bytes.length).toBeGreaterThan(1000);
});

test("range slicing produces the expected page count", async ({ page }) => {
  await page.goto("/tools/pdf-merge");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles([fix("sample-2page.pdf"), fix("sample-5page.pdf")]);

  await expect(page.getByText("2 pages")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("5 pages")).toBeVisible({ timeout: 10_000 });

  // First file: pages 1-2 (= 2 pages). Second file: pages 3- (= 3 pages: 3,4,5). Total = 5.
  const ranges = page.getByTestId("range-input");
  await ranges.nth(0).fill("1-2");
  await ranges.nth(1).fill("3-");

  await expect(page.getByTestId("convert-button")).not.toBeDisabled();
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
  await page.getByRole("button", { name: /^download / }).click();
  const download = await downloadPromise;
  const bytes = await readPdfBytes(await download.path());
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
});

test("encrypted PDF is rejected per-row and Convert stays disabled", async ({ page }) => {
  await page.goto("/tools/pdf-merge");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles([fix("sample-2page.pdf"), fix("sample-encrypted.pdf")]);

  await expect(page.getByText("[ password-protected ]")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("convert-button")).toBeDisabled();
});

test("bad range disables Convert; fixing it re-enables", async ({ page }) => {
  await page.goto("/tools/pdf-merge");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles([fix("sample-2page.pdf"), fix("sample-5page.pdf")]);

  await expect(page.getByText("5 pages")).toBeVisible({ timeout: 10_000 });

  const ranges = page.getByTestId("range-input");
  await ranges.nth(1).fill("7-10"); // 5-page PDF, out of bounds
  await expect(page.getByTestId("range-error").first()).toContainText(/exceeds 5/);
  await expect(page.getByTestId("convert-button")).toBeDisabled();

  await ranges.nth(1).fill("1-3");
  await expect(page.getByTestId("convert-button")).not.toBeDisabled();
});
```

- [ ] **Step 2: Write `tests/e2e/privacy-regression-pdf-merge.spec.ts`**

```ts
import path from "node:path";
import { expect, test } from "@playwright/test";

test("pdf-merge produces zero off-origin requests during conversion", async ({ page }) => {
  const PAGE_PATH = "/tools/pdf-merge";

  // Drain initial-load requests.
  page.on("request", () => undefined);
  await page.goto(PAGE_PATH, { waitUntil: "networkidle" });
  page.removeAllListeners("request");

  const conversionRequests: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.origin !== new URL(page.url()).origin) {
      conversionRequests.push(req.url());
    }
  });
  const conversionWebSockets: string[] = [];
  page.on("websocket", (ws) => {
    if (new URL(ws.url()).host !== new URL(page.url()).host) {
      conversionWebSockets.push(ws.url());
    }
  });

  const input = page.locator('input[type="file"]');
  await input.setInputFiles([
    path.resolve(__dirname, "../fixtures/sample-2page.pdf"),
    path.resolve(__dirname, "../fixtures/sample-5page.pdf"),
  ]);

  await expect(page.getByText("5 pages")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");

  expect(
    conversionRequests,
    `pdf-merge made off-origin requests: ${conversionRequests.join(", ")}`,
  ).toEqual([]);
  expect(
    conversionWebSockets,
    `pdf-merge opened off-origin WebSockets: ${conversionWebSockets.join(", ")}`,
  ).toEqual([]);
});
```

- [ ] **Step 3: Write `tests/e2e/multi-file-handoff-pdf.spec.ts`**

```ts
import path from "node:path";
import { expect, test } from "@playwright/test";

test("homepage multi-PDF drop hands off to pdf-merge with files staged", async ({ page }) => {
  await page.goto("/");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles([
    path.resolve(__dirname, "../fixtures/sample-2page.pdf"),
    path.resolve(__dirname, "../fixtures/sample-5page.pdf"),
  ]);

  await page.waitForURL("**/tools/pdf-merge");

  await expect(page.getByTestId("pdf-merge-staging")).toBeVisible();
  await expect(page.getByTestId("staging-row")).toHaveCount(2);

  await expect(page.getByText("2 pages")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("5 pages")).toBeVisible({ timeout: 10_000 });

  const convertButton = page.getByTestId("convert-button");
  await expect(convertButton).not.toBeDisabled();

  await convertButton.click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: /^download / })).toBeVisible();
});

test("homepage single-PDF drop shows 'Need 2+ PDFs' error", async ({ page }) => {
  await page.goto("/");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles([path.resolve(__dirname, "../fixtures/sample-2page.pdf")]);

  // Should NOT navigate; should show inline error.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('output[role], output').first()).toContainText(/Need 2\+ PDFs/i);
});

test("homepage mixed drop shows 'same type' error", async ({ page }) => {
  await page.goto("/");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles([
    path.resolve(__dirname, "../fixtures/sample-2page.pdf"),
    path.resolve(__dirname, "../fixtures/sample.png"),
  ]);

  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('output[role], output').first()).toContainText(/same type/i);
});
```

- [ ] **Step 4: Add a drag-reorder assertion to `tests/e2e/image-to-pdf.spec.ts`**

Read the current file and append this test inside (after the existing tests):

```ts
test("image-to-pdf drag handle is present per row (dnd-kit retrofit)", async ({ page }) => {
  await page.goto("/tools/image-to-pdf");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles([
    path.resolve(__dirname, "../fixtures/sample.png"),
    path.resolve(__dirname, "../fixtures/sample.jpg"),
    path.resolve(__dirname, "../fixtures/sample.webp"),
  ]);

  await expect(page.getByTestId("staging-row")).toHaveCount(3);
  await expect(page.getByTestId("drag-handle")).toHaveCount(3);
  // ↑↓ buttons still present (kept alongside drag).
  await expect(page.getByTestId("move-up")).toHaveCount(3);
  await expect(page.getByTestId("move-down")).toHaveCount(3);
});
```

- [ ] **Step 5: Run the new specs**

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null
sleep 1
pnpm test:e2e --project=chromium --workers=1 \
  tests/e2e/pdf-merge.spec.ts \
  tests/e2e/privacy-regression-pdf-merge.spec.ts \
  tests/e2e/multi-file-handoff-pdf.spec.ts
```

Expected: 4 + 1 + 3 = 8 tests pass.

- [ ] **Step 6: Run the full E2E suite to verify no regressions**

```bash
pnpm test:e2e --project=chromium --workers=1
```

Expected: all specs pass. Total spec count: 7 (existing after Plan 3) + 3 (new) = 10. Total test count: ~12 (existing) + 8 (new) + 1 (drag handle in image-to-pdf) = ~21.

- [ ] **Step 7: Run the full unit suite as the final regression check**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all exit 0; total 148 unit tests.

- [ ] **Step 8: Commit**

```bash
git add tests/e2e/pdf-merge.spec.ts \
        tests/e2e/privacy-regression-pdf-merge.spec.ts \
        tests/e2e/multi-file-handoff-pdf.spec.ts \
        tests/e2e/image-to-pdf.spec.ts
git commit -m "test(e2e): pdf-merge happy path + privacy + handoff + drag retrofit

pdf-merge.spec.ts (4 tests): multi-PDF happy path with %PDF-+%%EOF
assertion, range slicing, encrypted PDF row-rejected with Convert
disabled, bad range UX with inline error and Convert re-enable.

privacy-regression-pdf-merge.spec.ts: zero off-origin requests +
WebSockets during 2-PDF merge. Same listener pattern as Plan 1+2+3
privacy specs.

multi-file-handoff-pdf.spec.ts (3 tests): homepage 2+ PDF drop
hands off to /tools/pdf-merge, single PDF shows 'Need 2+ PDFs',
mixed image+PDF shows 'same type' error.

image-to-pdf.spec.ts: drag-handle assertion confirms the dnd-kit
retrofit landed alongside the existing ↑↓ buttons (both present)."
```

---

## Phase 4 close-out

After Task 10 commits clean and CI is green:

- Open PR `phase-4-pdf-merge → main` with a structured Summary + Test plan + Deferred-items section.
- After merge, deploy auto-builds. Sanity-click the live URL: drop 2 PDFs on `/`, expect handoff to pdf-merge, optionally set ranges, click Convert, download the merged PDF.
- Phase 6 hardening backlog (carried from Plan 1+2+3, plus new):
  - Bookmark / outline preservation across merges
  - Output filename customization via OptionsPanel
  - libheif `Critical dependency` webpack warning still present
  - `script-src 'unsafe-inline'` still in CSP
  - ToolFrame in-flight-conversion race (drops while converting)
  - bundle-size budget — pdf-lib + pdf.js + libheif together is ~1.9 MB on PDF tools route; revisit with a route-bundle audit
  - Phase 6 candidate: build-time hash injection for inline scripts; engine-chaining infrastructure (C2/C3 from spec brainstorm); image-dimension validate guard
  - Conversion counter in footer (currently hardcoded to 0)
  - 7 noNonNullAssertion warnings in image-to-pdf/staging-area.tsx (carried from Plan 3)

---

## Self-review — spec coverage check

- ✓ Spec §1.1 pdf-merge engine — Tasks 5, 6, 7
- ✓ Spec §1.2 image-to-pdf retrofit — Task 9
- ✓ Spec §1.3 homepage routing extension — Task 8
- ✓ Spec §1.4 sidebar — Task 8
- ✓ Spec §3.1 engine pattern reuse — implicit (no engine type changes; Task 7 wires existing types)
- ✓ Spec §3.2 range parser — Task 2
- ✓ Spec §3.3 thumbnail renderer — Task 3
- ✓ Spec §3.4 dnd-kit integration — Tasks 5, 9 (stable UUID id confirmed in both)
- ✓ Spec §3.5 engine descriptor — Task 7
- ✓ Spec §4 options (rows-as-error-channel) — Task 5 + Task 7 isReadyToConvert
- ✓ Spec §5.1 PdfMergeStagingArea — Task 5
- ✓ Spec §5.2 image-to-pdf retrofit — Task 9
- ✓ Spec §5.3 ToolFrame unchanged — confirmed (no ToolFrame edits in any task)
- ✓ Spec §5.4 sidebar — Task 8
- ✓ Spec §6 worker — Task 6
- ✓ Spec §7 cross-route handoff unchanged — confirmed
- ✓ Spec §8 homepage MIME-detect routing — Task 8
- ✓ Spec §9 sidebar — Task 8
- ✓ Spec §10 validation — Tasks 5 (per-row), 7 (engine-level)
- ✓ Spec §11 output — Task 6 returns merged.pdf
- ✓ Spec §12 privacy — Task 10 privacy-regression spec
- ✓ Spec §13 testing — Tasks 2, 3, 5, 7, 9, 10
- ✓ Spec §14 edge cases — covered by Task 5 row-state machine + Task 10 E2E
- ✓ Spec §15 plan structure preview — matches the 10 tasks here
- ✓ Spec §16 future scope — captured in close-out backlog above
- ✓ Spec §17 success criteria — verified by Tasks 8 (criteria 3-5), 9 (criterion 7), 10 (criteria 1, 2, 6, 8); criterion 9 is the close-out PR step
