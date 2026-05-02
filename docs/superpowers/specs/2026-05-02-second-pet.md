# Phase 8b — Second pet (with ball) — design

**Date:** 2026-05-02
**Phase:** 8b (extends Phase 8's pet panel; deferred work from the Phase 8 spec)
**Scope:** Add a second akita dog to the home-page pet panel, using the `with_ball` GIF variant. Two-lane layout. No engine code, no privacy/CSP/build invariant changes, no new attribution surface.

## Background

Phase 8 shipped one akita dog walking back and forth in the upper-right hero panel. Visual outcome: landed. Phase 8b extends per the Phase 8 spec's "out of scope" section — specifically combining sub-options **8b.1 (multiple pets)** and **8b.4 (use the `with_ball` GIF)** from the design discussion.

The literal vision (paper between printer and desk) still requires custom pixel art that doesn't exist in any clean-license library — deferred until that's commissioned. This phase is the smallest meaningful step toward "the dog is doing something" without inventing assets.

## Decisions

### D1. Two dogs, two lanes

Both dogs share the existing 400×240 panel:

- **Dog 1 (walk):** bottom of panel (`bottom-0`) — unchanged from Phase 8
- **Dog 2 (with ball):** upper portion of panel (`bottom-[140px]` — sits clearly above dog 1, no overlap)

Two-lane layout is clearer than same-lane-with-collisions. Dogs occupy ~57px tall each in a 240px-tall panel; ~80px of vertical separation between them reads as "two distinct floors" rather than "buggy overlap."

### D2. Dog 2 uses `with_ball` GIF, opposite direction, slower

- **Asset:** `akita_with_ball_8fps.gif` from `tonybaloney/vscode-pets/media/dog/`. Same source, artist (NVPH Studio), and license (CC BY-ND 4.0) as the Phase 8 walk GIF. Footer attribution already covers it — no new credit line needed.
- **Direction:** right-to-left (opposite of dog 1). Implemented via `animation-direction: reverse` on the existing `pet-stroll` keyframes — no new keyframes needed. The mirror-flip logic plays correctly in reverse (start facing left at the right edge, walk left, flip mid-stroll, walk back right).
- **Timing:** 14s round trip (Phase 8 dog 1 is 10s). "Carrying" reads as more deliberate; the slight speed difference also prevents the dogs from staying perfectly synchronized.

### D3. New CSS class for reverse stroll

Add a single `.pet-stroll-reverse` class to `globals.css` that pairs the existing `pet-stroll` keyframes with `animation-direction: reverse` and the new 14s duration:

```css
.pet-stroll-reverse {
  animation: pet-stroll 14s linear infinite reverse;
  will-change: transform;
}
```

Reduced-motion override extends to cover the new class — both `.pet-stroll` and `.pet-stroll-reverse` get `animation: none` + reset transform.

### D4. Reduced-motion fallback for the second dog

Each `<picture>` has its own `<source media="(prefers-reduced-motion: reduce)">`. Dog 2 needs a static PNG. Generate the same way as Phase 8: extract the first frame of `akita_with_ball_8fps.gif` via ImageMagick.

Asset list after this phase:
- `public/pets/akita_walk_8fps.gif` (existing)
- `public/pets/akita_static.png` (existing — first frame of idle, used as dog 1 fallback)
- `public/pets/akita_with_ball_8fps.gif` (new)
- `public/pets/akita_with_ball_static.png` (new — first frame of with_ball)
- `public/pets/LICENSE-pet-assets.md` (existing — already covers all akita assets)

## D5. Component shape

`PetPanel` renders two `<picture>` blocks side-by-side as siblings (each absolutely-positioned with their own bottom offset):

```jsx
<div className="pointer-events-none absolute right-6 top-6 hidden h-[240px] w-[400px] xl:block" data-testid="pet-panel" aria-hidden="true">
  <picture>
    <source srcSet="/pets/akita_static.png" media="(prefers-reduced-motion: reduce)" />
    <img
      src="/pets/akita_walk_8fps.gif"
      alt=""
      width={87}
      height={57}
      data-testid="pet-walk"
      className="pet-stroll absolute bottom-0 left-0 [image-rendering:pixelated]"
    />
  </picture>
  <picture>
    <source srcSet="/pets/akita_with_ball_static.png" media="(prefers-reduced-motion: reduce)" />
    <img
      src="/pets/akita_with_ball_8fps.gif"
      alt=""
      width={87}
      height={57}
      data-testid="pet-ball"
      className="pet-stroll-reverse absolute bottom-[140px] left-0 [image-rendering:pixelated]"
    />
  </picture>
</div>
```

Each `<img>` gets a `data-testid` (`pet-walk`, `pet-ball`) for testing.

## Invariants preserved

- **Static export.** `/` remains a server component, no JS delta.
- **CSP.** No inline styles, no eval. Animation is declarative CSS only.
- **Bundle size.** Asset payload +~12 KB (one new GIF + one new PNG); no JS delta.
- **Attribution.** Footer credit unchanged — same artist, same license, same blanket attribution covers all akita assets.

## Test plan

### Component tests

- **Update** `src/components/pets/pet-panel.test.tsx`:
  - Existing 3 tests adapted: query the walk dog by `data-testid="pet-walk"` instead of `container.querySelector("img")`
  - Add 2 new tests for the ball dog: presence + correct GIF src + reduced-motion source
  - Final test count: ~5

### E2E

Existing breakpoint tests (`pet panel is visible at xl viewport` / `hidden below xl viewport`) cover the panel as a whole — they don't need updates.

### Gates

`pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e` all green. `/` route still 160 B.

## Files (additions / modifications)

**Add:**
- `public/pets/akita_with_ball_8fps.gif` (asset)
- `public/pets/akita_with_ball_static.png` (asset, single-frame extract)

**Modify:**
- `public/pets/LICENSE-pet-assets.md` — extend the file list line (`akita_*.png` and `akita_*.gif` already covers it; just verify wording stays accurate)
- `src/app/globals.css` — add `.pet-stroll-reverse` class + extend reduced-motion override
- `src/components/pets/pet-panel.tsx` — render second `<picture>` block
- `src/components/pets/pet-panel.test.tsx` — adapted + new assertions

## Out of scope (Phase 8c — future)

- Props (printer, desk, paper) — still needs custom pixel art
- Pet interactions (one dog approaches the other, etc.)
- More than two dogs
- Behavior states (e.g., one dog occasionally lies down)
- Themed backgrounds (winter/forest/castle from VS Code Pets — uncertain licensing)
