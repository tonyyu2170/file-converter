# Phase 23 — Tesseract shared infra + `image-to-text` engine — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `src/engines/_shared/tesseract/` (a `loadTesseract()` singleton mirroring `loadFfmpeg()`), the `image-to-text` engine, and the same-origin asset acquisition pipeline for tesseract-core WASM + `tessdata_best/eng.traineddata.gz`. Engine accepts `.jpg/.jpeg/.png/.webp/.heic` (HEIC reuses the existing `_shared/decode-image.ts` libheif path), 25 MB cap, output `.txt` (default) or `.json` with per-word bboxes. Slow-engine UX commitments from v2 §4.5 — phased progress, ETA, Convert→Cancel — are wired through.

**Architecture:** `loadTesseract()` lives under `src/engines/_shared/tesseract/index.ts` and is consumed exclusively from worker contexts (mirrors `loadFfmpeg()` discipline). Same-origin assets land at `public/tesseract/*` via `scripts/copy-tesseract-assets.mjs` (postinstall + prebuild), with versions and SHA-256s pinned in `scripts/tesseract-manifest.json`. The engine ships its own Comlink worker at `src/engines/image-to-text/worker.ts`; a persistent harness reuses the warmed Tesseract worker across conversions on the page. On `signal.abort()` the harness terminates the Tesseract worker and clears its instance promise; the next conversion pays cold init again.

**Tech Stack:** React 19, Tailwind, `tesseract.js` v5+, `tesseract.js-core`, Comlink, Vitest + React Testing Library, Playwright. No `fetch` in `src/engines/`; all assets served from `/tesseract/` same-origin.

**Hard constraints:**
- **Same-origin only.** `loadTesseract()` MUST configure `langPath: "/tesseract/"`, `corePath: "/tesseract/"`, and `workerPath: "/tesseract/worker.min.js"`. Defaults point at `tessdata.projectnaptha.com` and `cdn.jsdelivr.net` — both blocked by CSP `connect-src 'self'`. The new privacy regression test gates this.
- **Worker-only loader.** `import("tesseract.js")` lives inside `loadTesseract()`; module-load cost in `src/engines/_shared/tesseract/index.ts` is `import type` only. `scripts/check-bundle-isolation.mjs` extension fails the build if `tesseract` appears in the homepage chunk.
- **No off-origin fetches.** `tests/e2e/privacy-regression-image-to-text.spec.ts` asserts zero off-origin network during a real OCR. Plus a build-time string check that `tessdata.projectnaptha.com` and `cdn.jsdelivr.net` do not appear in any built JS chunk (catches a misconfigured `langPath`/`corePath`).
- **OEM `LSTM_ONLY` (1).** Confirmed in spec §14. `tessdata_best` ships only LSTM weights; `DEFAULT` (3) wastes init time engaging absent legacy weights.
- **Asset acquisition is idempotent and hash-verified.** `scripts/copy-tesseract-assets.mjs` re-running after a successful run is a no-op. Hash mismatches against `scripts/tesseract-manifest.json` fail the build.
- **`public/tesseract/*` is gitignored** with a checked-in `.gitkeep`. Mirrors the established `public/ffmpeg/`, `public/models/bg-remove/`, `public/onnx-wasm/` patterns.
- **Branch discipline (per project memory `feedback_branch_discipline`).** This plan executes on the existing branch `phase-23-tesseract-and-image-to-text`. Implementer subagents must NOT run `git branch -m/-M` or `git checkout <branch>`. Verify before each commit: `git rev-parse --abbrev-ref HEAD` prints `phase-23-tesseract-and-image-to-text`.
- **No Claude attribution in commit messages** (per project memory `feedback_no_claude_in_commits`). No `Co-Authored-By: Claude`, no "Generated with Claude Code" footers. Body lines stay under 72 characters. Always `git commit` (never `--amend`, never `--no-verify`).
- **8 GB dev box discipline (per project memory `feedback_low_ram_dev_box`).** Run `pnpm test` and `pnpm test:e2e` serially. If memory pressure shows up, cap vitest workers via `--pool=threads --poolOptions.threads.maxThreads=2`.

**Source spec:** `docs/superpowers/specs/2026-05-07-phase-23-image-to-text-design.md` (approved 2026-05-07).

**Out of scope (this phase):**
- Languages other than English.
- Image preprocessing options (deskew, binarize, dpi hint, region selection).
- Layout / paragraph / TSV output beyond the documented JSON schema.
- PDF as input (PDF→OCR is a separate engine pairing pdf-to-image with image-to-text).
- Configurable confidence threshold.
- Fine-grained mid-recognition cancel (worker.terminate() is good enough).

---

## File map

**Created:**

| Path | Responsibility |
|---|---|
| `scripts/copy-tesseract-assets.mjs` | Copy tesseract-core WASM from `node_modules`; download + gzip + hash-verify `eng.traineddata.gz` from pinned GitHub source; idempotent. |
| `scripts/tesseract-manifest.json` | Pinned versions + SHA-256s for tesseract.js worker, tesseract.js-core WASM artifacts, and `eng.traineddata` (uncompressed + gzipped). |
| `public/tesseract/.gitkeep` | Anchor for gitignored asset directory. |
| `src/engines/_shared/tesseract/index.ts` | `loadTesseract()` singleton + `disposeTesseract()` + `__resetForTests()`. Worker-only. |
| `src/engines/_shared/tesseract/index.test.ts` | Real `recognize()` against fixture; same-origin path assertions; reset-for-tests behavior. |
| `src/engines/_shared/tesseract/types.ts` | `TesseractWorker` re-export and `WordBbox` shape used by the engine output. |
| `src/engines/image-to-text/index.ts` | Engine descriptor (`SingleInputEngine`), persistent harness factory, `disposeImageToTextHarness`. |
| `src/engines/image-to-text/index.test.ts` | Validation + correctness tests against committed fixtures (substring assertions only). |
| `src/engines/image-to-text/options.ts` | `ImageToTextOptions`, defaults, `outputExtensionFor`, `outputMimeFor`. |
| `src/engines/image-to-text/options.test.ts` | Option-shape unit tests. |
| `src/engines/image-to-text/options-panel.tsx` | OptionsPanel: outputFormat `<select>` + tooltip ("best on scanned documents and screenshots; lower quality on photos"). |
| `src/engines/image-to-text/options-panel.test.tsx` | OptionsPanel render + interaction tests. |
| `src/engines/image-to-text/worker.ts` | Comlink-exposed worker; `convertSingle` wraps `loadTesseract().recognize()`; ETA computed on this side. |
| `src/app/tools/image-to-text/page.tsx` | `<ToolFrame engine={engine} />` + dispose effect. |
| `tests/e2e/image-to-text.spec.ts` | Route + UI E2E (no real OCR in default suite). |
| `tests/e2e/image-to-text-correctness.spec.ts` | Real-conversion E2E (gated by `RUN_IMAGE_TO_TEXT_CORRECTNESS=1`). |
| `tests/e2e/privacy-regression-image-to-text.spec.ts` | Zero off-origin assertion during a real OCR. |
| `tests/fixtures/image-to-text/scanned-receipt.png` | Hand-rendered receipt; asserts `"TOTAL"` + a `"$"` token. < 1 MB. |
| `tests/fixtures/image-to-text/screenshot.png` | Cropped editor screenshot; asserts one identifier substring. < 1 MB. |
| `tests/fixtures/image-to-text/photo-with-text.jpg` | Phone photo of signage / book page; asserts one common word. < 1 MB. |
| `tests/fixtures/image-to-text/screenshot.heic` | Same content as `screenshot.png` exported HEIC; identical substring assertion (verifies libheif reuse). < 1 MB. |
| `tests/fixtures/image-to-text/SOURCES.md` | Provenance + regeneration commands. |

