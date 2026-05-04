# Phase 14 — File size caps + tab-close protection

Phase 14 of the file_converter roadmap. Two PRD §11 invariants that no
engine has implemented yet: per-tool file-size limits (§11.1, soft-warn
+ hard-block) and the in-flight `beforeunload` listener (§11.4). One
phase, both invariants, because they're the same shape of work — small
cross-cutting behaviors gated on engine metadata that touch every
existing tool.

## 1. Scope

This phase ships:

1. A `category` field on the engine type, declared once per engine
   (image / pdf / document), driving size-limit lookups.
2. A shared `SIZE_LIMITS_MB` constant matching the PRD §11.1 table.
3. Per-file hard-block enforcement at drop time.
4. Aggregate hard-block enforcement at Convert-click time
   (multi-cardinality engines only — single-cardinality is caught at
   drop).
5. Soft-warn surfacing via Convert-button label transformation —
   passive, no modal, no two-step click.
6. A `useActiveConversion` hook that maintains a tab-local counter and
   installs/removes the `beforeunload` listener as the count crosses
   zero.

## 2. Out of scope (this phase)

- A general-purpose `<ConfirmModal>` component. The Convert-button
  transform replaces the need for one in the soft-warn flow.
- Per-engine size-cap overrides. Categories cover every existing
  engine; YAGNI.
- Persisting "don't ask again" preferences. Phase 15 introduces the
  prefs hook; if a user wants suppression we add it then. The current
  surface is already low-friction (passive label), so suppression is
  unlikely to be requested.
- A `/about` page documenting the cap policy. Future phase.
- `batchConcurrency` (§11.3). Separate concern; the
  `useActiveConversion` counter design is forward-compatible.

## 3. Architecture

### 3.1 Engine metadata extension

`src/engines/_shared/types.ts` gains a required `category` field on
both engine variants:

```ts
export type EngineCategory = "image" | "pdf" | "document";

export type SingleInputEngine<TOptions, TOutput> = {
  // …existing fields
  category: EngineCategory;
  // …
};

export type MultiInputEngine<TOptions, TOutput> = {
  // …existing fields
  category: EngineCategory;
  // …
};
```

Categorization is by **input** file type, not output. Mapping for
existing engines:

| Engine | Category |
|---|---|
| `image-convert` | `image` |
| `image-to-pdf` | `image` |
| `pdf-merge` | `pdf` |
| `pdf-split` | `pdf` |
| `pdf-to-image` | `pdf` |
| `pdf-to-md` | `pdf` |
| `docx-to-pdf` | `document` |

### 3.2 Shared size-limit table

New file `src/engines/_shared/size-limits.ts`:

```ts
import type { EngineCategory } from "./types";

export const SIZE_LIMITS_MB: Record<EngineCategory, { soft: number; hard: number }> = {
  image:    { soft: 50,  hard: 250 },
  pdf:      { soft: 100, hard: 500 },
  document: { soft: 25,  hard: 100 },
} as const;
```

Source of truth: PRD §11.1. A unit test asserts the table matches
verbatim, so any drift between PRD and code surfaces in CI.

SI thresholds (× 1_000_000 to convert MB to bytes), matching the
`formatBytes` helper added in PR #22.

### 3.3 Hard-block at drop (per-file)

`ToolFrame.handleDrop` runs a per-file size check before staging. If
**any** dropped file exceeds the category hard cap, the entire drop
event is rejected (atomic semantics — no partial staging) and the
existing `errorMessage` slot is used to surface the failure:

```ts
function handleDrop(files: File[]) {
  const limits = SIZE_LIMITS_MB[engine.category];
  const oversized = files.filter(f => f.size > limits.hard * 1_000_000);
  if (oversized.length > 0) {
    const names = oversized.map(f => `${f.name} (${formatBytes(f.size)})`).join(", ");
    setErrorMessage(
      `${names} exceeds the ${limits.hard} MB ${engine.category} cap. ` +
      `Try splitting the file or using a different tool.`
    );
    setStatus("error");
    return;
  }
  // …existing staging path
}
```

This applies identically to single- and multi-cardinality engines —
each individual file must be under the per-category hard cap. For
multi-cardinality, the *aggregate* hard-block is a separate check at
Convert-click time (§3.4) so users can over-stage and trim down.

