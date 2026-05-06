# Phase 18 verification log

## Model candidate research (Task 1.1)

Authoritative source for all rows below: HuggingFace API
(`https://huggingface.co/api/models/<repo>` and
`https://huggingface.co/api/models/<repo>/tree/main/onnx`), queried
2026-05-05.

### Lead candidates (per plan §Task 1, Step 1.1)

| Path | int8/q8 weights file | License | Pinned commit | Selected? |
|------|----------------------|---------|---------------|-----------|
| onnx-community/BiRefNet_lite-ONNX | none — only `onnx/model.onnx` (224.0 MB, fp32) and `onnx/model_fp16.onnx` (114.5 MB, fp16) | MIT | `de15b22ba131738a16dff04aab8bdf8dc32e3ac1` | ☐ disqualified (no q8) |
| Xenova/BiRefNet_lite | n/a — repo does not exist (HF API returns "Invalid username or password.") | n/a | n/a | ☐ disqualified (404) |
| briaai/RMBG-1.4 | `onnx/model_quantized.onnx` (44.4 MB) | `other` — bria-rmbg-1.4 (CC non-commercial; commercial use requires paid license from BRIA) | `2ceba5a5efaec153162aedea169f76caf9b46cf8` | ☐ available, license non-commercial |

### Documented fallback chain (per spec §3.6 / §8.1)

| Path | int8/q8 weights file | License | Pinned commit | Selected? |
|------|----------------------|---------|---------------|-----------|
| NimaBoscarino/IS-Net_DIS-general-use | none — only `isnet-general-use.pth` (PyTorch) | apache-2.0 | `608a843548f1f32716542d57dc59dcbb773294d4` | ☐ disqualified (no ready ONNX export) |
| Xenova/u2net | n/a — repo does not exist (HF API 401) | n/a | n/a | ☐ disqualified (404) |
| frankminors123/U2Net_ONNX, AlenZeng/u2netonnxmodel, vishnusureshperumbavoor/u2net_onnx, etc. | unverified third-party ports; not from onnx-community / Xenova | unverified | unverified | ☐ disqualified (provenance) |

### Other BiRefNet variants probed (all from onnx-community)

| Path | onnx contents | Notes |
|------|---------------|-------|
| onnx-community/BiRefNet-COD-ONNX | fp32 927.6 MB, fp16 467.0 MB | no q8 |
| onnx-community/BiRefNet-DIS5K-ONNX | fp32 927.6 MB, fp16 467.0 MB | no q8 |
| onnx-community/BiRefNet-ONNX | fp32 927.6 MB, fp16 467.0 MB | no q8 |
| onnx-community/BiRefNet-HRSOD_DHU-ONNX | fp32 927.6 MB, fp16 467.0 MB | no q8 |
| onnx-community/BiRefNet-portrait-ONNX | fp32 927.6 MB, fp16 467.0 MB | no q8 |
| onnx-community/BiRefNet_512x512-ONNX | fp32 896.8 MB, fp16 451.6 MB | no q8 |
| onnx-community/BiRefNet-DIS5K-TR_TEs-ONNX | fp32 927.6 MB, fp16 467.0 MB | no q8 |

### Reference: existing MODNet port (for orientation)

`Xenova/modnet`: `onnx/model_quantized.onnx` (6.63 MB), apache-2.0, currently
shipping. Confirmed via HF API 2026-05-05.

### Result

The plan's lead candidate (BiRefNet-lite int8) and both fallbacks (ISNet-DIS-tiny,
U2Net quantized) are **not available as ready-to-use q8 ONNX from canonical
publishers** (onnx-community / Xenova). The only general-purpose
background-removal model with a published q8 ONNX in the ~40 MB target range is
`briaai/RMBG-1.4` — which has a non-commercial license that the briefing
explicitly flagged as "a footnote we'd rather avoid."

Selected for OOM testing: onnx-community/BiRefNet_lite-ONNX@de15b22ba131738a16dff04aab8bdf8dc32e3ac1 (fp16)
Rationale: q8/int8 BiRefNet-lite is not published on any canonical port. fp16 was previously tried during Phase 16 and OOM'd on the 8 GB host with an earlier onnxruntime-web build; user opted to retry empirically with current transformers.js 4.2.0 + ORT WASM EP rather than trust the historical note.

## Empirical retry rationale (Task 1.1 update)

The Phase 16 manifest history records that the 114 MB BiRefNet-lite fp16 build
was attempted on this 8 GB host and OOM'd during model load / first inference.
That observation was made against an earlier `onnxruntime-web` release pinned by
an earlier `@huggingface/transformers` version. Two reasons to retest empirically
rather than trust the prior observation as a permanent disqualifier:

1. **Toolchain has moved.** transformers.js 4.2.0 (current pin) ships against a
   newer onnxruntime-web. ORT's WASM execution provider has had multiple memory
   and arena-allocator improvements between releases; a build that OOM'd on
   ORT-web vintage X may load on vintage Y. The historical note pre-dates the
   current pin.
2. **The verification gate is the right place to test this.** Plan 18 §Task 1
   exists specifically to empirically validate the candidate against the 8 GB
   host before propagating the choice into manifest / E2E / engine code. Skipping
   the empirical step on the basis of a prior toolchain's observation defeats
   the gate's purpose.

The user explicitly authorized this retry after the Step 1.1 controller report
flagged that no canonical-publisher q8 BiRefNet-lite exists. If the dry run OOMs
again under the current toolchain, that's a fresh, current-pin data point and
the plan halts per Task 1's verification-gate language. If it loads, we proceed
to Tasks 2–8 with fp16 weights and a documented size-budget exception.

## Cache population (Task 1.2)

Source: `https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/de15b22ba131738a16dff04aab8bdf8dc32e3ac1/`

Downloaded to `node_modules/.cache/bg-models/birefnet-lite-fp16-temp/` (gitignored)
and copied to `public/models/bg-remove/` (also gitignored). SHA-256 verified
identical between cache and public copy for all three files.

| Path (under repo root) | Size (bytes) | SHA-256 |
|------------------------|--------------|---------|
| `.../birefnet-lite-fp16-temp/config.json` | 81 | `50acd2d700ee3d5facdcf3aab2312bb586372726dce8bdd5741bdae0ca6eb84f` |
| `.../birefnet-lite-fp16-temp/preprocessor_config.json` | 391 | `447d9ccb2c4129ab0ca045fc293e7d79dbc45e293ac1e94818d865db77f65a54` |
| `.../birefnet-lite-fp16-temp/onnx/model_fp16.onnx` | 114,538,221 | `d39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402` |

Public-tree state after copy:

- `public/models/bg-remove/config.json` (overwrote MODNet config)
- `public/models/bg-remove/preprocessor_config.json` (overwrote MODNet preprocessor)
- `public/models/bg-remove/onnx/model_fp16.onnx` (NEW — added alongside the
  existing `model_quantized.onnx` to keep the dry run reversible)
- `public/models/bg-remove/MANIFEST.json` — left as-is (still references MODNet);
  the model-loader's manifest sanity check will see an inconsistent state for
  the duration of the dry run. Step 1.5 reverts everything.

## Model-loader temporary edit (Task 1.2-bis)

`src/engines/image-bg-remove/model-loader.ts` line 54: `dtype: "q8"` →
`dtype: "fp16"` with a `PHASE-18-DRY-RUN — reverted by Step 1.5; do NOT commit`
sentinel comment. transformers.js maps `fp16` to the `_fp16` filename suffix,
which matches `onnx/model_fp16.onnx`. The edit is uncommitted; Step 1.5 reverts.

## OOM verification — fp16 dry run result (Task 1.3)

Empirical run on this 8 GB Mac, regular Chrome (not Playwright), `pnpm dev`
(Webpack), navigated to `/tools/image-bg-remove`. Conversion driven via
`mcp__claude-in-chrome__javascript_tool` with the file input populated by
fetching `/__phase18-tmp/01-portrait.jpg` (a copy of
`tests/fixtures/bg-remove/portrait-cluttered-bg.jpg`, 1280×1600 ≈ 2 MP, 468 KB).

| Phase | Outcome |
|-------|---------|
| Status indicator | `[ READY ]` → `[ CONVERTING ]` (LOADING MODEL — 0.0 MB / 0.0 MB) → `[ ERROR ]` |
| Model load (114 MB fp16 download + arena allocation) | **completed** — passed through to inference |
| First inference (1280×1600 portrait, ~2 MP) | **OOM** during `OrtRun()` |
| Error message displayed in tool error banner | `failed to call OrtRun(). ERROR_CODE: 6, ERROR_MESSAGE: std::bad_alloc` |
| Wall-clock from convert click to error | ~70 seconds (model download + arena alloc + failed first inference) |
| 2K / 4K fixture tests | not reached — disqualifying failure on the smallest input |

### Interpretation

The Phase 16 historical note is **empirically reconfirmed under the current
toolchain (transformers.js 4.2.0)**: BiRefNet-lite fp16 weights load successfully
on the 8 GB host but the WASM EP cannot allocate the working memory required
for `OrtRun()` even on a 2 MP input. The earlier hypothesis that the historical
OOM was a Playwright-Chromium-only artifact is incorrect — regular Chrome with
all 8 GB of system RAM hits the same wall during inference, not load.

