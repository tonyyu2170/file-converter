# Phase 22 — `video-trim` + `video-extract-audio` + trim-scrubber video render path — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v2 video pair (`video-trim`, `video-extract-audio`) and complete the trim-scrubber by lighting up its `modality: "video"` render path. Both engines run inside a single shared engine worker that hosts ffmpeg, the codec/duration probe, and (for `video-trim` only) the frame-strip extractor.

**Architecture:** Two new shared utilities — `_shared/ffmpeg/probe.ts` (worker-only `probeWithFfmpeg`) and `_shared/trim-scrubber/frame-strip.ts` (worker-only `extractFrameStripInWorker`) — are exposed as optional Comlink RPCs (`probe?`, `extractFrameStrip?`) on `WorkerEntry`. `WorkerHarness` gains `runProbe(file)` and `runExtractFrameStrip({ file, count, heightPx })` runners that mirror Phase 20's `runDecodePeaks` and add main-thread caching/object-URL conversion. The trim-scrubber `modality: "video"` branch calls those harness methods and renders an adaptive-count flex-row of `<img>` thumbnails (60px tall, `object-fit: cover` in 80px slots). Audio format helpers (`OUTPUT_MIME`/`OUTPUT_EXTENSION`/`isLossy`/bitrates) are promoted from `audio-convert/options.ts` to `_shared/audio/format.ts` with zero behavior change.

**Tech Stack:** React 19, Tailwind, `@ffmpeg/ffmpeg` v0.12+ (Phase 19), `@ffmpeg/core{,-mt}` (Phase 21), Comlink, Vitest + React Testing Library, Playwright. No new runtime dependencies.

**Hard constraints:**
- **Single ffmpeg load per video page.** `probeWithFfmpeg` and `extractFrameStripInWorker` MUST run inside the engine worker on the same `loadFfmpeg()` singleton that the conversion will use. Calling `loadFfmpeg()` from the main thread (or from any code path the OptionsPanel imports synchronously) doubles WASM cost — the same constraint Phase 20 §2.5b enforced for `decodePeaks`.
- **No off-origin fetches.** `tests/e2e/privacy-regression-*.spec.ts` must continue to pass unchanged. Both engines use only `loadFfmpeg()` (which serves `/ffmpeg/{mt,st}/`) — no `fetch`, no `XMLHttpRequest` inside `src/engines/`.
- **Bundle isolation.** Both new engines auto-enroll via `scripts/check-bundle-isolation.mjs`. The shared modules (`probe.ts`, `frame-strip.ts`, `codec-compat.ts`, `format.ts`) MUST NOT be statically imported from the homepage. `_shared/trim-scrubber/index.tsx` may import `frame-strip.ts` only as a type-level dependency for the worker-only function signature; runtime use is via the harness RPC.
- **Audio engines untouched in behavior.** Promoting `_shared/audio/format.ts` is a zero-behavior-change refactor. All existing `audio-trim`, `audio-convert`, and any harness/registry tests must pass without modification (other than import-path updates).
- **Branch discipline (per project memory `feedback_branch_discipline`).** This plan executes on the existing branch `phase-22-video-trim-and-extract-audio`. Implementer subagents must NOT run `git branch -m/-M` or `git checkout <branch>`. Verify before each commit: `git rev-parse --abbrev-ref HEAD` prints `phase-22-video-trim-and-extract-audio`.
- **No Claude attribution in commit messages** (per project memory `feedback_no_claude_in_commits`). No `Co-Authored-By: Claude`, no "Generated with Claude Code" footers. Body lines stay under 72 characters. Always `git commit` (never `--amend`, never `--no-verify`).
- **8 GB dev box discipline (per project memory `feedback_low_ram_dev_box`).** Run `pnpm test` and `pnpm test:e2e` serially. If memory pressure shows up, cap vitest workers via `--pool=threads --poolOptions.threads.maxThreads=2`.

**Source spec:** `docs/superpowers/specs/2026-05-07-phase-22-video-trim-and-extract-audio-design.md` (approved 2026-05-07).

**Out of scope (this phase):**
- `video-convert` engine (separate Phase).
- Re-encode trim mode (`precise` toggle for `video-trim`).
- Cancel button mid-conversion.
- File-card metadata display (codec / resolution as text).
- Frame-strip re-extraction on browser resize.
- Video preview / scrubber play-through.

---

## File map

**Created:**

| Path | Responsibility |
|---|---|
| `src/engines/_shared/audio/format.ts` | Promoted from `audio-convert/options.ts`: `AudioFormat`, `OUTPUT_MIME`, `OUTPUT_EXTENSION`, `AUDIO_FORMAT_LOSSY`, `isLossy`, `AudioBitrate`, `AUDIO_BITRATE_OPTIONS`. |
| `src/engines/_shared/audio/format.test.ts` | Pure-data tests for the promoted maps. |
| `src/engines/_shared/ffmpeg/probe.ts` | `probeWithFfmpeg(ff, bytes, ext)` — worker-only stderr-parsing probe. |
| `src/engines/_shared/ffmpeg/probe.test.ts` | Drives `probeWithFfmpeg` against each fixture with a freshly-loaded ffmpeg. MEMFS leak check. |
| `src/engines/_shared/ffmpeg/codec-compat.ts` | `CONTAINER_CODECS` table + `containerSupportsCodecs(container, video, audio)` pure function. |
| `src/engines/_shared/ffmpeg/codec-compat.test.ts` | Pure-data tests. |
| `src/engines/_shared/trim-scrubber/frame-strip.ts` | `extractFrameStripInWorker(args)` — worker-only, returns `{ frames: Uint8Array[]; widthPx: number }`. |
| `src/engines/_shared/trim-scrubber/frame-strip.test.ts` | Drives `extractFrameStripInWorker` against `sample-h264-aac.mp4`. JPEG magic-byte assertion. |
| `src/engines/video-trim/index.ts` | Engine descriptor (`SingleInputEngine`), persistent harness factory, `disposeVideoTrimHarness`. |
| `src/engines/video-trim/index.test.ts` | Engine validation + conversion correctness tests. |
| `src/engines/video-trim/options.ts` | `VideoTrimOptions`, `VIDEO_TRIM_CONTAINERS`, defaults, `outputExtensionFor`/`outputMimeFor`, re-export of `containerSupportsCodecs`. |
| `src/engines/video-trim/options.test.ts` | Option-shape unit tests. |
| `src/engines/video-trim/options-panel.tsx` | OptionsPanel: container `<select>` + TrimScrubber (`modality: "video"`) + duration probe + harness-backed probe lookup. |
| `src/engines/video-trim/options-panel.test.tsx` | OptionsPanel render + interaction tests with mocked harness. |
| `src/engines/video-trim/worker.ts` | Comlink-exposed worker; implements `convertSingle` + `probe` + `extractFrameStrip`. |
| `src/engines/video-extract-audio/index.ts` | Engine descriptor, persistent harness factory, `disposeVideoExtractAudioHarness`. |
| `src/engines/video-extract-audio/index.test.ts` | Engine validation + conversion correctness tests. |
| `src/engines/video-extract-audio/options.ts` | `VideoExtractAudioOptions` (re-uses `_shared/audio/format`), defaults. |
| `src/engines/video-extract-audio/options.test.ts` | Option-shape unit tests. |
| `src/engines/video-extract-audio/options-panel.tsx` | OptionsPanel: format `<select>` + (conditional) bitrate `<select>`. No scrubber. |
| `src/engines/video-extract-audio/options-panel.test.tsx` | OptionsPanel render + interaction tests. |
| `src/engines/video-extract-audio/worker.ts` | Comlink-exposed worker; implements `convertSingle` + `probe` (no `extractFrameStrip`). |
| `src/app/tools/video-trim/page.tsx` | `<ToolFrame engine={engine} />` + dispose effect. |
| `src/app/tools/video-extract-audio/page.tsx` | `<ToolFrame engine={engine} />` + dispose effect. |
| `tests/e2e/video-trim.spec.ts` | Route + UI E2E (no real conversion in default suite). |
| `tests/e2e/video-trim-correctness.spec.ts` | Real-conversion E2E (gated by `RUN_VIDEO_TRIM_CORRECTNESS=1`). |
| `tests/e2e/video-extract-audio.spec.ts` | Route + UI E2E. |
| `tests/e2e/video-extract-audio-correctness.spec.ts` | Real-conversion E2E (gated by `RUN_VIDEO_EXTRACT_AUDIO_CORRECTNESS=1`). |
| `tests/e2e/privacy-regression-video-trim.spec.ts` | Zero off-origin assertion during a real video-trim. |
| `tests/fixtures/video/sample-h264-aac.mp4` | H.264 + AAC, 320x180, 5s. |
| `tests/fixtures/video/sample-vp9-opus.webm` | VP9 + Opus, 320x180, 5s. |
| `tests/fixtures/video/sample-h264.mov` | H.264 + AAC in MOV, 320x180, 5s. |
| `tests/fixtures/video/sample-hevc-aac.mkv` | H.265 + AAC in MKV, 320x180, 5s. |
| `tests/fixtures/video/sample-no-audio.mp4` | H.264, no audio, 320x180, 3s. |
| `tests/fixtures/video/SOURCES.md` | Reproducible regeneration commands (mirrors `tests/fixtures/audio/SOURCES.md`). |

**Modified:**

| Path | Change |
|---|---|
| `src/engines/_shared/harness.ts` | Add optional `probe?` + `extractFrameStrip?` to `WorkerEntry`. Add `runProbe(file)` and `runExtractFrameStrip({ file, count, heightPx })` methods to `WorkerHarness`. `runProbe` caches `Promise<ProbeResult>` in a `WeakMap<File, ...>`. |
| `src/engines/_shared/harness.test.ts` | Add cases for `runProbe` (happy path, cache identity, missing-RPC throws) and `runExtractFrameStrip` (happy path, builds object URLs from returned bytes, missing-RPC throws). |
| `src/engines/_shared/trim-scrubber/index.tsx` | Replace the `modality === "video"` throw with a working render branch (probe → extract → render `<img>` row in fixed slots; revoke URLs on unmount). |
| `src/engines/_shared/trim-scrubber/index.test.tsx` | Add video-modality test cases that mock the new harness methods. |
| `src/engines/_shared/trim-scrubber/duration.ts` | Replace `modality === "video"` throw with a `<video>` branch identical in shape to the audio branch (with `Infinity`/`NaN` fallback flagged in tests). |
| `src/engines/_shared/trim-scrubber/duration.test.ts` | Replace the "video throws" assertion with a passing video-duration test (uses synthesized fixture in Task 0). |
| `src/engines/audio-convert/options.ts` | Re-export `OUTPUT_MIME`, `OUTPUT_EXTENSION`, `AUDIO_FORMAT_LOSSY`, `isLossy`, `AudioBitrate`, `AUDIO_BITRATE_OPTIONS` from `_shared/audio/format`. Keep `AudioConvertFormat`, `AudioConvertOptions`, `defaultAudioConvertOptions` as engine-specific re-exports/wrappers. |
| `src/engines/audio-trim/options.ts` | Update import path from `@/engines/audio-convert/options` to `@/engines/_shared/audio/format`. |
| `src/engines/_shared/registry.ts` | Add `"video-trim"` and `"video-extract-audio"` to `EngineId` union and `REGISTRY` map. |
| `src/components/layout/sidebar.tsx` | Add `video-trim` and `video-extract-audio` entries under a new `VIDEO` group; append `VIDEO` to `GROUP_ORDER` between `AUDIO` and `ABOUT`. |
| `src/app/page.tsx` | Append `video-trim` and `video-extract-audio` to `TOOLS`. |
| `tests/e2e/coop-coep.spec.ts` | Append `/tools/video-trim` and `/tools/video-extract-audio` to `TOOL_ROUTES`. Remove the stale comment about Phase 20 audio-trim rebase. |

