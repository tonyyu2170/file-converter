# Phase 22 — `video-trim` + `video-extract-audio` + trim-scrubber video render path

**Date:** 2026-05-07
**Status:** approved (brainstorm signed off 2026-05-07)
**Source of truth:** `docs/superpowers/specs/2026-05-05-v2-design.md` §3.6 (video engines), §2.1 (trim-scrubber), §11 (phasing). Phase 20 (`2026-05-06-phase-20-trim-scrubber-and-audio-trim.md`) shipped the audio half of the trim-scrubber and the `audio-trim` engine; this document records the resolved decisions for Phase 22 specifically.

## 1. Goal

Ship the v2 video pair and complete the trim-scrubber by lighting up its video render path:

1. `src/engines/video-trim/`: single-input engine, `-c copy` only (no re-encode), with a user-selectable output container that the codec-compatibility probe constrains.
2. `src/engines/video-extract-audio/`: single-input engine that pulls the audio track from a video, mirroring `audio-trim`'s output-format menu.
3. `src/engines/_shared/trim-scrubber/`: implement the `modality: "video"` branch (currently throws). Adds a frame-strip extracted via ffmpeg.
4. `src/engines/_shared/ffmpeg/`: add a `probe.ts` codec/duration probe (used by both engines and the scrubber) and a `codec-compat.ts` container-compat table (used by `video-trim`'s container dropdown).

Everything else from the v2 design (`video-convert`, OCR, archives, data, sidebar grouping) remains out of scope.

## 2. Resolved design decisions

### 2.1 `video-trim` is `-c copy` only

ffmpeg `-c copy` snaps the trim's start point to the nearest preceding keyframe (typical H.264/2s GOP can yield up to ~2s of pre-roll). This is the same trade-off `audio-trim` makes and matches the QuickTime-style "trim a clip" mental model. **No re-encode mode in v22.** A `precise` toggle is deferred — the v22 risk is concentrated in the trim-scrubber video render path; layering codec/quality/bitrate UI on top would compound that risk for marginal v2 value. Re-encode can be added later as an additive option without breaking changes.

### 2.2 `video-trim` output container is user-selectable, with compat-driven disabling

The container dropdown is `"same" | "mp4" | "webm" | "mkv"`, default `"same"`. Each option's compatibility with the source's video+audio codecs is computed at probe time; incompatible options render `disabled` with a tooltip explaining the conflict. `"same"` and `"mkv"` are always enabled (Matroska accepts everything; "same" by definition cannot mismatch). This shape preserves the simplicity of `-c copy` (no codec/bitrate knobs) while letting the user remux when they want a more web-friendly container than what their phone produced.

### 2.3 Codec/container mismatch is prevented, not reported after the fact

A pre-flight probe using ffmpeg itself (no separate library) runs as part of file-drop validation. The probe extracts video codec, audio codec, duration, and dimensions from ffmpeg's stderr `Stream` and `Duration` lines. Result is cached in a `WeakMap<File, Promise<ProbeResult>>` so the engine validate, the options-panel disabled logic, and the trim-scrubber all share one probe per file. ffmpeg WASM is already lazy-loaded for the conversion that follows, so the probe pays only its own ~100ms parse cost on a warmed instance.

### 2.4 `video-extract-audio` mirrors `audio-trim`'s output-format menu exactly

Output formats: `"same" | "mp3" | "wav" | "m4a" | "flac"`, default `"same"`. With `"same"`, ffmpeg `-c:a copy` extracts the audio stream losslessly (sub-second on 100 MB files); the output container is chosen automatically from the audio codec the probe found. Other formats re-encode. The bitrate dropdown (64/128/192/256/320 kbps; default 192) appears only for MP3, identical to `audio-trim`'s behavior. **Opus is intentionally omitted** to keep the format list and shared helpers byte-identical to `audio-trim` (Opus sources are still handled by `"same"`).

### 2.5 Frame-strip is adaptive count + native-aspect extraction + cover-fit slots

The trim-scrubber's video render path extracts thumbnail frames in a single ffmpeg pass (`-vf "fps=N/duration,scale=-1:60"`), where `N = clamp(floor(scrubberWidthPx / 80), 10, 60)` — adaptive to the timeline width. Each thumb is extracted at 60px tall with native aspect (no ffmpeg-side distortion). Display uses fixed `80px × 60px` slots with `object-fit: cover` so the strip looks uniform across landscape and portrait sources; cropping is centered. Extraction runs once at scrubber mount; resize does not re-extract.

The `<video>+Canvas` alternative was considered and rejected: ffmpeg seek precision on VBR streams is poor and frame accuracy depends on keyframe density, whereas an ffmpeg `fps=` filter handles every container we accept uniformly with one warm-instance call.

## 3. Architecture / file layout

```
src/
  engines/
    _shared/
      harness.ts                   ← MODIFIED (add optional probe? + extractFrameStrip? to WorkerEntry; runProbe + runExtractFrameStrip on WorkerHarness)
      ffmpeg/
        probe.ts                   ← NEW (probeWithFfmpeg, worker-only)
        probe.test.ts              ← NEW
        codec-compat.ts            ← NEW (CONTAINER_CODECS, containerSupportsCodecs)
        codec-compat.test.ts       ← NEW
      audio/
        format.ts                  ← NEW (extracted from audio-trim/options.ts)
        format.test.ts             ← NEW (format-specific tests moved here)
      trim-scrubber/
        index.tsx                  ← MODIFIED (light up modality:"video" branch)
        frame-strip.ts             ← NEW (extractFrameStripInWorker, worker-only)
        frame-strip.test.ts        ← NEW
        duration.ts                ← MODIFIED (remove the modality:"video" stub throw)
    audio-trim/
      options.ts                   ← MODIFIED (re-export from _shared/audio/format)
      options.test.ts              ← MODIFIED (engine-specific assertions stay; format-specific tests moved)
      worker.ts                    ← unchanged
    audio-convert/
      options.ts                   ← MODIFIED (re-export from _shared/audio/format)
    video-trim/                    ← NEW
      index.ts
      index.test.ts
      worker.ts                    ← implements convertSingle + probe + extractFrameStrip
      options.ts
      options.test.ts
      options-panel.tsx
      options-panel.test.tsx
    video-extract-audio/           ← NEW
      index.ts
      index.test.ts
      worker.ts                    ← implements convertSingle + probe (no extractFrameStrip; no scrubber)
      options.ts
      options.test.ts
      options-panel.tsx
      options-panel.test.tsx
  app/
    page.tsx                       ← MODIFIED (2 new tool cards)
    tools/
      video-trim/page.tsx          ← NEW
      video-extract-audio/page.tsx ← NEW
tests/
  e2e/
    video-trim.spec.ts             ← NEW
    video-extract-audio.spec.ts    ← NEW
  fixtures/
    sample-h264-aac.mp4            ← NEW
    sample-vp9-opus.webm           ← NEW
    sample-h264.mov                ← NEW
    sample-hevc-aac.mkv            ← NEW
    sample-no-audio.mp4            ← NEW
    generate-video-fixtures.sh     ← NEW (reproducible regeneration)
```

## 4. Engine: `video-trim`

### 4.1 Inputs and validation

```ts
const SUPPORTED_INPUT_MIMES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
];
const SUPPORTED_INPUT_EXTENSIONS = [".mp4", ".mov", ".webm", ".mkv"];
const MAX_BYTES = 100 * 1024 * 1024;
```

Validation order:
1. Size check → `EngineError("File too large; 100 MB max")`.
2. MIME check; if MIME unrecognized, fall back to extension check (mirrors `audio-trim`/`image-convert`).
3. Probe via `getHarness().runProbe(file)`. If the worker RPC rejects → `EngineError("Couldn't read this video — it may be corrupt or use an unsupported codec")`.
4. (Convert-time only, defensive) `containerFormat !== "same"` and `containerSupportsCodecs(format, probe.videoCodec, probe.audioCodec)` returns false → `EngineError(...)` with the codec/container conflict named. The dropdown should already prevent this.

### 4.2 Options

```ts
type VideoTrimContainer = "same" | "mp4" | "webm" | "mkv";

type VideoTrimOptions = {
  startSec: number;            // owned by trim-scrubber UI
  endSec: number;              // owned by trim-scrubber UI
  containerFormat: VideoTrimContainer;
};

const VIDEO_TRIM_CONTAINERS: ReadonlyArray<VideoTrimContainer> = [
  "same", "mp4", "webm", "mkv",
];

const defaultOptions: VideoTrimOptions = {
  startSec: 0,
  endSec: 0,                   // scrubber sets this on mount once probe lands
  containerFormat: "same",
};
```

Helpers (in `video-trim/options.ts`):
- `outputExtensionFor(fmt: VideoTrimContainer, inputName: string): string`
  - `"same"` → input extension; `"mp4"|"webm"|"mkv"` → `.mp4|.webm|.mkv`.
- `outputMimeFor(fmt: VideoTrimContainer, inputMime: string): string` — symmetric.
- `containerSupportsCodecs(...)` is **not** in this file; re-export from `_shared/ffmpeg/codec-compat.ts`.

### 4.3 Worker

Single ffmpeg invocation (in MEMFS):

```
ffmpeg -ss <startSec> -to <endSec> -i <in> -c copy -avoid_negative_ts make_zero <out>
```

`-ss` placed **before** `-i` for the fast keyframe seek idiom. `-avoid_negative_ts make_zero` suppresses the negative-timestamp warning that some sources produce after a keyframe seek.

Output: `<basename>-trimmed.<ext>` where `ext` resolves from `outputExtensionFor`.

### 4.4 Options panel

Renders the trim-scrubber (`modality: "video"`) and a `<select>` for `containerFormat`. The `<select>` awaits the cached probe via `getHarness().runProbe(file)` (returns a stable `Promise<ProbeResult>` from the harness's WeakMap) and computes `disabled` per option using `containerSupportsCodecs`. Until the probe resolves, the dropdown shows only `"same"` enabled and a "Detecting codecs…" hint; on resolve, it re-renders with the correct disabled set. Disabled options carry `title="MP4 can't hold this file's audio codec (Opus)"` etc. for tooltip discoverability.

## 5. Engine: `video-extract-audio`

### 5.1 Inputs and validation

Same input MIMEs, extensions, and 100 MB cap as `video-trim`. Probe call is identical: `getHarness().runProbe(file)` (cached, shared with the engine's worker singleton).

Additional validation step after probe: `if (!probe.hasAudio) throw new EngineError("This video has no audio track")`. Surfaced at file-drop, never gets to "Convert".

### 5.2 Options

```ts
type VideoExtractAudioOptions = {
  outputFormat: AudioFormat;     // imported from _shared/audio/format
  bitrateKbps: number;           // ignored unless outputFormat === "mp3"
};

const defaultOptions: VideoExtractAudioOptions = {
  outputFormat: "same",
  bitrateKbps: 192,
};
```

`AudioFormat` and helpers (`AUDIO_FORMATS`, `isLossyOutput`, `outputExtensionFor`, `outputMimeFor`, `BITRATE_KBPS`) are **promoted** to `_shared/audio/format.ts` in this phase. `audio-trim/options.ts` and `audio-convert/options.ts` re-export from there to preserve their public surfaces; no behavior change.

### 5.3 Worker — `outputFormat: "same"`

```
ffmpeg -i <in> -vn -c:a copy <out>
```

Output container is selected by the audio codec the probe identified:

| Probed audio codec | Output container | Extension | MIME |
|---|---|---|---|
| `aac` | mp4 (audio-only) | `.m4a` | `audio/mp4` |
| `mp3` | mp3 | `.mp3` | `audio/mpeg` |
| `opus` | ogg | `.opus` | `audio/ogg` |
| `vorbis` | ogg | `.ogg` | `audio/ogg` |
| `flac` | flac | `.flac` | `audio/flac` |
| `pcm_s16le` / `pcm_*` | wav | `.wav` | `audio/wav` |
| anything else | matroska (audio) | `.mka` | `audio/x-matroska` |

`.mka` fallback handles AC-3 and other less-common audio codecs in MOV/MKV without failing the conversion. Documented in user-facing tool copy as "rare formats output as `.mka`".

### 5.4 Worker — re-encode

```
ffmpeg -i <in> -vn -c:a <codec> [-b:a <kbps>k] <out>
```

Codec and extension picked by `outputExtensionFor(outputFormat, ...)`. `-b:a` is included only when `outputFormat === "mp3"`.

### 5.5 Output filename

`<basename>-audio.<ext>`.

### 5.6 Options panel

Identical structure to `audio-trim/options-panel.tsx` minus the trim-scrubber. Reuses the existing bitrate sub-component (extract from `audio-trim/options-panel.tsx` if not already shared in Phase 19/20).

## 6. Shared infra

### 6.1 `_shared/ffmpeg/probe.ts`

```ts
type ProbeResult = {
  durationSec: number;
  videoCodec: string | null;
  audioCodec: string | null;
  width: number;            // 0 if no video stream
  height: number;
  hasAudio: boolean;
};

async function probeWithFfmpeg(
  ff: FFmpegType,
  fileBytes: ArrayBuffer,
  fileExtension: string,
): Promise<ProbeResult>;
```

Implementation (worker-only, takes the ffmpeg instance as argument — does NOT call `loadFfmpeg()` itself):
- Subscribe to ffmpeg's `log` event for the duration of the call (collect stderr lines into an array, unsubscribe after).
- Write `fileBytes` into MEMFS as `probe-input<fileExtension>` (default extension `.bin` if unknown).
- Run `ffmpeg -i probe-input<ext>` (no output spec). Expect exit code 1 — that's how ffmpeg signals "no output, here's the info on stderr".
- Parse collected stderr lines:
  - `Duration: HH:MM:SS.MS, ...` → `durationSec`.
  - `Stream #N:M[(...)]: Video: <codec>[ ...], <pix_fmt>, WIDTHxHEIGHT[, ...]` → `videoCodec`, `width`, `height`.
  - `Stream #N:M[(...)]: Audio: <codec>[ ...]` → `audioCodec`, `hasAudio = true`.
- Delete `probe-input<ext>` from MEMFS before returning.

**Where it runs — and why.** Like Phase 20's `decodePeaks`, this util runs **inside the engine worker**, not on the main thread. Phase 20 §2.5b established the principle: a main-thread `loadFfmpeg()` plus a worker `loadFfmpeg()` doubles the WASM cost (~60 MB instead of ~30 MB) for no functional gain. The engine worker has to load ffmpeg for the conversion anyway; probe and frame-strip ride on the same instance.

Caller pattern: the options-panel calls `getHarness().runProbe(file)` (see §6.6); the harness manages the worker lifecycle and caches the probe `Promise<ProbeResult>` in a `WeakMap<File, ...>` so repeated callers (engine validate, dropdown disabled-state, trim-scrubber duration init) share one round-trip.

### 6.2 `_shared/ffmpeg/codec-compat.ts`

```ts
type Container = "mp4" | "webm" | "mkv";

const CONTAINER_CODECS: Record<Container, { video: string[]; audio: string[] } | null> = {
  mp4:  { video: ["h264", "hevc", "av1"],     audio: ["aac", "mp3"] },
  webm: { video: ["vp8", "vp9", "av1"],       audio: ["opus", "vorbis"] },
  mkv:  null,   // accepts anything
};

function containerSupportsCodecs(
  container: Container | "same",
  videoCodec: string | null,
  audioCodec: string | null,
): boolean;
```

`"same"` always returns `true`. `null` value in the table (MKV) returns `true` for any codecs. Otherwise both `videoCodec` and `audioCodec`, if non-null, must be in their respective lists. A null codec (no stream) is treated as "no constraint" for that side.

Pure data + pure function. Unit-testable in isolation; no ffmpeg dependency.

### 6.3 `_shared/audio/format.ts` (extraction from `audio-trim`)

Move `AudioTrimFormat` (renamed `AudioFormat`), `AUDIO_TRIM_FORMATS` (renamed `AUDIO_FORMATS`), `isLossyOutput`, `outputExtensionFor`, `outputMimeFor`, and the `BITRATE_KBPS` map (currently in `audio-trim/options.ts`). Re-export from both `audio-trim/options.ts` and `audio-convert/options.ts` via `export * from "../_shared/audio/format"` so existing imports continue to compile.

This is a refactor with **zero behavior change** — existing tests must continue to pass without modification.

### 6.4 `_shared/trim-scrubber/frame-strip.ts`

```ts
type FrameStripArgs = {
  ff: FFmpegType;                  // injected by caller (the engine worker's singleton)
  fileBytes: ArrayBuffer;
  fileExtension: string;           // e.g. ".mp4"
  durationSec: number;             // from probe
  sourceWidth: number;             // from probe
  sourceHeight: number;            // from probe
  count: number;                   // caller clamps to [10, 60]
  heightPx: number;                // 60 in v22
};

async function extractFrameStripInWorker(
  args: FrameStripArgs,
): Promise<{ frames: Uint8Array[]; widthPx: number }>;
```

**Where it runs — and why.** Same reasoning as `probeWithFfmpeg` (§6.1): runs inside the engine worker on the worker's ffmpeg singleton. Returns raw JPEG bytes (`Uint8Array[]`) over the structured-clone channel; the main-thread caller (see §6.6) wraps each into a `Blob` and an object URL after receiving them. This keeps the worker free of `URL.createObjectURL` (which doesn't exist in dedicated workers in all browsers).

Implementation:
- Write `fileBytes` into MEMFS as `strip-input<fileExtension>`.
- Run `ffmpeg -i strip-input<ext> -vf "fps=<count>/<durationSec>,scale=-1:<heightPx>" -frames:v <count> frame_%03d.jpg`.
- Read `frame_001.jpg` … `frame_NNN.jpg` from MEMFS into `Uint8Array`s.
- Compute `widthPx = round(heightPx * sourceWidth / sourceHeight)` — identical for every frame since each was extracted at the same scale.
- Delete all input/output files from MEMFS before returning.
- Return `{ frames, widthPx }`.

### 6.5 Trim-scrubber `modality: "video"` branch

The component (`_shared/trim-scrubber/index.tsx`) currently throws on `modality: "video"`. Replace the throw with a video-render branch that mirrors the audio branch's lifecycle, all worker-mediated:

| Step | Audio branch (Phase 20) | Video branch (Phase 22) |
|---|---|---|
| Duration | `<audio>.duration` via `duration.ts` | `<video>.duration` via `duration.ts` (already parameterized on `modality`) |
| Background render | waveform peaks via `decodePeaks` (in worker) | frame strip via `extractFrameStrip` (in worker) |
| Visual element | `<canvas>` painted from peaks | flex row of `<img>` in fixed slots |
| Mount-time async | `runDecodePeaks` over WorkerHarness RPC | `runProbe` then `runExtractFrameStrip` over WorkerHarness RPC |

Mount-time sequence:
1. `useLayoutEffect` reads container width via `getBoundingClientRect`.
2. `useEffect` calls `getHarness().runProbe(file)` (cached). Resolves to `ProbeResult`.
3. `useEffect` computes `slotWidth = 80px`, `count = clamp(floor(containerWidth / slotWidth), 10, 60)`.
4. `useEffect` calls `getHarness().runExtractFrameStrip({ file, count, heightPx: 60, /* probe-derived dims & duration */ })`. Resolves to `{ frames: Uint8Array[]; widthPx: number }`.
5. On the main thread, wrap each `Uint8Array` in `new Blob([bytes], { type: "image/jpeg" })` and create an object URL. Render `<img>` per URL in fixed `80px × 60px` slots with `object-fit: cover; object-position: center`.

Skeleton state while extraction is in flight: a 60px-tall placeholder block in the existing scrubber theme color, same shape Phase 20 uses for the audio waveform.

Cleanup: in the `useEffect` cleanup, call `URL.revokeObjectURL(url)` on each entry to prevent the ~600 KB-per-strip memory leak across multiple file stagings.

### 6.6 WorkerHarness extension — `runProbe` and `runExtractFrameStrip`

Mirrors Phase 20's `runDecodePeaks` extension (Phase 20 §2.5b). Two new optional methods on `WorkerEntry<TOptions>` (`src/engines/_shared/harness.ts`), kept structural so `harness.ts` remains free of trim-scrubber/probe imports:

```ts
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

Two new methods on `WorkerHarness`:

```ts
runProbe(file: File): Promise<ProbeResult>;     // caches Promise<ProbeResult> in WeakMap<File, ...>
runExtractFrameStrip(args: { file: File; count: number; heightPx: number; }): Promise<{
  urls: string[];      // object URLs, created on main thread from Uint8Array frames
  widthPx: number;
}>;
```

`runExtractFrameStrip` internally calls `runProbe` to get duration/dims if the caller hasn't already, then makes the RPC. The main-thread `Blob`/object-URL conversion happens inside `runExtractFrameStrip` so the trim-scrubber gets URLs directly — keeps the engine worker's API clean of DOM concerns.

Both methods spawn or reuse the engine's worker through the same lifecycle as `runSingle`/`runDecodePeaks`. Other engines remain unaffected because both RPCs are optional on `WorkerEntry`; only `video-trim` and `video-extract-audio` declare them.

`video-trim/worker.ts` and `video-extract-audio/worker.ts` each implement `probe`, `extractFrameStrip` (only `video-trim` needs the strip — `video-extract-audio` has no scrubber, so it can omit `extractFrameStrip`), and `convertSingle`. All three share the worker-scoped ffmpeg singleton.

## 7. Routes / registry / home wiring

### 7.1 Registry (`src/engines/_shared/registry.ts`)

Two new entries:

```ts
"video-trim":            () => import("../video-trim"),
"video-extract-audio":   () => import("../video-extract-audio"),
```

Plus descriptor entries (id, label, description, accept-summary). Description copy:
- `video-trim`: "Trim a video by setting in/out points on the timeline. Lossless and instant — keeps the original video bytes."
- `video-extract-audio`: "Pull the audio track out of a video. Default keeps the original audio bytes; pick a format to re-encode."

### 7.2 Routes

`src/app/tools/video-trim/page.tsx` and `src/app/tools/video-extract-audio/page.tsx` — structurally identical to `src/app/tools/audio-trim/page.tsx`. Each renders the standard `<ToolFrame>` + `<EngineRunner>` shape with the engine id.

### 7.3 Home grid

`src/app/page.tsx` — add `video-trim` and `video-extract-audio` cards under the appropriate group (per home grouping conventions; likely a new "Video" section if none exists, else add to the existing one).

## 8. Validation, errors, size caps

| Engine | Cap | Error → user message |
|---|---|---|
| `video-trim` | 100 MB | "File too large; 100 MB max" |
| `video-trim` | unreadable | "Couldn't read this video — it may be corrupt or use an unsupported codec" |
| `video-trim` | container/codec conflict at convert | "Can't trim into MP4: this video uses VP9. Pick MKV or 'same'." (templated) |
| `video-extract-audio` | 100 MB | "File too large; 100 MB max" |
| `video-extract-audio` | unreadable | "Couldn't read this video — it may be corrupt or use an unsupported codec" |
| `video-extract-audio` | no audio | "This video has no audio track" |

All errors thrown as `EngineError` (existing class). The convert-time codec conflict error message is templated `Can't trim into ${format.toUpperCase()}: this video uses ${codec}. Pick MKV or 'same'.`

## 9. Testing strategy

### 9.1 Unit / integration (vitest, real libraries — no mocks)

| Test file | Covers |
|---|---|
| `_shared/ffmpeg/probe.test.ts` | Call `probeWithFfmpeg(ff, bytes, ext)` directly with a freshly-loaded ffmpeg instance against each fixture; assert codec strings, dimensions, duration ±100ms. Assert `sample-no-audio.mp4` returns `hasAudio === false`, `audioCodec === null`. MEMFS leak check: file count returns to baseline after each probe. (Harness-level caching is exercised in the engine integration tests below.) |
| `_shared/ffmpeg/codec-compat.test.ts` | Pure data: MP4 rejects VP9, WebM rejects H.264, MKV accepts everything, "same" always passes. Null codec on either side is treated as no-constraint. |
| `_shared/audio/format.test.ts` | Existing audio-trim tests, moved verbatim. Re-export sanity check that `audio-trim/options.ts` and `audio-convert/options.ts` still expose the same public surface. |
| `_shared/trim-scrubber/frame-strip.test.ts` | Call `extractFrameStripInWorker({ ff, ..., count: 10, heightPx: 60 })` against `sample-h264-aac.mp4`. Assert 10 `Uint8Array` frames returned with non-zero `byteLength`, JPEG magic bytes (`0xFF 0xD8`), and `widthPx ≈ 60 * sourceWidth/sourceHeight ± 1` (rounding). |
| `video-trim/options.test.ts` | `outputExtensionFor` / `outputMimeFor` tables. `containerSupportsCodecs` re-export sanity check. |
| `video-trim/index.test.ts` | Validation: oversize → reject, bad MIME → reject, corrupt-bytes → reject. Conversion: trim `sample-h264-aac.mp4` to [1.0s, 3.0s] with `containerFormat: "same"` → output duration ≈ 2s (±0.5s tolerance for keyframe snap), output extension `.mp4`. With `containerFormat: "mkv"` → output extension `.mkv`. |
| `video-trim/options-panel.test.tsx` | Renders dropdown with all four entries. Mocked probe returning VP9+Opus → MP4 entry gets `disabled` attribute; MKV and "same" do not. |
| `video-extract-audio/options.test.ts` | Symmetric to `video-trim/options.test.ts`. |
| `video-extract-audio/index.test.ts` | Validation: oversize, bad MIME, no-audio (`sample-no-audio.mp4`). Conversion: `sample-h264-aac.mp4` + `"same"` → output is `.m4a`; re-probe the output (via the engine's worker harness) and assert `audioCodec === "aac"`, `videoCodec === null`. `"mp3"` re-encode → `.mp3` output, bitrate honored. `"flac"` → `.flac`, lossless. |

Naming convention follows existing: tests co-located with source.

### 9.2 E2E (Playwright, all three browsers)

| Spec | Covers |
|---|---|
| `tests/e2e/video-trim.spec.ts` | Drag-drop `sample-h264-aac.mp4`, scrubber renders frame strip (assert ≥10 `<img>` elements visible), keyboard-drag the in handle to ~25%, keyboard-drag the out handle to ~75%, click Convert, assert download fires with `.mp4` extension. |
| `tests/e2e/video-extract-audio.spec.ts` | Drag-drop, options panel renders the format `<select>` with five options, leave default `"same"`, click Convert, assert download fires with `.m4a` extension. Then re-stage and pick `"mp3"`, assert download with `.mp3` extension. |
| `tests/e2e/privacy-no-network.spec.ts` (existing) | Re-run; assert zero outbound network during a video-trim conversion. |
| `tests/e2e/coop-coep.spec.ts` (existing) | No changes; the new engines inherit the COOP/COEP gates and benefit from the MT ffmpeg core that Phase 21 wired up. |

### 9.3 Fixtures (committed under `tests/fixtures/`, each <1 MB)

All fixtures generated reproducibly via ffmpeg from a public-domain source clip (Big Buck Bunny first 5 seconds, or `testsrc=duration=5:size=320x180:rate=30` + `sine=frequency=440:duration=5` for a synthetic option). Generation script committed to `tests/fixtures/generate-video-fixtures.sh` for reproducibility (mirrors the audio fixture generation pattern from Phase 19/20).

| File | Codecs | Why |
|---|---|---|
| `sample-h264-aac.mp4` | H.264 + AAC, 320x180, 5s | Default mainstream case. |
| `sample-vp9-opus.webm` | VP9 + Opus, 320x180, 5s | Tests WebM input; tests MP4-container disabling (VP9 not in MP4 codec list). |
| `sample-h264.mov` | H.264 + AAC, 320x180, 5s | Tests MOV input (iPhone-style). |
| `sample-hevc-aac.mkv` | H.265 + AAC, 320x180, 5s | Tests MKV input; tests cross-container into MP4 (HEVC valid in MP4). |
| `sample-no-audio.mp4` | H.264, no audio, 320x180, 3s | Tests no-audio rejection in `video-extract-audio`. |

Total fixture footprint: ~500 KB.

## 10. Out of scope (deferred)

- **`video-convert` engine.** v2 design §11 phasing table puts it nominally with Phase 22, but design §3.6 prose and Phase 22 acceptance criteria treat it separately. Out of scope here; can be its own phase.
- **Re-encode trim mode (`precise`).** §2.1 above. Add later as additive option if user feedback demands sub-second precision.
- **Cancel button mid-conversion.** Phase 20 deferred this; same posture here. Trim is sub-second; extract-audio with `"same"` is sub-second; only the re-encode path on a 100 MB file might run ~30s and benefits from cancel — but the existing `AbortSignal` plumbing on `WorkerHarness` already lets the user navigate away.
- **File-card metadata display (codec / resolution / bitrate as text).** Probe data is available; rendering it is a UX-polish task, not a v22 deliverable.
- **Frame-strip re-extraction on browser resize.** v22 extracts once at mount. The scrubber's parent layout is responsive, but the strip's slot widths flex with the container — visually adequate without re-extraction.
- **Picture-in-picture preview / scrubber play-through.** Not in v2 design. Trim is a "set in/out and convert" workflow, not an editing surface.

## 11. Open questions / risks

1. **ffmpeg log-line parsing brittleness.** The probe parses `Duration:` and `Stream #N:M:` lines from stderr. Format is stable across ffmpeg versions but not contractually guaranteed. **Mitigation:** dedicated unit tests on each fixture; if a future ffmpeg upgrade breaks parsing, the tests catch it before users do. Long-term, a more structured probe (ffprobe wasm if it ever ships, or MP4Box.js for MP4-family + a smaller WebM parser) could replace this; not worth it now.
2. **MEMFS cleanup after probe and frame-strip.** Both write transient bytes to MEMFS. The implementations must `ffmpeg.deleteFile()` the inputs and outputs after reading, otherwise memory grows unboundedly across multiple file stagings on the same page. Tests should assert no leak (run probe N times, check MEMFS file count returns to baseline).
3. **Probe failures on rare codecs we accept.** A user could drop a `.mkv` containing a video codec ffmpeg's WASM build doesn't support (e.g., some HEVC profiles depending on build flags). The probe will succeed (it parses metadata) but the trim conversion will fail at runtime. Acceptable: the conversion's error surfaces normally. We don't pre-test every codec at probe time.
4. **Frame-strip extraction on a 100 MB file.** Even with `-c copy`-style metadata-only operations, extracting 60 frames from a 100 MB video may take 2–4 seconds on the warmed ffmpeg singleton. **Mitigation:** the extraction runs after the duration probe completes, so the scrubber handles are interactive (showing duration markers) before the strip lands; extraction shows a skeleton placeholder. Same UX pattern Phase 20 uses for the audio waveform.
5. **`<video>.duration` fallback correctness.** For some MP4 files written with a missing `mvhd` duration field, `<video>.duration` returns `Infinity` until the user starts playback. **Mitigation:** if `<video>.duration === Infinity || NaN`, fall back to the ffmpeg probe's `durationSec`. Phase 20's `duration.ts` should already handle this for `<audio>`; carry the same defensive code into the video branch.