**Modified:**

| Path | Change |
|---|---|
| `package.json` | Add `tesseract.js` + `tesseract.js-core` deps; add `postinstall` (run after `copy-ffmpeg-core`) + `prebuild` (extend) hooks running `copy-tesseract-assets.mjs`. |
| `pnpm-lock.yaml` | Lockfile update. |
| `.gitignore` | Add `public/tesseract/*` allowlisting `!public/tesseract/.gitkeep` (mirrors existing ffmpeg/models/onnx-wasm patterns). |
| `src/engines/_shared/registry.ts` | Add `"image-to-text"` to `EngineId` union and `REGISTRY` map. |
| `src/components/layout/sidebar.tsx` | Add `image-to-text` entry under a new `OCR` group; append `OCR` to `GROUP_ORDER` between `VIDEO` and `ABOUT`. |
| `src/app/page.tsx` | Append `image-to-text` to `TOOLS`. |
| `tests/e2e/coop-coep.spec.ts` | Append `/tools/image-to-text` to `TOOL_ROUTES`. |
| `scripts/check-bundle-isolation.mjs` | Add `tesseract` to homepage-leak fail list; add `tessdata.projectnaptha.com` + `cdn.jsdelivr.net` to forbidden-string list. |

**Untouched (verify zero edits in this phase's diff):**
- `vercel.json`, `next.config.ts`, `scripts/copy-ffmpeg-core.mjs`, `scripts/ffmpeg-manifest.json`, `scripts/copy-bg-remove-model.mjs`.
- `src/engines/_shared/ffmpeg/*`, `src/engines/_shared/decode-image.ts` (consumed unmodified), `src/engines/_shared/harness.ts` (the existing `WorkerHarness({persistent: true})` API supports the lifecycle this engine needs — no harness-side changes required; mirrors the `audio-trim`/`video-trim` pattern).
- All other engines under `src/engines/<id>/`.

**Project-pattern conformance (verified against `audio-trim/index.ts` and `image-convert/index.ts`):**
- `validate(file)` is **synchronous** and returns `{ ok: true } | { ok: false, reason: string }`. Validation is **lenient** — accepts on `mimeOk || extOk` (browsers omit `file.type` for HEIC, especially Safari). Strict MIME detection happens in `convert()` via `detectMime`. **Do NOT** introduce an async-throwing validate.
- Engine type: `SingleInputEngine<TOptions, OutputItem>` (two type params).
- `convert(file, opts, signal, runOpts)` — four positional args; `runOpts` carries `{ onProgress }`.
- Persistent harness: `WorkerHarness<TOptions>` constructed with `{ persistent: true }`, kept in a module-scoped variable, exposed via `get<EngineId>Harness()` + `dispose<EngineId>Harness()`. There is **no** `createPersistentHarness` factory — that's the audio-trim/video-trim/etc. idiom.

---

## Task -1 (prerequisite): Create the working branch

**Why:** Task 0 Step 0.1 verifies the branch exists and STOPs otherwise. The branch must be created before the first subagent runs.

- [ ] **Step -1.1: From a clean `main`, create the branch.**

```bash
git rev-parse --abbrev-ref HEAD          # expect: main
git status --porcelain                    # expect: empty
git fetch origin
git pull --ff-only origin main
git checkout -b phase-23-tesseract-and-image-to-text
git rev-parse --abbrev-ref HEAD          # expect: phase-23-tesseract-and-image-to-text
```

Expected: branch created, HEAD switched. **This is the only place in Phase 23 that runs `git checkout`.** All subsequent tasks operate on the existing branch only — implementer subagents must NOT run `git checkout` or `git branch -m/-M` (per project memory `feedback_branch_discipline`).

If the user is running Phase 23 in a separate worktree (per memory `feedback_parallel_session_worktrees`), substitute the worktree creation:

```bash
git worktree add ../file_converter-phase-23 -b phase-23-tesseract-and-image-to-text origin/main
cd ../file_converter-phase-23
```

---

## Task 0: Generate and commit image-to-text fixtures

**Why:** Every subsequent test in this plan needs at least one of the four fixtures. Land them first so test files in later tasks reference real bytes from the very first failing test.

**Files:**
- Create: `tests/fixtures/image-to-text/scanned-receipt.png`
- Create: `tests/fixtures/image-to-text/screenshot.png`
- Create: `tests/fixtures/image-to-text/photo-with-text.jpg`
- Create: `tests/fixtures/image-to-text/screenshot.heic`
- Create: `tests/fixtures/image-to-text/SOURCES.md`

- [ ] **Step 0.1: Verify branch and clean tree.**

```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

Expected: branch is `phase-23-tesseract-and-image-to-text`; tree is clean. If the branch is wrong, STOP and ask the user — do not run any `git checkout` or `git branch -m/-M`.

- [ ] **Step 0.2: Verify host tools available.**

```bash
which ffmpeg && ffmpeg -version | head -1
which magick || which convert    # ImageMagick — for synthesizing receipt PNG
which heif-enc || which libheif  # libheif tools — for HEIC export
```

Expected: ffmpeg + ImageMagick + libheif present. If `heif-enc` is missing on macOS, install via `brew install libheif`. If unavailable, STOP and ask the user — HEIC fixture cannot be regenerated otherwise.

- [ ] **Step 0.3: Create `scanned-receipt.png` (synthesized).**

Use ImageMagick to render a deterministic monochrome receipt with high-contrast text. Target ~600×800, < 100 KB, `TOTAL $42.00` plus 3–4 line items.

```bash
mkdir -p tests/fixtures/image-to-text
cd tests/fixtures/image-to-text

magick -size 600x800 xc:white \
  -font Courier -pointsize 28 -fill black -gravity North \
  -annotate +0+40   'CORNER GROCERY' \
  -annotate +0+90   '123 Main St' \
  -annotate +0+150  'Bread          3.50' \
  -annotate +0+190  'Milk           4.25' \
  -annotate +0+230  'Eggs           6.00' \
  -annotate +0+270  'Apples         2.75' \
  -annotate +0+330  '----------------' \
  -annotate +0+380  'TOTAL       $42.00' \
  -annotate +0+450  'Thank you!' \
  scanned-receipt.png

ls -lh scanned-receipt.png
```

Expected: file exists, < 100 KB. Open visually if running interactively to confirm legibility.

- [ ] **Step 0.4: Create `screenshot.png` (synthesized terminal/editor screenshot).**

```bash
magick -size 800x500 xc:'#1e1e1e' \
  -font Courier -pointsize 22 -fill '#d4d4d4' -gravity NorthWest \
  -annotate +30+40   'function recognizeText(image) {' \
  -annotate +30+80   '  const worker = await loadTesseract();' \
  -annotate +30+120  '  const result = await worker.recognize(image);' \
  -annotate +30+160  '  return result.data.text;' \
  -annotate +30+200  '}' \
  screenshot.png

ls -lh screenshot.png
```

Expected: file exists, < 200 KB. The substring assertion will look for `"recognizeText"` (a unique identifier).

- [ ] **Step 0.5: Acquire `photo-with-text.jpg` (real photo).**

Hand-collected option (preferred): use any phone-camera photo of signage, a book page, or a sticker — must contain at least one clear English word. Drop into `tests/fixtures/image-to-text/photo-with-text.jpg`.

If no source available, synthesize a degraded-photo approximation:

```bash
magick -size 600x400 xc:'#f5e6d3' -font Helvetica -pointsize 36 -fill '#3a2a18' \
  -gravity Center -annotate 0 'WELCOME' \
  -blur 0x0.8 -modulate 95,90,100 \
  photo-with-text.jpg
```

Either way: confirm < 200 KB. The substring assertion will look for `"WELCOME"` (or whichever word the photo contains — record it in `SOURCES.md`).

- [ ] **Step 0.6: Convert `screenshot.png` to HEIC.**

```bash
heif-enc screenshot.png -o screenshot.heic --quality 80
ls -lh screenshot.heic
```

Expected: HEIC file exists, < 100 KB. This fixture exercises the libheif reuse path and asserts the same `"recognizeText"` substring as `screenshot.png`.

- [ ] **Step 0.7: Sanity-check fixture sizes.**

```bash
ls -lh tests/fixtures/image-to-text/
```

Expected: 4 image files (`scanned-receipt.png`, `screenshot.png`, `photo-with-text.jpg`, `screenshot.heic`), each < 1 MB. If any exceeds 1 MB, regenerate with stricter compression — committed fixtures must stay small per CLAUDE.md.

- [ ] **Step 0.8: Write `SOURCES.md`.**

Create `tests/fixtures/image-to-text/SOURCES.md`:

```markdown
# image-to-text fixtures — sources

All four fixtures are < 1 MB per CLAUDE.md committed-fixture rule.

## scanned-receipt.png
Synthesized via ImageMagick. Substring assertion: "TOTAL" + "$".

## screenshot.png
Synthesized via ImageMagick (faux editor). Substring assertion:
"recognizeText".

## photo-with-text.jpg
<Hand-collected OR synthesized — record which here>. Substring
assertion: "<word from image>".

## screenshot.heic
Re-encoded from screenshot.png via heif-enc. Substring assertion:
"recognizeText". Exercises the libheif reuse path
(_shared/decode-image.ts).

## Regeneration

See Phase 23 plan, Task 0 — exact commands captured there.

## Used by

- `src/engines/image-to-text/index.test.ts`
- `src/engines/_shared/tesseract/index.test.ts`
- `tests/e2e/image-to-text-correctness.spec.ts`
- `tests/e2e/privacy-regression-image-to-text.spec.ts`
```

- [ ] **Step 0.9: Commit fixtures.**

```bash
git add tests/fixtures/image-to-text/
git commit -m "$(cat <<'EOF'
test(phase-23): image-to-text fixtures

Four committed fixtures covering the engine's accepted formats
(PNG, JPG, HEIC) plus the documented OCR scenarios (scanned
receipt, editor screenshot, photo with text). All under 1 MB
each; SOURCES.md captures regeneration recipes.
EOF
)"
```

Expected: commit lands on `phase-23-tesseract-and-image-to-text`. `git status` is clean.

---

## Task 1: Asset acquisition — manifest + copy script + gitignore

**Why:** Tesseract.js's defaults fetch from `tessdata.projectnaptha.com` and `cdn.jsdelivr.net` — both blocked by CSP. Same-origin assets must be in place before the `_shared/tesseract/` loader can be tested. This task establishes the build-time pipeline; subsequent tasks consume its output.

**Files:**
- Create: `scripts/tesseract-manifest.json`
- Create: `scripts/copy-tesseract-assets.mjs`
- Create: `public/tesseract/.gitkeep`
- Modify: `.gitignore`
- Modify: `package.json` (add deps + hooks)

- [ ] **Step 1.1: Add `tesseract.js` dependency.**

```bash
pnpm add tesseract.js
```

Expected: `tesseract.js` lands in `dependencies`. `tesseract.js-core` arrives transitively. Lockfile updates. `node_modules/tesseract.js/dist/worker.min.js` and `node_modules/tesseract.js-core/tesseract-core{,-simd}.wasm{,.js}` exist after install.

If `tesseract.js-core` is not pulled transitively (package layout depends on the Tesseract.js major), add it explicitly:

```bash
pnpm add tesseract.js-core
```

- [ ] **Step 1.2: Determine pinned versions and SHAs.**

```bash
# Capture installed versions
node -e "console.log(require('./node_modules/tesseract.js/package.json').version)"
node -e "console.log(require('./node_modules/tesseract.js-core/package.json').version)"

