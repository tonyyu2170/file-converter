# Phase 21 — COOP/COEP + multi-threaded ffmpeg.wasm — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the COOP/COEP headers (production via `vercel.json`, dev via `next.config.ts`) and switch `loadFfmpeg()` to a runtime MT/ST router so multi-threaded ffmpeg.wasm runs whenever `crossOriginIsolated === true`, with a permanent Playwright regression gate that blocks any future cross-origin embed regression.

**Architecture:** Both `@ffmpeg/core` (single-threaded) and `@ffmpeg/core-mt` (multi-threaded) remain installed. The core-copy script copies each variant into `public/ffmpeg/{mt,st}/`. `loadFfmpeg()` selects the variant at runtime based on `globalThis.crossOriginIsolated`, so no-SAB browsers (older Safari, certain corporate proxies) keep the v1 single-threaded path rather than hard-failing — Phase 19's `audio-convert` and Phase 20's `audio-trim` continue to work unchanged on every modern browser. The new `tests/e2e/coop-coep.spec.ts` enumerates every public route and asserts both response headers, page-context isolation, no console policy errors, and (on `/tools/audio-convert`) that the MT worker file is actually fetched.

**Tech Stack:** `@ffmpeg/core-mt` (new), `@ffmpeg/core` (kept for fallback), `@ffmpeg/ffmpeg`, Next.js 15 (`headers()` in dev only), Vercel headers (prod), Playwright. No new test infrastructure beyond the new spec file.

**Hard constraints:**
- **`loadFfmpeg()` public surface unchanged.** Same parameter list, same return type. Phase 19's `audio-convert` and Phase 20's `audio-trim` consume `loadFfmpeg()` only and must not be edited by this phase. Verify by ensuring the diff for `phase-21-coop-coep-and-mt-ffmpeg` touches zero files under `src/engines/_shared/trim-scrubber/`, `src/engines/audio-trim/`, `src/engines/audio-convert/`, `src/components/layout/sidebar.tsx`, `src/app/page.tsx`, or any other engine under `src/engines/<id>/`.
- **Same-origin only.** Both cores load from `/ffmpeg/{mt,st}/`; no `connect-src` widening; no off-origin fetches. The privacy-regression suite (`tests/e2e/privacy-regression-*.spec.ts`) must continue to pass unchanged.
- **CSP unchanged.** `'wasm-unsafe-eval'` in `script-src` and `worker-src 'self' blob:` already cover the MT build per the spec; do not add or relax CSP entries.
- **Branch discipline (per project memory `feedback_branch_discipline`).** This plan executes on the current worktree's branch `phase-21-coop-coep-and-mt-ffmpeg`. Implementer subagents must NOT run `git branch -m/-M` or `git checkout <other-branch>`. Verify before each commit: `git rev-parse --abbrev-ref HEAD` prints `phase-21-coop-coep-and-mt-ffmpeg`.
- **No Claude attribution in commit messages** (per project memory `feedback_no_claude_in_commits`). No `Co-Authored-By: Claude`, no "Generated with Claude Code" footers. Body lines stay under 72 chars. Always `git commit` (never `--amend`, never `--no-verify`).
- **Post-rebase rerun.** Phase 20 merges first; Phase 21 then rebases onto `main`. After rebase, `tests/e2e/coop-coep.spec.ts` MUST be updated to add `/tools/audio-trim` to the route catalog and `RUN_AUDIO_TRIM_CORRECTNESS=1 pnpm test:e2e` MUST be re-run.

**Source spec:** `docs/superpowers/specs/2026-05-06-phase-21-coop-coep-and-mt-ffmpeg-design.md` (approved 2026-05-06). Stub: `docs/superpowers/specs/2026-05-06-phase-21-coop-coep-and-mt-ffmpeg-stub.md`.

**Out of scope (this phase):**
- New engines (Phase 22+ owns `video-convert`).
- Wall-clock transcode-time assertions (Phase 22 territory; audio is I/O- and codec-bound and would be too flaky to assert MT speedup against).
- UX for no-SAB fallback (Phase 22 will own when video transcode makes slowness user-visible).
- securityheaders.com production grade verification (Phase 26 closeout).

---

## File map

**Created:**

| Path | Responsibility |
|---|---|
| `tests/e2e/coop-coep.spec.ts` | Per-route response-header + `crossOriginIsolated` + console-clean assertions; MT worker-fetch wiring check on `/tools/audio-convert` |

**Modified:**

| Path | Change |
|---|---|
| `package.json` | Add `@ffmpeg/core-mt` (keep `@ffmpeg/core`) at the same `0.12.x` minor |
| `pnpm-lock.yaml` | Auto-updated by `pnpm install` |
| `scripts/ffmpeg-manifest.json` | Restructure to nested `cores: { mt, st }` shape with per-file sha256 entries for both variants |
| `scripts/copy-ffmpeg-core.mjs` | Iterate `manifest.cores`; copy each variant into `public/ffmpeg/<variant>/` |
| `vercel.json` | Append `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` to the global `/(.*)` headers rule |
| `next.config.ts` | Add `async headers()` returning the same two headers under `source: "/:path*"`; guard with `NODE_ENV !== "production"` if `next build` emits a warning under `output: "export"` |
| `src/engines/_shared/ffmpeg/index.ts` | Replace flat `coreURL`/`wasmURL` constants with `MT_PATHS` + `ST_PATHS`; add `isCrossOriginIsolated()` helper; route `ff.load()` arg at runtime; same public surface |
| `src/engines/_shared/ffmpeg/index.test.ts` | Add MT/ST routing tests (mocked `crossOriginIsolated` per-test); keep memoization + retry-after-failure tests |
| `CLAUDE.md` | One-line callout under "Other invariants" → static-export-headers section: "COOP/COEP defined in two places — `vercel.json` (prod) and `next.config.ts` (dev). Keep aligned." |