### 3.4 Aggregate hard-block + soft-warn at Convert click

Three derived booleans in ToolFrame, computed each render from staged
files + category:

```ts
const limits = SIZE_LIMITS_MB[engine.category];
const totalBytes = stagedFiles.reduce((s, f) => s + f.size, 0);
const overSoft = totalBytes > limits.soft * 1_000_000;
const overHard = totalBytes > limits.hard * 1_000_000; // multi-cardinality only
```

Convert button behavior, in precedence order:

| Condition | Label | State |
|---|---|---|
| `overHard` (multi only) | `[ exceeds 500 mb cap ]` | disabled |
| `overSoft` | `[ convert · 180 mb may be slow ]` | enabled, single click runs |
| neither | `[ convert ]` | enabled, single click runs |

The label transform is **passive** — it reflects the current staged
total continuously, not after a first click. Click always fires
`handleConvertClick` directly. The threshold-crossing label is the
warning; informed consent is delivered before the click happens, so a
two-step confirm pattern would be redundant.

For multi-cardinality `overHard`, the existing `staged-totals` row
gains a clarifying suffix so the disabled button isn't unexplained:

```
5 files · 540 MB · over 500 MB cap
```

Single-cardinality engines never reach the `overHard` branch via this
path because a single file over the hard cap was already rejected at
drop (§3.3). The `overSoft` branch applies to both cardinalities.

### 3.5 `useActiveConversion` hook + `beforeunload`

New file `src/hooks/use-active-conversion.ts`:

```ts
import { useEffect } from "react";

let activeCount = 0;
let listenerInstalled = false;

function handler(e: BeforeUnloadEvent) {
  e.preventDefault();
  e.returnValue = ""; // legacy spec compliance; required for Chromium
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

export function useActiveConversion(active: boolean) {
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
```

Module-level counter. Module identity is stable across all ToolFrames
in the tab, so this acts as a tab-local global. ToolFrame calls:

```ts
useActiveConversion(status === "converting");
```

Lifecycle paths:

- Conversion completes → `status` flips → cleanup runs → counter
  decrements → listener removed if count hits zero.
- ToolFrame unmounts mid-conversion (route change) → cleanup runs →
  counter decrements. The conversion result itself is lost — that's
  not what `beforeunload` is for; it guards against tab close. Route
  navigation during in-flight conversion remains an open issue
  separately, out of scope here.
- Tab close while count > 0 → browser shows native "leave site?"
  prompt.

Counter design is forward-compatible with future concurrency (Phase
17 batchConcurrency, multi-engine parallel runs).

## 4. UI surface

No new components. Changes are all in-place edits to existing surfaces:

- `ToolFrame.tsx` — drop handler (per-file hard-block), Convert
  button (label transform + disable), staged-totals row (over-cap
  suffix), `useActiveConversion(status === "converting")` call.
- `_shared/types.ts` — `category` field on both engine variants.
- Each engine `index.ts` — one-line `category:` addition.

## 5. Error copy

| Path | Copy |
|---|---|
| Per-file hard at drop (1 file) | `foo.pdf (612 MB) exceeds the 500 MB cap for pdf tools. Try splitting the file or using a different tool.` |
| Per-file hard at drop (multiple) | `foo.pdf (612 MB), bar.pdf (550 MB) exceed the 500 MB cap for pdf tools. Try splitting the files or using a different tool.` |
| Aggregate hard at click (multi) | Disabled button: `[ exceeds 500 mb cap ]`. Staged-totals: `5 files · 540 MB · over 500 MB cap` |
| Soft warn at click | Button: `[ convert · 180 mb may be slow ]` |

Lowercase / brackets match the existing brutalist button style.

## 6. Testing strategy

### 6.1 Unit (Vitest)

`src/engines/_shared/size-limits.test.ts`:
- `SIZE_LIMITS_MB` matches PRD §11.1 verbatim. Hard-coded literals,
  not a loop — the test fails if either side drifts.

`src/hooks/use-active-conversion.test.ts`:
- `active=true` mount → `beforeunload` listener attached
  (`window.addEventListener` spy).
- `active=true` → re-render with `active=false` → listener removed.
- Two hook instances both `active=true`; one flips off → listener
  still attached (counter > 0 case).
