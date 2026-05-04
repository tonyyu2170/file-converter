# Phase 14 — Size caps + tab-close protection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement PRD §11.1 (per-tool soft warn / hard block) and §11.4 (in-flight `beforeunload`) per `docs/superpowers/specs/2026-05-04-phase-14-size-caps-and-tab-close.md`.

**Architecture:** Engine type gains a `category` field driving a shared `SIZE_LIMITS_MB` table. ToolFrame enforces per-file hard-block at drop and aggregate hard-block + soft-warn at Convert click via passive button-label transform (no modal). A `useActiveConversion` hook keeps a tab-local counter for the `beforeunload` listener.

**Tech Stack:** TypeScript strict, React, Vitest, Playwright. No new runtime dependencies.

---

## Reference reading before starting

- Spec: `docs/superpowers/specs/2026-05-04-phase-14-size-caps-and-tab-close.md`
- Engine type definitions: `src/engines/_shared/types.ts`
- Existing ToolFrame: `src/components/tool-frame.tsx`
- Existing ToolFrame tests: `src/components/tool-frame.test.tsx`
- Existing engine list (each one needs a category): `src/engines/_shared/registry.ts`
- `formatBytes` helper (already imported in ToolFrame): `src/lib/format-bytes.ts`

CLAUDE.md invariants apply:
- No `--no-verify`. No `--amend`. No Claude attribution in commit messages.
- Keep commit body lines ≤ 72 chars.
- Run `pnpm test`, `pnpm typecheck`, `pnpm lint` after each task before commit.

---

## Task 1: Engine `category` metadata + shared size-limits table

**Files:**
- Create: `src/engines/_shared/size-limits.ts`
- Create: `src/engines/_shared/size-limits.test.ts`
- Modify: `src/engines/_shared/types.ts` (add `EngineCategory` type + `category` field on both engine variants)
- Modify: `src/engines/_stub/index.ts` (add `category: "image"`)
- Modify: `src/engines/image-convert/index.ts` (add `category: "image"`)
- Modify: `src/engines/image-to-pdf/index.ts` (add `category: "image"`)
- Modify: `src/engines/pdf-merge/index.ts` (add `category: "pdf"`)
- Modify: `src/engines/pdf-split/index.ts` (add `category: "pdf"`)
- Modify: `src/engines/pdf-to-image/index.ts` (add `category: "pdf"`)
- Modify: `src/engines/pdf-to-md/index.ts` (add `category: "pdf"`)
- Modify: `src/engines/docx-to-pdf/index.ts` (add `category: "document"`)
- Modify: `src/components/tool-frame.test.tsx` (add `category: "image"` default in `makeStubEngine`)

The type addition is required, so it cascades to every engine. All edits ship together so `pnpm typecheck` stays green.

- [ ] **Step 1: Write the failing test for size-limits constants**

Create `src/engines/_shared/size-limits.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hardCapBytes, SIZE_LIMITS_MB, softCapBytes } from "./size-limits";

describe("SIZE_LIMITS_MB", () => {
  it("matches PRD §11.1 verbatim", () => {
    expect(SIZE_LIMITS_MB).toEqual({
      image: { soft: 50, hard: 250 },
      pdf: { soft: 100, hard: 500 },
      document: { soft: 25, hard: 100 },
    });
  });
});

describe("softCapBytes / hardCapBytes", () => {
  it("converts MB to bytes using SI thresholds (×1_000_000)", () => {
    expect(softCapBytes("image")).toBe(50_000_000);
    expect(hardCapBytes("image")).toBe(250_000_000);
    expect(softCapBytes("pdf")).toBe(100_000_000);
    expect(hardCapBytes("pdf")).toBe(500_000_000);
    expect(softCapBytes("document")).toBe(25_000_000);
    expect(hardCapBytes("document")).toBe(100_000_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/engines/_shared/size-limits.test.ts`
Expected: FAIL with `Cannot find module './size-limits'`.

- [ ] **Step 3: Add `EngineCategory` to types.ts**

Modify `src/engines/_shared/types.ts`. After the existing `OutputItem` type, add:

```ts
export type EngineCategory = "image" | "pdf" | "document";
```

Then in `EngineMeta<TOptions>`, add `category` as a required field:

```ts
export type EngineMeta<TOptions> = {
  id: string;
  inputAccept: string[];
  inputMime: string[];
  outputMime: string;
  defaultOptions: TOptions;
  convertButtonLabel?: string;
  category: EngineCategory;
  /** Filename suffix for ZIP archive when an engine produces multiple
   * outputs. ResultList builds the archive as `<basename><archiveSuffix>.zip`
   * (e.g., "myfile" + "-split" → "myfile-split.zip"). Engines that always
   * produce a single output don't need to set this. */
  archiveSuffix?: string;
};
```