**Untouched (verify zero edits in this phase's diff — Phase 20's surface):**
- `src/engines/_shared/trim-scrubber/**`
- `src/engines/audio-trim/**`
- `src/engines/audio-convert/**`
- `src/components/layout/sidebar.tsx`
- `src/app/page.tsx`
- All other engines under `src/engines/<id>/`

---

## Task 1: Install `@ffmpeg/core-mt`, capture sha256s for both variants

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml` (auto)

- [ ] **Step 1.1: Verify branch and clean tree.**

```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

Expected: branch is `phase-21-coop-coep-and-mt-ffmpeg`; tree is clean. If the branch is wrong, STOP and ask the user — do not run any `git checkout` or `git branch -m/-M` (per branch discipline rule).

- [ ] **Step 1.2: Install `@ffmpeg/core-mt` without firing `postinstall`.**

The current `postinstall` hook runs `node scripts/copy-ffmpeg-core.mjs`, which reads the existing flat `scripts/ffmpeg-manifest.json` shape. We are about to restructure that manifest in Task 2, so `postinstall` will fail mid-install if we don't suppress it on this one command.

```bash
pnpm add @ffmpeg/core-mt@^0.12.10 --ignore-scripts
```

Expected: `package.json` `dependencies` gains `"@ffmpeg/core-mt": "^0.12.10"` next to the existing `"@ffmpeg/core": "^0.12.10"`. `pnpm-lock.yaml` updates. No console output from `copy-ffmpeg-core.mjs`.

- [ ] **Step 1.3: Confirm both variants resolved at the same minor.**

```bash
node -e 'const fs=require("node:fs");const c=JSON.parse(fs.readFileSync("node_modules/@ffmpeg/core/package.json","utf8")).version;const m=JSON.parse(fs.readFileSync("node_modules/@ffmpeg/core-mt/package.json","utf8")).version;console.log({core:c,"core-mt":m});if (c.split(".").slice(0,2).join(".") !== m.split(".").slice(0,2).join(".")) { console.error("MINOR MISMATCH"); process.exit(1); }'
```

(`require("@ffmpeg/core/package.json")` fails on Node 24 due to package `exports` map restrictions — the `fs.readFileSync` form is portable.)

Expected: both versions print and share the same `MAJOR.MINOR` (e.g., `0.12.10` and `0.12.10`). If they diverge, pin both packages to a matching `0.12.x` exact version in `package.json` and re-run `pnpm install --ignore-scripts`.

- [ ] **Step 1.4: Verify the MT UMD distribution is present on disk.**

```bash
ls node_modules/@ffmpeg/core-mt/dist/umd/
ls node_modules/@ffmpeg/core/dist/umd/
```

Expected MT (multi-threaded) directory contents: `ffmpeg-core.js`, `ffmpeg-core.wasm`, `ffmpeg-core.worker.js` (3 files).
Expected ST (single-threaded) directory contents: `ffmpeg-core.js`, `ffmpeg-core.wasm` (2 files; no worker file).

If the MT worker file is missing, the package version is wrong — pin to a version known to ship the multi-threaded build (e.g., `0.12.10`).

- [ ] **Step 1.5: Capture sha256s for both variants.**

```bash
for f in node_modules/@ffmpeg/core-mt/dist/umd/ffmpeg-core.js \
         node_modules/@ffmpeg/core-mt/dist/umd/ffmpeg-core.wasm \
         node_modules/@ffmpeg/core-mt/dist/umd/ffmpeg-core.worker.js \
         node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js \
         node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm; do
  printf '%s  %s\n' "$(shasum -a 256 "$f" | cut -d' ' -f1)" "$(basename "$f")"
done
```

Expected: 5 lines printed, each `<64-hex>  <filename>`. Record these — they go into the manifest in Task 2.

- [ ] **Step 1.6: Do NOT commit yet.**

The package.json + lockfile changes ride along with Task 2's manifest + copy-script changes in a single atomic commit, so `pnpm install` (which runs `postinstall` end-to-end) is only ever invoked against a self-consistent tree.

---

## Task 2: Restructure manifest, update copy script, regenerate `public/ffmpeg/`

**Files:**
- Modify: `scripts/ffmpeg-manifest.json`
- Modify: `scripts/copy-ffmpeg-core.mjs`
- Modify: `package.json` (carried from Task 1)
- Modify: `pnpm-lock.yaml` (carried from Task 1)

- [ ] **Step 2.1: Rewrite `scripts/ffmpeg-manifest.json` to the nested-cores shape.**

Replace the entire contents of `scripts/ffmpeg-manifest.json` with (substituting the sha256s captured in Task 1.5):

```json
{
  "cores": {
    "mt": {
      "package": "@ffmpeg/core-mt",
      "version": "0.12.10",
      "license": "GPL-2.0-or-later",
      "files": [
        { "name": "ffmpeg-core.js",        "sha256": "<MT ffmpeg-core.js sha>" },
        { "name": "ffmpeg-core.wasm",      "sha256": "<MT ffmpeg-core.wasm sha>" },
        { "name": "ffmpeg-core.worker.js", "sha256": "<MT ffmpeg-core.worker.js sha>" }
      ]
    },
    "st": {
      "package": "@ffmpeg/core",
      "version": "0.12.10",
      "license": "GPL-2.0-or-later",
      "files": [
        { "name": "ffmpeg-core.js",   "sha256": "<ST ffmpeg-core.js sha>" },
        { "name": "ffmpeg-core.wasm", "sha256": "<ST ffmpeg-core.wasm sha>" }
      ]
    }
  },
  "_notes": {
    "build": "Both single-threaded and multi-threaded UMD builds are bundled. loadFfmpeg() picks at runtime based on crossOriginIsolated. See src/engines/_shared/ffmpeg/index.ts.",
    "loading": "Loaded same-origin from /ffmpeg/{mt,st}/. CSP connect-src 'self' enforces."
  }
}
```

