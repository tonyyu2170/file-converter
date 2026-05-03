# Phase 13 — docx-to-pdf TODO cleanup

**Goal:** address the 5 main + 3 polish TODOs Phase 10's PR body listed. No new deps, no new routes. Single bundled PR (small phase, clear seams).

**Spec:** [`docs/superpowers/specs/2026-05-03-phase-13-todo-cleanup.md`](../specs/2026-05-03-phase-13-todo-cleanup.md). Read it before starting any task — each fix has its own design rationale.

**Branch:** `phase-13-todo-cleanup` (already created off updated `main` at `d229a6d`).

**Substantive tasks (full review):** 2 (F1), 3 (F2), 6 (F5).
**Mechanical tasks (combined review):** 1, 4, 5, 7, 8.

**Critical ordering dependencies:**

- Task 1 (commit spec + plan) lands first.
- Task 2 (F1 — heading-bold) is independent of Tasks 3–7. Lands first among code changes because it touches the parser's foundational run-extraction.
- Task 3 (F2 — anchor check) extends `ParsedDocx` and `LayoutDeps`. Touches parser + layout + orchestrator.
- Task 4 (F3 — gridSpan clamp), Task 5 (F4 — Pass 1 isolation), Task 6 (F5 — list counter clone) are all independent of each other and of Task 3, but should land after Tasks 2–3 so the test suite delta is clean.
- Task 7 (polish bundle: F6 + F7 + F8) is purely additive cleanup — lands after the substantive work.
- Task 8 is the final gate sweep + push.

**Branch discipline reminder for implementer subagents:**

- `git branch --show-current` → `phase-13-todo-cleanup` BEFORE and AFTER every commit. STOP if wrong.
- NEVER `git checkout/switch/reset --hard/push/--no-verify/branch -m/-M`.
- ALLOWED `git status/diff/log/branch --show-current/add <files>/commit`.

---

## Task 1: Commit spec + plan on the impl branch

**Goal:** First commit on the branch is the spec + plan.

**Files:**
- Add `docs/superpowers/specs/2026-05-03-phase-13-todo-cleanup.md`
- Add `docs/superpowers/plans/2026-05-03-phase-13-todo-cleanup.md`

- [ ] **Step 1:** Verify branch.
- [ ] **Step 2:** Commit.

```bash
git add docs/superpowers/specs/2026-05-03-phase-13-todo-cleanup.md docs/superpowers/plans/2026-05-03-phase-13-todo-cleanup.md
git commit -m "docs(phase-13): spec + plan for docx-to-pdf TODO cleanup"
```

---

## Task 2: F1 — Heading-bold style→Run merge

**Substantive — full review.**

**Goal:** parser merges resolved style's run-props into Run.bold/italic/underline/strike/font/size/color. Layout removes the heading-force-bold workaround.

**Files:**
- Modify: `src/engines/docx-to-pdf/docx-parser/document-xml.ts` — extend run extraction to call `resolveStyle` against the paragraph's `pStyle` and merge the result's `runProps` underneath the run's explicit values. Run-level wins; absence inherits.
- Modify: `src/engines/docx-to-pdf/layout/paragraph.ts` — `headingProps()` returns `forceBold: false` (or omit the field; layout reads `run.bold` only).
- Update tests: parser test for the merge; layout test that heading paragraphs bold via inheritance, NOT via force.

- [ ] **Step 1:** Verify branch.
- [ ] **Step 2:** Implement parser merge in `document-xml.ts`. The `parseRun` (or its helpers) currently reads run-level rPr only. Resolve the paragraph's style chain via `resolveStyle(parsedDocx.styles, p.styleId)` (or threaded equivalent — pass styles into the body walker). Merge under run-level rPr.
- [ ] **Step 3:** Remove `forceBold` field from `headingProps`. Heading paragraphs no longer override run.bold at layout time.
- [ ] **Step 4:** Per-module tests:
   - `document-xml.test.ts`: a `<w:p w:pStyle="Heading1">` with no `<w:b/>` on its run produces `bold: true` (via Heading1 style which inherits Heading-base style which has `<w:b/>`). Synthesize a styles-xml fixture.
   - `document-xml.test.ts`: same paragraph with `<w:b w:val="0"/>` on the run produces `bold: false` (run-level wins).
   - `paragraph.test.ts`: heading paragraph with `bold: false` on its only run draws non-bold (assert font choice).
