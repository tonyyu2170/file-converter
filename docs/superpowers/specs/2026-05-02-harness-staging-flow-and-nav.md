# Harness staging-flow retrofit + navigation — design

**Date:** 2026-05-02
**Phase:** 6 (covers the harness/UX retrofit; Phase 7 will redesign the home page)
**Scope:** UX/harness change only — no engine logic, no privacy/CSP/build changes.

## Background

Two of the four current tools (`image-convert`, `pdf-split`) declare an
`isReadyToConvert(opts)` predicate. The harness uses that predicate to
**disable the dropzone** until options are valid (`tool-frame.tsx:147`,
`disabled={!isMulti && !ready}`), and then fires `run()` synchronously the
moment a file is dropped (`tool-frame.tsx:110`).

In practice that produces a "configure → drop → auto-run" flow:

- `image-convert`: user must pick output format **before** the dropzone
  accepts a file.
- `pdf-split`: user must type a range **before** the dropzone accepts a file.

User feedback: this is annoying. The natural gesture is "drop the file,
then tell me what to do with it." Multi-cardinality engines
(`pdf-merge`, `image-to-pdf`) already follow that order — drop, stage,
configure, click Convert. We're aligning single-cardinality behavior
with multi.

Independent UX gaps surfaced in the same conversation:

- Home page is a "universal hub" that sniffs MIME on drop and routes;
  produces the unhelpful error "Need 2+ PDFs to merge" when a single PDF
  is dropped (`page.tsx:45`).
- Once you click into a tool, there's no way back to home — the header
  logo is plain text, the sidebar lists tools only.

The home-page redesign is Phase 7. Phase 6 covers the harness retrofit
and the back-to-home affordances only.

## Decisions

### D1. Single-cardinality flow: always stage + button-click (option A1)

On drop, single-cardinality engines stage the file and surface a Convert
button — exactly like multi. No auto-run, even when
`isReadyToConvert(opts)` is true at drop time.

**Rationale:** Predictable, consistent with multi. One extra click for a
hypothetical zero-option engine is a tiny price for a uniform mental model
across all tools.

### D2. Dropzone stays visible; re-drop replaces (option B1)

After a file is staged, the dropzone remains visible in the same spot.
Dropping (or selecting via the file picker) **replaces** the staged file
for single-cardinality engines. A small "current file: <name> [ clear ]"
display appears above the dropzone so the user knows what's staged.

**Rationale:** Re-dropping is a natural gesture; minimizes state
transitions and avoids hide/show flicker. Clearing also clears any
previous results.

### D3. Convert button always rendered for single, disabled until ready

The Convert button is rendered on mount for single-cardinality engines
that have an `isReadyToConvert` predicate or an `OptionsPanel` (i.e., the
engines that need configuration). It's disabled until **both**
conditions hold:

- `stagedFiles.length === 1` (a file is staged), and
- `engine.isReadyToConvert?.(options) ?? true` returns true.

For consistency with the existing multi behavior (`tool-frame.tsx:153`),
the button is also disabled while `status === "converting"`.

**Open question deferred to implementation:** an engine with no
`OptionsPanel` and no `isReadyToConvert` (none exist today) would still
get a Convert button under D1. That's correct per A1; we're not
adding an opt-out.

### D4. Back-to-home: header logo as Link + sidebar "// HOME" group (option D both)

- `Header.tsx`: `FILE_CONVERTER.LOCAL` becomes a `Link` to `/`.
- `Sidebar.tsx`: add a new group `// HOME` above `// IMAGES` with a
  single entry pointing to `/`.

**Rationale:** Logo-as-home is a strong web convention; the sidebar
entry is discoverable and consistent with the existing tool grouping.

## Invariants preserved

- **Engine pattern unchanged.** No edits to `SingleInputEngine` /
  `MultiInputEngine` / `EngineMeta` types. Only the harness
  (`ToolFrame`) reads engine metadata differently.
- **`isReadyToConvert` semantics unchanged.** Still a function from
  options → boolean. Now it gates the Convert button instead of the
  dropzone.
- **Multi-cardinality flow unchanged.** No code path used only by
  multi engines is touched.
- **Privacy / CSP / static export untouched.** No new imports, no new
  workers, no network calls.
- **Cross-route file handoff (`stageFiles` / `takeStagedFiles`) unchanged.**
  After Phase 7 lands the only caller will be removed, but the plumbing
  stays in place for future flows. In Phase 6 the harness mount-time
  consumption still routes staged files into the staging area
  (single or multi), which is exactly what already happens for multi.

## UX details

### Staged-file display (single-cardinality)

Above the dropzone, when `stagedFiles.length === 1`:

```
current file: foo.heic    [ clear ]
```

Same monospace + uppercase-tracking aesthetic as the rest of the harness
chrome. Clicking `[ clear ]` empties `stagedFiles` and clears any prior
result `items`. (Status returns to `ready`.)

### Drop → results → re-drop sequence

1. Drop file → file is staged (no convert).
2. User configures options.
3. Click Convert → `status: converting` → `status: done`, `items`
   populated, ResultList renders.