Use the resolved versions from Task 1.3 if they differ from `0.12.10`. Note that `@ffmpeg/core` was previously declared `LGPL-2.1+` in the v1 manifest — both packages are licensed `GPL-2.0-or-later` per their published `package.json` `license` fields; verify with `node -e 'console.log(require("@ffmpeg/core/package.json").license, require("@ffmpeg/core-mt/package.json").license)'` and use whichever string the packages actually declare.

- [ ] **Step 2.2: Rewrite `scripts/copy-ffmpeg-core.mjs` to iterate `manifest.cores`.**

Replace the entire contents of `scripts/copy-ffmpeg-core.mjs` with:

```js
#!/usr/bin/env node
// Copies @ffmpeg/core (single-threaded) and @ffmpeg/core-mt (multi-threaded)
// UMD distributions from node_modules into public/ffmpeg/{st,mt}/ so both
// variants load same-origin (CSP `connect-src 'self'` enforces this).
//
// Sources:
//   node_modules/@ffmpeg/core/dist/umd/{ffmpeg-core.js, ffmpeg-core.wasm}
//   node_modules/@ffmpeg/core-mt/dist/umd/{ffmpeg-core.js, ffmpeg-core.wasm,
//                                          ffmpeg-core.worker.js}
//
// Destinations:
//   public/ffmpeg/st/{ffmpeg-core.js, ffmpeg-core.wasm}
//   public/ffmpeg/mt/{ffmpeg-core.js, ffmpeg-core.wasm, ffmpeg-core.worker.js}
//
// Each copy is hash-verified against scripts/ffmpeg-manifest.json so silent
// drift between the lockfile and the bytes blows up the build.
//
// Runtime selection (which variant is loaded by FFmpeg.load()) is decided by
// src/engines/_shared/ffmpeg/index.ts based on `crossOriginIsolated`.

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const manifest = JSON.parse(
  readFileSync(join(here, "ffmpeg-manifest.json"), "utf8"),
);

if (!manifest.cores || typeof manifest.cores !== "object") {
  console.error(
    "[copy-ffmpeg-core] manifest missing `cores` map; expected " +
      "{ cores: { mt: {...}, st: {...} } }",
  );
  process.exit(1);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function ensureDir(d) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

for (const [variant, spec] of Object.entries(manifest.cores)) {
  if (variant.includes("/") || variant.includes("\\") || variant.includes("..")) {
    console.error(`[copy-ffmpeg-core] invalid variant key: ${variant}`);
    process.exit(1);
  }

  const srcDir = join(
    repoRoot,
    "node_modules",
    ...spec.package.split("/"),
    "dist",
    "umd",
  );
  const dstDir = join(repoRoot, "public", "ffmpeg", variant);

  if (!existsSync(srcDir)) {
    console.error(
      `[copy-ffmpeg-core] ${spec.package} UMD dir not found: ${srcDir}`,
    );
    process.exit(1);
  }

  ensureDir(dstDir);

  for (const f of spec.files) {
    if (f.name.includes("/") || f.name.includes("\\") || f.name.includes("..")) {
      console.error(
        `[copy-ffmpeg-core] invalid filename in manifest: ${f.name}`,
      );
      process.exit(1);
    }

    const src = join(srcDir, f.name);
    const dst = join(dstDir, f.name);

    if (!existsSync(src)) {
      console.error(`[copy-ffmpeg-core] missing source: ${src}`);
      process.exit(1);
    }
    copyFileSync(src, dst);
    const actual = sha256(dst);
    if (actual !== f.sha256) {
      console.error(
        `[copy-ffmpeg-core] sha256 mismatch for ${variant}/${f.name}: ` +
          `expected ${f.sha256}, got ${actual}. Update ffmpeg-manifest.json ` +
          `after verifying the new bytes are intentional.`,
      );
      process.exit(1);
    }
    console.log(`[copy-ffmpeg-core] copied ${variant}/${f.name}`);
  }
}
```

- [ ] **Step 2.3: Run the rewritten copy script.**

```bash
node scripts/copy-ffmpeg-core.mjs
```

Expected output (5 lines, in any order):
```
[copy-ffmpeg-core] copied mt/ffmpeg-core.js
[copy-ffmpeg-core] copied mt/ffmpeg-core.wasm
[copy-ffmpeg-core] copied mt/ffmpeg-core.worker.js
[copy-ffmpeg-core] copied st/ffmpeg-core.js
[copy-ffmpeg-core] copied st/ffmpeg-core.wasm
```

If any line says `sha256 mismatch`, the manifest sha doesn't match the on-disk bytes — re-capture sha256s with the Task 1.5 command and fix the manifest.

- [ ] **Step 2.4: Verify the public tree shape.**

```bash
ls public/ffmpeg/mt/
ls public/ffmpeg/st/
```

Expected:
- `public/ffmpeg/mt/`: `ffmpeg-core.js`, `ffmpeg-core.wasm`, `ffmpeg-core.worker.js`
- `public/ffmpeg/st/`: `ffmpeg-core.js`, `ffmpeg-core.wasm`

- [ ] **Step 2.5: Run a full `pnpm install` end-to-end to confirm `postinstall` works against the new manifest shape.**

```bash
pnpm install --frozen-lockfile=false
```

Expected: `postinstall` chain runs `fetch-bg-models.mjs` → `copy-bg-models.mjs` → `copy-ffmpeg-core.mjs` and the new copy script prints the same 5 lines as Step 2.3 with no errors.

- [ ] **Step 2.6: Run typecheck and unit tests to confirm nothing else broke.**

```bash
pnpm typecheck
pnpm test
```

Expected: both pass. The existing `src/engines/_shared/ffmpeg/index.test.ts` still exercises the v1 single-URL form — it will still pass against the unmodified `index.ts` because we have not yet swapped it.

- [ ] **Step 2.7: Commit.**

```bash
git add package.json pnpm-lock.yaml scripts/ffmpeg-manifest.json \
        scripts/copy-ffmpeg-core.mjs
git commit -m "phase-21: bundle @ffmpeg/core-mt alongside @ffmpeg/core

Dual-core bundling: the runtime loader picks @ffmpeg/core-mt when
crossOriginIsolated is true (Task 5) and @ffmpeg/core otherwise.
Both variants are copied into public/ffmpeg/{mt,st}/ at install
time and hash-verified against scripts/ffmpeg-manifest.json."
```

