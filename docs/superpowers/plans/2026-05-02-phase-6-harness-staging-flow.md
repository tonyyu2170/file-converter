# Phase 6 — Harness staging-flow retrofit + back-to-home navigation

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task with two-stage review on substantive (architecture-touching) tasks and combined opus review on mechanical extensions. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retrofit `ToolFrame` so single-cardinality engines stage files
on drop and run via an explicit Convert button (matching multi
behavior). Add back-to-home affordances (clickable header logo, sidebar
HOME entry). No engine code changes; no privacy/CSP/build changes.

**Architecture:** `ToolFrame` already uses a staged-files + Convert-button
flow for multi-cardinality engines. We unify that flow for single
engines too — drop appends/replaces in `stagedFiles`, `useEffect` no
longer auto-fires `run`, and the Convert button is rendered for both
cardinalities. A new `[ clear ]` affordance surfaces above the dropzone
when a single-cardinality engine has a staged file. Header logo becomes
a `Link`; Sidebar gets a new `// HOME` group.

**Tech Stack:** No new dependencies. Existing Next.js 15 / React 19 /
Tailwind v4 / Vitest / Playwright stack.

**Spec:** [`docs/superpowers/specs/2026-05-02-harness-staging-flow-and-nav.md`](../specs/2026-05-02-harness-staging-flow-and-nav.md).

**Branch:** `phase-6-harness-staging-flow` (create off `main` after spec/plan PR merges).

**Substantive tasks (full two-stage sonnet+opus review):** 2 (`ToolFrame`
retrofit). **Mechanical tasks (combined opus review):** 1, 3, 4, 5, 6, 7.

**Critical ordering dependencies:**
- Task 1 (spec/plan) MUST land first — every later task references the spec.
- Task 2 (`ToolFrame` retrofit) MUST land before Tasks 5 and 6 — the
  E2E updates depend on the new Convert-button flow.
- Tasks 3 (Header) and 4 (Sidebar) are independent of Task 2 and can
  land in any order before the E2E pass.
- Task 7 (full gate run on the branch) is the final verification; runs
  after all other tasks.

**Branch discipline reminder for implementer subagents:**
- Run `git branch --show-current` BEFORE and AFTER every commit. Verify it reads `phase-6-harness-staging-flow`.
- NEVER run: `git branch -m`, `git branch -M`, `git checkout <branch>`, `git switch <branch>`, `git reset --hard`, `git push`, `git push --force`. NEVER use `--no-verify`.
- Allowed: `git status`, `git diff`, `git log`, `git branch --show-current`, `git add <specific files>`, `git commit`.

---

## Task 1: Land spec + plan on main (this PR)

**Goal:** Get the spec and plan reviewed and merged so subsequent tasks have a stable reference.

**Files:**
- Add: `docs/superpowers/specs/2026-05-02-harness-staging-flow-and-nav.md`
- Add: `docs/superpowers/plans/2026-05-02-phase-6-harness-staging-flow.md`

- [ ] **Step 1: Verify branch + clean tree**

```bash
git branch --show-current  # expect: a docs branch (e.g. phase-6-spec-and-plan), NOT main
git status                 # expect: the two new files staged or untracked, nothing else
```

- [ ] **Step 2: Commit and open PR**

```bash
git add docs/superpowers/specs/2026-05-02-harness-staging-flow-and-nav.md docs/superpowers/plans/2026-05-02-phase-6-harness-staging-flow.md
git commit -m "docs(phase-6): spec + plan for harness staging-flow retrofit"
```

PR body: brief summary; link to spec; note that no code is touched in this PR.

---

## Task 2: ToolFrame single-cardinality stage-and-button retrofit

**Goal:** Single-cardinality engines stage files on drop, surface a Convert button, and only run on explicit click. Re-drop replaces the staged file and clears prior result state. A `[ clear ]` affordance empties staging.

**Files:**
- Modify: `src/components/tool-frame.tsx`
- Modify: `src/components/tool-frame.test.tsx`

- [ ] **Step 1: Verify branch**

```bash
git branch --show-current  # expect: phase-6-harness-staging-flow
```

If on the wrong branch, STOP and ask the user. Do not run `git checkout`.

- [ ] **Step 2: Refactor `ToolFrame` for unified staging**

Required changes in `src/components/tool-frame.tsx`:

1. **Drop dropzone disabling on `ready`.** Replace `disabled={!isMulti && !ready}` with `disabled={false}` (or just remove the prop). Dropzone is enabled regardless of cardinality / ready state.
2. **Single-cardinality drop stages.** Change `handleDrop`: for `cardinality === "single"`, replace `stagedFiles` with `[firstFile]` (single is max-1) and clear prior `items`/`errorMessage`/`singleSourceFile`/status (status → `"ready"`). Multi behavior unchanged (append).
3. **Mount-time pendingFiles → stagedFiles for single too.** Update the `useEffect` that consumes `pendingFiles`: for single, route into `stagedFiles` (same as multi) rather than auto-firing `run`. Remove the `ready`-gated auto-fire entirely.
4. **Convert button always rendered.** Drop the `isMulti && (...)` wrapper around the Convert button; render unconditionally. Disabled rule: `stagedFiles.length === 0 || !ready || status === "converting"`. Same for both cardinalities.
5. **`handleConvertClick` for single.** Pass `[stagedFiles[0]]` (or, equivalently, `stagedFiles`) to `run`; the function already narrows on cardinality.
6. **`[ clear ]` affordance for single.** When `cardinality === "single"` and `stagedFiles.length === 1`, render a small block above the dropzone. The button is disabled while `status === "converting"` (avoids the "I cleared but a result still showed up" confusion):

   ```jsx
   <div className="mb-3 flex items-center gap-3 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
     <span>current file: <span className="text-[var(--color-fg-strong)]">{stagedFiles[0].name}</span></span>
     <button
       type="button"
       data-testid="clear-staged-file"
       disabled={status === "converting"}
       onClick={() => {
         setStagedFiles([]);
         setItems([]);
         setErrorMessage(null);
         setSingleSourceFile(null);
         setStatus("ready");
       }}
       className="text-[var(--color-accent)] hover:text-[var(--color-fg-strong)] disabled:text-[var(--color-fg-very-muted)]"
     >
       [ clear ]
     </button>
   </div>
   ```

7. **`archiveBasename` source for single.** Currently uses `singleSourceFile` (set inside `run` for single). Update to prefer `stagedFiles[0]` when present; fall back to `singleSourceFile` after the staged file is consumed by `run`. (Both should be the same instance — `setSingleSourceFile(f)` runs from `run([stagedFiles[0]], ...)` — but using `stagedFiles[0]` makes the source explicit.)

- [ ] **Step 3: Update existing tests in `src/components/tool-frame.test.tsx`**

Two existing single-cardinality assertions become invalid; rewrite them:

1. `"disables the DropZone when isReadyToConvert returns false"` — replace assertion target. The dropzone is no longer disabled by `isReadyToConvert`. Rename test to `"disables the Convert button when isReadyToConvert returns false"` and assert `screen.getByTestId("convert-button")` is `toBeDisabled()`. Note: under the new flow the Convert button is also disabled when `stagedFiles.length === 0`, so stage a file first via `stageFiles([file])` before asserting.
2. `"holds a staged file until isReadyToConvert flips to true, then runs conversion"` — rewrite. New assertion: file is staged on mount; `convert` is NOT called (no auto-fire); flipping `ready` to true enables the Convert button; clicking it fires `convert`.
3. `"enables the DropZone when isReadyToConvert returns true (or is undefined)"` — keep, but the assertion is now a no-op truth (dropzone is always enabled for single). Either delete or rephrase as `"the DropZone is enabled regardless of isReadyToConvert for single-cardinality engines"`.

- [ ] **Step 4: Add new tests in `src/components/tool-frame.test.tsx`**

- `"single-cardinality drop stages the file and does NOT call convert"`: drop a file via `fireEvent.drop`; assert `convert` not called; assert `clear-staged-file` testid is visible.
- `"single-cardinality Convert button click fires convert with staged file"`: stage a file via `stageFiles([file])`; assert Convert button enabled; click; assert `convert` called once with `(file, opts, signal)`.
- `"single-cardinality re-drop replaces staged file and clears prior state"`: drop file A; drop file B; assert only file B's name visible in `current file:` block; assert `convert` not called for either drop.
- `"single-cardinality clear-staged-file empties staging"`: stage a file; click `[ clear ]`; assert no `current file:` block; assert Convert button disabled.
- `"single-cardinality clear-staged-file is disabled while converting"`: stage a file with a slow-resolving `convert` mock (e.g., a never-settling promise); click Convert; assert `clear-staged-file` is `toBeDisabled()` while status is `converting`.
- `"cross-route handoff for single-cardinality populates staging without firing convert"`: mirror the existing multi handoff test but with a single-cardinality engine; assert `current file:` shows the staged file's name and `convert` is not called.

