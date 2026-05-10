# Phase 26 — v2 closeout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close v2 — fix sidebar group order, section the home grid by category, add the missing Tesseract cache header, extend the a11y E2E sweep across the new families, bump the version to v2.0.0, and amend the master spec to match the shipped catalog.

**Architecture:** Cross-cutting QA + spec edits. No new engines, no new shared infra. Two distinct commits per the v2 design §9 directive: (1) closeout work — UI / vercel.json / a11y / qa-checklist / version bump; (2) master-spec amendments — §5.5–§5.9, §11.1, §16, §17, §18. Both ship in the same PR so reviewers can see the full v2 close-out as one unit but diff them separately.

**Tech Stack:** TypeScript strict, React, Next.js static export, Vitest, Playwright, `@axe-core/playwright` (already installed in Phase 17). No new dependencies.

---

## Reference reading before starting

- v2 design: `docs/superpowers/specs/2026-05-05-v2-design.md` — esp. §4 (UX surfaces), §6.4 (a11y E2E), §6.5 (manual deploy validation), §7 (perf + caps), §9 (master spec amendments), §11.9 (Phase 26 scope), §12 (success criteria).
- Master spec: `docs/superpowers/specs/2026-04-30-file-converter-design.md` — sections being amended live at §5.4 (after which §5.5–§5.9 will be inserted), §11.1, §16, §17, §18.
- Phase 17 (v1 closeout): `docs/superpowers/plans/2026-05-05-phase-17-v1-closeout.md` — template for closeout posture, version bump, a11y E2E + spec amendments. Sets the precedent for this phase.
- Phase 18 verification log: `docs/superpowers/plans/phase-18-verification-log.md` — pinpoints what bg-remove model swap actually shipped (ormbg int8, NOT BiRefNet); §18 amendment text in this plan must reflect that.
- Sidebar: `src/components/layout/sidebar.tsx` (line 54: `GROUP_ORDER`).
- Home grid: `src/app/page.tsx` (the `TOOLS` const has no `category` field today).
- Home test: `src/app/page.test.tsx` (24-card assertion + per-card it.each table from Phase 25.5).
- /about engines table: `src/app/about/engines-table.tsx` — auto-derived from registry; no hand-edits needed.
- vercel.json: cache rules at the bottom; `/tesseract/` rule is the only one missing.
- Header check script: `scripts/check-vercel-headers.mjs` — currently only asserts COOP + COEP. Plan extends it to assert all WASM cache rules.
- a11y E2E: `tests/e2e/a11y.spec.ts` (currently 5 routes; plan adds 4 more).
- qa-checklist: `docs/superpowers/qa-checklist.md` (Phase 17 v1 layout; plan appends a v2 deploy section).
- Tesseract assets: `public/tesseract/` — populated by `scripts/copy-tesseract-assets.mjs` during postinstall.

CLAUDE.md invariants apply:
- No `--no-verify`. No `--amend`. **No Claude attribution in commit messages** (no `Co-Authored-By: Claude`, no "Generated with" footers). Commit body lines ≤ 72 chars.
- Run `pnpm test`, `pnpm typecheck`, `pnpm lint` after each task before commit.
- Engines must not contain `fetch` / `XMLHttpRequest` — Biome lint enforces.
- Don't use `next dev --turbopack` — Webpack dev server only.
- Branch discipline for subagents: never run `git branch -m/-M` or `git checkout <branch>`. Stay on the working branch you started on.

---

## Spec deviations

**bg-remove model in §18 amendment.** v2 design §9.5 says §18.11 should resolve to "model swapped to general-purpose alternative." Phase 18 actually shipped **ormbg int8**, not BiRefNet-lite int8 as originally lead-candidate'd in the v2 design. The §18 amendment text in this plan reflects the actual shipped model.

**Lighthouse / securityheaders / production curl checks deferred to post-merge.** Per the user's alignment, the deploy-dependent checks are logged in `qa-checklist.md` as a post-merge follow-up (mirrors v1 Phase 17 closeout), not gated on Phase 26 PR merge. The merge gate is local: lint, typecheck, unit, build (with prebuild header gate + postbuild bundle-isolation gate), targeted E2E. This is a deliberate deviation from v2 design §11.9's "Lighthouse spot-checks across one engine per family" — moving the bar from "blocking" to "tracked in qa-checklist."

Any further deviation discovered during implementation is documented inline with the task and surfaced in the final PR description.

---

## File structure

**Modify:**
- `src/components/layout/sidebar.tsx` — `GROUP_ORDER` reorder (move OCR after DATA).
- `src/app/page.tsx` — add `category` to each `TOOLS` entry; render `[ section ]`-style headers per category in design order; bump `VERSION` constant to `v2.0.0`.
- `src/app/page.test.tsx` — version assertion + section-rendering assertions; existing per-card it.each table stays as-is.
- `package.json` — bump `version` to `2.0.0`.
- `vercel.json` — add `/tesseract/(.*)` cache rule.
- `scripts/check-vercel-headers.mjs` — extend to assert the four expected cache-header rules exist (`/models/bg-remove/`, `/onnx-wasm/`, `/ffmpeg/`, `/tesseract/`).
- `tests/e2e/a11y.spec.ts` — add four routes to `ROUTES`.
- `docs/superpowers/qa-checklist.md` — append a v2 deploy validation section.
- `docs/superpowers/specs/2026-04-30-file-converter-design.md` — §5.5–§5.9 inserts; §11.1 caps table extension; §16 prune + renumber + edit + add; §17 footnote; §18 bg-remove resolution.