**Untouched (verify zero edits in this phase's diff):**
- `src/engines/_shared/ffmpeg/index.ts` (Phase 21 surface).
- `vercel.json`, `package.json`, `pnpm-lock.yaml`, `next.config.ts`, `scripts/copy-ffmpeg-core.mjs`, `scripts/ffmpeg-manifest.json`.
- All other engines under `src/engines/<id>/` (image-*, pdf-*, docx-*, txt-to-pdf, markdown-to-pdf).

---

## Task 0: Generate and commit video fixtures

**Why:** Every subsequent task needs at least one of the five fixtures. Land them first so the test files in later tasks can reference real bytes from the very first failing test.

**Files:**
- Create: `tests/fixtures/video/sample-h264-aac.mp4`
- Create: `tests/fixtures/video/sample-vp9-opus.webm`
- Create: `tests/fixtures/video/sample-h264.mov`
- Create: `tests/fixtures/video/sample-hevc-aac.mkv`
- Create: `tests/fixtures/video/sample-no-audio.mp4`
- Create: `tests/fixtures/video/SOURCES.md`

- [ ] **Step 0.1: Verify branch and clean tree.**

```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

Expected: branch is `phase-22-video-trim-and-extract-audio`; tree is clean. If the branch is wrong, STOP and ask the user — do not run any `git checkout` or `git branch -m/-M` (per branch discipline rule).

- [ ] **Step 0.2: Verify host `ffmpeg` is available with the codecs we need.**

```bash
ffmpeg -version | head -1
ffmpeg -hide_banner -encoders 2>&1 | grep -E '(libx264|libx265|libvpx-vp9|aac|libopus)' | head -20
```

Expected: `ffmpeg version` line prints, and the second command lists at least `libx264`, `libx265`, `libvpx-vp9`, `aac`, and `libopus` (one per line, possibly with codec-id prefix). If any are missing, STOP and ask the user — fixture generation needs all five.

- [ ] **Step 0.3: Create the fixtures directory and generate the five fixtures.**

```bash
mkdir -p tests/fixtures/video
cd tests/fixtures/video

# H.264 + AAC, 320x180, 5s, MP4 — the mainstream case.
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i 'testsrc=duration=5:size=320x180:rate=30' \
  -f lavfi -i 'sine=frequency=440:duration=5' \
  -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p \
  -c:a aac -b:a 96k \
  -movflags +faststart \
  sample-h264-aac.mp4

# VP9 + Opus, 320x180, 5s, WebM — exercises codec-incompat for MP4 container.
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i 'testsrc=duration=5:size=320x180:rate=30' \
  -f lavfi -i 'sine=frequency=523:duration=5' \
  -c:v libvpx-vp9 -b:v 200k -row-mt 1 \
  -c:a libopus -b:a 64k \
  sample-vp9-opus.webm

# H.264 + AAC in MOV (iPhone-style).
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i 'testsrc=duration=5:size=320x180:rate=30' \
  -f lavfi -i 'sine=frequency=349:duration=5' \
  -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p \
  -c:a aac -b:a 96k \
  sample-h264.mov

# H.265 + AAC in MKV — exercises cross-container into MP4.
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i 'testsrc=duration=5:size=320x180:rate=30' \
  -f lavfi -i 'sine=frequency=659:duration=5' \
  -c:v libx265 -preset veryfast -crf 30 -pix_fmt yuv420p -tag:v hvc1 \
  -c:a aac -b:a 96k \
  sample-hevc-aac.mkv

# H.264 only, no audio, 3s — exercises no-audio rejection in extract-audio.
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i 'testsrc=duration=3:size=320x180:rate=30' \
  -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p \
  -an \
  sample-no-audio.mp4

cd ../../..
ls -lh tests/fixtures/video/
```

Expected: 5 files printed, each under 200 KB. If any file exceeds 1 MB, raise `-crf` (lossier) until it's under the limit — committed fixtures must stay small per CLAUDE.md.

- [ ] **Step 0.4: Sanity-probe each fixture with `ffmpeg -i` to confirm codecs and durations.**

```bash
for f in tests/fixtures/video/*.{mp4,mov,webm,mkv}; do
  echo "=== $f ==="
  ffmpeg -hide_banner -i "$f" 2>&1 | grep -E 'Duration|Stream' | head -5
done
```

Expected: each file shows `Duration: 00:00:05.0X` (5s) or `00:00:03.0X` (no-audio MP4). Stream lines show the codecs we generated:
- `sample-h264-aac.mp4` → `Video: h264`, `Audio: aac`
- `sample-vp9-opus.webm` → `Video: vp9`, `Audio: opus`
- `sample-h264.mov` → `Video: h264`, `Audio: aac`
- `sample-hevc-aac.mkv` → `Video: hevc`, `Audio: aac`
- `sample-no-audio.mp4` → `Video: h264`, no `Audio:` line

If any fixture's codec doesn't match the expectation, regenerate it (host ffmpeg may have selected a different default — pin via `-c:v`/`-c:a` more strictly).

- [ ] **Step 0.5: Write `SOURCES.md` with the regeneration recipe.**

Write `tests/fixtures/video/SOURCES.md` with this content:

```markdown
# Video fixtures — sources

All five fixtures are synthesized from `lavfi`'s `testsrc` (color-bar pattern)
and `sine` (single-frequency tone) generators. No external sources, no
copyright considerations. Each is under 1 MB per CLAUDE.md committed-fixture
rule.

To regenerate from scratch on a machine with ffmpeg + libx264 + libx265 +
libvpx-vp9 + aac + libopus:

```bash
cd tests/fixtures/video
# (paste the five ffmpeg commands from Phase 22 plan Task 0 Step 0.3)
```

Used by:

- `src/engines/_shared/ffmpeg/probe.test.ts`
- `src/engines/_shared/trim-scrubber/frame-strip.test.ts`
- `src/engines/video-trim/index.test.ts`
- `src/engines/video-extract-audio/index.test.ts`
- `tests/e2e/video-trim-correctness.spec.ts`
- `tests/e2e/video-extract-audio-correctness.spec.ts`
- `tests/e2e/privacy-regression-video-trim.spec.ts`
```

- [ ] **Step 0.6: Commit fixtures.**

```bash
git add tests/fixtures/video/
git commit -m "$(cat <<'EOF'
test(phase-22): video fixtures for trim + extract-audio

Five lavfi-synthesized clips covering the codec/container matrix
the new engines need to validate (H.264/AAC/MP4, VP9/Opus/WebM,
H.264/AAC/MOV, H.265/AAC/MKV, no-audio MP4). All under 1 MB each;
SOURCES.md captures the regeneration recipe.
EOF
)"
```

Expected: commit lands on `phase-22-video-trim-and-extract-audio`. `git status` is clean.

---

## Task 1: Promote audio format helpers to `_shared/audio/format.ts`

**Why:** `video-extract-audio` reuses the `OUTPUT_MIME`/`OUTPUT_EXTENSION`/`isLossy`/bitrate helpers that currently live in `audio-convert/options.ts`. Pulling them into a shared module keeps the new engine from import-coupling to a sibling engine. Zero behavior change — every existing test must pass with no rewrite.

**Files:**
- Create: `src/engines/_shared/audio/format.ts`
- Create: `src/engines/_shared/audio/format.test.ts`
- Modify: `src/engines/audio-convert/options.ts`
- Modify: `src/engines/audio-trim/options.ts`

- [ ] **Step 1.1: Write `_shared/audio/format.ts`.**

```typescript
// src/engines/_shared/audio/format.ts
//
// Shared audio-format metadata for engines that re-encode audio
// (audio-convert, audio-trim, video-extract-audio). Pure data + pure
// helpers — no runtime dependencies.

export type AudioFormat = "mp3" | "wav" | "m4a" | "flac";
export type AudioBitrate = 64 | 128 | 192 | 256 | 320;

export const OUTPUT_MIME: Record<AudioFormat, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  flac: "audio/flac",
};

export const OUTPUT_EXTENSION: Record<AudioFormat, string> = {
  mp3: "mp3",
  wav: "wav",
  m4a: "m4a",
  flac: "flac",
};

export const AUDIO_FORMAT_LOSSY: Record<AudioFormat, boolean> = {
  mp3: true,
  m4a: true,
  wav: false,
  flac: false,
};

export const AUDIO_BITRATE_OPTIONS: ReadonlyArray<AudioBitrate> = [
  64, 128, 192, 256, 320,
];

export function isLossy(fmt: AudioFormat): boolean {
  return AUDIO_FORMAT_LOSSY[fmt];
}
```

- [ ] **Step 1.2: Write `_shared/audio/format.test.ts`.**

```typescript
// src/engines/_shared/audio/format.test.ts
import { describe, expect, it } from "vitest";
import {
  AUDIO_BITRATE_OPTIONS,
  AUDIO_FORMAT_LOSSY,
  isLossy,
  OUTPUT_EXTENSION,
  OUTPUT_MIME,
} from "./format";

describe("_shared/audio/format", () => {
  it("OUTPUT_MIME covers every AudioFormat", () => {
    expect(Object.keys(OUTPUT_MIME).sort()).toEqual(["flac", "m4a", "mp3", "wav"]);
  });

  it("OUTPUT_EXTENSION matches OUTPUT_MIME keys", () => {
    expect(Object.keys(OUTPUT_EXTENSION).sort()).toEqual(Object.keys(OUTPUT_MIME).sort());
  });

  it("AUDIO_FORMAT_LOSSY classifies mp3 and m4a as lossy, wav and flac as lossless", () => {
    expect(AUDIO_FORMAT_LOSSY).toEqual({ mp3: true, m4a: true, wav: false, flac: false });
  });

  it("isLossy mirrors the table", () => {
    expect(isLossy("mp3")).toBe(true);
    expect(isLossy("m4a")).toBe(true);
    expect(isLossy("wav")).toBe(false);
    expect(isLossy("flac")).toBe(false);
  });

  it("AUDIO_BITRATE_OPTIONS lists the supported MP3/AAC bitrates ascending", () => {
    expect(AUDIO_BITRATE_OPTIONS).toEqual([64, 128, 192, 256, 320]);
  });
});
```

- [ ] **Step 1.3: Rewrite `src/engines/audio-convert/options.ts` to re-export from the shared module.**

Replace the file's contents with:

```typescript
// src/engines/audio-convert/options.ts
//
// Engine-specific options shape. Format helpers live in
// `_shared/audio/format` and are re-exported here so existing callers
// that imported from this path keep working.

import type { AudioBitrate, AudioFormat } from "@/engines/_shared/audio/format";

export {
  AUDIO_BITRATE_OPTIONS,
  AUDIO_FORMAT_LOSSY,
  isLossy,
  OUTPUT_EXTENSION,
  OUTPUT_MIME,
  type AudioBitrate,
  type AudioFormat,
} from "@/engines/_shared/audio/format";

// audio-convert names its format type with a nullable null sentinel for
// "user has not picked yet". Keep the alias so engine code reads naturally.
export type AudioConvertFormat = AudioFormat;

export type AudioConvertOptions = {
  outputFormat: AudioConvertFormat | null;
  bitrate: AudioBitrate;
};

export const defaultAudioConvertOptions: AudioConvertOptions = {
  outputFormat: null,
  bitrate: 192,
};
```

- [ ] **Step 1.4: Update `src/engines/audio-trim/options.ts` import path.**

Change line 1 from:

```typescript
import { OUTPUT_EXTENSION, OUTPUT_MIME } from "@/engines/audio-convert/options";
```

to:

```typescript
import { OUTPUT_EXTENSION, OUTPUT_MIME } from "@/engines/_shared/audio/format";
```

Leave every other line in `audio-trim/options.ts` untouched.

- [ ] **Step 1.5: Run the new test plus every existing audio engine test.**

```bash
pnpm test src/engines/_shared/audio/format.test.ts \
          src/engines/audio-convert \
          src/engines/audio-trim
```

Expected: every test passes. `_shared/audio/format.test.ts` adds 5 passing cases; existing `audio-convert/options.test.ts` and `audio-trim/options.test.ts` continue to pass with zero rewrites (they test the same exported names — only the source file moved).

If any audio-engine test fails, the refactor leaked behavior. Inspect the failure, fix the import path or the re-export shape, and re-run. DO NOT modify the failing test to suit the refactor.

- [ ] **Step 1.6: Run typecheck to catch any consumer that imported from the moved location.**

```bash
pnpm typecheck
```

Expected: zero errors. If something else imported `OUTPUT_MIME`/`OUTPUT_EXTENSION`/`isLossy`/`AudioBitrate`/`AUDIO_BITRATE_OPTIONS` from `@/engines/audio-convert/options`, the re-exports added in Step 1.3 keep those imports working — but if a consumer imported a non-re-exported symbol, fix it by adding the symbol to the re-export list in `audio-convert/options.ts`.

- [ ] **Step 1.7: Commit.**

```bash
git add src/engines/_shared/audio/ \
        src/engines/audio-convert/options.ts \
        src/engines/audio-trim/options.ts
git commit -m "$(cat <<'EOF'
refactor(phase-22): promote audio format helpers to _shared/audio

Pull OUTPUT_MIME / OUTPUT_EXTENSION / AUDIO_FORMAT_LOSSY / isLossy /
AudioBitrate / AUDIO_BITRATE_OPTIONS out of audio-convert/options.ts
into _shared/audio/format.ts so video-extract-audio can consume them
without depending on a sibling engine. audio-convert re-exports them
to preserve the public surface; audio-trim updates its import path.
Zero behavior change — existing tests pass without rewrites.
EOF
)"
```

Expected: commit lands. `git status` clean.

---

## Task 2: Add `_shared/ffmpeg/codec-compat.ts`

**Why:** `video-trim/options-panel.tsx` needs to compute disabled-state per container option synchronously from probe data. Pure data + pure function; testable without ffmpeg.

**Files:**
- Create: `src/engines/_shared/ffmpeg/codec-compat.ts`
- Create: `src/engines/_shared/ffmpeg/codec-compat.test.ts`

- [ ] **Step 2.1: Write the failing test first.**

```typescript
// src/engines/_shared/ffmpeg/codec-compat.test.ts
import { describe, expect, it } from "vitest";
import { containerSupportsCodecs } from "./codec-compat";

describe("containerSupportsCodecs", () => {
  it("\"same\" is always supported", () => {
    expect(containerSupportsCodecs("same", "vp9", "opus")).toBe(true);
    expect(containerSupportsCodecs("same", null, null)).toBe(true);
    expect(containerSupportsCodecs("same", "anything", "weird")).toBe(true);
  });

  it("MKV accepts everything", () => {
    expect(containerSupportsCodecs("mkv", "vp9", "opus")).toBe(true);
    expect(containerSupportsCodecs("mkv", "h264", "aac")).toBe(true);
    expect(containerSupportsCodecs("mkv", "ac3", null)).toBe(true);
  });

  it("MP4 accepts H.264/HEVC/AV1 video and AAC/MP3 audio", () => {
    expect(containerSupportsCodecs("mp4", "h264", "aac")).toBe(true);
    expect(containerSupportsCodecs("mp4", "hevc", "mp3")).toBe(true);
    expect(containerSupportsCodecs("mp4", "av1", "aac")).toBe(true);
  });

  it("MP4 rejects VP9 video and Opus audio", () => {
    expect(containerSupportsCodecs("mp4", "vp9", "aac")).toBe(false);
    expect(containerSupportsCodecs("mp4", "h264", "opus")).toBe(false);
    expect(containerSupportsCodecs("mp4", "vp9", "opus")).toBe(false);
  });

  it("WebM accepts VP8/VP9/AV1 video and Opus/Vorbis audio", () => {
    expect(containerSupportsCodecs("webm", "vp9", "opus")).toBe(true);
    expect(containerSupportsCodecs("webm", "vp8", "vorbis")).toBe(true);
    expect(containerSupportsCodecs("webm", "av1", "opus")).toBe(true);
  });

  it("WebM rejects H.264 video and AAC audio", () => {
    expect(containerSupportsCodecs("webm", "h264", "opus")).toBe(false);
    expect(containerSupportsCodecs("webm", "vp9", "aac")).toBe(false);
  });

  it("null codec on either side is treated as no constraint", () => {
    expect(containerSupportsCodecs("mp4", null, "aac")).toBe(true);   // no video stream
    expect(containerSupportsCodecs("mp4", "h264", null)).toBe(true);  // no audio stream
    expect(containerSupportsCodecs("webm", null, null)).toBe(true);
  });
});
```

- [ ] **Step 2.2: Run the test to confirm it fails.**

```bash
pnpm test src/engines/_shared/ffmpeg/codec-compat.test.ts
```

Expected: FAIL — module not found / `containerSupportsCodecs is not defined`.

- [ ] **Step 2.3: Implement `codec-compat.ts`.**

```typescript
// src/engines/_shared/ffmpeg/codec-compat.ts
//
// Container/codec compatibility for the video-trim engine's container
// dropdown. Used to disable container choices that the source's codecs
// don't fit, before the user clicks Convert.
//
// "same" is always allowed (the engine will preserve the source container).
// "mkv" is always allowed (Matroska is a permissive catch-all).
// "mp4" and "webm" enforce the container's codec compatibility.

export type Container = "mp4" | "webm" | "mkv";
export type ContainerOrSame = Container | "same";

export const CONTAINER_CODECS: Record<Container, { video: string[]; audio: string[] } | null> = {
  mp4: { video: ["h264", "hevc", "av1"], audio: ["aac", "mp3"] },
  webm: { video: ["vp8", "vp9", "av1"], audio: ["opus", "vorbis"] },
  mkv: null, // accepts anything
};

export function containerSupportsCodecs(
  container: ContainerOrSame,
  videoCodec: string | null,
  audioCodec: string | null,
): boolean {
  if (container === "same") return true;
  const allowed = CONTAINER_CODECS[container];
  if (allowed === null) return true; // mkv
  if (videoCodec !== null && !allowed.video.includes(videoCodec)) return false;
  if (audioCodec !== null && !allowed.audio.includes(audioCodec)) return false;
  return true;
}
```

- [ ] **Step 2.4: Run the test to confirm it passes.**

```bash
pnpm test src/engines/_shared/ffmpeg/codec-compat.test.ts
```

Expected: PASS — 7 cases.

- [ ] **Step 2.5: Commit.**

```bash
git add src/engines/_shared/ffmpeg/codec-compat.ts \
        src/engines/_shared/ffmpeg/codec-compat.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-22): _shared/ffmpeg/codec-compat for video-trim dropdown

CONTAINER_CODECS table + containerSupportsCodecs pure function.
"same" is always supported, "mkv" accepts anything, "mp4" and "webm"
enforce per-container codec lists. video-trim's options-panel uses
this to disable incompatible container choices before the user
clicks Convert.
EOF
)"
```

---

## Task 3: Add `_shared/ffmpeg/probe.ts`

**Why:** Both video engines and the trim-scrubber video branch need codec/duration/dimensions before deciding what to render. Single source of truth for parsing ffmpeg's stderr stream/duration lines, runs in the engine worker.

**Files:**
- Create: `src/engines/_shared/ffmpeg/probe.ts`
- Create: `src/engines/_shared/ffmpeg/probe.test.ts`

- [ ] **Step 3.1: Write the failing test first.**

```typescript
// src/engines/_shared/ffmpeg/probe.test.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { __resetForTests, loadFfmpeg } from "../ffmpeg";
import { probeWithFfmpeg } from "./probe";

const FIXTURES_DIR = path.resolve(__dirname, "../../../../tests/fixtures/video");

function readFixture(name: string): { bytes: ArrayBuffer; ext: string } {
  const buf = readFileSync(path.join(FIXTURES_DIR, name));
  const ext = `.${name.split(".").pop()}`;
  // Slice into a fresh ArrayBuffer so tests don't share underlying storage
  // with Node's Buffer pool — the worker code path treats `bytes` as opaque.
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return { bytes: ab, ext };
}

afterEach(() => {
  __resetForTests();
});

describe("probeWithFfmpeg", () => {
  it("probes H.264/AAC MP4 — codecs, dimensions, duration", async () => {
    const ff = await loadFfmpeg();
    const { bytes, ext } = readFixture("sample-h264-aac.mp4");
    const probe = await probeWithFfmpeg(ff, bytes, ext);
    expect(probe.videoCodec).toBe("h264");
    expect(probe.audioCodec).toBe("aac");
    expect(probe.hasAudio).toBe(true);
    expect(probe.width).toBe(320);
    expect(probe.height).toBe(180);
    expect(probe.durationSec).toBeGreaterThan(4.9);
    expect(probe.durationSec).toBeLessThan(5.1);
  }, 30_000);

  it("probes VP9/Opus WebM", async () => {
    const ff = await loadFfmpeg();
    const { bytes, ext } = readFixture("sample-vp9-opus.webm");
    const probe = await probeWithFfmpeg(ff, bytes, ext);
    expect(probe.videoCodec).toBe("vp9");
    expect(probe.audioCodec).toBe("opus");
    expect(probe.hasAudio).toBe(true);
  }, 30_000);

  it("probes H.264 MOV", async () => {
    const ff = await loadFfmpeg();
    const { bytes, ext } = readFixture("sample-h264.mov");
    const probe = await probeWithFfmpeg(ff, bytes, ext);
    expect(probe.videoCodec).toBe("h264");
    expect(probe.audioCodec).toBe("aac");
  }, 30_000);

  it("probes HEVC/AAC MKV", async () => {
    const ff = await loadFfmpeg();
    const { bytes, ext } = readFixture("sample-hevc-aac.mkv");
    const probe = await probeWithFfmpeg(ff, bytes, ext);
    expect(probe.videoCodec).toBe("hevc");
    expect(probe.audioCodec).toBe("aac");
  }, 30_000);

  it("reports hasAudio=false when there's no audio stream", async () => {
    const ff = await loadFfmpeg();
    const { bytes, ext } = readFixture("sample-no-audio.mp4");
    const probe = await probeWithFfmpeg(ff, bytes, ext);
    expect(probe.videoCodec).toBe("h264");
    expect(probe.audioCodec).toBeNull();
    expect(probe.hasAudio).toBe(false);
  }, 30_000);

  it("cleans up MEMFS — repeated probes do not accumulate files", async () => {
    const ff = await loadFfmpeg();
    const { bytes, ext } = readFixture("sample-h264-aac.mp4");
    const baseline = (await ff.listDir("/")).length;
    for (let i = 0; i < 3; i++) {
      await probeWithFfmpeg(ff, bytes, ext);
    }
    const after = (await ff.listDir("/")).length;
    expect(after).toBe(baseline);
  }, 60_000);
});
```

- [ ] **Step 3.2: Run the test to confirm it fails.**

```bash
pnpm test src/engines/_shared/ffmpeg/probe.test.ts
```

Expected: FAIL — module not found / `probeWithFfmpeg is not defined`.

- [ ] **Step 3.3: Implement `probe.ts`.**

```typescript
// src/engines/_shared/ffmpeg/probe.ts
//
// Worker-only ffmpeg probe. Takes an already-loaded ffmpeg instance and
// returns codec/duration/dimensions parsed from ffmpeg's stderr stream
// info lines. Callers spawn the engine worker via WorkerHarness, which
// in turn calls runProbe → the worker's `probe` RPC → this function.
//
// Does NOT call loadFfmpeg() — see Phase 20 §2.5b for the rationale.
// Caller is the worker's own `probe` RPC handler.

import type { FFmpeg as FFmpegType, LogEvent } from "@ffmpeg/ffmpeg";

export type ProbeResult = {
  durationSec: number;
  videoCodec: string | null;
  audioCodec: string | null;
  width: number;
  height: number;
  hasAudio: boolean;
};

const DURATION_RE = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/;
const VIDEO_STREAM_RE =
  /Stream\s+#\d+:\d+(?:\([^)]*\))?(?:\[[^\]]*\])?:\s*Video:\s*([a-z0-9_]+)[^\n]*?(\d{2,5})x(\d{2,5})/i;
const AUDIO_STREAM_RE = /Stream\s+#\d+:\d+(?:\([^)]*\))?(?:\[[^\]]*\])?:\s*Audio:\s*([a-z0-9_]+)/i;

export async function probeWithFfmpeg(
  ff: FFmpegType,
  fileBytes: ArrayBuffer,
  fileExtension: string,
): Promise<ProbeResult> {
  const ext = fileExtension.startsWith(".") ? fileExtension : `.${fileExtension || "bin"}`;
  const id = crypto.randomUUID();
  const inName = `probe_${id}${ext}`;

  const lines: string[] = [];
  const onLog = (e: LogEvent) => {
    lines.push(e.message);
  };
  ff.on("log", onLog);

  try {
    await ff.writeFile(inName, new Uint8Array(fileBytes));
    // ffmpeg with no output spec exits 1 and prints the stream info on
    // stderr — that's the whole probe.
    await ff.exec(["-i", inName]).catch(() => {
      /* exit code 1 expected */
    });
  } finally {
    ff.off("log", onLog);
    try {
      await ff.deleteFile(inName);
    } catch {
      /* best-effort */
    }
  }

  const text = lines.join("\n");
  let durationSec = 0;
  const dm = text.match(DURATION_RE);
  if (dm?.[1] && dm[2] && dm[3]) {
    durationSec = Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]);
  }

  let videoCodec: string | null = null;
  let width = 0;
  let height = 0;
  const vm = text.match(VIDEO_STREAM_RE);
  if (vm?.[1] && vm[2] && vm[3]) {
    videoCodec = vm[1].toLowerCase();
    width = Number(vm[2]);
    height = Number(vm[3]);
  }

  let audioCodec: string | null = null;
  const am = text.match(AUDIO_STREAM_RE);
  if (am?.[1]) {
    audioCodec = am[1].toLowerCase();
  }

  return {
    durationSec,
    videoCodec,
    audioCodec,
    width,
    height,
    hasAudio: audioCodec !== null,
  };
}
```

- [ ] **Step 3.4: Run the test to confirm it passes.**

```bash
pnpm test src/engines/_shared/ffmpeg/probe.test.ts
```

Expected: PASS — 6 cases. The first invocation is slow (~3-8 seconds while ffmpeg WASM loads); subsequent cases reuse the singleton.

If any codec assertion fails (e.g., `vp9` parsed as `vp90` or similar), inspect the actual stderr output by adding a temporary `console.log(text)` in `probe.ts`, fix the regex to match the exact format ffmpeg emits, remove the debug log, and re-run.

- [ ] **Step 3.5: Commit.**

```bash
git add src/engines/_shared/ffmpeg/probe.ts src/engines/_shared/ffmpeg/probe.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-22): _shared/ffmpeg/probe for video engines

