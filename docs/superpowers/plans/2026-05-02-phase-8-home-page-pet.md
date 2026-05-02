# Phase 8 — Home page ambient pet (akita dog from VS Code Pets)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task with two-stage review on substantive (asset-licensing-touching or shared-CSS-touching) tasks and combined opus review on mechanical extensions.

**Goal:** Fill the upper-right negative space on `/` with one walking pixel-art pet (akita dog from VS Code Pets, CC BY-ND 4.0). Pure CSS animation. No client-side JS, no engine code, no privacy/CSP/build invariant changes. Single PR (matches Phase 7's structure — small new module, no shared infra changes).

**Architecture:** New `src/components/pets/pet-panel.tsx` server component renders an absolutely-positioned panel with a `<picture>` element containing the walk GIF + reduced-motion PNG fallback. CSS keyframes in `globals.css` drive the cross-panel translation. `<Footer>` gains an attribution line. The home page imports `<PetPanel />` and places it in the hero region. `/` route remains a server component, no JS bundle delta.

**Tech Stack:** No new dependencies. Existing Next.js 15 / React 19 / Tailwind v4 / Vitest / Playwright stack. Source assets pulled from `tonybaloney/vscode-pets` (`media/dog/akita_walk_8fps.gif` and `akita_idle_8fps.gif` for static-frame extraction).

**Spec:** [`docs/superpowers/specs/2026-05-02-home-page-pet.md`](../specs/2026-05-02-home-page-pet.md).

**Branch:** `phase-8-home-page-pet` (create off `main` after Phase 7 merge — already at `fc09be2`).

**Substantive tasks (full two-stage sonnet+opus review):** 4 (`pet-panel.tsx` + globals.css + page.tsx integration — coordinated CSS animation + layout). **Mechanical tasks (combined opus review):** 1, 2, 3, 5, 6.

**Critical ordering dependencies:**

- Task 1 (commit spec + plan) MUST land first on the branch — every later task references the spec.
- Task 2 (acquire assets + license file) MUST land before Task 4 — pet-panel.tsx imports the asset paths.
- Task 3 (Footer attribution + test) is independent of Tasks 4/5 and can land anytime after Task 1.
- Task 4 (pet-panel + globals.css + page.tsx integration + tests) is the substantive task.
- Task 5 (E2E breakpoint test) runs after Task 4 — needs the panel rendered.
- Task 6 (manual smoke + final gates + push + open PR) runs last.

**Branch discipline reminder:**

- Run `git branch --show-current` BEFORE and AFTER every commit. Verify `phase-8-home-page-pet`.
- NEVER run: `git branch -m`, `git branch -M`, `git checkout <branch>`, `git switch <branch>`, `git reset --hard`, `git push --force`. NEVER use `--no-verify`.
- Allowed: `git status`, `git diff`, `git log`, `git branch --show-current`, `git add <specific files>`, `git commit`, `git rm <specific files>`.

---

## Task 1: Commit spec + plan on the implementation branch

**Goal:** First commit on the branch is the spec + plan. Reviewer reads design intent before reading code.

**Files:**
- Add: `docs/superpowers/specs/2026-05-02-home-page-pet.md`
- Add: `docs/superpowers/plans/2026-05-02-phase-8-home-page-pet.md`

- [ ] **Step 1: Verify branch + clean tree**

```bash
git branch --show-current  # expect: phase-8-home-page-pet
git status                 # expect: the two new files untracked, nothing else
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-02-home-page-pet.md docs/superpowers/plans/2026-05-02-phase-8-home-page-pet.md
git commit -m "docs(phase-8): spec + plan for home page ambient pet"
```

---

## Task 2: Acquire pet assets + license file

**Goal:** Commit the akita walk GIF, a static-frame PNG fallback, and the CC BY-ND 4.0 license text to `public/pets/`.

**Files:**
- Add: `public/pets/akita_walk_8fps.gif`
- Add: `public/pets/akita_static.png`
- Add: `public/pets/LICENSE-pet-assets.md`

- [ ] **Step 1: Verify branch**

`git branch --show-current` → `phase-8-home-page-pet`. STOP if wrong.

- [ ] **Step 2: Download walk GIF (verbatim, no modification)**

```bash
mkdir -p public/pets
curl -sL -o public/pets/akita_walk_8fps.gif \
  https://raw.githubusercontent.com/tonybaloney/vscode-pets/main/media/dog/akita_walk_8fps.gif

# Verify
file public/pets/akita_walk_8fps.gif
# Expect: GIF image data, version 89a, 174 x 115
ls -la public/pets/akita_walk_8fps.gif
# Expect: ~10 KB
```

If `file` doesn't show `174 x 115`, STOP and report — the source asset may have changed.

- [ ] **Step 3: Generate static PNG fallback from idle frame**

```bash
# Download idle GIF temporarily (to extract first frame; not committed)
curl -sL -o /tmp/akita_idle_8fps.gif \
  https://raw.githubusercontent.com/tonybaloney/vscode-pets/main/media/dog/akita_idle_8fps.gif

# Extract first frame as PNG using ImageMagick
# (If ImageMagick not installed, use sips on macOS or report BLOCKED)
magick /tmp/akita_idle_8fps.gif[0] public/pets/akita_static.png 2>/dev/null \
  || sips -s format png /tmp/akita_idle_8fps.gif --out public/pets/akita_static.png \
  || (echo "BLOCKED: install imagemagick or report alternative" && exit 1)

file public/pets/akita_static.png
# Expect: PNG image data, 174 x 115
ls -la public/pets/akita_static.png
# Expect: 1-5 KB
```

If neither tool works, STOP and report BLOCKED — don't commit a placeholder.

- [ ] **Step 4: Write license file**

Create `public/pets/LICENSE-pet-assets.md` with:

```markdown
# Pet asset license

The `akita_*.png` and `akita_*.gif` files in this directory are derived from
the akita color variant of the dog assets in
[tonybaloney/vscode-pets](https://github.com/tonybaloney/vscode-pets/tree/main/media/dog).

**Artist:** [NVPH Studio](https://nvph-studio.itch.io/dog-animation-4-different-dogs)
**License:** [Creative Commons Attribution-NoDerivatives 4.0 International (CC BY-ND 4.0)](https://creativecommons.org/licenses/by-nd/4.0/)
**Source license file:** https://github.com/tonybaloney/vscode-pets/blob/main/media/dog/license.txt

## Terms summary

- **Attribution required** — credit NVPH Studio. file-converter does this in
  the global Footer (`src/components/layout/footer.tsx`).
- **No derivatives** — the GIF (`akita_walk_8fps.gif`) is committed verbatim from
  the source repo, no modifications. The static PNG (`akita_static.png`) is the
  unmodified first frame of the akita_idle GIF, extracted via lossless tooling
  (ImageMagick or macOS sips). Single-frame extraction is permitted under
  CC BY-ND as it produces no derivative work — the frame itself is unchanged.
```

- [ ] **Step 5: Verify + commit**

```bash
ls -la public/pets/
# Expect: 3 files — akita_walk_8fps.gif, akita_static.png, LICENSE-pet-assets.md
git add public/pets/
git commit -m "chore(pets): commit akita assets + CC BY-ND 4.0 license"
```

---

## Task 3: Footer attribution

**Goal:** Add a credit line to `src/components/layout/footer.tsx` for NVPH Studio + CC BY-ND 4.0 link.

**Files:**
- Modify: `src/components/layout/footer.tsx`
- Add: `src/components/layout/footer.test.tsx`

- [ ] **Step 1: Verify branch**

`git branch --show-current` → `phase-8-home-page-pet`. STOP if wrong.

- [ ] **Step 2: Read current Footer to understand prop shape**

```bash
cat src/components/layout/footer.tsx
```

Expect a small functional component taking `count` and `version` props (or similar). Match the existing visual treatment when adding the credit line.

- [ ] **Step 3: Add attribution**

Add to the footer's render output, in a visually subordinate position (not competing with the version/count). Suggested treatment:

```jsx
<span className="text-[var(--color-fg-very-muted)]">
  art:{" "}
  <a href="https://nvph-studio.itch.io/dog-animation-4-different-dogs" className="hover:text-[var(--color-fg-strong)]">
    akita by NVPH Studio
  </a>
  {" · "}
  <a href="https://creativecommons.org/licenses/by-nd/4.0/" className="hover:text-[var(--color-fg-strong)]">
    CC BY-ND 4.0
  </a>
</span>
```

(Implementer may adjust positioning, separator, hover state to match existing footer treatment. The two links + `art:` label are required; everything else is style.)

External `<a>` elements should have `target="_blank"` + `rel="noreferrer"` to open in new tab without leaking referrer.

- [ ] **Step 4: Add `footer.test.tsx`**

Single test: render `<Footer count={0} version="v0.1.0" />`; assert the artist link (`href` to itch.io page) and license link (`href` to creativecommons.org/licenses/by-nd/4.0/) are both present.

- [ ] **Step 5: Gates**

```bash
pnpm typecheck && pnpm lint && pnpm test src/components/layout/footer.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/footer.tsx src/components/layout/footer.test.tsx
git commit -m "feat(layout): footer attribution for akita pet asset"
```

---

## Task 4: PetPanel component + globals.css keyframes + page integration

**Goal:** New `<PetPanel />` component, animated cross-panel walk via `globals.css` keyframes, integrated into `src/app/page.tsx`.

**Files:**
- Add: `src/components/pets/pet-panel.tsx`
- Add: `src/components/pets/pet-panel.test.tsx`
- Modify: `src/app/globals.css` (add `@keyframes pet-stroll` + `.pet-stroll` class + reduced-motion override)
- Modify: `src/app/page.tsx` (import + render `<PetPanel />`)
- Modify: `src/app/page.test.tsx` (assertions for the panel)

- [ ] **Step 1: Verify branch**

`git branch --show-current` → `phase-8-home-page-pet`. STOP if wrong.

- [ ] **Step 2: Add `globals.css` keyframes + class**

Append to `@layer base` (or after the existing `@theme` block — match the file's existing structure):

```css
@keyframes pet-stroll {
  0%,
  100% {
    transform: translateX(0) scaleX(1);
  }
  47% {
    transform: translateX(calc(400px - 174px)) scaleX(1);
  }
  50% {
    transform: translateX(calc(400px - 174px)) scaleX(-1);
  }
  97% {
    transform: translateX(0) scaleX(-1);
  }
}

.pet-stroll {
  animation: pet-stroll 30s linear infinite;
  will-change: transform;
}

@media (prefers-reduced-motion: reduce) {
  .pet-stroll {
    animation: none;
    transform: translateX(0) scaleX(1);
  }
}
```

The hardcoded `400px` matches the panel width set in the component. If implementer wants to make this a CSS custom property for future flexibility (e.g., `--pet-panel-width`), that's fine — but spec doesn't require it.

- [ ] **Step 3: Create `src/components/pets/pet-panel.tsx`**

Server component (no `"use client"`):

```jsx
export function PetPanel() {
  return (
    <div
      className="pointer-events-none absolute right-6 top-6 hidden h-[140px] w-[400px] xl:block"
      data-testid="pet-panel"
      aria-hidden="true"
    >
      <picture>
        <source srcSet="/pets/akita_static.png" media="(prefers-reduced-motion: reduce)" />
        <img
          src="/pets/akita_walk_8fps.gif"
          alt=""
          width={174}
          height={115}
          className="pet-stroll absolute bottom-0 left-0"
        />
      </picture>
    </div>
  );
}
```

Notes:
- `right-6 top-6` matches the page's `p-6` padding (anchors panel to the inside-corner of `<main>`).
- `xl:block` (1280px+) matches spec D3.
- `aria-hidden="true"` and `alt=""` mark the pet decorative.
- `pointer-events-none` so the panel never intercepts clicks.
- `<picture>` + `<source media="...">` swaps to the static PNG when `prefers-reduced-motion: reduce`.

- [ ] **Step 4: Add `src/components/pets/pet-panel.test.tsx`**

Tests:
1. `<PetPanel />` renders with `data-testid="pet-panel"` and `aria-hidden="true"`.
2. Renders a `<picture>` containing a `<source>` with `srcSet="/pets/akita_static.png"` and `media="(prefers-reduced-motion: reduce)"`.
3. Renders an `<img>` with `src="/pets/akita_walk_8fps.gif"`, `alt=""`, `width="174"`, `height="115"`, and `className` containing `pet-stroll`.

Don't test breakpoint behavior — that's a CSS concern (spec D3 explicitly defers it to E2E).

- [ ] **Step 5: Integrate into `src/app/page.tsx`**

Wrap the existing `<main>` content so the pet panel can position absolutely against it:

```jsx
import { PetPanel } from "@/components/pets/pet-panel";
// ... existing imports

export default function Home() {
  return (
    <main className="relative p-6">
      <PetPanel />
      {/* ... existing status bar, headline, paragraph, prompt, grid ... */}
    </main>
  );
}
```

The `relative` on `<main>` is the new addition — establishes a positioning context for the absolutely-positioned `<PetPanel />`. Everything else in `page.tsx` stays exactly as it is.

- [ ] **Step 6: Update `src/app/page.test.tsx`**

Add a test:

```ts
it("renders the pet panel inside the hero", () => {
  render(<Home />);
  expect(screen.getByTestId("pet-panel")).toBeInTheDocument();
});
```

Don't add any pet-internals tests — those live in `pet-panel.test.tsx`.

- [ ] **Step 7: Gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: typecheck/lint clean. Total test count: was 215 after Phase 7; +3 from pet-panel.test.tsx + 1 from page.test.tsx + 1 from footer.test.tsx (Task 3 if landed) = ~220.

- [ ] **Step 8: Commit**

```bash
git add src/app/globals.css src/components/pets/ src/app/page.tsx src/app/page.test.tsx
git commit -m "feat(home): add ambient pet panel to hero

Akita dog from VS Code Pets walks back and forth in a 400x140
panel anchored top-right of the hero. Pure CSS animation:
@keyframes pet-stroll handles the cross-panel translation +
mid-stroll mirror flip; browser-native GIF playback handles the
walk-cycle character animation. xl: breakpoint hides the panel
on viewports under 1280px to avoid headline overlap.

Reduced-motion users see a static PNG fallback via <picture>
<source media=\"(prefers-reduced-motion: reduce)\">."
```

(72-char body line limit. Wrap as needed.)

---

## Task 5: E2E breakpoint test

**Goal:** Verify the pet panel is visible at xl+ viewports and hidden below.

**Files:**
- Modify: `tests/e2e/home-page.spec.ts`

- [ ] **Step 1: Verify branch**

- [ ] **Step 2: Add two tests at the bottom of `home-page.spec.ts`**

```ts
test("pet panel is visible at xl viewport (1440x900)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("pet-panel")).toBeVisible();
});

test("pet panel is hidden below xl viewport (1024x768)", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await expect(page.getByTestId("pet-panel")).toBeHidden();
});
```

Both tests run against all 3 browsers (chromium/firefox/webkit). Visibility is a CSS rule (`display: none` from `hidden` until `xl:block` kicks in), so all browsers should agree.

- [ ] **Step 3: Run E2E**

```bash
pnpm test:e2e tests/e2e/home-page.spec.ts
```

Expected: all home-page tests pass on all 3 browsers (was 15; now 21 = 7 tests × 3 browsers).

If a browser fails the visibility assertion, the breakpoint may be defined differently — investigate before paper over.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/home-page.spec.ts
git commit -m "test(e2e): pet panel visibility at xl breakpoint"
```

---

## Task 6: Manual smoke + final gates + push + open PR

**Goal:** Real-browser visual check, full gate sweep, push, open PR.

- [ ] **Step 1: Manual Chrome smoke (controller, not subagent)**

```bash
pnpm dev   # NOT --turbopack
```

Visit `http://localhost:3000` at multiple widths:
1. **1440×900 (typical desktop):** pet panel visible top-right; akita walks left-to-right, pauses, walks back, loops smoothly. No layout shift, no overlap with the headline.
2. **1280×800 (xl boundary):** panel just barely fits; verify no headline overlap.
3. **1100×800 (below xl):** panel hidden; hero is asymmetric but acceptable.
4. **375×667 (mobile):** panel hidden; hero stacks normally.

Verify `prefers-reduced-motion`:
- macOS: System Settings → Accessibility → Display → Reduce motion → ON
- Reload `/`; pet should be a static frame, no cross-panel movement, GIF not playing

If anything looks off, screenshot and discuss before pushing.

- [ ] **Step 2: Full gate sweep**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e
```

Expected: all green. Build produces `out/` static export with same 7 routes; `/` is still a server component (160 B route). `out/pets/` contains the asset files.

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin phase-8-home-page-pet
gh pr create --title "Phase 8: ambient akita pet on home page" --body "$(cat <<'EOF'
## Summary

Fills the upper-right negative space on \`/\` with one walking pixel-art pet (akita dog from VS Code Pets, CC BY-ND 4.0). Pure CSS animation, no client JS, no engine code touched.

Spec: \`docs/superpowers/specs/2026-05-02-home-page-pet.md\`
Plan: \`docs/superpowers/plans/2026-05-02-phase-8-home-page-pet.md\`

## Commits

1. docs(phase-8): spec + plan
2. chore(pets): commit akita assets + CC BY-ND 4.0 license
3. feat(layout): footer attribution for akita pet asset
4. feat(home): add ambient pet panel to hero
5. test(e2e): pet panel visibility at xl breakpoint

## Phase 8 v1 limits (deliberate)

- One pet (akita dog), one behavior (walk back and forth), no interactions
- Visible only at viewports ≥ xl (1280px); asymmetric hero on smaller viewports is acceptable
- Reduced-motion users see a static PNG fallback (no GIF playback, no movement)
- No props (printer, desk, paper) — Phase 8b if v1 lands well visually

## License compliance

The akita assets are CC BY-ND 4.0 (NVPH Studio). Attribution surfaced in the global Footer; license text + source link committed to \`public/pets/LICENSE-pet-assets.md\`. GIF used verbatim; static PNG is the unmodified first frame of the idle GIF (single-frame extraction is not a derivative work).

## Test plan

- [x] \`pnpm typecheck\`
- [x] \`pnpm lint\`
- [x] \`pnpm test\` — +5 tests (pet panel, footer, page integration)
- [x] \`pnpm build\` — static export, 7 routes; +13 KB asset payload, 0 KB JS delta
- [x] \`pnpm test:e2e\` — +6 tests (panel visibility at xl + below xl × 3 browsers); pre-existing flakes carried over
- [x] Manual Chrome smoke at 1440 / 1280 / 1100 / 375 widths + reduced-motion
EOF
)"
```

Expected: PR URL is returned. Do NOT merge — that's the user's call.
