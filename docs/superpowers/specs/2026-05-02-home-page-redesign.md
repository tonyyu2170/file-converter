# Home page redesign — design

**Date:** 2026-05-02
**Phase:** 7 (kills the universal hub Phase 6 left in place)
**Scope:** Replace `src/app/page.tsx`. Aggressively clean up the cross-route file handoff infrastructure that the hub was the sole consumer of. No engine code changes; no privacy/CSP/build changes.

## Background

Phase 6 left `src/app/page.tsx` as a "universal drop hub" — a single dropzone that sniffed MIME on drop and routed to the right tool. Phase 6 user feedback labeled the hub as the source of two real problems:

1. The error "Need 2+ PDFs to merge" when a single PDF was dropped — the hub assumed one tool per shape, with no fallback for "what if I want pdf-split?"
2. No back-to-home affordance from any tool (Phase 6 fixed this with header + sidebar links to `/`, but `/` itself was still the awkward hub).

Phase 7 retires the hub. `/` becomes a real landing page that affirms what the app is, makes the privacy claim load-bearing, and directs the user to a tool. Tool routing happens via clicking a tool card — no MIME sniffing, no auto-routing, no error states for "wrong shape."

## Decisions

### D1. Page structure (option P1a)

Hero (headline + privacy claim) at top, 2×2 tool grid below, no in-page footer (the global `<Footer>` already provides version + count). Order is fixed; the grid is the action surface.

### D2. Hero copy (option P2a — pure terminal voice)

```
// CONVERT FILES. LOCALLY.

files never leave your device. every
conversion runs in a web worker inside
your browser. no upload, no server, no
telemetry.
```

Rationale: matches the `// HOME / // IMAGES / // PDFS` voice in the sidebar and `[ READY ] / [ DONE ]` voice in the status indicator. Lowercase body copy mirrors the rest of the app. Three short lines wrap to ~50 chars each — readable on mobile without breaking the terminal aesthetic.

### D3. Tool cards (option P3b — title + 1-line description)

Four cards, content frozen here so implementation has no design wiggle room:

| Title | Description | href |
|---|---|---|
| `image convert` | `heic, png, jpg, webp · convert between formats` | `/tools/image-convert` |
| `image→pdf` | `combine multiple images into a single pdf` | `/tools/image-to-pdf` |
| `merge` | `combine multiple pdfs into one` | `/tools/pdf-merge` |
| `split` | `extract page ranges from a pdf` | `/tools/pdf-split` |

Order matches sidebar: IMAGES first (`image convert`, `image→pdf`), then PDFS (`merge`, `split`). 2×2 layout reads left-to-right, top-to-bottom.

### D4. Cleanup scope (option P4 — aggressive)

The hub is the sole consumer of `stageFiles` / `takeStagedFiles`. After the hub dies, the plumbing is dead. Remove it:

- **Delete** `src/lib/handoff.ts`
- **Delete** `src/lib/handoff.test.ts`
- **Update** `src/components/tool-frame.tsx` — remove the `takeStagedFiles` import, the `pendingFiles` state, the mount-time consumption `useEffect`, and the `consumedRef` ref. The `pendingFiles` → `stagedFiles` plumbing has no source after this change.
- **Update** `src/components/tool-frame.test.tsx` — remove the two cross-route handoff tests (`"stages a handed-off file on mount but does not auto-fire convert"` for single-cardinality, `"staged file from cross-route handoff populates a multi-cardinality engine's staging area without firing convert"` for multi). Adjust `afterEach` if the only reason `takeStagedFiles()` is called there is to drain the slot.
- **Delete** `tests/e2e/homepage-handoff.spec.ts`
- **Delete** `tests/e2e/multi-file-handoff.spec.ts`
- **Delete** `tests/e2e/multi-file-handoff-pdf.spec.ts`

Net effect: dead code disappears. Nothing breaks because nothing else uses these modules.

### D5. Visual design — frozen markup

The page lives in the existing brutalist/terminal aesthetic. Tokens come from `src/app/globals.css` only (no new CSS variables). Cards link directly to tools — they're `<Link>` elements, which are anchor tags, so global `:focus-visible` styling applies for free.

**Layout:**

```jsx
<main className="p-6">
  <section className="mb-12 max-w-2xl">
    <h1 className="mb-4 text-[var(--text-lg)] uppercase tracking-[0.15em] text-[var(--color-accent)]">
      // CONVERT FILES. LOCALLY.
    </h1>
    <p className="text-[var(--text-sm)] text-[var(--color-fg-muted)] leading-relaxed">
      files never leave your device. every conversion runs in a web worker inside your browser. no upload, no server, no telemetry.
    </p>
  </section>

  <div className="mb-3 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-very-muted)]">
    // tools
  </div>
  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
    {TOOLS.map((tool) => (
      <Link
        key={tool.id}
        href={tool.href}
        data-testid={`tool-card-${tool.id}`}
        className="block border border-[var(--color-hairline)] p-5 transition-colors hover:border-[var(--color-accent)]"
      >
        <div className="mb-1 text-[var(--text-base)] text-[var(--color-fg-strong)]">
          {tool.title}
        </div>
        <div className="text-[var(--text-xs)] text-[var(--color-fg-muted)]">
          {tool.description}
        </div>
      </Link>
    ))}
  </div>
</main>
```