Verify: `git rev-parse --abbrev-ref HEAD` still prints `phase-21-coop-coep-and-mt-ffmpeg`.

---

## Task 3: Production COOP/COEP headers in `vercel.json`

**Files:**
- Modify: `vercel.json`

- [ ] **Step 3.1: Append COOP and COEP entries to the existing global `/(.*)` headers rule.**

In `vercel.json`, locate the rule whose `source` is `"/(.*)"` (lines 7–22 in the current file) and append two new entries at the end of its `headers` array, after the existing `Permissions-Policy` entry:

```json
{ "key": "Cross-Origin-Opener-Policy",   "value": "same-origin" },
{ "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }
```

The rule should now contain (in order): `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy`. CSP is unchanged. The cache-control rules for `/models/bg-remove/(.*)`, `/onnx-wasm/(.*)`, and `/ffmpeg/(.*)` are unchanged — the existing `/ffmpeg/(.*)` wildcard already covers `/ffmpeg/mt/*` and `/ffmpeg/st/*` by glob match.

- [ ] **Step 3.2: Verify JSON validity.**

```bash
node -e 'JSON.parse(require("node:fs").readFileSync("vercel.json","utf8")); console.log("OK")'
```

Expected: `OK`. If the parser throws, fix the trailing comma or quote that broke the file.

- [ ] **Step 3.3: Run `pnpm build` to confirm the static export is unaffected.**

```bash
pnpm build
```

Expected: build succeeds, `out/` is regenerated, `postbuild` (`scripts/check-bundle-isolation.mjs`) prints `bundle-isolation: OK`. Vercel only consumes `vercel.json` at deploy time, so no local runtime check is meaningful here — Task 6's E2E gate is what enforces the headers.

- [ ] **Step 3.4: Commit.**

```bash
git add vercel.json
git commit -m "phase-21: add COOP/COEP to vercel headers

Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp

Required to enable SharedArrayBuffer for @ffmpeg/core-mt at runtime
(Task 5). CSP and cache headers are unchanged."
```

---

## Task 4: Dev-server COOP/COEP headers in `next.config.ts`

**Files:**
- Modify: `next.config.ts`

- [ ] **Step 4.1: Add an unguarded `headers()` rule first (so we can empirically check the build-warning contingency).**

Replace the entire contents of `next.config.ts` with:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  trailingSlash: false,
  // COOP/COEP are set in two places:
  //   - vercel.json    — production (static export bypasses this file's
  //                      headers() entirely)
  //   - next.config.ts — dev-server only (this rule)
  // Keep the two aligned. The dev rule is what makes
  // `crossOriginIsolated === true` under `pnpm dev`, which is what lets
  // @ffmpeg/core-mt load locally.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
  images: {
    unoptimized: true, // required for static export
  },
  typedRoutes: true,
};

export default nextConfig;
```

- [ ] **Step 4.2: Run `pnpm build` and check for the `headers()`-with-`output: "export"` warning.**

```bash
pnpm build 2>&1 | tee /tmp/phase21-build.log
```

Inspect `/tmp/phase21-build.log` for any line matching `/headers.*not.*work.*export/i` or `/specified headers will not.*export/i` (Next.js's exact wording varies by version). If the build emits such a warning OR fails, proceed to Step 4.3 to add the NODE_ENV guard. If the build is clean, skip Step 4.3.

- [ ] **Step 4.3: (Conditional) Guard `headers()` with `NODE_ENV !== "production"` if Step 4.2 produced a warning.**

Next.js detects the `headers` property **statically** at config-parse time — it inspects whether the property exists on the config object and emits the warning before ever calling the function. A guard *inside the function body* (`if (process.env.NODE_ENV === "production") return []`) does NOT suppress the warning, because the function never runs during `next build` static analysis. Empirically verified on Next.js 15.

The fix is to omit the `headers` property from the config object entirely under production. Replace the unguarded shape from Step 4.1 with the conditional-spread form:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  trailingSlash: false,
  // COOP/COEP are set in two places:
  //   - vercel.json    — production (static export bypasses this file's
  //                      headers() entirely)
  //   - next.config.ts — dev-server only (the conditional spread below)
  // Keep the two aligned. The dev rule is what makes
  // `crossOriginIsolated === true` under `pnpm dev`, which is what lets
  // @ffmpeg/core-mt load locally.
  //
  // The spread (vs. an inside-function guard) is required because Next.js
  // detects the `headers` property statically and warns under
  // `output: "export"` if it exists at all — even if the function would
  // return []. Omitting the key entirely silences the warning.
  ...(process.env.NODE_ENV !== "production" && {
    async headers() {
      return [
        {
          source: "/:path*",
          headers: [
            { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
            { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          ],
        },
      ];
    },
  }),
  images: {
    unoptimized: true, // required for static export
  },
  typedRoutes: true,
};

export default nextConfig;
```

Re-run Step 4.2. Expected: no `headers`-related warning (the two pre-existing `Critical dependency` warnings from `libheif-js` and `@huggingface/transformers` are unrelated and remain), build succeeds.

- [ ] **Step 4.4: Verify the dev server actually serves the headers.**

In one terminal:
```bash
pnpm dev
```

Wait until the server logs `Local: http://localhost:3000`.

In a second terminal:
```bash
curl -sI http://localhost:3000/ | grep -iE 'cross-origin-(opener|embedder)-policy'
```

Expected output (order may vary, header values exactly as below):
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Stop the dev server with Ctrl-C in the first terminal.

If the headers do not appear, the `headers()` rule is wrong (most commonly: `source` glob mismatch, or the NODE_ENV guard is firing in dev — Next.js sets `NODE_ENV=development` for `next dev`, so the guard from Step 4.3 should NOT trigger here).

- [ ] **Step 4.5: Commit.**

