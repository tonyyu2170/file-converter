# Phase 13 — docx-to-pdf TODO cleanup — design

**Status:** approved (pending PR merge)
**Date:** 2026-05-03
**Predecessors:** Phase 10 (`d229a6d`); spec `2026-05-02-docx-to-pdf-engine-design.md`.

## 0. Goal

Address the carried-forward TODOs left in Phase 10's PR body. Pure quality-bar work — no new engines, no new routes, no new deps. Single bundled PR (no separate docs PR — the work is well-bounded and each fix has a clear seam).

## 1. Scope

### 1.1 Main fixes (load-bearing for v1 quality)

#### F1. Heading-bold style→Run merge

**Problem.** `Run.bold` is currently set from `<w:b/>` on the run alone. The parser does not merge `Style.runProps.bold` into the run, so a paragraph styled `Heading1` whose runs don't carry an explicit `<w:b/>` parses with `bold: false`. Layout works around this by force-bolding all headings — which over-applies when a run carries an explicit `<w:b w:val="0"/>` to suppress the inherited bold.

**Fix.**
- In `docx-parser/document-xml.ts`'s run extraction (`parseRun`/`extractRunProps`): when extracting bold/italic/underline/strike/font/size/color, MERGE the resolved style's `runProps` from `parsed.styles.get(p.styleId)` (via `resolveStyle` which already handles `basedOn` chains). Run-level explicit values win over inherited; absence inherits.
- Layout: remove `forceBold: true` from `headingProps`. Keep the heading SIZE override (24/20/16/14/13/12 pt) — that's a layout concern, not a parser concern. Bold now flows naturally from style resolution at parse time.

**Test:** parser test asserts a Heading1 paragraph with no explicit `<w:b/>` produces `bold: true` on its runs (via style merge). Parser test asserts a Heading1 paragraph with `<w:b w:val="0"/>` on a run produces `bold: false` for that run. Layout test asserts the heading-bold rendering matches what runs report.

#### F2. Anchor existence check (spec §10)

**Problem.** `<w:hyperlink w:anchor="bookmark">` always emits a `Dest` annotation, even when the named bookmark doesn't exist in the doc. The link is dead at click-time. Spec §10 says "Hyperlink to anchor that doesn't exist → render as plain text, log warning."

**Fix.**
- Parser already extracts `<w:bookmarkStart w:name="..." />` references — we need to surface them. Extend `ParsedDocx` with `bookmarks: Set<string>` (anchor names declared in the doc body).
- `docx-parser/document-xml.ts`: collect bookmark names during the body walk.
- Layout `hyperlinks.ts:attachLinkAnnotation`: when called with `target.anchor`, check membership in the bookmark set (passed via `LayoutDeps.bookmarks: Set<string>`). If missing → return `{kind: "skipped", reason: "anchor not found: <name>"}`. Caller (`runs.ts:drawRunSpan`) on `kind: "skipped"` pushes the warning into `deps.warnings` and falls through to the plain-text render path (no annotation; text already drawn).
- Orchestrator `index.ts`: thread `parsed.bookmarks` into `LayoutDeps.bookmarks`.

**Test:** `hyperlinks.test.ts` covers anchor-found vs anchor-missing. `runs.test.ts` covers the warning push path. Integration test in `index.test.ts` against a synthetic DOCX with a missing anchor.

#### F3. gridSpan overflow clamp + warning (spec §10)

**Problem.** When summed cell `gridSpan > columnCount`, current `tables.ts:resolveColumnWidths` falls back to equal-width distribution silently. Spec §10 says "clamp + warning."

**Fix.**
- `tables.ts:layoutRow` (or wherever cell widths are resolved): when an individual cell's `gridSpan` would exceed remaining columns, clamp `gridSpan` to `columnCount - currentCellColumn` and push a warning `"table cell gridSpan clamped (row N)"` via `deps.warnings`.

**Test:** `tables.test.ts` covers a row whose gridSpan sum overflows; assert column-clamping math + warning.

#### F4. Pass 1 image-embed isolation

**Problem.** Multi-column Pass 1 reuses real `pdfDoc` with a discard-page shim. The shim absorbs `page.draw*` calls but NOT `pdfDoc.embedPng/embedJpg` — those still register against the real document. Today no synchronous layout primitive calls embed (images.ts is async, called only from the orchestrator), so this is dormant. Once Phase 10's TODO `paragraph.ts:layoutInlineImageRun` evolves into a synchronous embed (e.g., re-embedding per-block), every image in a multi-column section gets embedded twice.

**Fix.**
- `multi-column.ts:passOneNaturalHeight`: create a separate scratch `PDFDocument` via `PDFDocument.create()`. The discard-page shim then absorbs draws on this scratch doc. Embeds (which today are no-ops in Pass 1, but might be added later) likewise hit the scratch doc and get garbage-collected after Pass 1 completes.
- Drop the inline `// TODO(task-10)` comment.

**Test:** `multi-column.test.ts` adds a regression: pass an `embeddedImages` map referenced from a block, verify Pass 1 doesn't grow the real `pdfDoc`'s image count.

#### F5. Lists-in-cells counter isolation

**Problem.** `tables.ts:measureCellContent` uses real `LayoutDeps` for the measure-pass `layoutBlock` call. A list paragraph in a cell bumps the global counter once during measure + once during draw. Pathological for cells containing lists.

**Fix.**
- `tables.ts:measureCellContent`: clone `deps.listState` for the measure pass (deep copy — `Map<string, Map<number, number>>` of counters). Pass cloned state via a scratch `LayoutDeps`. Discard after measure.
- The clone helper lives next to `block-dispatch.ts`'s `LayoutDeps` definition.

**Test:** `tables.test.ts` adds a cell containing a numbered list; assert post-table counter equals "what one render produced" not "what two passes produced."

### 1.2 Polish (cheap)

#### F6. vMerge start-cell bottom-border suppression

`tables.ts:drawRowBorders` suppresses the top border on `vMerge: "continue"` cells but NOT the bottom border on `vMerge: "start"` cells when the next row's same-column cell is `continue`. Result: a horizontal divider draws across the visually merged box.

**Fix.** During border iteration, look ahead one row for each "start" cell; suppress its bottom border when the next row's column has `vMerge: "continue"` at the same starting column.

#### F7. Parallelize image pre-embed

`index.ts:embedAllMedia` does a sequential `await embedInlineImage` loop. Switch to `Promise.all` over the media entries. pdf-lib's image-registration is parallel-safe (each call produces an independent PDFImage).

**Fix.** `for-of-await` → `Promise.all(entries.map(...))`. Catch + per-image warning preserved.

#### F8. Hyperlink rect baseline math doc

`hyperlinks.ts:rectForRun` (or wherever the link rect math lives) uses an 80%/20% ascent/descent split derived from `lineHeight`, but real glyph cells use ascent ~75% / descent ~20% of `fontSize` (not `lineHeight`). Acceptable v1 approximation; the link rect ends up slightly larger than the glyph cell — clicks register fine, just slightly more lenient than ideal.

**Fix.** Add a comment explaining the trade-off and the constants. Optionally tighten to `fontSize * 0.75` ascent, `fontSize * 0.2` descent — but only if the math doesn't push rects below baseline (regression test required).

## 2. Out of scope

- RTL / equations / DrawingML rendering (deferred to v1.1 properly).
- Footnote bodies containing tables / lists / images (rare; deferred).
- Endnote refs inside endnote bodies (pathological; deferred).
- `%N` non-current-level numbering format substitution (Word-precise per-level format inheritance).
- Atomic-row first-row-overflow warning (rare).
- Footnote area math constant rationalization (works empirically; constants brittle but tested).
- Pre-existing pdf-split:111 WebKit flake — separate concern (Task 1 was explicitly skipped).

## 3. Test plan

Each main fix adds 2–4 unit tests covering happy path + the regression we're addressing. Polish items get 1–2 tests where behavior is observable. Integration tests in `layout/index.test.ts` add 1–2 deeper-stack scenarios for F1/F2.

Estimated test delta: 873 → ~895 (+~22).

E2E: existing docx-to-pdf E2E suite continues to pass. No new E2E specs (these are unit-level cleanups).

## 4. Plan structure preview

Estimated 8 implementation tasks, in dependency order:

1. **Spec + plan commit** on impl branch (this doc + the plan doc).
2. **F1 — Heading-bold style→Run merge.** Substantive (parser + layout, end-to-end).
3. **F2 — Anchor existence check.** Substantive (parser + layout + orchestrator).
4. **F3 — gridSpan overflow clamp + warning.** Mechanical.
5. **F4 — Pass 1 image-embed isolation.** Mechanical.
6. **F5 — Lists-in-cells counter isolation.** Mechanical.
7. **F6 + F7 + F8 — polish bundle.** Mechanical.
8. **Final gate sweep + push + open PR.**

## 5. Bundle / CSP / privacy invariants

All unchanged. No new deps, no new routes, no new fonts. Lint rules unchanged.

## 6. Success criteria

1. `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e` exit 0 (excluding the pre-existing pdf-split:111 WebKit flake under load).
2. A Heading1 paragraph with `<w:b w:val="0"/>` on one run renders that run NON-bold (regression for F1).
3. A `<w:hyperlink w:anchor="missing">` renders as plain text + emits a warning (F2).
4. A table row with overflowing gridSpan renders correctly (clamp) + emits a warning (F3).
5. A multi-column section with inline images doesn't double-embed images in the output PDF (F4).
6. A table cell containing a numbered list produces correct counter values post-table (F5).
7. vMerge merged-cell visual divider gone (F6 — manual smoke).
8. PR `phase-13-todo-cleanup → main` opens cleanly, CI green.