**Spacing** uses existing Tailwind primitives only: `p-6` for the page wrapper (matches tool pages), `p-5` for card interior, `gap-3` (12px) between cards, `mb-12` (48px) hero/grid gap, `mb-3` (12px) `// tools` label / grid gap.

**Hover state** is a single property (`border-color`) transition — no transform, no shadow, no scale. Avoids the layout-shift footgun called out in the ui-ux-pro-max checklist. `transition-colors` defaults to ~150ms which sits in the recommended 150–300ms range for micro-interactions.

**Focus state** uses the global `:focus-visible` rule from `globals.css` (1px accent outline, 2px offset). No per-card override.

**Cursor:** `<Link>` renders as `<a>`, which gets a pointer cursor by browser default. No explicit `cursor-pointer` needed.

**Accessibility:** Each card is a single `<Link>` containing two `<div>` children — title and description are visually distinct but compose into one accessible name (the link's text content). No icon buttons, no images, so no `aria-label` or `alt` needed. Keyboard nav: tab through the four cards in DOM order, which matches visual order.

### D6. Tool entry data lives in `page.tsx` (not shared with sidebar)

The sidebar's `TOOLS` array (`src/components/layout/sidebar.tsx`) is intentionally NOT shared. Reasons:

- Sidebar entries are short labels (`image convert`, `merge`); home page entries need richer copy (`title` + `description`).
- Sidebar groups by category (`HOME / IMAGES / PDFS`); home page is a flat 2×2 grid.
- Coupling them creates a "shared schema" where adding a sidebar-only entry (like `// HOME / ~/`) bleeds into landing-page state.

Each list is small (4–5 entries) and stable. Duplicating the entries is the lower-cost choice today. If the count grows past ~8 we'll revisit.

### D7. Mobile

Single-column grid below `md:` (768px). Hero copy width is capped at `max-w-2xl` so it wraps cleanly. No mobile-specific design beyond that — the brutalist aesthetic is naturally responsive (no fixed pixel widths beyond the sidebar, which is already `w-[180px] shrink-0`).

## Invariants preserved

- **No new dependencies.** `next/link` is already used.
- **No new CSS tokens.** Everything uses `globals.css` variables.
- **No `--turbopack`** in dev (per CLAUDE.md).
- **Static export unchanged.** `/` is a static route, no client-side state, no data fetching.
- **Engine pattern untouched.** Engines aren't touched. ToolFrame's edits are pure deletion (no semantic change to staging behavior — there was nothing to stage from the home page before this change).
- **Privacy/CSP/build invariants** all unchanged.

## What this PR does NOT change

- Sidebar's `// HOME` entry — Phase 6 added it; no rename, no styling change.
- Header's logo `<Link>` to `/` — Phase 6 added it; clicking it now lands on the new design instead of the hub.
- The four tool pages and their engines.
- The global `<Footer>`.

## Test plan

### Component tests

- **New** `src/app/page.test.tsx` (or co-located equivalent — match existing pattern):
  - Renders the hero headline (`// CONVERT FILES. LOCALLY.`)
  - Renders the privacy claim text
  - Renders 4 tool cards with the correct testids (`tool-card-image-convert`, `tool-card-image-to-pdf`, `tool-card-pdf-merge`, `tool-card-pdf-split`)
  - Each card has the correct `href`
  - Each card has the correct title + description text
- **Update** `src/components/tool-frame.test.tsx`:
  - Remove the two cross-route handoff tests (single + multi) per D4.
  - Confirm remaining 13 tests still pass (15 → 13).

### E2E

- **New** `tests/e2e/home-page.spec.ts`:
  - Goto `/`. Assert hero text. Click each tool card. Assert URL navigates to the right `/tools/<id>`. (4 navigation assertions in a single test, or 4 separate small tests — pick whichever reads better.)
- **Delete** `homepage-handoff.spec.ts`, `multi-file-handoff.spec.ts`, `multi-file-handoff-pdf.spec.ts`.

### Gates

`pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e` — all green. Test count delta:
- Unit: -2 (handoff cross-route tests removed) -5 (`handoff.test.ts` deleted, 5 tests) +N (new home page tests, ≈ 5–7) ≈ net **−2 to 0**, ending around 212–214.
- E2E: −3 specs (handoff specs removed, ~10 tests total across browsers) +1 spec (new home page nav test, 1–4 tests). Net E2E count drops noticeably; that's the dead-flow removal showing up.

### Pre-existing E2E flakes carried over from Phase 6

- `pdf-split.spec.ts:111 inline syntax error blocks Convert` — webkit only.
- `pdf-merge.spec.ts:55 range slicing` — chromium only flake under load on the 8 GB box.

Phase 7 doesn't fix these. If they reproduce in this branch's E2E run, note in the PR body and don't mistake them for new regressions.

## Files (additions / modifications / deletions)

**Add:**
- `src/app/page.test.tsx`
- `tests/e2e/home-page.spec.ts`

**Modify:**
- `src/app/page.tsx` (full rewrite)
- `src/components/tool-frame.tsx` (remove handoff plumbing)
- `src/components/tool-frame.test.tsx` (remove 2 handoff tests, adjust afterEach)

**Delete:**
- `src/lib/handoff.ts`
- `src/lib/handoff.test.ts`
- `tests/e2e/homepage-handoff.spec.ts`
- `tests/e2e/multi-file-handoff.spec.ts`
- `tests/e2e/multi-file-handoff-pdf.spec.ts`