probeWithFfmpeg(ff, bytes, ext) parses ffmpeg's stderr Stream and
Duration lines into a ProbeResult shape (codecs, dimensions,
duration, hasAudio). Worker-only — takes an already-loaded ffmpeg
instance so the page never doubles its WASM cost (Phase 20 §2.5b).
Tests cover all five fixtures plus a MEMFS leak check.
EOF
)"
```

---

## Task 4: Add `_shared/trim-scrubber/frame-strip.ts`

**Why:** The trim-scrubber video branch needs to extract N evenly-spaced JPEG thumbnails for the strip below the timeline. Single-pass ffmpeg invocation; worker-only for the same reason as the probe.

**Files:**
- Create: `src/engines/_shared/trim-scrubber/frame-strip.ts`
- Create: `src/engines/_shared/trim-scrubber/frame-strip.test.ts`

- [ ] **Step 4.1: Write the failing test first.**

```typescript
// src/engines/_shared/trim-scrubber/frame-strip.test.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { __resetForTests, loadFfmpeg } from "../ffmpeg";
import { extractFrameStripInWorker } from "./frame-strip";

const FIXTURES_DIR = path.resolve(__dirname, "../../../../tests/fixtures/video");

function readFixture(name: string): ArrayBuffer {
  const buf = readFileSync(path.join(FIXTURES_DIR, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

afterEach(() => {
  __resetForTests();
});

describe("extractFrameStripInWorker", () => {
  it("extracts the requested number of JPEG frames at the right size", async () => {
    const ff = await loadFfmpeg();
    const bytes = readFixture("sample-h264-aac.mp4");
    const result = await extractFrameStripInWorker({
      ff,
      fileBytes: bytes,
      fileExtension: ".mp4",
      durationSec: 5,
      sourceWidth: 320,
      sourceHeight: 180,
      count: 10,
      heightPx: 60,
    });

    expect(result.frames).toHaveLength(10);
    // 60 * 320 / 180 = 106.66... → rounds to 107
    expect(result.widthPx).toBe(107);
    for (const frame of result.frames) {
      expect(frame).toBeInstanceOf(Uint8Array);
      expect(frame.byteLength).toBeGreaterThan(0);
      // JPEG magic bytes: 0xFF 0xD8 ... 0xFF 0xD9
      expect(frame[0]).toBe(0xff);
      expect(frame[1]).toBe(0xd8);
    }
  }, 60_000);

  it("cleans up MEMFS — repeated extractions do not accumulate files", async () => {
    const ff = await loadFfmpeg();
    const bytes = readFixture("sample-h264-aac.mp4");
    const baseline = (await ff.listDir("/")).length;
    for (let i = 0; i < 2; i++) {
      await extractFrameStripInWorker({
        ff,
        fileBytes: bytes,
        fileExtension: ".mp4",
        durationSec: 5,
        sourceWidth: 320,
        sourceHeight: 180,
        count: 5,
        heightPx: 60,
      });
    }
    const after = (await ff.listDir("/")).length;
    expect(after).toBe(baseline);
  }, 90_000);
});
```

- [ ] **Step 4.2: Run the test to confirm it fails.**

```bash
pnpm test src/engines/_shared/trim-scrubber/frame-strip.test.ts
```

Expected: FAIL — module not found / `extractFrameStripInWorker is not defined`.

- [ ] **Step 4.3: Implement `frame-strip.ts`.**

```typescript
// src/engines/_shared/trim-scrubber/frame-strip.ts
//
// Worker-only frame-strip extractor. Single ffmpeg pass produces N
// evenly-spaced JPEG thumbnails at the requested height with native
// aspect width. Returns raw bytes; the main-thread caller wraps each
// into a Blob + object URL after receiving them.
//
// Does NOT call loadFfmpeg() — runs inside the engine worker on the
// same ffmpeg instance used by convertSingle and probe.

import type { FFmpeg as FFmpegType } from "@ffmpeg/ffmpeg";

export type FrameStripArgs = {
  ff: FFmpegType;
  fileBytes: ArrayBuffer;
  fileExtension: string;
  durationSec: number;
  sourceWidth: number;
  sourceHeight: number;
  count: number;
  heightPx: number;
};

export type FrameStripResult = {
  frames: Uint8Array[];
  widthPx: number;
};

export async function extractFrameStripInWorker(
  args: FrameStripArgs,
): Promise<FrameStripResult> {
  const { ff, fileBytes, fileExtension, durationSec, sourceWidth, sourceHeight, count, heightPx } =
    args;
  if (count <= 0) throw new Error("frame-strip: count must be positive");
  if (durationSec <= 0) throw new Error("frame-strip: durationSec must be positive");
  if (sourceHeight <= 0) throw new Error("frame-strip: sourceHeight must be positive");

  const ext = fileExtension.startsWith(".") ? fileExtension : `.${fileExtension || "bin"}`;
  const id = crypto.randomUUID();
  const inName = `strip_${id}${ext}`;
  const outPattern = `frame_${id}_%03d.jpg`;
  const outFiles: string[] = [];

  try {
    await ff.writeFile(inName, new Uint8Array(fileBytes));
    const exit = await ff.exec([
      "-i",
      inName,
      "-vf",
      `fps=${count}/${durationSec},scale=-1:${heightPx}`,
      "-frames:v",
      String(count),
      outPattern,
    ]);
    if (exit !== 0) {
      throw new Error(`frame-strip: ffmpeg exited with code ${exit}`);
    }

    const frames: Uint8Array[] = [];
    for (let i = 1; i <= count; i++) {
      const name = `frame_${id}_${String(i).padStart(3, "0")}.jpg`;
      outFiles.push(name);
      const data = await ff.readFile(name);
      if (typeof data === "string") {
        throw new Error(`frame-strip: ffmpeg returned text for ${name}`);
      }
      frames.push(new Uint8Array(data as Uint8Array));
    }

    const widthPx = Math.round((heightPx * sourceWidth) / sourceHeight);
    return { frames, widthPx };
  } finally {
    try {
      await ff.deleteFile(inName);
    } catch {
      /* best-effort */
    }
    for (const name of outFiles) {
      try {
        await ff.deleteFile(name);
      } catch {
        /* best-effort */
      }
    }
  }
}
```

- [ ] **Step 4.4: Run the test to confirm it passes.**

```bash
pnpm test src/engines/_shared/trim-scrubber/frame-strip.test.ts
```

Expected: PASS — 2 cases. Total runtime ~30-60 seconds including ffmpeg load.

- [ ] **Step 4.5: Commit.**

```bash
git add src/engines/_shared/trim-scrubber/frame-strip.ts \
        src/engines/_shared/trim-scrubber/frame-strip.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-22): _shared/trim-scrubber/frame-strip extractor

extractFrameStripInWorker pulls N evenly-spaced JPEG thumbnails from
a video in a single ffmpeg pass (-vf fps=N/duration,scale=-1:H).
Returns raw Uint8Array bytes per frame plus the native-aspect width;
main-thread caller wraps into Blob + object URL. Worker-only, takes
an already-loaded ffmpeg instance — same constraint as probe.
EOF
)"
```

---

## Task 5: Extend `WorkerHarness` with `runProbe` and `runExtractFrameStrip`

**Why:** OptionsPanel and TrimScrubber on the main thread need to call probe / extract-frame-strip on the engine worker (so ffmpeg loads once). Mirrors Phase 20's `runDecodePeaks` extension.

**Files:**
- Modify: `src/engines/_shared/harness.ts`
- Modify: `src/engines/_shared/harness.test.ts`

- [ ] **Step 5.1: Read the existing `harness.ts` and `harness.test.ts` to see the established `runDecodePeaks` pattern.**

```bash
cat src/engines/_shared/harness.ts | head -210
ls src/engines/_shared/harness.test.ts && wc -l src/engines/_shared/harness.test.ts
```

Expected: confirm `runDecodePeaks` exists and follows the `spawn() → cast → call → terminateIfEphemeral` pattern. Note any test-double helpers (e.g., `makeMockWorker`) used in `harness.test.ts` — you'll reuse them.

- [ ] **Step 5.2: Write failing tests for `runProbe` and `runExtractFrameStrip`.**

Append to `src/engines/_shared/harness.test.ts` (use the same `makeMockWorker` helper that the existing `runDecodePeaks` tests use; if your file currently imports it, reuse the import — don't re-declare it):

```typescript
describe("WorkerHarness.runProbe", () => {
  it("calls the worker's probe RPC and returns the result", async () => {
    const probeResult = {
      durationSec: 5,
      videoCodec: "h264",
      audioCodec: "aac",
      width: 320,
      height: 180,
      hasAudio: true,
    };
    const probe = vi.fn().mockResolvedValue(probeResult);
    const factory = vi.fn(() => makeFakeWorker({ probe }));
    const h = new WorkerHarness(factory, { persistent: true });
    const file = new File([new Uint8Array([1, 2, 3, 4])], "x.mp4", { type: "video/mp4" });

    const result = await h.runProbe(file);

    expect(result).toEqual(probeResult);
    expect(probe).toHaveBeenCalledTimes(1);
    h.dispose();
  });

  it("caches the probe Promise per File identity", async () => {
    const probe = vi
      .fn()
      .mockResolvedValue({
        durationSec: 1,
        videoCodec: null,
        audioCodec: null,
        width: 0,
        height: 0,
        hasAudio: false,
      });
    const h = new WorkerHarness(() => makeFakeWorker({ probe }), { persistent: true });
    const file = new File([new Uint8Array([1])], "x.mp4", { type: "video/mp4" });

    const a = await h.runProbe(file);
    const b = await h.runProbe(file);

    expect(a).toBe(b); // same cached object
    expect(probe).toHaveBeenCalledTimes(1);
    h.dispose();
  });

  it("throws actionably if the worker doesn't implement probe", async () => {
    const h = new WorkerHarness(() => makeFakeWorker({}), { persistent: true });
    const file = new File([new Uint8Array([1])], "x.mp4", { type: "video/mp4" });
    await expect(h.runProbe(file)).rejects.toThrow(/probe/);
    h.dispose();
  });
});

describe("WorkerHarness.runExtractFrameStrip", () => {
  it("calls the worker RPC and returns object URLs from frame bytes", async () => {
    // Two minimal "JPEGs" (just 4 bytes each — the test asserts URLs and
    // widthPx, not real image decoding).
    const frames = [new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), new Uint8Array([0xff, 0xd8, 0xff, 0xd9])];
    const probe = vi.fn().mockResolvedValue({
      durationSec: 4,
      videoCodec: "h264",
      audioCodec: null,
      width: 320,
      height: 180,
      hasAudio: false,
    });
    const extractFrameStrip = vi.fn().mockResolvedValue({ frames, widthPx: 107 });
    const h = new WorkerHarness(() => makeFakeWorker({ probe, extractFrameStrip }), {
      persistent: true,
    });
    const file = new File([new Uint8Array([1, 2, 3])], "x.mp4", { type: "video/mp4" });

    const result = await h.runExtractFrameStrip({ file, count: 2, heightPx: 60 });

    expect(result.urls).toHaveLength(2);
    expect(result.widthPx).toBe(107);
    for (const url of result.urls) {
      expect(url).toMatch(/^blob:/);
    }
    expect(extractFrameStrip).toHaveBeenCalledTimes(1);
    expect(extractFrameStrip).toHaveBeenCalledWith(
      expect.objectContaining({
        count: 2,
        heightPx: 60,
        durationSec: 4,
        sourceWidth: 320,
        sourceHeight: 180,
      }),
    );
    h.dispose();
  });

  it("throws actionably if the worker doesn't implement extractFrameStrip", async () => {
    const probe = vi.fn().mockResolvedValue({
      durationSec: 1,
      videoCodec: "h264",
      audioCodec: null,
      width: 320,
      height: 180,
      hasAudio: false,
    });
    const h = new WorkerHarness(() => makeFakeWorker({ probe }), { persistent: true });
    const file = new File([new Uint8Array([1])], "x.mp4", { type: "video/mp4" });
    await expect(h.runExtractFrameStrip({ file, count: 5, heightPx: 60 })).rejects.toThrow(
      /extractFrameStrip/,
    );
    h.dispose();
  });
});
```

`makeFakeWorker` in this codebase wraps a fake worker object whose Comlink remote is the partial `WorkerEntry` you pass in — re-use the existing helper. If `makeFakeWorker` is named differently (e.g., `makeMockWorker`), use whatever the file already exports.

- [ ] **Step 5.3: Run tests to confirm they fail.**

```bash
pnpm test src/engines/_shared/harness.test.ts
```

Expected: 5 new failures (`runProbe is not a function`, `runExtractFrameStrip is not a function`, etc.).

- [ ] **Step 5.4: Add `probe?` + `extractFrameStrip?` to `WorkerEntry` in `harness.ts`.**

In `src/engines/_shared/harness.ts`, append to the `WorkerEntry<TOptions>` type definition (after the existing `decodePeaks?` field):

```typescript
  /** Optional: probe a media file's codec / duration / dimensions.
   * Engine workers that need codec-aware behavior implement this. The
   * trim-scrubber video branch and video-trim's options-panel both
   * call WorkerHarness.runProbe → this RPC so probe results share the
   * same persistent worker (and ffmpeg singleton) as the conversion. */
  probe?: (
    bytes: ArrayBuffer,
    fileExtension: string,
  ) => Promise<{
    durationSec: number;
    videoCodec: string | null;
    audioCodec: string | null;
    width: number;
    height: number;
    hasAudio: boolean;
  }>;
  /** Optional: extract N evenly-spaced frame thumbnails for the
   * trim-scrubber video render path. Returns raw JPEG bytes; the main-
   * thread harness wraps each into a Blob + object URL. */
  extractFrameStrip?: (args: {
    bytes: ArrayBuffer;
    fileExtension: string;
    durationSec: number;
    sourceWidth: number;
    sourceHeight: number;
    count: number;
    heightPx: number;
  }) => Promise<{
    frames: Uint8Array[];
    widthPx: number;
  }>;
```

- [ ] **Step 5.5: Add `runProbe` and `runExtractFrameStrip` methods to `WorkerHarness`.**

After the existing `runDecodePeaks` method in `WorkerHarness`, add:

```typescript
  // Per-File cache for probe results. Keyed on File identity — re-staged
  // files produce a new File object and thus re-probe (correct).
  private probeCache = new WeakMap<File, Promise<{
    durationSec: number;
    videoCodec: string | null;
    audioCodec: string | null;
    width: number;
    height: number;
    hasAudio: boolean;
  }>>();

  async runProbe(file: File): Promise<{
    durationSec: number;
    videoCodec: string | null;
    audioCodec: string | null;
    width: number;
    height: number;
    hasAudio: boolean;
  }> {
    const cached = this.probeCache.get(file);
    if (cached) return cached;
    const promise = (async () => {
      this.spawn();
      if (!this.remote?.probe) {
        this.terminateIfEphemeral();
        throw new Error("worker does not implement probe");
      }
      const probe = this.remote.probe as unknown as (
        bytes: ArrayBuffer,
        ext: string,
      ) => Promise<{
        durationSec: number;
        videoCodec: string | null;
        audioCodec: string | null;
        width: number;
        height: number;
        hasAudio: boolean;
      }>;
      const ext = (file.name.split(".").pop() ?? "").toLowerCase();
      try {
        const bytes = await file.arrayBuffer();
        return await probe(bytes, `.${ext}`);
      } finally {
        this.terminateIfEphemeral();
      }
    })().catch((err) => {
      // On failure, evict the cache so the next call retries.
      this.probeCache.delete(file);
      throw err;
    });
    this.probeCache.set(file, promise);
    return promise;
  }

  async runExtractFrameStrip(args: {
    file: File;
    count: number;
    heightPx: number;
  }): Promise<{ urls: string[]; widthPx: number }> {
    const probe = await this.runProbe(args.file);
    this.spawn();
    if (!this.remote?.extractFrameStrip) {
      this.terminateIfEphemeral();
      throw new Error("worker does not implement extractFrameStrip");
    }
    const extract = this.remote.extractFrameStrip as unknown as (a: {
      bytes: ArrayBuffer;
      fileExtension: string;
      durationSec: number;
      sourceWidth: number;
      sourceHeight: number;
      count: number;
      heightPx: number;
    }) => Promise<{ frames: Uint8Array[]; widthPx: number }>;
    const ext = (args.file.name.split(".").pop() ?? "").toLowerCase();
    try {
      const bytes = await args.file.arrayBuffer();
      const result = await extract({
        bytes,
        fileExtension: `.${ext}`,
        durationSec: probe.durationSec,
        sourceWidth: probe.width,
        sourceHeight: probe.height,
        count: args.count,
        heightPx: args.heightPx,
      });
      const urls = result.frames.map((bytes) => {
        // ArrayBuffer cast is safe — `bytes` came over Comlink as a
        // structured-cloned Uint8Array backed by an ArrayBuffer.
        const ab = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
        return URL.createObjectURL(new Blob([ab], { type: "image/jpeg" }));
      });
      return { urls, widthPx: result.widthPx };
    } finally {
      this.terminateIfEphemeral();
    }
  }
```

- [ ] **Step 5.6: Run the harness tests.**

```bash
pnpm test src/engines/_shared/harness.test.ts
```

Expected: every test passes — both the existing `runSingle`/`runMulti`/`runDecodePeaks` cases and the 5 new `runProbe`/`runExtractFrameStrip` cases.

If `URL.createObjectURL` isn't defined under the test environment, install a minimal polyfill in the test setup (e.g., `vi.stubGlobal("URL", { createObjectURL: (b: Blob) => \`blob:fake-${Math.random()}\` })`) — but verify first whether your test env (jsdom?) already provides it; the audio-trim tests may have set this up.

- [ ] **Step 5.7: Commit.**

```bash
git add src/engines/_shared/harness.ts src/engines/_shared/harness.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-22): WorkerHarness runProbe + runExtractFrameStrip

Mirrors Phase 20's runDecodePeaks extension. Adds optional probe? +
extractFrameStrip? to WorkerEntry; runProbe caches Promise<ProbeResult>
in a WeakMap keyed on File identity; runExtractFrameStrip awaits probe
for duration/dimensions, then makes the RPC and wraps the returned
JPEG bytes into Blobs + object URLs on the main thread (workers can't
call URL.createObjectURL portably).
EOF
)"
```

---

## Task 6: Add `<video>` branch to `_shared/trim-scrubber/duration.ts`

**Why:** The trim-scrubber video render path probes duration on the main thread via a temporary `<video>` element while ffmpeg loads in the worker — same pattern as the audio branch. Currently `duration.ts` throws on `modality: "video"`.

**Files:**
- Modify: `src/engines/_shared/trim-scrubber/duration.ts`
- Modify: `src/engines/_shared/trim-scrubber/duration.test.ts`

- [ ] **Step 6.1: Read the existing duration test to see the audio-side pattern.**

```bash
cat src/engines/_shared/trim-scrubber/duration.test.ts
```

Note the synthesized-WAV pattern; you'll mirror it with a synthesized minimal MP4 if the existing harness has a helper, otherwise read `tests/fixtures/video/sample-h264-aac.mp4` directly.

- [ ] **Step 6.2: Replace the failing-on-video assertion with a passing video case.**

In `src/engines/_shared/trim-scrubber/duration.test.ts`, find the test that asserts the `modality: "video"` throws and replace it with:

```typescript
import { readFileSync } from "node:fs";
import path from "node:path";
// ... existing imports stay ...

it('reads duration of a video file via modality:"video"', async () => {
  const buf = readFileSync(
    path.resolve(__dirname, "../../../../tests/fixtures/video/sample-h264-aac.mp4"),
  );
  const file = new File([buf], "sample.mp4", { type: "video/mp4" });
  const dur = await readMediaDurationSec(file, "video");
  expect(dur).toBeGreaterThan(4.9);
  expect(dur).toBeLessThan(5.1);
});

it('falls back gracefully when <video>.duration is Infinity (rare MP4 case)', async () => {
  // Spy on createElement so we can hand back a stubbed <video> element
  // whose duration is Infinity. Verifies the fallback path documented in
  // the spec (Open question 5).
  const realCreate = document.createElement.bind(document);
  const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "video") {
      const el = realCreate("video") as HTMLVideoElement;
      Object.defineProperty(el, "duration", { value: Infinity, configurable: true });
      // Trigger loadedmetadata synchronously after src assignment.
      Object.defineProperty(el, "src", {
        set() {
          queueMicrotask(() => el.dispatchEvent(new Event("loadedmetadata")));
        },
        configurable: true,
      });
      return el;
    }
    return realCreate(tag);
  });
  const file = new File([new Uint8Array([1])], "x.mp4", { type: "video/mp4" });
  await expect(readMediaDurationSec(file, "video")).rejects.toThrow(/not finite/);
  spy.mockRestore();
});
```

- [ ] **Step 6.3: Run the test to confirm it fails.**

```bash
pnpm test src/engines/_shared/trim-scrubber/duration.test.ts
```

Expected: the new "video duration" cases fail because the implementation still throws.

- [ ] **Step 6.4: Update `duration.ts` to handle `modality: "video"`.**

Replace the existing `if (modality === "video")` throw with a parameterized createElement call. The cleanest shape:

```typescript
export async function readMediaDurationSec(
  file: File,
  modality: "audio" | "video",
): Promise<number> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<number>((resolve, reject) => {
      const el = document.createElement(modality) as HTMLMediaElement;
      const watchdog = setTimeout(() => {
        reject(new Error("media metadata timeout (10s)"));
      }, 10_000);
      const settle = (fn: () => void) => {
        clearTimeout(watchdog);
        fn();
      };
      const onLoaded = () =>
        settle(() => {
          if (Number.isFinite(el.duration) && el.duration > 0) {
            resolve(el.duration);
          } else {
            reject(new Error("media duration is not finite"));
          }
        });
      const onError = () => settle(() => reject(new Error(`failed to load ${modality} metadata`)));
      el.addEventListener("loadedmetadata", onLoaded, { once: true });
      el.addEventListener("error", onError, { once: true });
      el.preload = "metadata";
      el.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

- [ ] **Step 6.5: Run the test to confirm it passes.**

```bash
pnpm test src/engines/_shared/trim-scrubber/duration.test.ts
```

Expected: every case passes — both the existing audio cases and the two new video cases.

- [ ] **Step 6.6: Commit.**

```bash
git add src/engines/_shared/trim-scrubber/duration.ts \
        src/engines/_shared/trim-scrubber/duration.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-22): trim-scrubber duration handles modality:"video"

Replace the Phase 20 throw with a parameterized createElement(modality)
call. Same loadedmetadata + watchdog + Infinity-rejection logic as the
audio branch. New tests cover real MP4 fixture probing and the
Infinity-duration rejection path documented in spec §11 open question 5.
EOF
)"
```

---

## Task 7: Light up `modality: "video"` in `_shared/trim-scrubber/index.tsx`

**Why:** The component currently throws on `modality: "video"`. Replace with a working render branch that uses the new harness methods.

**Files:**
- Modify: `src/engines/_shared/trim-scrubber/index.tsx`
- Modify: `src/engines/_shared/trim-scrubber/index.test.tsx`

- [ ] **Step 7.1: Read the existing component to understand its layout shape.**

```bash
cat src/engines/_shared/trim-scrubber/index.tsx
```

Note the existing audio render path (canvas + handles). The video render path replaces only the canvas with a flex row of `<img>` thumbnails; the handle/keyboard/timestamp logic is identical.

- [ ] **Step 7.2: Add a new prop for the video frame-strip extractor and remove the throw.**

Update `TrimScrubberProps`:

```typescript
import type { Peaks } from "./decode-peaks";