**Create:** none.

---

## Task 1: Fix sidebar `GROUP_ORDER` (OCR after DATA per v2 design §4.1)

**Files:**
- Modify: `src/components/layout/sidebar.tsx:54-65`

The sidebar today renders groups in `HOME → IMAGES → PDFS → DOCS → AUDIO → VIDEO → OCR → ARCHIVES → DATA → ABOUT`. v2 design §4.1 specifies `… → AUDIO → VIDEO → ARCHIVES → DATA → OCR → ABOUT`. OCR moves to last-before-ABOUT.

- [ ] **Step 1: Update `GROUP_ORDER`**

Edit `src/components/layout/sidebar.tsx`. Change `GROUP_ORDER` to:

```ts
const GROUP_ORDER = [
  "HOME",
  "IMAGES",
  "PDFS",
  "DOCS",
  "AUDIO",
  "VIDEO",
  "ARCHIVES",
  "DATA",
  "OCR",
  "ABOUT",
] as const;
```

- [ ] **Step 2: Run sidebar tests**

```bash
pnpm test src/components/layout/sidebar.test.tsx
```

Expected: PASS. Existing assertions test for group presence + tool links, not order, so the reorder is non-breaking. (If a test starts failing on order, the assertion is brittle — fix the test, not the order.)

---

## Task 2: Section the home grid by category

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/page.test.tsx`

The home page renders all 24 tool cards in a flat 2-column grid. v2 design §4.2 calls for section headers (`[ section ]`-style, matching the rest of the site) per category, in the same order as the sidebar. Per the Phase 26 plan-write decision, `category` is added inline to each `TOOLS` entry rather than async-loading from the registry — keeps LCP unchanged.

- [ ] **Step 1: Read the existing `TOOLS` array and home layout**

```bash
sed -n '1,210p' src/app/page.tsx
```

Note the structure: each entry has `id`, `title`, `description`, `href`. The grid markup is `<div className="grid grid-cols-1 gap-3 md:grid-cols-2">{TOOLS.map(...)}</div>`.

- [ ] **Step 2: Add `category` to each `TOOLS` entry**

Edit `src/app/page.tsx`. The `TOOLS` const becomes typed with a `category` field per design groups. Use the same string values as `EngineCategory` from `src/engines/_shared/types.ts`: `"image" | "pdf" | "document" | "audio" | "video" | "archive" | "data" | "ocr"`. Map each entry:

| id | category |
|---|---|
| image-convert, image-to-pdf, image-resize, image-bg-remove | `image` |
| pdf-merge, pdf-edit, pdf-split, pdf-to-image, pdf-to-md | `pdf` |
| docx-to-pdf, docx-to-txt, markdown-to-pdf, txt-to-pdf | `document` |
| audio-convert, audio-trim | `audio` |
| video-convert, video-trim, video-extract-audio | `video` |
| archive-extract, archive-create | `archive` |
| data-convert, json-format, xml-to-json | `data` |
| image-to-text | `ocr` |

Edit each `TOOLS` entry to add `category: "<value>"`. The const declaration line stays:

```ts
const TOOLS = [
  // ... entries with category added ...
] as const;
```

- [ ] **Step 3: Replace the flat-grid markup with category sections**

The replacement renders one section per category in design order, each with a `[ section-label ]` heading and the cards filtered to that category. Define a shared section-order + label map next to the `TOOLS` const:

```ts
type Category =
  | "image" | "pdf" | "document"
  | "audio" | "video" | "archive" | "data" | "ocr";