- [ ] **Step 4: Create size-limits.ts**

Create `src/engines/_shared/size-limits.ts`:

```ts
import type { EngineCategory } from "./types";

// Source of truth: PRD §11.1. Update both sides of the test in
// size-limits.test.ts when changing these values.
export const SIZE_LIMITS_MB: Record<
  EngineCategory,
  { soft: number; hard: number }
> = {
  image: { soft: 50, hard: 250 },
  pdf: { soft: 100, hard: 500 },
  document: { soft: 25, hard: 100 },
} as const;

// SI thresholds (×1_000_000), matching the formatBytes helper.
const MB = 1_000_000;

export function softCapBytes(category: EngineCategory): number {
  return SIZE_LIMITS_MB[category].soft * MB;
}

export function hardCapBytes(category: EngineCategory): number {
  return SIZE_LIMITS_MB[category].hard * MB;
}
```

- [ ] **Step 5: Add `category` to every engine's metadata**

For each engine listed in `src/engines/_shared/registry.ts`, open its `index.ts` and add the `category` field on the `meta` object (or directly on the engine if the file uses an inline pattern). Use the mapping:

| Engine `id` | `category` |
|---|---|
| `image-convert` | `"image"` |
| `image-to-pdf` | `"image"` |
| `pdf-merge` | `"pdf"` |
| `pdf-split` | `"pdf"` |
| `pdf-to-image` | `"pdf"` |
| `pdf-to-md` | `"pdf"` |
| `docx-to-pdf` | `"document"` |

Also update `src/engines/_stub/index.ts` — add `category: "image"` to the `meta` object.

The position in the object literal doesn't matter as long as TypeScript sees the field. Place it after `outputMime` for consistency.

- [ ] **Step 6: Update `makeStubEngine` in tool-frame.test.tsx**

Modify `src/components/tool-frame.test.tsx`. In `makeStubEngine`, add `category: "image"` to the returned object alongside the other defaults (after `defaultOptions`):

```ts
return {
  id: "stub",
  inputAccept: [".bin"],
  inputMime: ["application/octet-stream"],
  outputMime: "application/octet-stream",
  defaultOptions: { ready: true },
  category: "image",
  cardinality: "single",
  // …rest unchanged
} as ConversionEngine<StubOpts, OutputItem>;
```

This keeps existing tool-frame tests green (image's 50 MB soft and 250 MB hard caps are well above the 1 MB-ish files those tests use).

- [ ] **Step 7: Run typecheck, lint, and full test suite**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: All green. The size-limits test passes; no engine-side or ToolFrame-side regressions.

If typecheck fails: a referenced engine literal still missing `category` is the most likely cause — grep for `cardinality: "single"` and `cardinality: "multi"` to find any spots a `category` line is needed.

- [ ] **Step 8: Commit**

```bash
git add src/engines/_shared/types.ts \
        src/engines/_shared/size-limits.ts \
        src/engines/_shared/size-limits.test.ts \
        src/engines/_stub/index.ts \
        src/engines/image-convert/index.ts \
        src/engines/image-to-pdf/index.ts \
        src/engines/pdf-merge/index.ts \
        src/engines/pdf-split/index.ts \
        src/engines/pdf-to-image/index.ts \
        src/engines/pdf-to-md/index.ts \
        src/engines/docx-to-pdf/index.ts \
        src/components/tool-frame.test.tsx

git commit -m "feat(engine): add category metadata + SIZE_LIMITS_MB table

Adds EngineCategory ('image' | 'pdf' | 'document') as a required
field on the engine type, plus SIZE_LIMITS_MB matching PRD §11.1
verbatim. softCapBytes/hardCapBytes helpers convert to bytes once.

Categorization is by input file type. Every existing engine wired:
image-convert, image-to-pdf -> image; pdf-* -> pdf; docx-to-pdf
-> document. Stub engine + tool-frame test stub default to image.

No behavior change yet; ToolFrame consumes these in later tasks."
```

---

## Task 2: `useActiveConversion` hook

**Files:**
- Create: `src/hooks/use-active-conversion.ts`
- Create: `src/hooks/use-active-conversion.test.ts`

Standalone hook with module-level counter. No runtime dependencies on other parts of the app yet (ToolFrame wires it in Task 3).

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/use-active-conversion.test.ts`:

```ts
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetForTests, useActiveConversion } from "./use-active-conversion";

