# Phase 19: ffmpeg shared infra + audio-convert — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the v2 ffmpeg.wasm pipeline as a shared module (`src/engines/_shared/ffmpeg/`) and ship the first engine that uses it (`audio-convert`), supporting MP3 ↔ WAV ↔ M4A ↔ FLAC any-to-any conversion with a bitrate option for lossy targets. Single-threaded ffmpeg core only — multi-threaded (which requires COOP/COEP) is deferred to Phase 21.

**Architecture:** ffmpeg lives same-origin under `public/ffmpeg/` and is loaded by the audio worker through a cached singleton in `_shared/ffmpeg/`. The engine follows v1's persistent-worker harness pattern (cf. `image-bg-remove/index.ts:26-34`) so ffmpeg's WASM (~30 MB) loads once per route visit and stays hot across multiple conversions. No `connect-src` widening — every byte ffmpeg fetches is same-origin. Source spec: `docs/superpowers/specs/2026-05-05-v2-design.md` §2.1, §3.1, §11 item 2.

**Tech Stack:** `@ffmpeg/ffmpeg` v0.12+, `@ffmpeg/util`, `@ffmpeg/core` (single-threaded build), Comlink, Web Audio API (not used here, but the bundle/CSP shape applies). No new test infrastructure.

**Hard constraints:**
- **No off-origin fetches.** ffmpeg's `load()` accepts `coreURL` and `wasmURL` arguments. If omitted, it fetches from unpkg.com. Both URLs MUST be pinned to same-origin paths (`/ffmpeg/ffmpeg-core.js`, `/ffmpeg/ffmpeg-core.wasm`). The privacy-regression E2E (Task 13) verifies zero outbound network during conversion.
- **Single-threaded core.** Multi-threaded ffmpeg requires `SharedArrayBuffer`, which requires COOP/COEP headers (Phase 21). Audio operations are fast enough single-threaded; do not pull in the multi-threaded `@ffmpeg/core-mt` package in this phase.
- **Bundle isolation.** ffmpeg imports must NOT appear in the homepage chunk. `scripts/check-bundle-isolation.mjs` auto-discovers engines from `src/engines/<id>/` and gates them; adding `src/engines/audio-convert/` automatically enrolls it, but the dynamic-import boundary inside `_shared/ffmpeg/` must be respected — the module exports a `loadFfmpeg()` function whose body uses `await import("@ffmpeg/ffmpeg")` so the dependency only enters the worker chunk on demand.
- **8 GB dev box discipline (per project memory).** Run `pnpm test` and `pnpm test:e2e` serially, not in parallel terminals. If memory pressure shows up, cap vitest workers via `pnpm test --pool=threads --poolOptions.threads.maxThreads=2`.
- **Branch discipline.** This phase MUST be developed on a dedicated feature branch (`phase-19-ffmpeg-and-audio-convert`). Never on `main`. Implementer subagents must not run `git branch -m/-M` or `git checkout <branch>` per project memory `feedback_branch_discipline`.

**Out of scope (this phase):**
- `audio-trim` engine (Phase 20).
- Trim scrubber UI (Phase 20).
- COOP/COEP headers + multi-threaded ffmpeg (Phase 21).
- Sidebar group sectioning of the home grid (Phase 26).

---

## File map

**Created:**

| Path | Responsibility |
|---|---|
| `src/engines/_shared/ffmpeg/index.ts` | `loadFfmpeg()` cached singleton, `FFmpegProgress` type, dynamic-import boundary |
| `src/engines/_shared/ffmpeg/index.test.ts` | Vitest unit tests with `@ffmpeg/ffmpeg` mocked |
| `src/engines/audio-convert/index.ts` | Engine descriptor (`SingleInputEngine`) |
| `src/engines/audio-convert/index.test.ts` | Descriptor unit tests (validation, metadata) |
| `src/engines/audio-convert/options.ts` | `AudioConvertOptions` type, defaults, format ↔ MIME ↔ extension maps |
| `src/engines/audio-convert/options.test.ts` | Option-shape unit tests |
| `src/engines/audio-convert/options-panel.tsx` | Format dropdown + bitrate dropdown (bitrate hidden for lossless) |
| `src/engines/audio-convert/options-panel.test.tsx` | OptionsPanel render + interaction tests |
| `src/engines/audio-convert/worker.ts` | Comlink-exposed worker; ffmpeg invocation + bytes ↔ blob plumbing |
| `src/app/tools/audio-convert/page.tsx` | One-line route: `<ToolFrame engine={engine} />` |
| `tests/fixtures/audio/sample.mp3` | 5–10 sec MP3 fixture |
| `tests/fixtures/audio/sample.wav` | 5–10 sec WAV fixture |
| `tests/fixtures/audio/sample.m4a` | 5–10 sec M4A fixture |
| `tests/fixtures/audio/sample.flac` | 5–10 sec FLAC fixture |
| `tests/fixtures/audio/SOURCES.md` | Fixture provenance documentation |
| `tests/e2e/audio-convert.spec.ts` | Route + UI E2E (fast, default-suite) |
| `tests/e2e/audio-convert-correctness.spec.ts` | Real-conversion E2E (gated by `RUN_AUDIO_CONVERT_CORRECTNESS=1`) |
| `tests/e2e/privacy-regression-audio-convert.spec.ts` | Network-panel zero-outbound assertion |
| `scripts/ffmpeg-manifest.json` | Pinned `@ffmpeg/core` files + sha256s |
| `scripts/copy-ffmpeg-core.mjs` | Copy `node_modules/@ffmpeg/core/dist/umd/*` → `public/ffmpeg/` with hash check |

**Modified:**

| Path | Change |
|---|---|
| `package.json` | Add `@ffmpeg/ffmpeg ^0.12.x`, `@ffmpeg/util ^0.12.x`, `@ffmpeg/core ^0.12.x` deps; add `scripts/copy-ffmpeg-core.mjs` to `prebuild` and `postinstall` chains |
| `pnpm-lock.yaml` | Auto-updated by `pnpm install` |
| `src/engines/_shared/types.ts` | Extend `EngineCategory` from `"image" \| "pdf" \| "document"` to add `"audio"` |
| `src/engines/_shared/registry.ts` | Add `"audio-convert"` to `EngineId` union and `REGISTRY` map |
| `src/engines/_shared/registry.metadata.test.ts` | If the test exhaustively asserts engine count, increment expectations |
| `src/components/layout/sidebar.tsx` | Add `audio-convert` to `TOOLS`; insert `"AUDIO"` into `GROUP_ORDER` between `"DOCS"` and `"ABOUT"` |
| `src/components/layout/sidebar.test.tsx` | If group ordering is asserted, update expectations |
| `src/app/page.tsx` | Append `audio-convert` to the `TOOLS` array |
| `src/app/page.test.tsx` | If TOOL count or specific entries are asserted, update |
| `vercel.json` | Add a `headers()` rule (or extend the existing wasm one) so `/ffmpeg/*.wasm` and `/ffmpeg/*.js` get `Cache-Control: public, max-age=31536000, immutable` |
| `.gitignore` | Verify `public/ffmpeg/` is gitignored (the prebuild script regenerates it) |

**Untouched (verify no edits):**
- `next.config.ts` — single-threaded ffmpeg loads via standard Web Worker, no special webpack config needed.
- `scripts/check-bundle-isolation.mjs` — auto-discovers engine directories; adding `audio-convert/` automatically enrolls it.
- `src/engines/_shared/harness.ts`, `decode-image.ts`, `file-detection.ts`, etc. — all v1 shared utilities unchanged.
- All existing engines under `src/engines/<id>/`.

---

## Task 1: Add ffmpeg dependencies + core-copy pipeline

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml` (auto)
- Create: `scripts/ffmpeg-manifest.json`
- Create: `scripts/copy-ffmpeg-core.mjs`
- Modify: `.gitignore`

- [ ] **Step 1.1: Install ffmpeg deps.**

```bash
pnpm add @ffmpeg/ffmpeg @ffmpeg/util @ffmpeg/core
```

Expected: `package.json` `dependencies` gains all three. Pin versions exactly to whatever pnpm resolves (don't carat-pin in the manifest — the SHA-pinned manifest in step 1.2 protects against drift).

- [ ] **Step 1.2: Create the ffmpeg-core manifest.**

`@ffmpeg/core` ships its UMD distribution at `node_modules/@ffmpeg/core/dist/umd/{ffmpeg-core.js, ffmpeg-core.wasm, ffmpeg-core.worker.js}`. Capture the sha256s of those files at the resolved version:

```bash
for f in node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js \
         node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm; do
  shasum -a 256 "$f"
done
```

Note: the single-threaded UMD build does NOT include `ffmpeg-core.worker.js` (that's the multi-threaded build, deferred to Phase 21). Only `ffmpeg-core.js` and `ffmpeg-core.wasm` are required.

Create `scripts/ffmpeg-manifest.json`:

```json
{
  "package": "@ffmpeg/core",
  "version": "<resolved version>",
  "license": "LGPL-2.1+",
  "files": [
    {
      "name": "ffmpeg-core.js",
      "sha256": "<from above>"
    },
    {
      "name": "ffmpeg-core.wasm",
      "sha256": "<from above>"
    }
  ],
  "_notes": {
    "build": "Single-threaded UMD build. Multi-threaded (with ffmpeg-core.worker.js) is gated behind COOP/COEP headers and lands in Phase 21.",
    "loading": "loaded by src/engines/_shared/ffmpeg/index.ts via FFmpeg.load({ coreURL: '/ffmpeg/ffmpeg-core.js', wasmURL: '/ffmpeg/ffmpeg-core.wasm' }). Both URLs are same-origin to honor the project's connect-src 'self' privacy guarantee."
  }
}
```

- [ ] **Step 1.3: Create the copy script.**

Create `scripts/copy-ffmpeg-core.mjs` modeled on `scripts/copy-bg-models.mjs`:

```javascript
#!/usr/bin/env node
// Copies @ffmpeg/core's UMD distribution from node_modules into public/ffmpeg/
// so the WASM loads same-origin (CSP `connect-src 'self'` enforces this).
//
// Sources: node_modules/@ffmpeg/core/dist/umd/{ffmpeg-core.js, ffmpeg-core.wasm}
// Destination: public/ffmpeg/{ffmpeg-core.js, ffmpeg-core.wasm}
//
// Each copy is hash-verified against scripts/ffmpeg-manifest.json so silent
// drift between the lockfile and the bytes blows up the build.

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

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function ensureDir(d) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

const srcDir = join(repoRoot, "node_modules", "@ffmpeg", "core", "dist", "umd");
const dstDir = join(repoRoot, "public", "ffmpeg");
ensureDir(dstDir);

for (const f of manifest.files) {
  const src = join(srcDir, f.name);
  const dst = join(dstDir, f.name);
  if (!existsSync(src)) {
    console.error(`[copy-ffmpeg-core] missing source: ${src}`);
    process.exit(1);
  }
  const actual = sha256(src);
  if (actual !== f.sha256) {
    console.error(
      `[copy-ffmpeg-core] sha256 mismatch for ${f.name}: ` +
        `expected ${f.sha256}, got ${actual}. Update ffmpeg-manifest.json after verifying the new bytes are intentional.`,
    );
    process.exit(1);
  }
  copyFileSync(src, dst);
  console.log(`[copy-ffmpeg-core] copied ${f.name}`);
}
```

- [ ] **Step 1.4: Wire the copy script into prebuild + postinstall.**

Edit `package.json` `scripts` block to chain the new script:

**old_string:**
```json
    "prebuild": "node scripts/copy-bg-models.mjs",
```

**new_string:**
```json
    "prebuild": "node scripts/copy-bg-models.mjs && node scripts/copy-ffmpeg-core.mjs",
```

**old_string:**
```json
    "postinstall": "node scripts/fetch-bg-models.mjs && node scripts/copy-bg-models.mjs",
```

**new_string:**
```json
    "postinstall": "node scripts/fetch-bg-models.mjs && node scripts/copy-bg-models.mjs && node scripts/copy-ffmpeg-core.mjs",
```

- [ ] **Step 1.5: Add `public/ffmpeg/` to gitignore.**

Verify `.gitignore` excludes `public/ffmpeg/`. If `public/models/` is already gitignored (it should be — bg-remove follows the same pattern), the rule may already cover via wildcard. Check and add an explicit entry if needed.

```bash
grep "ffmpeg" .gitignore || echo "public/ffmpeg/" >> .gitignore
```

- [ ] **Step 1.6: Run postinstall + verify deployed layout.**

```bash
pnpm install
ls -la public/ffmpeg/
```

Expected:
- `pnpm install` runs `postinstall` chain; ffmpeg copy logs success.
- `public/ffmpeg/` contains `ffmpeg-core.js` and `ffmpeg-core.wasm`.

- [ ] **Step 1.7: Commit.**

```bash
git add package.json pnpm-lock.yaml scripts/ffmpeg-manifest.json scripts/copy-ffmpeg-core.mjs .gitignore
git commit -m "Phase 19: add @ffmpeg deps + same-origin core copy pipeline"
```

---

## Task 2: Create `_shared/ffmpeg/` module

**Files:**
- Create: `src/engines/_shared/ffmpeg/index.ts`
- Create: `src/engines/_shared/ffmpeg/index.test.ts`

- [ ] **Step 2.1: Write the failing unit test first.**

Create `src/engines/_shared/ffmpeg/index.test.ts`:

```typescript
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

afterEach(() => {
  __resetForTests();
  vi.clearAllMocks();
});

