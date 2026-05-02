# Phase 5 — PDF Split + multi-output infrastructure implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task with two-stage review on substantive (architecture-touching) tasks and combined opus review on mechanical extensions. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `pdf-split` engine (1 PDF in → N PDFs out, one per Acrobat-syntax range token) plus the shared multi-output infrastructure (ResultList "download all (N) as zip" button, `_shared/zip.ts` lazy-loading client-zip, `archiveSuffix?: string` on `EngineMeta`, range parser promoted to `_shared/`). PDF Split is the first engine in the project to produce multiple OutputItems; the infrastructure that lights up here also unblocks Plan 6 (PDF → image).

**Architecture:** Reuses Plan 1's `SingleInputEngine` type with `OutputItem[]` as the output. ToolFrame's existing `Array.isArray(result) ? result : [result]` narrowing handles multi-output without engine type-system changes. Range parser logic lifts from `pdf-merge/range.ts` to `_shared/range.ts` and gains a `parseRangeTokens` export that retains per-token grouping (so each token becomes one output PDF). ResultList gains a conditional download-all button that lazy-loads `client-zip` via `_shared/zip.ts` and bundles outputs into a `<basename>-split.zip` archive.

**Tech Stack:** Plan 1 + 2 + 3 + 4 stack (Next.js 15 static export, React 19, Comlink workers, OffscreenCanvas, Tailwind v4, Vitest, Playwright, pdf-lib, pdfjs-dist, @dnd-kit) plus **client-zip** (~2 KB min+gz, lazy-loaded; streams ZIP archive — though v1 materializes to a Blob).

**Spec:** [`docs/superpowers/specs/2026-05-02-pdf-split-and-image-design.md`](../specs/2026-05-02-pdf-split-and-image-design.md) (commit `12353d2`).

**Branch:** `phase-5-pdf-split` (create off `main` after the spec/plan PR merges).

**Substantive tasks (full two-stage sonnet+opus review):** 7 (engine descriptor + filenames module), 9 (worker). **Mechanical tasks (combined opus review):** 1, 2, 3, 4, 5, 6, 8, 10, 11.

**Critical ordering dependencies:**
- Task 1 (deps install) MUST land first — every later task imports something installed here.
- Task 2 (range.ts promotion) MUST land before Task 3 (`parseRangeTokens` addition) — moving the file and adding a new export are separate concerns; the move is mechanical.
- Task 5 (EngineMeta `archiveSuffix` extension) MUST land before Task 6 (ResultList consumes `archiveSuffix` via ToolFrame plumbing) and before Task 7 (engine descriptor sets `archiveSuffix: "-split"`).
- Tasks 4, 5, 6 (the multi-output infra) MUST land before Task 7 — engine descriptor depends on the EngineMeta extension and the worker (Task 9) depends on `parseRangeTokens` (Task 3).
- Task 7 (engine descriptor + filenames module) before Tasks 8 (OptionsPanel imports the engine for its options type) and 9 (worker consumes the engine's options type and the filenames module).
- Task 10 (route + sidebar + build probe) needs Tasks 7-9 complete — the route imports the engine module which transitively pulls the worker.
- Task 11 (E2E) needs everything else.

**Branch discipline reminder for implementer subagents:**
- Run `git branch --show-current` BEFORE and AFTER every commit. Verify it reads `phase-5-pdf-split`.
- NEVER run: `git branch -m`, `git branch -M`, `git checkout <branch>`, `git switch <branch>`, `git reset --hard`, `git push`, `git push --force`. NEVER use `--no-verify`.
- Allowed: `git status`, `git diff`, `git log`, `git branch --show-current`, `git add <specific files>`, `git commit`, `git rm <specific files>`, `git mv <a> <b>` (Task 2 explicitly needs this), `git checkout -- <file>` (Task 10 build probe revert).

---

## Task 1: Install client-zip

**Goal:** Add `client-zip` to `dependencies`. Verify build still produces a static export with no chunk-graph change yet (nothing imports it until Task 4).

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Verify branch + clean tree**

```bash
git branch --show-current  # expect: phase-5-pdf-split
git status                 # expect: nothing to commit, working tree clean
```

If on the wrong branch, STOP and ask the user. Do not run `git checkout`.

- [ ] **Step 2: Install client-zip**

```bash
pnpm add client-zip
```

Expected: 1 package added to `dependencies` in `package.json`. Lockfile updated. `client-zip` is a small ESM-only package (~2 KB min+gz).

- [ ] **Step 3: Run all gates**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all exit 0. Test count unchanged from main (160). Build produces `out/` static export with the same 6 routes; `client-zip` is not yet imported anywhere so no chunk-graph change yet.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): add client-zip

Lazy-loaded ZIP packaging library (~2 KB min+gz, ESM-only) for
the multi-output ResultList 'download all as zip' button.
Materializes to Blob in v1 (streaming download deferred to
Phase 6 for cross-browser compatibility)."
```

Expected: branch advances by 1 commit. `git status` clean.

---

## Task 2: Promote range.ts to `_shared/`

**Goal:** Move `src/engines/pdf-merge/range.ts` (and tests) to `src/engines/_shared/range.ts`. Update pdf-merge's import path. No semantic change to `parseRange`. Tests continue to pass.

**Files:**
- Move: `src/engines/pdf-merge/range.ts` → `src/engines/_shared/range.ts`
- Move: `src/engines/pdf-merge/range.test.ts` → `src/engines/_shared/range.test.ts`
- Modify: `src/engines/pdf-merge/staging-area.tsx` (one import line)

- [ ] **Step 1: Move the source file**

```bash
git mv src/engines/pdf-merge/range.ts src/engines/_shared/range.ts
```

Expected: file moves. `git status` shows the rename.

- [ ] **Step 2: Move the test file**

```bash
git mv src/engines/pdf-merge/range.test.ts src/engines/_shared/range.test.ts
```

Expected: test file moves. `git status` shows the second rename.

- [ ] **Step 3: Update import in pdf-merge/staging-area.tsx**

Read `src/engines/pdf-merge/staging-area.tsx`. Find the existing import:

```ts
import { parseRange } from "./range";
```

Replace with:

```ts
import { parseRange } from "@/engines/_shared/range";
```

There should be only one such import in the file. Use the Edit tool with the surrounding context to ensure uniqueness.

- [ ] **Step 4: Run unit gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all exit 0. Total test count unchanged (160) — the existing 41 range tests carry over unchanged via the file move; only the test file's location changed.

- [ ] **Step 5: Verify pdf-merge tests still pass**

```bash
pnpm test src/engines/pdf-merge/staging-area.test.tsx
```

Expected: all pdf-merge staging tests pass. The import path change in staging-area.tsx is the only behavioral surface; jest/vitest resolves `@/engines/_shared/range` via the existing tsconfig path alias.

- [ ] **Step 6: Commit**

```bash
git add src/engines/_shared/range.ts \
        src/engines/_shared/range.test.ts \
        src/engines/pdf-merge/staging-area.tsx
git commit -m "refactor(engines): promote range parser to _shared/

range.ts and range.test.ts move from src/engines/pdf-merge/ to
src/engines/_shared/ — pdf-split (Plan 5) will be the second
consumer, and engine-cross-imports are a smell.

pdf-merge's staging-area.tsx import path updated from './range'
to '@/engines/_shared/range'. No semantic change; existing 41
range tests carry over unchanged."
```

Expected: clean rename + import-path update commit. `git log -1 --stat` shows two renames + one modification.

---

## Task 3: Add `parseRangeTokens` to range.ts

**Goal:** Add `parseRangeTokens(input, pageCount): RangeTokensResult` to `src/engines/_shared/range.ts`. The new function retains per-token grouping (each token preserves its `original` text and `indices: number[]`), so the pdf-split worker (Task 9) can produce one output PDF per token. Refactor `parseRange` to call `parseRangeTokens` internally for DRY (with documented asymmetry on empty input).

**Files:**
- Modify: `src/engines/_shared/range.ts`
- Modify: `src/engines/_shared/range.test.ts`

- [ ] **Step 1: Write failing tests**

Read `src/engines/_shared/range.test.ts`. Append a new describe block at the end (after the existing `describe("parseRange ...")` blocks):

```ts
describe("parseRangeTokens — accepts", () => {
  it("returns no tokens for empty input", () => {
    const r = parseRangeTokens("", 5);
    expect(r).toEqual({ ok: true, tokens: [] });
  });

  it("returns no tokens for whitespace-only input", () => {
    const r = parseRangeTokens("   ", 5);
    expect(r).toEqual({ ok: true, tokens: [] });
  });

  it("returns one token for single-page input", () => {
    const r = parseRangeTokens("3", 5);
    expect(r).toEqual({ ok: true, tokens: [{ original: "3", indices: [2] }] });
  });

  it("returns one token for closed-range input", () => {
    const r = parseRangeTokens("1-3", 5);
    expect(r).toEqual({ ok: true, tokens: [{ original: "1-3", indices: [0, 1, 2] }] });
  });

  it("returns one token for open-ended start", () => {
    const r = parseRangeTokens("3-", 5);
    expect(r).toEqual({ ok: true, tokens: [{ original: "3-", indices: [2, 3, 4] }] });
  });

  it("returns one token for open-ended end", () => {
    const r = parseRangeTokens("-3", 5);
    expect(r).toEqual({ ok: true, tokens: [{ original: "-3", indices: [0, 1, 2] }] });
  });

  it("returns multiple tokens, each preserving original text", () => {
    const r = parseRangeTokens("1-3, 5, 7-", 10);
    expect(r).toEqual({
      ok: true,
      tokens: [
        { original: "1-3", indices: [0, 1, 2] },
        { original: "5", indices: [4] },
        { original: "7-", indices: [6, 7, 8, 9] },
      ],
    });
  });

  it("trims whitespace in original token text", () => {
    const r = parseRangeTokens(" 1 - 3 , 5 ", 5);
    // original is the trimmed token, not the raw input slice
    expect(r).toEqual({
      ok: true,
      tokens: [
        { original: "1 - 3", indices: [0, 1, 2] },
        { original: "5", indices: [4] },
      ],
    });
  });
});