export type TrimScrubberProps = {
  source: File;
  modality: "audio" | "video";
  durationSec: number;
  startSec: number;
  endSec: number;
  onChange(start: number, end: number): void;
  disabled?: boolean;
  /** Audio: optional injection point. Production callers pass a function
   * backed by WorkerHarness.runDecodePeaks. */
  decodePeaks?: (file: File, bucketCount: number) => Promise<Peaks>;
  /** Video: optional injection point. Production callers pass a function
   * backed by WorkerHarness.runExtractFrameStrip. When omitted (or while
   * the promise is pending), a 60px-tall skeleton placeholder renders. */
  extractFrames?: (
    file: File,
    count: number,
    heightPx: number,
  ) => Promise<{ urls: string[]; widthPx: number }>;
};
```

Remove the `if (modality === "video") { throw ... }` block. Add a video render branch at the same level as the audio canvas. Use the existing handle/keyboard infrastructure unchanged.

The video branch uses `useLayoutEffect` to read container width, computes `count = clamp(floor(width / 80), 10, 60)`, calls `extractFrames` once, and renders. URL cleanup on unmount.

```typescript
const SLOT_WIDTH = 80;
const STRIP_HEIGHT = 60;
const FRAME_COUNT_MIN = 10;
const FRAME_COUNT_MAX = 60;

// ...inside TrimScrubber, replacing the previous `if (modality === "video")` block:

const stripContainerRef = useRef<HTMLDivElement | null>(null);
const [stripUrls, setStripUrls] = useState<string[] | null>(null);

useEffect(() => {
  if (modality !== "video") return;
  if (!extractFrames) return;
  const containerWidth =
    stripContainerRef.current?.getBoundingClientRect().width ?? 0;
  if (containerWidth <= 0) return;
  const count = Math.max(
    FRAME_COUNT_MIN,
    Math.min(FRAME_COUNT_MAX, Math.floor(containerWidth / SLOT_WIDTH)),
  );
  let cancelled = false;
  let issued: string[] = [];
  extractFrames(source, count, STRIP_HEIGHT).then(
    ({ urls }) => {
      if (cancelled) {
        for (const u of urls) URL.revokeObjectURL(u);
        return;
      }
      issued = urls;
      setStripUrls(urls);
    },
    () => {
      if (!cancelled) setStripUrls(null);
    },
  );
  return () => {
    cancelled = true;
    for (const u of issued) URL.revokeObjectURL(u);
  };
}, [source, modality, extractFrames]);
```

In the JSX, render either the audio canvas OR the video strip based on `modality`. Wrap the strip in `stripContainerRef` so the ref is set before the effect reads `getBoundingClientRect`. Strip JSX:

```tsx
<div
  ref={stripContainerRef}
  data-testid="trim-scrubber-frame-strip"
  className="flex h-[60px] w-full items-stretch overflow-hidden border border-[var(--color-hairline)]"
>
  {stripUrls === null ? (
    <div className="h-full w-full bg-[var(--color-hairline)]" />
  ) : (
    stripUrls.map((url, i) => (
      <img
        key={`${url}-${i}`}
        src={url}
        alt=""
        draggable={false}
        className="h-full w-[80px] flex-shrink-0 object-cover"
        style={{ objectPosition: "center" }}
      />
    ))
  )}
</div>
```

(Adapt the wrapper class names to the component's existing visual language — match the audio canvas's wrapper classes for consistency.)

- [ ] **Step 7.3: Add new tests for the video render branch.**

Append to `src/engines/_shared/trim-scrubber/index.test.tsx`:

```typescript
describe("TrimScrubber modality:\"video\"", () => {
  it("renders a skeleton placeholder when no extractFrames is provided", () => {
    const file = new File([new Uint8Array([1])], "x.mp4", { type: "video/mp4" });
    render(
      <TrimScrubber
        source={file}
        modality="video"
        durationSec={5}
        startSec={0}
        endSec={5}
        onChange={() => {}}
      />,
    );
    const strip = screen.getByTestId("trim-scrubber-frame-strip");
    expect(strip).toBeInTheDocument();
    // Skeleton has no <img> children.
    expect(strip.querySelectorAll("img").length).toBe(0);
  });

  it("renders the returned strip thumbnails as <img> elements", async () => {
    const file = new File([new Uint8Array([1])], "x.mp4", { type: "video/mp4" });
    const extractFrames = vi.fn().mockResolvedValue({
      urls: ["blob:fake-1", "blob:fake-2", "blob:fake-3"],
      widthPx: 107,
    });
    // jsdom getBoundingClientRect returns 0 by default; stub a non-zero
    // width so the count formula doesn't bail out.
    Element.prototype.getBoundingClientRect = vi.fn(
      () => ({ width: 800, height: 60, top: 0, left: 0, bottom: 60, right: 800 } as DOMRect),
    );

    render(
      <TrimScrubber
        source={file}
        modality="video"
        durationSec={5}
        startSec={0}
        endSec={5}
        onChange={() => {}}
        extractFrames={extractFrames}
      />,
    );

    await waitFor(() => {
      const imgs = screen.getByTestId("trim-scrubber-frame-strip").querySelectorAll("img");
      expect(imgs.length).toBe(3);
    });
    // 800px container / 80px slot = 10 frames requested.
    expect(extractFrames).toHaveBeenCalledWith(file, 10, 60);
  });

  it("revokes object URLs on unmount", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const file = new File([new Uint8Array([1])], "x.mp4", { type: "video/mp4" });
    const extractFrames = vi.fn().mockResolvedValue({
      urls: ["blob:fake-1", "blob:fake-2"],
      widthPx: 107,
    });
    Element.prototype.getBoundingClientRect = vi.fn(
      () => ({ width: 800, height: 60, top: 0, left: 0, bottom: 60, right: 800 } as DOMRect),
    );

    const { unmount } = render(
      <TrimScrubber
        source={file}
        modality="video"
        durationSec={5}
        startSec={0}
        endSec={5}
        onChange={() => {}}
        extractFrames={extractFrames}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("trim-scrubber-frame-strip").querySelectorAll("img").length).toBe(2);
    });

    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:fake-1");
    expect(revoke).toHaveBeenCalledWith("blob:fake-2");
    revoke.mockRestore();
  });
});
```

- [ ] **Step 7.4: Run the trim-scrubber tests.**

```bash
pnpm test src/engines/_shared/trim-scrubber/
```

Expected: every case passes — existing audio-modality cases unchanged, three new video-modality cases pass.

- [ ] **Step 7.5: Commit.**

```bash
git add src/engines/_shared/trim-scrubber/index.tsx \
        src/engines/_shared/trim-scrubber/index.test.tsx
git commit -m "$(cat <<'EOF'
feat(phase-22): trim-scrubber modality:"video" render branch

Replace Phase 20's throw with an adaptive frame-strip render. Reads
container width via getBoundingClientRect, computes count clamped to
[10, 60] at 80px per slot, calls injected extractFrames callback,
renders <img> per URL in fixed slots with object-fit:cover. Revokes
object URLs on unmount. Audio render path unchanged.
EOF
)"
```

---

## Task 8: Build the `video-trim` engine

**Why:** First of the two new engines. Mirrors `audio-trim`'s shape (engine descriptor + persistent harness factory + worker + options + options-panel).

**Files:**
- Create: `src/engines/video-trim/options.ts`
- Create: `src/engines/video-trim/options.test.ts`
- Create: `src/engines/video-trim/worker.ts`
- Create: `src/engines/video-trim/index.ts`
- Create: `src/engines/video-trim/index.test.ts`
- Create: `src/engines/video-trim/options-panel.tsx`
- Create: `src/engines/video-trim/options-panel.test.tsx`

- [ ] **Step 8.1: Write `options.ts`.**

```typescript
// src/engines/video-trim/options.ts
import {
  containerSupportsCodecs,
  type Container,
  type ContainerOrSame,
} from "@/engines/_shared/ffmpeg/codec-compat";

export type VideoTrimContainer = ContainerOrSame;

export type VideoTrimOptions = {
  startSec: number;
  endSec: number;
  containerFormat: VideoTrimContainer;
};

export const VIDEO_TRIM_CONTAINERS: ReadonlyArray<VideoTrimContainer> = [
  "same",
  "mp4",
  "webm",
  "mkv",
];

export const defaultVideoTrimOptions: VideoTrimOptions = {
  startSec: 0,
  endSec: 0,
  containerFormat: "same",
};

const INPUT_EXT_FOR_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
};

const OUTPUT_MIME_FOR_CONTAINER: Record<Container, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
};

function extensionOf(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

export function outputExtensionFor(fmt: VideoTrimContainer, inputName: string): string {
  if (fmt === "same") return extensionOf(inputName);
  return fmt;
}

export function outputMimeFor(fmt: VideoTrimContainer, inputMime: string): string {
  if (fmt === "same") return inputMime || INPUT_EXT_FOR_MIME[inputMime] || "video/mp4";
  return OUTPUT_MIME_FOR_CONTAINER[fmt];
}

export { containerSupportsCodecs };
```

- [ ] **Step 8.2: Write `options.test.ts`.**

```typescript
// src/engines/video-trim/options.test.ts
import { describe, expect, it } from "vitest";
import {
  containerSupportsCodecs,
  defaultVideoTrimOptions,
  outputExtensionFor,
  outputMimeFor,
  VIDEO_TRIM_CONTAINERS,
} from "./options";

describe("video-trim options", () => {
  it("default options use same-container, zero handles", () => {
    expect(defaultVideoTrimOptions).toEqual({
      startSec: 0,
      endSec: 0,
      containerFormat: "same",
    });
  });

  it("VIDEO_TRIM_CONTAINERS lists same/mp4/webm/mkv in order", () => {
    expect(VIDEO_TRIM_CONTAINERS).toEqual(["same", "mp4", "webm", "mkv"]);
  });

  it("outputExtensionFor 'same' preserves input extension", () => {
    expect(outputExtensionFor("same", "clip.mp4")).toBe("mp4");
    expect(outputExtensionFor("same", "clip.MOV")).toBe("mov");
    expect(outputExtensionFor("same", "clip.webm")).toBe("webm");
  });

  it("outputExtensionFor named containers returns the container as extension", () => {
    expect(outputExtensionFor("mp4", "x.webm")).toBe("mp4");
    expect(outputExtensionFor("webm", "x.mp4")).toBe("webm");
    expect(outputExtensionFor("mkv", "x.mov")).toBe("mkv");
  });

  it("outputMimeFor 'same' preserves input MIME", () => {
    expect(outputMimeFor("same", "video/quicktime")).toBe("video/quicktime");
    expect(outputMimeFor("same", "video/webm")).toBe("video/webm");
  });

  it("outputMimeFor named containers maps correctly", () => {
    expect(outputMimeFor("mp4", "video/webm")).toBe("video/mp4");
    expect(outputMimeFor("webm", "video/mp4")).toBe("video/webm");
    expect(outputMimeFor("mkv", "video/mp4")).toBe("video/x-matroska");
  });

  it("re-exports containerSupportsCodecs from _shared/ffmpeg", () => {
    expect(containerSupportsCodecs("mp4", "vp9", "aac")).toBe(false);
    expect(containerSupportsCodecs("same", "vp9", "opus")).toBe(true);
  });
});
```

- [ ] **Step 8.3: Run options tests to confirm they pass.**

```bash
pnpm test src/engines/video-trim/options.test.ts
```

Expected: PASS — 7 cases.

- [ ] **Step 8.4: Write `worker.ts`.**

```typescript
// src/engines/video-trim/worker.ts
import { loadFfmpeg } from "@/engines/_shared/ffmpeg";
import { probeWithFfmpeg } from "@/engines/_shared/ffmpeg/probe";
import { extractFrameStripInWorker } from "@/engines/_shared/trim-scrubber/frame-strip";
import type { ConversionProgress, OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import {
  containerSupportsCodecs,
  outputExtensionFor,
  outputMimeFor,
  type VideoTrimOptions,
} from "./options";

function replaceExtension(name: string, newExt: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}-trimmed.${newExt}`;
}

const api = {
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    type: string,
    opts: VideoTrimOptions,
    onProgress?: (p: ConversionProgress) => void,
  ): Promise<OutputItem> {
    if (opts.endSec <= opts.startSec) {
      throw new Error(
        `video-trim: endSec (${opts.endSec}) must be greater than startSec (${opts.startSec})`,
      );
    }

    onProgress?.({ kind: "model-loading", loaded: 0, total: 1 });
    const ff = await loadFfmpeg();
    onProgress?.({ kind: "model-loading", loaded: 1, total: 1 });

    // Defensive convert-time codec/container check. The options-panel
    // disables incompatible container choices, but a stale option value
    // could slip through.
    if (opts.containerFormat !== "same") {
      const probe = await probeWithFfmpeg(ff, bytes, name);
      if (!containerSupportsCodecs(opts.containerFormat, probe.videoCodec, probe.audioCodec)) {
        throw new Error(
          `Can't trim into ${opts.containerFormat.toUpperCase()}: ` +
            `this video uses ${probe.videoCodec ?? "an unknown video codec"}` +
            `${probe.audioCodec ? ` and ${probe.audioCodec}` : ""}. ` +
            `Pick MKV or 'same'.`,
        );
      }
    }

    const progressHandler = ({ progress }: { progress: number; time: number }) => {
      onProgress?.({ kind: "inference", pct: Math.max(0, Math.min(100, progress * 100)) });
    };
    ff.on("progress", progressHandler);

    const inExt = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "bin").toLowerCase();
    const outExt = outputExtensionFor(opts.containerFormat, name);
    const id = crypto.randomUUID();
    const inName = `in_${id}.${inExt}`;
    const outName = `out_${id}.${outExt}`;

    try {
      await ff.writeFile(inName, new Uint8Array(bytes));
      onProgress?.({ kind: "inference", pct: 0 });

      // -ss before -i for fast keyframe seek.
      const args: string[] = [
        "-ss",
        String(opts.startSec),
        "-to",
        String(opts.endSec),
        "-i",
        inName,
        "-c",
        "copy",
        "-avoid_negative_ts",
        "make_zero",
        outName,
      ];
      const exit = await ff.exec(args);
      if (exit !== 0) {
        throw new Error(`video-trim: ffmpeg exited with code ${exit}`);
      }
      onProgress?.({ kind: "inference", pct: 100 });

      const out = await ff.readFile(outName);
      if (typeof out === "string") {
        throw new Error("video-trim: ffmpeg returned text output unexpectedly");
      }
      const mime = outputMimeFor(opts.containerFormat, type);
      const blob = new Blob([out as Uint8Array<ArrayBuffer>], { type: mime });
      return {
        filename: replaceExtension(name, outExt),
        mime,
        blob,
      };
    } finally {
      ff.off("progress", progressHandler);
      try {
        await ff.deleteFile(inName);
      } catch {
        /* best-effort */
      }
      try {
        await ff.deleteFile(outName);
      } catch {
        /* best-effort */
      }
    }
  },

  async probe(bytes: ArrayBuffer, fileExtension: string) {
    const ff = await loadFfmpeg();
    return probeWithFfmpeg(ff, bytes, fileExtension);
  },

  async extractFrameStrip(args: {
    bytes: ArrayBuffer;
    fileExtension: string;
    durationSec: number;
    sourceWidth: number;
    sourceHeight: number;
    count: number;
    heightPx: number;
  }) {
    const ff = await loadFfmpeg();
    return extractFrameStripInWorker({
      ff,
      fileBytes: args.bytes,
      fileExtension: args.fileExtension,
      durationSec: args.durationSec,
      sourceWidth: args.sourceWidth,
      sourceHeight: args.sourceHeight,
      count: args.count,
      heightPx: args.heightPx,
    });
  },
};