```bash
git add next.config.ts
git commit -m "phase-21: dev-server COOP/COEP via next.config.ts headers

Mirrors the vercel.json production headers so pnpm dev sets
crossOriginIsolated === true locally. Production headers come
from vercel.json (static export bypasses this file's headers
rule); the two locations must stay aligned."
```

---

## Task 5: MT/ST runtime routing in `loadFfmpeg()` (TDD)

**Files:**
- Modify: `src/engines/_shared/ffmpeg/index.ts`
- Modify: `src/engines/_shared/ffmpeg/index.test.ts`

- [ ] **Step 5.1: Replace the test file with the new MT/ST routing tests (red).**

Replace the entire contents of `src/engines/_shared/ffmpeg/index.test.ts` with:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@ffmpeg/ffmpeg", () => {
  const FFmpegMock = vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { FFmpeg: FFmpegMock };
});

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { __resetForTests, loadFfmpeg } from "./index";

// jsdom does not define `crossOriginIsolated`. Each test installs the property
// at the top of the test and clears it in afterEach so no test leaks state
// into another — the loader memoizes its decision inside the singleton, so
// resetting both the singleton AND the global property is required.
function setCrossOriginIsolated(value: boolean): void {
  Object.defineProperty(globalThis, "crossOriginIsolated", {
    configurable: true,
    value,
  });
}

function clearCrossOriginIsolated(): void {
  // defineProperty (vs `delete`) avoids Biome's noDelete rule; vs plain
  // assignment, it sidesteps the read-only descriptor jsdom creates when
  // setCrossOriginIsolated installs the property without writable: true.
  Object.defineProperty(globalThis, "crossOriginIsolated", {
    configurable: true,
    value: undefined,
  });
}

afterEach(() => {
  __resetForTests();
  clearCrossOriginIsolated();
  vi.clearAllMocks();
});

describe("loadFfmpeg routing", () => {
  it("uses MT paths (with workerURL) when crossOriginIsolated === true", async () => {
    setCrossOriginIsolated(true);
    const ff = await loadFfmpeg();
    expect(ff.load).toHaveBeenCalledTimes(1);
    expect(ff.load).toHaveBeenCalledWith({
      coreURL: "/ffmpeg/mt/ffmpeg-core.js",
      wasmURL: "/ffmpeg/mt/ffmpeg-core.wasm",
      workerURL: "/ffmpeg/mt/ffmpeg-core.worker.js",
    });
  });

  it("uses ST paths (no workerURL) when crossOriginIsolated === false", async () => {
    setCrossOriginIsolated(false);
    const ff = await loadFfmpeg();
    expect(ff.load).toHaveBeenCalledTimes(1);
    expect(ff.load).toHaveBeenCalledWith({
      coreURL: "/ffmpeg/st/ffmpeg-core.js",
      wasmURL: "/ffmpeg/st/ffmpeg-core.wasm",
    });
  });

  it("uses ST paths when crossOriginIsolated is undefined", async () => {
    // No setCrossOriginIsolated call: the property is absent (default jsdom).
    const ff = await loadFfmpeg();
    expect(ff.load).toHaveBeenCalledWith({
      coreURL: "/ffmpeg/st/ffmpeg-core.js",
      wasmURL: "/ffmpeg/st/ffmpeg-core.wasm",
    });
  });
});