# Hash the artifacts we'll copy
sha256sum node_modules/tesseract.js/dist/worker.min.js
sha256sum node_modules/tesseract.js-core/tesseract-core.wasm.js
sha256sum node_modules/tesseract.js-core/tesseract-core.wasm
sha256sum node_modules/tesseract.js-core/tesseract-core-simd.wasm.js
sha256sum node_modules/tesseract.js-core/tesseract-core-simd.wasm
```

Capture each output. These populate `scripts/tesseract-manifest.json` in Step 1.3.

- [ ] **Step 1.3: Determine pinned `eng.traineddata` source.**

```bash
# Pin to a specific commit on tesseract-ocr/tessdata_best for reproducibility.
# Browse https://github.com/tesseract-ocr/tessdata_best/commits/main and pick
# the latest commit SHA at branch creation time. Record it.

# Download once locally to capture both the uncompressed and gzipped SHAs:
TESSDATA_SHA="<paste the SHA you picked>"
curl -fL --proto '=https' \
  -o /tmp/eng.traineddata \
  "https://github.com/tesseract-ocr/tessdata_best/raw/${TESSDATA_SHA}/eng.traineddata"

ls -lh /tmp/eng.traineddata           # ~22 MB uncompressed
sha256sum /tmp/eng.traineddata

gzip -k -9 /tmp/eng.traineddata       # produces /tmp/eng.traineddata.gz
ls -lh /tmp/eng.traineddata.gz        # ~22 MB gzipped (already-compressed model)
sha256sum /tmp/eng.traineddata.gz
```

Capture: tessdata_best git SHA, uncompressed file SHA-256, gzipped file SHA-256, both file sizes. Note: the model file is already entropy-coded internally so gzip yields ~0 size reduction — that's expected.

- [ ] **Step 1.4: Write `scripts/tesseract-manifest.json`.**

```json
{
  "tesseract_js_version": "<from Step 1.2>",
  "tesseract_core_version": "<from Step 1.2>",
  "tessdata_source": {
    "repo": "tesseract-ocr/tessdata_best",
    "ref": "<git SHA from Step 1.3>",
    "url": "https://github.com/tesseract-ocr/tessdata_best/raw/<SHA>/eng.traineddata",
    "sha256_uncompressed": "<from Step 1.3>",
    "sha256_gzipped": "<from Step 1.3>",
    "size_bytes_uncompressed": 0,
    "size_bytes_gzipped": 0
  },
  "files": {
    "worker.min.js":               { "src": "tesseract.js/dist/worker.min.js",                   "sha256": "<from Step 1.2>" },
    "tesseract-core.wasm.js":      { "src": "tesseract.js-core/tesseract-core.wasm.js",          "sha256": "<from Step 1.2>" },
    "tesseract-core.wasm":         { "src": "tesseract.js-core/tesseract-core.wasm",             "sha256": "<from Step 1.2>" },
    "tesseract-core-simd.wasm.js": { "src": "tesseract.js-core/tesseract-core-simd.wasm.js",     "sha256": "<from Step 1.2>" },
    "tesseract-core-simd.wasm":    { "src": "tesseract.js-core/tesseract-core-simd.wasm",        "sha256": "<from Step 1.2>" }
  }
}
```

Replace placeholder values from Steps 1.2 + 1.3. Sizes copied from `ls -lh` exact byte counts.

- [ ] **Step 1.5: Write `scripts/copy-tesseract-assets.mjs`.**

Mirrors `scripts/copy-ffmpeg-core.mjs` in shape. Required behavior:

1. Read `scripts/tesseract-manifest.json`.
2. For each entry in `files`: copy `node_modules/<src>` → `public/tesseract/<dest>`. Hash the destination; fail with a descriptive error if mismatch.
3. For `eng.traineddata.gz`:
   - If `public/tesseract/eng.traineddata.gz` exists and SHA-256 matches `tessdata_source.sha256_gzipped`, log "skip (cached)" and return.
   - Otherwise: download from `tessdata_source.url` (HTTPS only, fail on non-2xx), hash-verify against `sha256_uncompressed`, gzip with `zlib.gzipSync(buf, { level: 9 })`, hash-verify gzip output against `sha256_gzipped`, write to `public/tesseract/eng.traineddata.gz`.
4. Idempotent: re-running after success is a no-op (all hashes match, all logs say "skip").
5. CI-safe: stderr exit codes when downloads fail or hashes mismatch.

Use `import { createHash } from "node:crypto"`, `import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs"`, `import { gzipSync } from "node:zlib"`, `import { request } from "node:https"` (or `fetch` — Node 18+ has it). No third-party download deps.

