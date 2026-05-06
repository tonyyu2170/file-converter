# Phase 18: image-bg-remove model swap — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the portrait-only MODNet model in the `image-bg-remove` engine with a general-purpose alternative (lead candidate: **BiRefNet-lite int8**) that produces usable masks on non-portrait inputs, without changing the engine boundary, the public surface, or the privacy guarantees.

**Architecture:** Same engine boundary, new weights + threshold tuning + broadened test fixtures. The existing engine code already handles BiRefNet-style labeled segments — the worker prefers a `"subject"`-labeled segment when present and falls back to the first segment otherwise (`src/engines/image-bg-remove/worker.ts:73-75`). The model directory name on disk stays `bg-remove` (driven by `MODEL_ID` in `model-loader.ts` and a hardcoded destination in `scripts/copy-bg-models.mjs`); only the *contents* of `public/models/bg-remove/` change. Source spec: `docs/superpowers/specs/2026-05-05-v2-design.md` §1.2, §3.6, §6.2, §7.1, §8.1, §11. Phase 18 is the leading phase of v2 and is designed as a v1.1 escape hatch — it must ship independently if v2 stalls.

**Tech Stack:** `@huggingface/transformers` 4.2.0, ONNX Runtime Web (WASM EP, threaded), Vitest, Playwright. No new dependencies.

**Hard prerequisite:** Task 1 is a **verification gate** — the lead candidate (BiRefNet-lite int8) must pass empirical OOM + correctness checks on the 8 GB dev box before the rest of the tasks proceed. If the lead candidate is disqualified, Task 1 picks a fallback (ISNet-DIS-tiny → U2Net quantized) and the executor halts to confirm the substitution before continuing. Subsequent tasks are written against BiRefNet-lite int8; if the gate substitutes a different model, the executor adapts the model identifier, dtype, and HF source values in Tasks 2–4 to the chosen model.

**Out of scope (this phase):**
- `/about` engines table footnote removal (owned by Phase 26 per spec §3.6).
- Any change to the worker's segment-selection heuristic, alpha compositing, or solid-mode logic.
- Any change to OptionsPanel UX, validation cap mechanism, or harness behavior.

---

## File map

**Modified:**
- `scripts/bg-models-manifest.json` — model identifier + file SHAs replaced.
- `src/engines/image-bg-remove/model-loader.ts` — comments updated to describe the new model and reasoning; `dtype` and `device` revised only if the new model needs it.
- `src/engines/image-bg-remove/index.ts` — `library` field updated; size cap (`MAX_FILE_BYTES`) revised only if Task 1 OOM verification dictates.
- `src/engines/image-bg-remove/model-loader.test.ts` — `dtype` assertion updated only if dtype changes.
- `tests/e2e/image-bg-remove-correctness.spec.ts` — `alphaCoverageRange` retuned around new-model baselines; new fixtures appended.
- `tests/fixtures/bg-remove/SOURCES.md` — new fixture rows added.

**Created:**
- `tests/fixtures/bg-remove/animal.jpg` — new non-portrait fixture (Unsplash).
- `tests/fixtures/bg-remove/indoor-scene.jpg` — new non-portrait fixture (Unsplash).
- `docs/superpowers/plans/phase-18-verification-log.md` — empirical OOM + baseline coverage measurements collected in Task 1 + Task 7. Committed alongside the model swap as evidence.

**Untouched (verify no edits):**
- `src/engines/image-bg-remove/worker.ts` — segment-label heuristic already handles BiRefNet output. Edits would only be needed if Task 1 reveals a model-specific incompatibility, which would itself be a verification-gate failure.
- `src/engines/image-bg-remove/options.ts`, `options-panel.tsx`, `index.test.ts`, `options.test.ts`, `options-panel.test.tsx`.
- `src/engines/_shared/*` — no shared-code edits.
- `scripts/fetch-bg-models.mjs`, `scripts/copy-bg-models.mjs` — no script logic changes (manifest-driven).
- `vercel.json`, `next.config.ts`.

---

## Task 1: Verification gate — research + OOM + decision

**Files:**
- Create: `docs/superpowers/plans/phase-18-verification-log.md`

This is a discovery/measurement task; no code changes. Output is the verification log that gates the rest of the plan.

- [ ] **Step 1.1: Look up the canonical HuggingFace ONNX port for the lead candidate.**

The repo already uses Xenova-published or onnx-community-published ports (cf. existing manifest `source: "Xenova/modnet@<sha>"`). For BiRefNet-lite int8, the canonical paths to check, in order of preference:
1. `onnx-community/BiRefNet_lite-ONNX`
2. `Xenova/BiRefNet_lite`
3. `briaai/RMBG-1.4` (close substitute; general-purpose; widely-used permissive port — note license terms before adopting)

For each candidate, verify on huggingface.co:
- A `q8` / `int8` variant exists in the `onnx/` subfolder (filename suffix `_quantized.onnx` or explicit `int8`).
- License is permissive (Apache-2.0 or MIT preferred; RMBG-1.4 is a custom non-commercial license — acceptable for personal-use file converter but document it).
- A pinned commit SHA is recorded for reproducibility.

Record in `phase-18-verification-log.md`:

```markdown
# Phase 18 verification log

## Model candidate research (Task 1.1)

| Path | int8/q8 weights file | License | Pinned commit | Selected? |
|------|----------------------|---------|---------------|-----------|
| onnx-community/BiRefNet_lite-ONNX | <filename> | <license> | <sha> | ☐ |
| Xenova/BiRefNet_lite | <filename> | <license> | <sha> | ☐ |
| briaai/RMBG-1.4 | <filename> | <license> | <sha> | ☐ |

Selected for OOM testing: <path>@<sha>
Rationale: <one sentence>
```

- [ ] **Step 1.2: Manually populate the cache with the candidate.**

Without modifying the committed manifest, place the candidate's files at the layout `node_modules/.cache/bg-models/birefnet-lite/{config.json, preprocessor_config.json, onnx/model_quantized.onnx}` and copy them to `public/models/bg-remove/` (overwriting MODNet) for a one-shot dev run. Use `huggingface-cli download` or direct CDN URLs (`https://huggingface.co/<repo>/resolve/<sha>/<file>`).

Document the download commands used in the verification log under a `## Cache population (Task 1.2)` heading. **Important:** these are one-shot manual steps — do not commit `node_modules/.cache/` or stale `public/models/bg-remove/` contents.

- [ ] **Step 1.3: Run the engine locally on the four required input sizes.**

Start the dev server (`pnpm dev`), navigate to `/tools/image-bg-remove`, and convert each of these images while watching Activity Monitor (or `htop`) for peak RSS:

1. **1080p portrait** — reuse `tests/fixtures/bg-remove/portrait-cluttered-bg.jpg` (1280×1600 ≈ 2 MP).
2. **1080p landscape non-portrait** — reuse `tests/fixtures/bg-remove/product-on-white.jpg` (1600×1128 ≈ 1.8 MP).
3. **2K landscape** — manually upload a 2560×1440 ≈ 3.7 MP non-portrait image. Acquire from Unsplash (any landscape, ≤ 5 MB after JPEG compression).
4. **4K landscape** — manually upload a 3840×2160 ≈ 8.3 MP non-portrait image. Note: the engine's 24 MP pixel cap (worker.ts:46) admits this; the 25 MB byte cap (index.ts:13) admits it too if JPEG-compressed reasonably.

For each input, record in the verification log under `## OOM verification (Task 1.3)`:
- Peak browser-process RSS during inference (sample every ~2 seconds).
- Wall-clock inference time.
- Whether the conversion completed, OOM'd, or hung.
- Subjective mask quality (1-line: "tight silhouette," "missed limbs," "fully opaque output," etc.).

Expected: BiRefNet-lite int8 should fit in well under 4 GB RAM on the WASM EP and produce visibly correct masks on all four. If 4K OOMs but 2K is fine, the path forward is "ship the model, lower the pixel cap from 24 MP to 8 MP" — record that decision.

- [ ] **Step 1.4: Decide and document.**

In the verification log, write a `## Decision (Task 1.4)` section that pins:

```markdown
## Decision (Task 1.4)

**Selected model:** <e.g. onnx-community/BiRefNet_lite-ONNX>
**Pinned commit:** <sha>
**dtype:** <q8 | fp16 | fp32>
**device:** wasm  (unchanged from MODNet)
**Effective input cap:** <e.g. unchanged at 25 MB / 24 MP> OR <new cap if OOM dictates>
**Mask quality summary:** <2-3 sentences across the 4 fixtures>
**Fallback used (if any):** <none | ISNet-DIS-tiny | U2Net quantized — and why>
```

If the lead candidate failed verification at every fallback level, **halt the plan and replan**. Phase 18 cannot proceed without a verified general-purpose model.

- [ ] **Step 1.5: Restore working tree.**

Revert `public/models/bg-remove/` and `node_modules/.cache/bg-models/` to MODNet (re-run `pnpm postinstall` if needed). The plan's subsequent tasks change the manifest cleanly; the working tree must be uncommitted-edits-free before Task 2 begins.

Run: `git status`
Expected: only `docs/superpowers/plans/phase-18-verification-log.md` shows as untracked.

- [ ] **Step 1.6: Commit the verification log.**

```bash
git add docs/superpowers/plans/phase-18-verification-log.md
git commit -m "docs(phase-18): bg-remove model verification log"
```

---

## Task 2: Replace model manifest

**Files:**
- Modify: `scripts/bg-models-manifest.json`

- [ ] **Step 2.1: Compute SHA-256s for the chosen model files.**

For each of `config.json`, `preprocessor_config.json`, and `onnx/<weights>.onnx` from the chosen HuggingFace repo at the pinned commit, compute SHA-256:

```bash
# Replace <repo> and <sha> with the values from Task 1.4
for f in config.json preprocessor_config.json onnx/model_quantized.onnx; do
  curl -sL "https://huggingface.co/<repo>/resolve/<sha>/$f" | shasum -a 256
done
```

Record the SHAs.

- [ ] **Step 2.2: Update the manifest.**

Replace the contents of `scripts/bg-models-manifest.json`. Keep the `wasm:` array unchanged (those are ONNX Runtime Web binaries, not model-specific). Update `model`, `license`, `source`, `requiredDtype`, `files[]`, and `_notes`:

```json
{
  "model": "birefnet-lite",
  "license": "<license from Task 1.1>",
  "source": "<repo>@<sha>",
  "requiredDtype": "q8",
  "files": [
    {
      "name": "config.json",
      "sha256": "<sha from Task 2.1>"
    },
    {
      "name": "preprocessor_config.json",
      "sha256": "<sha from Task 2.1>"
    },
    {
      "name": "onnx/model_quantized.onnx",
      "sha256": "<sha from Task 2.1>"
    }
  ],
  "wasm": [
    /* unchanged — copy from current manifest */
  ],
  "_notes": {
    "model_size": "Int8-quantized ONNX (model_quantized.onnx) is ~<measured size> MB. General-purpose successor to MODNet (which was portrait-optimized and produced unusable masks on non-portrait inputs). Verification: docs/superpowers/plans/phase-18-verification-log.md.",
    "ort_version": "Tied to onnxruntime-web 1.26.0-dev.20260416-b7804b056c (the version pinned by @huggingface/transformers 4.2.0). If transformers.js bumps, regenerate these wasm sha256 values.",
    "pipeline": "Loadable via pipeline('image-segmentation', 'bg-remove', { dtype: 'q8' }). The disk directory name 'birefnet-lite' is the manifest cache key; copy-bg-models.mjs maps it to public/models/bg-remove/ regardless of model identity."
  }
}
```

- [ ] **Step 2.3: Run fetch + copy scripts.**

```bash
node scripts/fetch-bg-models.mjs
node scripts/copy-bg-models.mjs
```

Expected:
- `fetch-bg-models` downloads the three files, hash-verifies, exits 0.
- `copy-bg-models` copies them into `public/models/bg-remove/`, hash-verifies, exits 0.
- `public/models/bg-remove/` now contains the new files; `node_modules/.cache/bg-models/birefnet-lite/` exists.
- `node_modules/.cache/bg-models/modnet/` may persist on disk; that's fine (gitignored). It will be ignored by the manifest going forward.

- [ ] **Step 2.4: Sanity check the deployed layout.**

Run: `ls -la public/models/bg-remove/ public/models/bg-remove/onnx/`
Expected: `config.json`, `preprocessor_config.json`, `MANIFEST.json`, `onnx/model_quantized.onnx` present and recently modified.

- [ ] **Step 2.5: Commit.**

```bash
git add scripts/bg-models-manifest.json
git commit -m "Phase 18: swap bg-remove model to BiRefNet-lite int8 (manifest)"
```

(The `public/models/bg-remove/` contents are gitignored — only the manifest is tracked; the build pipeline regenerates the public files from the manifest cache.)

---

## Task 3: Update model-loader for new model

**Files:**
- Modify: `src/engines/image-bg-remove/model-loader.ts`
- Test: `src/engines/image-bg-remove/model-loader.test.ts`

The MODEL_ID constant stays `"bg-remove"` (the public directory is unchanged). The dtype stays `"q8"` (BiRefNet-lite int8 = q8). The device stays `"wasm"` (Task 1 verified the WASM path; WebGPU remains unverified, same caveat as for MODNet). The only required code change is comment text — model-loader.ts has comments referencing MODNet that are now wrong.

- [ ] **Step 3.1: Verify the unit test still passes against the unchanged model-loader logic.**

Run: `pnpm test src/engines/image-bg-remove/model-loader.test.ts`
Expected: PASS — the test mocks `@huggingface/transformers` and asserts `pipeline("image-segmentation", "bg-remove", { dtype: "q8", device: "wasm" })` is called. None of those values change.

- [ ] **Step 3.2: Update model-loader.ts comments.**

Open `src/engines/image-bg-remove/model-loader.ts`. The block at lines 24-40 references MODNet specifically:

```typescript
// We ship the int8 ONNX (`model_quantized.onnx`, ~6.6 MB) — the smallest
// MODNet variant Xenova/modnet publishes. The execution device is hard-pinned
// to "wasm" rather than probed for WebGPU. Reasons:
```

Replace with text reflecting the new model. Use the Edit tool to swap the lines:

**old_string** (the full comment block from line 24 through the "Reinstate WebGPU" sentence):

```
// We ship the int8 ONNX (`model_quantized.onnx`, ~6.6 MB) — the smallest
// MODNet variant Xenova/modnet publishes. The execution device is hard-pinned
// to "wasm" rather than probed for WebGPU. Reasons:
//
//  1. WebGPU + q8 is empirically unverified on real hardware we control.
//     Playwright Chromium's adapter does not advertise `shader-f16`, so our
//     correctness E2E only ever exercises the WASM path. Shipping a WebGPU
//     branch that no test covers is a privacy/correctness gamble.
//  2. transformers.js has known WebGPU+q8 failure modes for some model
//     classes, and image-segmentation hasn't been verified end-to-end.
//  3. The retry path in `getBgRemovalPipeline` resets `pipelinePromise` on
//     `.catch`, so a WebGPU adapter that throws on inference would loop:
//     each retry re-probes, picks WebGPU again, fails again. WASM avoids
//     the trap entirely.
//
// Reinstate WebGPU only after the path is exercised on real dGPU hardware
// (and after wiring a one-shot fallback to WASM on inference failure).
```

**new_string:**

```
// We ship the int8 ONNX (`model_quantized.onnx`) — the q8 BiRefNet-lite
// variant. BiRefNet-lite is a general-purpose dichotomous segmentation
// model; it replaces the prior MODNet build (~6.6 MB), which was
// portrait-optimized and produced unusable masks on non-portrait inputs.
// Verification: docs/superpowers/plans/phase-18-verification-log.md.
//
// The execution device is hard-pinned to "wasm" rather than probed for
// WebGPU. Reasons:
//
//  1. WebGPU + q8 is empirically unverified on real hardware we control.
//     Playwright Chromium's adapter does not advertise `shader-f16`, so our
//     correctness E2E only ever exercises the WASM path. Shipping a WebGPU
//     branch that no test covers is a privacy/correctness gamble.
//  2. transformers.js has known WebGPU+q8 failure modes for some model
//     classes, and image-segmentation hasn't been verified end-to-end.
//  3. The retry path in `getBgRemovalPipeline` resets `pipelinePromise` on
//     `.catch`, so a WebGPU adapter that throws on inference would loop:
//     each retry re-probes, picks WebGPU again, fails again. WASM avoids
//     the trap entirely.
//
// Reinstate WebGPU only after the path is exercised on real dGPU hardware
// (and after wiring a one-shot fallback to WASM on inference failure).
```