- [ ] **Step 5: Run gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: typecheck/lint pass; all tool-frame tests pass; no other test regresses (multi flow unchanged, so other engine tests should be unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/components/tool-frame.tsx src/components/tool-frame.test.tsx
git commit -m "feat(harness): single-cardinality engines stage on drop, run on click

Removes the auto-run-on-drop behavior for single-cardinality engines.
Drop now stages the file (max 1); user configures options; clicks
Convert. Re-drop replaces the staged file and clears any prior
result. A clear button surfaces above the dropzone when a file is
staged. Multi-cardinality flow unchanged."
```

---

## Task 3: Header logo as Link

**Goal:** Make the `FILE_CONVERTER.LOCAL` header text a `next/link` to `/`.

**Files:**
- Modify: `src/components/layout/header.tsx`
- Add: `src/components/layout/header.test.tsx`

- [ ] **Step 1: Edit `src/components/layout/header.tsx`**

Wrap the logo span in `<Link href="/">` (import from `next/link`). Keep the existing class names. Add `data-testid="header-home-link"` for the test.

- [ ] **Step 2: Add `src/components/layout/header.test.tsx`**

Single test: render `<Header />`; assert `getByTestId("header-home-link")` has attribute `href="/"`.

- [ ] **Step 3: Gates**

```bash
pnpm typecheck && pnpm lint && pnpm test src/components/layout/header.test.tsx
```

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/header.tsx src/components/layout/header.test.tsx
git commit -m "feat(layout): make header logo a link to home"
```

---

## Task 4: Sidebar HOME entry

**Goal:** Add a `// HOME` group above `// IMAGES` with a single entry pointing to `/`.

**Files:**
- Modify: `src/components/layout/sidebar.tsx`
- Add: `src/components/layout/sidebar.test.tsx`

- [ ] **Step 1: Edit `src/components/layout/sidebar.tsx`**

Add a `home` entry to `TOOLS` with `group: "HOME"`. The reduce already groups by `group`. Default JS object iteration order is insertion order, so adding HOME first puts it on top — but rely instead on a defined render order:

Refactor the render to iterate a known group order rather than `Object.entries(groups)`:

```ts
const GROUP_ORDER = ["HOME", "IMAGES", "PDFS"] as const;
// ...
{GROUP_ORDER.map((group) => {
  const items = groups[group];
  if (!items?.length) return null;
  // ... existing render
})}
```

Add `data-testid="sidebar-home-link"` to the home Link for the test.

- [ ] **Step 2: Add `src/components/layout/sidebar.test.tsx`**

Single test: render `<Sidebar />`; assert `getByTestId("sidebar-home-link")` has `href="/"`; assert `// HOME` text is rendered.

- [ ] **Step 3: Gates**

```bash
pnpm typecheck && pnpm lint && pnpm test src/components/layout/sidebar.test.tsx
```

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/sidebar.tsx src/components/layout/sidebar.test.tsx
git commit -m "feat(layout): add home entry to sidebar"
```

---

## Task 5: Update single-engine E2E specs for new flow

**Goal:** Update `image-convert.spec.ts`, `pdf-split.spec.ts`, and `homepage-handoff.spec.ts` to add Convert-button clicks and remove obsolete dropzone-disabled assertions.

**Files:**
- Modify: `tests/e2e/image-convert.spec.ts`
- Modify: `tests/e2e/pdf-split.spec.ts`
- Modify: `tests/e2e/homepage-handoff.spec.ts`

- [ ] **Step 1: `tests/e2e/image-convert.spec.ts` (3 tests)**

For each of the three tests:
1. Remove the assertion that dropzone is `data-state="disabled"` before format selection (line ~11).
2. Remove the assertion that dropzone becomes enabled after format selection (line ~16).
3. After `setInputFiles(...)`, add:

```ts
await page.getByTestId("convert-button").click();
```

Then keep the existing `[ DONE ]` and download assertions.

- [ ] **Step 2: `tests/e2e/pdf-split.spec.ts` (4 of 5 tests)**

For tests "multi-token range produces N output PDFs", "single-token range produces 1 PDF", "encrypted PDF surfaces error banner", "out-of-bounds range surfaces error banner":
1. Reorder: drop file FIRST, then fill range. (`setInputFiles` then `getByTestId("range-input").fill(...)`.)
2. Strip the "CRITICAL ORDERING" comments at lines 12-16, 58, 83, 100 — they describe the obsolete flow.
3. After both staging and range fill, add `await page.getByTestId("convert-button").click();`.

The fifth test ("inline syntax error blocks Convert") does NOT drop a file. Update only its closing assertion, if needed: status stays `READY`, Convert button is disabled (you can add an explicit assertion: `await expect(page.getByTestId("convert-button")).toBeDisabled();`).

- [ ] **Step 3: `tests/e2e/homepage-handoff.spec.ts` (2 tests)**

For both tests:
1. Remove the `await expect(page.getByTestId("drop-zone")).toHaveAttribute("data-state", "disabled");` assertion.
2. After `selectOption("png")`, add `await page.getByTestId("convert-button").click();` before the `[ DONE ]` assertion.

The home-page hub still routes in Phase 6; this test continues to exercise cross-route handoff. Phase 7 will rewrite or remove these tests when the hub is killed.

- [ ] **Step 4: Run E2E suite**

```bash
pnpm test:e2e
```

Expected: all e2e tests pass on Chromium + Firefox + WebKit. (If WebKit times out on a slow box, re-run that single spec.) `multi-file-handoff.spec.ts`, `multi-file-handoff-pdf.spec.ts`, `pdf-merge.spec.ts`, `image-to-pdf.spec.ts`, `privacy-regression-*.spec.ts` should all be green without changes.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/image-convert.spec.ts tests/e2e/pdf-split.spec.ts tests/e2e/homepage-handoff.spec.ts
git commit -m "test(e2e): update single-engine specs for stage+click flow"
```

---

## Task 6: Manual Chrome smoke test

**Goal:** Drive the changes through Chrome to verify UX feel — automated tests cover correctness, this covers the hand-on-mouse experience.

- [ ] **Step 1: Run dev server**

```bash
pnpm dev  # NOT --turbopack
```

- [ ] **Step 2: Walk the four affected paths**

For each, verify the new flow feels right and there are no console errors:

1. **`/tools/image-convert`**: drop a JPEG without selecting format → file shows in `current file:` block, Convert button disabled. Select PNG → Convert enables. Click → conversion runs, download appears. Drop a different file → previous result clears, new file is staged. Click `[ clear ]` → staging empties.
2. **`/tools/pdf-split`**: same pattern — drop a PDF without typing range → staged, button disabled. Type range → button enables. Click → conversion runs.
3. **`/tools/pdf-merge`** and **`/tools/image-to-pdf`**: confirm no regression — multi flow still works (drop multiple, Convert enabled, click runs).
4. **Header click**: from any tool page, click `FILE_CONVERTER.LOCAL` → routes to `/`. **Sidebar HOME**: click `home` entry from any tool page → routes to `/`.

- [ ] **Step 3: Capture screenshots (optional)**

If anything looks off (alignment, spacing, button proximity), pause and discuss before pushing.

(No commit for this task — it's a verification step.)

---

## Task 7: Final gate sweep + PR open

**Goal:** Full local gate sweep on the branch; open the PR.

- [ ] **Step 1: Verify branch + status**

```bash
git branch --show-current  # expect: phase-6-harness-staging-flow
git status                 # expect: clean
git log main..HEAD --oneline  # expect: 4 commits (Tasks 2, 3, 4, 5)
```

- [ ] **Step 2: Full gate sweep**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e
```

Expected: all green. Build produces `out/` static export with same routes; no new chunks (we added no new modules); CSP headers in `vercel.json` untouched.

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin phase-6-harness-staging-flow
gh pr create --title "Phase 6: harness staging-flow retrofit + back-to-home nav" --body "$(cat <<'EOF'
## Summary

- Single-cardinality engines (image-convert, pdf-split) now stage files
  on drop and run via an explicit Convert button, mirroring multi
  behavior. Drop no longer auto-fires conversion.
- Re-drop replaces the staged file and clears prior result state. A
  `[ clear ]` affordance above the dropzone empties staging.
- Header logo is now a Link to `/`. Sidebar gains a `// HOME` entry.

Spec: `docs/superpowers/specs/2026-05-02-harness-staging-flow-and-nav.md`
Plan: `docs/superpowers/plans/2026-05-02-phase-6-harness-staging-flow.md`

Phase 7 will follow with the home-page redesign (kills the universal
hub, replaces with a designed landing page).

## Test plan

- [x] `pnpm typecheck`
- [x] `pnpm lint`
- [x] `pnpm test` — tool-frame tests rewritten, header/sidebar tests added
- [x] `pnpm build` — static export, no new chunks
- [x] `pnpm test:e2e` — 3 single-engine specs updated for stage+click
- [x] Manual Chrome walkthrough of all four tools + nav
EOF
)"
```

Expected: PR URL is returned. Do NOT merge — that's the user's call.