- [ ] **Step 1.6: Add `public/tesseract/.gitkeep` and update `.gitignore`.**

```bash
mkdir -p public/tesseract
touch public/tesseract/.gitkeep
```

Edit `.gitignore` — add (mirroring the existing `public/ffmpeg/*` block):

```
public/tesseract/*
!public/tesseract/.gitkeep
```

- [ ] **Step 1.7: Wire the script into `package.json` hooks.**

Open `package.json`. Find the existing `postinstall` and `prebuild` (or `build:assets` chain). Append `node scripts/copy-tesseract-assets.mjs` to both, AFTER the existing ffmpeg/bg-remove copy commands so failures in those don't mask Tesseract failures and vice versa.

Example shape (verify exact existing chain before editing):

```json
{
  "scripts": {
    "postinstall": "node scripts/copy-ffmpeg-core.mjs && node scripts/copy-bg-remove-model.mjs && node scripts/copy-tesseract-assets.mjs",
    "prebuild":    "node scripts/copy-ffmpeg-core.mjs && node scripts/copy-bg-remove-model.mjs && node scripts/copy-tesseract-assets.mjs"
  }
}
```

- [ ] **Step 1.8: First run + verify.**

```bash
node scripts/copy-tesseract-assets.mjs
ls -lh public/tesseract/
```

Expected:
- 5 files plus `.gitkeep`: `worker.min.js`, `tesseract-core.wasm.js`, `tesseract-core.wasm`, `tesseract-core-simd.wasm.js`, `tesseract-core-simd.wasm`, `eng.traineddata.gz`.
- `eng.traineddata.gz` is ~22 MB.
- Total transfer happened once; second run is silent ("skip (cached)" lines):

```bash
node scripts/copy-tesseract-assets.mjs   # second run
```

- [ ] **Step 1.9: Commit script + manifest + gitignore + package changes.**

```bash
git add scripts/copy-tesseract-assets.mjs scripts/tesseract-manifest.json \
        public/tesseract/.gitkeep .gitignore package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
build(phase-23): tesseract asset pipeline

Adds tesseract.js dep, manifest-pinned same-origin asset copy
script, and gitignore allowlist for public/tesseract/. Mirrors
the ffmpeg/bg-remove acquisition pattern. Postinstall + prebuild
hooks make the assets land before any code that imports the
tesseract loader.
EOF
)"
```

Expected: commit lands on `phase-23-tesseract-and-image-to-text`. Working tree is clean (no `public/tesseract/eng.traineddata.gz` shows up because of `.gitignore`).

---

## Task 2: `_shared/tesseract/` loader

**Why:** Single point where Tesseract.js initialization is funneled, with same-origin paths and a singleton lifecycle. Must be in place before the engine worker can call `loadTesseract()`. Failing tests in this task drive the loader implementation.

**Files:**
- Create: `src/engines/_shared/tesseract/types.ts`
- Create: `src/engines/_shared/tesseract/index.ts`
- Create: `src/engines/_shared/tesseract/index.test.ts`

- [ ] **Step 2.0: Verify Tesseract.js v5+ API surface for logger placement.**

In Tesseract.js v5+, the `logger` is a `createWorker` constructor option — there is no per-`recognize()` logger. With our persistent worker, this means a single logger function is bound for the lifetime of the worker, but each conversion needs its own progress callback. Solution: the loader installs a logger that delegates through a mutable callback ref, and exposes a setter. Verify the actual API before implementing:

```bash
node -e "const t=require('tesseract.js'); console.log('createWorker:', t.createWorker.length, 'args')"
node -e "console.log(Object.keys(require('tesseract.js')))"
# Inspect the createWorker signature directly:
sed -n '1,80p' node_modules/tesseract.js/src/createWorker.js
```

Expected: `createWorker(langs, oem, options, configFile)` where `options` accepts `logger`, `langPath`, `corePath`, `workerPath`. If the signature differs (e.g. an even newer major rearranged it), record the actual signature in `_shared/tesseract/index.ts`'s comment block and adapt the loader accordingly. Do NOT proceed without having confirmed the signature on the installed version.

- [ ] **Step 2.1: Write failing tests first.**

`src/engines/_shared/tesseract/index.test.ts` covers:

1. `loadTesseract()` returns the same promise on repeated calls (singleton identity).
2. After `disposeTesseract()`, the next `loadTesseract()` returns a fresh promise.
3. After `__resetForTests()`, the next `loadTesseract()` returns a fresh promise.
4. The constructed `createWorker` call uses `langPath: "/tesseract/"`, `corePath: "/tesseract/"`, `workerPath: "/tesseract/worker.min.js"`. Verified via `vi.mock("tesseract.js")` capturing `createWorker` arguments.
5. OEM passed is `1` (LSTM_ONLY).
6. If `createWorker` rejects, `instancePromise` is cleared (next call retries).
7. **Logger delegation:** `setProgressLogger(cb)` installs a callback; subsequent simulated logger events fire it. `setProgressLogger(null)` (or the default no-op) silences events without breaking the worker. Two consecutive `setProgressLogger(cb1) → setProgressLogger(cb2)` swaps must route events to `cb2` only.

Run: `pnpm test src/engines/_shared/tesseract/index.test.ts`. Expected: every test fails because the module doesn't exist yet.

- [ ] **Step 2.2: Implement `types.ts`.**

```ts
// src/engines/_shared/tesseract/types.ts
export type { Worker as TesseractWorker } from "tesseract.js";

export type WordBbox = {
  text: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
};
```

- [ ] **Step 2.3: Implement `index.ts`.**

Per spec §4 + the v5 API constraint from Step 2.0 (`logger` is bound at `createWorker` time, not per `recognize()`). The loader installs a delegating logger that reads from a mutable callback ref, and exports `setProgressLogger` so each conversion can swap in its own callback.