Comlink.expose(api);
```

- [ ] **Step 8.5: Write `index.ts`.**

```typescript
// src/engines/video-trim/index.ts
import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type VideoTrimOptions, defaultVideoTrimOptions } from "./options";
import { VideoTrimOptionsPanel } from "./options-panel";

const SUPPORTED_INPUT_MIMES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
];
const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB
const MIN_TRIM_SEC = 0.1;

let harness: WorkerHarness<VideoTrimOptions> | null = null;
export function getVideoTrimHarness(): WorkerHarness<VideoTrimOptions> {
  if (!harness) {
    harness = new WorkerHarness<VideoTrimOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
      { persistent: true },
    );
  }
  return harness;
}

export function disposeVideoTrimHarness(): void {
  harness?.dispose();
  harness = null;
}

const engine: SingleInputEngine<VideoTrimOptions, OutputItem> = {
  id: "video-trim",
  inputAccept: [".mp4", ".mov", ".webm", ".mkv"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "video/mp4",
  defaultOptions: defaultVideoTrimOptions,
  category: "video",
  library: "ffmpeg.wasm",
  license: "GPL-2.0-or-later",
  cardinality: "single",
  isReadyToConvert: (opts) =>
    opts.startSec >= 0 &&
    opts.endSec > opts.startSec &&
    opts.endSec - opts.startSec >= MIN_TRIM_SEC,
  OptionsPanel: VideoTrimOptionsPanel,
  validate(file) {
    const mimeOk = SUPPORTED_INPUT_MIMES.includes(file.type);
    const extOk = /\.(mp4|mov|webm|mkv)$/i.test(file.name);
    if (!mimeOk && !extOk) {
      return { ok: false, reason: "Expected an MP4, MOV, WebM, or MKV file" };
    }
    if (file.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        reason: `File too large for video-trim (limit 100 MB; got ${(file.size / 1_000_000).toFixed(1)} MB).`,
      };
    }
    return { ok: true };
  },
  async convert(file, opts, signal, runOpts) {
    const result = await getVideoTrimHarness().runSingle(file, opts, signal, runOpts);
    if (Array.isArray(result)) {
      const first = result[0];
      if (!first) throw new Error("video-trim: engine returned empty array");
      return first;
    }
    return result;
  },
};

export default engine;
```

- [ ] **Step 8.6: Write `options-panel.tsx`.**

```typescript
// src/engines/video-trim/options-panel.tsx
"use client";

import { TrimScrubber } from "@/engines/_shared/trim-scrubber";
import { readMediaDurationSec } from "@/engines/_shared/trim-scrubber/duration";
import type { OptionsPanelProps } from "@/engines/_shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { getVideoTrimHarness } from "./index";
import {
  containerSupportsCodecs,
  VIDEO_TRIM_CONTAINERS,
  type VideoTrimContainer,
  type VideoTrimOptions,
} from "./options";

type ProbeShape = {
  videoCodec: string | null;
  audioCodec: string | null;
};