const SECTION_ORDER: ReadonlyArray<{ category: Category; label: string }> = [
  { category: "image", label: "images" },
  { category: "pdf", label: "pdfs" },
  { category: "document", label: "docs" },
  { category: "audio", label: "audio" },
  { category: "video", label: "video" },
  { category: "archive", label: "archives" },
  { category: "data", label: "data" },
  { category: "ocr", label: "ocr" },
];
```

Replace the existing grid `<div>` (the one currently containing `{TOOLS.map(...)}`) with:

```tsx
<div className="space-y-10">
  {SECTION_ORDER.map(({ category, label }) => {
    const items = TOOLS.filter((t) => t.category === category);
    if (items.length === 0) return null;
    return (
      <section key={category} data-testid={`home-section-${category}`}>
        <h2 className="mb-3 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-accent)]">
          [ {label} ]
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {items.map((tool) => (
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
      </section>
    );
  })}
</div>
```

The card markup itself is unchanged — same `data-testid="tool-card-<id>"`, same classes — so the existing `it.each` per-card test in `page.test.tsx` keeps passing.

- [ ] **Step 4: Add a section-rendering assertion to the home test**

Edit `src/app/page.test.tsx`. After the existing "renders exactly 24 tool cards" test, add:

```ts
it("renders one section per non-empty category in design order", () => {
  render(<Home />);
  const sections = screen.getAllByTestId(/^home-section-/);
  // Eight categories shipped in v2.
  expect(sections.map((s) => s.getAttribute("data-testid"))).toEqual([
    "home-section-image",
    "home-section-pdf",
    "home-section-document",
    "home-section-audio",
    "home-section-video",
    "home-section-archive",
    "home-section-data",
    "home-section-ocr",
  ]);
});

it("renders the section label as a [ … ] heading inside each section", () => {
  render(<Home />);
  expect(screen.getByText("[ images ]")).toBeInTheDocument();
  expect(screen.getByText("[ video ]")).toBeInTheDocument();
  expect(screen.getByText("[ ocr ]")).toBeInTheDocument();
});
```

- [ ] **Step 5: Run home tests**

```bash
pnpm test src/app/page.test.tsx
```

Expected: PASS — including the existing 24-card / per-card / status-bar assertions and the two new section assertions.

---

## Task 3: Bump version to v2.0.0

**Files:**
- Modify: `package.json:3`
- Modify: `src/app/page.tsx:151`
- Modify: `src/app/page.test.tsx:10`

Mirrors Phase 17's `chore(release): bump version to v1.0.0` commit. Two source files carry the version literally; `package.json` is the source of truth, the home `VERSION` constant is the user-visible badge.

- [ ] **Step 1: Bump `package.json`**

Edit `package.json` line 3: change `"version": "1.0.0"` to `"version": "2.0.0"`.

- [ ] **Step 2: Bump the home page constant**

Edit `src/app/page.tsx` line 151: change `const VERSION = "v1.0.0";` to `const VERSION = "v2.0.0";`.

- [ ] **Step 3: Update the home test assertion**

Edit `src/app/page.test.tsx` line 10: change `expect(bar).toHaveTextContent("v1.0.0");` to `expect(bar).toHaveTextContent("v2.0.0");`.

- [ ] **Step 4: Run home + sidebar tests**

```bash
pnpm test src/app/page.test.tsx src/components/layout/sidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Tasks 1–3 (UI sectioning + sidebar reorder + version)**

```bash
git add src/components/layout/sidebar.tsx src/app/page.tsx src/app/page.test.tsx package.json
git status --short
git commit -m "$(cat <<'EOF'
feat: v2 closeout — section home grid, fix sidebar order, bump v2.0.0

Sidebar GROUP_ORDER moves OCR after DATA per v2 design §4.1. Home grid
gains [ section ]-style headers grouped by EngineCategory in the same
order as the sidebar; card markup unchanged so per-card tests stay
green. Status-bar version badge + package.json bump to 2.0.0.
EOF
)"
```

---

## Task 4: Add `/tesseract/` cache header rule + extend the header gate

**Files:**
- Modify: `vercel.json`
- Modify: `scripts/check-vercel-headers.mjs`

Phase 23 (Tesseract shared infra) added `public/tesseract/*.wasm` assets but no cache rule. v2 design §6.5 + §7.3 require the rule to exist. The header-check script today only asserts COOP/COEP — extend it so a missing or moved cache rule fails the prebuild gate cheaply.

- [ ] **Step 1: Add the `/tesseract/(.*)` cache rule to `vercel.json`**

Edit `vercel.json`. After the `/ffmpeg/(.*)` block, append:

```json
    {
      "source": "/tesseract/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    }
```

(Keep JSON valid — comma after the previous `}` becomes mandatory.)

- [ ] **Step 2: Extend `scripts/check-vercel-headers.mjs`**

Edit `scripts/check-vercel-headers.mjs`. Currently the script reads `vercelConfig.headers`, finds the global rule, and asserts COOP/COEP on it. After the existing `errors` block (around line 55), add a second check that asserts the four expected `Cache-Control` rules exist. Append:

```js
// Expected long-cache rules. WASM / model assets are content-addressed by
// build hash and immutable; if a path moves or its rule is dropped, this
// script fails the prebuild gate so the regression is caught locally.
const REQUIRED_CACHE_RULES = [
  "/models/bg-remove/(.*)",
  "/onnx-wasm/(.*)",
  "/ffmpeg/(.*)",
  "/tesseract/(.*)",
];

const cacheErrors = [];
for (const source of REQUIRED_CACHE_RULES) {
  const rule = (vercelConfig.headers ?? []).find((r) => r.source === source);
  if (!rule) {
    cacheErrors.push(`missing rule: ${source}`);
    continue;
  }
  const cc = (rule.headers ?? []).find((h) => h.key === "Cache-Control");
  if (!cc) {
    cacheErrors.push(`${source}: missing Cache-Control header`);
    continue;
  }
  if (!/max-age=31536000/.test(cc.value) || !/immutable/.test(cc.value)) {
    cacheErrors.push(
      `${source}: Cache-Control should include max-age=31536000 and immutable, got "${cc.value}"`,
    );
  }
}

if (cacheErrors.length > 0) {
  console.error(
    `[check-vercel-headers] vercel.json fails cache-rule requirements:\n  ${cacheErrors.join("\n  ")}\n\nWASM/model assets are content-addressed; long-cache headers are required so first-use cost is paid once.`,
  );
  process.exit(1);
}

console.log(
  `[check-vercel-headers] OK — ${REQUIRED_CACHE_RULES.length} cache rules present (1y immutable)`,
);
```

- [ ] **Step 3: Run the script directly**

```bash
node scripts/check-vercel-headers.mjs
```

Expected: prints both OK lines (COOP/COEP + cache rules). If the new check trips a missing rule, fix `vercel.json` not the script.

- [ ] **Step 4: Run the full build to confirm prebuild gate passes**

```bash
pnpm build
```

Expected: `[check-vercel-headers] OK …` on both lines, then Next.js build, then `bundle-isolation: OK …`. End-to-end clean.

- [ ] **Step 5: Commit Task 4 (vercel.json + header gate)**

```bash
git add vercel.json scripts/check-vercel-headers.mjs
git commit -m "$(cat <<'EOF'
fix(vercel): add /tesseract/ cache rule + gate all four WASM rules

Phase 23 added public/tesseract/*.wasm but no cache header — first-use
cost was paid every visit. vercel.json now ships the standard
1y-immutable rule on /tesseract/(.*) alongside the existing /ffmpeg/,
/onnx-wasm/, and /models/bg-remove/ rules.

scripts/check-vercel-headers.mjs gains a second pass asserting all
four required cache rules exist with the correct directives, so a
future regression that drops or renames one fails the prebuild gate
locally instead of being noticed on production.
EOF
)"
```

---

## Task 5: Extend a11y E2E sweep to four new routes

**Files:**
- Modify: `tests/e2e/a11y.spec.ts:4`

v2 design §6.4 lists four routes that must be added: `audio-convert` (single-input + options panel), `video-trim` (trim-scrubber a11y), `archive-create` (multi-input StagingArea), `image-to-text` (slow-engine progress UI).

- [ ] **Step 1: Update `ROUTES`**

Edit `tests/e2e/a11y.spec.ts`. Change the `ROUTES` const to:

```ts
const ROUTES = [
  "/",
  "/about",
  "/tools/pdf-merge",
  "/tools/image-convert",
  "/tools/pdf-edit",
  "/tools/audio-convert",
  "/tools/video-trim",
  "/tools/archive-create",
  "/tools/image-to-text",
];
```

- [ ] **Step 2: Run the a11y suite (Chromium)**

```bash
pnpm test:e2e tests/e2e/a11y.spec.ts --project=chromium
```

Expected: 9 PASS — zero AA violations across all routes. If a violation lands, the page itself has the regression — fix the component (color contrast, missing label, etc.), not the test.

If a route fails on a transient axe-async load issue, the existing handler in the test file already waits for the engines table on `/about`; new tool routes mount immediately, no extra waits required.

- [ ] **Step 3: Commit Task 5 (a11y sweep)**

```bash
git add tests/e2e/a11y.spec.ts
git commit -m "$(cat <<'EOF'
test(a11y): extend axe sweep to v2 tool routes

Adds /tools/audio-convert (options panel), /tools/video-trim (trim
scrubber keyboard a11y), /tools/archive-create (multi-input staging),
and /tools/image-to-text (slow-engine progress) per v2 design §6.4.
Brings the AA-clean catalog to 9 routes.
EOF
)"
```

---

## Task 6: Append v2 deploy validation section to `qa-checklist.md`

**Files:**
- Modify: `docs/superpowers/qa-checklist.md`

Per v2 design §6.5, v2 closeout extends the manual deploy checklist with COOP/COEP curl checks, securityheaders.com re-grade, ffmpeg/tesseract WASM cache verification, and a manual privacy verification across each new family. These run **after** the PR merges (against the production deploy), not as a Phase 26 merge gate.

- [ ] **Step 1: Append the v2 section**

Edit `docs/superpowers/qa-checklist.md`. After the existing "## Latest run" table block at the end of the file, append:

```markdown

## v2 deploy validation

Run after Phase 26 merges to `main` and Vercel deploys. Replace
`<URL>` with the deployed URL.

### Headers

- [ ] `curl -sI <URL>/ | grep -i cross-origin-opener-policy`
      → `same-origin`
- [ ] `curl -sI <URL>/ | grep -i cross-origin-embedder-policy`
      → `require-corp`
- [ ] `curl -sI <URL>/tesseract/eng.traineddata.gz | grep -i cache-control`
      → `public, max-age=31536000, immutable`
- [ ] `curl -sI <URL>/ffmpeg/mt/ffmpeg-core.wasm | grep -i cache-control`
      → `public, max-age=31536000, immutable`

### securityheaders.com

- [ ] Grade A (or A+) with COOP/COEP set — re-graded post-v2.

### Manual privacy verification — one engine per new family

The §10.3 demonstration, exercised across each v2 family. Open the
deployed URL in Chrome with DevTools → Network → Fetch/XHR filter.

- [ ] **Audio** — drop a small mp3 in `/tools/audio-convert`,
      transcode to wav, confirm zero requests during conversion.
- [ ] **Video** — drop a small mp4 in `/tools/video-convert`,
      transcode to mp4 at low quality, confirm zero requests.
- [ ] **OCR** — drop a screenshot in `/tools/image-to-text`, run
      recognition, confirm zero requests during recognition (the
      `eng.traineddata.gz` fetch happens on first navigation; the
      conversion itself must show none).
- [ ] **Archives** — drop a sample.zip in `/tools/archive-extract`,
      extract, confirm zero requests.
- [ ] **Data** — drop a sample.json in `/tools/json-format`, pretty
      print, confirm zero requests.

### v2 Lighthouse run

Targets per master spec §17.4 + v2 design §12.4.

- [ ] Performance ≥ 95 on `/`
- [ ] Accessibility ≥ 95 on `/`
- [ ] Best Practices ≥ 95 on `/`
- [ ] Performance ≥ 95 on `/about`
- [ ] One representative new-family route ≥ 95 (audio-convert,
      video-trim, archive-create, image-to-text, data-convert).
      Audio/video/OCR routes are *expected* to score lower on
      first-conversion latency due to lazy-load WASM; the home /
      about scores carry the bar.

### Latest run (v2)

| Date | URL | Headers | securityheaders | Lighthouse home | Notes |
|------|-----|---------|-----------------|-----------------|-------|
|      |     |         |                 |                 |       |
```

- [ ] **Step 2: Commit Task 6 (qa-checklist)**

```bash
git add docs/superpowers/qa-checklist.md
git commit -m "$(cat <<'EOF'
docs(qa): add v2 deploy validation section to checklist

Post-merge gates: COOP/COEP + WASM cache curl checks, securityheaders
re-grade, manual privacy verification across each new v2 family
(audio/video/OCR/archives/data), and Lighthouse re-run. Mirrors the
Phase 17 v1 validation flow.
EOF
)"
```

---

## Task 7: Master spec amendments — §5.5–§5.9 (new family subsections)

**Files:**
- Modify: `docs/superpowers/specs/2026-04-30-file-converter-design.md`

Per v2 design §9.1, add five new subsections under §5 with the same descriptive treatment as §5.1–§5.3.

- [ ] **Step 1: Read the existing §5 layout**

```bash
sed -n '46,90p' docs/superpowers/specs/2026-04-30-file-converter-design.md
```

Note: §5.1 uses a markdown table with `Operation | Direction | Notes`. §5.2 uses `Operation | Notes`. §5.3 uses `Operation | Quality bar`. The new subsections should follow the same one-table-per-section pattern. §5.4 (User stories) currently follows §5.3, so the new sections insert after §5.3 and before §5.4 — pushing §5.4 down without renumbering it (it's still §5.4).

Wait — that breaks the implicit ordering convention. Re-reading v2 design §9.1: "Add five new subsections with the same descriptive treatment as §5.1–§5.3." It does not say where to insert relative to §5.4. The sensible placement is **after** §5.4 (the new families don't have user stories in this spec, but the existing §5.4 stories still apply), so the order becomes §5.1, §5.2, §5.3, §5.4, §5.5, §5.6, §5.7, §5.8, §5.9. This plan inserts in that order.

- [ ] **Step 2: Insert §5.5 Audio after §5.4**

Find the line `## 6. Architecture` (around line 89). Immediately before it, add:

```markdown
### 5.5 Audio

| Operation | Direction | Notes |
|---|---|---|
| MP3 / WAV / M4A / FLAC ↔ format swap | round-trip | Bitrate options on lossy outputs |
| Audio trim to sub-range | n/a | Lossless via `-c copy` when output format matches input |

```

- [ ] **Step 3: Insert §5.6 Video below §5.5**

Immediately after the §5.5 block, add:

```markdown
### 5.6 Video

| Operation | Direction | Notes |
|---|---|---|
| MP4 / MOV / WebM transcode | round-trip | libx264 / libvpx; quality low/medium/high → CRF 28/23/18 |
| Video trim to sub-range | n/a | Lossless `-c copy`; cuts may snap to nearest keyframe |
| Extract audio track from video | one-way | MP3 / M4A / WAV; lossless when no re-encode |

WebM uses libvpx (VP8) on output: the libvpx-vp9 path in the current `@ffmpeg/core` build OOBs on real inputs, verified empirically in Phase 25.5.

```

- [ ] **Step 4: Insert §5.7 Archives**

Immediately after the §5.6 block, add:

```markdown
### 5.7 Archives

| Operation | Direction | Notes |
|---|---|---|
| ZIP / TAR / TAR.GZ extract | one-way | Magic-byte format detection; entries downloaded as a bundle |
| Multi-file archive create | one-way | ZIP or TAR.GZ output; ordered via StagingArea |

Encrypted ZIPs and zip-slip path entries are rejected at validation time with actionable errors. Per-entry sanity check rejects single-entry archives that would expand to > 1 GB.

```

- [ ] **Step 5: Insert §5.8 Data**

Immediately after the §5.7 block, add:

```markdown
### 5.8 Data

| Operation | Direction | Notes |
|---|---|---|
| CSV ↔ JSON ↔ YAML | round-trip | Auto-detect input by extension + sniff |
| JSON pretty / minify | n/a | Indent 2 / 4 / tab on pretty mode |
| XML → JSON | one-way | Configurable attribute prefix (`@` / `$_` / none) |

JSON → XML reconstruction is deferred (lossy); see §16.

```

- [ ] **Step 6: Insert §5.9 OCR**

Immediately after the §5.8 block, add:

```markdown
### 5.9 OCR

| Operation | Direction | Notes |
|---|---|---|
| Image → text (English) | one-way | Tesseract.js; TXT or JSON-with-bboxes output |

Best on scanned documents and screenshots; lower quality on photos. Multi-language packs deferred to a later release; see §16.

```

(After Step 6, the file should have §5.5–§5.9 inserted, and `## 6. Architecture` should follow §5.9.)

---

## Task 8: Master spec amendments — §11.1 (extend size cap table)

**Files:**
- Modify: `docs/superpowers/specs/2026-04-30-file-converter-design.md`

Per v2 design §9.3, extend the §11.1 table with the v2 entries from v2 design §7.1.

- [ ] **Step 1: Locate the existing §11.1 table**

```bash
sed -n '478,490p' docs/superpowers/specs/2026-04-30-file-converter-design.md
```

The current table is:

```
| Tool | Soft warn | Hard block |
|---|---|---|
| Image conversion | 50 MB | 250 MB |
| PDF operations | 100 MB | 500 MB |
| Document conversion | 25 MB | 100 MB |
```

- [ ] **Step 2: Extend the table with five new rows**

Edit the §11.1 block. Replace the existing 3-row table with:

```
| Tool | Soft warn | Hard block |
|---|---|---|
| Image conversion | 50 MB | 250 MB |
| PDF operations | 100 MB | 500 MB |
| Document conversion | 25 MB | 100 MB |
| Audio | 100 MB | 500 MB |
| Video | 50 MB | 100 MB |
| Archives | 200 MB | 500 MB |
| Data | 25 MB | 50 MB |
| OCR | 25 MB | 25 MB |
```

These values are the source-of-truth values from `src/engines/_shared/size-limits.ts`. Verify before committing:

```bash
grep -A 12 "SIZE_LIMITS_MB" src/engines/_shared/size-limits.ts
```

If the values diverge, the truth is the code — update the table to match.

---

## Task 9: Master spec amendments — §16 prune + renumber + edit + add

**Files:**
- Modify: `docs/superpowers/specs/2026-04-30-file-converter-design.md`

Per v2 design §9.2:
- Items 1–5 and 11 are removed (audio, video, archives, data, OCR families + bg-remove model swap — all shipped in v2).
- §16.9 ("AI image transforms") edits to drop "background removal" from its example list.
- New deferral items added per v2 design §1.3.

- [ ] **Step 1: Pre-check for §16 cross-references**

```bash
grep -nE '§ ?16\.[0-9]+|section 16\.[0-9]+|see §16' docs/superpowers/specs/2026-04-30-file-converter-design.md
```

Expected: no specific-numbered cross-references (verified during plan-write 2026-05-09 — only generic `§16` mentions exist). If a numbered cross-reference appears, update both sides in this commit.

- [ ] **Step 2: Replace the entire §16 block**

The current §16 has 13 items (1–13). The shipped v2 changes mean 1, 2, 3, 4, 5, 11 are removed; 9 is edited; new items are added per the v2 deferral list.

Locate the `## 16. Future scope (post-v1)` heading (around line 589). Replace from that heading down to (but not including) `## 17. Success criteria` with:

```markdown
## 16. Future scope (post-v2)

In rough priority order:

1. **PWA / offline mode** — once feature surface stabilizes.
2. **Mobile responsive layout** — when desktop is mature.
3. **Custom domain + branding refresh** — when ready.
4. **AI image transforms** — watermark removal, possibly upscaling/inpainting. Browser-side only to honor `connect-src 'self'` (server-side ML breaks the privacy guarantee). General-purpose background removal shipped in v2 as `image-bg-remove`. Watermark removal and inpainting remain aspirational and gated on the bundle-size strategy.
5. **PDF → DOCX.** Cut from v1 because best-effort layout reconstruction does not meet the project quality bar. Revisit when a permissively-licensed in-browser solution exists with materially better fidelity than mammoth-style structural mapping.
6. **Standalone image-compress tool.** Cut from v1; revisit only if user feedback indicates the image-convert quality slider doesn't cover the use case.
7. **Watermark removal.** Brainstormed and tossed 2026-05-05. State-of-the-art "one-button magic" watermark removal is a server-GPU problem; permissively-licensed open-vocabulary detection that runs in a browser at quality does not exist. Revisit when that changes.
8. **Audio extras** — `audio-concat`, `audio-normalize`. Concat shape is awkward without a multi-input UX precedent in the audio family; normalize is small but waiting on the catalog hitting a stable shape post-v2.
9. **OGG / Opus formats in `audio-convert`.** Trivial codec add; deferred only because v2 already shipped four formats and the marginal user-facing value didn't justify the small additional bundle weight.
10. **`video-to-gif`.** Browser-side ffmpeg can do this, but quality vs file size is poor at GIF's bit-depth limits and users expecting "shareable GIFs" tend to want the WebP/MP4 path that already exists.
11. **Standalone `gzip` / `gunzip`.** Useful but covered partially by `archive-extract` (which handles `.tar.gz`). Standalone single-file gzip add waits on demand signal.
12. **TOML in `data-convert`.** Adds a parser dependency; deferred until a user use-case surfaces.
13. **Multi-language OCR.** v2 ships English only. Adding Spanish/French/German/simplified-Chinese language packs is a bundle-weight conversation — each pack is ~10 MB. The pattern is in place via `_shared/tesseract`; selection UX is the open design question.
14. **`pdf-ocr`** (PDF → searchable PDF). Reuses pdf-rasterize from `pdf-to-image` and PDF reassembly from `pdf-edit` plus the v2 Tesseract pipeline. Deferred because the multi-page progress + per-page error handling is non-trivial to design well.
15. **JSON → XML reconstruction.** v2 ships `xml-to-json` one-way only. Reconstruction is lossy without a documented type-mapping convention; deferred until that convention is settled on.

Each future engine plugs into the `convert()` interface (Section 6.3) as a lazy-loaded module. The catalog's modular structure is what makes future scope cheap.

```

- [ ] **Step 3: Verify the edit reads cleanly**

```bash
sed -n '589,650p' docs/superpowers/specs/2026-04-30-file-converter-design.md
```

Confirm: §16 starts at the heading, items 1–15 follow, the trailing "Each future engine plugs into…" sentence ends the section, and `## 17. Success criteria` is the next heading.

---

## Task 10: Master spec amendments — §17 footnote + §18 bg-remove resolution

**Files:**
- Modify: `docs/superpowers/specs/2026-04-30-file-converter-design.md`

Per v2 design §9.4 + §9.5.

- [ ] **Step 1: Add the §17 footnote**

Edit `docs/superpowers/specs/2026-04-30-file-converter-design.md`. After the §17 heading and its current content (the five numbered success criteria + the SEO deviation note), append a footnote line. Find the line just before `## 18. Open questions / risks` and insert:

```markdown

> **v2 footnote (2026-05-09).** Catalog of 24 engines verified against this bar.
```

(One blank line above and below; the `>` makes it render as a blockquote, visually distinguishing it from the original v1 commitments.)

- [ ] **Step 2: Add the §18 bg-remove resolution**

The current §18 lists "Vercel static export + WASM caching headers", "PDF → DOCX experimental quality", "shadcn/ui restyling effort", and "Tailwind v4 + CSP `style-src`". v2 design §9.5 says to resolve the bg-remove model-quality risk that was *referenced from §16.11* (now removed in Task 9). Since the original risk wording lived in §16, not §18, the resolution is a new bullet at the bottom of §18:

Find the existing §18 block. After the last existing bullet (`Tailwind v4 + CSP \`style-src\`…`), append:

```markdown
- **`image-bg-remove` model quality.** Resolved in v2 Phase 18 — model swapped from MODNet (portrait-only, Apache-2.0, 6.6 MB) to **ormbg int8** (general-purpose, Apache-2.0, ~38 MB). The portrait-only limitation is removed. Verification log: `docs/superpowers/plans/phase-18-verification-log.md`.
```

- [ ] **Step 3: Verify the spec reads cleanly end-to-end**

```bash
grep -n "^## " docs/superpowers/specs/2026-04-30-file-converter-design.md
```

Expected: section numbering still sequential (1 through 18), no orphaned `## 16. Future scope (post-v1)` (the heading was renamed to post-v2 in Task 9), and no `§16.11` references remain.

```bash
grep -n "§16\.11\|§16\.1\b\|§16\.2\b\|§16\.3\b\|§16\.4\b\|§16\.5\b" docs/superpowers/specs/2026-04-30-file-converter-design.md
```

Expected: no matches (the renumbered §16 has no bullets at those numbers anymore, and no other section references them).

- [ ] **Step 4: Run typecheck + lint to confirm spec edits don't impact code-build**

The spec is markdown — it doesn't compile — but Biome lints docs files for trailing whitespace etc.

```bash
pnpm lint
```

Expected: PASS.

- [ ] **Step 5: Commit Tasks 7–10 (master spec amendments) as a separate commit**

Per v2 design §9: spec amendments live in their own commit so the diff is reviewable in isolation.

```bash
git add docs/superpowers/specs/2026-04-30-file-converter-design.md
git status --short
git commit -m "$(cat <<'EOF'
docs(spec): v2 master-spec amendments

§5.5–§5.9: add Audio / Video / Archives / Data / OCR family tables
matching the §5.1–§5.3 treatment. §11.1: extend size-cap table with
the five new families using values from _shared/size-limits.ts.

§16: remove items 1–5 + 11 (the v2-shipped families + bg-remove model
swap), renumber 6–10 + 12–13 down, edit "AI image transforms" to drop
background removal from the example list, and add new deferral items
for audio extras (concat/normalize), OGG/Opus, video-to-gif, gzip,
TOML, multi-language OCR, pdf-ocr, and JSON→XML reconstruction.

§17: add v2 footnote noting the 24-engine catalog was verified against
the original quality bar.

§18: append bg-remove model-quality resolution citing Phase 18's
MODNet → ormbg int8 swap and the verification log.

Refs v2 design §9.
EOF
)"
```

---

## Task 11: Full-suite verification before opening the PR

**Files:** none modified — verification only.

- [ ] **Step 1: Lint**

```bash
pnpm lint
```

Expected: PASS (0 errors). Pre-existing warnings are fine.

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Unit + integration test suite**

```bash
pnpm test
```

Expected: PASS. Watch for `src/app/page.test.tsx` (sectioning + version assertions), `src/components/layout/sidebar.test.tsx` (group order is non-strict so no breakage expected).

- [ ] **Step 4: Build + prebuild header gate + postbuild bundle isolation gate**

```bash
pnpm build
```

Expected output ends with:
- `[check-vercel-headers] OK — vercel.json carries COOP same-origin and COEP require-corp`
- `[check-vercel-headers] OK — 4 cache rules present (1y immutable)`
- `bundle-isolation: OK — homepage chunks are clean of 24 engines`
- `bundle-isolation: OK — no forbidden CDN strings in N chunks`

If the new cache-rule check fails, the new `/tesseract/` rule's source string in `vercel.json` doesn't match the script's expected `"/tesseract/(.*)"` exactly. Fix at the source.

- [ ] **Step 5: Targeted E2E — a11y sweep + coop-coep + privacy regressions**

```bash
pnpm test:e2e tests/e2e/a11y.spec.ts tests/e2e/coop-coep.spec.ts --project=chromium
```

Expected: PASS. The a11y suite now covers 9 routes; the coop-coep suite covers all tool routes including `video-convert`.

If a11y trips on one of the four new routes, axe is identifying a real AA defect — fix the component before merging. Don't suppress the violation.

---

## Task 12: Push branch and open the PR

**Files:** none modified — workflow only.

- [ ] **Step 1: Confirm the commit history reads cleanly**

```bash
git log --oneline main..HEAD
```

Expected: 6 commits in this order (newest at top):
- `docs(spec): v2 master-spec amendments` (Task 10)
- `docs(qa): add v2 deploy validation section to checklist` (Task 6)
- `test(a11y): extend axe sweep to v2 tool routes` (Task 5)
- `fix(vercel): add /tesseract/ cache rule + gate all four WASM rules` (Task 4)
- `feat: v2 closeout — section home grid, fix sidebar order, bump v2.0.0` (Tasks 1–3)

(Note: the spec-amendment commit is intentionally separate per v2 design §9. The other five are batched per their groupings. Order of commits does not matter for review; the separation does.)

- [ ] **Step 2: Push**

```bash
git push -u origin <branch-name>
```

- [ ] **Step 3: Open the PR**

```bash
gh pr create --title "Phase 26: v2 closeout (catalog 24, v2.0.0)" --body "$(cat <<'EOF'
## Summary
- Sidebar `GROUP_ORDER` reorders OCR after DATA (v2 design §4.1).
- Home grid gains `[ section ]`-style headers grouped by
  EngineCategory in design order; card markup unchanged so per-card
  tests stay green.
- `package.json` and home-page `VERSION` constant bump to `v2.0.0`.
- `vercel.json` adds the `/tesseract/(.*)` 1-year-immutable cache
  rule that should have shipped with Phase 23. `check-vercel-headers`
  gains a second pass that asserts all four required cache rules
  exist with the correct directives, so a future regression that
  drops or renames one fails the prebuild gate locally.
- `tests/e2e/a11y.spec.ts` extends from 5 → 9 routes covering one
  representative engine per new v2 family (audio/video/archives/OCR).
- `qa-checklist.md` gains a v2 post-merge deploy validation section
  with COOP/COEP curl checks, securityheaders re-grade, manual
  privacy verification per family, and Lighthouse spot-checks.
- Master spec gets v2 amendments per v2 design §9 (separate commit).

## Why
v2 closeout — the cross-cutting QA + spec edits that bring the
24-engine catalog over the finish line. Phase 25.5 closed the
catalog gap; this phase makes the catalog visible (sections,
sidebar order) and durable (cache headers, a11y gates, master spec
matches what shipped).

## Deviations from v2 design

**Lighthouse / securityheaders / production curl checks deferred to
post-merge.** Per the alignment with the user, these deploy-dependent
gates live in `qa-checklist.md` as a post-merge follow-up — mirroring
v1 Phase 17's flow — rather than blocking the Phase 26 PR. Local
gates (lint, typecheck, unit, build with prebuild + postbuild
checks, targeted E2E including the new a11y routes) are the merge
bar.

**§18 bg-remove resolution wording.** v2 design §9.5 referenced
"BiRefNet-lite int8" as the lead candidate; Phase 18 actually
shipped **ormbg int8** after OOM verification. The amendment text
reflects what shipped, not the lead candidate.

## Test plan
- [x] Lint, typecheck, full unit suite
- [x] `pnpm build` — prebuild header gate (COOP/COEP + four cache
      rules) + postbuild bundle-isolation gate
- [x] E2E (Chromium): a11y sweep across 9 routes, coop-coep route
      catalog
- [ ] Post-merge: run `docs/superpowers/qa-checklist.md` v2 deploy
      validation section against the production deploy

Refs `docs/superpowers/specs/2026-05-05-v2-design.md` §11.9 + §9.
EOF
)"
```

- [ ] **Step 4: Wait for CI green; merge when reviewed**

After merge, run the v2 deploy validation section of `docs/superpowers/qa-checklist.md` against the production URL and record results in the "Latest run (v2)" table.

---

## Self-review checklist

After implementing, before declaring the phase done:

1. **Spec coverage** — every clause of v2 design §11.9 is implemented:
   - ✅ Sidebar groups (Task 1)
   - ✅ Home-grid sectioning (Task 2)
   - ✅ /about table refresh — auto-derived; no edit needed (Phase 17 infrastructure does this)
   - ✅ vercel.json final review + tesseract cache rule (Task 4)
   - ✅ a11y E2E sweep (Task 5)
   - ⚠️ Lighthouse spot-checks — deferred to post-merge per spec deviation
   - ⚠️ securityheaders + COOP/COEP verification — deferred to post-merge per spec deviation
   - ✅ Master spec amendments (Tasks 7–10)
   - ✅ qa-checklist.md (Task 6)
2. **Privacy invariant** — privacy regression suite stays green (no engine touched in this phase).
3. **Bundle isolation** — 24 engines clean of homepage chunk.
4. **Catalog count** — home grid + sidebar both show 24 tools sectioned correctly; status bar reads `24 TOOLS ONLINE`; `/about` engines table shows 24 rows.
5. **Version** — home page reads `v2.0.0`; `package.json` reads `2.0.0`.

If any item fails, fix at the source — don't relax the test or the gate.