- [ ] **Step 5:** `pnpm typecheck && pnpm lint && pnpm test`.
- [ ] **Step 6:** Commit.

```bash
git add src/engines/docx-to-pdf/docx-parser/document-xml.ts src/engines/docx-to-pdf/docx-parser/document-xml.test.ts src/engines/docx-to-pdf/layout/paragraph.ts src/engines/docx-to-pdf/layout/paragraph.test.ts
git commit -m "fix(parser): merge style runProps into Run; drop heading-force-bold"
```

---

## Task 3: F2 — Anchor existence check

**Substantive — full review.**

**Goal:** parser collects bookmark names; orchestrator threads the set; layout warns + falls through to plain text on missing anchor.

**Files:**
- Modify: `src/engines/docx-to-pdf/docx-parser/types.ts` — add `bookmarks: Set<string>` to `ParsedDocx`.
- Modify: `src/engines/docx-to-pdf/docx-parser/document-xml.ts` — collect `<w:bookmarkStart w:name="..."/>` during body walk; bubble up.
- Modify: `src/engines/docx-to-pdf/docx-parser/index.ts` — initialize and surface `bookmarks` in the returned `ParsedDocx`.
- Modify: `src/engines/docx-to-pdf/layout/block-dispatch.ts` — extend `LayoutDeps` with `bookmarks: Set<string>`.
- Modify: `src/engines/docx-to-pdf/layout/hyperlinks.ts:attachLinkAnnotation` — when called with `target.anchor` and `deps.bookmarks` doesn't contain it: return `{kind: "skipped", reason: "anchor not found: <name>"}`.
- Modify: `src/engines/docx-to-pdf/layout/runs.ts:drawRunSpan` — on `kind: "skipped"` from `attachLinkAnnotation`, push the reason into `deps.warnings`. Text was already drawn; no annotation, plain-text result.
- Modify: `src/engines/docx-to-pdf/layout/index.ts` — orchestrator passes `parsed.bookmarks` into `LayoutDeps`.
- Update tests as needed.

- [ ] **Step 1:** Verify branch.
- [ ] **Step 2:** Parser-side: bookmark collection + type extension.
- [ ] **Step 3:** Layout-side: hyperlinks check + runs.ts warning push.
- [ ] **Step 4:** Orchestrator wiring.
- [ ] **Step 5:** Tests:
   - `document-xml.test.ts` / `index.test.ts` (parser): bookmark collection from a body containing `<w:bookmarkStart>`.
   - `hyperlinks.test.ts`: anchor present → annotation attached; anchor missing → `{kind: "skipped", reason: ...}`; no `bookmarks` set → defensive (fall back to optimistic emit, or skip-with-warn — pick one and document).
   - `runs.test.ts`: missing-anchor flow pushes a warning into `deps.warnings`.
   - `index.test.ts` (layout): integration test against synthetic DOCX with a missing anchor.
- [ ] **Step 6:** `pnpm typecheck && pnpm lint && pnpm test`.
- [ ] **Step 7:** Commit.

```bash
git add src/engines/docx-to-pdf/docx-parser/types.ts src/engines/docx-to-pdf/docx-parser/document-xml.ts src/engines/docx-to-pdf/docx-parser/index.ts src/engines/docx-to-pdf/docx-parser/index.test.ts src/engines/docx-to-pdf/layout/block-dispatch.ts src/engines/docx-to-pdf/layout/hyperlinks.ts src/engines/docx-to-pdf/layout/hyperlinks.test.ts src/engines/docx-to-pdf/layout/runs.ts src/engines/docx-to-pdf/layout/runs.test.ts src/engines/docx-to-pdf/layout/index.ts src/engines/docx-to-pdf/layout/index.test.ts
git commit -m "fix(layout): anchor existence check for hyperlinks (spec §10)"
```