describe("loadFfmpeg", () => {
  it("memoizes the instance across calls", async () => {
    const a = await loadFfmpeg();
    const b = await loadFfmpeg();
    expect(a).toBe(b);
    expect(FFmpeg).toHaveBeenCalledTimes(1);
  });

  it("calls FFmpeg.load with same-origin core + wasm URLs", async () => {
    const ff = await loadFfmpeg();
    expect(ff.load).toHaveBeenCalledWith(
      expect.objectContaining({
        coreURL: "/ffmpeg/ffmpeg-core.js",
        wasmURL: "/ffmpeg/ffmpeg-core.wasm",
      }),
    );
  });

  it("resets the cached promise after a load failure so the next call retries", async () => {
    const FFmpegMock = FFmpeg as unknown as ReturnType<typeof vi.fn>;
    FFmpegMock.mockImplementationOnce(() => ({
      load: vi.fn().mockRejectedValue(new Error("net")),
      on: vi.fn(),
    }));
    await expect(loadFfmpeg()).rejects.toThrow("net");
    // Second call should retry — new FFmpeg instance constructed.
    const ok = await loadFfmpeg();
    expect(ok).toBeDefined();
    expect(FFmpegMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2.2: Run the test to confirm failure.**

```bash
pnpm test src/engines/_shared/ffmpeg/index.test.ts
```

Expected: FAIL with "Cannot find module './index'" or similar.

- [ ] **Step 2.3: Write the implementation.**

Create `src/engines/_shared/ffmpeg/index.ts`:

```typescript
import type { FFmpeg as FFmpegType } from "@ffmpeg/ffmpeg";

// Side-effecting at module load: nothing. The FFmpeg instance is constructed
// lazily on first loadFfmpeg() call so this module can sit in a worker
// without paying the import cost until a conversion actually runs.
//
// Both URLs are same-origin (`/ffmpeg/...`) — written this way so the worker
// never makes an off-origin fetch during conversion, honoring the project's
// `connect-src 'self'` CSP. Bytes are populated by scripts/copy-ffmpeg-core.mjs
// from node_modules/@ffmpeg/core/dist/umd/.

export type FFmpegProgress = { percent: number; phase?: string };

const CORE_URL = "/ffmpeg/ffmpeg-core.js";
const WASM_URL = "/ffmpeg/ffmpeg-core.wasm";

let instancePromise: Promise<FFmpegType> | null = null;

export async function loadFfmpeg(): Promise<FFmpegType> {
  if (instancePromise) return instancePromise;
  instancePromise = (async () => {
    // Dynamic import keeps @ffmpeg/ffmpeg out of the homepage chunk.
    // scripts/check-bundle-isolation.mjs gates this at build time.
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const ff = new FFmpeg();
    await ff.load({ coreURL: CORE_URL, wasmURL: WASM_URL });
    return ff;
  })().catch((err) => {
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

- [ ] **Step 2.4: Run the test to confirm passing.**

```bash
pnpm test src/engines/_shared/ffmpeg/index.test.ts
```

Expected: PASS — all three test cases.

- [ ] **Step 2.5: Commit.**

```bash
git add src/engines/_shared/ffmpeg/index.ts src/engines/_shared/ffmpeg/index.test.ts
git commit -m "Phase 19: _shared/ffmpeg loader (cached singleton, same-origin URLs)"
```

---

## Task 3: Extend EngineCategory to include "audio"

**Files:**
- Modify: `src/engines/_shared/types.ts`

- [ ] **Step 3.1: Update the type union.**

Edit `src/engines/_shared/types.ts:33`:

**old_string:**
```typescript
export type EngineCategory = "image" | "pdf" | "document";
```

**new_string:**
```typescript
export type EngineCategory = "image" | "pdf" | "document" | "audio";
```

- [ ] **Step 3.2: Typecheck.**

```bash
pnpm typecheck
```

Expected: zero errors. The existing engines all already declare valid `category` values; adding a new union member is non-breaking.

- [ ] **Step 3.3: Commit.**

```bash
git add src/engines/_shared/types.ts
git commit -m "Phase 19: extend EngineCategory with 'audio'"
```

---

## Task 4: Create `audio-convert` options + tests

**Files:**
- Create: `src/engines/audio-convert/options.ts`
- Create: `src/engines/audio-convert/options.test.ts`

- [ ] **Step 4.1: Write the failing options test.**

Create `src/engines/audio-convert/options.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  AUDIO_BITRATE_OPTIONS,
  AUDIO_FORMAT_LOSSY,
  defaultAudioConvertOptions,
  OUTPUT_EXTENSION,
  OUTPUT_MIME,
  isLossy,
} from "./options";

describe("audio-convert options", () => {
  it("declares the four spec-mandated formats", () => {
    expect(Object.keys(OUTPUT_MIME)).toEqual(["mp3", "wav", "m4a", "flac"]);
    expect(Object.keys(OUTPUT_EXTENSION)).toEqual(["mp3", "wav", "m4a", "flac"]);
  });

  it("default outputFormat is null (user picks before conversion)", () => {
    expect(defaultAudioConvertOptions.outputFormat).toBeNull();
  });

  it("default bitrate is 192 kbps", () => {
    expect(defaultAudioConvertOptions.bitrate).toBe(192);
  });

  it("classifies mp3 and m4a as lossy; wav and flac as lossless", () => {
    expect(isLossy("mp3")).toBe(true);
    expect(isLossy("m4a")).toBe(true);
    expect(isLossy("wav")).toBe(false);
    expect(isLossy("flac")).toBe(false);
  });

  it("AUDIO_FORMAT_LOSSY matches isLossy()", () => {
    for (const fmt of Object.keys(OUTPUT_MIME) as Array<keyof typeof OUTPUT_MIME>) {
      expect(AUDIO_FORMAT_LOSSY[fmt]).toBe(isLossy(fmt));
    }
  });

  it("supported bitrate options are 64/128/192/256/320", () => {
    expect(AUDIO_BITRATE_OPTIONS).toEqual([64, 128, 192, 256, 320]);
  });
});
```

- [ ] **Step 4.2: Run the test to confirm failure.**

```bash
pnpm test src/engines/audio-convert/options.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4.3: Write the implementation.**

Create `src/engines/audio-convert/options.ts`:

```typescript
export type AudioConvertFormat = "mp3" | "wav" | "m4a" | "flac";
export type AudioBitrate = 64 | 128 | 192 | 256 | 320;

export type AudioConvertOptions = {
  outputFormat: AudioConvertFormat | null;
  bitrate: AudioBitrate;
};

export const defaultAudioConvertOptions: AudioConvertOptions = {
  outputFormat: null,
  bitrate: 192,
};

export const OUTPUT_MIME: Record<AudioConvertFormat, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  flac: "audio/flac",
};

export const OUTPUT_EXTENSION: Record<AudioConvertFormat, string> = {
  mp3: "mp3",
  wav: "wav",
  m4a: "m4a",
  flac: "flac",
};

export const AUDIO_FORMAT_LOSSY: Record<AudioConvertFormat, boolean> = {
  mp3: true,
  m4a: true,
  wav: false,
  flac: false,
};

export const AUDIO_BITRATE_OPTIONS: ReadonlyArray<AudioBitrate> = [64, 128, 192, 256, 320];

export function isLossy(fmt: AudioConvertFormat): boolean {
  return AUDIO_FORMAT_LOSSY[fmt];
}
```

- [ ] **Step 4.4: Run the test to confirm passing.**

```bash
pnpm test src/engines/audio-convert/options.test.ts
```

Expected: PASS.

- [ ] **Step 4.5: Commit.**

```bash
git add src/engines/audio-convert/options.ts src/engines/audio-convert/options.test.ts
git commit -m "Phase 19: audio-convert options module + tests"
```

---

## Task 5: Create `audio-convert` worker

**Files:**
- Create: `src/engines/audio-convert/worker.ts`

The worker is harder to unit-test than options/descriptor because it depends on real ffmpeg.wasm. We rely on the integration-level correctness E2E (Task 12) to exercise this code with a real instance. The worker itself stays small and almost trivially correct; complexity lives in `_shared/ffmpeg`.

- [ ] **Step 5.1: Write the worker.**

Create `src/engines/audio-convert/worker.ts`:

```typescript
import { fetchFile } from "@ffmpeg/util";
import * as Comlink from "comlink";
import { loadFfmpeg } from "@/engines/_shared/ffmpeg";
import type { ConversionProgress, OutputItem } from "@/engines/_shared/types";
import {
  type AudioConvertOptions,
  OUTPUT_EXTENSION,
  OUTPUT_MIME,
  isLossy,
} from "./options";

function replaceExtension(name: string, newExt: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.${newExt}`;
}

function ffmpegCodec(fmt: AudioConvertOptions["outputFormat"]): string {
  switch (fmt) {
    case "mp3":
      return "libmp3lame";
    case "wav":
      return "pcm_s16le";
    case "m4a":
      return "aac";
    case "flac":
      return "flac";
    default:
      throw new Error(`audio-convert: unknown output format: ${fmt}`);
  }
}

const api = {
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    _type: string,
    opts: AudioConvertOptions,
    onProgress?: (p: ConversionProgress) => void,
  ): Promise<OutputItem> {
    if (!opts.outputFormat) {
      throw new Error("audio-convert: outputFormat must be set before conversion");
    }
    const fmt = opts.outputFormat;

    // Phase 1: load ffmpeg (cached after first call across the page).
    onProgress?.({ kind: "model-loading", loaded: 0, total: 1 });
    const ff = await loadFfmpeg();
    onProgress?.({ kind: "model-loading", loaded: 1, total: 1 });

    // Wire ffmpeg's progress callback to our ConversionProgress shape.
    // ffmpeg emits { progress: 0..1, time: ... } during exec; translate.
    const progressHandler = ({ progress }: { progress: number }) => {
      onProgress?.({ kind: "inference", pct: Math.max(0, Math.min(100, progress * 100)) });
    };
    ff.on("progress", progressHandler);

    try {
      // Phase 2: write input file into ffmpeg's virtual FS.
      const inExt = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "bin").toLowerCase();
      const inName = `in.${inExt}`;
      const outExt = OUTPUT_EXTENSION[fmt];
      const outName = `out.${outExt}`;

      // fetchFile accepts ArrayBuffer | Uint8Array | Blob | File | URL string.
      // We pass the raw ArrayBuffer (already transferred from the main thread).
      await ff.writeFile(inName, await fetchFile(new Blob([bytes])));

      // Phase 3: run conversion.
      onProgress?.({ kind: "inference", pct: 0 });
      const codec = ffmpegCodec(fmt);
      const args = ["-i", inName];
      // Bitrate flag only for lossy targets.
      if (isLossy(fmt)) {
        args.push("-b:a", `${opts.bitrate}k`);
      }
      args.push("-c:a", codec, outName);
      await ff.exec(args);
      onProgress?.({ kind: "inference", pct: 100 });

      // Phase 4: read output.
      const out = await ff.readFile(outName);
      // ff.readFile returns Uint8Array | string; we expect Uint8Array for binary.
      if (typeof out === "string") {
        throw new Error("audio-convert: ffmpeg returned text output unexpectedly");
      }

      // Clean up virtual FS so subsequent conversions on the same hot worker
      // don't hold stale buffers.
      try {
        await ff.deleteFile(inName);
        await ff.deleteFile(outName);
      } catch {
        // Best-effort cleanup; ignore.
      }

      const blob = new Blob([out], { type: OUTPUT_MIME[fmt] });
      return {
        filename: replaceExtension(name, OUTPUT_EXTENSION[fmt]),
        mime: OUTPUT_MIME[fmt],
        blob,
      };
    } finally {
      ff.off("progress", progressHandler);
    }
  },
};

Comlink.expose(api);
```

- [ ] **Step 5.2: Typecheck the worker compiles.**

```bash
pnpm typecheck
```

Expected: zero errors. If `ConversionProgress` shapes don't include `"model-loading"` or `"inference"` kinds, defer to whatever shapes are already used by `image-bg-remove/worker.ts` (it uses the same union) and adjust.

- [ ] **Step 5.3: Commit.**

```bash
git add src/engines/audio-convert/worker.ts
git commit -m "Phase 19: audio-convert worker (ffmpeg writeFile/exec/readFile)"
```

---

## Task 6: Create `audio-convert` OptionsPanel

**Files:**
- Create: `src/engines/audio-convert/options-panel.tsx`
- Create: `src/engines/audio-convert/options-panel.test.tsx`

- [ ] **Step 6.1: Write the failing options-panel test.**

Create `src/engines/audio-convert/options-panel.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImageConvertOptionsPanel } from "@/engines/image-convert/options-panel";
// ^ keep an existing reference here only to verify import resolution; remove after.
import { defaultAudioConvertOptions } from "./options";
import { AudioConvertOptionsPanel } from "./options-panel";

describe("AudioConvertOptionsPanel", () => {
  it("renders four format options", () => {
    const onChange = vi.fn();
    render(
      <AudioConvertOptionsPanel
        options={defaultAudioConvertOptions}
        onChange={onChange}
      />,
    );
    for (const fmt of ["mp3", "wav", "m4a", "flac"]) {
      expect(screen.getByText(fmt, { exact: false })).toBeInTheDocument();
    }
  });

  it("hides the bitrate dropdown when format is lossless (wav)", () => {
    const onChange = vi.fn();
    render(
      <AudioConvertOptionsPanel
        options={{ ...defaultAudioConvertOptions, outputFormat: "wav" }}
        onChange={onChange}
      />,
    );
    expect(screen.queryByLabelText(/bitrate/i)).not.toBeInTheDocument();
  });

  it("shows the bitrate dropdown when format is lossy (mp3)", () => {
    const onChange = vi.fn();
    render(
      <AudioConvertOptionsPanel
        options={{ ...defaultAudioConvertOptions, outputFormat: "mp3" }}
        onChange={onChange}
      />,
    );
    expect(screen.getByLabelText(/bitrate/i)).toBeInTheDocument();
  });

  it("calls onChange with new outputFormat when a format radio is selected", () => {
    const onChange = vi.fn();
    render(
      <AudioConvertOptionsPanel
        options={defaultAudioConvertOptions}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText(/mp3/i));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ outputFormat: "mp3" }),
    );
  });
});
```

Remove the unused `ImageConvertOptionsPanel` import line before saving — the placeholder above is to nudge the executor to verify import paths in this codebase. The actual test should not reference image-convert.

- [ ] **Step 6.2: Run the test to confirm failure.**

```bash
pnpm test src/engines/audio-convert/options-panel.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 6.3: Look at an existing OptionsPanel for the rendering pattern.**

Read `src/engines/image-convert/options-panel.tsx` and `src/engines/image-bg-remove/options-panel.tsx` to align with the brutalist visual treatment (square radios, monospace labels, no gradient). Match those patterns; don't invent a new visual style.

- [ ] **Step 6.4: Write the OptionsPanel implementation.**

Create `src/engines/audio-convert/options-panel.tsx` following the pattern of `image-convert/options-panel.tsx`. Required behavior:
- Format chooser: 4 radio buttons (mp3, wav, m4a, flac) bound to `options.outputFormat`. Selecting one calls `onChange({ ...options, outputFormat: <fmt> })`.
- Bitrate dropdown: 5 options (64/128/192/256/320 kbps) bound to `options.bitrate`. Renders only when `options.outputFormat` is non-null AND `isLossy(outputFormat)` returns true. Selection calls `onChange({ ...options, bitrate: <value> })`.
- Disabled state: respects an optional `disabled` prop if `OptionsPanelProps` declares one (check `_shared/types.ts`).

The implementation should be ~60 lines of TSX. Don't include screenshots in the test plan — visual verification happens in Task 14 (manual smoke).

- [ ] **Step 6.5: Run the test to confirm passing.**

```bash
pnpm test src/engines/audio-convert/options-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 6.6: Commit.**

```bash
git add src/engines/audio-convert/options-panel.tsx src/engines/audio-convert/options-panel.test.tsx
git commit -m "Phase 19: audio-convert OptionsPanel (format radio + bitrate dropdown)"
```

---

## Task 7: Create `audio-convert` engine descriptor

**Files:**
- Create: `src/engines/audio-convert/index.ts`
- Create: `src/engines/audio-convert/index.test.ts`

- [ ] **Step 7.1: Write the failing descriptor test.**

Create `src/engines/audio-convert/index.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import engine from "./index";