export function VideoTrimOptionsPanel({
  value,
  onChange,
  file,
}: OptionsPanelProps<VideoTrimOptions>) {
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [probe, setProbe] = useState<ProbeShape | null>(null);

  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  });

  // Probe duration on the main thread (fast, doesn't need ffmpeg).
  useEffect(() => {
    let cancelled = false;
    if (!file) {
      setDurationSec(null);
      return;
    }
    setDurationSec(null);
    readMediaDurationSec(file, "video").then(
      (d) => {
        if (cancelled) return;
        setDurationSec(d);
        onChangeRef.current({ ...valueRef.current, startSec: 0, endSec: d });
      },
      () => {
        if (!cancelled) setDurationSec(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [file]);

  // Worker-backed probe for codec data (drives the disabled state of
  // the container dropdown). Cached in the harness so the engine's
  // convert path reuses the same probe without a second round-trip.
  useEffect(() => {
    let cancelled = false;
    if (!file) {
      setProbe(null);
      return;
    }
    setProbe(null);
    getVideoTrimHarness()
      .runProbe(file)
      .then(
        (p) => {
          if (cancelled) return;
          setProbe({ videoCodec: p.videoCodec, audioCodec: p.audioCodec });
        },
        () => {
          if (!cancelled) setProbe(null);
        },
      );
    return () => {
      cancelled = true;
    };
  }, [file]);

  const extractFramesThroughHarness = useCallback(
    async (f: File, count: number, heightPx: number) => {
      return getVideoTrimHarness().runExtractFrameStrip({ file: f, count, heightPx });
    },
    [],
  );

  return (
    <div
      data-testid="video-trim-options"
      className="mb-3 flex flex-col gap-3 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
          output container:
          <select
            aria-label="output container"
            data-testid="video-trim-container"
            value={value.containerFormat}
            onChange={(e) =>
              onChange({ ...value, containerFormat: e.target.value as VideoTrimContainer })
            }
            className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase"
          >
            {VIDEO_TRIM_CONTAINERS.map((fmt) => {
              const allowed =
                probe === null
                  ? fmt === "same"
                  : containerSupportsCodecs(fmt, probe.videoCodec, probe.audioCodec);
              const title =
                probe !== null && !allowed
                  ? `${fmt.toUpperCase()} can't hold ${probe.videoCodec ?? "this video's codec"}` +
                    (probe.audioCodec ? ` / ${probe.audioCodec}` : "")
                  : undefined;
              return (
                <option key={fmt} value={fmt} disabled={!allowed} title={title}>
                  {fmt}
                </option>
              );
            })}
          </select>
        </label>
        {probe === null && (
          <span className="text-[var(--color-fg-very-muted)]">detecting codecs…</span>
        )}
      </div>

      {file && durationSec !== null && durationSec > 0 && (
        <TrimScrubber
          source={file}
          modality="video"
          durationSec={durationSec}
          startSec={value.startSec}
          endSec={value.endSec}
          onChange={(start, end) => onChange({ ...value, startSec: start, endSec: end })}
          extractFrames={extractFramesThroughHarness}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 8.7: Write `index.test.ts`.**

```typescript
// src/engines/video-trim/index.test.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { __resetForTests, loadFfmpeg } from "@/engines/_shared/ffmpeg";
import { probeWithFfmpeg } from "@/engines/_shared/ffmpeg/probe";
import engine, { disposeVideoTrimHarness } from "./index";

const FIXTURES_DIR = path.resolve(__dirname, "../../../tests/fixtures/video");

function fixtureFile(name: string, mime: string): File {
  const buf = readFileSync(path.join(FIXTURES_DIR, name));
  return new File([buf], name, { type: mime });
}

afterEach(() => {
  disposeVideoTrimHarness();
  __resetForTests();
});

describe("video-trim engine — validate", () => {
  it("accepts MP4 by MIME", () => {
    const f = fixtureFile("sample-h264-aac.mp4", "video/mp4");
    expect(engine.validate(f)).toEqual({ ok: true });
  });

  it("accepts WebM/MOV/MKV by MIME", () => {
    expect(engine.validate(fixtureFile("sample-vp9-opus.webm", "video/webm"))).toEqual({ ok: true });
    expect(engine.validate(fixtureFile("sample-h264.mov", "video/quicktime"))).toEqual({ ok: true });
    expect(engine.validate(fixtureFile("sample-hevc-aac.mkv", "video/x-matroska"))).toEqual({
      ok: true,
    });
  });

  it("falls back to extension when MIME is missing", () => {
    const f = fixtureFile("sample-h264-aac.mp4", "");
    expect(engine.validate(f)).toEqual({ ok: true });
  });

  it("rejects an unsupported file type", () => {
    const f = new File([new Uint8Array([1, 2, 3])], "song.mp3", { type: "audio/mpeg" });
    const r = engine.validate(f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/MP4, MOV, WebM, or MKV/);
  });

  it("rejects oversized files", () => {
    const big = new Uint8Array(101 * 1024 * 1024);
    const f = new File([big], "big.mp4", { type: "video/mp4" });
    const r = engine.validate(f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/File too large/);
  });
});

describe("video-trim engine — convert (correctness)", () => {
  it('trims sample-h264-aac.mp4 to [1, 3] with containerFormat "same"', async () => {
    const f = fixtureFile("sample-h264-aac.mp4", "video/mp4");
    const ac = new AbortController();
    const out = await engine.convert(
      f,
      { startSec: 1, endSec: 3, containerFormat: "same" },
      ac.signal,
      {},
    );
    expect(out.filename).toBe("sample-h264-aac-trimmed.mp4");
    expect(out.mime).toBe("video/mp4");
    expect(out.blob.size).toBeGreaterThan(0);

    // Re-probe the output to confirm duration ≈ 2s (allow ±0.7s for keyframe snap).
    const ff = await loadFfmpeg();
    const probe = await probeWithFfmpeg(ff, await out.blob.arrayBuffer(), ".mp4");
    expect(probe.durationSec).toBeGreaterThan(1.3);
    expect(probe.durationSec).toBeLessThan(2.7);
  }, 120_000);

  it('remuxes into MKV when containerFormat="mkv"', async () => {
    const f = fixtureFile("sample-h264-aac.mp4", "video/mp4");
    const ac = new AbortController();
    const out = await engine.convert(
      f,
      { startSec: 1, endSec: 3, containerFormat: "mkv" },
      ac.signal,
      {},
    );
    expect(out.filename).toBe("sample-h264-aac-trimmed.mkv");
    expect(out.mime).toBe("video/x-matroska");
    expect(out.blob.size).toBeGreaterThan(0);
  }, 120_000);
});
```

- [ ] **Step 8.8: Write `options-panel.test.tsx`.**

```typescript
// src/engines/video-trim/options-panel.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultVideoTrimOptions } from "./options";
import { VideoTrimOptionsPanel } from "./options-panel";

vi.mock("./index", () => ({
  getVideoTrimHarness: () => ({
    runProbe: vi.fn().mockResolvedValue({
      durationSec: 5,
      videoCodec: "vp9",
      audioCodec: "opus",
      width: 320,
      height: 180,
      hasAudio: true,
    }),
    runExtractFrameStrip: vi.fn().mockResolvedValue({ urls: [], widthPx: 107 }),
  }),
}));

vi.mock("@/engines/_shared/trim-scrubber/duration", () => ({
  readMediaDurationSec: vi.fn().mockResolvedValue(5),
}));

describe("VideoTrimOptionsPanel", () => {
  it('renders the container <select> with all four entries', async () => {
    const file = new File([new Uint8Array([1])], "x.webm", { type: "video/webm" });
    render(
      <VideoTrimOptionsPanel
        value={defaultVideoTrimOptions}
        onChange={() => {}}
        file={file}
      />,
    );
    const select = await screen.findByTestId("video-trim-container");
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    expect(options).toEqual(["same", "mp4", "webm", "mkv"]);
  });

  it('disables MP4 when probe reports VP9 + Opus', async () => {
    const file = new File([new Uint8Array([1])], "x.webm", { type: "video/webm" });
    render(
      <VideoTrimOptionsPanel
        value={defaultVideoTrimOptions}
        onChange={() => {}}
        file={file}
      />,
    );
    const select = await screen.findByTestId("video-trim-container");
    await waitFor(() => {
      const mp4 = select.querySelector('option[value="mp4"]') as HTMLOptionElement;
      expect(mp4.disabled).toBe(true);
    });
    const same = select.querySelector('option[value="same"]') as HTMLOptionElement;
    const mkv = select.querySelector('option[value="mkv"]') as HTMLOptionElement;
    const webm = select.querySelector('option[value="webm"]') as HTMLOptionElement;
    expect(same.disabled).toBe(false);
    expect(mkv.disabled).toBe(false);
    expect(webm.disabled).toBe(false);
  });
});
```

- [ ] **Step 8.9: Write the route.**

Create `src/app/tools/video-trim/page.tsx`:

```typescript
"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine, { disposeVideoTrimHarness } from "@/engines/video-trim";
import { useEffect } from "react";

export default function VideoTrimPage() {
  useEffect(() => {
    return () => disposeVideoTrimHarness();
  }, []);

  return <ToolFrame engine={engine} />;
}
```

- [ ] **Step 8.10: Add to registry.**

In `src/engines/_shared/registry.ts`, add `"video-trim"` to the `EngineId` union (alphabetical position) and to the `REGISTRY` map:

```typescript
"video-trim": () => import("@/engines/video-trim"),
```

- [ ] **Step 8.11: Run all video-trim tests.**

```bash
pnpm test src/engines/video-trim/ src/engines/_shared/
```

Expected: every case passes — including the slow correctness cases (Step 8.7) which load ffmpeg and may take 30-90 seconds.

If a correctness test's keyframe-snap tolerance fails (output duration outside 1.3-2.7s), inspect the actual duration and either widen the tolerance or adjust the trim window — H.264/2s GOP from `testsrc` may produce different snap points.

- [ ] **Step 8.12: Commit.**

```bash
git add src/engines/video-trim/ \
        src/app/tools/video-trim/ \
        src/engines/_shared/registry.ts
git commit -m "$(cat <<'EOF'
feat(phase-22): video-trim engine

Single-input engine, 100 MB cap, ffmpeg -c copy only with
user-selectable output container (same|mp4|webm|mkv) constrained by
probe-driven codec compatibility. Reuses _shared/trim-scrubber video
render path. Worker exposes convertSingle + probe + extractFrameStrip
so OptionsPanel and TrimScrubber share the same ffmpeg singleton via
WorkerHarness.runProbe and runExtractFrameStrip.
EOF
)"
```

---

## Task 9: Build the `video-extract-audio` engine

**Why:** Second of the two new engines. Mirrors `video-trim`'s shape but with no scrubber and the audio-format output dropdown reused from `_shared/audio/format`.

**Files:**
- Create: `src/engines/video-extract-audio/options.ts`
- Create: `src/engines/video-extract-audio/options.test.ts`
- Create: `src/engines/video-extract-audio/worker.ts`
- Create: `src/engines/video-extract-audio/index.ts`
- Create: `src/engines/video-extract-audio/index.test.ts`
- Create: `src/engines/video-extract-audio/options-panel.tsx`
- Create: `src/engines/video-extract-audio/options-panel.test.tsx`

- [ ] **Step 9.1: Write `options.ts`.**

```typescript
// src/engines/video-extract-audio/options.ts
import {
  AUDIO_BITRATE_OPTIONS,
  isLossy,
  OUTPUT_EXTENSION,
  OUTPUT_MIME,
  type AudioBitrate,
  type AudioFormat,
} from "@/engines/_shared/audio/format";

export type VideoExtractAudioFormat = "same" | AudioFormat;

export type VideoExtractAudioOptions = {
  outputFormat: VideoExtractAudioFormat;
  bitrate: AudioBitrate;
};

export const VIDEO_EXTRACT_AUDIO_FORMATS: ReadonlyArray<VideoExtractAudioFormat> = [
  "same",
  "mp3",
  "wav",
  "m4a",
  "flac",
];

export const defaultVideoExtractAudioOptions: VideoExtractAudioOptions = {
  outputFormat: "same",
  bitrate: 192,
};

export { AUDIO_BITRATE_OPTIONS, isLossy, OUTPUT_EXTENSION, OUTPUT_MIME };

// Container/extension for "same" output is decided at runtime from the
// probe's audioCodec. This table maps probed audio codec → output
// extension and MIME for the -c copy path.
export const SAME_OUTPUT_FOR_CODEC: Record<string, { ext: string; mime: string }> = {
  aac: { ext: "m4a", mime: "audio/mp4" },
  mp3: { ext: "mp3", mime: "audio/mpeg" },
  opus: { ext: "opus", mime: "audio/ogg" },
  vorbis: { ext: "ogg", mime: "audio/ogg" },
  flac: { ext: "flac", mime: "audio/flac" },
  pcm_s16le: { ext: "wav", mime: "audio/wav" },
  pcm_s16be: { ext: "wav", mime: "audio/wav" },
  pcm_f32le: { ext: "wav", mime: "audio/wav" },
};

export const SAME_OUTPUT_FALLBACK = { ext: "mka", mime: "audio/x-matroska" };

export function sameOutputFor(codec: string | null): { ext: string; mime: string } {
  if (!codec) return SAME_OUTPUT_FALLBACK;
  return SAME_OUTPUT_FOR_CODEC[codec] ?? SAME_OUTPUT_FALLBACK;
}
```

- [ ] **Step 9.2: Write `options.test.ts`.**

```typescript
// src/engines/video-extract-audio/options.test.ts
import { describe, expect, it } from "vitest";
import {
  defaultVideoExtractAudioOptions,
  isLossy,
  sameOutputFor,
  SAME_OUTPUT_FALLBACK,
  VIDEO_EXTRACT_AUDIO_FORMATS,
} from "./options";

describe("video-extract-audio options", () => {
  it("default is same / 192 kbps", () => {
    expect(defaultVideoExtractAudioOptions).toEqual({
      outputFormat: "same",
      bitrate: 192,
    });
  });

  it("format list mirrors audio-trim exactly", () => {
    expect(VIDEO_EXTRACT_AUDIO_FORMATS).toEqual(["same", "mp3", "wav", "m4a", "flac"]);
  });

  it("re-exports isLossy from _shared/audio/format", () => {
    expect(isLossy("mp3")).toBe(true);
    expect(isLossy("wav")).toBe(false);
  });

  it("sameOutputFor maps common audio codecs to canonical containers", () => {
    expect(sameOutputFor("aac")).toEqual({ ext: "m4a", mime: "audio/mp4" });
    expect(sameOutputFor("mp3")).toEqual({ ext: "mp3", mime: "audio/mpeg" });
    expect(sameOutputFor("opus")).toEqual({ ext: "opus", mime: "audio/ogg" });
    expect(sameOutputFor("vorbis")).toEqual({ ext: "ogg", mime: "audio/ogg" });
    expect(sameOutputFor("flac")).toEqual({ ext: "flac", mime: "audio/flac" });
    expect(sameOutputFor("pcm_s16le")).toEqual({ ext: "wav", mime: "audio/wav" });
  });

  it("sameOutputFor falls back to mka for unknown codecs and null", () => {
    expect(sameOutputFor("ac3")).toEqual(SAME_OUTPUT_FALLBACK);
    expect(sameOutputFor(null)).toEqual(SAME_OUTPUT_FALLBACK);
    expect(SAME_OUTPUT_FALLBACK).toEqual({ ext: "mka", mime: "audio/x-matroska" });
  });
});
```

- [ ] **Step 9.3: Run options tests to confirm they pass.**

```bash
pnpm test src/engines/video-extract-audio/options.test.ts
```

Expected: PASS — 5 cases.

- [ ] **Step 9.4: Write `worker.ts`.**

```typescript
// src/engines/video-extract-audio/worker.ts
import { loadFfmpeg } from "@/engines/_shared/ffmpeg";
import { probeWithFfmpeg } from "@/engines/_shared/ffmpeg/probe";
import type { ConversionProgress, OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import {
  isLossy,
  OUTPUT_EXTENSION,
  OUTPUT_MIME,
  sameOutputFor,
  type VideoExtractAudioOptions,
} from "./options";

function ffmpegCodec(fmt: "mp3" | "wav" | "m4a" | "flac"): string {
  switch (fmt) {
    case "mp3":
      return "libmp3lame";
    case "wav":
      return "pcm_s16le";
    case "m4a":
      return "aac";
    case "flac":
      return "flac";
    default: {
      const _exhaustive: never = fmt;
      throw new Error(`video-extract-audio: unknown output format: ${_exhaustive}`);
    }
  }
}

function replaceWithSuffix(name: string, newExt: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}-audio.${newExt}`;
}

const api = {
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    _type: string,
    opts: VideoExtractAudioOptions,
    onProgress?: (p: ConversionProgress) => void,
  ): Promise<OutputItem> {
    onProgress?.({ kind: "model-loading", loaded: 0, total: 1 });
    const ff = await loadFfmpeg();
    onProgress?.({ kind: "model-loading", loaded: 1, total: 1 });

    let outExt: string;
    let outMime: string;
    if (opts.outputFormat === "same") {
      const probe = await probeWithFfmpeg(ff, bytes, name);
      const target = sameOutputFor(probe.audioCodec);
      outExt = target.ext;
      outMime = target.mime;
    } else {
      outExt = OUTPUT_EXTENSION[opts.outputFormat];
      outMime = OUTPUT_MIME[opts.outputFormat];
    }

    const progressHandler = ({ progress }: { progress: number; time: number }) => {
      onProgress?.({ kind: "inference", pct: Math.max(0, Math.min(100, progress * 100)) });
    };
    ff.on("progress", progressHandler);

    const inExt = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "bin").toLowerCase();
    const id = crypto.randomUUID();
    const inName = `in_${id}.${inExt}`;
    const outName = `out_${id}.${outExt}`;

    try {
      await ff.writeFile(inName, new Uint8Array(bytes));
      onProgress?.({ kind: "inference", pct: 0 });

      const args: string[] = ["-i", inName, "-vn"];
      if (opts.outputFormat === "same") {
        args.push("-c:a", "copy");
      } else {
        const codec = ffmpegCodec(opts.outputFormat);
        if (isLossy(opts.outputFormat)) {
          args.push("-b:a", `${opts.bitrate}k`);
        }
        args.push("-c:a", codec);
      }
      args.push(outName);

      const exit = await ff.exec(args);
      if (exit !== 0) {
        throw new Error(`video-extract-audio: ffmpeg exited with code ${exit}`);
      }
      onProgress?.({ kind: "inference", pct: 100 });

      const out = await ff.readFile(outName);
      if (typeof out === "string") {
        throw new Error("video-extract-audio: ffmpeg returned text output unexpectedly");
      }
      const blob = new Blob([out as Uint8Array<ArrayBuffer>], { type: outMime });
      return {
        filename: replaceWithSuffix(name, outExt),
        mime: outMime,
        blob,
      };
    } finally {
      ff.off("progress", progressHandler);
      try {
        await ff.deleteFile(inName);
      } catch {
        /* best-effort */
      }
      try {
        await ff.deleteFile(outName);
      } catch {
        /* best-effort */
      }
    }
  },

  async probe(bytes: ArrayBuffer, fileExtension: string) {
    const ff = await loadFfmpeg();
    return probeWithFfmpeg(ff, bytes, fileExtension);
  },
};

Comlink.expose(api);
```

- [ ] **Step 9.5: Write `index.ts`.**

```typescript
// src/engines/video-extract-audio/index.ts
import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import {
  defaultVideoExtractAudioOptions,
  type VideoExtractAudioOptions,
} from "./options";
import { VideoExtractAudioOptionsPanel } from "./options-panel";

const SUPPORTED_INPUT_MIMES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
];
const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

let harness: WorkerHarness<VideoExtractAudioOptions> | null = null;
export function getVideoExtractAudioHarness(): WorkerHarness<VideoExtractAudioOptions> {
  if (!harness) {
    harness = new WorkerHarness<VideoExtractAudioOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
      { persistent: true },
    );
  }
  return harness;
}

export function disposeVideoExtractAudioHarness(): void {
  harness?.dispose();
  harness = null;
}

const engine: SingleInputEngine<VideoExtractAudioOptions, OutputItem> = {
  id: "video-extract-audio",
  inputAccept: [".mp4", ".mov", ".webm", ".mkv"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "audio/mpeg",
  defaultOptions: defaultVideoExtractAudioOptions,
  category: "video",
  library: "ffmpeg.wasm",
  license: "GPL-2.0-or-later",
  cardinality: "single",
  isReadyToConvert: () => true,
  OptionsPanel: VideoExtractAudioOptionsPanel,
  validate(file) {
    const mimeOk = SUPPORTED_INPUT_MIMES.includes(file.type);
    const extOk = /\.(mp4|mov|webm|mkv)$/i.test(file.name);
    if (!mimeOk && !extOk) {
      return { ok: false, reason: "Expected an MP4, MOV, WebM, or MKV file" };
    }
    if (file.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        reason: `File too large for video-extract-audio (limit 100 MB; got ${(file.size / 1_000_000).toFixed(1)} MB).`,
      };
    }
    return { ok: true };
  },
  async convert(file, opts, signal, runOpts) {
    // Upfront no-audio guard via the cached probe. Runs once per file
    // because runProbe deduplicates per File identity.
    const probe = await getVideoExtractAudioHarness().runProbe(file);
    if (!probe.hasAudio) {
      throw new Error("This video has no audio track");
    }
    const result = await getVideoExtractAudioHarness().runSingle(file, opts, signal, runOpts);
    if (Array.isArray(result)) {
      const first = result[0];
      if (!first) throw new Error("video-extract-audio: engine returned empty array");
      return first;
    }
    return result;
  },
};

export default engine;
```

- [ ] **Step 9.6: Write `options-panel.tsx`.**

```typescript
// src/engines/video-extract-audio/options-panel.tsx
"use client";

import type { OptionsPanelProps } from "@/engines/_shared/types";
import {
  AUDIO_BITRATE_OPTIONS,
  isLossy,
  type VideoExtractAudioFormat,
  type VideoExtractAudioOptions,
  VIDEO_EXTRACT_AUDIO_FORMATS,
} from "./options";

export function VideoExtractAudioOptionsPanel({
  value,
  onChange,
}: OptionsPanelProps<VideoExtractAudioOptions>) {
  const showBitrate =
    value.outputFormat !== "same" &&
    isLossy(value.outputFormat as Exclude<VideoExtractAudioFormat, "same">);

  return (
    <div
      data-testid="video-extract-audio-options"
      className="mb-3 flex flex-col gap-3 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
          output format:
          <select
            aria-label="output format"
            data-testid="video-extract-audio-format"
            value={value.outputFormat}
            onChange={(e) =>
              onChange({
                ...value,
                outputFormat: e.target.value as VideoExtractAudioFormat,
              })
            }
            className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase"
          >
            {VIDEO_EXTRACT_AUDIO_FORMATS.map((fmt) => (
              <option key={fmt} value={fmt}>
                {fmt}
              </option>
            ))}
          </select>
        </label>

        {showBitrate && (
          <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
            bitrate:
            <select
              aria-label="bitrate"
              data-testid="video-extract-audio-bitrate"
              value={value.bitrate}
              onChange={(e) =>
                onChange({
                  ...value,
                  bitrate: Number(e.target.value) as (typeof AUDIO_BITRATE_OPTIONS)[number],
                })
              }
              className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase"
            >
              {AUDIO_BITRATE_OPTIONS.map((kbps) => (
                <option key={kbps} value={kbps}>
                  {kbps} kbps
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 9.7: Write `index.test.ts`.**

```typescript
// src/engines/video-extract-audio/index.test.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { __resetForTests, loadFfmpeg } from "@/engines/_shared/ffmpeg";
import { probeWithFfmpeg } from "@/engines/_shared/ffmpeg/probe";
import engine, { disposeVideoExtractAudioHarness } from "./index";

const FIXTURES_DIR = path.resolve(__dirname, "../../../tests/fixtures/video");

function fixtureFile(name: string, mime: string): File {
  const buf = readFileSync(path.join(FIXTURES_DIR, name));
  return new File([buf], name, { type: mime });
}

afterEach(() => {
  disposeVideoExtractAudioHarness();
  __resetForTests();
});

describe("video-extract-audio engine — validate", () => {
  it("accepts MP4 / MOV / WebM / MKV", () => {
    expect(engine.validate(fixtureFile("sample-h264-aac.mp4", "video/mp4"))).toEqual({ ok: true });
    expect(engine.validate(fixtureFile("sample-h264.mov", "video/quicktime"))).toEqual({ ok: true });
    expect(engine.validate(fixtureFile("sample-vp9-opus.webm", "video/webm"))).toEqual({ ok: true });
    expect(engine.validate(fixtureFile("sample-hevc-aac.mkv", "video/x-matroska"))).toEqual({
      ok: true,
    });
  });

  it("rejects oversize and bad MIME", () => {
    const big = new File([new Uint8Array(101 * 1024 * 1024)], "big.mp4", { type: "video/mp4" });
    expect(engine.validate(big).ok).toBe(false);
    const wrong = new File([new Uint8Array([1])], "x.mp3", { type: "audio/mpeg" });
    expect(engine.validate(wrong).ok).toBe(false);
  });
});

describe("video-extract-audio engine — convert (correctness)", () => {
  it('extracts AAC audio with outputFormat="same" → .m4a', async () => {
    const f = fixtureFile("sample-h264-aac.mp4", "video/mp4");
    const ac = new AbortController();
    const out = await engine.convert(
      f,
      { outputFormat: "same", bitrate: 192 },
      ac.signal,
      {},
    );
    expect(out.filename).toBe("sample-h264-aac-audio.m4a");
    expect(out.mime).toBe("audio/mp4");

    const ff = await loadFfmpeg();
    const probe = await probeWithFfmpeg(ff, await out.blob.arrayBuffer(), ".m4a");
    expect(probe.audioCodec).toBe("aac");
    expect(probe.videoCodec).toBeNull();
  }, 120_000);

  it('re-encodes to MP3 with outputFormat="mp3"', async () => {
    const f = fixtureFile("sample-h264-aac.mp4", "video/mp4");
    const ac = new AbortController();
    const out = await engine.convert(
      f,
      { outputFormat: "mp3", bitrate: 128 },
      ac.signal,
      {},
    );
    expect(out.filename).toBe("sample-h264-aac-audio.mp3");
    expect(out.mime).toBe("audio/mpeg");
    expect(out.blob.size).toBeGreaterThan(0);
  }, 120_000);

  it('rejects no-audio source', async () => {
    const f = fixtureFile("sample-no-audio.mp4", "video/mp4");
    const ac = new AbortController();
    await expect(
      engine.convert(f, { outputFormat: "same", bitrate: 192 }, ac.signal, {}),
    ).rejects.toThrow(/no audio track/);
  }, 120_000);

  it('extracts Opus audio with outputFormat="same" → .opus', async () => {
    const f = fixtureFile("sample-vp9-opus.webm", "video/webm");
    const ac = new AbortController();
    const out = await engine.convert(
      f,
      { outputFormat: "same", bitrate: 192 },
      ac.signal,
      {},
    );
    expect(out.filename).toBe("sample-vp9-opus-audio.opus");
    expect(out.mime).toBe("audio/ogg");
  }, 120_000);
});
```

- [ ] **Step 9.8: Write `options-panel.test.tsx`.**

```typescript
// src/engines/video-extract-audio/options-panel.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultVideoExtractAudioOptions } from "./options";
import { VideoExtractAudioOptionsPanel } from "./options-panel";

describe("VideoExtractAudioOptionsPanel", () => {
  it('renders the format select with five options', () => {
    render(
      <VideoExtractAudioOptionsPanel
        value={defaultVideoExtractAudioOptions}
        onChange={() => {}}
        file={null}
      />,
    );
    const opts = Array.from(
      screen.getByTestId("video-extract-audio-format").querySelectorAll("option"),
    ).map((o) => o.value);
    expect(opts).toEqual(["same", "mp3", "wav", "m4a", "flac"]);
  });

  it('hides the bitrate select for "same", "wav", "flac" and shows it for "mp3", "m4a"', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <VideoExtractAudioOptionsPanel
        value={defaultVideoExtractAudioOptions}
        onChange={onChange}
        file={null}
      />,
    );
    expect(screen.queryByTestId("video-extract-audio-bitrate")).toBeNull();

    rerender(
      <VideoExtractAudioOptionsPanel
        value={{ ...defaultVideoExtractAudioOptions, outputFormat: "mp3" }}
        onChange={onChange}
        file={null}
      />,
    );
    expect(screen.getByTestId("video-extract-audio-bitrate")).toBeInTheDocument();

    rerender(
      <VideoExtractAudioOptionsPanel
        value={{ ...defaultVideoExtractAudioOptions, outputFormat: "wav" }}
        onChange={onChange}
        file={null}
      />,
    );
    expect(screen.queryByTestId("video-extract-audio-bitrate")).toBeNull();
  });
});
```

- [ ] **Step 9.9: Write the route.**

Create `src/app/tools/video-extract-audio/page.tsx`:

```typescript
"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine, { disposeVideoExtractAudioHarness } from "@/engines/video-extract-audio";
import { useEffect } from "react";

export default function VideoExtractAudioPage() {
  useEffect(() => {
    return () => disposeVideoExtractAudioHarness();
  }, []);

  return <ToolFrame engine={engine} />;
}
```

- [ ] **Step 9.10: Add to registry.**

In `src/engines/_shared/registry.ts`, add `"video-extract-audio"` to the `EngineId` union (alphabetical position, immediately after `"video-trim"`) and to the `REGISTRY` map:

```typescript
"video-extract-audio": () => import("@/engines/video-extract-audio"),
```

- [ ] **Step 9.11: Run all video-extract-audio tests.**

```bash
pnpm test src/engines/video-extract-audio/
```

Expected: every case passes — including the 4 correctness cases that load ffmpeg.

- [ ] **Step 9.12: Commit.**

```bash
git add src/engines/video-extract-audio/ \
        src/app/tools/video-extract-audio/ \
        src/engines/_shared/registry.ts
git commit -m "$(cat <<'EOF'
feat(phase-22): video-extract-audio engine

Single-input engine, 100 MB cap, mirrors audio-trim's output format
menu (same|mp3|wav|m4a|flac, default same). "same" -c copy's the
source audio stream into a codec-appropriate container (m4a / mp3 /
opus / ogg / flac / wav, with .mka fallback for rare codecs).
Re-encode paths share libmp3lame / aac / flac / pcm_s16le helpers
with audio-trim. Convert-time guard rejects no-audio sources.
EOF
)"
```

---

## Task 10: Wire navigation surfaces (sidebar + home grid + COOP/COEP catalog)

**Why:** Discoverability + the COOP/COEP regression suite needs to know the new routes.

**Files:**
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/app/page.tsx`
- Modify: `tests/e2e/coop-coep.spec.ts`

- [ ] **Step 10.1: Add a `VIDEO` group to `sidebar.tsx`.**

In `src/components/layout/sidebar.tsx`:

1. Add two entries to the `TOOLS` array (placed after the AUDIO entries):

```typescript
{ id: "video-trim", href: "/tools/video-trim", label: "video trim", group: "VIDEO" },
{ id: "video-extract-audio", href: "/tools/video-extract-audio", label: "video → audio", group: "VIDEO" },
```

2. Update `GROUP_ORDER` to include `"VIDEO"` between `"AUDIO"` and `"ABOUT"`:

```typescript
const GROUP_ORDER = ["HOME", "IMAGES", "PDFS", "DOCS", "AUDIO", "VIDEO", "ABOUT"] as const;
```

3. If `src/components/layout/sidebar.test.tsx` exists and asserts a tool count, increment by 2.

- [ ] **Step 10.2: Add two cards to the home grid.**

In `src/app/page.tsx`, append to the `TOOLS` array:

```typescript
{
  id: "video-trim",
  title: "video trim",
  description: "mp4, mov, webm, mkv · trim to a sub-range, lossless via -c copy",
  href: "/tools/video-trim",
},
{
  id: "video-extract-audio",
  title: "video → audio",
  description: "mp4, mov, webm, mkv · pull the audio track, lossless when possible",
  href: "/tools/video-extract-audio",
},
```

If `src/app/page.test.tsx` exists and asserts a tool count, increment by 2.

- [ ] **Step 10.3: Append the new routes to the COOP/COEP catalog.**

In `tests/e2e/coop-coep.spec.ts`:

1. Add `"/tools/video-trim"` and `"/tools/video-extract-audio"` to `TOOL_ROUTES` (alphabetical order — they go between `/tools/txt-to-pdf` and any `/tools/audio-*` entries; alphabetical-by-id means after `/tools/txt-to-pdf`).

2. Remove the stale comment block at the top about Phase 20 audio-trim rebase.

Final `TOOL_ROUTES`:

```typescript
const TOOL_ROUTES = [
  "/tools/audio-convert",
  "/tools/audio-trim",
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
  "/tools/video-extract-audio",
  "/tools/video-trim",
] as const;
```

- [ ] **Step 10.4: Run the affected unit tests.**

```bash
pnpm test src/components/layout/ src/app/
```

Expected: all pass. If a count assertion fails, fix the asserted number to match the new total.

- [ ] **Step 10.5: Commit.**

```bash
git add src/components/layout/sidebar.tsx \
        src/app/page.tsx \
        tests/e2e/coop-coep.spec.ts
git commit -m "$(cat <<'EOF'
feat(phase-22): sidebar VIDEO group + home cards + coop-coep catalog

Sidebar gains a VIDEO group sandwiched between AUDIO and ABOUT.
Home grid gains two video tool cards. COOP/COEP regression catalog
adds /tools/video-trim and /tools/video-extract-audio.
EOF
)"
```

---

## Task 11: E2E specs (route + correctness + privacy)

**Why:** Catch UI regressions in default test runs; gate the slow real-conversion specs behind env vars; reaffirm privacy invariant.

**Files:**
- Create: `tests/e2e/video-trim.spec.ts`
- Create: `tests/e2e/video-trim-correctness.spec.ts`
- Create: `tests/e2e/video-extract-audio.spec.ts`
- Create: `tests/e2e/video-extract-audio-correctness.spec.ts`
- Create: `tests/e2e/privacy-regression-video-trim.spec.ts`

- [ ] **Step 11.1: Read the audio-trim E2E specs as templates.**

```bash
cat tests/e2e/audio-trim.spec.ts
cat tests/e2e/audio-trim-correctness.spec.ts
cat tests/e2e/privacy-regression-audio-trim.spec.ts
```

Note the structure: route specs check the page renders + key UI elements without invoking ffmpeg; correctness specs gate behind `RUN_*_CORRECTNESS=1`; privacy specs assert zero off-origin requests.

- [ ] **Step 11.2: Write `tests/e2e/video-trim.spec.ts`.**

Match the audio-trim route spec structurally. Assertions:

- `/tools/video-trim` loads, shows the tool frame, the dropzone is visible.
- The page title contains "video trim" (or whatever convention the audio-trim spec uses).
- No `console.error` during initial page load.

(Drop-and-convert flow stays in the correctness spec to keep the default suite fast.)

- [ ] **Step 11.3: Write `tests/e2e/video-trim-correctness.spec.ts`.**

Gated by `process.env.RUN_VIDEO_TRIM_CORRECTNESS === "1"` (use `test.skip(condition)`). Drives the dropzone with `tests/fixtures/video/sample-h264-aac.mp4`, waits for the scrubber strip to render (>= 1 `<img>` inside `[data-testid="trim-scrubber-frame-strip"]`), keyboard-drags the in-handle 25 times right and the out-handle 25 times left, clicks Convert, asserts a download fires with the `.mp4` extension within 30 seconds. Reuse helpers from `tests/e2e/audio-trim-correctness.spec.ts` if any are exported.

- [ ] **Step 11.4: Write `tests/e2e/video-extract-audio.spec.ts`.**

Same structure as `video-trim.spec.ts` but for `/tools/video-extract-audio`. Assert format `<select>` shows five options matching `["same","mp3","wav","m4a","flac"]`.

- [ ] **Step 11.5: Write `tests/e2e/video-extract-audio-correctness.spec.ts`.**

Gated by `process.env.RUN_VIDEO_EXTRACT_AUDIO_CORRECTNESS === "1"`. Drives `sample-h264-aac.mp4`, leaves default options, clicks Convert, asserts a download with `.m4a`. Then re-stage and pick `"mp3"` from the format select, click Convert, assert download with `.mp3`.

- [ ] **Step 11.6: Write `tests/e2e/privacy-regression-video-trim.spec.ts`.**

Mirror `tests/e2e/privacy-regression-audio-trim.spec.ts`. Listen for outbound requests during a real video-trim conversion; assert zero requests go off-origin (everything stays under the test server's origin and `/ffmpeg/`).

- [ ] **Step 11.7: Run the default E2E suite (no correctness gates).**

```bash
pnpm test:e2e tests/e2e/video-trim.spec.ts \
              tests/e2e/video-extract-audio.spec.ts \
              tests/e2e/coop-coep.spec.ts
```

Expected: all pass on Chromium + Firefox + WebKit.

- [ ] **Step 11.8: Run the gated correctness specs.**

```bash
RUN_VIDEO_TRIM_CORRECTNESS=1 pnpm test:e2e tests/e2e/video-trim-correctness.spec.ts
RUN_VIDEO_EXTRACT_AUDIO_CORRECTNESS=1 pnpm test:e2e tests/e2e/video-extract-audio-correctness.spec.ts
pnpm test:e2e tests/e2e/privacy-regression-video-trim.spec.ts
```

Expected: all pass. Each correctness spec may take 60-180 seconds per browser due to ffmpeg load + conversion.

- [ ] **Step 11.9: Commit.**

```bash
git add tests/e2e/video-trim.spec.ts \
        tests/e2e/video-trim-correctness.spec.ts \
        tests/e2e/video-extract-audio.spec.ts \
        tests/e2e/video-extract-audio-correctness.spec.ts \
        tests/e2e/privacy-regression-video-trim.spec.ts
git commit -m "$(cat <<'EOF'
test(phase-22): e2e for video-trim, video-extract-audio, privacy

Default suite covers route load + UI structure for both tools.
Correctness specs (gated by RUN_VIDEO_TRIM_CORRECTNESS=1 and
RUN_VIDEO_EXTRACT_AUDIO_CORRECTNESS=1) drive a real conversion end
to end. Privacy regression spec asserts zero off-origin requests
during a real video-trim conversion.
EOF
)"
```

---

## Task 12: Final verification

**Why:** Catch any stale type, lint, build, or bundle-isolation regression before declaring Phase 22 done.

**Files:** none (read-only verification).

- [ ] **Step 12.1: Verify branch + diff scope.**

```bash
git rev-parse --abbrev-ref HEAD
git diff --stat main...HEAD | tail -40
```

Expected: branch is `phase-22-video-trim-and-extract-audio`. Diff shows only the files listed in this plan's File map. NO changes to `vercel.json`, `package.json`, `pnpm-lock.yaml`, `next.config.ts`, `scripts/copy-ffmpeg-core.mjs`, `scripts/ffmpeg-manifest.json`, or `src/engines/_shared/ffmpeg/index.ts`.

If the diff touches any of those files, STOP and unstage / revert — those are protected by Phase 21's contract.

- [ ] **Step 12.2: Run typecheck.**

```bash
pnpm typecheck
```

Expected: zero errors.

- [ ] **Step 12.3: Run lint.**

```bash
pnpm lint
```

Expected: zero errors. `src/engines/video-trim/`, `src/engines/video-extract-audio/`, and the new `_shared/` files contain no `fetch` / `XMLHttpRequest` (the project's Biome rule blocks these inside `src/engines/`).

- [ ] **Step 12.4: Run the full unit + integration suite.**

```bash
pnpm test
```

Expected: every test passes. If memory is tight, fall back to `pnpm test --pool=threads --poolOptions.threads.maxThreads=2`.

- [ ] **Step 12.5: Run a production build to exercise bundle-isolation.**

```bash
pnpm build
```

Expected: build succeeds. The `postbuild` hook runs `scripts/check-bundle-isolation.mjs` and reports zero engine leaks for `video-trim` and `video-extract-audio` (both should appear under "isolated" in the output if the script prints a per-engine report). If either engine leaks ffmpeg into the homepage chunk, inspect what `_shared/` modules they import statically and convert any runtime imports to `await import(...)`.

- [ ] **Step 12.6: Run the COOP/COEP gate end-to-end.**

```bash
pnpm test:e2e tests/e2e/coop-coep.spec.ts
```

Expected: every route in the catalog (now including the two new ones) passes the COOP same-origin + COEP require-corp + `crossOriginIsolated === true` assertions across all three browsers.

- [ ] **Step 12.7: Manual Chrome smoke (per CLAUDE.md "Chrome QA workflow" convention).**

```bash
pnpm dev
# In Chrome, visit:
#   http://localhost:3000/                    — confirm two new home cards
#   http://localhost:3000/tools/video-trim    — drop sample-h264-aac.mp4, scrubber should render frame strip
#   http://localhost:3000/tools/video-extract-audio — drop sample-h264-aac.mp4, format select renders
```

Expected behaviors:
- Home grid shows "video trim" and "video → audio" cards.
- `/tools/video-trim`: dropping the fixture loads the scrubber within 5-15 seconds (ffmpeg load + probe + frame-strip extraction). Container dropdown disables MP4-incompatible codecs (test by dropping `sample-vp9-opus.webm` — MP4 should disable).
- `/tools/video-extract-audio`: dropping the fixture leaves Convert button enabled; dropping `sample-no-audio.mp4` should surface the "no audio track" error.
- Sidebar shows new VIDEO section with two entries.

If anything renders incorrectly (broken layout, console errors, scrubber empty after 30 seconds), debug before declaring done. Capture screenshots if the user wants visual evidence.

- [ ] **Step 12.8: Final commit (only if any verification fix was needed).**

If Steps 12.2-12.6 surface fixable issues, commit each fix separately with a `fix(phase-22): ...` message under 72 chars per body line. If everything passed cleanly, no commit needed.

- [ ] **Step 12.9: Push the branch and prepare for PR.**

```bash
git push -u origin phase-22-video-trim-and-extract-audio
git log --oneline main..HEAD
```

Expected: branch pushed; `git log` lists the Phase 22 commits in order. Open a PR titled `Phase 22: video-trim + video-extract-audio` with a summary that links to the spec and lists the major shipped pieces. Do not include Claude attribution in the PR body.