```ts
// src/engines/_shared/tesseract/index.ts
import type { TesseractWorker } from "./types";

// Module-load cost: only `import type` references tesseract.js; the runtime
// `await import("tesseract.js")` lives inside loadTesseract() — DO NOT hoist
// to a static top-level import, or scripts/check-bundle-isolation.mjs will
// flag this module as leaking tesseract.js into the homepage chunk.
//
// All assets are populated by scripts/copy-tesseract-assets.mjs from
// node_modules/tesseract.js{,-core} into public/tesseract/. Same-origin
// paths only (CSP `connect-src 'self'`).

export type TesseractLogEvent = { status: string; progress: number };
export type TesseractLogger = (e: TesseractLogEvent) => void;

const OEM_LSTM_ONLY = 1;

let instancePromise: Promise<TesseractWorker> | null = null;
let activeLogger: TesseractLogger | null = null;

/** Install a progress callback for the next/in-flight recognize call.
 *  Pass null to silence. Tesseract.js binds the logger at createWorker time,
 *  so we delegate through this mutable ref to support per-conversion progress
 *  on a persistent worker. */
export function setProgressLogger(cb: TesseractLogger | null): void {
  activeLogger = cb;
}

export async function loadTesseract(): Promise<TesseractWorker> {
  if (instancePromise) return instancePromise;
  instancePromise = (async () => {
    const { createWorker } = await import("tesseract.js");
    return createWorker("eng", OEM_LSTM_ONLY, {
      workerPath: "/tesseract/worker.min.js",
      corePath: "/tesseract/",
      langPath: "/tesseract/",
      logger: (e: TesseractLogEvent) => activeLogger?.(e),
    });
  })().catch((err) => {
    instancePromise = null;
    throw err;
  });
  return instancePromise;
}

export async function disposeTesseract(): Promise<void> {
  const p = instancePromise;
  instancePromise = null;
  activeLogger = null;
  if (!p) return;
  const worker = await p.catch(() => null);
  if (worker) await worker.terminate();
}

export function __resetForTests(): void {
  instancePromise = null;
  activeLogger = null;
}
```

If Step 2.0 revealed a different `createWorker` signature on the installed version (e.g. v6 separates langs from logger differently), adapt the call site here — but the `setProgressLogger` indirection stays the same regardless: it's a property of using a persistent worker for per-call progress.

- [ ] **Step 2.4: Run tests until green.**

```bash
pnpm test src/engines/_shared/tesseract/index.test.ts
```

Expected: all tests in Step 2.1 pass. Adjust the test mock structure if Tesseract.js's createWorker signature differs from spec assumption (verify against installed v5+ types).

- [ ] **Step 2.5: Commit.**

```bash
git add src/engines/_shared/tesseract/
git commit -m "$(cat <<'EOF'
feat(phase-23): _shared/tesseract loader

Adds loadTesseract() singleton mirroring loadFfmpeg(). Worker-only
discipline (import type at module load, dynamic import inside the
loader). All paths point at same-origin /tesseract/* served by
copy-tesseract-assets.mjs.
EOF
)"
```

---

## Task 3: `image-to-text` engine internals (options + index + worker)

**Why:** Engine descriptor + Comlink worker that bridges `_shared/tesseract` to the harness. Output schemas (txt + json-with-bboxes) and validation logic land here.

**Files:**
- Create: `src/engines/image-to-text/options.ts`
- Create: `src/engines/image-to-text/options.test.ts`
- Create: `src/engines/image-to-text/index.ts`
- Create: `src/engines/image-to-text/index.test.ts`
- Create: `src/engines/image-to-text/worker.ts`

- [ ] **Step 3.1: Write `options.ts` and `options.test.ts`.**

```ts
// src/engines/image-to-text/options.ts
export type ImageToTextOutputFormat = "txt" | "json-with-bboxes";

export type ImageToTextOptions = {
  outputFormat: ImageToTextOutputFormat;
};

export const DEFAULT_OPTIONS: ImageToTextOptions = {
  outputFormat: "txt",
};

export function outputExtensionFor(opts: ImageToTextOptions): string {
  return opts.outputFormat === "txt" ? "txt" : "json";
}

export function outputMimeFor(opts: ImageToTextOptions): string {
  return opts.outputFormat === "txt" ? "text/plain" : "application/json";
}
```

Tests cover: defaults, `outputExtensionFor`, `outputMimeFor` for both formats.

- [ ] **Step 3.2: Write `index.test.ts` first (failing).**

Match `audio-trim/index.ts`'s lenient validation pattern: accept on `mimeOk || extOk` (browsers omit `file.type` for HEIC). The strict MIME check happens later, inside the worker via `detectMime` on the convert path.

Cases:
1. `engine.id === "image-to-text"`.
2. `validate` returns `{ ok: true }` for each fixture extension (`.png`, `.jpg`, `.jpeg`, `.webp`, `.heic`) — even when `file.type` is empty (Safari HEIC case).
3. `validate` returns `{ ok: false, reason }` for an unaccepted extension like `.gif` AND empty `file.type`.
4. `validate` returns `{ ok: false, reason }` for files exceeding 25 MB (use a synthetic 26 MB `File` with `image/png` MIME).
5. `validate` returns `{ ok: true }` for empty `file.type` but accepted extension — does NOT reject. (This is the lenient pattern; an empty/wrong-type but right-extension file goes through and `convert()` does the strict MIME sniff downstream.)
6. **Correctness — txt output:** `convert(scanned-receipt.png, {outputFormat: "txt"}, …)` returns an OutputItem whose UTF-8 decoded text contains `"TOTAL"` (case-insensitive) and `"$"`.
7. **Correctness — json output:** `convert(screenshot.png, {outputFormat: "json-with-bboxes"}, …)` returns OutputItem whose JSON parses; `text` contains `"recognizeText"`; `words` is a non-empty array; each word has `text`, `confidence`, `x`, `y`, `w`, `h`; at least one word's `text` includes `"recognizeText"`.
8. **Correctness — HEIC reuse:** `convert(screenshot.heic, {outputFormat: "txt"}, …)` text contains `"recognizeText"`.
9. **Convert with bad MIME → throws:** synthesize a `File` whose bytes are HTML but extension is `.png`. `convert(...)` (not `validate`) should reject because `detectMime` reports something that's not in `ACCEPTED_MIME`.
10. **Cancel:** `convert(scanned-receipt.png, ..., AbortSignal.abort())` with an already-aborted signal rejects (assert "throws" — the exact error class depends on whether the abort lands before `decodeImage`, before `recognize`, or via `worker.terminate()` after recognize starts; do NOT pin to `AbortError` specifically).

Tests 6–10 are real OCR (no mocks per project convention) — slow on first run (cold init).

- [ ] **Step 3.3: Implement `worker.ts`.**