describe("useActiveConversion", () => {
  let addSpy: ReturnType<typeof vi.spyOn>;
  let removeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    addSpy = vi.spyOn(window, "addEventListener");
    removeSpy = vi.spyOn(window, "removeEventListener");
    __resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetForTests();
  });

  function beforeUnloadCalls(spy: ReturnType<typeof vi.spyOn>): number {
    return spy.mock.calls.filter((c) => c[0] === "beforeunload").length;
  }

  it("attaches the beforeunload listener on first active mount", () => {
    renderHook(() => useActiveConversion(true));
    expect(beforeUnloadCalls(addSpy)).toBe(1);
    expect(beforeUnloadCalls(removeSpy)).toBe(0);
  });

  it("does not attach when active=false", () => {
    renderHook(() => useActiveConversion(false));
    expect(beforeUnloadCalls(addSpy)).toBe(0);
  });

  it("removes the listener when the only active flips to false", () => {
    const { rerender } = renderHook(({ a }) => useActiveConversion(a), {
      initialProps: { a: true },
    });
    expect(beforeUnloadCalls(addSpy)).toBe(1);

    rerender({ a: false });
    expect(beforeUnloadCalls(removeSpy)).toBe(1);
  });

  it("keeps the listener attached while any consumer is still active", () => {
    const a = renderHook(() => useActiveConversion(true));
    const b = renderHook(() => useActiveConversion(true));
    expect(beforeUnloadCalls(addSpy)).toBe(1); // attached once, not twice

    a.unmount();
    expect(beforeUnloadCalls(removeSpy)).toBe(0); // still active via b

    b.unmount();
    expect(beforeUnloadCalls(removeSpy)).toBe(1);
  });

  it("removes the listener on unmount when active=true", () => {
    const { unmount } = renderHook(() => useActiveConversion(true));
    unmount();
    expect(beforeUnloadCalls(removeSpy)).toBe(1);
  });

  it("re-attaches after counter returns from zero to positive", () => {
    const first = renderHook(() => useActiveConversion(true));
    first.unmount();
    expect(beforeUnloadCalls(removeSpy)).toBe(1);

    renderHook(() => useActiveConversion(true));
    expect(beforeUnloadCalls(addSpy)).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/hooks/use-active-conversion.test.ts`
Expected: FAIL with `Cannot find module './use-active-conversion'`.

- [ ] **Step 3: Write the hook**

Create `src/hooks/use-active-conversion.ts`:

```ts
import { useEffect } from "react";

let activeCount = 0;
let listenerInstalled = false;

function handler(e: BeforeUnloadEvent) {
  e.preventDefault();
  // Required by older Chromium versions even though the spec deprecates it.
  e.returnValue = "";
}

function ensureListener() {
  if (activeCount > 0 && !listenerInstalled) {
    window.addEventListener("beforeunload", handler);
    listenerInstalled = true;
  } else if (activeCount === 0 && listenerInstalled) {
    window.removeEventListener("beforeunload", handler);
    listenerInstalled = false;
  }
}

/**
 * While `active` is true, this hook contributes to a tab-local counter
 * that installs a `beforeunload` listener whenever any consumer is
 * active. The browser shows its native "leave site?" prompt while at
 * least one consumer is active.
 *
 * Designed for the conversion in-flight case (PRD §11.4). Forward-
 * compatible with future concurrency: if multiple ToolFrames or batch
 * runners are simultaneously active, the listener stays attached until
 * all consumers finish.
 */
export function useActiveConversion(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    activeCount++;
    ensureListener();
    return () => {
      activeCount--;
      ensureListener();
    };
  }, [active]);
}