Also update the inline comment at lines 47-53 (`dtype` justification block) — currently it references "model_quantized.onnx" generically; the existing wording works for BiRefNet-lite int8 too (it's still `model_quantized.onnx`). Update only if the chosen model's filename suffix differs.

- [ ] **Step 3.3: Re-run the unit test.**

Run: `pnpm test src/engines/image-bg-remove/model-loader.test.ts`
Expected: PASS (comment-only change; behavior unchanged).

- [ ] **Step 3.4: Commit.**

```bash
git add src/engines/image-bg-remove/model-loader.ts
git commit -m "Phase 18: model-loader comments reflect BiRefNet-lite swap"
```

---

## Task 4: Update engine descriptor

**Files:**
- Modify: `src/engines/image-bg-remove/index.ts`
- Test: `src/engines/image-bg-remove/index.test.ts`

The `library` field currently says `"@huggingface/transformers (MODNet, portrait-only)"`. After the swap it must accurately describe the new model.

- [ ] **Step 4.1: Update the `library` field.**

Edit `src/engines/image-bg-remove/index.ts:48`:

**old_string:**
```typescript
  library: "@huggingface/transformers (MODNet, portrait-only)",
```

**new_string:**
```typescript
  library: "@huggingface/transformers (BiRefNet-lite int8)",
```

(Substitute the actual chosen model name from Task 1.4 if the executor selected a fallback.)

- [ ] **Step 4.2: Adjust `MAX_FILE_BYTES` if Task 1 OOM verification dictates.**

If the verification log records that 4K (≈ 8 MP) inputs OOM the 8 GB dev box, lower the cap. Edit `src/engines/image-bg-remove/index.ts:13`:

**old_string:**
```typescript
const MAX_FILE_BYTES = 25 * 1_000_000;
```

**new_string:** (if Task 1 dictates a smaller cap; otherwise skip this step)
```typescript
const MAX_FILE_BYTES = <new value> * 1_000_000;
```

If `MAX_FILE_BYTES` changes, also update the validate-error message string (line 70) to reflect the new limit:

**old_string:**
```typescript
        reason: `File too large for bg-remove (limit 25 MB; got ${(file.size / 1_000_000).toFixed(1)} MB).`,
```

**new_string:**
```typescript
        reason: `File too large for bg-remove (limit <new value> MB; got ${(file.size / 1_000_000).toFixed(1)} MB).`,
```

Similarly, if Task 1 dictates a smaller pixel cap, update `worker.ts:46` (`pixelCap = 24_000_000`) and the corresponding error message at line 49.

- [ ] **Step 4.3: Run the descriptor unit test.**

Run: `pnpm test src/engines/image-bg-remove/index.test.ts`
Expected: PASS (test assertions on `id`, `inputAccept`, `inputMime`, etc. — none of which changed). If a test asserts the `library` text directly, update its expected value to match the new string.

- [ ] **Step 4.4: Run the full engine unit test suite.**

Run: `pnpm test src/engines/image-bg-remove/`
Expected: all tests PASS.

- [ ] **Step 4.5: Commit.**

```bash
git add src/engines/image-bg-remove/index.ts
git commit -m "Phase 18: engine descriptor reflects BiRefNet-lite library text"
```

(Add `worker.ts` to the staging area as well if Task 4.2 changed pixelCap.)

---

## Task 5: Acquire new non-portrait fixtures

**Files:**
- Create: `tests/fixtures/bg-remove/animal.jpg`
- Create: `tests/fixtures/bg-remove/indoor-scene.jpg`
- Modify: `tests/fixtures/bg-remove/SOURCES.md`

Spec §3.6 + §6.2 require committed non-portrait fixtures spanning "object on plain bg, animal, indoor scene." `product-on-white.jpg` already covers "object on plain bg." Phase 18 adds `animal.jpg` and `indoor-scene.jpg`.

- [ ] **Step 5.1: Acquire candidate fixtures from Unsplash.**

Pick two photos under the Unsplash License (free for any use, attribution courtesy):

1. **Animal:** any animal in a natural setting with a clearly-visible silhouette. Avoid pure-white backgrounds (already covered by `product-on-white.jpg`). Examples: dog on grass, bird on branch, cat on couch.
2. **Indoor scene:** a person or object in a recognizable indoor environment. Distinct from `portrait-cluttered-bg.jpg` (which is outdoor-park). Examples: chair in a room, plant on a desk, person at a kitchen counter.

Download at `w=3000` (the maximum width Unsplash exposes on the public photo page).

- [ ] **Step 5.2: Resize and re-encode to fit under 1 MB.**

Match the existing fixture sourcing convention (see `tests/fixtures/bg-remove/SOURCES.md`): resize to ≤ 1600 px on the long side, JPEG quality ~70.

```bash
# Replace <input> and <output> per fixture
sips -Z 1600 -s format jpeg -s formatOptions 70 <input.jpg> --out <output.jpg>
```

Verify each output is < 1 MB:

```bash
ls -lh tests/fixtures/bg-remove/animal.jpg tests/fixtures/bg-remove/indoor-scene.jpg
```

Expected: both files exist and are < 1 MB.

- [ ] **Step 5.3: Record exact dimensions.**

```bash
sips -g pixelWidth -g pixelHeight tests/fixtures/bg-remove/animal.jpg tests/fixtures/bg-remove/indoor-scene.jpg
```

Note the output dimensions for each. These values are used in Task 7 (E2E `expectedWidth`/`expectedHeight` assertions).

- [ ] **Step 5.4: Update `SOURCES.md`.**

Open `tests/fixtures/bg-remove/SOURCES.md`. Append two rows to the table at the end:

```markdown
| animal.jpg | https://unsplash.com/photos/<slug> | <photographer> | <fetched dimensions> -> <resized dimensions> |
| indoor-scene.jpg | https://unsplash.com/photos/<slug> | <photographer> | <fetched dimensions> -> <resized dimensions> |
```

Above the table, in the "All fixtures are Unsplash photos" paragraph or a new note, mention that animal.jpg and indoor-scene.jpg were added in Phase 18 to broaden non-portrait coverage after the BiRefNet-lite model swap.

- [ ] **Step 5.5: Commit.**

```bash
git add tests/fixtures/bg-remove/animal.jpg tests/fixtures/bg-remove/indoor-scene.jpg tests/fixtures/bg-remove/SOURCES.md
git commit -m "Phase 18: add animal + indoor-scene non-portrait fixtures"
```

---

## Task 6: Baseline + retune correctness E2E ranges for the new model

**Files:**
- Modify: `tests/e2e/image-bg-remove-correctness.spec.ts`
- Modify: `docs/superpowers/plans/phase-18-verification-log.md` (append baseline observations)

The existing correctness spec asserts `alphaCoverageRange[low, high]` per fixture as a regression tripwire. The current ranges are tuned for MODNet. With BiRefNet-lite they must be retuned around the new model's empirical behavior.

The pattern is: temporarily widen ranges → run → observe → tighten to **±2 percentage points** around observed coverage (the spec §6.2 "±2% pixel tolerance" interpretation).

- [ ] **Step 6.1: Temporarily widen all coverage ranges to capture observations.**

Edit `tests/e2e/image-bg-remove-correctness.spec.ts` `FIXTURES` array (lines 54-89). Set every `alphaCoverageRange` to `[0.0, 1.0]` (no upper or lower gate) **for this measurement run only**:

```typescript
const FIXTURES = [
  {
    file: "product-on-white.jpg",
    alphaCoverageRange: [0.0, 1.0] as const,  // PHASE-18-MEASUREMENT
    expectedWidth: 1600,
    expectedHeight: 1128,
  },
  {
    file: "portrait-cluttered-bg.jpg",
    alphaCoverageRange: [0.0, 1.0] as const,  // PHASE-18-MEASUREMENT
    expectedWidth: 1280,
    expectedHeight: 1600,
  },
  {
    file: "transparent-glass.jpg",
    alphaCoverageRange: [0.0, 1.0] as const,  // PHASE-18-MEASUREMENT
    expectedWidth: 1028,
    expectedHeight: 1600,
  },
];
```

- [ ] **Step 6.2: Run the correctness suite and capture observations.**

```bash
RUN_BG_REMOVE_CORRECTNESS=1 pnpm test:e2e --project=chromium tests/e2e/image-bg-remove-correctness.spec.ts
```

Expected: 4 tests pass (3 fixture tests + the solid-mode test). The bytes/dimensions assertions still gate; only the coverage range is wide.

While the suite runs, the `alphaCoverageRange` block doesn't fail — but we need the actual coverage values. Two ways to capture them:

**Option A (preferred):** add a `console.log` line in the spec for measurement:

```typescript
// in the per-fixture test, after `const coverage = ...`
console.log(`[PHASE-18] ${fx.file}: coverage=${coverage.toFixed(4)}`);
```

Run the suite; capture the four log lines from output.

**Option B:** read coverage from the test report manually by inserting a temporary `expect(coverage).toBe(0)` (which fails and prints actual) — slower.

Use Option A. Record the four observed coverage values in `phase-18-verification-log.md` under a new `## Coverage baselines (Task 6.2)` section:

```markdown
## Coverage baselines (Task 6.2)

Empirical coverage measured on BiRefNet-lite int8 (from Task 1's chosen model):

| Fixture | Observed coverage |
|---|---|
| product-on-white.jpg | <value> |
| portrait-cluttered-bg.jpg | <value> |
| transparent-glass.jpg | <value> |
| animal.jpg | (Task 6.4) |
| indoor-scene.jpg | (Task 6.4) |
```

- [ ] **Step 6.3: Tighten existing-fixture ranges to baseline ±0.02.**

Replace the temporary `[0.0, 1.0]` ranges with `[observed - 0.02, observed + 0.02]`, clamped to `[0.0, 1.0]`. Remove the `console.log` and the `// PHASE-18-MEASUREMENT` comments.

For each fixture, also update the explanatory comment above its entry to reflect the new model (drop "MODNet portrait-optimized" framing, reference BiRefNet-lite). Example shape (substituting the actual observed value for `product-on-white.jpg`):

```typescript
const FIXTURES = [
  // Product on white BG: BiRefNet-lite isolates the subject and leaves
  // the white background transparent. Range tuned to ±0.02 around the
  // baseline observed in Phase 18 verification (see
  // docs/superpowers/plans/phase-18-verification-log.md).
  {
    file: "product-on-white.jpg",
    alphaCoverageRange: [<low>, <high>] as const,
    expectedWidth: 1600,
    expectedHeight: 1128,
  },
  // Cluttered portrait. Tightened around the BiRefNet-lite baseline; this
  // fixture stays in the suite as a regression gate against losing portrait
  // quality during the model swap.
  {
    file: "portrait-cluttered-bg.jpg",
    alphaCoverageRange: [<low>, <high>] as const,
    expectedWidth: 1280,
    expectedHeight: 1600,
  },
  // Failure-mode case: transparent glass. Translucent objects remain
  // model-difficult. The range is wide-but-not-trivial to keep
  // catastrophic-output regressions caught (fully opaque ~1.0 or fully
  // transparent ~0.0) without over-asserting on a known-mediocre input.
  {
    file: "transparent-glass.jpg",
    alphaCoverageRange: [<low>, <high>] as const,
    expectedWidth: 1028,
    expectedHeight: 1600,
  },
];
```

For `transparent-glass.jpg` specifically, if the observed coverage is in a model-mediocre range (e.g., the model produces a partial mask), use a slightly wider range ±0.05 — translucent-object outputs are not regression-stable. Record the rationale in the comment.

- [ ] **Step 6.4: Append the two new fixtures to the suite.**

After the existing three entries, add:

```typescript
  // Animal in natural setting — added in Phase 18 to broaden non-portrait
  // coverage. Range tuned to the BiRefNet-lite baseline observed during
  // Phase 18 verification.
  {
    file: "animal.jpg",
    alphaCoverageRange: [0.0, 1.0] as const,  // PHASE-18-MEASUREMENT
    expectedWidth: <from Task 5.3>,
    expectedHeight: <from Task 5.3>,
  },
  // Indoor scene — added in Phase 18.
  {
    file: "indoor-scene.jpg",
    alphaCoverageRange: [0.0, 1.0] as const,  // PHASE-18-MEASUREMENT
    expectedWidth: <from Task 5.3>,
    expectedHeight: <from Task 5.3>,
  },
```

- [ ] **Step 6.5: Run the suite again to capture observed coverage for the two new fixtures.**

```bash
RUN_BG_REMOVE_CORRECTNESS=1 pnpm test:e2e --project=chromium tests/e2e/image-bg-remove-correctness.spec.ts
```

Use the same `console.log` pattern from Step 6.2 if you didn't keep it. Capture the two new observations and append them to the `## Coverage baselines (Task 6.2)` table in the verification log.

- [ ] **Step 6.6: Tighten the new-fixture ranges.**

Replace the `[0.0, 1.0]` ranges for `animal.jpg` and `indoor-scene.jpg` with `[observed - 0.02, observed + 0.02]` clamped to `[0.0, 1.0]`. Remove `console.log` lines and `// PHASE-18-MEASUREMENT` comments.

- [ ] **Step 6.7: Run the full correctness suite once more — should pass with tightened ranges.**

```bash
RUN_BG_REMOVE_CORRECTNESS=1 pnpm test:e2e --project=chromium tests/e2e/image-bg-remove-correctness.spec.ts
```

Expected: 6 tests pass (5 fixture tests + the solid-mode test). All tightened ranges hold. If any fixture's observed coverage drifts outside ±0.02 from Task 6.2 (re-run determinism is rare but real with threaded WASM), widen that single range to ±0.03 and document the per-run variance in the verification log.

- [ ] **Step 6.8: Run the regular (non-gated) image-bg-remove E2E for sanity.**

```bash
pnpm test:e2e --project=chromium tests/e2e/image-bg-remove.spec.ts
```

Expected: PASS (the regular E2E asserts route loads, options-panel works, etc. — model-agnostic).

- [ ] **Step 6.9: Run the privacy-regression E2E.**

```bash
pnpm test:e2e --project=chromium tests/e2e/privacy-regression-image-bg-remove.spec.ts
```

Expected: PASS — zero outbound network during conversion. This is the privacy-load-bearing test; it must stay green across the model swap.

- [ ] **Step 6.10: Commit.**

```bash
git add tests/e2e/image-bg-remove-correctness.spec.ts docs/superpowers/plans/phase-18-verification-log.md
git commit -m "Phase 18: retune bg-remove correctness ranges + add 2 fixtures"
```

---

## Task 7: Full project verification

**Files:** none (verification only)

- [ ] **Step 7.1: Typecheck.**

```bash
pnpm typecheck
```

Expected: zero errors.

- [ ] **Step 7.2: Lint.**

```bash
pnpm lint
```

Expected: zero errors.

- [ ] **Step 7.3: Full unit + integration test suite.**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 7.4: Build + bundle isolation gate.**

```bash
pnpm build
```

Expected: build completes; `pnpm postbuild` runs `scripts/check-bundle-isolation.mjs` and exits 0 (no engine-specific imports in the homepage chunk; this gate is independent of the model swap but verifies Phase 18 didn't accidentally introduce a regression).

- [ ] **Step 7.5: Spot-check the production build of the bg-remove route.**

```bash
pnpm start &
PNPM_PID=$!
sleep 3
curl -s http://localhost:3000/tools/image-bg-remove | head -c 500
curl -sI http://localhost:3000/models/bg-remove/onnx/model_quantized.onnx | head -10
kill $PNPM_PID
```

Expected:
- The route HTML loads (200 OK; `[ READY ]` may not be in the static HTML — that's runtime).
- The model file is served (200 OK; `Cache-Control: public, max-age=31536000, immutable` from `vercel.json`).

- [ ] **Step 7.6: Manual smoke test in dev.**

```bash
pnpm dev
```

In a browser, navigate to `http://localhost:3000/tools/image-bg-remove`. For each of the five fixtures (`product-on-white.jpg`, `portrait-cluttered-bg.jpg`, `transparent-glass.jpg`, `animal.jpg`, `indoor-scene.jpg`):
- Drop the file.
- Click Convert.
- Wait for completion.
- Download.
- Visually inspect the output: the foreground subject should be cleanly isolated; the background should be transparent.

Record any subjective quality issues in the verification log under a new `## Manual smoke (Task 7.6)` section.

- [ ] **Step 7.7: Verify the privacy claim manually.**

With dev tools Network panel open and filter set to "Fetch/XHR":
- Reload the page — model files load from `/models/bg-remove/...` (same-origin, zero off-origin).
- Drop a file and Convert — observe **zero new network requests** during conversion.

This is the §10.3 demonstration; it must hold.

---

## Task 8: Final verification log update + plan PR

**Files:**
- Modify: `docs/superpowers/plans/phase-18-verification-log.md`

- [ ] **Step 8.1: Append a "Phase 18 complete" section to the verification log.**

```markdown
## Phase 18 complete (Task 8.1)

**Outcome:** Model swap landed. BiRefNet-lite int8 (or fallback if used) replaces MODNet. /about footnote remains and is owned by Phase 26.

**Quality summary:** <2-3 sentence subjective summary from manual smoke (Task 7.6)>

**Known caveats:**
- Translucent inputs (e.g., `transparent-glass.jpg`) remain model-difficult; the failure-mode case is preserved with a wider tripwire.
- /about engines table footnote ("portrait-optimized") still present; cleanup queued for Phase 26.
- <other items if any>

**Verification artifacts:**
- Coverage baselines: §Coverage baselines above
- Manual smoke: §Manual smoke above
- Privacy regression: passing E2E in CI
- Bundle isolation: green
```

- [ ] **Step 8.2: Commit.**

```bash
git add docs/superpowers/plans/phase-18-verification-log.md
git commit -m "Phase 18: verification log — model swap complete"
```

- [ ] **Step 8.3: Push and open PR.**

Phase 18 must be developed on a dedicated feature branch (e.g., `phase-18-bg-remove-model-swap`) — never directly on `main`. If the work is happening on `main`, halt and create a branch first via `git checkout -b phase-18-bg-remove-model-swap` (the `git status` baseline at the start of Task 1 should already be on this branch).

```bash
git push -u origin phase-18-bg-remove-model-swap
gh pr create --title "Phase 18: bg-remove model swap (MODNet → BiRefNet-lite int8)" --body "$(cat <<'EOF'
## Summary
- Replaces portrait-only MODNet with general-purpose BiRefNet-lite int8 in `image-bg-remove`.
- Same engine boundary: only weights, threshold tuning (coverage ranges), and fixtures change.
- Adds two non-portrait fixtures (animal, indoor scene) on top of the existing product-on-white case.
- /about engines table footnote ("portrait-optimized") removal is queued for Phase 26 per spec §3.6.

## Verification
- Empirical OOM verification on 8 GB dev box (1080p portrait, 1080p landscape, 2K, 4K) — see `docs/superpowers/plans/phase-18-verification-log.md`.
- Correctness E2E green with retuned coverage ranges (±0.02 around BiRefNet-lite baseline).
- Privacy regression E2E green (zero outbound network during conversion).
- Bundle isolation gate green.
- Lighthouse not re-run for this phase (no homepage changes); will re-verify in Phase 26 closeout.

## Test plan
- [x] `pnpm typecheck` clean
- [x] `pnpm lint` clean
- [x] `pnpm test` all green
- [x] `RUN_BG_REMOVE_CORRECTNESS=1 pnpm test:e2e tests/e2e/image-bg-remove-correctness.spec.ts` green
- [x] `pnpm test:e2e tests/e2e/privacy-regression-image-bg-remove.spec.ts` green
- [x] `pnpm build` + postbuild bundle-isolation green
- [x] Manual smoke on all 5 fixtures
EOF
)"
```

---

## Self-review checklist (post-plan)

Before handing off to execution:

- [ ] **Spec §1.2 covered:** model swap is the entire phase. ✅
- [ ] **Spec §3.6 covered:** lead candidate BiRefNet-lite int8, fallback chain, OOM verification gate, fixture additions, footnote-deferred-to-Phase-26. ✅
- [ ] **Spec §6.2 covered:** new fixtures committed; existing portrait fixture preserved; ±2 percentage points coverage tolerance encoded as the snapshot tripwire. ✅
- [ ] **Spec §7.1 covered:** size cap re-verifiable; Task 4.2 explicitly conditions on Task 1's empirical caps. ✅
- [ ] **Spec §8.1 risk #3 covered:** Task 1 is the OOM verification gate; halt-and-replan is the documented response to verification failure. ✅
- [ ] **Spec §11 item 1 covered:** sequencing is Task 1 (verify) → Task 2 (manifest) → Task 3 (loader) → Task 4 (descriptor) → Task 5 (fixtures) → Task 6 (test ranges) → Task 7 (full project) → Task 8 (PR). ✅
- [ ] **No placeholders:** every step has actual commands or actual code. The model identifier values are pinned to BiRefNet-lite int8 throughout, with explicit fallback handling in Task 1. ✅
- [ ] **Type consistency:** the descriptor's `library` field, the manifest's `model` and `requiredDtype`, the model-loader's `dtype` and `device`, and the unit test's assertion all line up. The directory name `bg-remove` (from `MODEL_ID` constant + hardcoded copy-script destination) is preserved across the swap. ✅
- [ ] **Engine boundary preserved:** worker.ts is in the "untouched" list; the segment-label heuristic at lines 73-75 already accommodates BiRefNet's labeled-segment output. ✅
- [ ] **Privacy + bundle invariants verified at Tasks 6.9, 7.4, 7.7.** ✅
- [ ] **v1.1 escape hatch viable:** Phase 18 commits independently; all changes are within the bg-remove engine + its fixtures + the model manifest + a verification log. No shared-code or other-engine edits. ✅