- Both flip off → listener removed.
- Unmount with `active=true` → cleanup decrements + removes listener.
- Reset module state between tests (the counter is module-level
  global) — done by re-importing or by exporting a `__resetForTests`
  helper.

`src/components/tool-frame.test.tsx` (extend existing):
- Single-cardinality: drop file > category hard cap → file rejected,
  `errorMessage` set with cap value and category, status `"error"`,
  `stagedFiles` empty.
- Single-cardinality: drop file > soft, < hard → staged; Convert
  button label includes `may be slow` and the rendered size.
- Multi-cardinality: drop one file under hard → staged. Drop another
  file individually over hard → entire drop rejected, prior staging
  unchanged, `errorMessage` set.
- Multi-cardinality: aggregate over hard at click → Convert button
  disabled, label is the over-cap form, staged-totals row contains
  `· over X MB cap`.
- Multi-cardinality: aggregate between soft and hard at click →
  Convert button enabled, label includes size + `may be slow`.
- Each test uses a stub engine with a mocked `category` — no real
  engines need to be involved.

### 6.2 E2E (Playwright)

One new spec, `tests/e2e/size-caps.spec.ts`:

- **Hard-block path.** Generate a 600 MB all-zero file in `beforeAll`
  via `Buffer.alloc(600_000_000, 0)`, write to a temp path, drop into
  `/tools/pdf-merge`. Assert: error message visible naming the cap;
  no Convert button click was possible; no conversion event fired
  (status stays `"error"`).
- **`beforeunload` path.** Stub a slow conversion (delay-mocked
  engine via test-only injection or a long-running fixture) so the
  "converting" state is observable. While converting, trigger
  `page.reload()`. Assert: `page.on("dialog")` fires once with the
  browser's leave-site prompt.

Cap-check evaluates `File.size` only, so the all-zero file is
sufficient — content is never inspected by the cap logic, only by the
downstream engine, which never runs.

### 6.3 Test-cost discipline

The 600 MB Playwright fixture is generated at runtime, not committed.
Per CLAUDE.md the dev box has 8 GB RAM — the test should explicitly
clean up the temp file in `afterAll` so the runner doesn't leak disk
across reruns. No issue for CI (fresh runner per job).

## 7. Files touched

New:
- `src/engines/_shared/size-limits.ts`
- `src/engines/_shared/size-limits.test.ts`
- `src/hooks/use-active-conversion.ts`
- `src/hooks/use-active-conversion.test.ts`
- `tests/e2e/size-caps.spec.ts`

Modified:
- `src/engines/_shared/types.ts` (add `category` to both engine variants)
- `src/components/tool-frame.tsx` (drop check, button transform, hook call, staged-totals suffix)
- `src/components/tool-frame.test.tsx` (extend with size-cap cases)
- `src/engines/image-convert/index.ts` (`category: "image"`)
- `src/engines/image-to-pdf/index.ts` (`category: "image"`)
- `src/engines/pdf-merge/index.ts` (`category: "pdf"`)
- `src/engines/pdf-split/index.ts` (`category: "pdf"`)
- `src/engines/pdf-to-image/index.ts` (`category: "pdf"`)
- `src/engines/pdf-to-md/index.ts` (`category: "pdf"`)
- `src/engines/docx-to-pdf/index.ts` (`category: "document"`)
- `src/engines/_stub/*` (stub engine helpers used in tests get a
  `category` so existing tests don't break).

## 8. Migration / rollout

No flag, no migration. The `category` field is a TypeScript
compile-time addition — adding it to every engine in the same PR
keeps types consistent at HEAD. CI is the gate.

## 9. Success criteria

1. Dropping a file over the per-category hard cap shows the spec'd
   error and refuses to stage.
2. For multi-cardinality engines, staging an aggregate over the hard
   cap disables the Convert button with the spec'd label and the
   over-cap suffix on the totals row.
3. For both cardinalities, an over-soft staged total transforms the
   Convert button label to include the size and `may be slow`. Single
   click still runs.
4. Reloading or closing the tab during an in-flight conversion shows
   the browser's `beforeunload` prompt. Closing or reloading at any
   other moment does not.
5. All existing tests stay green; new unit + E2E coverage is green.
6. PRD §11.1 thresholds and code constants match — verified by a
   targeted unit test.
