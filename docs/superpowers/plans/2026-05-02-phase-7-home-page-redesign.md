# Phase 7 — Home page redesign + universal-hub retirement

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task with two-stage review on substantive (architecture-touching) tasks and combined opus review on mechanical extensions. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the universal drop hub at `/` with a real landing page (hero + 2×2 tool grid) and aggressively delete the cross-route file handoff infrastructure that the hub was the sole consumer of. Single PR (no separate docs PR — see Phase 6's spec for the rationale on splitting; this phase is small enough to ship together).

**Architecture:** Pure deletion + one new static page. `src/app/page.tsx` becomes a server component (no `"use client"` needed — no state, no events, no effects; just render `<Link>` cards). `src/lib/handoff.ts` and the harness's mount-time `useEffect` that consumed it both go. ToolFrame's existing staging path (drop → `stagedFiles`) is the only path remaining; nothing else in the app stages files cross-route.

**Tech Stack:** No new dependencies. Existing Next.js 15 / React 19 / Tailwind v4 / Vitest / Playwright stack.

**Spec:** [`docs/superpowers/specs/2026-05-02-home-page-redesign.md`](../specs/2026-05-02-home-page-redesign.md).

**Branch:** `phase-7-home-page-redesign` (create off `main` after Phase 6 has merged — already merged as of `c7771a1`).

**Substantive tasks (full two-stage sonnet+opus review):** 3 (`tool-frame.tsx` handoff removal — touches the harness). **Mechanical tasks (combined opus review):** 1, 2, 4, 5, 6.

**Critical ordering dependencies:**

- Task 1 (commit spec + plan) MUST land first on the branch — every later task references the spec.
- Task 2 (`page.tsx` rewrite + new home-page test + new home-page E2E spec) is independent of Task 3 — they can land in any order, but I want them sequential to make review cleaner.
- Task 3 (`tool-frame.tsx` handoff removal + `handoff.ts/test.ts` deletion + tool-frame.test.tsx updates) MUST land before Task 4 — Task 4's E2E deletions assume `tool-frame.tsx` no longer needs the cross-route plumbing.
- Task 4 (delete 3 obsolete E2E specs) is mechanical, runs after Task 3.
- Task 5 (manual Chrome smoke) is verification only.
- Task 6 (final gates + push + open PR) runs last.

**Branch discipline reminder for implementer subagents:**

- Run `git branch --show-current` BEFORE and AFTER every commit. Verify it reads `phase-7-home-page-redesign`.
- NEVER run: `git branch -m`, `git branch -M`, `git checkout <branch>`, `git switch <branch>`, `git reset --hard`, `git push`, `git push --force`. NEVER use `--no-verify`.
- Allowed: `git status`, `git diff`, `git log`, `git branch --show-current`, `git add <specific files>`, `git commit`, `git rm <specific files>`.

---

## Task 1: Commit spec + plan on the implementation branch

**Goal:** First commit on the branch is the spec + plan. Reviewer can read design intent before reading code.

**Files:**
- Add: `docs/superpowers/specs/2026-05-02-home-page-redesign.md`
- Add: `docs/superpowers/plans/2026-05-02-phase-7-home-page-redesign.md`

- [ ] **Step 1: Verify branch + clean tree**

```bash
git branch --show-current  # expect: phase-7-home-page-redesign
git status                 # expect: the two new files untracked, nothing else
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-02-home-page-redesign.md docs/superpowers/plans/2026-05-02-phase-7-home-page-redesign.md
git commit -m "docs(phase-7): spec + plan for home page redesign"
```

---

## Task 2: New home page + co-located test + E2E nav spec

**Goal:** Replace the universal hub at `/` with the brutalist landing page from the spec.

**Files:**
- Modify: `src/app/page.tsx` (full rewrite)
- Add: `src/app/page.test.tsx`
- Add: `tests/e2e/home-page.spec.ts`

- [ ] **Step 1: Verify branch**

`git branch --show-current` → `phase-7-home-page-redesign`. STOP if wrong.

- [ ] **Step 2: Rewrite `src/app/page.tsx`**

The full markup is frozen in spec section D5. Implementation must match it exactly:

- Server component (no `"use client"`).
- `TOOLS` is a const inside the file with the four entries from spec D3 (id, title, description, href). Order matches sidebar (image-convert, image-to-pdf, pdf-merge, pdf-split).
- Hero `<h1>` text: `// CONVERT FILES. LOCALLY.`
- Hero `<p>` text: the three-sentence privacy claim from spec D2.
- `// tools` label above the grid (mb-3, text-xs, fg-very-muted, tracking-[0.1em]).
- Grid: `grid-cols-1 gap-3 md:grid-cols-2`.
- Each card: `<Link>` with `data-testid={`tool-card-${tool.id}`}`, hairline border, `transition-colors`, hover border to accent.
- No fetch, no state, no useEffect, no client-only hooks.

- [ ] **Step 3: Add `src/app/page.test.tsx`**

Co-locate next to `page.tsx` (matches `src/components/tool-frame.test.tsx` next to `tool-frame.tsx`). Vitest + React Testing Library.

Tests:

1. Renders the hero headline `// CONVERT FILES. LOCALLY.`
2. Renders the privacy claim text (assert a stable substring like `"files never leave your device"`)
3. Renders 4 tool cards, each with the right testid, title, description, and href:
   - `tool-card-image-convert` → "image convert" / "heic, png, jpg, webp · convert between formats" / `/tools/image-convert`
   - `tool-card-image-to-pdf` → "image→pdf" / "combine multiple images into a single pdf" / `/tools/image-to-pdf`
   - `tool-card-pdf-merge` → "merge" / "combine multiple pdfs into one" / `/tools/pdf-merge`
   - `tool-card-pdf-split` → "split" / "extract page ranges from a pdf" / `/tools/pdf-split`

If matching the title against literal text fails because of HTML entity rendering (e.g., `→` in `image→pdf`), use the testid + `toHaveTextContent` instead of `getByText`.

- [ ] **Step 4: Add `tests/e2e/home-page.spec.ts`**

Single test: `goto('/')`, assert hero headline visible, then click each tool card and assert URL navigates to the right `/tools/<id>` page (use `page.waitForURL`). After each navigation, `goBack()` to return to `/` for the next click. Or four separate small tests — pick whichever reads cleaner; the latter avoids back-button state.

Don't assert anything about the destination tool page beyond URL — that's the per-engine specs' job.

- [ ] **Step 5: Run gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: typecheck/lint clean. Unit test count: was 214 after Phase 6; new home page test adds ~5; tool-frame test count unchanged for now (Task 3 will reduce it). So: roughly 219.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/app/page.test.tsx tests/e2e/home-page.spec.ts
git commit -m "feat(home): replace universal hub with brutalist landing page

Hero (privacy claim) + 2x2 tool grid. Each card links directly
to its tool. No drop sniffing, no auto-routing, no error states
for 'wrong shape'."
```

(Mind the 72-char body line limit.)

---

## Task 3: Remove handoff infrastructure

**Goal:** Delete the now-unused cross-route file handoff: `src/lib/handoff.ts`, its test, the `takeStagedFiles` consumption in `tool-frame.tsx`, and the two cross-route handoff tests in `tool-frame.test.tsx`.

**Files:**
- Delete: `src/lib/handoff.ts`
- Delete: `src/lib/handoff.test.ts`
- Modify: `src/components/tool-frame.tsx` (remove handoff plumbing)
- Modify: `src/components/tool-frame.test.tsx` (remove 2 cross-route tests, adjust `afterEach`)

- [ ] **Step 1: Verify branch**

`git branch --show-current` → `phase-7-home-page-redesign`. STOP if wrong.

- [ ] **Step 2: Confirm no other consumers**

Before deleting, grep for any other imports of `@/lib/handoff` or `stageFiles` / `takeStagedFiles`. Expected callers after Phase 6 + Task 2: only `tool-frame.tsx` (uses `takeStagedFiles`) and the test file we're updating. If anything else imports these, STOP and report — the spec assumed the hub was the sole consumer.

```bash
grep -rn "from \"@/lib/handoff\"" src tests
grep -rn "stageFiles\|takeStagedFiles" src tests
```

- [ ] **Step 3: Edit `src/components/tool-frame.tsx`**

Remove:
- `import { takeStagedFiles } from "@/lib/handoff";`
- `const [pendingFiles, setPendingFiles] = useState<File[]>([]);`
- The `consumedRef` ref.
- The mount-time `useEffect` that consumes `takeStagedFiles()` and seeds `pendingFiles`.
- The `useEffect` that watches `pendingFiles` and routes them into `stagedFiles` (the second `useEffect` after the mount one).

What stays: the `handleDrop` callback (still routes drop events into `stagedFiles`), the `resetSingleStaging` helper (still used by `handleDrop` and `handleClearStaged`), everything else.

After this change, `useRef` may no longer be imported anywhere in this file. Drop unused imports.

- [ ] **Step 4: Edit `src/components/tool-frame.test.tsx`**

Remove these two tests (find by their exact name strings):
- `"stages a handed-off file on mount but does not auto-fire convert; click runs it once ready"` (single-cardinality cross-route handoff)
- `"staged file from cross-route handoff populates a multi-cardinality engine's staging area without firing convert"` (multi-cardinality cross-route handoff)

The `afterEach(() => { takeStagedFiles(); ... })` hook drains the staged-files slot. After we delete `handoff.ts` this import breaks. Remove the `takeStagedFiles()` call from `afterEach`. If `vi.restoreAllMocks()` is the only other thing in the hook, keep just that.

Also remove the `import { stageFiles, takeStagedFiles } from "@/lib/handoff";` line at the top.

If any remaining test still references `stageFiles` or `takeStagedFiles`, that's a sign the spec missed something — STOP and report.

- [ ] **Step 5: Delete handoff files**

```bash
git rm src/lib/handoff.ts src/lib/handoff.test.ts
```

- [ ] **Step 6: Run gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: typecheck/lint clean. Unit test count drops by 2 (cross-route tests) + 5 (handoff.test.ts file deleted, 5 tests). Was ~219 after Task 2 → expected ~212.

- [ ] **Step 7: Commit**

```bash
git add src/components/tool-frame.tsx src/components/tool-frame.test.tsx src/lib/handoff.ts src/lib/handoff.test.ts
git commit -m "refactor: remove cross-route file handoff plumbing

The home-page hub was the only producer of staged files. With
the hub gone (Phase 7 Task 2), nothing calls stageFiles() and
takeStagedFiles() always returns []. Delete the module and the
mount-time consumption useEffect in ToolFrame."
```

(`git add` includes the deleted files so the commit records the deletion explicitly.)

---

## Task 4: Delete obsolete E2E specs

**Goal:** Three E2E specs exercised the universal hub flow. After Task 2 they fail because they `goto('/')` and try to drop on a dropzone that no longer exists. Delete them.

**Files:**
- Delete: `tests/e2e/homepage-handoff.spec.ts`
- Delete: `tests/e2e/multi-file-handoff.spec.ts`
- Delete: `tests/e2e/multi-file-handoff-pdf.spec.ts`

- [ ] **Step 1: Verify branch**

`git branch --show-current` → `phase-7-home-page-redesign`.

- [ ] **Step 2: Delete + commit**

```bash
git rm tests/e2e/homepage-handoff.spec.ts tests/e2e/multi-file-handoff.spec.ts tests/e2e/multi-file-handoff-pdf.spec.ts
```

- [ ] **Step 3: Run E2E suite**

```bash
pnpm test:e2e
```

Expected: every remaining test passes. Pre-existing flakes from Phase 6 (`pdf-split.spec.ts:111` webkit, `pdf-merge.spec.ts:55` chromium) MAY reappear under load — note in PR body, don't fix here. The new `home-page.spec.ts` from Task 2 should be green across all three browsers.

- [ ] **Step 4: Commit**

```bash
git commit -m "test(e2e): remove obsolete universal-hub specs

The homepage drop-and-route flow no longer exists (Phase 7
Task 2). The three specs that exercised it are dead."
```

---

## Task 5: Manual Chrome smoke test (controller, not subagent)

**Goal:** Verify visual + interaction feel of the new home page in a real browser. Automated tests cover correctness; this catches alignment, spacing, and hover-state oddities.

This task is performed by the controller (you, the human running this plan), NOT a subagent. No commit.

- [ ] **Step 1: Run dev server**

```bash
pnpm dev   # NOT --turbopack
```

- [ ] **Step 2: Walk the page**

Visit `http://localhost:3000`:

1. Hero renders with `// CONVERT FILES. LOCALLY.` headline in accent orange, privacy claim below in fg-muted.
2. `// tools` label sits above the grid in fg-very-muted.
3. Four tool cards render in a 2×2 grid (desktop) or single column (mobile — resize browser to verify).
4. Hover each card → border becomes accent orange, no layout shift.
5. Tab through cards → focus ring (accent orange, 1px outline, 2px offset) on each in DOM order.
6. Click each card → navigates to the right tool page.
7. Click `FILE_CONVERTER.LOCAL` in header from any tool page → returns to `/`.
8. Click `~/` in sidebar from any tool page → returns to `/`.

If anything looks off, screenshot and discuss before pushing.

---

## Task 6: Final gate sweep + push + open PR

**Goal:** Full local gate sweep, push branch, open PR.

- [ ] **Step 1: Verify branch + log**

```bash
git branch --show-current  # phase-7-home-page-redesign
git log main..HEAD --oneline  # expect: 4 commits (Tasks 1, 2, 3, 4)
git status  # clean
```

- [ ] **Step 2: Full gate sweep**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e
```

Expected: all green. Build produces `out/` static export with the same 7 routes (no route added or removed). The `/` route is now a client-free static page.

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin phase-7-home-page-redesign
gh pr create --title "Phase 7: home page redesign + universal-hub retirement" --body "$(cat <<'EOF'
## Summary

- Replace the universal drop hub at `/` with a brutalist landing page: hero (privacy claim) + 2x2 tool grid. Each card links directly to its tool.
- Aggressively delete the cross-route file handoff infrastructure (`src/lib/handoff.ts`, mount-time consumption in `ToolFrame`, 3 hub-dependent E2E specs). The hub was the sole consumer; nothing breaks.

Spec: `docs/superpowers/specs/2026-05-02-home-page-redesign.md`
Plan: `docs/superpowers/plans/2026-05-02-phase-7-home-page-redesign.md`

## Commits

1. docs(phase-7): spec + plan
2. feat(home): replace universal hub with brutalist landing page
3. refactor: remove cross-route file handoff plumbing
4. test(e2e): remove obsolete universal-hub specs

## Pre-existing E2E flakes carried over from Phase 6

- `pdf-split.spec.ts:111 inline syntax error blocks Convert` — webkit only.
- `pdf-merge.spec.ts:55 range slicing` — chromium only flake under 8 GB load.

## Manual smoke checklist

\`\`\`bash
pnpm dev   # NOT --turbopack
\`\`\`

1. \`/\` renders hero (\`// CONVERT FILES. LOCALLY.\`) + 2x2 tool grid.
2. Hover each card → border becomes accent orange, no layout shift.
3. Tab through cards → visible focus ring.
4. Click each card → navigates to right tool page.
5. Header logo + sidebar \`~/\` from any tool page → returns to \`/\`.

## Test plan

- [x] \`pnpm typecheck\`
- [x] \`pnpm lint\`
- [x] \`pnpm test\` — net delta around -2 unit tests (handoff.test.ts and 2 cross-route tests removed; new page tests added)
- [x] \`pnpm build\` — static export, 7 routes
- [x] \`pnpm test:e2e\` — 3 specs deleted, 1 added; pre-existing flakes noted above
- [ ] Manual Chrome smoke (deferred to reviewer per checklist above)
EOF
)"
```

Expected: PR URL is returned. Do NOT merge — that's the user's call.