describe("audio-convert engine descriptor", () => {
  it("registers under id 'audio-convert' in the audio category", () => {
    expect(engine.id).toBe("audio-convert");
    expect(engine.category).toBe("audio");
    expect(engine.cardinality).toBe("single");
  });

  it("declares the four spec-mandated formats in inputAccept and inputMime", () => {
    expect(engine.inputAccept).toEqual([".mp3", ".wav", ".m4a", ".flac"]);
    expect(engine.inputMime).toEqual([
      "audio/mpeg",
      "audio/wav",
      "audio/mp4",
      "audio/flac",
    ]);
  });

  it("declares ffmpeg.wasm as the library", () => {
    expect(engine.library).toMatch(/ffmpeg\.wasm/i);
    expect(engine.license).toBe("LGPL-2.1+");
  });

  it("validate rejects files with the wrong extension", () => {
    const file = new File(["x"], "image.png", { type: "image/png" });
    if (engine.cardinality !== "single") throw new Error("expected single-input");
    const result = engine.validate(file, engine.defaultOptions);
    expect(result.ok).toBe(false);
  });

  it("validate accepts a 1 KB MP3 file by extension", () => {
    const file = new File(["x".repeat(1000)], "song.mp3", { type: "audio/mpeg" });
    if (engine.cardinality !== "single") throw new Error("expected single-input");
    const result = engine.validate(file, engine.defaultOptions);
    expect(result.ok).toBe(true);
  });

  it("validate rejects files larger than 500 MB", () => {
    const file = new File(["x"], "song.mp3", { type: "audio/mpeg" });
    Object.defineProperty(file, "size", { value: 501 * 1_000_000 });
    if (engine.cardinality !== "single") throw new Error("expected single-input");
    const result = engine.validate(file, engine.defaultOptions);
    expect(result.ok).toBe(false);
  });

  it("isReadyToConvert returns false until outputFormat is set", () => {
    expect(engine.isReadyToConvert?.(engine.defaultOptions)).toBe(false);
    expect(engine.isReadyToConvert?.({ ...engine.defaultOptions, outputFormat: "mp3" })).toBe(true);
  });
});
```

- [ ] **Step 7.2: Run the test to confirm failure.**

```bash
pnpm test src/engines/audio-convert/index.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 7.3: Write the descriptor.**

Create `src/engines/audio-convert/index.ts`:

```typescript
import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { AudioConvertOptionsPanel } from "./options-panel";
import {
  type AudioConvertOptions,
  defaultAudioConvertOptions,
} from "./options";

const SUPPORTED_INPUT_MIMES = [
  "audio/mpeg",
  "audio/wav",
  "audio/mp4",
  "audio/flac",
];

// Spec §7.1 — 500 MB cap: typical music files fit comfortably; ffmpeg.wasm
// audio operations are fast at this size on the single-threaded core.
const MAX_FILE_BYTES = 500 * 1_000_000;

// Module-scoped persistent harness so ffmpeg loads once across a batch
// of conversions on the same route. Mirrors image-bg-remove's pattern.
let harness: WorkerHarness<AudioConvertOptions> | null = null;
function getHarness(): WorkerHarness<AudioConvertOptions> {
  if (!harness) {
    harness = new WorkerHarness<AudioConvertOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
      { persistent: true },
    );
  }
  return harness;
}

export function disposeAudioConvertHarness(): void {
  harness?.dispose();
  harness = null;
}

const engine: SingleInputEngine<AudioConvertOptions, OutputItem> = {
  id: "audio-convert",
  inputAccept: [".mp3", ".wav", ".m4a", ".flac"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "audio/mpeg",
  defaultOptions: defaultAudioConvertOptions,
  category: "audio",
  library: "ffmpeg.wasm (single-threaded core)",
  license: "LGPL-2.1+",
  cardinality: "single",
  isReadyToConvert: (opts) => opts.outputFormat !== null,
  OptionsPanel: AudioConvertOptionsPanel,
  validate(file) {
    const mimeOk = SUPPORTED_INPUT_MIMES.includes(file.type);
    const extOk = /\.(mp3|wav|m4a|flac)$/i.test(file.name);
    if (!mimeOk && !extOk) {
      return { ok: false, reason: "Expected an MP3, WAV, M4A, or FLAC file" };
    }
    if (file.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        reason: `File too large for audio-convert (limit 500 MB; got ${(file.size / 1_000_000).toFixed(1)} MB).`,
      };
    }
    return { ok: true };
  },
  async convert(file, opts, signal, runOpts) {
    const result = await getHarness().runSingle(file, opts, signal, runOpts);
    if (Array.isArray(result)) {
      const first = result[0];
      if (!first) throw new Error("engine returned empty array");
      return first;
    }
    return result;
  },
};

export default engine;
```

- [ ] **Step 7.4: Run the descriptor test to confirm passing.**

```bash
pnpm test src/engines/audio-convert/index.test.ts
```

Expected: PASS.

- [ ] **Step 7.5: Commit.**

```bash
git add src/engines/audio-convert/index.ts src/engines/audio-convert/index.test.ts
git commit -m "Phase 19: audio-convert engine descriptor"
```

---

## Task 8: Register `audio-convert` in registry

**Files:**
- Modify: `src/engines/_shared/registry.ts`
- Modify: `src/engines/_shared/registry.metadata.test.ts`
- Modify: `src/engines/_shared/registry.test.ts` (only if test enumerates engine count)

- [ ] **Step 8.1: Add audio-convert to the registry.**

Edit `src/engines/_shared/registry.ts`. The `EngineId` union and the `REGISTRY` map both grow.

**old_string** (the `EngineId` union, currently lines 3-16):
```typescript
export type EngineId =
  | "docx-to-txt"
  | "image-bg-remove"
  | "image-convert"
  | "image-resize"
  | "image-to-pdf"
  | "markdown-to-pdf"
  | "pdf-edit"
  | "pdf-merge"
  | "pdf-split"
  | "pdf-to-image"
  | "pdf-to-md"
  | "docx-to-pdf"
  | "txt-to-pdf";
```

**new_string:**
```typescript
export type EngineId =
  | "audio-convert"
  | "docx-to-txt"
  | "image-bg-remove"
  | "image-convert"
  | "image-resize"
  | "image-to-pdf"
  | "markdown-to-pdf"
  | "pdf-edit"
  | "pdf-merge"
  | "pdf-split"
  | "pdf-to-image"
  | "pdf-to-md"
  | "docx-to-pdf"
  | "txt-to-pdf";
```

**old_string** (the `REGISTRY` map opening line):
```typescript
const REGISTRY: Record<EngineId, Loader> = {
  "docx-to-txt": () => import("@/engines/docx-to-txt"),
```

**new_string:**
```typescript
const REGISTRY: Record<EngineId, Loader> = {
  "audio-convert": () => import("@/engines/audio-convert"),
  "docx-to-txt": () => import("@/engines/docx-to-txt"),
```

- [ ] **Step 8.2: Run the registry tests.**

```bash
pnpm test src/engines/_shared/registry.test.ts src/engines/_shared/registry.metadata.test.ts
```

Expected: PASS. If a test asserts `Object.keys(REGISTRY).length === 13`, bump it to 14 (or whatever the current count + 1 is — read the test first).

- [ ] **Step 8.3: Commit.**

```bash
git add src/engines/_shared/registry.ts src/engines/_shared/registry.metadata.test.ts src/engines/_shared/registry.test.ts
git commit -m "Phase 19: register audio-convert in engine registry"
```

---

## Task 9: Create the `/tools/audio-convert` route

**Files:**
- Create: `src/app/tools/audio-convert/page.tsx`

- [ ] **Step 9.1: Write the route page.**

Create `src/app/tools/audio-convert/page.tsx`:

```tsx
"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/audio-convert";

export default function AudioConvertPage() {
  return <ToolFrame engine={engine} />;
}
```

- [ ] **Step 9.2: Verify the route resolves.**

```bash
pnpm dev &
DEV_PID=$!
sleep 5
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/tools/audio-convert
kill $DEV_PID
```

Expected: `200`.

- [ ] **Step 9.3: Commit.**

```bash
git add src/app/tools/audio-convert/page.tsx
git commit -m "Phase 19: /tools/audio-convert route"
```

---

## Task 10: Update sidebar with AUDIO group

**Files:**
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/components/layout/sidebar.test.tsx`

- [ ] **Step 10.1: Read the current sidebar test to understand the expectations.**

```bash
cat src/components/layout/sidebar.test.tsx
```

If the test asserts a specific list of `groups`, the AUDIO group needs to be added there.

- [ ] **Step 10.2: Add the audio-convert link + AUDIO group.**

Edit `src/components/layout/sidebar.tsx`. Insert a new `TOOLS` entry and update `GROUP_ORDER`:

**old_string** (the `GROUP_ORDER` line):
```typescript
const GROUP_ORDER = ["HOME", "IMAGES", "PDFS", "DOCS", "ABOUT"] as const;
```

**new_string:**
```typescript
const GROUP_ORDER = ["HOME", "IMAGES", "PDFS", "DOCS", "AUDIO", "ABOUT"] as const;
```

In the `TOOLS` array, insert a new entry between the DOCS entries and the ABOUT entry. Find the line:

**old_string:**
```typescript
  { id: "txt-to-pdf", href: "/tools/txt-to-pdf", label: "txt→pdf", group: "DOCS" },
  { id: "about", href: "/about", label: "about", group: "ABOUT" },
```

**new_string:**
```typescript
  { id: "txt-to-pdf", href: "/tools/txt-to-pdf", label: "txt→pdf", group: "DOCS" },
  { id: "audio-convert", href: "/tools/audio-convert", label: "audio convert", group: "AUDIO" },
  { id: "about", href: "/about", label: "about", group: "ABOUT" },
```

- [ ] **Step 10.3: Update the sidebar test if needed.**

If `sidebar.test.tsx` snapshots groups or asserts `GROUP_ORDER` length, update it. Add a test that the AUDIO group renders the audio-convert link:

```typescript
it("renders the audio-convert link under the AUDIO group", () => {
  render(<Sidebar />);
  // The group divider; existing tests likely assert similar shapes for IMAGES/PDFS/DOCS.
  expect(screen.getByText(/\/\/ AUDIO/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "audio convert" })).toHaveAttribute(
    "href",
    "/tools/audio-convert",
  );
});
```

- [ ] **Step 10.4: Run the sidebar test.**

```bash
pnpm test src/components/layout/sidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 10.5: Commit.**

```bash
git add src/components/layout/sidebar.tsx src/components/layout/sidebar.test.tsx
git commit -m "Phase 19: add AUDIO sidebar group + audio-convert link"
```

---

## Task 11: Add audio-convert card to home grid

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/page.test.tsx` (only if it asserts TOOLS contents)

The home grid is currently a flat array of `TOOLS`. Phase 26 will section it by category; for now, append the audio-convert entry to the flat array.

- [ ] **Step 11.1: Append the entry.**

Edit `src/app/page.tsx`. Find the closing `]` of the `TOOLS` array and append before it:

```typescript
  {
    id: "audio-convert",
    title: "audio convert",
    description: "mp3, wav, m4a, flac · convert between formats",
    href: "/tools/audio-convert",
  },
```

(Match the order convention used by neighboring entries — read the existing file to confirm the alphabetization or grouping in use.)

- [ ] **Step 11.2: Update page.test.tsx if it asserts TOOLS length or specific entries.**

```bash
cat src/app/page.test.tsx
```

If the test asserts e.g. `expect(TOOLS.length).toBe(13)`, bump to 14. If it tests specific tool cards by id, optionally add a test for `audio-convert`.

- [ ] **Step 11.3: Run the page test.**

```bash
pnpm test src/app/page.test.tsx
```

Expected: PASS.

- [ ] **Step 11.4: Commit.**

```bash
git add src/app/page.tsx src/app/page.test.tsx
git commit -m "Phase 19: add audio-convert card to home grid"
```

---

## Task 12: Acquire audio fixtures + correctness E2E

**Files:**
- Create: `tests/fixtures/audio/sample.mp3`
- Create: `tests/fixtures/audio/sample.wav`
- Create: `tests/fixtures/audio/sample.m4a`
- Create: `tests/fixtures/audio/sample.flac`
- Create: `tests/fixtures/audio/SOURCES.md`
- Create: `tests/e2e/audio-convert.spec.ts`
- Create: `tests/e2e/audio-convert-correctness.spec.ts`
- Create: `tests/e2e/privacy-regression-audio-convert.spec.ts`

- [ ] **Step 12.1: Acquire a CC0 audio source.**

Sources to consider:
- archive.org's free music archive (filter to Creative Commons / Public Domain).
- ccmixter.org (Creative Commons, attribute as required).
- A self-recorded silent or sine-wave clip generated locally with ffmpeg (deterministic, no licensing concerns).

For Phase 19, the easiest fixture is **a deterministic sine-wave clip generated locally** — no licensing concerns, easy to regenerate, fits well under 1 MB:

```bash
mkdir -p tests/fixtures/audio
ffmpeg -f lavfi -i "sine=frequency=440:duration=5" -ar 44100 -ac 2 -b:a 192k tests/fixtures/audio/sample.mp3
ffmpeg -f lavfi -i "sine=frequency=440:duration=5" -ar 44100 -ac 2 tests/fixtures/audio/sample.wav
ffmpeg -f lavfi -i "sine=frequency=440:duration=5" -ar 44100 -ac 2 -b:a 192k tests/fixtures/audio/sample.m4a
ffmpeg -f lavfi -i "sine=frequency=440:duration=5" -ar 44100 -ac 2 tests/fixtures/audio/sample.flac
```

Each file should be < 1 MB. Verify:

```bash
ls -lh tests/fixtures/audio/
```

- [ ] **Step 12.2: Document fixture provenance.**

Create `tests/fixtures/audio/SOURCES.md`:

```markdown
# audio fixtures

All fixtures are deterministic 440 Hz sine waves at 44.1 kHz stereo, 5 seconds
long. Generated locally with `ffmpeg -f lavfi -i "sine=frequency=440:duration=5"
-ar 44100 -ac 2 ...`. No third-party licensing concerns; regenerable from a
single ffmpeg command.

| File | Format | Codec | Bitrate / sample format |
|---|---|---|---|
| sample.mp3 | MP3 | libmp3lame | 192 kbps |
| sample.wav | WAV | pcm_s16le (lossless) | uncompressed |
| sample.m4a | M4A | aac | 192 kbps |
| sample.flac | FLAC | flac (lossless) | uncompressed |

Why a sine wave: the goal of the correctness E2E is not perceptual quality but
**format-correct output bytes**. A sine wave is deterministic and small; the
test asserts magic bytes, duration, and (for lossy formats) approximate file
size — properties that don't depend on input content.
```

- [ ] **Step 12.3: Write the fast route E2E.**

Create `tests/e2e/audio-convert.spec.ts`:

```typescript
import { expect, test } from "@playwright/test";

test("/tools/audio-convert renders the tool frame and shows status [ READY ]", async ({ page }) => {
  await page.goto("/tools/audio-convert");
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");
});

test("audio-convert shows the four format options", async ({ page }) => {
  await page.goto("/tools/audio-convert");
  for (const fmt of ["mp3", "wav", "m4a", "flac"]) {
    await expect(page.getByLabel(new RegExp(`^${fmt}`, "i"))).toBeVisible();
  }
});