The worker uses `setProgressLogger` from the loader (NOT `worker.setLogger` — that doesn't exist in Tesseract.js v5+). Per-conversion progress is achieved by swapping the active logger before `recognize()` and clearing it after.

**Before writing this file**, read `src/engines/audio-trim/worker.ts` to confirm the exact Comlink expose shape (single `convertSingle` callable vs. an object with multiple methods), the `convertSingle` parameter shape, and how `onProgress` is delivered (Comlink-proxied callback vs. direct function reference). Mirror that idiom — do NOT invent `ConvertSingleArgs`/`runConvertSingle` if the project doesn't use those names.

```ts
// src/engines/image-to-text/worker.ts (SHAPE — adapt to match audio-trim)
import * as Comlink from "comlink";
import {
  loadTesseract,
  disposeTesseract,
  setProgressLogger,
} from "@/engines/_shared/tesseract";
import { decodeImage } from "@/engines/_shared/decode-image";
import { detectMime } from "@/engines/_shared/file-detection";
import type { WordBbox } from "@/engines/_shared/tesseract/types";
import type { ImageToTextOptions } from "./options";
import type { ConversionProgress, OutputItem } from "@/engines/_shared/types";

const ACCEPTED_MIME = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
]);

// Signature exactly mirrors audio-trim/worker.ts's convertSingle. Verify
// before edits: the harness's runSingle() invokes this with these args in
// this order, with onProgress as a Comlink-proxied callback.
async function convertSingle(
  file: File,
  options: ImageToTextOptions,
  signal: AbortSignal | undefined,
  onProgress: ((p: ConversionProgress) => void) | undefined,
): Promise<OutputItem> {
  signal?.throwIfAborted();

  // Strict MIME check (validate() is lenient — see project convention block
  // at the head of this plan; mirrors image-convert's split).
  const mime = await detectMime(file);
  if (!ACCEPTED_MIME.has(mime)) {
    throw new Error(`image-to-text: unsupported content type ${mime}`);
  }

  const bitmap = await decodeImage(file);
  signal?.throwIfAborted();

  let recognizeStartedAt = 0;
  setProgressLogger((m) => {
    if (signal?.aborted || !onProgress) return;
    if (m.status === "recognizing text") {
      if (recognizeStartedAt === 0) recognizeStartedAt = performance.now();
      const p = m.progress ?? 0;
      const elapsed = (performance.now() - recognizeStartedAt) / 1000;
      const etaSec = p > 0.05 ? (elapsed * (1 - p)) / p : null;
      onProgress({ phase: "recognize", percent: p * 100, etaSec });
    } else {
      onProgress({ phase: "warmup", percent: (m.progress ?? 0) * 100, etaSec: null });
    }
  });

  // Cancel wiring: terminate Tesseract worker if signal aborts mid-recognize.
  // disposeTesseract() rejects the in-flight recognize via terminate().
  const onAbort = () => { void disposeTesseract(); };
  signal?.addEventListener("abort", onAbort, { once: true });

  let result;
  try {
    const worker = await loadTesseract();
    result = await worker.recognize(bitmap);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    setProgressLogger(null);
  }
  signal?.throwIfAborted();

  const baseName = file.name.replace(/\.[^.]+$/, "");
  if (options.outputFormat === "json-with-bboxes") {
    const words: WordBbox[] = (result.data.words ?? []).map((w: any) => ({
      text: w.text,
      confidence: w.confidence,
      x: w.bbox.x0,
      y: w.bbox.y0,
      w: w.bbox.x1 - w.bbox.x0,
      h: w.bbox.y1 - w.bbox.y0,
    }));
    const blob = new Blob(
      [JSON.stringify({ text: result.data.text, words }, null, 2)],
      { type: "application/json" },
    );
    return { name: `${baseName}.json`, blob };
  }
  const blob = new Blob([result.data.text], { type: "text/plain" });
  return { name: `${baseName}.txt`, blob };
}

Comlink.expose({ convertSingle });
```

Notes:
- The Comlink expose shape (single `convertSingle` vs. an object with multiple methods) MUST match what `WorkerHarness` expects on its end. If `audio-trim/worker.ts` exposes differently, mirror that — not the sketch above.
- Tesseract.js v5 types for `result.data.words` may differ — verify against installed types and adapt the mapping. The shape captured here matches v5 stable.
- The strict MIME check in the worker (not in `validate`) is the project's canonical placement (see `image-convert/index.ts:31` — `detectMime` runs in `convert`, not `validate`).

- [ ] **Step 3.4: Implement `index.ts`.**

Match `audio-trim/index.ts`'s engine descriptor shape exactly: synchronous lenient `validate`, module-scoped persistent harness via `getXxxHarness()` + `disposeXxxHarness()`, `convert(file, opts, signal, runOpts)` four-positional signature, full metadata fields (`category`, `library`, `license`, `cardinality`, `isReadyToConvert`, `OptionsPanel`, etc.).

```ts
// src/engines/image-to-text/index.ts (SHAPE — mirror audio-trim/index.ts)
import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import {
  type ImageToTextOptions,
  defaultImageToTextOptions,
} from "./options";
import { ImageToTextOptionsPanel } from "./options-panel";

const SUPPORTED_INPUT_MIMES = [
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
];
const MAX_FILE_BYTES = 25 * 1_000_000; // v2 §7.1 — 25 MB cap.

let harness: WorkerHarness<ImageToTextOptions> | null = null;
export function getImageToTextHarness(): WorkerHarness<ImageToTextOptions> {
  if (!harness) {
    harness = new WorkerHarness<ImageToTextOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
      { persistent: true },
    );
  }
  return harness;
}

export function disposeImageToTextHarness(): void {
  harness?.dispose();
  harness = null;
}

const engine: SingleInputEngine<ImageToTextOptions, OutputItem> = {
  id: "image-to-text",
  inputAccept: [".jpg", ".jpeg", ".png", ".webp", ".heic"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "text/plain", // see options.outputMimeFor for json branch
  defaultOptions: defaultImageToTextOptions,
  category: "ocr",         // verify exact key in EngineCategory union
  library: "tesseract.js",
  license: "Apache-2.0",
  cardinality: "single",
  isReadyToConvert: () => true,
  OptionsPanel: ImageToTextOptionsPanel,
  validate(file) {
    // Lenient pattern (mirrors audio-trim/index.ts:46-58 and
    // image-convert/index.ts:21-29). Browsers omit file.type for HEIC
    // (Safari especially); strict MIME detection happens in worker.ts.
    const mimeOk = SUPPORTED_INPUT_MIMES.includes(file.type);
    const extOk = /\.(jpe?g|png|webp|heic)$/i.test(file.name);
    if (!mimeOk && !extOk) {
      return { ok: false, reason: "Expected a JPG, PNG, WebP, or HEIC file" };
    }
    if (file.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        reason: `File too large for image-to-text (limit 25 MB; got ${(file.size / 1_000_000).toFixed(1)} MB).`,
      };
    }
    return { ok: true };
  },
  async convert(file, opts, signal, runOpts) {
    const result = await getImageToTextHarness().runSingle(file, opts, signal, runOpts);
    if (Array.isArray(result)) {
      const first = result[0];
      if (!first) throw new Error("image-to-text: engine returned empty array");
      return first;
    }
    return result;
  },
};
export default engine;
```

**Before edits, read `src/engines/audio-trim/index.ts` AND `src/engines/_shared/types.ts`** to confirm:
- The exact field names (`category` enum, presence/absence of `outputExtensionFor`/`outputMimeFor`, etc.).
- The `EngineCategory` union currently in use — `OCR`/`ocr`/`Ocr` capitalization. The v2 design §4.1 uses `OCR` (uppercase) for the sidebar group; the union value may differ.
- Whether `isReadyToConvert` is required. `audio-trim` provides it; `image-convert` does too.

Adapt the sketch to whatever the type system enforces; do NOT add fields the project doesn't use, do NOT omit fields it requires.

- [ ] **Step 3.5: Run tests until green.**

```bash
pnpm test src/engines/image-to-text/
```

Expected: all options tests pass; all index tests pass. Correctness tests are slow on first run because the persistent harness pays cold init once per test process.

If memory pressure shows up on the 8 GB box:

```bash
pnpm test src/engines/image-to-text/ --pool=threads --poolOptions.threads.maxThreads=2
```

- [ ] **Step 3.6: Commit.**

```bash
git add src/engines/image-to-text/options.ts src/engines/image-to-text/options.test.ts \
        src/engines/image-to-text/index.ts src/engines/image-to-text/index.test.ts \
        src/engines/image-to-text/worker.ts
git commit -m "$(cat <<'EOF'
feat(phase-23): image-to-text engine + worker

Single-input engine accepting jpg/jpeg/png/webp/heic up to 25 MB.
HEIC reuses _shared/decode-image's libheif path. Worker calls
loadTesseract() and emits txt or json-with-bboxes per options.
Persistent harness reuses the warmed Tesseract worker across
conversions; signal.abort() terminates the worker.
EOF
)"
```

---

## Task 4: OptionsPanel + page route

**Why:** UI surface that exposes the output format choice and routes through `ToolFrame` like every other engine. Dispose effect cleans up the persistent harness on unmount.

**Files:**
- Create: `src/engines/image-to-text/options-panel.tsx`
- Create: `src/engines/image-to-text/options-panel.test.tsx`
- Create: `src/app/tools/image-to-text/page.tsx`

- [ ] **Step 4.1: Write `options-panel.test.tsx` first.**

Cases:
1. Renders the format `<select>` with both options visible.
2. Defaults to `outputFormat: "txt"`.
3. Changing selection calls `onOptionsChange` with the new value.
4. Tooltip text matches the v2 spec phrasing exactly: `"best on scanned documents and screenshots; lower quality on photos"` (case-insensitive substring match for resilience to whitespace/punctuation).

- [ ] **Step 4.2: Implement `options-panel.tsx`.**

Mirror the existing options-panel components for shape/styling consistency (e.g., `audio-convert/options-panel.tsx`). Single labeled `<select>`. Tooltip rendered as the standard `<Tooltip>` component used by other engines (verify the existing component path).

- [ ] **Step 4.3: Implement `src/app/tools/image-to-text/page.tsx`.**

```tsx
// src/app/tools/image-to-text/page.tsx
"use client";
import { useEffect } from "react";
import { ToolFrame } from "@/components/...";  // verify path
import engine, { disposeImageToTextHarness } from "@/engines/image-to-text";

export default function ImageToTextPage() {
  useEffect(() => () => { void disposeImageToTextHarness(); }, []);
  return <ToolFrame engine={engine} />;
}
```

(Verify the exact ToolFrame import path against an existing page like `src/app/tools/video-trim/page.tsx`.)

- [ ] **Step 4.4: Run tests.**

```bash
pnpm test src/engines/image-to-text/options-panel.test.tsx
```

Expected: green.

- [ ] **Step 4.5: Smoke-check the page renders in dev.**

```bash
pnpm dev
```

In a separate terminal or a browser, navigate to `http://localhost:3000/tools/image-to-text`. Expected: page renders with the standard ToolFrame chrome, format dropdown visible, tooltip on hover. (No registry entry yet, so it won't be linked from the home page or sidebar — direct URL only.)

Stop `pnpm dev` after confirming.

- [ ] **Step 4.6: Commit.**

```bash
git add src/engines/image-to-text/options-panel.tsx \
        src/engines/image-to-text/options-panel.test.tsx \
        src/app/tools/image-to-text/page.tsx
git commit -m "$(cat <<'EOF'
feat(phase-23): image-to-text page + OptionsPanel

OutputFormat select with the v2-spec tooltip. ToolFrame wraps
the engine; page-level dispose effect tears down the persistent
harness on unmount.
EOF
)"
```

---

## Task 5: Registry + sidebar + home page + coop-coep route list

**Why:** Wire the engine into the global discovery surfaces. After this task `image-to-text` is reachable from the sidebar and home grid.

**Files:**
- Modify: `src/engines/_shared/registry.ts`
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/app/page.tsx`
- Modify: `tests/e2e/coop-coep.spec.ts`

- [ ] **Step 5.1: Add to registry.**

`src/engines/_shared/registry.ts` — add `"image-to-text"` to the `EngineId` union (alphabetically) and the `REGISTRY` map.

- [ ] **Step 5.2: Add to sidebar.**

`src/components/layout/sidebar.tsx` — extend `EngineCategory` with `OCR` if not already present. Append `OCR` to `GROUP_ORDER` between `VIDEO` and `ABOUT` per v2 spec §4.1. Add `image-to-text` entry under the new group.

- [ ] **Step 5.3: Add to home grid.**

`src/app/page.tsx` — append `image-to-text` to `TOOLS`. Phase 26 will section the grid by category; for now it joins the flat list.

- [ ] **Step 5.4: Update coop-coep route list.**

`tests/e2e/coop-coep.spec.ts` — append `/tools/image-to-text` to `TOOL_ROUTES`. Tesseract.js doesn't strictly require COOP/COEP (no SAB), but consistency keeps the gate uniform across all engine routes.

- [ ] **Step 5.5: Run tests.**

```bash
pnpm test src/engines/_shared/registry.test.ts \
          src/engines/_shared/registry.metadata.test.ts
```

Expected: green. Registry tests will fail-fast if the engine descriptor metadata is incomplete.

- [ ] **Step 5.6: Verify dev environment shows the engine in sidebar + home grid.**

```bash
pnpm dev
```

Visit `http://localhost:3000/`. Expected: `image-to-text` card visible in home grid; `OCR` group in sidebar with `image-to-text` link. Stop `pnpm dev`.

- [ ] **Step 5.7: Commit.**

```bash
git add src/engines/_shared/registry.ts src/components/layout/sidebar.tsx \
        src/app/page.tsx tests/e2e/coop-coep.spec.ts
git commit -m "$(cat <<'EOF'
feat(phase-23): wire image-to-text into discovery surfaces

Registry entry; sidebar OCR group (per v2 §4.1); home grid card;
coop-coep route list.
EOF
)"
```

---

## Task 6: Bundle isolation extension + privacy regression E2E

**Why:** Build-time and runtime gates that enforce same-origin discipline. Without these, a future refactor could silently re-enable jsDelivr/projectnaptha fetches.

**Files:**
- Modify: `scripts/check-bundle-isolation.mjs`
- Create: `tests/e2e/privacy-regression-image-to-text.spec.ts`

- [ ] **Step 6.1: Extend `check-bundle-isolation.mjs`.**

Add `tesseract` to the homepage-leak fail list (regex match the existing patterns for `@ffmpeg/ffmpeg` etc.).

Add a new "forbidden strings in any built JS chunk" check (or extend an existing one if present): fail if `tessdata.projectnaptha.com` or `cdn.jsdelivr.net` appears in any file under `out/_next/static/chunks/**/*.js` after a fresh build. These strings indicate a misconfigured `langPath`/`corePath`/`workerPath`.

- [ ] **Step 6.2: Run a fresh build to verify the gate doesn't fire.**

```bash
pnpm build
node scripts/check-bundle-isolation.mjs
```

Expected: clean output. If the gate fires, find the leak (likely a default export from tesseract.js bundling something at module load) and adjust `_shared/tesseract/index.ts` to keep the dynamic import boundary intact.

- [ ] **Step 6.3: Write `privacy-regression-image-to-text.spec.ts`.**

Mirror the shape of `tests/e2e/privacy-regression-video-trim.spec.ts`:

```ts
// tests/e2e/privacy-regression-image-to-text.spec.ts
import { test, expect } from "@playwright/test";

test("zero off-origin requests during real OCR", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const offOrigin: string[] = [];
  page.on("request", (req) => {
    const u = req.url();
    if (!u.startsWith(origin) && !u.startsWith("data:") && !u.startsWith("blob:")) {
      offOrigin.push(u);
    }
  });

  await page.goto("/tools/image-to-text");
  await page.setInputFiles('input[type="file"]', "tests/fixtures/image-to-text/screenshot.png");
  await page.getByRole("button", { name: /convert/i }).click();
  await page.getByRole("button", { name: /download/i }).waitFor({ timeout: 60_000 });

  expect(offOrigin).toEqual([]);
});
```

- [ ] **Step 6.4: Run the privacy E2E.**

```bash
pnpm test:e2e tests/e2e/privacy-regression-image-to-text.spec.ts
```

Expected: green. If any off-origin request fires, the loader is misconfigured — recheck `langPath`/`corePath`/`workerPath`.

- [ ] **Step 6.5: Commit.**

```bash
git add scripts/check-bundle-isolation.mjs \
        tests/e2e/privacy-regression-image-to-text.spec.ts
git commit -m "$(cat <<'EOF'
test(phase-23): bundle isolation + privacy gates

Extends check-bundle-isolation to fail on tesseract leaks into
the homepage chunk and on tessdata.projectnaptha.com /
cdn.jsdelivr.net strings in built chunks. New playwright spec
asserts zero off-origin requests during a real OCR conversion.
EOF
)"
```

---

## Task 7: Route + correctness E2E specs

**Why:** End-to-end UI coverage. The route spec runs in the default suite (no real OCR — fast); the correctness spec is gated on an env var (real OCR — slow).

**Files:**
- Create: `tests/e2e/image-to-text.spec.ts`
- Create: `tests/e2e/image-to-text-correctness.spec.ts`

- [ ] **Step 7.1: Write `image-to-text.spec.ts`.**

Mirror the shape of `tests/e2e/video-trim.spec.ts`:

- Page renders at `/tools/image-to-text`.
- File input present.
- Format `<select>` present with both options.
- Convert button disabled when no file selected.
- After dropping a fixture, format select still functional.

No real OCR in this spec — drag-drop UI only.

- [ ] **Step 7.2: Write `image-to-text-correctness.spec.ts`.**

Gated by `RUN_IMAGE_TO_TEXT_CORRECTNESS=1`:

```ts
test.skip(
  process.env.RUN_IMAGE_TO_TEXT_CORRECTNESS !== "1",
  "real-OCR correctness; gated to keep default CI fast",
);
```

Test cases:
1. Drop `scanned-receipt.png` with txt output → download → text contains `"TOTAL"` (case-insensitive).
2. Drop `screenshot.png` with json output → download → JSON parses, `text` contains `"recognizeText"`, `words` is non-empty array.
3. Drop `screenshot.heic` with txt output → download → text contains `"recognizeText"` (HEIC reuse path).
4. Cancel mid-conversion: click Convert, then click Cancel within 1s → conversion aborts, page remains usable; second Convert click succeeds (verifies harness rebuild).

- [ ] **Step 7.3: Run UI E2E in default suite.**

```bash
pnpm test:e2e tests/e2e/image-to-text.spec.ts
```

Expected: green.

- [ ] **Step 7.4: Run correctness E2E once locally.**

```bash
RUN_IMAGE_TO_TEXT_CORRECTNESS=1 pnpm test:e2e tests/e2e/image-to-text-correctness.spec.ts
```

Expected: all four cases green. Slow — first conversion pays cold init.

- [ ] **Step 7.5: Commit.**

```bash
git add tests/e2e/image-to-text.spec.ts tests/e2e/image-to-text-correctness.spec.ts
git commit -m "$(cat <<'EOF'
test(phase-23): image-to-text E2E specs

Default-suite UI spec covers route + format select + convert
button gating. Correctness spec (gated by
RUN_IMAGE_TO_TEXT_CORRECTNESS=1) runs real OCR on each fixture
including HEIC reuse, plus cancel-mid-conversion behavior.
EOF
)"
```

---

## Task 8: Final verification gate

**Why:** Phase invariant — `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e` all green before merge. No regressions.

- [ ] **Step 8.1: Branch + tree clean.**

```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

Expected: branch is `phase-23-tesseract-and-image-to-text`; tree is clean. All eight commits from Tasks 0–7 present.

- [ ] **Step 8.2: Typecheck.**

```bash
pnpm typecheck
```

Expected: zero errors.

- [ ] **Step 8.3: Lint.**

```bash
pnpm lint
```

Expected: zero errors. Notably, the no-fetch-in-engines Biome rule must accept `_shared/tesseract/index.ts` (no `fetch` is used) and `image-to-text/worker.ts` (no `fetch` is used).

- [ ] **Step 8.4: Unit + integration.**

```bash
pnpm test
```

Expected: zero failures. Cap workers if memory pressure: `--pool=threads --poolOptions.threads.maxThreads=2`.

- [ ] **Step 8.5: Static export build.**

```bash
pnpm build
node scripts/check-bundle-isolation.mjs
```

Expected: clean build into `out/`. Bundle isolation script silent (no failures).

- [ ] **Step 8.6: E2E (default suite — fast).**

```bash
pnpm test:e2e
```

Expected: zero failures across Chromium + Firefox + WebKit. Includes the new privacy regression spec and the route spec.

- [ ] **Step 8.7: Correctness E2E (gated — slow).**

```bash
RUN_IMAGE_TO_TEXT_CORRECTNESS=1 pnpm test:e2e tests/e2e/image-to-text-correctness.spec.ts
```

Expected: zero failures. Run once before merge to confirm real OCR still works after all integration touches.

- [ ] **Step 8.8: Manual smoke check in dev.**

```bash
pnpm dev
```

Visit `/tools/image-to-text`. Drop each of the four fixtures; confirm:
- Cold first run shows `warmup` phase progress, then `recognize` phase progress with ETA.
- Subsequent runs skip warmup phase (warm worker).
- Cancel button terminates and the page remains usable; next Convert pays cold init again (verifies harness rebuild).
- JSON output schema matches spec §2.4 word-by-word for `screenshot.png`.
- HEIC fixture (`screenshot.heic`) recognizes the same text as `screenshot.png`.

Stop `pnpm dev`.

- [ ] **Step 8.9: Open the PR.**

```bash
git push -u origin phase-23-tesseract-and-image-to-text
gh pr create --title "Phase 23: tesseract shared infra + image-to-text engine" --body "$(cat <<'EOF'
## Summary
- Adds `src/engines/_shared/tesseract/` with `loadTesseract()`
  singleton (mirrors `loadFfmpeg()`).
- Adds `image-to-text` engine: jpg/jpeg/png/webp/heic, 25 MB cap,
  txt or json-with-bboxes output, persistent harness.
- HEIC routes through the existing `_shared/decode-image.ts`
  libheif path — no duplicate libheif bundling.
- Same-origin asset pipeline via
  `scripts/copy-tesseract-assets.mjs` (postinstall + prebuild),
  manifest-pinned with SHA-256 verification.
- Slow-engine UX: phased progress (`warmup` + `recognize`), ETA
  during recognize, Convert→Cancel via `signal.abort()` →
  `worker.terminate()` + harness rebuild.

Source spec:
docs/superpowers/specs/2026-05-07-phase-23-image-to-text-design.md

## Test plan
- [ ] `pnpm typecheck` clean
- [ ] `pnpm lint` clean
- [ ] `pnpm test` clean
- [ ] `pnpm build` clean
- [ ] `pnpm test:e2e` clean (incl. new privacy + route specs)
- [ ] `RUN_IMAGE_TO_TEXT_CORRECTNESS=1 pnpm test:e2e
       tests/e2e/image-to-text-correctness.spec.ts` clean
- [ ] Manual: `pnpm dev` → /tools/image-to-text → drop each
       fixture (incl. HEIC) → verify cold/warm phases, cancel,
       and JSON schema
- [ ] securityheaders.com still grade A
EOF
)"
```

Expected: PR opens. CI runs all gates. Reviewer (the user) receives the PR URL.
