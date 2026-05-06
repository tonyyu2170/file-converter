# Phase 21 — COOP/COEP + multi-threaded ffmpeg.wasm (design)

**Date:** 2026-05-06
**Status:** approved 2026-05-06 (brainstorm signed off in parallel-instance session)
**Source of truth:** `docs/superpowers/specs/2026-05-06-phase-21-coop-coep-and-mt-ffmpeg-stub.md` (the original contract)
**Predecessors:** `docs/superpowers/specs/2026-05-05-v2-design.md` §2.2 (deployment commitments), §11 (phasing)

## 1. Goal

Phase 21 enables multi-threaded ffmpeg.wasm by:

1. Adding `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` response headers (production via `vercel.json`, dev via `next.config.ts`).
2. Routing `loadFfmpeg()` to either `@ffmpeg/core-mt` (when `crossOriginIsolated === true`) or `@ffmpeg/core` (single-threaded fallback).
3. Auditing the app for cross-origin embeds via a permanent Playwright regression gate.

This unlocks ~2×–4× speedup for ffmpeg operations (realized by Phase 22's `video-convert`) without regressing Phase 19's `audio-convert` or Phase 20's `audio-trim` on browsers without `SharedArrayBuffer`.

No new engines.

## 2. Deviations from the stub

The stub is the contract. This spec amends it in two places:

1. **§2 In, package swap.** Stub says replace `@ffmpeg/core` with `@ffmpeg/core-mt`. **Amended:** both packages remain installed; both are copied into `public/ffmpeg/{mt,st}/`; `loadFfmpeg()` selects at runtime. Rationale recorded in §3.4 below.
2. **§1 source path swap.** Stub says swap `core/dist/umd/*` → `core-mt/dist/umd/*`. **Amended:** `scripts/copy-ffmpeg-core.mjs` iterates both variants. ~25 lines net change.

All other stub commitments (§2 Out, §3 coordination contract, §6 references) hold.

## 3. Resolved decisions

### 3.1 Headers (stub §4.1, §4.3)

**Production** (`vercel.json`): two new entries appended to the existing global headers rule:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

CSP unchanged (`'wasm-unsafe-eval'` in `script-src`, `worker-src 'self' blob:` already cover the MT build). Cache headers unchanged — the existing `/ffmpeg/(.*)` wildcard already covers `/ffmpeg/mt/*` and `/ffmpeg/st/*` by glob match.

**Development** (`next.config.ts`): an async `headers()` returns the same two headers under `source: "/:path*"`. The existing `next.config.ts` comment ("`headers()` does NOT run with `output: 'export'`") is correct for `next build` (which produces the static export) but `next dev` does honor the rule, which is exactly what we need to exercise MT ffmpeg locally.

CLAUDE.md gains a one-line callout under the existing "static-export trap" section: COOP/COEP defined in two places — `vercel.json` (prod) and `next.config.ts` (dev). Keep aligned.

**Build-warning contingency.** If `pnpm build` emits a warning when `headers()` is set under `output: 'export'`, the implementer guards with `process.env.NODE_ENV !== 'production'`. Empirical check during implementation; spec records the contingency rather than pre-resolving.

### 3.2 COEP audit + permanent regression gate (stub §4.1)

Static analysis prior to writing this spec confirmed v1's audit conclusion still holds after Phases 14–20: no cross-origin embeds. Footer + about anchor tags (`<a href="https://...">`) navigate, not embed — exempt from COEP. All assets (fonts under `/public/fonts/`, ONNX runtime under `/public/onnx-wasm/`, bg-remove model under `/public/models/bg-remove/`, ffmpeg core under `/public/ffmpeg/`, pet GIFs under `/public/pets/`) are same-origin. No analytics, no error reporters, no embedded fonts CSS, no third-party scripts.

A permanent regression gate is added: **`tests/e2e/coop-coep.spec.ts`**. For each route in the catalog (`/`, `/about`, every `/tools/<id>`):

- Asserts the response includes `Cross-Origin-Opener-Policy: same-origin`.
- Asserts the response includes `Cross-Origin-Embedder-Policy: require-corp`.
- Asserts `crossOriginIsolated === true` evaluated in the page context.
- Asserts no console messages match `/coep|opener-policy|require-corp/i`.

Future PRs that touch layout, fonts, or third-party assets fail this gate if they introduce a cross-origin embed without `Cross-Origin-Resource-Policy: cross-origin` from the source. v2 design §2.2's "every PR re-verifies" promise becomes structurally enforced rather than procedurally remembered.

### 3.3 Manifest restructure (stub §4.2)

`scripts/ffmpeg-manifest.json` becomes:

```json
{
  "cores": {
    "mt": {
      "package": "@ffmpeg/core-mt",
      "version": "0.12.x",
      "license": "GPL-2.0-or-later",
      "files": [
        { "name": "ffmpeg-core.js",        "sha256": "..." },
        { "name": "ffmpeg-core.wasm",      "sha256": "..." },
        { "name": "ffmpeg-core.worker.js", "sha256": "..." }
      ]
    },
    "st": {
      "package": "@ffmpeg/core",
      "version": "0.12.x",
      "license": "GPL-2.0-or-later",
      "files": [
        { "name": "ffmpeg-core.js",   "sha256": "..." },
        { "name": "ffmpeg-core.wasm", "sha256": "..." }
      ]
    }
  },
  "_notes": {
    "build": "Both single-threaded and multi-threaded UMD builds are bundled. loadFfmpeg() picks at runtime based on crossOriginIsolated. See src/engines/_shared/ffmpeg/index.ts.",
    "loading": "Loaded same-origin from /ffmpeg/{mt,st}/. CSP connect-src 'self' enforces."
  }
}
```

The two cores are pinned to the same `0.12.x` minor for upgrade alignment. Per-file sha256 entries (rather than one combined entry per variant) keep each file's verification independent — a corruption in one file produces a precise diagnostic.

### 3.4 Browser fallback (stub §4.4)

`@ffmpeg/core-mt` refuses to load when `crossOriginIsolated === false` (older Safari, certain corporate proxies that strip COOP/COEP). Three options were considered:

- **Hard fail** with an actionable error. Rejected: regresses Phase 19's `audio-convert`, which currently works on every modern browser.
- **Refuse + guide page.** Same regression problem, softer landing. Rejected for the same reason.
- **Dual-core fallback.** Both cores installed; runtime picks based on `crossOriginIsolated`. **Adopted.**

Rationale: MT vs single-threaded is purely a performance concern, not a privacy one. Hard-failing a v1-supported flow on a v2 release is the regression the project's quality bar (`feedback_quality_bar.md`) explicitly forbids.

**Detection signal.** `typeof globalThis.crossOriginIsolated !== "undefined" && globalThis.crossOriginIsolated === true`. Memoized into the loader's singleton — never load both cores on the same page.

**User-facing UI.** None in this phase. Audio operations are fast enough on single-threaded that the fallback is invisible. Phase 22 will own the UX decision when video transcode makes slowness user-visible.

**Free architectural property.** Phase 22's `video-convert` on no-SAB browsers will degrade to single-threaded transcode (slow but functional) rather than hard-failing. Worth noting now even though Phase 22 owns the UX call.

### 3.5 `loadFfmpeg()` routing

```ts
// src/engines/_shared/ffmpeg/index.ts (replaces existing implementation)
import type { FFmpeg as FFmpegType } from "@ffmpeg/ffmpeg";

const MT_PATHS = {
  coreURL:   "/ffmpeg/mt/ffmpeg-core.js",
  wasmURL:   "/ffmpeg/mt/ffmpeg-core.wasm",
  workerURL: "/ffmpeg/mt/ffmpeg-core.worker.js",
};
const ST_PATHS = {
  coreURL: "/ffmpeg/st/ffmpeg-core.js",
  wasmURL: "/ffmpeg/st/ffmpeg-core.wasm",
};

let instancePromise: Promise<FFmpegType> | null = null;

function isCrossOriginIsolated(): boolean {
  return typeof globalThis.crossOriginIsolated !== "undefined"
      && globalThis.crossOriginIsolated === true;
}

export async function loadFfmpeg(): Promise<FFmpegType> {
  if (instancePromise) return instancePromise;
  instancePromise = (async () => {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const ff = new FFmpeg();
    await ff.load(isCrossOriginIsolated() ? MT_PATHS : ST_PATHS);
    return ff;
  })().catch((err) => { instancePromise = null; throw err; });
  return instancePromise;
}

/** Test-only. Do NOT export from any public surface. */
export function __resetForTests(): void {
  instancePromise = null;
}
```

Public surface (return type, parameters) is unchanged from v1. Phase 20's coordination contract is preserved.

### 3.6 Test gating (stub §4.5)

Phase 21 ships:

- **MT/ST routing unit test** (`src/engines/_shared/ffmpeg/index.test.ts`, new): mocks `crossOriginIsolated` true/false, asserts `loadFfmpeg()` calls `ff.load()` with the matching path set. **Mock mechanism:** `Object.defineProperty(globalThis, "crossOriginIsolated", { configurable: true, value: ... })` in `beforeEach`, paired with `__resetForTests()`. Both reset in `afterEach` to prevent cross-test leakage. jsdom does not define `crossOriginIsolated` natively, so the property is added per-test rather than mutated.
- **Headers + isolation E2E** (`tests/e2e/coop-coep.spec.ts`, new): see §3.2.
- **Worker-fetch wiring check** (in `coop-coep.spec.ts`): stage a sample audio file on `/tools/audio-convert`, click Convert, capture network requests, assert `ffmpeg-core.worker.js` was fetched (not just the JS+WASM pair). Confirms MT routing reached the actual sub-worker spawn rather than silently degrading.
- **Re-run existing correctness suites unchanged**: `RUN_AUDIO_CONVERT_CORRECTNESS=1` (Phase 19), `RUN_AUDIO_TRIM_CORRECTNESS=1` (Phase 20, post-rebase). The swap from single-threaded to MT is functionally transparent for these engines; existing assertions remain valid.

Wall-clock transcode-time assertions are deferred to Phase 22 for two reasons: audio operations are I/O- and codec-bound (MT speedup is only a few percent, not 2×–4× — a tuned threshold would be too loose to catch real regressions or too tight and flaky on a low-RAM CI worker per `feedback_low_ram_dev_box`); video transcode in Phase 22 is the first workload that meaningfully exercises MT and is where wall-clock matters.

### 3.7 Phase 26 (closeout) responsibilities

Phase 21 sets up; Phase 26 verifies in production. Spec calls these out so the verification is neither dropped nor duplicated:

- securityheaders.com still grade A with the new COOP/COEP set (v2 design §6.5).
- Manual `curl -I` of a deployed route confirms both headers present.
- WASM cache headers cover `ffmpeg-core.js`, `ffmpeg-core.wasm`, `ffmpeg-core.worker.js` under both `mt/` and `st/` paths.

## 4. Coordination contract

Mirrors Phase 20 §5, dual-direction.

**Phase 21 promises:**

1. No edits to `src/engines/_shared/trim-scrubber/`, `src/engines/audio-trim/`, `src/engines/audio-convert/`, `src/components/layout/sidebar.tsx`, `src/app/page.tsx`, or any other engine under `src/engines/<id>/`.
2. `loadFfmpeg()` public surface (parameter list, return type) unchanged. Phase 20's `audio-trim` and Phase 19's `audio-convert` run unchanged on the MT path; on the ST fallback, behavior is identical to v1.

**Phase 20 promises** (per its §5, restated for completeness):

1. No edits to `vercel.json`, `package.json`, `pnpm-lock.yaml`, `scripts/copy-ffmpeg-core.mjs`, `scripts/ffmpeg-manifest.json`, `src/engines/_shared/ffmpeg/index.ts`, `next.config.ts`.
2. Calls `loadFfmpeg()` from `_shared/ffmpeg/` only; never imports `@ffmpeg/core` or `@ffmpeg/core-mt` directly.

**Branch:** `phase-21-coop-coep-and-mt-ffmpeg`, based on `main`.

**Worktree:** `/Users/turdy/coding_fun/projects/file_converter-phase-21` (sibling of the original checkout, established 2026-05-06 to prevent parallel-session HEAD contention with the Phase 20 implementer).

**Merge order:** Phase 20 first → Phase 21 rebases.

## 5. File map

### Modified

| Path | Change |
|---|---|
| `vercel.json` | Append COOP + COEP entries to the global headers rule |
| `next.config.ts` | Add `headers()` returning the same two headers (with sync-warning comment); contingent NODE_ENV guard if build emits a warning |
| `package.json` | Add `@ffmpeg/core-mt` (keep `@ffmpeg/core`); align minor versions |
| `pnpm-lock.yaml` | Regenerated by `pnpm install` (both packages now resolved) |
| `scripts/copy-ffmpeg-core.mjs` | Iterate `manifest.cores`; copy each variant into `public/ffmpeg/<variant>/` |
| `scripts/ffmpeg-manifest.json` | Restructure to nested `cores` shape; populate sha256s for both variants |
| `src/engines/_shared/ffmpeg/index.ts` | Routing on `crossOriginIsolated`; `workerURL` for MT path; same public surface |
| `CLAUDE.md` | One-line dev/prod header sync note under the static-export-trap section |

### Created

| Path | Responsibility |
|---|---|
| `src/engines/_shared/ffmpeg/index.test.ts` | MT/ST routing unit tests (mocked `crossOriginIsolated`) |
| `tests/e2e/coop-coep.spec.ts` | Per-route header + isolation + worker-fetch assertions |

### Untouched (must verify no edits — Phase 20's surface)

- `src/engines/_shared/trim-scrubber/**`
- `src/engines/audio-trim/**`
- `src/engines/audio-convert/**`
- `src/components/layout/sidebar.tsx`
- `src/app/page.tsx`
- All other engines under `src/engines/<id>/`

## 6. Acceptance criteria

- All unit, integration, default-suite E2E pass.
- New `tests/e2e/coop-coep.spec.ts` passes against a built+served `out/` (or `pnpm dev` post-config).
- `RUN_AUDIO_CONVERT_CORRECTNESS=1 pnpm test:e2e` passes (Phase 19 sample).
- Post-rebase, `RUN_AUDIO_TRIM_CORRECTNESS=1 pnpm test:e2e` passes (Phase 20 sample).
- `pnpm build` emits no warnings; `scripts/check-bundle-isolation.mjs` clean.
- No edits to any file in the Phase 20 "Untouched" list above.
- Manual verification: in a SAB-capable Chrome session on `pnpm dev`, open `/tools/audio-convert`, observe DevTools network tab fetching `/ffmpeg/mt/ffmpeg-core.worker.js` (not the `st/` path). In a no-SAB session (e.g., a tab opened against a build without COOP/COEP), confirm fallback to `/ffmpeg/st/`.

## 7. Alternatives considered

- **Hard-fail on no-SAB.** Rejected: regresses Phase 19's audio-convert reach.
- **Refuse + guide page on no-SAB.** Same regression. Rejected.
- **Single-package swap per stub §2 In wording.** Revised to dual-core; see §2 above.
- **COEP `credentialless` instead of `require-corp`.** Rejected: v2 §2.2 mandates `require-corp`; `credentialless` weakens the embed-blocking promise.
- **Wrapper script (`pnpm dev:mt`) for dev headers.** Rejected: two-command surface is a footgun; `next.config.ts.headers()` works in dev with no daily-workflow change.
- **One combined manifest entry covering all three MT files.** Rejected: per-file entries match the existing copy-script loop without modification, and a corruption in one file produces a precise diagnostic.
- **Pre-build-only verification of MT speedup.** Deferred to Phase 22; audio operations don't meaningfully exercise MT.

## 8. References

- Stub: `docs/superpowers/specs/2026-05-06-phase-21-coop-coep-and-mt-ffmpeg-stub.md`
- v2 design §2.2: deployment commitments
- v2 design §11 item 4: phasing. The original v2 phasing scoped Phase 21 as "COOP/COEP + `video-convert`"; this spec re-scopes per the stub to headers + MT only, deferring `video-convert` to Phase 22+. Rationale: risk-isolating the header rollout from a new engine, and Phase 20 landing in parallel on the trim-scrubber + audio-trim slice.
- v2 design §6.5: deploy validation (Phase 26 closeout owns).
- ffmpeg.wasm 0.12 multi-threaded build: https://ffmpegwasm.netlify.app/docs/getting-started/usage#multi-threaded
- MDN `crossOriginIsolated`: https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated
