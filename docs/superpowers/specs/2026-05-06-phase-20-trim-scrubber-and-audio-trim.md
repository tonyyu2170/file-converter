# Phase 20 — `_shared/trim-scrubber/` (audio half) + `audio-trim`

**Date:** 2026-05-06
**Status:** approved (brainstorm signed off 2026-05-06)
**Source of truth:** `docs/superpowers/specs/2026-05-05-v2-design.md` §2.1 (shared modules), §3.1 (audio engines), §11 (phasing). This document records resolved decisions for Phase 20 specifically; the v2 design remains the architectural source.

## 1. Goal

Ship the first half of v2's trim-scrubber UI primitive and the first engine that uses it. Phase 20 delivers:

1. `src/engines/_shared/trim-scrubber/` with a fully working **audio** render path. The `modality: "video"` branch is typed but stubbed (`throw new Error("video modality not implemented in phase 20")`) so Phase 22 is purely additive.
2. `src/engines/audio-trim/`: single-input engine that trims audio losslessly via ffmpeg `-c copy` when the output format is unchanged, or re-encodes in a single ffmpeg call when the output format differs.

Everything else from the v2 design (video, COOP/COEP, multi-threaded ffmpeg, OCR, archives, data, sidebar grouping) is out of scope.

## 2. Resolved design decisions

### 2.1 Waveform decode

Decoded via the **already-loaded ffmpeg singleton** from `src/engines/_shared/ffmpeg/`, not via `OfflineAudioContext`. This contradicts a literal reading of v2 design §2.1, which named `OfflineAudioContext`; we reverse that based on:

- **Safari worker support gap.** `OfflineAudioContext` in dedicated workers is supported in Chromium and Firefox but not Safari as of late 2025. Running decode on the main thread freezes the UI for large inputs (500 MB cap allows files where `decodeAudioData` blocks for tens of seconds).
- **Single decode path.** ffmpeg handles every format we accept (mp3/wav/m4a/flac) uniformly. Browser `decodeAudioData` has historical FLAC quirks across vendors.
- **No incremental cost.** ffmpeg WASM (~30 MB) is already required for the conversion that follows; the scrubber pays nothing the engine doesn't already pay.

The trade-off is that the scrubber waveform stays empty until ffmpeg finishes loading. To compensate, the **scrubber handles are interactive immediately** — duration is probed on the main thread via `<audio>.duration` and used to position handles before peaks decode completes.

### 2.2 Re-encode pipeline shape

When `outputFormat !== "same"`, the worker invokes ffmpeg **once** with both range and codec args:

```
ffmpeg -i in.mp3 -ss <startSec> -to <endSec> -c:a <codec> -b:a <bitrate>k out.<ext>
```

No two-stage pipeline. When `outputFormat === "same"`:

```
ffmpeg -i in.mp3 -ss <startSec> -to <endSec> -c copy out.mp3
```

### 2.3 Bitrate UI

The bitrate dropdown (64/128/192/256/320 kbps; default 192) is shown only when output format is a lossy target distinct from `"same"`. Hidden for `"same"`, `"wav"`, `"flac"`. Component is reused from `src/engines/audio-convert/options-panel.tsx` (extract a small subcomponent if needed; do not duplicate the `BITRATE_KBPS` map).

### 2.4 Output filename

`<basename>-trim.<ext>` where `<ext>` matches the chosen output format (or the input extension when `outputFormat === "same"`). Range timestamps are not encoded in the filename.

### 2.5 Duration probe

`durationSec` is read on the main thread via a temporary `<audio>` element (set `src` to an Object URL, await `loadedmetadata`, read `.duration`, revoke URL). This runs as soon as a file is staged and produces a number in tens of milliseconds — well before ffmpeg finishes loading.

The probe util is co-located in `_shared/trim-scrubber/duration.ts` and parameterized on `modality` so Phase 22 can reuse it for `<video>.duration` without churn.

### 2.5b Threading model — single ffmpeg load on the page

`loadFfmpeg()` is a module-scoped singleton — each JS execution context (main thread, engine worker) that imports `_shared/ffmpeg/index.ts` gets its own instance. If `decodePeaks` ran on the main thread and called `loadFfmpeg()` directly, the audio-trim page would load ffmpeg WASM **twice** (~60 MB total): once in main-thread for peaks, once in the engine worker for trim. Unacceptable.

Resolution: peaks are decoded **inside the engine worker**, not on the main thread. The engine worker's existing FFmpeg singleton is reused. Wiring:

- `WorkerEntry<TOptions>` (in `src/engines/_shared/harness.ts`) gains an **optional** `decodePeaks` method with an inline structural return type — keeps `harness.ts` from depending on `_shared/trim-scrubber/`:
  ```ts
  decodePeaks?: (
    bytes: ArrayBuffer,
    fileExtension: string,
    bucketCount: number,
  ) => Promise<{ min: Float32Array; max: Float32Array }>;
  ```
- `WorkerHarness` gains a `runDecodePeaks(file: File, bucketCount: number)` method that spawns/reuses the worker, transfers bytes, and awaits the RPC. Aborts via the standard `AbortSignal` plumbing (same pattern as `runSingle`). Return type is the same inline `{ min, max }` shape; trim-scrubber's `Peaks` type alias is structurally compatible.
- audio-trim's `worker.ts` implements `decodePeaks` alongside `convertSingle`. Both share the worker-scoped ffmpeg singleton.
- audio-trim's `OptionsPanel` calls `getHarness().runDecodePeaks(file, 512)` once after a file is staged. Convert later reuses the same harness → same worker → no re-load.

This is a small extension of shared infra. Other engines are unaffected because `decodePeaks?` is optional on `WorkerEntry` and `runDecodePeaks` is only called by audio-trim's panel.

`_shared/trim-scrubber/decode-peaks.ts` therefore contains the **bucket-min/max algorithm** (a pure function over `Float32Array` PCM input) plus the **ffmpeg invocation that produces decimated PCM**, both designed to run inside an engine worker. It does NOT call `loadFfmpeg()` from main thread. It exports:
- `peaksFromPCM(pcm: Float32Array, bucketCount: number): Peaks` — pure, unit-testable in isolation.
- `decodePeaksInWorker(ff: FFmpegType, bytes: ArrayBuffer, bucketCount: number): Promise<Peaks>` — worker-only helper that the engine's `worker.ts` calls.

### 2.6 State shape

```ts
type AudioTrimOptions = {
  startSec: number;
  endSec: number;
  outputFormat: "same" | "mp3" | "wav" | "m4a" | "flac";
  bitrate: 64 | 128 | 192 | 256 | 320; // ignored when outputFormat is "same" or lossless
};
```

`durationSec` is **not** in options. It is derived from the staged file in OptionsPanel local state and passed to the scrubber as a prop. This keeps options serializable and free of derived data.

### 2.7 Default range

On first staging: `startSec = 0`, `endSec = durationSec`. The selection covers the entire file by default. Convert with the default range performs a fast `-c copy` of the whole input — a valid, near-instant operation. The user must drag a handle to actually trim.

### 2.8 `isReadyToConvert` and Convert gating

`durationSec` is not part of `AudioTrimOptions` (per §2.6), so the engine's `isReadyToConvert(opts)` cannot directly check it. Convert is gated in two places:

1. **Engine-level** (data integrity, doesn't depend on duration):
   ```ts
   isReadyToConvert: (opts) =>
     opts.startSec >= 0 &&
     opts.endSec > opts.startSec &&
     opts.endSec - opts.startSec >= 0.1
   ```
2. **UI-level** (the OptionsPanel writes clamped `startSec`/`endSec` back into options whenever duration probes or the user drags handles, ensuring `endSec ≤ durationSec` is structurally maintained). The OptionsPanel additionally disables the Convert button surface while `durationSec` is undefined (file just staged, probe still pending).

### 2.9 Loading states inside the scrubber

While ffmpeg loads or `decodePeaks` is in flight, the bars area renders as a flat hairline (no skeleton animation, no fake bars). Handles remain fully interactive because duration is already probed. Once peaks resolve, the canvas redraws.

If `decodePeaks` errors (corrupt file, unsupported codec): scrubber shows the hairline plus a small text label `waveform unavailable`. Trim still works — handles still drag, conversion still runs. The waveform is decoration; the time range is the actual data.

### 2.10 Tests

| Layer | What |
|---|---|
| `decode-peaks.test.ts` | Synthesize a 1-sec 440 Hz sine WAV in-test (no fixture commit). Run `decodePeaks(file, 64)`. Assert peaks length is 64 (max array) + 64 (min array). Assert all peak magnitudes are non-zero and within `[0, 1]`. Assert envelope is roughly sinusoidal (max - min monotonically reasonable across buckets). No pixel snapshots. |
| `duration.test.ts` | Synthesize a known-length WAV, call `readMediaDurationSec(file, "audio")`, assert duration is correct ±50 ms. Verify `modality: "video"` path throws (deferred to Phase 22). |
| `index.test.tsx` (TrimScrubber) | Render with pre-computed peaks + duration. Assert handles render at correct positions. Keyboard arrows move start/end by expected deltas (1 sec for arrow, 10 sec for shift+arrow per spec §2.1). Drag updates fire `onChange(start, end)`. Disabled state suppresses interaction. `modality: "video"` throws. |
| Engine `index.test.ts` | Validation (extension + magic bytes, 500 MB cap), descriptor metadata, registry entry. |
| `options.test.ts` | Default options shape. Bitrate is irrelevant when format is `"same"` or lossless. |
| `options-panel.test.tsx` | Render + interaction: bitrate dropdown hidden for `"same"`/wav/flac, shown for mp3/m4a. Format change clamps invalid `outputFormat` values. Convert disabled while duration unknown. |
| E2E `audio-trim.spec.ts` | Route mounts. Stage a fixture. Scrubber renders. Default-suite. |
| E2E `audio-trim-correctness.spec.ts` (gated by `RUN_AUDIO_TRIM_CORRECTNESS=1`) | Stage `tests/fixtures/audio/sample.mp3`, set range 1.0s–3.0s, format `"same"` → convert → re-probe `<audio>.duration` of output, assert ≈ 2.0s ± 50 ms. Repeat with format change to `"wav"`, assert duration AND that the output starts with the RIFF/WAVE magic bytes. |
| E2E `privacy-regression-audio-trim.spec.ts` | Zero outbound network during conversion. Mirrors Phase 19's pattern. |

### 2.11 Fixtures

Reuse `tests/fixtures/audio/sample.{mp3,wav,m4a,flac}` from Phase 19 verbatim. No new committed fixtures.

### 2.12 Branch

`phase-20-trim-scrubber-and-audio-trim` (per project memory `feedback_branch_discipline` — implementer subagents may not run `git branch -m/-M` or `git checkout <branch>`).

### 2.13 Bundle isolation

`audio-trim/` auto-enrolls via `scripts/check-bundle-isolation.mjs`. `_shared/trim-scrubber/` itself is not directly enrolled (it's shared infra and is allowed in any engine chunk that imports it). The CI gate already ensures `@ffmpeg/ffmpeg` does not bleed into the homepage chunk via `_shared/ffmpeg/`'s dynamic-import boundary.

### 2.14 Sidebar / home

- `src/components/layout/sidebar.tsx`: append `audio-trim` to the `AUDIO` group (created in Phase 19).
- `src/app/page.tsx`: append `audio-trim` to the `TOOLS` array.
- Update count assertions in `sidebar.test.tsx` / `page.test.tsx` if present.

## 3. API contracts

### 3.1 TrimScrubber

```ts
// src/engines/_shared/trim-scrubber/index.tsx
import type { ReactElement } from "react";

export type TrimScrubberProps = {
  source: File;
  modality: "audio" | "video";
  durationSec: number;
  startSec: number;
  endSec: number;
  onChange(start: number, end: number): void;
  disabled?: boolean;
};

export function TrimScrubber(props: TrimScrubberProps): ReactElement;
```

Behavior:
- Renders 512 vertical bars derived from `decodePeaks(source, 512)` once available; flat hairline before that.
- Two drag handles for start and end. Handles render at `(time / durationSec) * width` pixels.
- Keyboard: with focus on a handle, `ArrowLeft`/`ArrowRight` shifts by 1 s; `Shift+ArrowLeft`/`Shift+ArrowRight` shifts by 10 s. Boundaries clamp to `[0, durationSec]` and to each other (start cannot pass end).
- Read-only `mm:ss.ms` labels under each handle.
- Brutalist treatment per v2 §2.1: monospace timestamp labels, sharp hairline handles, no gradients.
- `modality: "video"` throws synchronously inside the component body (`throw new Error("video modality not implemented in phase 20")`).

### 3.2 decode-peaks (worker-only helpers)

```ts
// src/engines/_shared/trim-scrubber/decode-peaks.ts
import type { FFmpeg as FFmpegType } from "@ffmpeg/ffmpeg";

export type Peaks = {
  min: Float32Array; // length === bucketCount, range [-1, 0]
  max: Float32Array; // length === bucketCount, range [0, 1]
};

/** Pure function: bucket a PCM stream into per-bucket (min, max) pairs. */
export function peaksFromPCM(pcm: Float32Array, bucketCount: number): Peaks;

/** Worker-only: run ffmpeg to extract decimated mono f32le PCM, then bucket. */
export async function decodePeaksInWorker(
  ff: FFmpegType,
  bytes: ArrayBuffer,
  fileExtension: string, // e.g. "mp3", needed because ffmpeg uses the input filename to pick a demuxer
  bucketCount: number,
): Promise<Peaks>;
```

Internal flow of `decodePeaksInWorker`:
1. Write `bytes` into ffmpeg's MEMFS as `peaks-in.<ext>`.
2. Run a filter chain converting to mono f32le PCM at a target sample rate that yields ~`bucketCount * 256` samples for the file's duration (use ffmpeg's `aresample` or simply set `-ar` to a low rate like 8000 Hz and bucket whatever PCM comes out).
3. Read raw PCM out as `Uint8Array`, view as `Float32Array`.
4. Call `peaksFromPCM(pcm, bucketCount)`.
5. Return `{ min, max }`.

The engine's `worker.ts` exposes:

```ts
// src/engines/audio-trim/worker.ts
const api = {
  async convertSingle(bytes, name, type, opts, onProgress) { ... },
  async decodePeaks(
    bytes: ArrayBuffer,
    fileExtension: string,
    bucketCount: number,
  ) {
    const ff = await loadFfmpeg();
    return decodePeaksInWorker(ff, bytes, fileExtension, bucketCount);
  },
};
Comlink.expose(api);
```

The harness method extracts the extension from `file.name` and forwards:

```ts
// src/engines/_shared/harness.ts (added)
async runDecodePeaks(file: File, bucketCount: number): Promise<Peaks> {
  if (!this.worker) this.spawn();
  if (!this.remote?.decodePeaks) {
    throw new Error("worker does not implement decodePeaks");
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const bytes = await file.arrayBuffer();
  return this.remote.decodePeaks(bytes, ext, bucketCount);
}
```

The OptionsPanel calls peaks via:

```ts
// src/engines/audio-trim/options-panel.tsx
const peaks = await getHarness().runDecodePeaks(file, 512);
```

`getHarness()` is the same persistent harness that backs `engine.convert(...)`. Single worker, single ffmpeg load.

### 3.3 readMediaDurationSec

```ts
// src/engines/_shared/trim-scrubber/duration.ts
export async function readMediaDurationSec(
  file: File,
  modality: "audio" | "video",
): Promise<number>;
```

Phase 20 implements `modality: "audio"` only; `"video"` throws.

### 3.4 audio-trim engine

```ts
// src/engines/audio-trim/options.ts
export type AudioTrimOptions = {
  startSec: number;
  endSec: number;
  outputFormat: "same" | "mp3" | "wav" | "m4a" | "flac";
  bitrate: 64 | 128 | 192 | 256 | 320;
};

export const DEFAULT_OPTIONS: AudioTrimOptions = {
  startSec: 0,
  endSec: 0, // OptionsPanel sets to durationSec on file stage
  outputFormat: "same",
  bitrate: 192,
};
```

```ts
// src/engines/audio-trim/index.ts
import type { SingleInputEngine } from "../_shared/types";
import type { AudioTrimOptions } from "./options";

export const audioTrim: SingleInputEngine<AudioTrimOptions, OutputItem> = {
  id: "audio-trim",
  name: "Audio Trim",
  category: "audio",
  cardinality: "single",
  acceptedExtensions: [".mp3", ".wav", ".m4a", ".flac"],
  // ... validate, convert, OptionsPanel, isReadyToConvert
};
```

## 4. File map

### Created

| Path | Responsibility |
|---|---|
| `src/engines/_shared/trim-scrubber/index.tsx` | `TrimScrubber` component (audio render path) |
| `src/engines/_shared/trim-scrubber/index.test.tsx` | Component tests with pre-computed peaks |
| `src/engines/_shared/trim-scrubber/decode-peaks.ts` | ffmpeg-driven peaks helper |
| `src/engines/_shared/trim-scrubber/decode-peaks.test.ts` | Sine-wave unit tests |
| `src/engines/_shared/trim-scrubber/duration.ts` | Main-thread media duration probe |
| `src/engines/_shared/trim-scrubber/duration.test.ts` | Duration probe unit tests |
| `src/engines/audio-trim/index.ts` | Engine descriptor |
| `src/engines/audio-trim/index.test.ts` | Descriptor unit tests |
| `src/engines/audio-trim/options.ts` | `AudioTrimOptions`, defaults, codec/extension maps |
| `src/engines/audio-trim/options.test.ts` | Option-shape unit tests |
| `src/engines/audio-trim/options-panel.tsx` | OptionsPanel: format dropdown + (conditional) bitrate dropdown + TrimScrubber |
| `src/engines/audio-trim/options-panel.test.tsx` | OptionsPanel render + interaction |
| `src/engines/audio-trim/worker.ts` | Comlink-exposed worker; ffmpeg single-call invocation |
| `src/app/tools/audio-trim/page.tsx` | One-line route |
| `tests/e2e/audio-trim.spec.ts` | Route + UI E2E (default suite) |
| `tests/e2e/audio-trim-correctness.spec.ts` | Real-conversion E2E (gated by env) |
| `tests/e2e/privacy-regression-audio-trim.spec.ts` | Zero-outbound assertion |

### Modified

| Path | Change |
|---|---|
| `src/engines/_shared/harness.ts` | Add optional `decodePeaks` to `WorkerEntry`; add `runDecodePeaks(file, bucketCount)` to `WorkerHarness` (mirrors `runSingle` plumbing — abort, transferable bytes, error wrapping) |
| `src/engines/_shared/harness.test.ts` | Add tests for `runDecodePeaks` happy path + abort + worker-without-decodePeaks throws actionably |
| `src/engines/_shared/registry.ts` | Add `"audio-trim"` to `EngineId` union and `REGISTRY` map |
| `src/engines/_shared/registry.metadata.test.ts` | Update count assertion if exhaustive |
| `src/components/layout/sidebar.tsx` | Append `audio-trim` to AUDIO group |
| `src/components/layout/sidebar.test.tsx` | Update count assertion if present |
| `src/app/page.tsx` | Append `audio-trim` to `TOOLS` |
| `src/app/page.test.tsx` | Update TOOL count assertion if present |

### Untouched (must verify no edits — these are Phase 21's surface)

- `vercel.json`
- `package.json`, `pnpm-lock.yaml`
- `scripts/copy-ffmpeg-core.mjs`, `scripts/ffmpeg-manifest.json`
- `src/engines/_shared/ffmpeg/index.ts`
- `next.config.ts`
- All other engines under `src/engines/<id>/`

## 5. Phase 21 coordination contract

Phase 21 ships in parallel in a separate Claude instance against branch `phase-21-coop-coep-and-mt-ffmpeg`. Phase 20 promises:

1. **No edits** to any file in the "Untouched" list above.
2. **`loadFfmpeg()` import contract preserved.** Phase 20 calls `loadFfmpeg()` and uses the returned instance. It does not depend on whether the instance is single-threaded or multi-threaded. Phase 21's swap to `@ffmpeg/core-mt` must keep this signature.

Phase 21 promises (recorded in its own spec):

1. No edits to `src/engines/_shared/trim-scrubber/`, `src/engines/audio-trim/`, `src/engines/audio-convert/`, the home grid, or the sidebar.
2. The `loadFfmpeg()` public surface (return type, parameters) does not change.

Merge order: Phase 20 lands first; Phase 21 rebases on top.

## 6. Out of scope

- `video-trim`, `video-convert`, `video-extract-audio` (Phase 22).
- Trim-scrubber video render path / frame-strip extraction (Phase 22).
- COOP/COEP headers, multi-threaded ffmpeg (Phase 21).
- Sidebar group sectioning beyond appending one entry to the existing AUDIO group (Phase 26).
- Cancel button during trim conversion. Trim with `-c copy` is near-instant (sub-second on typical inputs); re-encode on a 500 MB file could take ~30 seconds but the existing engine `signal: AbortSignal` plumbing already lets the user navigate away. A dedicated Cancel button is deferred until video conversions land in Phase 22 where it becomes load-bearing.

## 7. Acceptance criteria

- All unit, integration, and default-suite E2E tests pass.
- `RUN_AUDIO_TRIM_CORRECTNESS=1 pnpm test:e2e` passes for both same-format trim and re-encode-with-format-change.
- `pnpm test:e2e tests/e2e/privacy-regression-audio-trim.spec.ts` shows zero outbound network requests during a real trim.
- `pnpm build` succeeds. `scripts/check-bundle-isolation.mjs` confirms `@ffmpeg/ffmpeg` does not appear in the homepage chunk.
- Manual verification: open `/tools/audio-trim`, stage a 30-second mp3, observe waveform render after a brief load, drag handles, observe `mm:ss.ms` labels update, click Convert, verify downloaded file length and audibility match the chosen range.
- No edits to any file in the Phase 21 "Untouched" list.