/** Test-only: reset module state between tests. */
export function __resetForTests(): void {
  if (listenerInstalled) {
    window.removeEventListener("beforeunload", handler);
  }
  activeCount = 0;
  listenerInstalled = false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/hooks/use-active-conversion.test.ts`
Expected: PASS — all six cases.

- [ ] **Step 5: Run lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: Clean.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-active-conversion.ts \
        src/hooks/use-active-conversion.test.ts

git commit -m "feat(hooks): add useActiveConversion + beforeunload guard

Tab-local module-level counter; installs beforeunload when count
>0, removes when it returns to 0. Forward-compatible with future
concurrency (batchConcurrency, multi-engine parallel runs).

Hook is unused by application code yet; wired into ToolFrame in
the next task."
```

---

## Task 3: Wire `useActiveConversion` into ToolFrame

**Files:**
- Modify: `src/components/tool-frame.tsx` (call `useActiveConversion(status === "converting")`)
- Modify: `src/components/tool-frame.test.tsx` (one new test)

The wiring is one line. The test verifies the hook is invoked at the right moment.

- [ ] **Step 1: Write the failing test**

In `src/components/tool-frame.test.tsx`, append a new test inside the `describe("ToolFrame", ...)` block:

```ts
it("installs beforeunload listener while converting and removes it after", async () => {
  // Use a slow convert so we can observe the converting state.
  let resolveConvert: (v: OutputItem) => void = () => undefined;
  const convertPromise = new Promise<OutputItem>((res) => {
    resolveConvert = res;
  });
  const convert = vi.fn(async () => convertPromise);
  const engine = makeStubEngine({ convert });

  const addSpy = vi.spyOn(window, "addEventListener");
  const removeSpy = vi.spyOn(window, "removeEventListener");

  const beforeUnloadCalls = (spy: typeof addSpy) =>
    spy.mock.calls.filter((c) => c[0] === "beforeunload").length;

  render(<ToolFrame engine={engine} />);
  const file = new File(["x"], "in.bin", { type: "application/octet-stream" });
  fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files: [file] } });

  await screen.findByTestId("clear-staged-file");
  fireEvent.click(screen.getByTestId("convert-button"));

  await waitFor(() => expect(beforeUnloadCalls(addSpy)).toBe(1));
  expect(beforeUnloadCalls(removeSpy)).toBe(0);

  resolveConvert({
    filename: "out.bin",
    mime: "application/octet-stream",
    blob: new Blob(["y"]),
  });

  await waitFor(() => expect(beforeUnloadCalls(removeSpy)).toBe(1));
});
```

Add this import at the top of the file if `__resetForTests` is needed for test isolation:

```ts
import { __resetForTests as resetActiveConversion } from "@/hooks/use-active-conversion";
```

And reset between tests by extending the existing `afterEach`:

```ts
afterEach(() => {
  vi.restoreAllMocks();
  resetActiveConversion();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/components/tool-frame.test.tsx -t "installs beforeunload"`
Expected: FAIL — `addSpy` never sees a `beforeunload` registration because ToolFrame doesn't call the hook yet.

- [ ] **Step 3: Wire the hook into ToolFrame**

Modify `src/components/tool-frame.tsx`. Add the import:

```ts
import { useActiveConversion } from "@/hooks/use-active-conversion";
```

Inside the `ToolFrame` component body, after the `useState` declarations and before `resetSingleStaging`, add:

```ts
useActiveConversion(status === "converting");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/components/tool-frame.test.tsx -t "installs beforeunload"`
Expected: PASS.

Run the full ToolFrame suite to confirm no regression:

```
pnpm test src/components/tool-frame.test.tsx
```

Expected: All green.

- [ ] **Step 5: Run lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: Clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/tool-frame.tsx src/components/tool-frame.test.tsx

git commit -m "feat(tool-frame): install beforeunload while converting

Wires useActiveConversion into ToolFrame keyed on status flip into
and out of 'converting'. The browser's native leave-site prompt
now fires if the user closes or reloads the tab during a
conversion (PRD §11.4)."
```

---

## Task 4: Per-file hard-block at drop

**Files:**
- Modify: `src/components/tool-frame.tsx` (add cap check at top of `handleDrop`)
- Modify: `src/components/tool-frame.test.tsx` (extend with hard-block-at-drop tests)

Reject any drop containing a file over the per-category hard cap. Atomic rejection — the entire drop event is refused, prior staging unchanged.

- [ ] **Step 1: Add `fakeFile` helper + write the failing tests**

In `src/components/tool-frame.test.tsx`, near the existing `makeStubEngine` factory, add a non-allocating File factory:

```ts
// Allocation-free File for size-cap tests. The cap check reads .size only,
// so we override that property and skip the underlying Blob byte buffer.
// CRITICAL on an 8GB dev box: a literal `new Uint8Array(600_000_000)` here
// would allocate 600 MB per test, and Vitest runs files in parallel.
function fakeFile(name: string, type: string, size: number): File {
  const f = new File([], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}
```

Then append two tests inside the existing `describe("ToolFrame", ...)`:

```ts
it("single-cardinality: rejects drop of a file over the per-category hard cap", () => {
  const engine = makeStubEngine({ category: "image" });
  render(<ToolFrame engine={engine} />);
  const huge = fakeFile("huge.bin", "application/octet-stream", 260_000_000);
  fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files: [huge] } });
  expect(screen.queryByTestId("clear-staged-file")).toBeNull();
  expect(screen.getByTestId("status-indicator")).toHaveTextContent("[ ERROR ]");
  expect(screen.getByText(/exceeds the 250 MB cap for image tools/i)).toBeInTheDocument();
});