---

## Task 4: F3 — gridSpan overflow clamp + warning

**Mechanical.**

**Goal:** when summed gridSpan > columnCount, clamp last cell + emit warning.

**Files:**
- Modify: `src/engines/docx-to-pdf/layout/tables.ts` — in row layout (where cell widths resolve), detect overflow and clamp.
- Update `tables.test.ts`.

- [ ] **Step 1:** Verify branch.
- [ ] **Step 2:** Implement. Locate the gridSpan summing in `tables.ts` (likely `resolveColumnWidths` or `layoutRow`). Track running column index per cell; if `currentCol + cell.gridSpan > columnCount`, clamp `cell.gridSpan = columnCount - currentCol` and push `"table cell gridSpan clamped (row N)"` to `deps.warnings`.
- [ ] **Step 3:** Test: a 3-column table row whose cells declare `gridSpan: 1, 1, 5` → clamp the third to 1 + warning.
- [ ] **Step 4:** `pnpm typecheck && pnpm lint && pnpm test`.
- [ ] **Step 5:** Commit.

```bash
git add src/engines/docx-to-pdf/layout/tables.ts src/engines/docx-to-pdf/layout/tables.test.ts
git commit -m "fix(layout): clamp gridSpan overflow + warn (spec §10)"
```

---

## Task 5: F4 — Pass 1 image-embed isolation

**Mechanical.**

**Goal:** multi-column Pass 1 uses a separate PDFDocument so embed side effects don't leak.

**Files:**
- Modify: `src/engines/docx-to-pdf/layout/multi-column.ts` — `passOneNaturalHeight` creates `await PDFDocument.create()` for the scratch context. The discard-page shim now operates against this scratch doc.
- Drop the `// TODO(task-10)` comment.
- Update test.

- [ ] **Step 1:** Verify branch.
- [ ] **Step 2:** Implement. Note: `passOneNaturalHeight` is sync today; introducing `await PDFDocument.create()` makes it async. Either (a) await at the call site, or (b) accept a pre-created scratch doc as a parameter. Lean (b): the orchestrator (or `layoutSection`) creates scratch once per multi-column section and passes in. Cleaner separation; no async creep into the inner loop.
- [ ] **Step 3:** Test: regression test verifying real `pdfDoc.getImageCount()` (or equivalent) doesn't grow during Pass 1.
- [ ] **Step 4:** `pnpm typecheck && pnpm lint && pnpm test`.
- [ ] **Step 5:** Commit.

```bash
git add src/engines/docx-to-pdf/layout/multi-column.ts src/engines/docx-to-pdf/layout/multi-column.test.ts
git commit -m "fix(layout): isolate Pass 1 image embeds via scratch PDFDocument"
```

---

## Task 6: F5 — Lists-in-cells counter isolation

**Substantive — full review.** Touches the measure-pass mechanics; easy to miss a side-effect channel.

**Goal:** measure pass clones `LayoutDeps.listState` so counters don't leak into the draw pass.

**Files:**
- Modify: `src/engines/docx-to-pdf/layout/block-dispatch.ts` — add `cloneListState(state: ListState): ListState` helper. Or extend `LayoutDeps` with a `cloneForMeasure(): LayoutDeps` method.
- Modify: `src/engines/docx-to-pdf/layout/tables.ts` — in `measureCellContent`, swap `deps` for a clone before invoking `layoutBlock`.
- Update `tables.test.ts`.

- [ ] **Step 1:** Verify branch.
- [ ] **Step 2:** Implement clone helper. ListState is `Map<string, Map<number, number>>` — deep clone via `new Map(...entries.map(([k, v]) => [k, new Map(v)]))`.
- [ ] **Step 3:** Apply in `measureCellContent`. Note: warnings should still go to the real accumulator (measure-pass discoveries are real). Only `listState` clones; `warnings` stays shared.
- [ ] **Step 4:** Test: a cell containing `<w:p numId="1" ilvl="0">First</w:p><w:p numId="1" ilvl="0">Second</w:p>` produces post-table list counter at 2 (not 4 — would be 4 if measure-pass leaked).
- [ ] **Step 5:** `pnpm typecheck && pnpm lint && pnpm test`.
- [ ] **Step 6:** Commit.