4. Staged file persists; user can:
   - Click Convert again (e.g., after changing options) to re-run.
   - Drop a new file → replaces staged file, clears `items` and `errorMessage`,
     `status` → `ready`.
   - Click `[ clear ]` → empties staging, clears `items`/`errorMessage`,
     `status` → `ready`.

**Mid-convert affordances:** while `status === "converting"`, the
`[ clear ]` button is disabled. Dropping a new file mid-convert is still
allowed (matches existing multi behavior — the in-flight conversion
runs to completion against the file it was started with, and the new
drop replaces staging for the next click). Disabling `[ clear ]` during
convert avoids the confusing case where the user empties staging
mid-flight and is then surprised by a result rendering against an empty
staging area.

### Convert button placement

Same place it lives today for multi engines: directly under the dropzone.
Engines that don't define `isReadyToConvert` AND don't define
`OptionsPanel` would still get a button per D1; the button enables as
soon as a file is staged.

## Test plan

### Component tests (`src/components/tool-frame.test.tsx`)

- **Update** `"holds a staged file until isReadyToConvert flips to true, then runs conversion"` — this currently asserts the auto-run-when-ready behavior. After this phase that auto-run no longer exists. Rewrite as: staged file remains; Convert button enables when `isReadyToConvert` flips true; clicking it fires `convert`.
- **Update** `"disables the DropZone when isReadyToConvert returns false"` — after this phase the dropzone is no longer disabled by `isReadyToConvert` for single-cardinality. Replace with: Convert button is disabled when `isReadyToConvert` returns false, regardless of staging state.
- **Add** drop on single-cardinality stages the file and does NOT call `convert`.
- **Add** Convert button click on single-cardinality fires `convert` with the staged file.
- **Add** re-drop on single-cardinality replaces the staged file and clears prior `items`/error state.
- **Add** `[ clear ]` button on single-cardinality empties staging and clears prior `items`/error state.
- **Add** cross-route handoff for single-cardinality populates staging without firing `convert` (mirrors the existing multi handoff test).

### Component tests (Header / Sidebar)

- **Add** `header.test.tsx`: logo renders an `<a href="/">`.
- **Update** `sidebar.test.tsx` (or add if missing): a `// HOME` link to `/` is present above the IMAGES group.

### E2E updates (mandatory in this phase)

The single-cardinality flow change breaks specs that rely on auto-run
after drop. They must be updated in Phase 6 to keep the suite green.

- **`tests/e2e/image-convert.spec.ts`** (3 tests): each one currently
  selects output format → calls `setInputFiles` → expects auto `[ DONE ]`.
  Update each to: select format → `setInputFiles` → **click Convert** →
  expect `[ DONE ]`. Also remove the
  `data-state="disabled"` assertion at line 11 (no longer true post-Phase-6).
- **`tests/e2e/pdf-split.spec.ts`** (5 tests): the four happy/error
  tests currently fill the range → drop file → expect auto-fire. Update
  to: drop file → fill range → **click Convert** → expect outcome. Strip
  the obsolete "CRITICAL ORDERING" comments at lines 12-16. The fifth
  test ("inline syntax error blocks Convert") doesn't drop a file and
  stays valid as-is.
- **`tests/e2e/homepage-handoff.spec.ts`** (2 tests): currently rely on
  the home-page hub routing on drop AND on auto-run after format-select.
  The hub still exists in Phase 6 (it's killed in Phase 7), so handoff
  still works — but the auto-fire-after-format-select assertion breaks.
  Update each to: handoff to image-convert → select format → **click Convert**
  → expect `[ DONE ]`. Also drop the
  `data-state="disabled"` assertion. (Phase 7 will rewrite or remove
  these tests entirely when the hub goes away.)
- **`tests/e2e/multi-file-handoff.spec.ts`** and
  **`tests/e2e/multi-file-handoff-pdf.spec.ts`**: unchanged — they exercise
  the multi-cardinality flow which Phase 6 doesn't touch. (Phase 7 will
  rewrite when the hub goes away.)
- **`tests/e2e/image-to-pdf.spec.ts`**, **`pdf-merge.spec.ts`**, all
  `privacy-regression-*.spec.ts`: unchanged.

## Out of scope

- **Home-page redesign** — Phase 7.
- **Removing `stageFiles` / `takeStagedFiles`** — leave plumbing.
- **Active-link styling on sidebar** — out of scope; current sidebar has
  no active-link styling and we won't introduce it here.
- **Disabling the dropzone during `status === "converting"`** — current
  multi behavior allows drops during convert; we're not changing that.

## Files touched (estimated)

- `src/components/tool-frame.tsx` — main change (single-cardinality flow)
- `src/components/tool-frame.test.tsx` — test rewrites + additions
- `src/components/layout/header.tsx` — logo → Link
- `src/components/layout/sidebar.tsx` — add HOME entry
- `src/components/layout/header.test.tsx` — new (or extend)
- `src/components/layout/sidebar.test.tsx` — new (or extend)
- `tests/e2e/image-convert.spec.ts` — add Convert click after drop (if exists)
- `tests/e2e/pdf-split.spec.ts` — add Convert click after drop (if exists)
- `tests/e2e/image-to-pdf.spec.ts`, `tests/e2e/pdf-merge.spec.ts` — unchanged
  (already use Convert button click)