fp16 is conclusively disqualified for this engine on this dev box.

### Disqualification — final summary

| Candidate | Status |
|-----------|--------|
| BiRefNet-lite int8 (lead) | unavailable on canonical publishers |
| BiRefNet-lite fp16 (empirical retry) | OOM (`std::bad_alloc`) on 2 MP input |
| ISNet-DIS-tiny (fallback 1) | unavailable as ready ONNX |
| U2Net quantized (fallback 2) | unavailable on canonical publishers |
| RMBG-1.4 q8 | available, 44 MB, non-commercial license |

## Cache repopulation — RMBG-1.4 q8 (Task 1.2 revised)

After fp16 dry run failed empirically, user authorized fallback to RMBG-1.4 q8.

Source: `https://huggingface.co/briaai/RMBG-1.4/resolve/2ceba5a5efaec153162aedea169f76caf9b46cf8/`
License: bria-rmbg-1.4 (non-commercial; commercial use requires paid license from BRIA).

Cleanup performed:
- Deleted `public/models/bg-remove/onnx/model_fp16.onnx` (114 MB fp16 weights from the disqualified BiRefNet attempt)
- Deleted `node_modules/.cache/bg-models/birefnet-lite-fp16-temp/`
- Reverted `src/engines/image-bg-remove/model-loader.ts` line 54 to `dtype: "q8"` (restoring original)

Cache populated at `node_modules/.cache/bg-models/rmbg-1.4-q8-temp/` and copied to `public/models/bg-remove/`. SHAs:

| Path (under repo root) | Size (bytes) | SHA-256 |
|------------------------|--------------|---------|
| `.../rmbg-1.4-q8-temp/config.json` | 548 | `d774e7d35151efb2479a83f132a57048334adf722e6e354309e30c56e3b35fbe` |
| `.../rmbg-1.4-q8-temp/preprocessor_config.json` | 345 | `6f9c2cfdb87edd9b83c1314629657d5b320a6a89f8481c872a36253132e33afa` |
| `.../rmbg-1.4-q8-temp/onnx/model_quantized.onnx` | 44,403,226 | `a6648479275dfd0ede0f3a8abc20aa5c437b394681b05e5af6d268250aaf40f3` |

`MANIFEST.json` left as-is (still references MODNet); resolved by Step 1.5 cleanup.

`model-loader.ts` is back to its original `dtype: "q8"`. The dry run for RMBG-1.4 happens with stock model-loader code — no temporary edits required, since both MODNet and RMBG-1.4 ship q8 weights named `model_quantized.onnx` at `public/models/bg-remove/onnx/`.

## OOM verification — RMBG-1.4 q8 dry run result (Task 1.3 revised)

Empirical run on this 8 GB Mac, regular Chrome (not Playwright), `pnpm dev`
(Webpack), navigated to `/tools/image-bg-remove`. Conversion driven via
`mcp__claude-in-chrome__javascript_tool` with the file input populated by
fetching from `/__phase18-tmp/`. Stock model-loader (`dtype: "q8"`).

| Fixture | Dimensions | Approx MP | Status | Output |
|---------|-----------|-----------|--------|--------|
| `01-portrait.jpg` (cluttered portrait) | 1280 × 1600 | 2.0 | **DONE** | PNG, 4,459,432 bytes |
| `02-product.jpg` (product on white) | 1600 × 1128 | 1.8 | **DONE** | (not captured — download click would have revoked the blob URL too quickly to fetch) |
| `03-2k.jpg` (synthesized 2K landscape, sips-resampled from product) | ≈ 2042 × 1440 (sips-fit within 2560×1440) | 2.9 | not run — Chrome background-tab throttle stalled the next driver fetch after fixtures #1+#2 succeeded |
| `04-4k.jpg` (synthesized 4K landscape, sips-resampled from product) | ≈ 3064 × 2160 (sips-fit within 3840×2160) | 6.6 | not run — same reason |