it("multi-cardinality: rejects entire drop if any file is over hard cap; prior staging unchanged", () => {
  const Staging = ({ files }: { files: File[]; onChange: (n: File[]) => void; options: unknown }) => (
    <div data-testid="staging-files">{files.length} files</div>
  );
  const engine = {
    ...makeStubEngine(),
    cardinality: "multi" as const,
    category: "pdf" as const,
    validate: (() => ({ ok: true }) as const) as never,
    convert: vi.fn() as never,
    StagingArea: Staging,
  } as unknown as ConversionEngine<StubOpts, OutputItem>;

  render(<ToolFrame engine={engine} />);
  const small = fakeFile("small.pdf", "application/pdf", 1_000);
  fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files: [small] } });

  expect(screen.getByTestId("staging-files")).toHaveTextContent("1 files");

  const huge = fakeFile("huge.pdf", "application/pdf", 600_000_000);
  const ok = fakeFile("ok.pdf", "application/pdf", 2_000);
  fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files: [huge, ok] } });

  // Prior staging unchanged; new drop atomically rejected.
  expect(screen.getByTestId("staging-files")).toHaveTextContent("1 files");
  expect(screen.getByText(/exceeds the 500 MB cap for pdf tools/i)).toBeInTheDocument();
});
```

Note: tests pass `category` via the `makeStubEngine` overrides. That requires `makeStubEngine` to accept `category` as part of its `Partial<ConversionEngine<...>>` overrides — which it already does because `category` is on the engine type after Task 1.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/components/tool-frame.test.tsx -t "rejects drop"`
Expected: FAIL on both. Files get staged because no cap check exists yet.

- [ ] **Step 3: Add the cap check in handleDrop**

Modify `src/components/tool-frame.tsx`. Add the import:

```ts
import { hardCapBytes, SIZE_LIMITS_MB } from "@/engines/_shared/size-limits";
```

Replace the `handleDrop` function:

```ts
function handleDrop(files: File[]) {
  const hard = hardCapBytes(engine.category);
  const oversized = files.filter((f) => f.size > hard);
  if (oversized.length > 0) {
    const names = oversized
      .map((f) => `${f.name} (${formatBytes(f.size)})`)
      .join(", ");
    const verb = oversized.length === 1 ? "exceeds" : "exceed";
    const filesWord = oversized.length === 1 ? "the file" : "the files";
    setErrorMessage(
      `${names} ${verb} the ${SIZE_LIMITS_MB[engine.category].hard} MB cap ` +
        `for ${engine.category} tools. Try splitting ${filesWord} or using a different tool.`,
    );
    setStatus("error");
    return;
  }
  if (isMulti) {
    setStagedFiles((prev) => [...prev, ...files]);
    return;
  }
  const first = files[0];
  if (!first) return;
  resetSingleStaging(first);
}
```

The single-cardinality drop replaces any prior staged file via `resetSingleStaging`, which already clears `errorMessage`. The multi-cardinality drop preserves prior staging on rejection (per spec §3.3 atomic semantics).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/components/tool-frame.test.tsx -t "rejects drop"`
Expected: PASS on both.

Run the full ToolFrame suite:

```
pnpm test src/components/tool-frame.test.tsx
```

Expected: All green. Existing tests use file sizes ≤ 4.2 MB which are under every category's hard cap.

- [ ] **Step 5: Run lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: Clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/tool-frame.tsx src/components/tool-frame.test.tsx

git commit -m "feat(tool-frame): per-file hard-block at drop

Rejects entire drop event if any file exceeds the per-category
hard cap (PRD §11.1). Reuses the existing errorMessage surface
for consistency with engine.validate failures. For multi-
cardinality, prior staged files are preserved on rejection
(atomic semantics)."
```

---

## Task 5: Convert button label transform + aggregate hard-block

**Files:**
- Modify: `src/components/tool-frame.tsx` (compute `overSoft`/`overHard`, transform button label, append staged-totals suffix)
- Modify: `src/components/tool-frame.test.tsx` (extend with transform tests)

Soft warn surfaces as a passive Convert button label change. Aggregate hard-block (multi-cardinality only — single is caught at drop) disables the button and adds a clarifying suffix to the staged-totals row.

- [ ] **Step 1: Write the failing tests**

`fakeFile` was added in Task 4 — reuse it. Append five tests inside the existing `describe("ToolFrame", ...)`:

```ts
it("single-cardinality: Convert label transforms when staged file is over soft cap", async () => {
  const engine = makeStubEngine({ category: "image" });
  render(<ToolFrame engine={engine} />);
  // 60 MB > 50 MB image soft cap, < 250 MB hard cap.
  const big = fakeFile("big.bin", "application/octet-stream", 60_000_000);
  fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files: [big] } });
  await screen.findByTestId("clear-staged-file");
  const btn = screen.getByTestId("convert-button");
  expect(btn).not.toBeDisabled();
  expect(btn).toHaveTextContent(/may be slow/i);
  expect(btn).toHaveTextContent("60 MB");
});

it("multi-cardinality: Convert label transforms when aggregate is over soft cap, under hard cap", async () => {
  const Staging = ({ files }: { files: File[]; onChange: (n: File[]) => void; options: unknown }) => (
    <div>{files.length} files</div>
  );
  const engine = {
    ...makeStubEngine(),
    cardinality: "multi" as const,
    category: "pdf" as const,
    validate: (() => ({ ok: true }) as const) as never,
    convert: vi.fn() as never,
    StagingArea: Staging,
  } as unknown as ConversionEngine<StubOpts, OutputItem>;

  render(<ToolFrame engine={engine} />);
  // 3 × 50 MB = 150 MB. Over pdf 100 MB soft, under 500 MB hard.
  const a = fakeFile("a.pdf", "application/pdf", 50_000_000);
  const b = fakeFile("b.pdf", "application/pdf", 50_000_000);
  const c = fakeFile("c.pdf", "application/pdf", 50_000_000);
  fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files: [a, b, c] } });

  await screen.findByTestId("staged-totals");
  const btn = screen.getByTestId("convert-button");
  expect(btn).not.toBeDisabled();
  expect(btn).toHaveTextContent(/may be slow/i);
  expect(btn).toHaveTextContent("150 MB");
});

it("multi-cardinality: aggregate over hard cap disables Convert and adds totals suffix", async () => {
  const Staging = ({ files }: { files: File[]; onChange: (n: File[]) => void; options: unknown }) => (
    <div>{files.length} files</div>
  );
  const engine = {
    ...makeStubEngine(),
    cardinality: "multi" as const,
    category: "pdf" as const,
    validate: (() => ({ ok: true }) as const) as never,
    convert: vi.fn() as never,
    StagingArea: Staging,
  } as unknown as ConversionEngine<StubOpts, OutputItem>;

  render(<ToolFrame engine={engine} />);
  // 6 × 90 MB = 540 MB. Over pdf 500 MB hard. Each individual file
  // is 90 MB, well under 500 MB hard, so per-file drop check passes.
  const files = Array.from({ length: 6 }, (_, i) =>
    fakeFile(`f${i}.pdf`, "application/pdf", 90_000_000),
  );
  fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files } });

  await screen.findByTestId("staged-totals");
  const btn = screen.getByTestId("convert-button");
  expect(btn).toBeDisabled();
  expect(btn).toHaveTextContent(/exceeds 500 mb cap/i);
  expect(screen.getByTestId("staged-totals")).toHaveTextContent(/over 500 MB cap/i);
});

it("Convert button shows plain '[ convert ]' when staged total is under soft cap", async () => {
  const engine = makeStubEngine({ category: "image" });
  render(<ToolFrame engine={engine} />);
  const small = fakeFile("small.bin", "application/octet-stream", 1_000_000);
  fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files: [small] } });
  await screen.findByTestId("clear-staged-file");
  expect(screen.getByTestId("convert-button")).toHaveTextContent("[ convert ]");
});

it("cap warnings override engine.convertButtonLabel when over hard cap (multi-cardinality)", async () => {
  const Staging = ({ files }: { files: File[]; onChange: (n: File[]) => void; options: unknown }) => (
    <div>{files.length} files</div>
  );
  const engine = {
    ...makeStubEngine(),
    cardinality: "multi" as const,
    category: "pdf" as const,
    convertButtonLabel: "[ merge ]",
    validate: (() => ({ ok: true }) as const) as never,
    convert: vi.fn() as never,
    StagingArea: Staging,
  } as unknown as ConversionEngine<StubOpts, OutputItem>;

  render(<ToolFrame engine={engine} />);
  const files = Array.from({ length: 6 }, (_, i) =>
    fakeFile(`f${i}.pdf`, "application/pdf", 90_000_000),
  );
  fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files } });

  await screen.findByTestId("staged-totals");
  const btn = screen.getByTestId("convert-button");
  expect(btn).toBeDisabled();
  // Cap message wins over engine custom label so the disabled state isn't unexplained.
  expect(btn).toHaveTextContent(/exceeds 500 mb cap/i);
  expect(btn).not.toHaveTextContent("[ merge ]");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/components/tool-frame.test.tsx -t "transforms\|disables Convert\|plain"`
Expected: FAIL on the first three. The fourth (`plain`) might pass already because the existing label is `[ convert ]`.

- [ ] **Step 3: Compute overSoft/overHard + transform button**

Modify `src/components/tool-frame.tsx`. Update the import:

```ts
import { hardCapBytes, SIZE_LIMITS_MB, softCapBytes } from "@/engines/_shared/size-limits";
```

After `const totalInputBytes = ...` (line ~120), add:

```ts
const softBytes = softCapBytes(engine.category);
const hardBytes = hardCapBytes(engine.category);
const overSoft = stagedFiles.length > 0 && totalInputBytes > softBytes;
// Aggregate hard cap only meaningful for multi (single caught at drop).
const overHardAggregate = isMulti && totalInputBytes > hardBytes;

// Cap warnings win over engine.convertButtonLabel: a disabled-by-cap
// button labelled with the engine's custom string (e.g., '[ merge ]')
// would leave the user with no explanation of why it's disabled.
const convertLabel: string = (() => {
  if (overHardAggregate) {
    return `[ exceeds ${SIZE_LIMITS_MB[engine.category].hard} mb cap ]`;
  }
  if (overSoft) {
    return `[ convert · ${formatBytes(totalInputBytes).toLowerCase()} may be slow ]`;
  }
  return engine.convertButtonLabel ?? "[ convert ]";
})();
```

Update the Convert button's `disabled` and label:

```tsx
<button
  type="button"
  data-testid="convert-button"
  disabled={
    stagedFiles.length === 0 || !ready || status === "converting" || overHardAggregate
  }
  onClick={handleConvertClick}
  className="mt-3 border border-[var(--color-accent)] px-3 py-2 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-strong)] disabled:border-[var(--color-fg-very-muted)] disabled:text-[var(--color-fg-very-muted)]"
>
  {convertLabel}
</button>
```

In the `isMulti && stagedFiles.length > 0` block (the `staged-totals` row), append the over-cap suffix to the size span:

```tsx
{isMulti && stagedFiles.length > 0 && (
  <div
    data-testid="staged-totals"
    className="mb-3 flex flex-wrap items-center gap-3 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-muted)]"
  >
    <span>
      <span className="text-[var(--color-fg-strong)]">{stagedFiles.length}</span>{" "}
      {stagedFiles.length === 1 ? "file" : "files"}
      <span> · </span>
      <span className="text-[var(--color-fg-strong)]">{formatBytes(totalInputBytes)}</span>
      {overHardAggregate && (
        <>
          <span> · </span>
          <span className="text-[var(--color-fg-strong)]">
            over {SIZE_LIMITS_MB[engine.category].hard} MB cap
          </span>
        </>
      )}
    </span>
    {estimateBytes !== null && (
      <span data-testid="output-estimate">
        ≈ <span className="text-[var(--color-fg-strong)]">{formatBytes(estimateBytes)}</span>{" "}
        output
      </span>
    )}
  </div>
)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/components/tool-frame.test.tsx`
Expected: All green — both the new tests and all prior tests.

If a prior test fails because its file size happens to land over a soft cap, increase the engine `category` in `makeStubEngine` or shrink the test file. The default category `"image"` (50 MB soft) accommodates everything currently under 50 MB.

- [ ] **Step 5: Run lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: Clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/tool-frame.tsx src/components/tool-frame.test.tsx

git commit -m "feat(tool-frame): soft-warn label + aggregate hard-block

Convert button label transforms passively based on staged total:
'[ convert ]' under soft cap, '[ convert · X may be slow ]'
between soft and hard, '[ exceeds X mb cap ]' (disabled) over
hard for multi-cardinality. Single-cardinality never reaches the
hard branch via this path because per-file drop already rejects.

Multi-cardinality staged-totals row adds 'over X MB cap' suffix
when aggregate is over hard, so the disabled button is explained.

Closes spec §3.3 and §3.4."
```

---

## Task 6: E2E hard-block spec

**Files:**
- Create: `tests/e2e/size-caps.spec.ts`

One end-to-end smoke test confirming that a file over the hard cap is rejected at drop time and never reaches an engine. Uses a generated all-zero file so no fixture commitment is needed.

The `beforeunload` E2E was considered; it is not implemented automatically because Playwright's `beforeunload` handling is browser-specific and brittle. The unit tests in `use-active-conversion.test.ts` and `tool-frame.test.tsx` already verify the listener attach/detach logic. Add a manual verification step (Step 5 below) instead.

- [ ] **Step 1: Write the spec**

Create `tests/e2e/size-caps.spec.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