```bash
git add src/engines/docx-to-pdf/layout/block-dispatch.ts src/engines/docx-to-pdf/layout/tables.ts src/engines/docx-to-pdf/layout/tables.test.ts
git commit -m "fix(layout): isolate ListState in tables.ts measure pass"
```

---

## Task 7: F6 + F7 + F8 — polish bundle

**Mechanical.**

**Goal:** vMerge bottom-border suppression; parallelize image pre-embed; hyperlink rect baseline doc.

**Files:**
- Modify: `src/engines/docx-to-pdf/layout/tables.ts` — vMerge start-cell bottom border lookahead.
- Modify: `src/engines/docx-to-pdf/layout/index.ts` — `embedAllMedia` switches to `Promise.all`.
- Modify: `src/engines/docx-to-pdf/layout/hyperlinks.ts` — comment.

- [ ] **Step 1:** Verify branch.
- [ ] **Step 2:** F6 implementation + test.
- [ ] **Step 3:** F7 implementation. Verify `Promise.all` over the entries map gives the same result; on per-image failure (catch in the map fn), accumulate warning + skip.
- [ ] **Step 4:** F8 comment.
- [ ] **Step 5:** `pnpm typecheck && pnpm lint && pnpm test`.
- [ ] **Step 6:** Commit.

```bash
git add src/engines/docx-to-pdf/layout/tables.ts src/engines/docx-to-pdf/layout/tables.test.ts src/engines/docx-to-pdf/layout/index.ts src/engines/docx-to-pdf/layout/hyperlinks.ts
git commit -m "polish(layout): vMerge bottom border, parallel image embed, hyperlink rect doc"
```

---

## Task 8: Final gate sweep + push + open PR

- [ ] **Step 1:** Verify branch + log (expect 7 commits ahead of main).
- [ ] **Step 2:** Full gate sweep: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e` (E2E coordinated with user — pre-existing pdf-split:111 WebKit flake under load is not a regression of this PR).
- [ ] **Step 3:** Push branch + open PR.

```bash
git push -u origin phase-13-todo-cleanup
gh pr create --title "Phase 13: docx-to-pdf TODO cleanup" --body "$(cat <<'EOF'
## Summary

Cleans up the carried-forward TODOs from Phase 10's PR body. No new engines, no new deps.

- F1 — Heading-bold style→Run merge. Parser now resolves style.runProps into Run.bold; layout drops the always-force-bold workaround. Honors explicit \`<w:b w:val="0"/>\` on heading runs.
- F2 — Anchor existence check (spec §10). \`<w:hyperlink w:anchor=missing>\` renders as plain text + warning instead of dead Dest annotation.
- F3 — gridSpan overflow clamp (spec §10). Cell gridSpan > remaining columns now clamps + warns.
- F4 — Pass 1 image-embed isolation. Multi-column Pass 1 uses a separate scratch \`PDFDocument\` so future inline-image wiring doesn't double-embed.
- F5 — Lists-in-cells counter isolation. tables.ts measure pass clones ListState; cell-list counters don't leak into draw pass.
- F6 — vMerge start-cell bottom border suppressed when next row's cell is \`continue\`.
- F7 — \`embedAllMedia\` parallelized via \`Promise.all\`.
- F8 — Hyperlink rect baseline math documented.

Spec: \`docs/superpowers/specs/2026-05-03-phase-13-todo-cleanup.md\`
Plan: \`docs/superpowers/plans/2026-05-03-phase-13-todo-cleanup.md\`

## Test plan

- [x] \`pnpm typecheck\`
- [x] \`pnpm lint\`
- [x] \`pnpm test\` — net delta ~+22 unit tests
- [x] \`pnpm build\` — routes unchanged
- [x] \`pnpm test:e2e\` — pre-existing pdf-split:111 WebKit flake under full-suite load remains unfixed (separate concern); zero regressions in this PR's scope
EOF
)"
```

Expected: PR URL returned. Do NOT merge.
