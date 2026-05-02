# Phase 8b — Second pet (akita with ball)

**Goal:** Add a second akita dog (using the `with_ball` GIF variant) to the existing home-page pet panel. Two-lane layout, opposite direction, slightly slower than the Phase 8 walk dog. Single PR (matches Phase 8's structure — small change, no shared infra).

**Spec:** [`docs/superpowers/specs/2026-05-02-second-pet.md`](../specs/2026-05-02-second-pet.md).

**Branch:** `phase-8b-second-pet` (created off `main` after Phase 8 merge — `89ded9c`).

**Critical ordering:**
- Task 1 (spec + plan) first.
- Task 2 (assets) before Task 3 (component references the asset paths).
- Task 4 (smoke + gates + PR) last.

**Branch discipline:** stay on `phase-8b-second-pet`. Allowed git: `git status`, `git diff`, `git log`, `git branch --show-current`, `git add <specific files>`, `git commit`. NEVER `git checkout`, `git switch`, `git push --force`, `--no-verify`.

---

## Task 1: Commit spec + plan

```bash
git branch --show-current  # phase-8b-second-pet
git add docs/superpowers/specs/2026-05-02-second-pet.md docs/superpowers/plans/2026-05-02-phase-8b-second-pet.md
git commit -m "docs(phase-8b): spec + plan for second akita pet (with ball)"
```

---

## Task 2: Acquire `with_ball` asset

**Goal:** Download the GIF, extract a static PNG fallback. License unchanged (existing `LICENSE-pet-assets.md` covers it via the `akita_*` glob).

```bash
curl -sL -o public/pets/akita_with_ball_8fps.gif \
  https://raw.githubusercontent.com/tonybaloney/vscode-pets/main/media/dog/akita_with_ball_8fps.gif

magick 'public/pets/akita_with_ball_8fps.gif[0]' public/pets/akita_with_ball_static.png

file public/pets/akita_with_ball_8fps.gif public/pets/akita_with_ball_static.png
# Expect: GIF 174×115, PNG 174×115

git add public/pets/akita_with_ball_8fps.gif public/pets/akita_with_ball_static.png
git commit -m "chore(pets): add akita with-ball assets"
```

---

## Task 3: Add second dog to PetPanel + CSS reverse class

**Goal:** Update `pet-panel.tsx` to render a second `<picture>` for the ball dog. Add `.pet-stroll-reverse` to `globals.css`. Update tests.

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/pets/pet-panel.tsx`
- Modify: `src/components/pets/pet-panel.test.tsx`

### Step 1: globals.css

Add after the existing `.pet-stroll` rule, before the `@media (prefers-reduced-motion: reduce)` block:

```css
.pet-stroll-reverse {
  animation: pet-stroll 14s linear infinite reverse;
  will-change: transform;
}
```

Extend the reduced-motion override to cover both classes:

```css
@media (prefers-reduced-motion: reduce) {
  .pet-stroll,
  .pet-stroll-reverse {
    animation: none;
    transform: translateX(0) scaleX(1);
  }
}
```

### Step 2: pet-panel.tsx

Replace the existing `<picture>` block with two siblings:

```jsx
export function PetPanel() {
  return (
    <div
      className="pointer-events-none absolute right-6 top-6 hidden h-[240px] w-[400px] xl:block"
      data-testid="pet-panel"
      aria-hidden="true"
    >
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
  );
}
```

### Step 3: pet-panel.test.tsx

Adapt the existing 3 tests:
- Test 1 (panel + aria-hidden) — unchanged
- Test 2 (picture + reduced-motion source) — query both `<picture>` elements; assert both have a `<source>` with the right `srcSet` and `media`
- Test 3 (img with src/alt/width/height/className) — query by testids `pet-walk` and `pet-ball`; assert each has the right `src`, `width=87`, `height=57`, and respective class (`pet-stroll` vs `pet-stroll-reverse`)

Add a 4th test asserting both dogs are simultaneously present (`pet-walk` AND `pet-ball` both in document).

### Step 4: Gates

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: 222 → ~223 (one new test). All green.

### Step 5: Commit

```bash
git add src/app/globals.css src/components/pets/pet-panel.tsx src/components/pets/pet-panel.test.tsx
git commit -m "feat(home): second akita dog (with ball) in pet panel

Two-lane layout: original walk dog at bottom, new with-ball
dog at upper position. Opposite direction (animation-direction:
reverse) and slightly slower (14s vs 10s) to avoid synchronized
movement. Same panel, same Footer attribution covers both."
```

---

## Task 4: Manual smoke + final gates + open PR

### Step 1: Manual smoke (controller, not subagent)

```bash
pnpm dev
```

Visit `http://localhost:3000` at 1440×900. Verify:
1. Two dogs visible in the upper-right panel
2. Walk dog (bottom) moves left-to-right at the same pace as before (10s)
3. Ball dog (top) moves right-to-left at slightly slower pace (14s), with a ball in mouth
4. They cross paths but stay in separate vertical lanes (no overlap)
5. Both flip direction at panel edges
6. `prefers-reduced-motion` ON: both dogs become static images at their starting positions

### Step 2: Final gates

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e
```

Expected: all green. `/` still 160 B (no JS delta, just static markup + asset payload). Pre-existing webkit `pdf-split.spec.ts:111` flake may reproduce — note in PR body, don't fix.

### Step 3: Push + PR

```bash
git push -u origin phase-8b-second-pet
gh pr create --title "Phase 8b: second akita dog (with ball)" --body "..."
```