test.describe("size caps", () => {
  let tmpDir: string;
  let hugePdfPath: string;

  test.beforeAll(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "filecnv-sizecaps-"));
    hugePdfPath = path.join(tmpDir, "huge.pdf");
    // 600 MB all-zero; the cap check reads File.size only, so content
    // is irrelevant.
    await writeFile(hugePdfPath, Buffer.alloc(600_000_000, 0));
  });

  test.afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("drops a 600 MB file into pdf-merge and gets the hard-cap rejection", async ({ page }) => {
    await page.goto("/tools/pdf-merge");

    const input = page.locator('input[type="file"]');
    await input.setInputFiles([hugePdfPath]);

    await expect(
      page.getByText(/exceeds the 500 MB cap for pdf tools/i),
    ).toBeVisible();
    await expect(page.getByTestId("status-indicator")).toHaveText("[ ERROR ]");

    // Convert button must remain disabled because no files were staged.
    await expect(page.getByTestId("convert-button")).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the spec**

Run: `pnpm test:e2e tests/e2e/size-caps.spec.ts`
Expected: PASS in all three browsers (Chromium, Firefox, WebKit).

If WebKit times out generating the 600 MB buffer, allocate a smaller file just over the cap (e.g., 510 MB via `Buffer.alloc(510_000_000, 0)`). The cap check only requires `> 500 MB`.

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: Clean.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/size-caps.spec.ts

git commit -m "test(e2e): hard-block rejects oversized PDF at drop

End-to-end smoke covering the size-cap rejection path. Generates
a 600 MB all-zero file at runtime (not committed) and asserts the
error copy + ERROR status without staging or invoking pdf-merge.
Cleans the temp file in afterAll."
```

- [ ] **Step 5: Manual verification — `beforeunload`**

Run `pnpm dev`, open `http://localhost:3000/tools/docx-to-pdf`, drop a real DOCX, click Convert. While the conversion is running (status shows CONVERTING), press Ctrl-R / Cmd-R or close the tab. The browser should show a "Leave site? Changes you made may not be saved." prompt. After the conversion completes (status DONE), reload again — the prompt should NOT appear.

If the prompt fires correctly: this manual check stands in for an automated E2E. The unit tests in Task 2 verify the listener install/remove logic; the browser dialog itself is a Chrome/Firefox/WebKit invariant we don't need to verify in code.

If the prompt does NOT fire during conversion: investigate. Likely cause is `useActiveConversion` not seeing `active=true`, possibly because `status` is updated asynchronously or `useEffect` is being torn down by Strict Mode double-invocation. Add a `console.log("active count:", activeCount)` inside `ensureListener` to diagnose.

---

## Task 7: Final verification + sweep

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `pnpm test`
Expected: All green. Note total test count (should be > 897 from PR #22, with new tests from Tasks 1, 2, 3, 4, 5).

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: Clean.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: Clean.

- [ ] **Step 4: E2E suite**

Run: `pnpm test:e2e`
Expected: All green. The new size-caps spec is included; no prior spec regresses.

- [ ] **Step 5: Manual smoke**

Open each tool route and confirm:
- Drop a small file: button reads `[ convert ]`.
- Drop a file just over the soft cap (e.g., 60 MB into image-convert): button reads `[ convert · 60 mb may be slow ]`, single click runs.
- Drop a file just over the hard cap: error message visible, no staging.

For at least one multi-cardinality engine (e.g., pdf-merge), confirm:
- Stage files whose aggregate crosses the soft cap: label includes `may be slow`.
- Stage files whose aggregate crosses the hard cap: button disabled, totals row shows `over X MB cap`.

- [ ] **Step 6: Open PR**

```bash
git push -u origin <current-branch>
gh pr create --base main --title "Phase 14: file size caps + tab-close protection" --body "$(cat <<'EOF'
## Summary

- Implements PRD §11.1 (per-tool soft warn / hard block) and §11.4 (in-flight beforeunload), per spec docs/superpowers/specs/2026-05-04-phase-14-size-caps-and-tab-close.md.
- Engine type gains a required `category` field driving SIZE_LIMITS_MB lookups.
- Per-file hard-block rejects oversized drops atomically; aggregate hard-block disables Convert (multi-cardinality); soft-warn surfaces as passive button-label transform (no modal).
- New useActiveConversion hook installs beforeunload while any conversion is in flight.

## Test plan

- [ ] CI green
- [ ] Manual: Convert button label transforms across soft / hard thresholds
- [ ] Manual: Reload during conversion shows leave-site prompt; reload after does not
EOF
)"
```

If review feedback lands, address in fresh commits (no `--amend`).

---

## Self-review checklist (run after writing the plan, before invoking the next skill)

- Spec coverage:
  - §3.1 (engine metadata) — Task 1
  - §3.2 (size-limits table) — Task 1
  - §3.3 (per-file hard-block at drop) — Task 4
  - §3.4 (aggregate hard-block + soft-warn at click) — Task 5
  - §3.5 (`useActiveConversion` hook) — Task 2
  - §4 (UI surface — no new components) — Tasks 3, 4, 5
  - §5 (error copy) — Tasks 4, 5
  - §6.1 (unit tests) — distributed across Tasks 1, 2, 3, 4, 5
  - §6.2 (E2E hard-block + manual beforeunload) — Task 6
  - §6.3 (test-cost discipline) — Task 6 cleanup hook
  - §9 (success criteria) — verified end-to-end in Task 7
- Type consistency: `EngineCategory` defined in Task 1, used identically in Tasks 2–6. `SIZE_LIMITS_MB` and helpers `softCapBytes`/`hardCapBytes` introduced in Task 1, consumed in Tasks 4 and 5.
- No placeholders: every code-changing step shows the exact code; every test step shows the assertion.
