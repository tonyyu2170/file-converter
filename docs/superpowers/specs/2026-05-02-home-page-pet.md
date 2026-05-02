# Home page ambient pet — design

**Date:** 2026-05-02
**Phase:** 8 (fills the upper-right negative space the Phase 7 hero left empty)
**Scope:** One pixel-art pet (akita dog from VS Code Pets) walking back and forth in a bounded panel at the top-right of the home-page hero. Pure CSS animation. No engine code, no privacy/CSP/build-invariant changes.

## Background

Phase 7 shipped the new home-page hero (display headline + body paragraph + terminal prompt + tool grid). On wide viewports the upper-right region is visibly empty — a deliberate brutalist void, but tested in the wild by the user as feeling under-utilized. Phase 8 fills it with an ambient pixel-art pet that gives the page personality without compromising the page's privacy claim or the brutalist/terminal aesthetic.

Phase 8 is a deliberate v1 — single pet, no props, no behaviors beyond walking. If it lands well visually, **Phase 8b** (out of scope for this phase) expands to multiple pets, props (printer, desk), and a paper-carrying narrative that literalizes the file-conversion metaphor.

## Decisions

### D1. Asset choice — akita dog (VS Code Pets), CC BY-ND 4.0

Pet: **akita** color variant from `tonybaloney/vscode-pets` (`media/dog/akita_*.gif`). White/cream coat, contrasts cleanly with the page's `#0a0a0a` background.

License: **CC BY-ND 4.0** (per `media/dog/license.txt` in the source repo). Permissive — usable as-is with attribution; modifications are forbidden. We use the GIF files unmodified.

Why this choice over other VS Code Pets characters:
- Dog is the **only** VS Code Pets set with explicit, permissive per-asset licensing committed to the source repo. Marc Duiker's pets (clippy, rubber-duck, crab, snake, etc.) have no per-asset license file and no explicit terms on the artist's itch.io profile — usable in spirit but legally ambiguous. We don't take that risk silently.
- Akita has the richest animation set (idle, lie, run, swipe, walk, walk_fast, with_ball) — gives Phase 8b runway without re-litigating the asset question.
- "akita" color over black (blends into bg), red (clashes with `--color-accent: #ff6b35`), and brown (warm but visually muted against dark bg).

Attribution requirement (CC BY-ND): credit NVPH Studio and link the license. Surfaced via a small line in the global `<Footer>`, not on the home page itself — credits are long-lived but don't deserve hero real estate.

### D2. Behavior v1 — continuous stroll, no interactions

The pet walks left-to-right across the panel, pauses ~1 second at the right edge to turn around, walks right-to-left, pauses at the left edge to turn around, loops. Round trip duration: **30 seconds** (slow enough to read as ambient, not distracting).

No idle stops, no random behaviors, no mouse interactions, no clicks. The pet is decorative, period. Click handlers, hover tricks, and pet-following-cursor are deferred to Phase 8b.

### D3. Placement — bounded panel top-right, xl+ only

The pet lives in a fixed-size panel positioned absolutely in the upper-right of the hero region:

- Width: **400px**
- Height: **140px** (a hair taller than the dog's 115px height, gives breathing room)
- Position: aligned to the top of the hero `<main>`, right-aligned to the page padding
- Visibility: `hidden xl:block` (xl breakpoint = 1280px). Below xl, the panel area is too narrow to coexist with the headline ("convert files" alone is ~580px wide at 72px monospace) without overlap. Asymmetric hero on smaller viewports is acceptable in brutalist design.

The panel does NOT have a visible border — just a transparent positioning container. The pet itself provides all visual weight. (Phase 8b might add a hairline border to ground the pet against props.)

`pointer-events-none` on the panel so it doesn't intercept clicks meant for layered content (the hero text, in case of any overlap edge case).

`aria-hidden="true"` — the pet is decorative, not informational. Screen readers skip it.

### D4. Animation tech — pure CSS keyframes + browser-native GIF

The walk-cycle character animation (legs moving) is handled by the browser's built-in animated-GIF playback at 8fps. The cross-panel movement is handled by a CSS `@keyframes` rule using `transform: translateX()` (transform is GPU-accelerated; doesn't trigger layout recalc).

Direction flipping: at the panel edges, `transform: scaleX(-1)` mirrors the sprite. The smooth interpolation between `scaleX(1)` and `scaleX(-1)` in CSS produces a brief "shrink and grow mirrored" animation that reads as a turn-around — happy accident.

Keyframes (added to `globals.css`):

```css
@keyframes pet-stroll {
  0%, 100%   { transform: translateX(0) scaleX(1); }
  47%        { transform: translateX(calc(400px - 174px)) scaleX(1); }
  50%        { transform: translateX(calc(400px - 174px)) scaleX(-1); }
  97%        { transform: translateX(0) scaleX(-1); }
}

.pet-stroll {
  animation: pet-stroll 30s linear infinite;
  will-change: transform;
}
```

(Implementation may use Tailwind arbitrary-value classes or a custom utility — exact mechanism is an implementation detail.)

NO JavaScript animation library, NO canvas, NO requestAnimationFrame loop. The page stays a server component; the pet GIF is a static asset; the animation is declarative CSS.

### D5. Reduced motion — static PNG fallback

When `prefers-reduced-motion: reduce`:
- No CSS animation (no panel-traversal movement)
- The GIF itself would still loop its walk frames — that's not OK for strict reduced-motion compliance

Solution: use a `<picture>` element with a `media` query swapping to a static PNG when reduced-motion is set:

```jsx
<picture>
  <source srcSet="/pets/akita_static.png" media="(prefers-reduced-motion: reduce)" />
  <img src="/pets/akita_walk_8fps.gif" alt="" width={174} height={115} className="pet-stroll" />
</picture>
```

PNG source: extract the first frame of `akita_idle_8fps.gif` (or the `akita_lie_8fps.gif` first frame — pet at rest reads as "static" more obviously). Implementer picks. ImageMagick or `gifsicle` can extract: `convert akita_idle_8fps.gif[0] akita_static.png`.

The static fallback shows the pet at the panel's left edge, no animation. Decorative element is still present, just not moving.

### D6. Attribution — global Footer

Add to `src/components/layout/footer.tsx`:

```
art: akita by NVPH Studio · CC BY-ND 4.0
```

With the artist link and license link as `<a>` elements. Keep the existing `count` and `version` props in the footer — append the credit as a third line or inline element. Implementer picks layout.

This is the minimum CC BY-ND requires: credit the creator, link the license, don't claim the work as our own.

### D7. Asset sourcing — committed to repo

Two files committed to `public/pets/`:
- `akita_walk_8fps.gif` (~10 KB, 174×115)
- `akita_static.png` (~3 KB estimated, single frame)

Total asset footprint: ~13 KB. Negligible. No build-time download script — assets are committed to the repo for reproducibility (the source repo could change or move).

The `LICENSE-pet-assets.md` file is added to `public/pets/` containing the full CC BY-ND 4.0 text and attribution — a co-located license trail for the assets.

## Invariants preserved

- **Static export.** `/` remains a server component with no client-side JS. The pet panel is server-rendered HTML; the animation runs entirely in the browser via static CSS + GIF playback.
- **CSP.** No `'unsafe-inline'` style needed; all CSS lives in `globals.css`. No `'unsafe-eval'` needed; no JS evaluation. WASM is not involved. No fetch / network requests for the pet — assets are local.
- **No engine code touched.** Only `src/app/page.tsx` (add the pet panel JSX), `src/app/globals.css` (add keyframes), `src/components/layout/footer.tsx` (attribution), and the new `public/pets/` files.
- **8 GB RAM dev box.** No new build-time tooling. No new dev-server overhead. Bundle size delta is ~13 KB of assets, no JS.

## Test plan

### Component tests

- **Update** `src/app/page.test.tsx`:
  - Add: pet panel renders at `data-testid="pet-panel"` (asserts presence; visibility-by-breakpoint is a CSS concern, not unit-test concern)
  - Add: panel contains a `<picture>` with a `<source>` for reduced-motion + an `<img>` for default
  - Add: panel has `aria-hidden="true"`
- **New** `src/components/layout/footer.test.tsx`:
  - Asserts the attribution line renders with the artist link + license link
  - Asserts the existing `count` and `version` props still render

### E2E

- **Update** `tests/e2e/home-page.spec.ts`:
  - Add a Chromium-only test (use `test.skip` for firefox + webkit) that sets viewport to 1440×900, navigates to `/`, asserts the pet panel is visible (`getByTestId("pet-panel")` is in viewport)
  - Add a counterpart that sets viewport to 1024×768, navigates to `/`, asserts the pet panel is NOT visible (`hidden xl:block` should kick in below xl=1280)

Don't add visual regression / animation timing assertions — flaky and brittle.

### Gates

`pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e` — all green. Bundle size delta ~0 KB (no new JS); asset payload delta +13 KB.

## Files (additions / modifications)

**Add:**
- `public/pets/akita_walk_8fps.gif` (asset, copied from VS Code Pets)
- `public/pets/akita_static.png` (asset, single-frame extract)
- `public/pets/LICENSE-pet-assets.md` (CC BY-ND 4.0 text + attribution)
- `src/components/pets/pet-panel.tsx` (new component — small, just markup)
- `src/components/pets/pet-panel.test.tsx`
- `src/components/layout/footer.test.tsx` (didn't exist before)

**Modify:**
- `src/app/page.tsx` — add `<PetPanel />` to the hero region
- `src/app/page.test.tsx` — assertions for the panel
- `src/app/globals.css` — `@keyframes pet-stroll` + `.pet-stroll` class
- `src/components/layout/footer.tsx` — attribution line

## Out of scope (Phase 8b — future, contingent on Phase 8 landing well)

- Multiple pets on screen
- Props: printer, desk, paper sprites
- Behaviors: walk-to-printer, pick-up-paper, walk-to-desk, drop-paper, repeat (literalizes the file-conversion narrative)
- Pet-follows-cursor or click-to-pat interactions
- Theme variants (winter, forest, castle backgrounds from VS Code Pets)
- Other VS Code Pets characters (would re-open the licensing question for non-dog assets)

## Risks + mitigations

- **Aesthetic mismatch.** The pixel-art pet may look out-of-place against the brutalist UI. Mitigation: ship v1 with the simplest possible integration (just the pet, no props, no chrome). If it doesn't land, removing it is one PR (revert).
- **Performance on low-end devices.** A 30-second CSS animation is cheap, but an animated GIF still consumes some CPU per frame. The pet is `hidden xl:block` so mobile isn't affected. Reduced-motion fallback handles users with explicit motion preferences.
- **License compliance.** CC BY-ND requires attribution + no modification. Footer attribution covers the first; we use the GIF as-is (no edits) to cover the second. Adding the full license text in `public/pets/LICENSE-pet-assets.md` provides a clear trail.