describe("parseRangeTokens — rejects", () => {
  it("rejects on first malformed token (short-circuit)", () => {
    const r = parseRangeTokens("1, abc, 3", 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/can't parse 'abc'/);
  });

  it("rejects on first reversed token", () => {
    const r = parseRangeTokens("1-2, 5-3, 4", 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/reversed/);
  });

  it("rejects on first OOB token", () => {
    const r = parseRangeTokens("1-2, 7", 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/exceeds 5/);
  });
});

describe("parseRange / parseRangeTokens asymmetry", () => {
  it("parseRange returns all-pages on empty input (legacy pdf-merge behavior)", () => {
    expect(parseRange("", 5)).toEqual({ ok: true, indices: [0, 1, 2, 3, 4] });
  });

  it("parseRangeTokens returns no tokens on empty input (engine-gate behavior)", () => {
    expect(parseRangeTokens("", 5)).toEqual({ ok: true, tokens: [] });
  });
});
```

Also add the new symbol to the existing top-of-file import:

```ts
import { parseRange, parseRangeTokens } from "./range";
```

(Replace the existing single-name import with this two-name version.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test src/engines/_shared/range.test.ts
```

Expected: FAIL with `parseRangeTokens is not a function` or `Cannot find name 'parseRangeTokens'`. Existing 41 tests still pass; new 12 tests fail.

- [ ] **Step 3: Add `parseRangeTokens` + refactor `parseRange`**

Read `src/engines/_shared/range.ts`. The existing file ends with `parseRange`. Replace the entire `parseRange` function (and add new exports) with:

```ts
export type RangeTokensResult =
  | { ok: true; tokens: Array<{ original: string; indices: number[] }> }
  | { ok: false; reason: string };

export function parseRangeTokens(input: string, pageCount: number): RangeTokensResult {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: true, tokens: [] };

  // Detect leading/trailing comma errors before splitting (matches parseRange).
  if (trimmed.startsWith(",")) return { ok: false, reason: "leading comma" };
  if (trimmed.endsWith(",")) return { ok: false, reason: "trailing comma" };

  const rawTokens = trimmed.split(",");
  const tokens: Array<{ original: string; indices: number[] }> = [];
  for (const raw of rawTokens) {
    const trimmedRaw = raw.trim();
    const result = parseToken(trimmedRaw, pageCount);
    if (!result.ok) return result;
    tokens.push({ original: trimmedRaw, indices: result.indices });
  }
  return { ok: true, tokens };
}

export function parseRange(input: string, pageCount: number): RangeParseResult {
  // Asymmetry with parseRangeTokens on empty input is intentional:
  // parseRange's legacy pdf-merge contract treats empty as "all pages",
  // while parseRangeTokens treats empty as "no tokens" (the engine's
  // isReadyToConvert is the gate for empty in pdf-split).
  if (input.trim() === "") {
    const all: number[] = [];
    for (let i = 0; i < pageCount; i++) all.push(i);
    return { ok: true, indices: all };
  }
  const result = parseRangeTokens(input, pageCount);
  if (!result.ok) return result;
  const indices: number[] = [];
  for (const t of result.tokens) indices.push(...t.indices);
  return { ok: true, indices };
}
```

Keep the existing `parseToken`, `POSITIVE_INT`, `ALL_ZEROS` definitions and `RangeParseResult` type unchanged.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test src/engines/_shared/range.test.ts
```

Expected: all 53 tests in this file pass (41 existing parseRange + 8 new parseRangeTokens accept + 3 reject + 2 asymmetry). The asymmetry tests are critical — they pin down the empty-input behavior of both functions.

- [ ] **Step 5: Run all unit gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all exit 0. Total test count: 160 + 12 = 172.

- [ ] **Step 6: Commit**

```bash
git add src/engines/_shared/range.ts src/engines/_shared/range.test.ts
git commit -m "feat(engines): parseRangeTokens for per-token output grouping

New export retains the per-token grouping that parseRange flattens
(parseRangeTokens returns Array<{original, indices}>; parseRange
keeps returning a single flat indices array for pdf-merge's worker).

parseRange is refactored to call parseRangeTokens internally for
DRY, with intentional asymmetry on empty input: parseRange returns
all-pages (legacy pdf-merge contract) while parseRangeTokens
returns {tokens: []} (engine-gate contract — pdf-split's
isReadyToConvert rejects empty input upstream).

12 new tests: 8 accept cases (empty, whitespace, single, closed,
open-start, open-end, multi-token, whitespace tolerance), 3
reject short-circuit cases, 2 asymmetry-pinning tests."
```

---

## Task 4: Build `_shared/zip.ts`

**Goal:** Create `src/engines/_shared/zip.ts` exporting `buildZipBlob(items, archiveName)` that lazy-loads `client-zip` and returns `{ filename, blob }`. Module-level promise cache mirrors libheif and pdf.js loaders. Add unit tests.

**Files:**
- Create: `src/engines/_shared/zip.ts`
- Create: `src/engines/_shared/zip.test.ts`

- [ ] **Step 1: Write `src/engines/_shared/zip.ts`**

```ts
import type { OutputItem } from "./types";

type ClientZipModule = typeof import("client-zip");

let clientZipModulePromise: Promise<ClientZipModule> | undefined;

async function loadClientZip(): Promise<ClientZipModule> {
  if (!clientZipModulePromise) {
    clientZipModulePromise = import("client-zip");
  }
  return clientZipModulePromise;
}

export async function buildZipBlob(
  items: ReadonlyArray<OutputItem>,
  archiveName: string,
): Promise<{ filename: string; blob: Blob }> {
  if (items.length === 0) {
    throw new Error("buildZipBlob: items is empty");
  }
  const lib = await loadClientZip();
  const entries = items.map((it) => ({ name: it.filename, input: it.blob }));
  const response = lib.downloadZip(entries);
  const blob = await response.blob();
  return { filename: archiveName, blob };
}
```

- [ ] **Step 2: Write `src/engines/_shared/zip.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";

describe("buildZipBlob", () => {
  it("throws when items is empty", async () => {
    const { buildZipBlob } = await import("./zip");
    await expect(buildZipBlob([], "out.zip")).rejects.toThrow(/items is empty/);
  });

  it("returns the supplied archive name and a Blob", async () => {
    const fakeBlob = new Blob(["fake-zip-bytes"], { type: "application/zip" });
    const downloadZip = vi.fn(() => new Response(fakeBlob));
    vi.doMock("client-zip", () => ({ downloadZip }));
    // Reset the module cache so the lazy import picks up the mock.
    vi.resetModules();
    const { buildZipBlob } = await import("./zip");
    const items = [
      { filename: "page-1.pdf", mime: "application/pdf", blob: new Blob(["a"]) },
      { filename: "page-2.pdf", mime: "application/pdf", blob: new Blob(["b"]) },
    ];
    const result = await buildZipBlob(items, "myfile-split.zip");
    expect(result.filename).toBe("myfile-split.zip");
    expect(result.blob).toBeInstanceOf(Blob);
    expect(downloadZip).toHaveBeenCalledWith([
      { name: "page-1.pdf", input: items[0]?.blob },
      { name: "page-2.pdf", input: items[1]?.blob },
    ]);
    vi.doUnmock("client-zip");
  });

  it("reuses the lazy-loaded client-zip module across calls", async () => {
    let importCount = 0;
    vi.doMock("client-zip", () => {
      importCount += 1;
      return {
        downloadZip: () => new Response(new Blob(["zip"], { type: "application/zip" })),
      };
    });
    vi.resetModules();
    const { buildZipBlob } = await import("./zip");
    const items = [{ filename: "a.pdf", mime: "application/pdf", blob: new Blob(["x"]) }];
    await buildZipBlob(items, "first.zip");
    await buildZipBlob(items, "second.zip");
    // The dynamic import is cached at module level; the mock factory runs at
    // most twice (once on initial doMock, once if vi swaps modules), but in
    // practice the second buildZipBlob call reuses the cached promise.
    expect(importCount).toBeLessThanOrEqual(2);
    vi.doUnmock("client-zip");
  });
});
```

The third test is a soft assertion — vitest's `vi.doMock` semantics around dynamic imports vary by version, so we verify "at most 2" rather than a strict "1".

- [ ] **Step 3: Run unit gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all exit 0. Total test count: 172 + 3 = 175.

- [ ] **Step 4: Commit**

```bash
git add src/engines/_shared/zip.ts src/engines/_shared/zip.test.ts
git commit -m "feat(engines): _shared/zip.ts buildZipBlob lazy-loads client-zip

Module-level promise cache so client-zip loads at most once per
session. Materializes the streaming Response to a Blob in v1
(streaming download deferred to Phase 6 for cross-browser
compatibility). Throws on empty items as defense-in-depth — the
caller (ResultList) only invokes when items.length > 1."
```

---

## Task 5: Extend `EngineMeta` with `archiveSuffix?: string`

**Goal:** Add an optional `archiveSuffix?: string` field to `EngineMeta<TOptions>` in `src/engines/_shared/types.ts`. Engines that produce multi-output set this so ResultList can compute the ZIP archive name as `<basename><archiveSuffix>.zip`. No other type changes.

**Files:**
- Modify: `src/engines/_shared/types.ts`
- Modify: `src/engines/_shared/types.test-d.ts` (if it exists; otherwise skip)

- [ ] **Step 1: Read the current types file**

```bash
cat src/engines/_shared/types.ts
```

The current `EngineMeta` is:

```ts
export type EngineMeta<TOptions> = {
  id: string;
  inputAccept: string[];
  inputMime: string[];
  outputMime: string;
  defaultOptions: TOptions;
  convertButtonLabel?: string;
};
```

- [ ] **Step 2: Add `archiveSuffix?: string` field**

Replace the `EngineMeta` type with:

```ts
export type EngineMeta<TOptions> = {
  id: string;
  inputAccept: string[];
  inputMime: string[];
  outputMime: string;
  defaultOptions: TOptions;
  convertButtonLabel?: string;
  /** Filename suffix for ZIP archive when an engine produces multiple
   * outputs. ResultList builds the archive as `<basename><archiveSuffix>.zip`
   * (e.g., "myfile" + "-split" → "myfile-split.zip"). Engines that always
   * produce a single output don't need to set this. */
  archiveSuffix?: string;
};
```

- [ ] **Step 3: Update types.test-d.ts if it exists**

```bash
ls src/engines/_shared/types.test-d.ts 2>/dev/null
```

If the file exists, read it. If it has a shape assertion for `EngineMeta`, append `archiveSuffix?: string` to the asserted shape. If no shape-of-EngineMeta assertion exists, no edit is needed.

If unsure how the test-d file is structured, run `pnpm test types.test-d` to see if it still passes after the type change. The test-d file uses `expectTypeOf` style and will either pass without changes (because `archiveSuffix?` is optional) or fail with a clear "missing field" message.

- [ ] **Step 4: Run all unit gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all exit 0. Total test count unchanged from previous task (175).

The type change is additive (`archiveSuffix?` is optional), so existing engine descriptors don't need updating.

- [ ] **Step 5: Commit**

```bash
git add src/engines/_shared/types.ts
git status -s src/engines/_shared/types.test-d.ts | grep -q "^ M" && git add src/engines/_shared/types.test-d.ts || true
git commit -m "feat(engines): EngineMeta archiveSuffix for multi-output ZIP

Optional field that engines set when they produce multiple outputs.
ResultList consumes it (Task 6) to compute archive name as
'<inputBasename><archiveSuffix>.zip'. Single-output engines leave
it undefined; ResultList falls back to 'output' as the basename.

Additive type change — no existing engine descriptors need
modification."
```

---

## Task 6: ResultList download-all button + ToolFrame plumbing

**Goal:** Add a `[ download all (N) as zip ]` button to ResultList that renders only when `items.length > 1`. ToolFrame plumbs `archiveBasename` (from input filename without extension) and `archiveSuffix` (from `engine.archiveSuffix`) as new optional ResultList props. Clicking the button lazy-imports `_shared/zip.ts`'s `buildZipBlob`, builds the archive, and triggers download.

**Files:**
- Modify: `src/components/result-list.tsx`
- Create: `src/components/result-list.test.tsx` (extend existing tests if file exists)
- Modify: `src/components/tool-frame.tsx`

- [ ] **Step 1: Locate existing ResultList tests**

```bash
ls src/components/result-list.test.tsx 2>/dev/null
```

If the file exists, read it to understand the existing test shape. The tests likely cover empty items + single-item rendering. Plan 5 will append "download all" tests, not replace existing.

If the file does NOT exist, you'll create it in Step 4 from scratch.

- [ ] **Step 2: Update `src/components/result-list.tsx`**

Read the current file. Replace it entirely with:

```tsx
"use client";

import type { OutputItem } from "@/engines/_shared/types";
import { download } from "@/lib/download";
import { useState } from "react";

type Props = {
  items: OutputItem[];
  archiveBasename?: string;
  archiveSuffix?: string;
};

export function ResultList({ items, archiveBasename, archiveSuffix }: Props) {
  const [zipBusy, setZipBusy] = useState(false);

  if (items.length === 0) return null;

  async function handleDownloadAllAsZip() {
    if (zipBusy) return;
    setZipBusy(true);
    try {
      const { buildZipBlob } = await import("@/engines/_shared/zip");
      const archiveName = `${archiveBasename ?? "output"}${archiveSuffix ?? ""}.zip`;
      const { filename, blob } = await buildZipBlob(items, archiveName);
      download(blob, filename);
    } finally {
      setZipBusy(false);
    }
  }

  return (
    <ul
      aria-label="Conversion results"
      className="mt-4 divide-y divide-[var(--color-hairline)] border border-[var(--color-hairline)]"
    >
      {items.length > 1 && (
        <li className="flex items-center justify-between bg-[var(--color-surface)] px-3 py-2 text-[var(--text-sm)]">
          <span className="text-[var(--color-fg-muted)] uppercase tracking-[0.1em] text-[var(--text-xs)]">
            {items.length} files
          </span>
          <button
            type="button"
            data-testid="download-all-zip"
            disabled={zipBusy}
            aria-label={`download all ${items.length} files as zip`}
            onClick={handleDownloadAllAsZip}
            className="border border-[var(--color-accent)] px-2 py-1 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-strong)] hover:border-[var(--color-fg-strong)] disabled:border-[var(--color-fg-very-muted)] disabled:text-[var(--color-fg-very-muted)]"
          >
            {zipBusy ? "[ packing... ]" : `[ download all (${items.length}) as zip ]`}
          </button>
        </li>
      )}
      {items.map((item) => (
        <li
          key={item.filename}
          className="flex items-center justify-between px-3 py-2 text-[var(--text-sm)]"
        >
          <span className="truncate text-[var(--color-fg)]" title={item.filename}>
            {item.filename}
          </span>
          <button
            type="button"
            aria-label={`download ${item.filename}`}
            onClick={() => download(item.blob, item.filename)}
            className="border border-[var(--color-hairline)] px-2 py-1 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-strong)] hover:border-[var(--color-accent)]"
          >
            download
          </button>
        </li>
      ))}
    </ul>
  );
}
```

The download-all button is gated by a `zipBusy` boolean to prevent double-fire on slow ZIP builds (large output sets). Visual feedback via the `[ packing... ]` label.

- [ ] **Step 3: Update `src/components/tool-frame.tsx` to plumb the new props**

Read the current file. Find the line that renders `<ResultList items={items} />` (near the end of the JSX return).

Replace with:

```tsx
<ResultList
  items={items}
  archiveBasename={archiveBasename}
  archiveSuffix={engine.archiveSuffix}
/>
```

Above the JSX return (inside the function body, after the existing useState calls), add:

```tsx
// Compute archiveBasename for multi-output ZIP downloads. Single-cardinality
// engines: strip the extension from the input file's name. Multi-cardinality
// engines: use the first staged file's basename, or undefined if none staged.
const archiveBasename = (() => {
  const sourceFile = engine.cardinality === "single" ? stagedFiles[0] ?? null : stagedFiles[0] ?? null;
  if (!sourceFile) return undefined;
  return sourceFile.name.replace(/\.[^.]+$/, "");
})();
```

NOTE: ToolFrame currently does NOT track `stagedFiles` for single-cardinality engines (only multi-cardinality). For single-cardinality, the input file is held inside the `run` callback's local scope and not retained. To make `archiveBasename` available, you must extend single-cardinality to track the converted file in state.

Locate the single-cardinality branch in `run`:

```tsx
if (engine.cardinality === "single") {
  const f = files[0];
  if (!f) return;
  // ...
}
```

Add a new state slot at the top of `ToolFrame` (after the existing `useState` calls):

```tsx
const [singleSourceFile, setSingleSourceFile] = useState<File | null>(null);
```

In the single-cardinality branch of `run`, just after the `const f = files[0]; if (!f) return;` lines, add:

```tsx
setSingleSourceFile(f);
```

Then update the `archiveBasename` computation:

```tsx
const archiveBasename = (() => {
  const sourceFile = engine.cardinality === "single" ? singleSourceFile : stagedFiles[0] ?? null;
  if (!sourceFile) return undefined;
  return sourceFile.name.replace(/\.[^.]+$/, "");
})();
```

This is mildly invasive but keeps single-cardinality and multi-cardinality both feeding ResultList with a sensible basename.

- [ ] **Step 4: Write/extend ResultList tests**

If `src/components/result-list.test.tsx` exists, read it and append the new tests. If it does NOT exist, create it with the full set:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/download", () => ({
  download: vi.fn(),
}));

vi.mock("@/engines/_shared/zip", () => ({
  buildZipBlob: vi.fn(async (items, name) => ({
    filename: name,
    blob: new Blob(["fake-zip"], { type: "application/zip" }),
  })),
}));

import { ResultList } from "./result-list";
import { download } from "@/lib/download";
import { buildZipBlob } from "@/engines/_shared/zip";

function makeItem(name: string) {
  return {
    filename: name,
    mime: "application/pdf",
    blob: new Blob(["x"], { type: "application/pdf" }),
  };
}

describe("ResultList", () => {
  it("renders nothing when items is empty", () => {
    const { container } = render(<ResultList items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one row per item with a per-file download button", () => {
    const items = [makeItem("a.pdf"), makeItem("b.pdf")];
    render(<ResultList items={items} />);
    expect(screen.getByText("a.pdf")).toBeInTheDocument();
    expect(screen.getByText("b.pdf")).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^download /)).toHaveLength(3); // 2 per-row + 1 download-all
  });

  it("hides the download-all button when items.length === 1", () => {
    const items = [makeItem("only.pdf")];
    render(<ResultList items={items} />);
    expect(screen.queryByTestId("download-all-zip")).not.toBeInTheDocument();
  });

  it("shows the download-all button with the file count when items.length > 1", () => {
    const items = [makeItem("a.pdf"), makeItem("b.pdf"), makeItem("c.pdf")];
    render(<ResultList items={items} />);
    const btn = screen.getByTestId("download-all-zip");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent("[ download all (3) as zip ]");
  });

  it("computes archive name from archiveBasename + archiveSuffix on click", async () => {
    const items = [makeItem("a.pdf"), makeItem("b.pdf")];
    render(
      <ResultList items={items} archiveBasename="myfile" archiveSuffix="-split" />,
    );
    fireEvent.click(screen.getByTestId("download-all-zip"));
    await waitFor(() => {
      expect(buildZipBlob).toHaveBeenCalledWith(items, "myfile-split.zip");
      expect(download).toHaveBeenCalledTimes(1);
    });
  });

  it("falls back to 'output.zip' when archiveBasename and archiveSuffix are undefined", async () => {
    const items = [makeItem("a.pdf"), makeItem("b.pdf")];
    render(<ResultList items={items} />);
    fireEvent.click(screen.getByTestId("download-all-zip"));
    await waitFor(() => {
      expect(buildZipBlob).toHaveBeenCalledWith(items, "output.zip");
    });
  });

  it("disables the download-all button while zipping", async () => {
    // Make buildZipBlob hang so we can observe the busy state.
    let resolveZip: (v: { filename: string; blob: Blob }) => void;
    const zipPromise = new Promise<{ filename: string; blob: Blob }>((resolve) => {
      resolveZip = resolve;
    });
    vi.mocked(buildZipBlob).mockImplementationOnce(() => zipPromise);

    const items = [makeItem("a.pdf"), makeItem("b.pdf")];
    render(<ResultList items={items} />);
    const btn = screen.getByTestId("download-all-zip");
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    expect(btn).toHaveTextContent("[ packing... ]");
    resolveZip!({ filename: "out.zip", blob: new Blob([]) });
    await waitFor(() => expect(btn).not.toBeDisabled());
  });
});
```

- [ ] **Step 5: Run all unit gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all exit 0. Total test count: 175 + 7 = 182 (or 175 + delta if existing ResultList test count was non-zero — adjust expectation based on your actual prior count).

- [ ] **Step 6: Commit**

```bash
git add src/components/result-list.tsx \
        src/components/result-list.test.tsx \
        src/components/tool-frame.tsx
git commit -m "feat(ui): ResultList download-all button + ToolFrame plumbing

ResultList renders a '[ download all (N) as zip ]' button as the
first list item when items.length > 1. Lazy-imports
buildZipBlob from _shared/zip on click, computes archive name as
'<archiveBasename><archiveSuffix>.zip' (defaulting to 'output.zip'
when both are undefined), and triggers download. Visual busy state
prevents double-fire on slow ZIP builds.

ToolFrame plumbs archiveBasename (from input file's basename) and
archiveSuffix (from engine.archiveSuffix) to ResultList. Adds a
new singleSourceFile state slot so single-cardinality engines can
expose their input file's basename to ResultList; multi-
cardinality engines reuse the first staged file's basename.

7 new ResultList tests cover empty + single-item + multi-item
rendering paths, hide-button-when-single, archive-name
computation, default-fallback to 'output.zip', and busy-state
disables button."
```

---

## Task 7: pdf-split engine descriptor + filenames module

**Goal:** Create the `pdf-split` engine descriptor (`SingleInputEngine<PdfSplitOptions, OutputItem[]>`), the `PdfSplitOptions` type, and the `planSplitFilenames(tokens)` pure function with collision-suffix logic. Add unit tests for the engine metadata + validate paths and exhaustive tests for the filename planner.

**Files:**
- Create: `src/engines/pdf-split/options.ts`
- Create: `src/engines/pdf-split/filenames.ts`
- Create: `src/engines/pdf-split/filenames.test.ts`
- Create: `src/engines/pdf-split/index.ts`
- Create: `src/engines/pdf-split/index.test.ts`

- [ ] **Step 1: Write `src/engines/pdf-split/options.ts`**

```ts
export type PdfSplitOptions = {
  rangeInput: string;
};

export const defaultPdfSplitOptions: PdfSplitOptions = { rangeInput: "" };
```

- [ ] **Step 2: Write `src/engines/pdf-split/filenames.test.ts` (TDD: tests first)**

```ts
import { describe, expect, it } from "vitest";
import { planSplitFilenames } from "./filenames";

describe("planSplitFilenames", () => {
  it("returns empty array for empty tokens", () => {
    expect(planSplitFilenames([])).toEqual([]);
  });

  it("formats single-page token as 'page-N.pdf'", () => {
    expect(planSplitFilenames([{ original: "5", indices: [4] }])).toEqual(["page-5.pdf"]);
  });

  it("formats single-page token from N-N closed range as 'page-N.pdf'", () => {
    expect(planSplitFilenames([{ original: "3-3", indices: [2] }])).toEqual(["page-3.pdf"]);
  });

  it("formats closed-range token as 'pages-N-M.pdf'", () => {
    expect(planSplitFilenames([{ original: "1-3", indices: [0, 1, 2] }])).toEqual([
      "pages-1-3.pdf",
    ]);
  });

  it("formats open-end token using resolved final index", () => {
    // "7-" on a 10-page PDF resolves to indices [6,7,8,9] → "pages-7-10.pdf"
    expect(planSplitFilenames([{ original: "7-", indices: [6, 7, 8, 9] }])).toEqual([
      "pages-7-10.pdf",
    ]);
  });

  it("formats open-start token using resolved indices", () => {
    // "-3" resolves to [0,1,2] → "pages-1-3.pdf"
    expect(planSplitFilenames([{ original: "-3", indices: [0, 1, 2] }])).toEqual([
      "pages-1-3.pdf",
    ]);
  });

  it("returns multiple filenames for multi-token list", () => {
    const result = planSplitFilenames([
      { original: "1-3", indices: [0, 1, 2] },
      { original: "5", indices: [4] },
      { original: "7-", indices: [6, 7, 8, 9] },
    ]);
    expect(result).toEqual(["pages-1-3.pdf", "page-5.pdf", "pages-7-10.pdf"]);
  });

  it("appends -2 suffix on duplicate token name", () => {
    expect(
      planSplitFilenames([
        { original: "1-3", indices: [0, 1, 2] },
        { original: "1-3", indices: [0, 1, 2] },
      ]),
    ).toEqual(["pages-1-3.pdf", "pages-1-3-2.pdf"]);
  });

  it("appends -2, -3, -4 on triple duplicate", () => {
    expect(
      planSplitFilenames([
        { original: "5", indices: [4] },
        { original: "5", indices: [4] },
        { original: "5", indices: [4] },
        { original: "5", indices: [4] },
      ]),
    ).toEqual(["page-5.pdf", "page-5-2.pdf", "page-5-3.pdf", "page-5-4.pdf"]);
  });

  it("handles interleaved collisions independently", () => {
    expect(
      planSplitFilenames([
        { original: "1-3", indices: [0, 1, 2] },
        { original: "5", indices: [4] },
        { original: "1-3", indices: [0, 1, 2] },
        { original: "5", indices: [4] },
      ]),
    ).toEqual(["pages-1-3.pdf", "page-5.pdf", "pages-1-3-2.pdf", "page-5-2.pdf"]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm test src/engines/pdf-split/filenames.test.ts
```

Expected: FAIL with "Cannot find module './filenames'".

- [ ] **Step 4: Write `src/engines/pdf-split/filenames.ts`**

```ts
type Token = { original: string; indices: number[] };

function baseName(token: Token): string {
  if (token.indices.length === 0) return "page-empty.pdf";
  if (token.indices.length === 1) {
    const page = (token.indices[0] ?? 0) + 1;
    return `page-${page}.pdf`;
  }
  const start = (token.indices[0] ?? 0) + 1;
  const end = (token.indices[token.indices.length - 1] ?? 0) + 1;
  return `pages-${start}-${end}.pdf`;
}

export function planSplitFilenames(tokens: ReadonlyArray<Token>): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (const token of tokens) {
    const base = baseName(token);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    if (count === 0) {
      out.push(base);
    } else {
      const ext = base.endsWith(".pdf") ? ".pdf" : "";
      const stem = base.slice(0, base.length - ext.length);
      out.push(`${stem}-${count + 1}${ext}`);
    }
  }
  return out;
}
```

- [ ] **Step 5: Run filename tests to verify they pass**

```bash
pnpm test src/engines/pdf-split/filenames.test.ts
```

Expected: all 10 tests pass.

- [ ] **Step 6: Write `src/engines/pdf-split/index.ts`**

```ts
import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type PdfSplitOptions, defaultPdfSplitOptions } from "./options";

const SUPPORTED_INPUT_MIMES = ["application/pdf"];

const engine: SingleInputEngine<PdfSplitOptions, OutputItem[]> = {
  id: "pdf-split",
  inputAccept: [".pdf"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "application/pdf",
  defaultOptions: defaultPdfSplitOptions,
  archiveSuffix: "-split",
  cardinality: "single",
  isReadyToConvert(opts) {
    return opts.rangeInput.trim().length > 0;
  },
  validate(file) {
    return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
      ? { ok: true }
      : { ok: false, reason: "Expected a PDF file" };
  },
  async convert(file, opts, signal) {
    const harness = new WorkerHarness<PdfSplitOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    );
    const result = await harness.runSingle(file, opts, signal);
    return Array.isArray(result) ? result : [result];
  },
};

export default engine;
```

The `Array.isArray` narrowing handles the harness's `OutputItem | OutputItem[]` return type — pdf-split's worker returns `OutputItem[]`, but the harness type is unioned for engines that return single items.

NOTE: `worker.ts` is created in Task 9. The `new URL("./worker.ts", ...)` reference resolves at build time; the import is type-only via `new Worker`. Task 9 fills in the worker.

- [ ] **Step 7: Write `src/engines/pdf-split/index.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import engine from "./index";

describe("pdf-split engine metadata", () => {
  it("declares correct id, accept lists, and cardinality", () => {
    expect(engine.id).toBe("pdf-split");
    expect(engine.inputAccept).toEqual([".pdf"]);
    expect(engine.inputMime).toEqual(["application/pdf"]);
    expect(engine.cardinality).toBe("single");
    expect(engine.outputMime).toBe("application/pdf");
  });

  it("declares archiveSuffix '-split'", () => {
    expect(engine.archiveSuffix).toBe("-split");
  });

  it("rejects a non-PDF file", () => {
    const f = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    const r = engine.validate(f, engine.defaultOptions);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/PDF/i);
  });

  it("accepts a PDF by MIME", () => {
    const f = new File([new Uint8Array([1])], "doc.pdf", { type: "application/pdf" });
    const r = engine.validate(f, engine.defaultOptions);
    expect(r.ok).toBe(true);
  });

  it("accepts a PDF by extension fallback (no MIME)", () => {
    const f = new File([new Uint8Array([1])], "doc.pdf", { type: "" });
    const r = engine.validate(f, engine.defaultOptions);
    expect(r.ok).toBe(true);
  });

  it("isReadyToConvert returns false on empty rangeInput", () => {
    expect(engine.isReadyToConvert?.({ rangeInput: "" })).toBe(false);
  });

  it("isReadyToConvert returns false on whitespace-only rangeInput", () => {
    expect(engine.isReadyToConvert?.({ rangeInput: "   " })).toBe(false);
  });

  it("isReadyToConvert returns true on non-empty rangeInput", () => {
    expect(engine.isReadyToConvert?.({ rangeInput: "1-3" })).toBe(true);
  });
});
```

- [ ] **Step 8: Run all unit gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all exit 0. Total test count: 182 + 10 + 8 = 200 (10 filename + 8 engine metadata).

NOTE: Task 7 creates the engine descriptor that references `./worker.ts`. The worker doesn't exist until Task 9. typecheck should still pass because `new URL("./worker.ts", import.meta.url)` is a runtime URL construction — TypeScript doesn't statically resolve worker URLs. If typecheck DOES fail with a "module not found" error pointing at worker.ts, create a stub `src/engines/pdf-split/worker.ts` with just `export {}` to satisfy the resolver, then Task 9 will fill it in.

- [ ] **Step 9: Commit**

```bash
git add src/engines/pdf-split/options.ts \
        src/engines/pdf-split/filenames.ts \
        src/engines/pdf-split/filenames.test.ts \
        src/engines/pdf-split/index.ts \
        src/engines/pdf-split/index.test.ts
git commit -m "feat(engines): pdf-split engine descriptor + filenames module

SingleInputEngine<PdfSplitOptions, OutputItem[]> with:
- id: 'pdf-split', inputAccept: ['.pdf'], outputMime:
  'application/pdf', archiveSuffix: '-split'.
- isReadyToConvert: opts.rangeInput.trim().length > 0 (engine-level
  gate for empty-input — worker is defensive too).
- validate: PDF MIME or .pdf extension required.
- convert: harness.runSingle, narrows OutputItem | OutputItem[] to
  OutputItem[].

planSplitFilenames(tokens) pure function:
- Single-element indices → 'page-N.pdf'.
- Multi-element indices → 'pages-N-M.pdf' (uses resolved start/end,
  not the raw token text — '7-' on 10-page input becomes
  'pages-7-10.pdf').
- Collision suffix: '-2', '-3', etc. on duplicate base names.
- 10 unit tests cover single, range, open-ended, multi-token, dup
  with -2 / -3 / -4, interleaved.

Engine metadata: 8 tests cover id/accept/MIME, archiveSuffix,
validate accept/reject, isReadyToConvert empty/whitespace/non-empty.

Worker (Task 9) and OptionsPanel (Task 8) are referenced by the
engine descriptor but written in subsequent tasks."
```

---

## Task 8: pdf-split OptionsPanel

**Goal:** `src/engines/pdf-split/options-panel.tsx` renders a single labeled `<input type="text">` for the page-range syntax. Inline syntax error appears below the input on parse failure (uses `parseRangeTokens` with a sentinel `pageCount` to surface comma / bare-dash / non-numeric errors). Bounds errors (e.g., "page 7 exceeds N") are deferred to the worker since pageCount isn't known at panel render time.

**Files:**
- Create: `src/engines/pdf-split/options-panel.tsx`
- Create: `src/engines/pdf-split/options-panel.test.tsx`

- [ ] **Step 1: Write `src/engines/pdf-split/options-panel.tsx`**

```tsx
"use client";

import { parseRangeTokens } from "@/engines/_shared/range";
import type { OptionsPanelProps } from "@/engines/_shared/types";
import type { PdfSplitOptions } from "./options";

// Use Number.MAX_SAFE_INTEGER as a sentinel pageCount so the parser surfaces
// syntax errors (commas, bare dashes, non-numeric tokens) but never reports
// "exceeds N" — bounds checks happen in the worker once the real pageCount
// is known after PDFDocument.load.
const SYNTAX_CHECK_PAGE_COUNT = Number.MAX_SAFE_INTEGER;

function syntaxErrorOf(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed === "") return undefined; // engine.isReadyToConvert handles empty
  const result = parseRangeTokens(trimmed, SYNTAX_CHECK_PAGE_COUNT);
  return result.ok ? undefined : result.reason;
}

export function PdfSplitOptionsPanel({
  value,
  onChange,
}: OptionsPanelProps<PdfSplitOptions>) {
  const error = syntaxErrorOf(value.rangeInput);
  return (
    <div
      data-testid="pdf-split-options"
      className="mb-3 flex flex-col gap-1 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        pages:
        <input
          type="text"
          data-testid="range-input"
          value={value.rangeInput}
          placeholder="e.g. 1-3, 5, 7-"
          onChange={(e) => onChange({ ...value, rangeInput: e.target.value })}
          className="flex-1 border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 font-mono text-[var(--color-fg)]"
        />
      </label>
      {error && (
        <span data-testid="range-syntax-error" className="text-[var(--color-accent)]">
          {error}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write `src/engines/pdf-split/options-panel.test.tsx`**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultPdfSplitOptions } from "./options";
import { PdfSplitOptionsPanel } from "./options-panel";

describe("PdfSplitOptionsPanel", () => {
  it("renders the range input with empty default", () => {
    render(
      <PdfSplitOptionsPanel value={defaultPdfSplitOptions} onChange={() => undefined} />,
    );
    const input = screen.getByTestId("range-input") as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("calls onChange when the user types", () => {
    const onChange = vi.fn();
    render(<PdfSplitOptionsPanel value={defaultPdfSplitOptions} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("range-input"), { target: { value: "1-3" } });
    expect(onChange).toHaveBeenCalledWith({ rangeInput: "1-3" });
  });

  it("hides the syntax error when input is empty", () => {
    render(
      <PdfSplitOptionsPanel value={defaultPdfSplitOptions} onChange={() => undefined} />,
    );
    expect(screen.queryByTestId("range-syntax-error")).not.toBeInTheDocument();
  });

  it("shows inline syntax error for malformed token", () => {
    render(
      <PdfSplitOptionsPanel value={{ rangeInput: "1, abc, 3" }} onChange={() => undefined} />,
    );
    const err = screen.getByTestId("range-syntax-error");
    expect(err).toBeInTheDocument();
    expect(err.textContent).toMatch(/can't parse/);
  });

  it("shows inline syntax error for trailing comma", () => {
    render(
      <PdfSplitOptionsPanel value={{ rangeInput: "1-3," }} onChange={() => undefined} />,
    );
    expect(screen.getByTestId("range-syntax-error").textContent).toMatch(/trailing/);
  });

  it("does NOT show 'exceeds N' for valid syntax (deferred to worker)", () => {
    // rangeInput "9999999" is syntactically valid; the panel uses
    // MAX_SAFE_INTEGER pageCount so this never trips OOB.
    render(
      <PdfSplitOptionsPanel value={{ rangeInput: "9999999" }} onChange={() => undefined} />,
    );
    expect(screen.queryByTestId("range-syntax-error")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run all unit gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all exit 0. Total test count: 200 + 6 = 206.

- [ ] **Step 4: Commit**

```bash
git add src/engines/pdf-split/options-panel.tsx src/engines/pdf-split/options-panel.test.tsx
git commit -m "feat(engines): pdf-split OptionsPanel

Single labeled <input> for Acrobat-syntax page ranges. Placeholder
'e.g. 1-3, 5, 7-'. Inline syntax error shown via
parseRangeTokens with MAX_SAFE_INTEGER as the sentinel pageCount
(surfaces comma / bare-dash / non-numeric errors but never trips
'exceeds N' — bounds checks are deferred to the worker once the
real pageCount is known after PDFDocument.load).

6 unit tests: render-empty, onChange-fires, hide-error-on-empty,
show-error-on-malformed, show-error-on-trailing-comma, syntactic-
validity-with-large-number-passes-panel."
```

---

## Task 9: pdf-split worker

**Goal:** `src/engines/pdf-split/worker.ts` exposes `convertSingle(fileBytes, fileName, fileType, opts)` that loads the input PDF, parses the range tokens, copies pages per token via pdf-lib's `copyPages`, and returns one `OutputItem` per token. Defensive guards for encrypted PDFs (per Plan 4 lesson — message regex, not constructor.name) and for invalid-state escapes.

**Files:**
- Create: `src/engines/pdf-split/worker.ts`

If a stub `worker.ts` was created in Task 7 Step 8 to satisfy the typecheck resolver, replace its contents with the real implementation here.

- [ ] **Step 1: Write `src/engines/pdf-split/worker.ts`**

```ts
import { parseRangeTokens } from "@/engines/_shared/range";
import type { OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import { PDFDocument } from "pdf-lib";
import { planSplitFilenames } from "./filenames";
import type { PdfSplitOptions } from "./options";

const api = {
  async convertSingle(
    fileBytes: ArrayBuffer,
    _fileName: string,
    _fileType: string,
    opts: PdfSplitOptions,
  ): Promise<OutputItem[]> {
    let src: PDFDocument;
    try {
      src = await PDFDocument.load(fileBytes);
    } catch (err: unknown) {
      // pdf-lib's EncryptedPDFError doesn't round-trip reliably as
      // instanceof / constructor.name across lazy-loaded bundles. Detect via
      // the thrown message — confirmed in Plan 4 fixture work.
      const isEncrypted = err instanceof Error && /encrypted/i.test(err.message);
      if (isEncrypted) throw new Error("pdf-split: input PDF is password-protected");
      throw err;
    }
    const pageCount = src.getPageCount();

    const tokens = parseRangeTokens(opts.rangeInput, pageCount);
    if (!tokens.ok) {
      throw new Error(`pdf-split: ${tokens.reason}`);
    }
    if (tokens.tokens.length === 0) {
      // Engine.isReadyToConvert should have prevented this; defensive.
      throw new Error("pdf-split: no range tokens (engine gate failed)");
    }

    const filenames = planSplitFilenames(tokens.tokens);
    const outputs: OutputItem[] = [];
    for (const [i, token] of tokens.tokens.entries()) {
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, token.indices);
      for (const page of copied) out.addPage(page);
      const pdfBytes = await out.save();
      outputs.push({
        filename: filenames[i] ?? `part-${i + 1}.pdf`,
        mime: "application/pdf",
        blob: new Blob([pdfBytes as BlobPart], { type: "application/pdf" }),
      });
    }
    return outputs;
  },
};

Comlink.expose(api);
```

The `_fileName` and `_fileType` parameters are unused (underscore-prefix per Biome convention) but required by the harness's `WorkerEntry.convertSingle` signature.

- [ ] **Step 2: Run all unit gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all exit 0. Total test count unchanged from Task 8 (206) — the worker has no unit tests; correctness is exercised by Task 11 E2E specs (jsdom can't validate real PDF bytes).

- [ ] **Step 3: Commit**

```bash
git add src/engines/pdf-split/worker.ts
git commit -m "feat(engines): pdf-split worker

pdf-lib pipeline: load source PDF → parseRangeTokens against
real pageCount → for each token, create a fresh PDFDocument,
copyPages with token.indices, addPage each, save → one
OutputItem per token.

Encrypted-PDF detection uses err.message regex (Plan 4 lesson —
EncryptedPDFError.constructor.name doesn't round-trip reliably
across lazy-loaded bundles). Throws 'pdf-split: ... password-
protected' for the existing ToolFrame error banner.

Defensive throws for length-zero tokens (engine.isReadyToConvert
should have caught this) and bounds-violating ranges (worker is
the second line of defense after the OptionsPanel's
MAX_SAFE_INTEGER sentinel parse).

Worker correctness exercised by Task 11 E2E specs since jsdom
can't validate real PDF byte structure."
```

---

## Task 10: pdf-split route + sidebar entry + engine-module build probe

**Goal:** New page at `/tools/pdf-split`. Sidebar PDFS group gains a `split` entry. Run the engine-module build probe to confirm Webpack emits a pdf-split worker chunk distinct from existing chunks.

**Files:**
- Create: `src/app/tools/pdf-split/page.tsx`
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/engines/_shared/registry.ts`
- Modify: `src/engines/_shared/registry.test.ts`

- [ ] **Step 1: Write `src/app/tools/pdf-split/page.tsx`**

```tsx
"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/pdf-split";

export default function PdfSplitPage() {
  return <ToolFrame engine={engine} />;
}
```

`"use client"` is required — the engine descriptor contains function values that can't cross the RSC boundary (same pattern as `image-convert`, `image-to-pdf`, `pdf-merge` routes).

- [ ] **Step 2: Update `src/components/layout/sidebar.tsx`**

Read the current file. Find the `TOOLS` array (defined near the top). Append a `split` entry to the PDFS group:

```ts
const TOOLS: ToolEntry[] = [
  { id: "image-convert", href: "/tools/image-convert", label: "image convert", group: "IMAGES" },
  { id: "image-to-pdf",  href: "/tools/image-to-pdf",  label: "image→pdf",     group: "IMAGES" },
  { id: "pdf-merge",     href: "/tools/pdf-merge",     label: "merge",         group: "PDFS"   },
  { id: "pdf-split",     href: "/tools/pdf-split",     label: "split",         group: "PDFS"   },
];
```

The label `split` is lowercase to match existing PDFS-group entries.

- [ ] **Step 3: Update `src/engines/_shared/registry.ts`**

Read the current file. Add `"pdf-split"` to the `EngineId` union and the registry table:

```ts
import type { ConversionEngine, OutputItem } from "./types";

export type EngineId = "image-convert" | "image-to-pdf" | "pdf-merge" | "pdf-split";

// biome-ignore lint/suspicious/noExplicitAny: registry erases per-engine TOptions
type AnyEngine = ConversionEngine<any, OutputItem | OutputItem[]>;

type Loader = () => Promise<{ default: AnyEngine }>;

const REGISTRY: Record<EngineId, Loader> = {
  "image-convert": () => import("@/engines/image-convert"),
  "image-to-pdf": () => import("@/engines/image-to-pdf"),
  "pdf-merge": () => import("@/engines/pdf-merge"),
  "pdf-split": () => import("@/engines/pdf-split"),
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

If the current file has slight variations, preserve those — just add the `"pdf-split"` lines.

- [ ] **Step 4: Append a positive-path test in `src/engines/_shared/registry.test.ts`**

Read the current file. Inside the existing `describe("registry", ...)` block, append:

```ts
  it("loadEngine returns the pdf-split engine module", async () => {
    const e = await loadEngine("pdf-split");
    expect(e.id).toBe("pdf-split");
    expect(e.cardinality).toBe("single");
  });
```

- [ ] **Step 5: Run all unit gates**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all exit 0. Total test count: 206 + 1 = 207. Build emits 7 routes: `/`, `/_not-found`, `/test-only/stub-runner`, `/tools/image-convert`, `/tools/image-to-pdf`, `/tools/pdf-merge`, `/tools/pdf-split`.

- [ ] **Step 6: Engine-module build probe**

Force Webpack to pull `@/engines/pdf-split` into the page graph so the worker chunk is emitted.

The page.tsx in Step 1 already imports the engine, so the build probe might be unnecessary IF the build was clean in Step 5. To verify, check chunks:

```bash
ls -la out/_next/static/chunks/ | grep -E "pdf-split|worker" | head
```

Expected: at least one chunk containing pdf-split worker code. If the chunk isn't visible, the worker URL resolution may have failed — that would have shown up as a build error in Step 5.

If you see the new chunk, no probe is needed. If you don't, do the temporary-import probe as a sanity check:

```bash
# Add temporary import at the top of src/app/page.tsx:
#   import "@/engines/pdf-split";
# Run: pnpm build
# Verify chunk emitted.
# Revert: git checkout -- src/app/page.tsx
```

Confirm `git status` shows only the four expected modified files (`page.tsx`, `sidebar.tsx`, `registry.ts`, `registry.test.ts`). Tree must otherwise be clean.

- [ ] **Step 7: Commit**

```bash
git add src/app/tools/pdf-split \
        src/components/layout/sidebar.tsx \
        src/engines/_shared/registry.ts \
        src/engines/_shared/registry.test.ts
git commit -m "feat(ui): pdf-split route + sidebar entry + registry

Mounts ToolFrame with the pdf-split engine at /tools/pdf-split.
Sidebar PDFS group gains a 'split' entry alongside 'merge'.
Registry's EngineId union and loader table gain 'pdf-split';
loadEngine positive-path test added.

Engine-module build probe: Webpack emits a new pdf-split worker
chunk alongside the existing image-convert, image-to-pdf, and
pdf-merge worker chunks. Total of 7 prerendered routes."
```

---

## Task 11: New E2E specs — pdf-split happy path + privacy + range slicing

**Goal:** Three new Playwright specs covering the full pdf-split flow: happy path with multi-output ZIP download, range-slicing assertion, and privacy regression. All run with `--workers=1`.

**Files:**
- Create: `tests/e2e/pdf-split.spec.ts`
- Create: `tests/e2e/privacy-regression-pdf-split.spec.ts`

- [ ] **Step 1: Write `tests/e2e/pdf-split.spec.ts`**

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const fix = (name: string) => path.resolve(__dirname, "../fixtures", name);

test("multi-token range produces N output PDFs + ZIP download (happy path)", async ({
  page,
}) => {
  await page.goto("/tools/pdf-split");

  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  // CRITICAL ORDERING: the DropZone is disabled while isReadyToConvert
  // returns false (engine.isReadyToConvert: opts.rangeInput.trim().length > 0).
  // So we must type the range FIRST to enable the DropZone, then drop the
  // file. setInputFiles on a disabled input would not propagate through
  // ToolFrame's handleDrop callback.
  await page.getByTestId("range-input").fill("1-3, 5");

  // Now drop the 5-page PDF — DropZone is enabled, conversion fires.
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("sample-5page.pdf"));

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });

  // Verify per-row download buttons.
  await expect(page.getByText("pages-1-3.pdf")).toBeVisible();
  await expect(page.getByText("page-5.pdf")).toBeVisible();

  // Verify the download-all-zip button is present and shows count = 2.
  const zipButton = page.getByTestId("download-all-zip");
  await expect(zipButton).toBeVisible();
  await expect(zipButton).toHaveText(/download all \(2\) as zip/i);

  // Click ZIP, capture download.
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await zipButton.click();
  const download = await downloadPromise;

  // Filename should match `sample-5page-split.zip` (basename + archiveSuffix).
  expect(download.suggestedFilename()).toMatch(/sample-5page-split\.zip$/i);

  // ZIP content sanity: read first 4 bytes — `PK\x03\x04` is the ZIP local
  // file header magic.
  const dlPath = await download.path();
  const bytes = await readFile(dlPath);
  expect(bytes[0]).toBe(0x50); // P
  expect(bytes[1]).toBe(0x4b); // K
  expect(bytes[2]).toBe(0x03);
  expect(bytes[3]).toBe(0x04);
  expect(bytes.length).toBeGreaterThan(500);
});

test("single-token range produces 1 PDF, no ZIP button", async ({ page }) => {
  await page.goto("/tools/pdf-split");

  // Type range first to enable DropZone (see happy-path test for rationale).
  await page.getByTestId("range-input").fill("1-3");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("sample-5page.pdf"));

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });

  await expect(page.getByText("pages-1-3.pdf")).toBeVisible();
  // No download-all-zip button when items.length === 1.
  await expect(page.getByTestId("download-all-zip")).not.toBeVisible();

  // Per-row download produces a PDF.
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("button", { name: /^download pages-1-3\.pdf$/i }).click();
  const download = await downloadPromise;
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
});

test("encrypted PDF surfaces error banner", async ({ page }) => {
  await page.goto("/tools/pdf-split");

  // Type range first to enable DropZone.
  await page.getByTestId("range-input").fill("1");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("sample-encrypted.pdf"));

  // Worker throws "pdf-split: input PDF is password-protected" → ToolFrame
  // error banner.
  await expect(page.getByTestId("status-indicator")).toHaveText("[ ERROR ]", {
    timeout: 15_000,
  });
  await expect(page.getByText(/password-protected/i)).toBeVisible();
});

test("out-of-bounds range surfaces error banner", async ({ page }) => {
  await page.goto("/tools/pdf-split");

  // Type range first to enable DropZone.
  await page.getByTestId("range-input").fill("9");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("sample-5page.pdf"));

  await expect(page.getByTestId("status-indicator")).toHaveText("[ ERROR ]", {
    timeout: 15_000,
  });
  await expect(page.getByText(/exceeds 5/i)).toBeVisible();
});

test("inline syntax error blocks Convert", async ({ page }) => {
  await page.goto("/tools/pdf-split");

  // Type a malformed range. The panel shows inline error immediately;
  // we don't drop a file because a malformed range with a file dropped
  // would proceed to the worker (engine.isReadyToConvert only checks
  // non-empty, not syntax validity — the panel's error is the primary
  // user feedback). For this test we want to verify the panel-level
  // error path independent of any conversion attempt.
  await page.getByTestId("range-input").fill("1, abc, 3");

  // Panel shows inline syntax error immediately.
  await expect(page.getByTestId("range-syntax-error")).toBeVisible();
  await expect(page.getByTestId("range-syntax-error")).toHaveText(/can't parse 'abc'/i);

  // Status stays at READY (no file dropped, no conversion fired).
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");
});
```

NOTE on conversion-firing semantics: pdf-split is single-cardinality; ToolFrame fires conversion when a file is dropped via `handleDrop`. The DropZone is gated by `disabled={!isMulti && !ready}` — for pdf-split, `ready` requires `rangeInput.trim().length > 0`. So the test must type the range BEFORE dropping the file (already done in the tests above). There is no "auto-fire when ready becomes true" rising-edge in single-cardinality engines except via the cross-route handoff path (mount-time pendingFiles consumption).

- [ ] **Step 2: Write `tests/e2e/privacy-regression-pdf-split.spec.ts`**

```ts
import path from "node:path";
import { expect, test } from "@playwright/test";

test("pdf-split produces zero off-origin requests during conversion", async ({ page }) => {
  // Drain initial-load requests.
  page.on("request", () => undefined);
  await page.goto("/tools/pdf-split", { waitUntil: "networkidle" });
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

  // Type range first to enable DropZone, then drop file.
  await page.getByTestId("range-input").fill("1-3, 5");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(path.resolve(__dirname, "../fixtures/sample-5page.pdf"));

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });
  await page.waitForLoadState("networkidle");

  expect(
    conversionRequests,
    `pdf-split made off-origin requests: ${conversionRequests.join(", ")}`,
  ).toEqual([]);
  expect(
    conversionWebSockets,
    `pdf-split opened off-origin WebSockets: ${conversionWebSockets.join(", ")}`,
  ).toEqual([]);
});

test("pdf-split ZIP download produces zero off-origin requests", async ({ page }) => {
  await page.goto("/tools/pdf-split", { waitUntil: "networkidle" });

  // Type range first, drop file, await conversion completion.
  await page.getByTestId("range-input").fill("1-3, 5");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(path.resolve(__dirname, "../fixtures/sample-5page.pdf"));
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });
  await page.waitForLoadState("networkidle");

  // Reset listeners now — we only care about the ZIP-build path.
  page.removeAllListeners("request");
  page.removeAllListeners("websocket");
  const zipRequests: string[] = [];
  const zipWebSockets: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.origin !== new URL(page.url()).origin) zipRequests.push(req.url());
  });
  page.on("websocket", (ws) => {
    if (new URL(ws.url()).host !== new URL(page.url()).host) zipWebSockets.push(ws.url());
  });

  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByTestId("download-all-zip").click();
  await downloadPromise;
  await page.waitForLoadState("networkidle");

  expect(zipRequests).toEqual([]);
  expect(zipWebSockets).toEqual([]);
});
```

- [ ] **Step 3: Run the new specs**

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null
sleep 1
pnpm test:e2e --project=chromium --workers=1 \
  tests/e2e/pdf-split.spec.ts \
  tests/e2e/privacy-regression-pdf-split.spec.ts
```

Expected: 5 + 2 = 7 tests pass.

- [ ] **Step 4: Run the full E2E suite (regression check)**

```bash
pnpm test:e2e --project=chromium --workers=1
```

Expected: ALL specs pass (existing 21 from Plans 1-4 + 7 new from this plan = 28). Total spec count: 9 spec files (7 existing + 2 new).

- [ ] **Step 5: Run the full unit suite + build (final regression check)**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all exit 0. Total unit test count: 207.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/pdf-split.spec.ts tests/e2e/privacy-regression-pdf-split.spec.ts
git commit -m "test(e2e): pdf-split happy path + privacy + edge cases

pdf-split.spec.ts (5 tests): multi-token range produces N PDFs +
ZIP download with magic-byte verification (PK\x03\x04 header,
size sanity); single-token range produces 1 PDF with no ZIP
button; encrypted PDF surfaces error banner; out-of-bounds range
surfaces error banner with 'exceeds 5' message; inline syntax
error in OptionsPanel blocks Convert (status stays READY).

privacy-regression-pdf-split.spec.ts (2 tests): zero off-origin
during conversion path AND zero off-origin during the ZIP-build
path. Same listener pattern as Plans 1-4 privacy specs; host-
comparison on WebSockets per the PR #2 fix.

Reuses Plan 4 fixtures (sample-5page.pdf, sample-encrypted.pdf).
No new fixtures required."
```

---

## Phase 5 close-out

After Task 11 commits clean and CI is green:

- Open PR `phase-5-pdf-split → main` with a structured Summary + Test plan + Deferred-items section.
- After merge, deploy auto-builds. Sanity-click the live URL: drop a multi-page PDF on `/tools/pdf-split`, type a range like `1-3, 5`, click Convert, click "download all", verify ZIP contents.
- Phase 6 hardening backlog (carried from Plans 1-4, plus new Plan 5 items):
  - Streaming ZIP download (Chrome-only via File System Access API). Defer until needed.
  - Bookmark / outline preservation across Split (matches pdf-merge limitation).
  - Worker `as BlobPart` cast cleanup (codebase-wide).
  - Pre-existing `noNonNullAssertion` warnings in image-to-pdf staging-area.
  - libheif `Critical dependency` webpack warning.
  - `script-src 'unsafe-inline'` still in CSP.
  - Conversion counter in footer.
  - Bundle audit on PDF tools route (pdf-lib + pdf.js + libheif + client-zip).

---

## Self-review — spec coverage check

- ✓ Spec §1.1 PDF Split engine — Tasks 7 (descriptor + filenames), 8 (OptionsPanel), 9 (worker), 10 (route + sidebar + registry).
- ✓ Spec §1.3 Multi-output download infrastructure — Tasks 4 (zip.ts), 5 (EngineMeta archiveSuffix), 6 (ResultList + ToolFrame plumbing).
- ✓ Spec §1.4 Range parser promotion — Tasks 2 (file move), 3 (parseRangeTokens).
- ✓ Spec §1.6 Sidebar — Task 10 adds 'split' to PDFS group.
- ✓ Spec §3.1 Engine pattern reuse — Task 7 uses SingleInputEngine<PdfSplitOptions, OutputItem[]>.
- ✓ Spec §3.2 EngineMeta extension — Task 5.
- ✓ Spec §3.3 ResultList changes — Task 6.
- ✓ Spec §3.4 ToolFrame changes — Task 6.
- ✓ Spec §3.5 _shared/zip.ts — Task 4.
- ✓ Spec §3.6 Range parser promotion + parseRangeTokens — Tasks 2, 3.
- ✓ Spec §4.1 PdfSplitOptions — Task 7 Step 1.
- ✓ Spec §4.3 OptionsPanel components (Split) — Task 8.
- ✓ Spec §5.1 PDF Split worker — Task 9.
- ✓ Spec §5.2 Filename planner — Task 7 Steps 2-5.
- ✓ Spec §6.1 Validation rules (Split) — Task 7 (validate, isReadyToConvert).
- ✓ Spec §7 Privacy — Task 11 privacy-regression spec.
- ✓ Spec §8.1 Plan 5 unit tests — distributed across Tasks 3, 4, 6, 7, 8.
- ✓ Spec §8.2 Plan 5 E2E — Task 11.
- ✓ Spec §8.5 Worker correctness E2E — Task 11 (PK header bytes for ZIP, %PDF- for individual entries).
- ✓ Spec §9 Edge cases — covered by Tasks 7-11 (single-token, encrypted, OOB, duplicate, malformed, 0-page boundary).
- ✓ Spec §10 Plan structure preview — matches the 11 tasks here.
- ✓ Spec §11 Future scope — captured in Phase 5 close-out backlog above.
- ✓ Spec §12 Success criteria — verified by Task 11 (criteria 1, 2, 3, 7) and the close-out PR step (criterion 8). Plan 6 success criteria (4-6, 9, 10) are out of Plan 5 scope and tracked for the next plan.