test("audio-convert shows bitrate dropdown only for lossy formats", async ({ page }) => {
  await page.goto("/tools/audio-convert");
  // Default outputFormat is null, so no bitrate dropdown initially.
  await expect(page.getByLabel(/bitrate/i)).not.toBeVisible();
  // Pick mp3 (lossy) — bitrate appears.
  await page.getByLabel(/^mp3/i).click();
  await expect(page.getByLabel(/bitrate/i)).toBeVisible();
  // Pick wav (lossless) — bitrate hides.
  await page.getByLabel(/^wav/i).click();
  await expect(page.getByLabel(/bitrate/i)).not.toBeVisible();
});
```

- [ ] **Step 12.4: Write the gated correctness E2E.**

Create `tests/e2e/audio-convert-correctness.spec.ts`:

```typescript
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Gated by RUN_AUDIO_CONVERT_CORRECTNESS=1. The suite drives real ffmpeg.wasm
// inference (cold-load + run) and is slow; we don't want it on every CI pass.
//
// To run locally:
//   RUN_AUDIO_CONVERT_CORRECTNESS=1 pnpm test:e2e --project=chromium \
//     tests/e2e/audio-convert-correctness.spec.ts

const SHOULD_RUN = process.env.RUN_AUDIO_CONVERT_CORRECTNESS === "1";

test.describe.configure({ mode: "serial", timeout: 240_000 });

const FIXTURES = [
  { file: "sample.mp3", inputFmt: "mp3" },
  { file: "sample.wav", inputFmt: "wav" },
  { file: "sample.m4a", inputFmt: "m4a" },
  { file: "sample.flac", inputFmt: "flac" },
] as const;

const OUTPUT_FORMATS = ["mp3", "wav", "m4a", "flac"] as const;

// Magic bytes for output format detection.
const MAGIC: Record<typeof OUTPUT_FORMATS[number], (b: Buffer) => boolean> = {
  mp3: (b) => b[0] === 0xff && (b[1] === 0xfb || b[1] === 0xf3 || b[1] === 0xf2 || (b[0] === 0x49 && b[1] === 0x44)),
  // ID3v2 header "ID3" or MPEG sync word
  wav: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WAVE",
  m4a: (b) => b.subarray(4, 8).toString("ascii") === "ftyp",
  flac: (b) => b.subarray(0, 4).toString("ascii") === "fLaC",
};

const guarded = SHOULD_RUN ? test : test.skip;