describe("loadFfmpeg memoization", () => {
  it("memoizes the instance across calls", async () => {
    setCrossOriginIsolated(true);
    const a = await loadFfmpeg();
    const b = await loadFfmpeg();
    expect(a).toBe(b);
    expect(FFmpeg).toHaveBeenCalledTimes(1);
  });

  it("resets the cached promise after a load failure so the next call retries", async () => {
    setCrossOriginIsolated(true);
    const FFmpegMock = FFmpeg as unknown as ReturnType<typeof vi.fn>;
    FFmpegMock.mockImplementationOnce(() => ({
      load: vi.fn().mockRejectedValue(new Error("net")),
      on: vi.fn(),
    }));
    await expect(loadFfmpeg()).rejects.toThrow("net");
    const ok = await loadFfmpeg();
    expect(ok).toBeDefined();
    expect(FFmpegMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 5.2: Run the test file to confirm the new MT/ST routing tests fail against the existing implementation.**

```bash
pnpm test src/engines/_shared/ffmpeg/index.test.ts
```

Expected: the three `loadFfmpeg routing` tests FAIL because the current `index.ts` calls `ff.load({ coreURL: "/ffmpeg/ffmpeg-core.js", wasmURL: "/ffmpeg/ffmpeg-core.wasm" })` — neither the `mt/` nor `st/` path. The two `loadFfmpeg memoization` tests should still pass.

If the routing tests pass against the current implementation, the test setup is wrong (most likely the mock isn't observing the call args correctly) — fix the test before proceeding.

- [ ] **Step 5.3: Replace `src/engines/_shared/ffmpeg/index.ts` with the routing implementation.**

Replace the entire contents with:

```ts
import type { FFmpeg as FFmpegType } from "@ffmpeg/ffmpeg";

// Module-load cost: the only top-level statement that references @ffmpeg/ffmpeg
// is `import type`, which is erased at compile time. The runtime
// `await import("@ffmpeg/ffmpeg")` lives inside loadFfmpeg() — DO NOT hoist it
// to a static top-level import, or scripts/check-bundle-isolation.mjs will
// flag this module as leaking @ffmpeg/ffmpeg into the homepage chunk.
//
// Bytes for both the MT and ST cores are populated by
// scripts/copy-ffmpeg-core.mjs from
// node_modules/@ffmpeg/{core-mt,core}/dist/umd/. Same-origin paths only
// (CSP `connect-src 'self'`).

const MT_PATHS = {
  coreURL: "/ffmpeg/mt/ffmpeg-core.js",
  wasmURL: "/ffmpeg/mt/ffmpeg-core.wasm",
  workerURL: "/ffmpeg/mt/ffmpeg-core.worker.js",
} as const;

const ST_PATHS = {
  coreURL: "/ffmpeg/st/ffmpeg-core.js",
  wasmURL: "/ffmpeg/st/ffmpeg-core.wasm",
} as const;

// `crossOriginIsolated` is fixed for the agent cluster's lifetime by the
// COOP/COEP headers received with the top-level document — it cannot change
// mid-session — so memoizing the MT/ST decision into the singleton is safe.
// The `typeof` arm is defensive against runtimes that don't define the
// property (jsdom, non-browser harnesses); lib.dom types it as boolean.
function isCrossOriginIsolated(): boolean {
  return (
    typeof globalThis.crossOriginIsolated !== "undefined" && globalThis.crossOriginIsolated === true
  );
}

let instancePromise: Promise<FFmpegType> | null = null;

export async function loadFfmpeg(): Promise<FFmpegType> {
  if (instancePromise) return instancePromise;
  instancePromise = (async () => {
    // Dynamic import keeps @ffmpeg/ffmpeg out of the homepage chunk.
    // scripts/check-bundle-isolation.mjs gates this at build time.
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const ff = new FFmpeg();
    await ff.load(isCrossOriginIsolated() ? MT_PATHS : ST_PATHS);
    return ff;
  })().catch((err) => {
    // On failure, clear the singleton so the next call retries. Note: the
    // retry will re-evaluate isCrossOriginIsolated() — which hasn't changed
    // — so an MT-load failure retries on MT, not ST. ST-as-fallback for
    // mid-session MT-asset failures is a Phase 22+ concern.
    instancePromise = null;
    throw err;
  });
  return instancePromise;
}

/** Test-only: clear the memoized instance. Do NOT export from any public surface. */
export function __resetForTests(): void {
  instancePromise = null;
}
```

- [ ] **Step 5.4: Re-run the test file to confirm green.**

```bash
pnpm test src/engines/_shared/ffmpeg/index.test.ts
```

Expected: all 5 tests pass (3 routing, 2 memoization).

- [ ] **Step 5.5: Run the full unit suite to confirm nothing else broke.**

```bash
pnpm test
pnpm typecheck
```

Expected: both pass. The audio-convert worker tests still pass because `loadFfmpeg()`'s public surface (parameterless, returns `Promise<FFmpegType>`) is unchanged.

- [ ] **Step 5.6: Commit.**

```bash
git add src/engines/_shared/ffmpeg/index.ts src/engines/_shared/ffmpeg/index.test.ts
git commit -m "phase-21: route loadFfmpeg() to MT/ST core at runtime

Selects /ffmpeg/mt/* (with workerURL) when crossOriginIsolated is
true, /ffmpeg/st/* otherwise. Public surface (parameter list,
return type) is unchanged so consumers (audio-convert,
audio-trim) require no edits."
```

---

## Task 6: E2E COOP/COEP regression gate

**Files:**
- Create: `tests/e2e/coop-coep.spec.ts`

- [ ] **Step 6.1: Create `tests/e2e/coop-coep.spec.ts` with per-route header, isolation, console-clean, and MT-worker-fetch assertions.**

Create the file with the following contents:

```ts
import path from "node:path";
import { expect, test } from "@playwright/test";

// Source-of-truth route catalog for COOP/COEP. Update when adding tools.
// (Phase 20 will add `/tools/audio-trim` after rebase — when the rebase
// lands, append `"/tools/audio-trim"` to TOOL_ROUTES.)
const TOOL_ROUTES = [
  "/tools/audio-convert",
  "/tools/docx-to-pdf",
  "/tools/docx-to-txt",
  "/tools/image-bg-remove",
  "/tools/image-convert",
  "/tools/image-resize",
  "/tools/image-to-pdf",
  "/tools/markdown-to-pdf",
  "/tools/pdf-edit",
  "/tools/pdf-merge",
  "/tools/pdf-split",
  "/tools/pdf-to-image",
  "/tools/pdf-to-md",
  "/tools/txt-to-pdf",
] as const;

const ALL_ROUTES = ["/", "/about", ...TOOL_ROUTES] as const;

// Matches COOP/COEP errors AND the related Cross-Origin-Resource-Policy
// errors browsers emit when COEP blocks an asset whose source didn't set
// `Cross-Origin-Resource-Policy: cross-origin`. Important for catching
// future asset-pipeline drift (a third-party CDN slipping in, etc.).
const POLICY_CONSOLE_PATTERN = /coep|opener-policy|require-corp|cross-origin-resource-policy/i;

for (const route of ALL_ROUTES) {
  test(`${route} sets COOP same-origin and COEP require-corp`, async ({
    page,
  }) => {
    const response = await page.goto(route);
    expect(response, `no response for ${route}`).not.toBeNull();
    const headers = response?.headers() ?? {};
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(headers["cross-origin-embedder-policy"]).toBe("require-corp");
  });

  test(`${route} reports crossOriginIsolated === true in page context`, async ({
    page,
  }) => {
    await page.goto(route);
    const isolated = await page.evaluate(() => globalThis.crossOriginIsolated);
    expect(isolated).toBe(true);
  });

  test(`${route} produces no COEP/COOP console errors`, async ({ page }) => {
    const offending: string[] = [];
    page.on("console", (msg) => {
      if (POLICY_CONSOLE_PATTERN.test(msg.text())) {
        offending.push(`[${msg.type()}] ${msg.text()}`);
      }
    });
    page.on("pageerror", (err) => {
      if (POLICY_CONSOLE_PATTERN.test(err.message)) {
        offending.push(`[pageerror] ${err.message}`);
      }
    });
    await page.goto(route);
    // `load` (not `networkidle`) — Next.js's HMR websocket under `pnpm dev`
    // never settles, so networkidle is a known flake source. Policy errors
    // for blocked resources fire during initial-document parse + first-paint,
    // both before `load` resolves.
    await page.waitForLoadState("load");
    expect(offending, `policy errors on ${route}`).toEqual([]);
  });
}

test("/tools/audio-convert fetches the MT ffmpeg worker file when isolated", async ({
  page,
}, testInfo) => {
  // Confirms the loader actually routed to /ffmpeg/mt/* (not silently to st/).
  // This catches the regression where COEP is set but the worker spawn-path
  // is wrong and the page silently degrades to single-threaded.
  testInfo.setTimeout(60_000);

  const fetched: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith("/ffmpeg/")) fetched.push(url.pathname);
  });

  await page.goto("/tools/audio-convert");
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  // Stage the WAV fixture (smallest of the four) and pick MP3 as output so
  // the engine actually loads ffmpeg. The staging input's aria-label is
  // "drop a file" (NOT "drop file"); selector matches the pattern used by
  // tests/e2e/audio-convert-correctness.spec.ts.
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve(__dirname, "../fixtures/audio/sample.wav"));
  await page.getByLabel(/^mp3/i).click();

  // Click Convert; we don't wait for transcode completion, only the early
  // worker fetch. Capture the request URL with a generous timeout.
  const workerReq = page.waitForRequest(
    (req) => req.url().endsWith("/ffmpeg/mt/ffmpeg-core.worker.js"),
    { timeout: 45_000 },
  );
  await page.getByTestId("convert-button").click();
  await workerReq;

  // Sanity: at least one mt/* asset should appear, and no st/* asset should.
  const mtFetches = fetched.filter((p) => p.startsWith("/ffmpeg/mt/"));
  const stFetches = fetched.filter((p) => p.startsWith("/ffmpeg/st/"));
  expect(mtFetches.length).toBeGreaterThan(0);
  expect(stFetches).toEqual([]);
});

test("/tools/audio-convert completes a conversion on Firefox (proxy for MT load)", async ({
  page,
  browserName,
}, testInfo) => {
  // Firefox-only counterpart to the MT-worker-fetch test above. Playwright on
  // Firefox cannot observe the nested-worker request, so we instead assert the
  // conversion reaches [ DONE ]. This catches MT-load failures (e.g., a wrong
  // path, a corrupted worker bytes) that would hang the conversion on Firefox.
  // Does NOT catch silent ST fallback (ST also produces output) — that gap is
  // accepted; the chromium/webkit wiring test covers it.
  test.skip(
    browserName !== "firefox",
    "Firefox-only completion proxy; chromium/webkit are covered by the worker-fetch wiring test above.",
  );
  testInfo.setTimeout(120_000);

  await page.goto("/tools/audio-convert");
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  const fixture = path.resolve(__dirname, "../fixtures/audio/sample.wav");
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.getByLabel(/^mp3/i).click();
  await page.getByTestId("convert-button").click();

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 90_000,
  });
});
```

Note on the staging UI selectors (`getByLabel(/drop file/i)`, `getByRole("button", { name: /convert/i })`): if these names do not match the audio-convert UI (different label, different button text), update them to match the actual rendered DOM. To inspect, run `pnpm dev`, open `/tools/audio-convert`, and read the rendered labels — do not invent them.

- [ ] **Step 6.2: Run the new spec.**

```bash
pnpm test:e2e tests/e2e/coop-coep.spec.ts
```

Expected: every test passes across all three Playwright projects (chromium, firefox, webkit). The MT-worker-fetch test in particular is sensitive to selector accuracy from Step 6.1.

If the headers tests fail with `undefined` for the headers, double-check Task 4's `next.config.ts` is committed and the dev server is the one Playwright spawned (the `webServer` block in `playwright.config.ts` runs `pnpm dev`).

If the worker-fetch test fails with `Test timeout`, inspect by running `pnpm test:e2e tests/e2e/coop-coep.spec.ts --headed --debug` and watch the live page in chromium — most likely the staging-area label or Convert-button name differs from the regex.

- [ ] **Step 6.3: Run the full default E2E suite to confirm no other spec regresses.**

```bash
pnpm test:e2e
```

Expected: all default-suite specs pass (the COOP/COEP gate adds tests; existing specs are unaffected because the privacy assertions remain same-origin).

- [ ] **Step 6.4: Commit.**

```bash
git add tests/e2e/coop-coep.spec.ts
git commit -m "phase-21: e2e gate for COOP/COEP + MT worker fetch

Per-route assertions on the production headers, page-context
crossOriginIsolated, and absence of COEP/COOP console errors.
Plus a wiring check on /tools/audio-convert that ffmpeg's MT
worker file is actually fetched (catches silent st/ fallback)."
```

---

## Task 7: Final verification, CLAUDE.md callout, correctness re-runs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 7.1: Add the dev/prod-header alignment note to `CLAUDE.md`.**

In `CLAUDE.md`, locate the bullet under "## Architecture (the load-bearing parts)" → "### Other invariants" that begins:

```
- **Security headers live in `vercel.json`, not `next.config.ts`.** Static export bypasses the Next.js server, so `headers()` in `next.config.ts` is a no-op for production. Easy mistake.
```

Append a follow-on bullet immediately after it:

```
- **COOP/COEP are defined in two places: `vercel.json` (production) and `next.config.ts` (`pnpm dev` only).** The dev rule is what makes `crossOriginIsolated === true` locally so `@ffmpeg/core-mt` loads under `pnpm dev`. Keep the two locations aligned — the `tests/e2e/coop-coep.spec.ts` regression gate enforces both at CI time.
```

- [ ] **Step 7.2: Re-run the audio-convert correctness suite (Phase 19) to confirm MT routing did not regress audio decode/encode.**

```bash
RUN_AUDIO_CONVERT_CORRECTNESS=1 pnpm test:e2e tests/e2e/audio-convert-correctness.spec.ts
```

Expected: all assertions pass. The single-threaded → multi-threaded swap is functionally transparent for re-encode; existing duration / RIFF-magic-bytes assertions hold.

- [ ] **Step 7.3: (Post-rebase) Re-run the audio-trim correctness suite (Phase 20).**

This step is only runnable after Phase 20 has merged into `main` and Phase 21's branch has been rebased onto it. Until then, `tests/e2e/audio-trim-correctness.spec.ts` does not exist on this branch.

After rebase, run:
```bash
RUN_AUDIO_TRIM_CORRECTNESS=1 pnpm test:e2e tests/e2e/audio-trim-correctness.spec.ts
```

Expected: all assertions pass. ALSO: append `"/tools/audio-trim"` to the `TOOL_ROUTES` array in `tests/e2e/coop-coep.spec.ts` (Step 6.1) and re-run `pnpm test:e2e tests/e2e/coop-coep.spec.ts` so the new route is gated. Commit the audio-trim addition with the rebase resolution.

- [ ] **Step 7.4: Verify the no-edit promise to Phase 20 holds.**

Two checks. The first flags any non-`_shared/ffmpeg/` engine path in the diff (Phase 21's only legitimate engine-tree surface):

```bash
git diff --name-only main...phase-21-coop-coep-and-mt-ffmpeg \
  | grep '^src/engines/' \
  | grep -v '^src/engines/_shared/ffmpeg/' \
  ; echo "(end of engine-tree audit; any path printed above is a violation)"
```

Expected: no engine paths printed before the `(end of engine-tree audit; ...)` line.

The second flags layout/route surface explicitly named in the spec's untouched list:

```bash
git diff --name-only main...phase-21-coop-coep-and-mt-ffmpeg \
  | grep -E '^(src/components/layout/sidebar\.tsx$|src/app/page\.tsx$)' \
  ; echo "(end of layout-surface audit; any path printed above is a violation)"
```

Expected: no paths printed before the `(end of layout-surface audit; ...)` line.

If either check prints a path, that file was touched in violation of §4 of the spec — revert the change before continuing. Do NOT use `git checkout -- <path>` (destructive) without first checking `git status`; if the file is staged, use `git restore --staged <path>` then `git restore <path>`.

- [ ] **Step 7.5: Run the full local CI battery one last time.**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

Expected: every command exits 0. `pnpm build` prints `bundle-isolation: OK` from the postbuild script. No new warnings from `pnpm build` (if the `next.config.ts` headers rule still emits one despite Step 4.3, return to Task 4 and re-investigate).

- [ ] **Step 7.6: Commit the docs update.**

```bash
git add CLAUDE.md
git commit -m "phase-21: document COOP/COEP dev/prod alignment

Adds an invariant-list bullet under the static-export trap:
both vercel.json and next.config.ts must carry the same two
headers, and the e2e gate enforces it at CI time."
```

- [ ] **Step 7.7: Confirm the branch is in shipping shape.**

```bash
git log --oneline main..HEAD
git status --porcelain
```

Expected: a clean tree, with these commits ahead of `main` (in order):
1. `phase-21: bundle @ffmpeg/core-mt alongside @ffmpeg/core`
2. `phase-21: add COOP/COEP to vercel headers`
3. `phase-21: dev-server COOP/COEP via next.config.ts headers`
4. `phase-21: route loadFfmpeg() to MT/ST core at runtime`
5. `phase-21: e2e gate for COOP/COEP + MT worker fetch`
6. `phase-21: document COOP/COEP dev/prod alignment`

After Phase 20 merges, rebase onto `main`, perform Step 7.3, and resolve any conflicts (likely only in `src/components/layout/sidebar.tsx` if Phase 20 touched the same line region, but Phase 21 promised not to edit that file — rebase conflicts there mean the rebase machinery is mis-classifying, not that Phase 21 introduced a real conflict).

---

## Acceptance criteria (mirrors spec §6)

- [ ] All unit, integration, default-suite E2E pass on `phase-21-coop-coep-and-mt-ffmpeg` HEAD.
- [ ] `tests/e2e/coop-coep.spec.ts` passes against `pnpm dev` for every route in `ALL_ROUTES`.
- [ ] `RUN_AUDIO_CONVERT_CORRECTNESS=1 pnpm test:e2e tests/e2e/audio-convert-correctness.spec.ts` passes (Step 7.2).
- [ ] (Post-rebase) `RUN_AUDIO_TRIM_CORRECTNESS=1 pnpm test:e2e tests/e2e/audio-trim-correctness.spec.ts` passes and `/tools/audio-trim` is in the COOP/COEP route catalog (Step 7.3).
- [ ] `pnpm build` emits no warnings; `scripts/check-bundle-isolation.mjs` prints `bundle-isolation: OK`.
- [ ] `git diff --name-only main...HEAD` does not include any path under Phase 20's untouched-surface list (Step 7.4).
- [ ] In a SAB-capable Chrome session against `pnpm dev`: opening `/tools/audio-convert` and starting a conversion shows DevTools network fetching `/ffmpeg/mt/ffmpeg-core.worker.js`, not `/ffmpeg/st/*`. (The MT-worker-fetch test in Step 6.2 is the automated form of this.)

---

## Notes for the implementer

- **8 GB dev box discipline (per project memory `feedback_low_ram_dev_box`).** Run `pnpm test` and `pnpm test:e2e` serially, not in parallel terminals. If memory pressure shows up, cap vitest workers via `pnpm test --pool=threads --poolOptions.threads.maxThreads=2`. Kill the dev server (Ctrl-C) between Steps 4.4 and 6.2 — Playwright spawns its own.
- **transformers.js cache trap (per project memory `feedback_transformers_cache_trap`) does NOT apply here** — this phase doesn't touch transformers.js or model bytes; it touches ffmpeg core bytes which are loaded fresh on each page visit (they live in `/public`, not `transformers-cache`).
- **Worktree.** Per memory `project_v2_progress`, this branch lives in `/Users/turdy/coding_fun/projects/file_converter-phase-21` (sibling worktree). Do not switch to the `file_converter` checkout while a Phase 20 instance is active there.
- **No `--no-verify` ever.** If a pre-commit hook fails, fix the reported issue and create a new commit (per memory `feedback_no_claude_in_commits` and CLAUDE.md repo conventions).