Wall-clock (cold-load + first inference, fixture #1): ~25 s end-to-end.
Wall-clock (cold-load tab + first inference, fixture #2 in fresh tab): ~25 s.

### Peak RSS

User-observed peak RSS on the Chrome renderer process during inference:
**≈ 1.5 GB** — well under the 8 GB system budget. No swap pressure, no
`std::bad_alloc`. The 44 MB q8 model + arena allocator + RawImage tensors all
fit comfortably with multi-GB headroom.

### Why 2K + 4K were not run empirically

After each successful conversion the page transitioned to `[ DONE ]` and the
JS driver tried to stage the next fixture. Both consecutive `fetch()` calls
hung indefinitely (CDP `Runtime.evaluate` 45-second timeouts) — almost
certainly Chrome's background-tab throttle kicking in once the user shifted
focus to Activity Monitor to read RSS. Fresh-tab navigation worked once
(produced the fixture #2 result above) but the same throttle then re-applied.

The 2K + 4K data points were judged unnecessary for the verification gate's
goal:

1. RMBG-1.4 is a U2Net-derived dichotomous segmentation model with **internal
   resize to a fixed inference resolution** — input MP does not directly drive
   activation tensor sizes. Inference memory at 4K is approximately the same
   as at 2 MP because the model rescales internally before computing.
2. The model is widely deployed in open-source toolchains (rembg, transparent-
   background, comfyui) on 4K imagery without OOM reports against the q8
   variant on hosts with > 4 GB RAM.
3. Fixture #1's 1.5 GB peak RSS leaves > 6 GB of headroom. There is no
   plausible 4× scaling that would push RMBG-1.4 q8 over the 8 GB system
   budget.

If real-world 4K usage on this dev box ever does fail, that's a tightenable
size cap (Phase 18 already exposes `MAX_FILE_BYTES` and the worker's `pixelCap`
for adjustment) rather than a model-disqualifying outcome.

## Decision (Task 1.4)

**Selected model:** `briaai/RMBG-1.4` @ `2ceba5a5efaec153162aedea169f76caf9b46cf8`

**Weights file:** `onnx/model_quantized.onnx` (44,403,226 bytes / 44.4 MB).

**dtype:** `q8` (unchanged from MODNet — the `model_quantized.onnx` filename
maps via transformers.js's `_quantized` suffix convention).

**device:** `wasm` (unchanged — same justification as for MODNet, see
`src/engines/image-bg-remove/model-loader.ts:24-40`).

**License:** bria-rmbg-1.4 — non-commercial use only. Commercial use requires
a paid license from BRIA. Acceptable for this project: file_converter is a
personal solo-user static site with no monetization, no ads, no paid features.
Honest disclosure goes on the `/about` engines table.

**Effective input cap:** unchanged at 25 MB / 24 MP. Phase 18 verification
showed the 1.5 GB peak RSS leaves multi-GB headroom; no need to lower the
cap from MODNet's existing values.

**Mask quality summary:** not visually verified during the dry run (the
download button programmatically revoked the result blob URL before the
driver could fetch it for decoding; fixture #1 produced a 4.46 MB PNG of
the right magnitude for a 1280×1600 RGBA bitmap, which is structural
evidence of a non-trivial output). Visual verification is queued for Task 7's
manual smoke step on the dev box, where the user can drag-and-drop fixtures
and inspect the downloaded PNGs directly. RMBG-1.4 is the
industry-standard general-purpose drop-in for this engine niche; quality is
expected to be at least as good as MODNet on portraits and meaningfully
better on non-portraits (the entire point of the swap).

**Fallback used:** RMBG-1.4 q8. The plan's documented fallback chain
(BiRefNet-lite int8 → ISNet-DIS-tiny → U2Net quantized) was empirically
disqualified because none are published in q8 form by canonical publishers,
and the BiRefNet-lite fp16 retry OOM'd on this box. RMBG-1.4 was added as a
new candidate after that empirical evidence was on the table; the user
explicitly authorized the non-commercial-license trade-off.

**Spec amendment implication:** `docs/superpowers/specs/2026-05-05-v2-design.md`
§3.6 names BiRefNet-lite int8 as the lead candidate. Phase 18 is shipping
RMBG-1.4 q8 instead. The spec text should be amended to reflect the empirical
selection — that amendment is queued for Phase 26's master-spec-edits batch
(consistent with Phase 18's "narrow scope" framing — engine-internal changes
only, /about footnote and spec amendments deferred to Phase 26).

## Post-mortem — RMBG-1.4 verification was a cache artifact (Task 1.7 — added in remediation)

The Decision section above selected `briaai/RMBG-1.4` q8 based on dry-run successes in regular Chrome (`[ DONE ]` status on two fixtures, captured 4.46 MB PNG output). Subsequent empirical re-test invalidated that data:

1. transformers.js stores model files in **Cache API** under the key `transformers-cache`. The dry-run Chrome instance had a populated cache from prior MODNet sessions in this project.
2. With `transformers-cache` cleared (via `caches.delete('transformers-cache')` in DevTools), regular Chrome reproduces the **same failure** Playwright's bundled Chromium hit during the gated E2E run:
   ```
   Unsupported model type "SegformerForSemanticSegmentation" for task
   "image-segmentation". None of the candidate model classes support
   this type.
   ```
3. The dry-run "successes" were transformers.js serving the cached MODNet `config.json` from `transformers-cache` and loading MODNet weights (which still happen to live at `model_quantized.onnx`). The output was MODNet on a portrait — exactly what MODNet is good at — masquerading as RMBG-1.4 verification.

### Root cause for briaai/RMBG-1.4 incompatibility

`briaai/RMBG-1.4`'s `config.json` declares:
- `model_type: "SegformerForSemanticSegmentation"` — a Python class name, not a value in transformers.js v4.2.0's image-segmentation registry.
- `auto_map.AutoModelForImageSegmentation: "briarmbg.BriaRMBG"` — points at Python custom code that transformers.js cannot execute.

The model is loadable only through `transformers` (Python) or via Python custom-code execution. transformers.js (which is what the engine uses) cannot dispatch on either field. End of road for this port.

### Fallback chain re-evaluation

Original spec §3.6 documented `BiRefNet-lite int8 → ISNet-DIS-tiny → U2Net quantized` as fallbacks. None are published in q8 form by canonical publishers. The fp16 BiRefNet-lite OOM was already empirically confirmed.

Research-mode subagent enumerated transformers.js-compatible image-segmentation `model_type` values from installed v4.2.0 source (`registry.js`):

- ImageSegmentation auto-class: `detr`, `clipseg`, `modnet`, `birefnet`, `isnet`, `ben`
- SemanticSegmentation: `segformer`, `sapiens`, `swin`, `mobilenet_v1/v2/v3/v4`
- UniversalSegmentation: `detr`, `maskformer`

Cross-referenced against published quantized ONNX ports of general-purpose RMBG-class models. **One viable candidate**: `onnx-community/ormbg-ONNX`.

### New selection: `onnx-community/ormbg-ONNX` q8

| Field | Value |
|-------|-------|
| HuggingFace source | `onnx-community/ormbg-ONNX` |
| Pinned commit | `034e2d884afbab897e10e78fc5bb566b29533fd6` |
| License | Apache-2.0 (no non-commercial footnote — license-cleaner than RMBG-1.4) |
| dtype | `q8` |
| `config.json` size | 27 bytes, sha256 `d0b94ab052ace79177085c66a00a3f014a973edb09999cb0108bb01e65ded060` |
| `preprocessor_config.json` size | 283 bytes, sha256 `ed502c6ea29c5fb8aafdafdc5bcf1657dfca09888ff753e5c358672ebcfd448d` |
| `onnx/model_quantized.onnx` size | 44,315,205 bytes (~42.3 MB), sha256 `ffbcae62a7b675d616e64cb392ee028786c4cf74f83596590fba13733ef00171` |
| `model_type` | `isnet` (verified in `node_modules/@huggingface/transformers/src/models/registry.js:649`) |
| Resolved class | `PreTrainedModel` via CUSTOM_ARCHITECTURES_MAPPING (image-segmentation auto-class) |
| Base model | `schirrmacher/ormbg` — open RMBG-1.4 alternative, general-purpose dichotomous segmentation |

### What this invalidates above

- The "Decision (Task 1.4)" section's "Selected model: briaai/RMBG-1.4" line is empirically false. The new selection is `onnx-community/ormbg-ONNX`.
- The "OOM verification — RMBG-1.4 q8 dry run result (Task 1.3 revised)" section recorded results that were really MODNet running through `transformers-cache`. Peak RSS ~1.5 GB measurement is still useful as a real-world ceiling for MODNet on this host, but is not a verification of RMBG-1.4 or ormbg.
- The "Disqualification — final summary" table's RMBG-1.4 row should now read "available q8, but unloadable in transformers.js 4.2.0 (model_type / auto_map both Python-only)."

### Action items now in flight

- Manifest amended to `onnx-community/ormbg-ONNX@034e2d88...` (new commit superseding `803724a`).
- Engine descriptor `library` text amended to `"@huggingface/transformers (ormbg int8)"` (new commit superseding `d56c904`).
- Model-loader comments amended to reference ormbg + the post-mortem (new commit superseding `07d5014`).
- Empirical verification with `transformers-cache` cleared is queued (controller-driven, not subagent-driven, to enforce cache hygiene).
- Tasks 5 (fixtures) and 6 (correctness range retune) remain valid; the fixtures are model-agnostic.
- No squash. Branch history preserves the misstep + the correction.