// 16 conversions: 4 inputs × 4 outputs. The same-format conversions exercise
// the codec round-trip (decode + re-encode), not just no-op file copy.
for (const fx of FIXTURES) {
  for (const outFmt of OUTPUT_FORMATS) {
    guarded(`audio-convert ${fx.file} → .${outFmt} produces a valid ${outFmt} file`, async ({ page }) => {
      await page.goto("/tools/audio-convert");
      await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

      const fixture = path.resolve(__dirname, "../fixtures/audio", fx.file);
      await page.locator('input[type="file"]').setInputFiles(fixture);

      await page.getByLabel(new RegExp(`^${outFmt}`, "i")).click();

      await page.getByTestId("convert-button").click();

      await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
        timeout: 120_000,
      });

      const downloadButton = page.getByRole("button", { name: /^download / });
      const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
      await downloadButton.click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${outFmt}$`, "i"));

      const dlPath = await download.path();
      const bytes = await readFile(dlPath);
      expect(bytes.length).toBeGreaterThan(100);
      expect(MAGIC[outFmt](bytes)).toBe(true);
    });
  }
}
```

- [ ] **Step 12.5: Write the privacy-regression E2E.**

Create `tests/e2e/privacy-regression-audio-convert.spec.ts` modeled on `tests/e2e/privacy-regression-image-bg-remove.spec.ts` (read that file first to align with the exact assertion pattern). The shape:

```typescript
import path from "node:path";
import { expect, test } from "@playwright/test";

test("audio-convert: zero outbound network during conversion", async ({ page, context }) => {
  // Pre-load the engine route so model + initial assets are fetched.
  await page.goto("/tools/audio-convert");
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  // Start tracking network requests AFTER the page is ready. Conversion
  // should produce zero new requests — that's the §10.3 demonstration.
  const requests: string[] = [];
  context.on("request", (req) => {
    requests.push(req.url());
  });

  const fixture = path.resolve(__dirname, "../fixtures/audio/sample.mp3");
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.getByLabel(/^wav/i).click();
  await page.getByTestId("convert-button").click();

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 120_000,
  });

  // ffmpeg may make same-origin requests during cold-load. Phase 19's
  // privacy assertion: any request URL must be same-origin.
  for (const url of requests) {
    expect(url).toMatch(/^https?:\/\/(localhost|127\.0\.0\.1)/);
  }
});
```

The exact form (full off-origin block vs. allow-same-origin) should match the existing `privacy-regression-image-bg-remove.spec.ts` convention. Read that file before writing.

- [ ] **Step 12.6: Run the fast route E2E.**

```bash
pnpm test:e2e --project=chromium tests/e2e/audio-convert.spec.ts
```

Expected: PASS.

- [ ] **Step 12.7: Run the gated correctness E2E.**

```bash
RUN_AUDIO_CONVERT_CORRECTNESS=1 pnpm test:e2e --project=chromium tests/e2e/audio-convert-correctness.spec.ts
```

Expected: 16 tests PASS.

If any specific format conversion fails (e.g., `sample.flac → mp3`), inspect the worker output and adjust ffmpeg arguments. The `ffmpegCodec()` map in worker.ts may need tweaks — `aac` requires `-strict experimental` on some builds; `libmp3lame` should be in the standard core.

- [ ] **Step 12.8: Run the privacy-regression E2E.**

```bash
pnpm test:e2e --project=chromium tests/e2e/privacy-regression-audio-convert.spec.ts
```

Expected: PASS — zero off-origin requests.

- [ ] **Step 12.9: Commit.**

```bash
git add tests/fixtures/audio/ tests/e2e/audio-convert.spec.ts tests/e2e/audio-convert-correctness.spec.ts tests/e2e/privacy-regression-audio-convert.spec.ts
git commit -m "Phase 19: audio-convert fixtures + E2E (route, correctness, privacy)"
```

---

## Task 13: Update vercel.json for ffmpeg cache headers

**Files:**
- Modify: `vercel.json`

- [ ] **Step 13.1: Read the current vercel.json to find the wasm cache rule.**

```bash
cat vercel.json
```

The existing rule for bg-remove sets `Cache-Control: public, max-age=31536000, immutable` on `.wasm` files (verify this).

- [ ] **Step 13.2: Extend the rule to cover `/ffmpeg/*`.**

If the existing rule matches `*.wasm` globally, ffmpeg-core.wasm is already covered. If it's path-scoped to `/onnx-wasm/` or `/models/`, add a sibling rule for `/ffmpeg/`. The exact JSON form depends on the existing structure — minimum coverage required:

```json
{
  "source": "/ffmpeg/(.*)",
  "headers": [
    {
      "key": "Cache-Control",
      "value": "public, max-age=31536000, immutable"
    }
  ]
}
```

- [ ] **Step 13.3: Verify CSP holds.**

The current CSP (per CLAUDE.md and v1 closeout): `script-src 'self' 'wasm-unsafe-eval'`, `connect-src 'self'`. ffmpeg.wasm at `/ffmpeg/*` is `'self'` — no CSP edits needed.

- [ ] **Step 13.4: Commit.**

```bash
git add vercel.json
git commit -m "Phase 19: cache-control immutable on /ffmpeg/* assets"
```

---

## Task 14: Full project verification + manual smoke

**Files:** none (verification only)

- [ ] **Step 14.1: Typecheck.**

```bash
pnpm typecheck
```

Expected: zero errors.

- [ ] **Step 14.2: Lint.**

```bash
pnpm lint
```

Expected: zero errors.

- [ ] **Step 14.3: Full unit + integration test suite.**

```bash
pnpm test
```

Expected: all green. If memory pressure on the 8 GB box bites, cap workers:

```bash
pnpm test --pool=threads --poolOptions.threads.maxThreads=2
```

- [ ] **Step 14.4: Build + bundle isolation gate.**

```bash
pnpm build
```

Expected:
- `prebuild` runs the new ffmpeg copy script successfully.
- `next build` completes.
- `postbuild` runs `scripts/check-bundle-isolation.mjs` and exits 0 — `audio-convert` is auto-discovered as a new engine, and the script asserts no engine-internal code (including the worker chunk that imports `@ffmpeg/ffmpeg`) leaks into the homepage chunk.

If the bundle-isolation gate FAILS for `audio-convert`, the cause is almost always a static import of `_shared/ffmpeg/index.ts` from a non-engine module (or a static import of `@ffmpeg/ffmpeg` from `_shared/ffmpeg/index.ts` that wasn't replaced with `await import(...)`). Fix the static import; do not relax the gate.

- [ ] **Step 14.5: Spot-check the production build.**

```bash
pnpm start &
START_PID=$!
sleep 5
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/tools/audio-convert
curl -sI http://localhost:3000/ffmpeg/ffmpeg-core.wasm | head -10
kill $START_PID
```

Expected:
- `/tools/audio-convert` returns 200.
- `/ffmpeg/ffmpeg-core.wasm` returns 200 with `Cache-Control: public, max-age=31536000, immutable`.

- [ ] **Step 14.6: Manual smoke test in dev.**

```bash
pnpm dev
```

Navigate to `http://localhost:3000/tools/audio-convert`. For each of the four input fixtures, convert to each of the four output formats (16 conversions). Visually verify:
- The status indicator transitions through `[ READY ] → [ LOADING_MODEL ] → [ CONVERTING ] → [ DONE ]`.
- Bitrate dropdown shows for mp3/m4a outputs and hides for wav/flac.
- The downloaded file plays back correctly in a media player (a sine wave is audibly a steady tone).

- [ ] **Step 14.7: Manual privacy verification.**

With DevTools Network panel open and filter set to "Fetch/XHR":
- Reload the page — ffmpeg core + wasm loads from `/ffmpeg/...` (same-origin).
- Drop a file and Convert — observe **zero off-origin** new network requests during conversion.

This is the §10.3 demonstration. It must hold.

- [ ] **Step 14.8: Push and open PR.**

This phase MUST be developed on a dedicated feature branch. If working on `main`, halt and switch branches first.

```bash
git push -u origin phase-19-ffmpeg-and-audio-convert
gh pr create --title "Phase 19: ffmpeg shared infra + audio-convert" --body "$(cat <<'EOF'
## Summary
- New `_shared/ffmpeg/` module: cached singleton, same-origin core+wasm URLs, dynamic-import boundary.
- New `audio-convert` engine: MP3 ↔ WAV ↔ M4A ↔ FLAC any-to-any with bitrate option for lossy targets (default 192 kbps).
- Build pipeline: `scripts/copy-ffmpeg-core.mjs` mirrors the bg-models pattern; SHA-pinned via `scripts/ffmpeg-manifest.json`.
- EngineCategory extended with `"audio"`; sidebar grows AUDIO group; home grid gains audio-convert card.
- Single-threaded ffmpeg core only — multi-threaded (COOP/COEP) deferred to Phase 21.

## Verification
- Typecheck, lint, full unit suite green.
- `pnpm build` + bundle-isolation gate green (ffmpeg.wasm not in homepage chunk).
- Fast route E2E green (`tests/e2e/audio-convert.spec.ts`).
- Gated correctness E2E green: 16/16 conversions pass (`RUN_AUDIO_CONVERT_CORRECTNESS=1`).
- Privacy-regression E2E green (zero off-origin requests during conversion).
- Manual smoke: 16 conversions verified end-to-end on dev box.

## Test plan
- [x] `pnpm typecheck` clean
- [x] `pnpm lint` clean
- [x] `pnpm test` all green
- [x] `pnpm test:e2e tests/e2e/audio-convert.spec.ts` green
- [x] `RUN_AUDIO_CONVERT_CORRECTNESS=1 pnpm test:e2e tests/e2e/audio-convert-correctness.spec.ts` green
- [x] `pnpm test:e2e tests/e2e/privacy-regression-audio-convert.spec.ts` green
- [x] `pnpm build` + postbuild bundle-isolation green
- [x] Manual smoke on all 16 conversions
- [x] Manual privacy demo (DevTools Network panel)
EOF
)"
```

---

## Self-review checklist (post-plan)

- [ ] **Spec §2.1 covered:** `_shared/ffmpeg/` module created in Task 2 with `loadFfmpeg()` cached singleton, `FFmpegProgress` type, dynamic-import boundary. Same-origin URLs pinned. ✅
- [ ] **Spec §3.1 (audio-convert) covered:** all four formats, bitrate option for lossy only with default 192 kbps, validation by extension+MIME, 500 MB cap. ✅
- [ ] **Spec §11 item 2 covered:** ffmpeg infra + first ffmpeg-using engine + bundle-isolation extension (auto-discovered) + sidebar entry + correctness + privacy E2E. ✅
- [ ] **Privacy invariant:** Task 12.5 + 14.7 explicitly verify zero off-origin during conversion. ffmpeg's `coreURL`/`wasmURL` pinned to same-origin in Task 2. ✅
- [ ] **Bundle isolation:** Task 14.4 verifies; Task 2 architects via `await import()` boundary; Task 1.3 makes ffmpeg-core part of the public/ tree (not a runtime fetch). ✅
- [ ] **No COOP/COEP entanglement:** Task 1.2 explicitly notes "Single-threaded UMD build; multi-threaded deferred to Phase 21." Task 5 worker uses no `SharedArrayBuffer`. ✅
- [ ] **8 GB dev box discipline:** Task 14.3 surfaces the `--poolOptions.threads.maxThreads=2` escape hatch; the plan doesn't ask for parallel terminal runs. ✅
- [ ] **Branch discipline:** Task 14.8 explicitly notes feature-branch requirement; no step in the plan invokes `git branch -m/-M` or `git checkout`. ✅
- [ ] **TDD pattern:** Tasks 2, 4, 6, 7 follow write-test → fail → implement → pass. Task 5 (worker) is integration-tested via Task 12 instead of unit-tested (rationale documented in Task 5 preamble). ✅
- [ ] **Type consistency:** `AudioConvertOptions` (options.ts) flows through worker, descriptor, OptionsPanel, registry, and tests. `EngineId` registry update pairs with `category: "audio"` engine entry. ✅
- [ ] **No placeholders:** every step has actual commands, actual code blocks, or specific instructions to read existing files for reference. The one referenced lookup ("read the existing privacy-regression spec to align") is itself an executable instruction. ✅
- [ ] **Independent of Phase 18:** zero file overlap. Phase 18 touches `src/engines/image-bg-remove/`, `tests/fixtures/bg-remove/`, `scripts/bg-models-manifest.json`, `tests/e2e/image-bg-remove*`. Phase 19 touches none of these. The two phases can land in either order. ✅
