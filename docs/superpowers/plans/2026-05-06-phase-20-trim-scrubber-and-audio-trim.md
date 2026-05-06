# Phase 20: `_shared/trim-scrubber/` (audio half) + `audio-trim` — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the audio half of v2's trim-scrubber UI primitive (`src/engines/_shared/trim-scrubber/`) plus the first engine that uses it (`src/engines/audio-trim/`). audio-trim trims an MP3/WAV/M4A/FLAC losslessly via ffmpeg `-c copy` when the output format is unchanged, or re-encodes in a single ffmpeg call when the user picks a different format.

**Architecture:** ffmpeg is reused from Phase 19 — `_shared/ffmpeg/loadFfmpeg()`. Waveform peak extraction runs **inside the engine worker** (not the main thread) so the page loads ffmpeg WASM exactly once. To support that, `WorkerHarness` is extended with a `runDecodePeaks()` method backed by an optional `decodePeaks` RPC on `WorkerEntry`. The TrimScrubber React component is generic over `modality: "audio" | "video"`; the `"video"` branch is a typed stub that throws so Phase 22 can extend it additively. Source spec: `docs/superpowers/specs/2026-05-06-phase-20-trim-scrubber-and-audio-trim.md` (resolved decisions) and `docs/superpowers/specs/2026-05-05-v2-design.md` §2.1, §3.1, §11 item 3.

**Tech Stack:** React 19 + Tailwind, `@ffmpeg/ffmpeg` v0.12+ (already installed by Phase 19), Comlink, Vitest + React Testing Library (already installed). No new runtime dependencies.

**Hard constraints:**
- **Single ffmpeg load on the audio-trim page.** `loadFfmpeg()` is a per-execution-context module singleton; calling it from main-thread AND from the engine worker would double-load WASM (~60 MB). The plan routes peak decoding through the same persistent worker that runs the trim conversion. See Task 1 for the harness contract.
- **No off-origin fetches.** Phase 19's `coreURL` / `wasmURL` pinning to `/ffmpeg/*` is unchanged. The privacy-regression E2E (Task 11) reasserts zero outbound network during a real trim.
- **Bundle isolation.** `audio-trim/` auto-enrolls via `scripts/check-bundle-isolation.mjs`. `_shared/trim-scrubber/index.tsx` must not statically import `@ffmpeg/ffmpeg` — it imports `decode-peaks.ts` only as a type/structural reference; the worker is the runtime importer of ffmpeg via `loadFfmpeg()`.
- **`loadFfmpeg()` API frozen for Phase 21 coordination.** This phase MUST NOT edit `src/engines/_shared/ffmpeg/index.ts`, `vercel.json`, `package.json`, `pnpm-lock.yaml`, `scripts/copy-ffmpeg-core.mjs`, or `scripts/ffmpeg-manifest.json`. Phase 21 swaps `@ffmpeg/core` → `@ffmpeg/core-mt` against those exact files in parallel; touching them here breaks the merge.
- **Reuse Phase 19's audio fixtures.** `tests/fixtures/audio/sample.{mp3,wav,m4a,flac}` already exist. No new committed fixtures.
- **8 GB dev box discipline (per project memory `feedback_low_ram_dev_box`).** Run `pnpm test` and `pnpm test:e2e` serially. Cap vitest workers via `--pool=threads --poolOptions.threads.maxThreads=2` if memory pressure shows up.
- **Branch discipline (per project memory `feedback_branch_discipline`).** This phase MUST be developed on a dedicated feature branch (`phase-20-trim-scrubber-and-audio-trim`). Never on `main`. Implementer subagents must NOT run `git branch -m/-M` or `git checkout <branch>`. Whoever opens the worktree is responsible for setting the branch up first; subagents only commit on the already-checked-out branch.

**Out of scope (this phase):**
- `video-trim`, `video-convert`, `video-extract-audio` (Phase 22).
- Video render path inside `TrimScrubber` (Phase 22 — Phase 20 stubs it with `throw new Error(...)`).
- COOP/COEP headers + multi-threaded ffmpeg core swap (Phase 21).
- Cancel button mid-conversion (deferred until Phase 22 video where it becomes load-bearing).
- Sidebar group sectioning beyond appending one entry to the existing AUDIO group (Phase 26).

---

## File map

**Created:**

| Path | Responsibility |
|---|---|
| `src/engines/_shared/trim-scrubber/index.tsx` | `TrimScrubber` React component — bars canvas + two drag handles + keyboard a11y. Audio modality only; video throws. |
| `src/engines/_shared/trim-scrubber/index.test.tsx` | Component tests with pre-computed peaks (no ffmpeg). |
| `src/engines/_shared/trim-scrubber/decode-peaks.ts` | `peaksFromPCM` (pure bucket-min/max) + `decodePeaksInWorker` (worker-only, calls ffmpeg). |
| `src/engines/_shared/trim-scrubber/decode-peaks.test.ts` | Unit tests on `peaksFromPCM` only (pure). `decodePeaksInWorker` is exercised end-to-end in Task 11's correctness E2E. |
| `src/engines/_shared/trim-scrubber/duration.ts` | `readMediaDurationSec(file, modality)` — main-thread `<audio>.duration` probe. |
| `src/engines/_shared/trim-scrubber/duration.test.ts` | Probe tests with synthesized WAV; video branch asserts throw. |
| `src/engines/audio-trim/index.ts` | Engine descriptor (`SingleInputEngine`). |
| `src/engines/audio-trim/index.test.ts` | Descriptor unit tests (validation, metadata). |
| `src/engines/audio-trim/options.ts` | `AudioTrimOptions` type, defaults, format ↔ extension ↔ codec maps reusing audio-convert's. |
| `src/engines/audio-trim/options.test.ts` | Option-shape unit tests. |
| `src/engines/audio-trim/options-panel.tsx` | OptionsPanel: format dropdown + (conditional) bitrate dropdown + TrimScrubber + duration probe. |
| `src/engines/audio-trim/options-panel.test.tsx` | OptionsPanel render + interaction tests with mocked harness. |
| `src/engines/audio-trim/worker.ts` | Comlink-exposed worker; `convertSingle` (`-c copy` or single-call re-encode) + `decodePeaks`. |
| `src/app/tools/audio-trim/page.tsx` | One-line route: `<ToolFrame engine={engine} />` + harness dispose effect. |
| `tests/e2e/audio-trim.spec.ts` | Route + UI E2E (default suite, no real conversion). |
| `tests/e2e/audio-trim-correctness.spec.ts` | Real-conversion E2E (gated by `RUN_AUDIO_TRIM_CORRECTNESS=1`). |
| `tests/e2e/privacy-regression-audio-trim.spec.ts` | Zero off-origin assertion during a real trim. |

**Modified:**

| Path | Change |
|---|---|
| `src/engines/_shared/harness.ts` | Add optional `decodePeaks` to `WorkerEntry`; add `runDecodePeaks(file, bucketCount)` method to `WorkerHarness` (mirrors `runSingle`'s abort plumbing). |
| `src/engines/_shared/harness.test.ts` | New cases for `runDecodePeaks`: happy path, abort, missing-RPC throws actionably. |
| `src/engines/_shared/registry.ts` | Add `"audio-trim"` to `EngineId` union and `REGISTRY` map. |
| `src/engines/_shared/registry.metadata.test.ts` | Increment any exhaustive count assertions. |
| `src/components/layout/sidebar.tsx` | Append `audio-trim` entry to AUDIO group (group already exists from Phase 19). |
| `src/components/layout/sidebar.test.tsx` | Update count assertions if present. |
| `src/app/page.tsx` | Append `audio-trim` to `TOOLS`. |
| `src/app/page.test.tsx` | Update tool count assertion if present. |

**Untouched (verify no edits — these are Phase 21's surface):**
- `src/engines/_shared/ffmpeg/index.ts`
- `vercel.json`
- `package.json`
- `pnpm-lock.yaml`
- `scripts/copy-ffmpeg-core.mjs`
- `scripts/ffmpeg-manifest.json`
- `next.config.ts`
- All other engines under `src/engines/<id>/` (audio-convert, image-bg-remove, etc. unchanged)

---

## Task 1: Extend `WorkerHarness` with `runDecodePeaks`

**Why:** OptionsPanel needs to call `decodePeaks` on the same worker that the engine's `convert()` will later use, so ffmpeg loads once. Generic harness extension; optional on `WorkerEntry` so other engines are unaffected.

**Files:**
- Modify: `src/engines/_shared/harness.ts`
- Modify: `src/engines/_shared/harness.test.ts`

- [ ] **Step 1.1: Locate the existing harness test file or create it.**

```bash
ls src/engines/_shared/harness.test.ts 2>/dev/null && echo EXISTS || echo CREATE
```

If the file does not exist, the v1 harness has no co-located unit test and a new file `harness.test.ts` is being created in this task. If it does exist, append to it.

- [ ] **Step 1.2: Write failing tests for `runDecodePeaks`.**

Add (or write fresh, depending on Step 1.1) the following to `src/engines/_shared/harness.test.ts`:

```typescript
import * as Comlink from "comlink";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerHarness, type WorkerEntry } from "./harness";

// Comlink.expose-style mock: a function we can wrap as if it were a Comlink remote.
function makeMockWorker<TOpts>(api: WorkerEntry<TOpts>): {
  worker: Worker;
  api: WorkerEntry<TOpts>;
  terminate: ReturnType<typeof vi.fn>;
} {
  const terminate = vi.fn();
  const worker = {
    terminate,
    postMessage: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onmessage: null,
    onerror: null,
    onmessageerror: null,
  } as unknown as Worker;
  return { worker, api, terminate };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WorkerHarness.runDecodePeaks", () => {
  it("forwards bytes + extension + bucketCount to the worker and returns the peaks", async () => {
    const peaks = { min: new Float32Array([-0.5, -0.3]), max: new Float32Array([0.5, 0.3]) };
    const decodePeaks = vi.fn().mockResolvedValue(peaks);
    const { worker } = makeMockWorker<unknown>({ decodePeaks });

    // Patch Comlink.wrap to return our api directly so we don't need a real Worker.
    const wrapSpy = vi.spyOn(Comlink, "wrap").mockReturnValue({
      decodePeaks,
    } as unknown as Comlink.Remote<WorkerEntry<unknown>>);

    const harness = new WorkerHarness<unknown>(() => worker, { persistent: true });
    const file = new File([new Uint8Array([1, 2, 3, 4])], "song.mp3", { type: "audio/mpeg" });

    const result = await harness.runDecodePeaks(file, 64);

    expect(result).toEqual(peaks);
    expect(decodePeaks).toHaveBeenCalledTimes(1);
    const call = decodePeaks.mock.calls[0];
    expect(call[1]).toBe("mp3");
    expect(call[2]).toBe(64);
    // First arg is an ArrayBuffer with the same bytes.
    expect(new Uint8Array(call[0] as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3, 4]));
    wrapSpy.mockRestore();
  });

  it("throws an actionable error when the worker does not implement decodePeaks", async () => {
    const { worker } = makeMockWorker<unknown>({});
    const wrapSpy = vi.spyOn(Comlink, "wrap").mockReturnValue({} as unknown as Comlink.Remote<WorkerEntry<unknown>>);
    const harness = new WorkerHarness<unknown>(() => worker, { persistent: true });
    const file = new File([new Uint8Array([0])], "x.wav", { type: "audio/wav" });
    await expect(harness.runDecodePeaks(file, 32)).rejects.toThrow(/does not implement decodePeaks/);
    wrapSpy.mockRestore();
  });

  it("lowercases the extension when reading from the file name", async () => {
    const decodePeaks = vi.fn().mockResolvedValue({ min: new Float32Array(), max: new Float32Array() });
    const { worker } = makeMockWorker<unknown>({ decodePeaks });
    const wrapSpy = vi.spyOn(Comlink, "wrap").mockReturnValue({ decodePeaks } as unknown as Comlink.Remote<WorkerEntry<unknown>>);
    const harness = new WorkerHarness<unknown>(() => worker, { persistent: true });
    const file = new File([new Uint8Array([0])], "Tune.FLAC", { type: "audio/flac" });
    await harness.runDecodePeaks(file, 16);
    expect(decodePeaks.mock.calls[0][1]).toBe("flac");
    wrapSpy.mockRestore();
  });
});
```

- [ ] **Step 1.3: Run the test — expect FAIL.**

```bash
pnpm test src/engines/_shared/harness.test.ts -t "runDecodePeaks"
```

Expected: TypeScript / runtime error — `runDecodePeaks` is not a method of `WorkerHarness`, and `decodePeaks` is not a known field on `WorkerEntry`.

- [ ] **Step 1.4: Extend `WorkerEntry` with the optional `decodePeaks` RPC.**

Edit `src/engines/_shared/harness.ts`. Inside the `WorkerEntry<TOptions>` type, after the `convertMulti?` declaration:

**old_string:**
```typescript
  convertMulti?: (
    files: Array<{ bytes: ArrayBuffer; name: string; type: string }>,
    opts: TOptions,
    onProgress?: (p: ConversionProgress) => void,
  ) => Promise<OutputItem | OutputItem[]>;
};
```

**new_string:**
```typescript
  convertMulti?: (
    files: Array<{ bytes: ArrayBuffer; name: string; type: string }>,
    opts: TOptions,
    onProgress?: (p: ConversionProgress) => void,
  ) => Promise<OutputItem | OutputItem[]>;
  /** Optional: extract waveform peaks for trim-scrubber engines. The trim
   * engines call this RPC from their OptionsPanel via WorkerHarness.runDecodePeaks
   * so peak decoding shares the same persistent worker (and ffmpeg singleton)
   * as the conversion that will follow. */
  decodePeaks?: (
    bytes: ArrayBuffer,
    fileExtension: string,
    bucketCount: number,
  ) => Promise<{ min: Float32Array; max: Float32Array }>;
};
```

- [ ] **Step 1.5: Add `runDecodePeaks` method to `WorkerHarness`.**

Edit `src/engines/_shared/harness.ts`. After the `runMulti` method, before `dispose`:

**old_string:**
```typescript
  /** Force-terminate the persistent worker. No-op for ephemeral mode (the
```

**new_string:**
```typescript
  async runDecodePeaks(
    file: File,
    bucketCount: number,
  ): Promise<{ min: Float32Array; max: Float32Array }> {
    this.spawn();
    if (!this.remote?.decodePeaks) {
      this.terminateIfEphemeral();
      throw new Error("worker does not implement decodePeaks");
    }
    const decodePeaks = this.remote.decodePeaks as unknown as (
      bytes: ArrayBuffer,
      fileExtension: string,
      bucketCount: number,
    ) => Promise<{ min: Float32Array; max: Float32Array }>;
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    const bytes = await file.arrayBuffer();
    try {
      return await decodePeaks(bytes, ext, bucketCount);
    } finally {
      this.terminateIfEphemeral();
    }
  }

  /** Force-terminate the persistent worker. No-op for ephemeral mode (the
```

Note: `runDecodePeaks` deliberately does NOT take an `AbortSignal` in this phase. Peak decoding is short (sub-second on typical inputs) and is invoked from the OptionsPanel, not the engine's `convert` lifecycle. If a user navigates away mid-decode, the page-level `harness.dispose()` already terminates the worker.

- [ ] **Step 1.6: Run the tests — expect PASS.**

```bash
pnpm test src/engines/_shared/harness.test.ts
```

Expected: all `runDecodePeaks` tests pass; existing `runSingle` / `runMulti` tests (if any) still pass.

- [ ] **Step 1.7: Typecheck.**

```bash
pnpm typecheck
```

Expected: zero errors.

- [ ] **Step 1.8: Commit.**

```bash
git add src/engines/_shared/harness.ts src/engines/_shared/harness.test.ts
git commit -m "Phase 20: WorkerHarness.runDecodePeaks for trim-scrubber"
```

---

## Task 2: `_shared/trim-scrubber/duration.ts` — main-thread duration probe

**Why:** TrimScrubber needs `durationSec` to position handles. Probing via `<audio>.duration` after `loadedmetadata` returns in tens of milliseconds, so handles render before ffmpeg-driven peaks are ready.

**Files:**
- Create: `src/engines/_shared/trim-scrubber/duration.ts`
- Create: `src/engines/_shared/trim-scrubber/duration.test.ts`

- [ ] **Step 2.1: Write the failing tests.**

Create `src/engines/_shared/trim-scrubber/duration.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { readMediaDurationSec } from "./duration";

/** Synthesize a minimal valid WAV blob of the given duration at 8 kHz mono i16le.
 *  Used to exercise the <audio>.duration probe without a fixture. */
function makeSilentWav(durationSec: number): File {
  const sampleRate = 8000;
  const numSamples = Math.round(durationSec * sampleRate);
  const dataBytes = numSamples * 2; // i16
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  // RIFF header
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataBytes, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataBytes, true);
  // Samples are zero (silence); already initialized by ArrayBuffer.
  return new File([buf], `silent-${durationSec}s.wav`, { type: "audio/wav" });
}

describe("readMediaDurationSec", () => {
  it("returns the duration of a synthesized WAV within ±50 ms (audio modality)", async () => {
    const file = makeSilentWav(2.0);
    const d = await readMediaDurationSec(file, "audio");
    expect(d).toBeGreaterThan(1.95);
    expect(d).toBeLessThan(2.05);
  });

  it("throws for the video modality (deferred to phase 22)", async () => {
    const file = makeSilentWav(0.5);
    await expect(readMediaDurationSec(file, "video")).rejects.toThrow(/video.*phase 22/i);
  });
});
```

- [ ] **Step 2.2: Run — expect FAIL (file does not exist).**

```bash
pnpm test src/engines/_shared/trim-scrubber/duration.test.ts
```

Expected: import resolution error.

- [ ] **Step 2.3: Implement `duration.ts`.**

Create `src/engines/_shared/trim-scrubber/duration.ts`:

```typescript
/**
 * Probe a media file's duration on the main thread via the browser's
 * native HTMLMediaElement metadata loader. Returns in tens of milliseconds
 * for typical audio inputs — much faster than waiting for ffmpeg WASM to
 * load, which lets TrimScrubber position handles immediately.
 *
 * Phase 20 implements `modality: "audio"` only. The `"video"` branch is
 * a typed stub that throws so Phase 22 can extend additively (no API churn).
 */
export async function readMediaDurationSec(
  file: File,
  modality: "audio" | "video",
): Promise<number> {
  if (modality === "video") {
    throw new Error("video modality not implemented in phase 20 — deferred to phase 22");
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<number>((resolve, reject) => {
      const el = document.createElement("audio");
      const onLoaded = () => {
        if (Number.isFinite(el.duration) && el.duration > 0) {
          resolve(el.duration);
        } else {
          reject(new Error("media duration is not finite"));
        }
      };
      const onError = () => reject(new Error("failed to load audio metadata"));
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

- [ ] **Step 2.4: Run — expect PASS.**

```bash
pnpm test src/engines/_shared/trim-scrubber/duration.test.ts
```

Expected: both tests pass. (The Vitest jsdom environment supports `<audio>` metadata reads against blob URLs for valid WAV/MP3 — verified by audio-convert's E2E pattern.)

If the audio probe test times out, the jsdom environment may not actually decode the WAV. In that case, gate the test with `it.runIf(typeof HTMLMediaElement !== "undefined" && (HTMLMediaElement as unknown as { __jsdomShim?: true }).__jsdomShim !== true, ...)` and rely on Task 11's E2E to cover the live behavior. **Try the unit test first and only fall back if it actually fails.**

- [ ] **Step 2.5: Commit.**

```bash
git add src/engines/_shared/trim-scrubber/duration.ts src/engines/_shared/trim-scrubber/duration.test.ts
git commit -m "Phase 20: trim-scrubber duration probe (audio modality)"
```

---

## Task 3: `_shared/trim-scrubber/decode-peaks.ts`

**Why:** Pure peak-bucketing function (`peaksFromPCM`) is testable in isolation. The ffmpeg-driven `decodePeaksInWorker` wrapper is exercised by Task 11's correctness E2E (no point mocking ffmpeg in a unit test — the real RPC contract is small and the integration is what matters).

**Files:**
- Create: `src/engines/_shared/trim-scrubber/decode-peaks.ts`
- Create: `src/engines/_shared/trim-scrubber/decode-peaks.test.ts`

- [ ] **Step 3.1: Write the failing tests.**

Create `src/engines/_shared/trim-scrubber/decode-peaks.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { peaksFromPCM, type Peaks } from "./decode-peaks";

/** Synthesize one second of a 440 Hz sine wave at the given sample rate. */
function makeSinePCM(durationSec: number, sampleRate: number, freqHz = 440): Float32Array {
  const n = Math.round(durationSec * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  }
  return out;
}

describe("peaksFromPCM", () => {
  it("returns Peaks with min/max arrays of length bucketCount", () => {
    const pcm = makeSinePCM(1, 8000);
    const p: Peaks = peaksFromPCM(pcm, 64);
    expect(p.min.length).toBe(64);
    expect(p.max.length).toBe(64);
  });

  it("produces non-zero magnitudes across all buckets for a non-trivial signal", () => {
    const pcm = makeSinePCM(1, 8000);
    const p = peaksFromPCM(pcm, 64);
    for (let i = 0; i < 64; i++) {
      expect(Math.abs(p.max[i] ?? 0)).toBeGreaterThan(0);
      expect(Math.abs(p.min[i] ?? 0)).toBeGreaterThan(0);
    }
  });

  it("min values are <= 0 and max values are >= 0", () => {
    const pcm = makeSinePCM(1, 8000);
    const p = peaksFromPCM(pcm, 64);
    for (let i = 0; i < 64; i++) {
      expect(p.min[i] ?? 0).toBeLessThanOrEqual(0);
      expect(p.max[i] ?? 0).toBeGreaterThanOrEqual(0);
    }
  });

  it("max approaches 1 and min approaches -1 for a full-amplitude sine across enough samples", () => {
    const pcm = makeSinePCM(1, 48000);
    const p = peaksFromPCM(pcm, 16); // 3000 samples per bucket — many full cycles each
    for (let i = 0; i < 16; i++) {
      expect(p.max[i] ?? 0).toBeGreaterThan(0.99);
      expect(p.min[i] ?? 0).toBeLessThan(-0.99);
    }
  });

  it("returns empty arrays when given empty PCM", () => {
    const p = peaksFromPCM(new Float32Array(0), 32);
    expect(p.min.length).toBe(32);
    expect(p.max.length).toBe(32);
    expect(p.min.every((v) => v === 0)).toBe(true);
    expect(p.max.every((v) => v === 0)).toBe(true);
  });

  it("throws when bucketCount is <= 0", () => {
    const pcm = makeSinePCM(0.1, 8000);
    expect(() => peaksFromPCM(pcm, 0)).toThrow();
    expect(() => peaksFromPCM(pcm, -1)).toThrow();
  });
});
```

- [ ] **Step 3.2: Run — expect FAIL (module missing).**

```bash
pnpm test src/engines/_shared/trim-scrubber/decode-peaks.test.ts
```

- [ ] **Step 3.3: Implement `decode-peaks.ts`.**

Create `src/engines/_shared/trim-scrubber/decode-peaks.ts`:

```typescript
import type { FFmpeg as FFmpegType } from "@ffmpeg/ffmpeg";

export type Peaks = {
  min: Float32Array; // length === bucketCount, range [-1, 0]
  max: Float32Array; // length === bucketCount, range [0, 1]
};

/** Bucket a PCM stream into per-bucket (min, max) pairs. Pure function. */
export function peaksFromPCM(pcm: Float32Array, bucketCount: number): Peaks {
  if (!Number.isInteger(bucketCount) || bucketCount <= 0) {
    throw new Error(`peaksFromPCM: bucketCount must be a positive integer, got ${bucketCount}`);
  }
  const min = new Float32Array(bucketCount);
  const max = new Float32Array(bucketCount);
  if (pcm.length === 0) {
    return { min, max };
  }
  const samplesPerBucket = pcm.length / bucketCount;
  for (let b = 0; b < bucketCount; b++) {
    const start = Math.floor(b * samplesPerBucket);
    const end = b === bucketCount - 1 ? pcm.length : Math.floor((b + 1) * samplesPerBucket);
    let lo = 0;
    let hi = 0;
    for (let i = start; i < end; i++) {
      const v = pcm[i] ?? 0;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { min, max };
}

/**
 * Worker-only helper: feed `bytes` into ffmpeg, decode to mono f32le PCM at a
 * decimated sample rate, and bucket into `bucketCount` peaks. Must run inside
 * an engine worker that already holds an FFmpeg instance (do NOT call
 * loadFfmpeg() from main thread for peak decoding — see phase 20 spec §2.5b).
 */
export async function decodePeaksInWorker(
  ff: FFmpegType,
  bytes: ArrayBuffer,
  fileExtension: string,
  bucketCount: number,
): Promise<Peaks> {
  if (!Number.isInteger(bucketCount) || bucketCount <= 0) {
    throw new Error(`decodePeaksInWorker: bucketCount must be a positive integer, got ${bucketCount}`);
  }
  const ext = fileExtension.toLowerCase().replace(/^\./, "");
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const inName = `peaks-in-${id}.${ext || "bin"}`;
  const outName = `peaks-out-${id}.pcm`;

  // Target ~bucketCount * 256 samples in the decoded stream so each bucket has
  // enough material to compute meaningful min/max without fetching the entire
  // PCM. -ar 8000 + -ac 1 gives mono 8 kHz f32le — for a 60 s file that's ~480k
  // samples; bucketing to 512 gives ~937 samples per bucket. Plenty of detail.
  const args = [
    "-i", inName,
    "-vn",
    "-ac", "1",
    "-ar", "8000",
    "-f", "f32le",
    "-c:a", "pcm_f32le",
    outName,
  ];

  try {
    await ff.writeFile(inName, new Uint8Array(bytes));
    const exitCode = await ff.exec(args);
    if (exitCode !== 0) {
      throw new Error(`decodePeaksInWorker: ffmpeg exited with code ${exitCode}`);
    }
    const out = await ff.readFile(outName);
    if (typeof out === "string") {
      throw new Error("decodePeaksInWorker: ffmpeg returned text output unexpectedly");
    }
    const u8 = out as Uint8Array;
    // Float32Array view requires a 4-byte aligned ArrayBuffer slice; copy to a
    // fresh buffer to avoid alignment surprises across runtimes.
    const aligned = new ArrayBuffer(u8.byteLength);
    new Uint8Array(aligned).set(u8);
    const pcm = new Float32Array(aligned);
    return peaksFromPCM(pcm, bucketCount);
  } finally {
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
}
```

- [ ] **Step 3.4: Run — expect PASS.**

```bash
pnpm test src/engines/_shared/trim-scrubber/decode-peaks.test.ts
```

Expected: all six tests pass.

- [ ] **Step 3.5: Commit.**

```bash
git add src/engines/_shared/trim-scrubber/decode-peaks.ts src/engines/_shared/trim-scrubber/decode-peaks.test.ts
git commit -m "Phase 20: peaksFromPCM (pure) + decodePeaksInWorker (ffmpeg-driven)"
```

---

## Task 4: `_shared/trim-scrubber/index.tsx` — TrimScrubber component

**Why:** The shared UI primitive. Audio render path fully implemented. Video path throws so the component's API shape is final and Phase 22 only fills in rendering.

**Files:**
- Create: `src/engines/_shared/trim-scrubber/index.tsx`
- Create: `src/engines/_shared/trim-scrubber/index.test.tsx`

- [ ] **Step 4.1: Write the failing component tests.**

Create `src/engines/_shared/trim-scrubber/index.test.tsx`:

```typescript
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TrimScrubber } from "./index";

const fakeFile = new File([new Uint8Array([0])], "x.mp3", { type: "audio/mpeg" });

describe("TrimScrubber (audio)", () => {
  it("renders mm:ss.ms labels for start and end positions", () => {
    render(
      <TrimScrubber
        source={fakeFile}
        modality="audio"
        durationSec={75.5}
        startSec={10}
        endSec={70}
        onChange={() => {}}
      />,
    );
    // Start handle label: 10s → "00:10.000"
    expect(screen.getByText("00:10.000")).toBeInTheDocument();
    // End handle label: 70s → "01:10.000"
    expect(screen.getByText("01:10.000")).toBeInTheDocument();
  });

  it("renders two interactive handles with role=slider and accessible labels", () => {
    render(
      <TrimScrubber
        source={fakeFile}
        modality="audio"
        durationSec={60}
        startSec={5}
        endSec={55}
        onChange={() => {}}
      />,
    );
    const start = screen.getByRole("slider", { name: /trim start/i });
    const end = screen.getByRole("slider", { name: /trim end/i });
    expect(start).toBeInTheDocument();
    expect(end).toBeInTheDocument();
    expect(start.getAttribute("aria-valuenow")).toBe("5");
    expect(end.getAttribute("aria-valuenow")).toBe("55");
    expect(start.getAttribute("aria-valuemin")).toBe("0");
    expect(start.getAttribute("aria-valuemax")).toBe("60");
  });

  it("ArrowRight on the start handle moves start forward by 1 s", () => {
    const onChange = vi.fn();
    render(
      <TrimScrubber
        source={fakeFile}
        modality="audio"
        durationSec={60}
        startSec={5}
        endSec={55}
        onChange={onChange}
      />,
    );
    const start = screen.getByRole("slider", { name: /trim start/i });
    fireEvent.keyDown(start, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(6, 55);
  });

  it("Shift+ArrowRight on the end handle moves end forward by 10 s, clamped to duration", () => {
    const onChange = vi.fn();
    render(
      <TrimScrubber
        source={fakeFile}
        modality="audio"
        durationSec={60}
        startSec={5}
        endSec={55}
        onChange={onChange}
      />,
    );
    const end = screen.getByRole("slider", { name: /trim end/i });
    fireEvent.keyDown(end, { key: "ArrowRight", shiftKey: true });
    expect(onChange).toHaveBeenCalledWith(5, 60); // clamped to durationSec
  });

  it("ArrowLeft on the start handle stops at 0", () => {
    const onChange = vi.fn();
    render(
      <TrimScrubber
        source={fakeFile}
        modality="audio"
        durationSec={60}
        startSec={0.5}
        endSec={55}
        onChange={onChange}
      />,
    );
    const start = screen.getByRole("slider", { name: /trim start/i });
    fireEvent.keyDown(start, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith(0, 55);
  });

  it("start handle cannot be moved past end handle (clamped to endSec)", () => {
    const onChange = vi.fn();
    render(
      <TrimScrubber
        source={fakeFile}
        modality="audio"
        durationSec={60}
        startSec={54.5}
        endSec={55}
        onChange={onChange}
      />,
    );
    const start = screen.getByRole("slider", { name: /trim start/i });
    fireEvent.keyDown(start, { key: "ArrowRight" });
    // Would land at 55.5, which exceeds endSec; clamp to endSec.
    expect(onChange).toHaveBeenCalledWith(55, 55);
  });

  it("does not call onChange when disabled", () => {
    const onChange = vi.fn();
    render(
      <TrimScrubber
        source={fakeFile}
        modality="audio"
        durationSec={60}
        startSec={5}
        endSec={55}
        onChange={onChange}
        disabled
      />,
    );
    const start = screen.getByRole("slider", { name: /trim start/i });
    fireEvent.keyDown(start, { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("throws synchronously for the video modality (deferred to phase 22)", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <TrimScrubber
          source={fakeFile}
          modality="video"
          durationSec={60}
          startSec={0}
          endSec={60}
          onChange={() => {}}
        />,
      ),
    ).toThrow(/video.*phase 22/i);
    consoleSpy.mockRestore();
  });
});
```

- [ ] **Step 4.2: Run — expect FAIL.**

```bash
pnpm test src/engines/_shared/trim-scrubber/index.test.tsx
```

- [ ] **Step 4.3: Implement `TrimScrubber`.**

Create `src/engines/_shared/trim-scrubber/index.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { Peaks } from "./decode-peaks";

export type TrimScrubberProps = {
  source: File;
  modality: "audio" | "video";
  durationSec: number;
  startSec: number;
  endSec: number;
  onChange(start: number, end: number): void;
  disabled?: boolean;
  /** Optional injection point for tests; production callers pass a function
   * backed by WorkerHarness.runDecodePeaks. When omitted, the component
   * renders the flat hairline state and never decodes peaks. */
  decodePeaks?: (file: File, bucketCount: number) => Promise<Peaks>;
};

const BUCKET_COUNT = 512;
const ARROW_STEP_SEC = 1;
const SHIFT_ARROW_STEP_SEC = 10;

function formatTimestamp(sec: number): string {
  const safe = Number.isFinite(sec) && sec >= 0 ? sec : 0;
  const mm = Math.floor(safe / 60).toString().padStart(2, "0");
  const ss = Math.floor(safe % 60).toString().padStart(2, "0");
  const ms = Math.floor((safe % 1) * 1000).toString().padStart(3, "0");
  return `${mm}:${ss}.${ms}`;
}

export function TrimScrubber({
  source,
  modality,
  durationSec,
  startSec,
  endSec,
  onChange,
  disabled = false,
  decodePeaks,
}: TrimScrubberProps) {
  if (modality === "video") {
    throw new Error("video modality not implemented in phase 20 — deferred to phase 22");
  }

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [peaks, setPeaks] = useState<Peaks | null>(null);

  // Trigger peak decode whenever the source file changes (and a decoder is
  // injected). The OptionsPanel passes a worker-backed decoder; component
  // tests pass nothing so the bars area stays as a flat hairline.
  useEffect(() => {
    let cancelled = false;
    if (!decodePeaks) return;
    decodePeaks(source, BUCKET_COUNT).then(
      (p) => {
        if (!cancelled) setPeaks(p);
      },
      () => {
        if (!cancelled) setPeaks(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [source, decodePeaks]);

  // Render bars (or the hairline placeholder) on canvas whenever peaks change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "currentColor";
    if (!peaks) {
      // Hairline placeholder.
      ctx.fillRect(0, Math.floor(h / 2), w, 1);
      return;
    }
    const barW = w / peaks.max.length;
    const mid = h / 2;
    for (let i = 0; i < peaks.max.length; i++) {
      const x = Math.floor(i * barW);
      const top = Math.floor(mid - mid * (peaks.max[i] ?? 0));
      const bottom = Math.ceil(mid - mid * (peaks.min[i] ?? 0));
      ctx.fillRect(x, top, Math.max(1, Math.floor(barW)), Math.max(1, bottom - top));
    }
  }, [peaks]);

  const handleKeyDown =
    (which: "start" | "end") => (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      let delta = 0;
      if (e.key === "ArrowRight") delta = e.shiftKey ? SHIFT_ARROW_STEP_SEC : ARROW_STEP_SEC;
      else if (e.key === "ArrowLeft") delta = -(e.shiftKey ? SHIFT_ARROW_STEP_SEC : ARROW_STEP_SEC);
      if (delta === 0) return;
      e.preventDefault();
      let nextStart = startSec;
      let nextEnd = endSec;
      if (which === "start") {
        nextStart = Math.max(0, Math.min(endSec, startSec + delta));
      } else {
        nextEnd = Math.max(startSec, Math.min(durationSec, endSec + delta));
      }
      onChange(nextStart, nextEnd);
    };

  const startPct = durationSec > 0 ? (startSec / durationSec) * 100 : 0;
  const endPct = durationSec > 0 ? (endSec / durationSec) * 100 : 100;

  return (
    <div
      data-testid="trim-scrubber"
      className="relative my-3 w-full select-none border border-[var(--color-hairline)] bg-[var(--color-bg)] text-[var(--color-fg-strong)]"
    >
      <canvas
        ref={canvasRef}
        width={1024}
        height={96}
        className="block h-24 w-full"
        aria-hidden="true"
      />
      {/* Selected region overlay */}
      <div
        className="pointer-events-none absolute inset-y-0 border-l border-r border-[var(--color-fg-strong)] bg-[color-mix(in_srgb,var(--color-fg-strong)_10%,transparent)]"
        style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
        aria-hidden="true"
      />
      {/* Start handle */}
      <div
        role="slider"
        aria-label="trim start"
        aria-valuemin={0}
        aria-valuemax={durationSec}
        aria-valuenow={startSec}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={handleKeyDown("start")}
        className="absolute inset-y-0 w-px cursor-ew-resize bg-[var(--color-fg-strong)] outline-none focus:ring-2 focus:ring-[var(--color-fg-strong)]"
        style={{ left: `${startPct}%` }}
      >
        <span className="absolute left-1 top-full mt-1 whitespace-nowrap font-mono text-[var(--text-2xs)] uppercase text-[var(--color-fg-muted)]">
          {formatTimestamp(startSec)}
        </span>
      </div>
      {/* End handle */}
      <div
        role="slider"
        aria-label="trim end"
        aria-valuemin={0}
        aria-valuemax={durationSec}
        aria-valuenow={endSec}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={handleKeyDown("end")}
        className="absolute inset-y-0 w-px cursor-ew-resize bg-[var(--color-fg-strong)] outline-none focus:ring-2 focus:ring-[var(--color-fg-strong)]"
        style={{ left: `${endPct}%` }}
      >
        <span className="absolute right-1 top-full mt-1 whitespace-nowrap font-mono text-[var(--text-2xs)] uppercase text-[var(--color-fg-muted)]">
          {formatTimestamp(endSec)}
        </span>
      </div>
    </div>
  );
}
```

Note on the test injection point: the production callsite (audio-trim's OptionsPanel) passes `decodePeaks={(f, n) => harness.runDecodePeaks(f, n)}`. Component tests pass nothing, so peaks stay null and the test never has to mock the worker. The structure also lets Phase 22's video render path inject a frame-strip extractor with the same shape.

- [ ] **Step 4.4: Run — expect PASS.**

```bash
pnpm test src/engines/_shared/trim-scrubber/index.test.tsx
```

Expected: all eight tests pass. If the `aria-valuemax` test fails because the value is rendered as `60` (number) vs `"60"` (string): the DOM normalizes attributes to strings, so `getAttribute` always returns a string — the test should be correct. If the throw test fails with React's error boundary intercepting: that's why the test wraps `expect(() => render(...)).toThrow()` and silences `console.error` — verify the spy is in place.

- [ ] **Step 4.5: Commit.**

```bash
git add src/engines/_shared/trim-scrubber/index.tsx src/engines/_shared/trim-scrubber/index.test.tsx
git commit -m "Phase 20: TrimScrubber component (audio modality)"
```

---

## Task 5: `audio-trim/options.ts` — option types + maps

**Why:** Engine descriptor and worker both depend on the option shape and codec/extension maps. Pure types and maps; trivially testable.

**Files:**
- Create: `src/engines/audio-trim/options.ts`
- Create: `src/engines/audio-trim/options.test.ts`

- [ ] **Step 5.1: Write the failing tests.**

Create `src/engines/audio-trim/options.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  AUDIO_TRIM_BITRATE_OPTIONS,
  AUDIO_TRIM_FORMATS,
  defaultAudioTrimOptions,
  isLossyOutput,
  outputExtensionFor,
  outputMimeFor,
  type AudioTrimOptions,
} from "./options";

describe("audio-trim options", () => {
  it("defaults outputFormat to 'same' so users get a fast lossless trim by default", () => {
    expect(defaultAudioTrimOptions.outputFormat).toBe("same");
  });

  it("defaults bitrate to 192", () => {
    expect(defaultAudioTrimOptions.bitrate).toBe(192);
  });

  it("defaults startSec=0, endSec=0", () => {
    expect(defaultAudioTrimOptions.startSec).toBe(0);
    expect(defaultAudioTrimOptions.endSec).toBe(0);
  });

  it("AUDIO_TRIM_FORMATS has same + four codecs in stable order", () => {
    expect(AUDIO_TRIM_FORMATS).toEqual(["same", "mp3", "wav", "m4a", "flac"]);
  });

  it("AUDIO_TRIM_BITRATE_OPTIONS matches the audio-convert set", () => {
    expect(AUDIO_TRIM_BITRATE_OPTIONS).toEqual([64, 128, 192, 256, 320]);
  });

  it("isLossyOutput is true for mp3/m4a, false for wav/flac, false for 'same'", () => {
    expect(isLossyOutput("mp3")).toBe(true);
    expect(isLossyOutput("m4a")).toBe(true);
    expect(isLossyOutput("wav")).toBe(false);
    expect(isLossyOutput("flac")).toBe(false);
    expect(isLossyOutput("same")).toBe(false);
  });

  it("outputExtensionFor returns the input extension when format is 'same'", () => {
    expect(outputExtensionFor("same", "song.mp3")).toBe("mp3");
    expect(outputExtensionFor("same", "TUNE.FLAC")).toBe("flac");
  });

  it("outputExtensionFor returns the format when format is concrete", () => {
    expect(outputExtensionFor("mp3", "anything.wav")).toBe("mp3");
    expect(outputExtensionFor("flac", "x.m4a")).toBe("flac");
  });

  it("outputMimeFor maps each format to a stable mime; 'same' uses the input mime", () => {
    expect(outputMimeFor("mp3", "audio/wav")).toBe("audio/mpeg");
    expect(outputMimeFor("wav", "audio/mpeg")).toBe("audio/wav");
    expect(outputMimeFor("flac", "audio/wav")).toBe("audio/flac");
    expect(outputMimeFor("m4a", "audio/wav")).toBe("audio/mp4");
    expect(outputMimeFor("same", "audio/mpeg")).toBe("audio/mpeg");
  });
});
```

- [ ] **Step 5.2: Run — expect FAIL.**

```bash
pnpm test src/engines/audio-trim/options.test.ts
```

- [ ] **Step 5.3: Implement `options.ts`.**

Create `src/engines/audio-trim/options.ts`:

```typescript
import { OUTPUT_EXTENSION, OUTPUT_MIME } from "@/engines/audio-convert/options";

export type AudioTrimFormat = "same" | "mp3" | "wav" | "m4a" | "flac";
export type AudioTrimBitrate = 64 | 128 | 192 | 256 | 320;

export type AudioTrimOptions = {
  startSec: number;
  endSec: number;
  outputFormat: AudioTrimFormat;
  /** Ignored at runtime when outputFormat is "same" or a lossless codec. */
  bitrate: AudioTrimBitrate;
};

export const AUDIO_TRIM_FORMATS: ReadonlyArray<AudioTrimFormat> = [
  "same",
  "mp3",
  "wav",
  "m4a",
  "flac",
];

export const AUDIO_TRIM_BITRATE_OPTIONS: ReadonlyArray<AudioTrimBitrate> = [64, 128, 192, 256, 320];

export const defaultAudioTrimOptions: AudioTrimOptions = {
  startSec: 0,
  endSec: 0,
  outputFormat: "same",
  bitrate: 192,
};

export function isLossyOutput(fmt: AudioTrimFormat): boolean {
  return fmt === "mp3" || fmt === "m4a";
}

function extensionOf(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

export function outputExtensionFor(fmt: AudioTrimFormat, inputName: string): string {
  if (fmt === "same") return extensionOf(inputName);
  return OUTPUT_EXTENSION[fmt];
}

export function outputMimeFor(fmt: AudioTrimFormat, inputMime: string): string {
  if (fmt === "same") return inputMime;
  return OUTPUT_MIME[fmt];
}
```

- [ ] **Step 5.4: Run — expect PASS.**

```bash
pnpm test src/engines/audio-trim/options.test.ts
```

- [ ] **Step 5.5: Commit.**

```bash
git add src/engines/audio-trim/options.ts src/engines/audio-trim/options.test.ts
git commit -m "Phase 20: audio-trim option types + format maps"
```

---

## Task 6: `audio-trim/worker.ts` — Comlink RPC for `convertSingle` + `decodePeaks`

**Why:** The worker exposes both the trim conversion and the peaks decode. Both share the worker-scope ffmpeg singleton. No unit test (would mock too much for too little signal); covered by the correctness E2E in Task 11.

**Files:**
- Create: `src/engines/audio-trim/worker.ts`

- [ ] **Step 6.1: Write the worker module.**

Create `src/engines/audio-trim/worker.ts`:

```typescript
import { loadFfmpeg } from "@/engines/_shared/ffmpeg";
import { decodePeaksInWorker } from "@/engines/_shared/trim-scrubber/decode-peaks";
import type { ConversionProgress, OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import {
  type AudioTrimOptions,
  isLossyOutput,
  outputExtensionFor,
  outputMimeFor,
} from "./options";

// Cancellation note: this worker uses the WorkerHarness in `persistent: true`
// mode (see ./index.ts). In-flight ffmpeg work is NOT terminated when the user
// aborts — the rejected host promise unblocks the UI immediately, but ffmpeg
// keeps grinding inside the worker until the current pass finishes. Trim with
// -c copy is sub-second on typical inputs; re-encode of a long input may take
// seconds. Acceptable for v2; revisit if user-perceivable lag shows up.

function replaceExtension(name: string, newExt: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}-trim.${newExt}`;
}

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
      throw new Error(`audio-trim: unknown output format: ${_exhaustive}`);
    }
  }
}

const api = {
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    type: string,
    opts: AudioTrimOptions,
    onProgress?: (p: ConversionProgress) => void,
  ): Promise<OutputItem> {
    if (opts.endSec <= opts.startSec) {
      throw new Error(
        `audio-trim: endSec (${opts.endSec}) must be greater than startSec (${opts.startSec})`,
      );
    }

    onProgress?.({ kind: "model-loading", loaded: 0, total: 1 });
    const ff = await loadFfmpeg();
    onProgress?.({ kind: "model-loading", loaded: 1, total: 1 });

    const progressHandler = ({ progress }: { progress: number; time: number }) => {
      onProgress?.({ kind: "inference", pct: Math.max(0, Math.min(100, progress * 100)) });
    };
    ff.on("progress", progressHandler);

    const inExt = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "bin").toLowerCase();
    const outExt = outputExtensionFor(opts.outputFormat, name);
    const id = crypto.randomUUID();
    const inName = `in_${id}.${inExt}`;
    const outName = `out_${id}.${outExt}`;

    try {
      await ff.writeFile(inName, new Uint8Array(bytes));
      onProgress?.({ kind: "inference", pct: 0 });

      const args: string[] = ["-i", inName];
      // -ss/-to apply to both -c copy and re-encode pipelines.
      args.push("-ss", String(opts.startSec));
      args.push("-to", String(opts.endSec));
      args.push("-vn");

      if (opts.outputFormat === "same") {
        args.push("-c", "copy");
      } else {
        const codec = ffmpegCodec(opts.outputFormat);
        if (isLossyOutput(opts.outputFormat)) {
          args.push("-b:a", `${opts.bitrate}k`);
        }
        args.push("-c:a", codec);
      }
      args.push(outName);

      const exitCode = await ff.exec(args);
      if (exitCode !== 0) {
        throw new Error(`audio-trim: ffmpeg exited with code ${exitCode}`);
      }

      onProgress?.({ kind: "inference", pct: 100 });

      const out = await ff.readFile(outName);
      if (typeof out === "string") {
        throw new Error("audio-trim: ffmpeg returned text output unexpectedly");
      }

      const mime = outputMimeFor(opts.outputFormat, type);
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

  async decodePeaks(
    bytes: ArrayBuffer,
    fileExtension: string,
    bucketCount: number,
  ): Promise<{ min: Float32Array; max: Float32Array }> {
    const ff = await loadFfmpeg();
    return decodePeaksInWorker(ff, bytes, fileExtension, bucketCount);
  },
};

Comlink.expose(api);
```

- [ ] **Step 6.2: Typecheck.**

```bash
pnpm typecheck
```

Expected: zero errors. If TypeScript flags `audio-convert/options` re-exports of `OUTPUT_EXTENSION` / `OUTPUT_MIME` because they're not exported from the index, verify Phase 19 already exports those names (they are — see Phase 19's `audio-convert/options.ts:14-26`).

- [ ] **Step 6.3: Commit.**

```bash
git add src/engines/audio-trim/worker.ts
git commit -m "Phase 20: audio-trim worker (convertSingle + decodePeaks)"
```

---

## Task 7: `audio-trim/options-panel.tsx` — UI surface

**Why:** The OptionsPanel is the only place where the engine's runtime state, the file, and the TrimScrubber meet. It also owns the duration probe and the harness call to decodePeaks.

**Files:**
- Create: `src/engines/audio-trim/options-panel.tsx`
- Create: `src/engines/audio-trim/options-panel.test.tsx`

- [ ] **Step 7.1: Write the failing tests.**

Create `src/engines/audio-trim/options-panel.test.tsx`:

```typescript
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultAudioTrimOptions } from "./options";
import { AudioTrimOptionsPanel } from "./options-panel";

const fakeFile = new File([new Uint8Array([0])], "song.mp3", { type: "audio/mpeg" });

vi.mock("@/engines/_shared/trim-scrubber/duration", () => ({
  readMediaDurationSec: vi.fn().mockResolvedValue(30),
}));

vi.mock("./index", async () => {
  // Mock the harness accessor used by the panel so tests don't spin up a real worker.
  return {
    getAudioTrimHarness: () => ({
      runDecodePeaks: vi.fn().mockResolvedValue({
        min: new Float32Array(512),
        max: new Float32Array(512),
      }),
    }),
  };
});

describe("AudioTrimOptionsPanel", () => {
  it("renders the format dropdown with 'same' as default", () => {
    render(
      <AudioTrimOptionsPanel value={defaultAudioTrimOptions} onChange={() => {}} file={fakeFile} />,
    );
    const select = screen.getByLabelText(/output format/i) as HTMLSelectElement;
    expect(select.value).toBe("same");
  });

  it("hides the bitrate dropdown when format is 'same'", () => {
    render(
      <AudioTrimOptionsPanel value={defaultAudioTrimOptions} onChange={() => {}} file={fakeFile} />,
    );
    expect(screen.queryByLabelText(/bitrate/i)).not.toBeInTheDocument();
  });

  it("hides the bitrate dropdown when format is wav (lossless)", () => {
    render(
      <AudioTrimOptionsPanel
        value={{ ...defaultAudioTrimOptions, outputFormat: "wav" }}
        onChange={() => {}}
        file={fakeFile}
      />,
    );
    expect(screen.queryByLabelText(/bitrate/i)).not.toBeInTheDocument();
  });

  it("shows the bitrate dropdown when format is mp3 (lossy)", () => {
    render(
      <AudioTrimOptionsPanel
        value={{ ...defaultAudioTrimOptions, outputFormat: "mp3" }}
        onChange={() => {}}
        file={fakeFile}
      />,
    );
    expect(screen.getByLabelText(/bitrate/i)).toBeInTheDocument();
  });

  it("calls onChange with new format when user picks one", () => {
    const onChange = vi.fn();
    render(<AudioTrimOptionsPanel value={defaultAudioTrimOptions} onChange={onChange} file={fakeFile} />);
    const select = screen.getByLabelText(/output format/i);
    fireEvent.change(select, { target: { value: "mp3" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ outputFormat: "mp3" }));
  });

  it("on file stage, probes duration and writes endSec back into options", async () => {
    const onChange = vi.fn();
    render(<AudioTrimOptionsPanel value={defaultAudioTrimOptions} onChange={onChange} file={fakeFile} />);
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ startSec: 0, endSec: 30 }),
      );
    });
  });

  it("renders nothing waveform-related when no file is staged", () => {
    render(
      <AudioTrimOptionsPanel value={defaultAudioTrimOptions} onChange={() => {}} file={undefined} />,
    );
    expect(screen.queryByTestId("trim-scrubber")).not.toBeInTheDocument();
  });

  it("renders the TrimScrubber when a file is staged and duration is known", async () => {
    render(<AudioTrimOptionsPanel value={defaultAudioTrimOptions} onChange={() => {}} file={fakeFile} />);
    await waitFor(() => {
      expect(screen.getByTestId("trim-scrubber")).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 7.2: Run — expect FAIL.**

```bash
pnpm test src/engines/audio-trim/options-panel.test.tsx
```

- [ ] **Step 7.3: Implement `options-panel.tsx`.**

Create `src/engines/audio-trim/options-panel.tsx`:

```tsx
"use client";

import { readMediaDurationSec } from "@/engines/_shared/trim-scrubber/duration";
import { TrimScrubber } from "@/engines/_shared/trim-scrubber";
import type { Peaks } from "@/engines/_shared/trim-scrubber/decode-peaks";
import type { OptionsPanelProps } from "@/engines/_shared/types";
import { useCallback, useEffect, useState } from "react";
import { getAudioTrimHarness } from "./index";
import {
  AUDIO_TRIM_BITRATE_OPTIONS,
  AUDIO_TRIM_FORMATS,
  type AudioTrimFormat,
  type AudioTrimOptions,
  isLossyOutput,
} from "./options";

export function AudioTrimOptionsPanel({
  value,
  onChange,
  file,
}: OptionsPanelProps<AudioTrimOptions>) {
  const [durationSec, setDurationSec] = useState<number | null>(null);

  // Probe duration when a file is staged. Reset selection to [0, duration].
  useEffect(() => {
    let cancelled = false;
    if (!file) {
      setDurationSec(null);
      return;
    }
    setDurationSec(null);
    readMediaDurationSec(file, "audio").then(
      (d) => {
        if (cancelled) return;
        setDurationSec(d);
        onChange({ ...value, startSec: 0, endSec: d });
      },
      () => {
        if (cancelled) return;
        setDurationSec(null);
      },
    );
    return () => {
      cancelled = true;
    };
    // We deliberately exclude `value` and `onChange` to avoid resetting the
    // selection every time the user drags a handle. Probe runs once per file.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  }, [file]);

  const decodePeaksThroughHarness = useCallback(
    async (f: File, bucketCount: number): Promise<Peaks> => {
      const harness = getAudioTrimHarness();
      return harness.runDecodePeaks(f, bucketCount);
    },
    [],
  );

  const showBitrate = isLossyOutput(value.outputFormat);

  return (
    <div
      data-testid="audio-trim-options"
      className="mb-3 flex flex-col gap-3 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      {/* Format + bitrate row */}
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
          output format:
          <select
            aria-label="output format"
            data-testid="audio-trim-format"
            value={value.outputFormat}
            onChange={(e) =>
              onChange({ ...value, outputFormat: e.target.value as AudioTrimFormat })
            }
            className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase"
          >
            {AUDIO_TRIM_FORMATS.map((fmt) => (
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
              data-testid="audio-trim-bitrate"
              value={value.bitrate}
              onChange={(e) =>
                onChange({
                  ...value,
                  bitrate: Number(e.target.value) as (typeof AUDIO_TRIM_BITRATE_OPTIONS)[number],
                })
              }
              className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase"
            >
              {AUDIO_TRIM_BITRATE_OPTIONS.map((kbps) => (
                <option key={kbps} value={kbps}>
                  {kbps} kbps
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* Scrubber appears only when both file and duration are known */}
      {file && durationSec !== null && durationSec > 0 && (
        <TrimScrubber
          source={file}
          modality="audio"
          durationSec={durationSec}
          startSec={value.startSec}
          endSec={value.endSec}
          onChange={(start, end) => onChange({ ...value, startSec: start, endSec: end })}
          decodePeaks={decodePeaksThroughHarness}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 7.4: Run — expect PASS.**

```bash
pnpm test src/engines/audio-trim/options-panel.test.tsx
```

Expected: all eight tests pass. The harness mock is hoisted by Vitest so `getAudioTrimHarness` is intercepted before the panel imports it.

- [ ] **Step 7.5: Commit.**

```bash
git add src/engines/audio-trim/options-panel.tsx src/engines/audio-trim/options-panel.test.tsx
git commit -m "Phase 20: AudioTrimOptionsPanel (format, bitrate, scrubber)"
```

---

## Task 8: `audio-trim/index.ts` — engine descriptor

**Why:** Wires options + worker + panel into a `SingleInputEngine`. Exports `getAudioTrimHarness()` for the panel to call `runDecodePeaks` and a `disposeAudioTrimHarness()` for the route page's cleanup effect.

**Files:**
- Create: `src/engines/audio-trim/index.ts`
- Create: `src/engines/audio-trim/index.test.ts`

- [ ] **Step 8.1: Write the failing tests.**

Create `src/engines/audio-trim/index.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import engine from "./index";

describe("audio-trim engine descriptor", () => {
  it("declares id 'audio-trim' and category 'audio'", () => {
    expect(engine.id).toBe("audio-trim");
    expect(engine.category).toBe("audio");
  });

  it("is single-cardinality", () => {
    expect(engine.cardinality).toBe("single");
  });

  it("accepts mp3, wav, m4a, flac extensions", () => {
    expect(engine.inputAccept).toEqual(expect.arrayContaining([".mp3", ".wav", ".m4a", ".flac"]));
  });

  it("validate accepts a 1 MB mp3", () => {
    const file = new File([new Uint8Array(1_000_000)], "song.mp3", { type: "audio/mpeg" });
    const result = engine.validate(file, engine.defaultOptions);
    expect(result.ok).toBe(true);
  });

  it("validate rejects a non-audio extension", () => {
    const file = new File([new Uint8Array(100)], "doc.pdf", { type: "application/pdf" });
    const result = engine.validate(file, engine.defaultOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/MP3, WAV, M4A, or FLAC/i);
    }
  });

  it("validate rejects a > 500 MB file", () => {
    // Construct a synthetic File of declared size 600 MB without allocating bytes.
    const file = Object.assign(new File([new Uint8Array([0])], "huge.mp3", { type: "audio/mpeg" }), {
      size: 600 * 1_000_000,
    });
    const result = engine.validate(file as File, engine.defaultOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/500 MB/i);
    }
  });

  it("isReadyToConvert is false when end <= start", () => {
    expect(engine.isReadyToConvert?.({ ...engine.defaultOptions, startSec: 5, endSec: 5 })).toBe(false);
    expect(engine.isReadyToConvert?.({ ...engine.defaultOptions, startSec: 10, endSec: 5 })).toBe(false);
  });

  it("isReadyToConvert is false when range is shorter than 100 ms", () => {
    expect(
      engine.isReadyToConvert?.({ ...engine.defaultOptions, startSec: 1.0, endSec: 1.05 }),
    ).toBe(false);
  });

  it("isReadyToConvert is true for a 1 s range", () => {
    expect(
      engine.isReadyToConvert?.({ ...engine.defaultOptions, startSec: 1.0, endSec: 2.0 }),
    ).toBe(true);
  });

  it("OptionsPanel is wired", () => {
    expect(engine.OptionsPanel).toBeDefined();
  });
});
```

- [ ] **Step 8.2: Run — expect FAIL.**

```bash
pnpm test src/engines/audio-trim/index.test.ts
```

- [ ] **Step 8.3: Implement `index.ts`.**

Create `src/engines/audio-trim/index.ts`:

```typescript
import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { AudioTrimOptionsPanel } from "./options-panel";
import { type AudioTrimOptions, defaultAudioTrimOptions } from "./options";

const SUPPORTED_INPUT_MIMES = ["audio/mpeg", "audio/wav", "audio/mp4", "audio/flac"];

// Spec §7.1 — 500 MB cap, same as audio-convert.
const MAX_FILE_BYTES = 500 * 1_000_000;
const MIN_TRIM_SEC = 0.1;

// Module-scoped persistent harness so ffmpeg loads once across decode-peaks
// (called from OptionsPanel) AND convert (called from the engine lifecycle).
// Mirrors audio-convert's pattern.
let harness: WorkerHarness<AudioTrimOptions> | null = null;
export function getAudioTrimHarness(): WorkerHarness<AudioTrimOptions> {
  if (!harness) {
    harness = new WorkerHarness<AudioTrimOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
      { persistent: true },
    );
  }
  return harness;
}

export function disposeAudioTrimHarness(): void {
  harness?.dispose();
  harness = null;
}

const engine: SingleInputEngine<AudioTrimOptions, OutputItem> = {
  id: "audio-trim",
  inputAccept: [".mp3", ".wav", ".m4a", ".flac"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "audio/mpeg",
  defaultOptions: defaultAudioTrimOptions,
  category: "audio",
  library: "ffmpeg.wasm (single-threaded core)",
  license: "GPL-2.0-or-later",
  cardinality: "single",
  isReadyToConvert: (opts) =>
    opts.startSec >= 0 &&
    opts.endSec > opts.startSec &&
    opts.endSec - opts.startSec >= MIN_TRIM_SEC,
  OptionsPanel: AudioTrimOptionsPanel,
  validate(file) {
    const mimeOk = SUPPORTED_INPUT_MIMES.includes(file.type);
    const extOk = /\.(mp3|wav|m4a|flac)$/i.test(file.name);
    if (!mimeOk && !extOk) {
      return { ok: false, reason: "Expected an MP3, WAV, M4A, or FLAC file" };
    }
    if (file.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        reason: `File too large for audio-trim (limit 500 MB; got ${(file.size / 1_000_000).toFixed(1)} MB).`,
      };
    }
    return { ok: true };
  },
  async convert(file, opts, signal, runOpts) {
    const result = await getAudioTrimHarness().runSingle(file, opts, signal, runOpts);
    if (Array.isArray(result)) {
      const first = result[0];
      if (!first) throw new Error("audio-trim: engine returned empty array");
      return first;
    }
    return result;
  },
};

export default engine;
```

- [ ] **Step 8.4: Run — expect PASS.**

```bash
pnpm test src/engines/audio-trim/index.test.ts
```

- [ ] **Step 8.5: Typecheck.**

```bash
pnpm typecheck
```

Expected: zero errors. If a circular-dep warning surfaces between `index.ts` (exports `getAudioTrimHarness`) and `options-panel.tsx` (imports it), that's fine in this repo — the same pattern is used by `audio-convert` and works because the import lands inside a React component body, not module top-level.

- [ ] **Step 8.6: Commit.**

```bash
git add src/engines/audio-trim/index.ts src/engines/audio-trim/index.test.ts
git commit -m "Phase 20: audio-trim engine descriptor"
```

---

## Task 9: Wire registry, sidebar, home page

**Why:** Without these, the engine exists but is unreachable.

**Files:**
- Modify: `src/engines/_shared/registry.ts`
- Modify: `src/engines/_shared/registry.metadata.test.ts` (if it asserts count)
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/components/layout/sidebar.test.tsx` (if it asserts count)
- Modify: `src/app/page.tsx`
- Modify: `src/app/page.test.tsx` (if it asserts count)

- [ ] **Step 9.1: Add `audio-trim` to `EngineId` and `REGISTRY`.**

Edit `src/engines/_shared/registry.ts`:

**old_string:**
```typescript
export type EngineId =
  | "audio-convert"
  | "docx-to-txt"
```

**new_string:**
```typescript
export type EngineId =
  | "audio-convert"
  | "audio-trim"
  | "docx-to-txt"
```

**old_string:**
```typescript
const REGISTRY: Record<EngineId, Loader> = {
  "audio-convert": () => import("@/engines/audio-convert"),
  "docx-to-txt": () => import("@/engines/docx-to-txt"),
```

**new_string:**
```typescript
const REGISTRY: Record<EngineId, Loader> = {
  "audio-convert": () => import("@/engines/audio-convert"),
  "audio-trim": () => import("@/engines/audio-trim"),
  "docx-to-txt": () => import("@/engines/docx-to-txt"),
```

- [ ] **Step 9.2: Run the registry metadata test to discover any count assertions.**

```bash
pnpm test src/engines/_shared/registry.metadata.test.ts
```

If it fails with a hardcoded count (e.g., "expected 14 engines, got 15"), edit the test to bump the count. If it iterates dynamically over `Object.keys(REGISTRY)`, no edit needed.

- [ ] **Step 9.3: Add `audio-trim` to the sidebar AUDIO group.**

Read `src/components/layout/sidebar.tsx` and locate the `audio-convert` entry. Add a sibling immediately after:

**old_string:**
```typescript
  { id: "audio-convert", href: "/tools/audio-convert", label: "audio convert", group: "AUDIO" },
```

**new_string:**
```typescript
  { id: "audio-convert", href: "/tools/audio-convert", label: "audio convert", group: "AUDIO" },
  { id: "audio-trim", href: "/tools/audio-trim", label: "audio trim", group: "AUDIO" },
```

- [ ] **Step 9.4: Run the sidebar test to discover any count assertions.**

```bash
pnpm test src/components/layout/sidebar.test.tsx
```

If it asserts a specific tool count or list contents, update accordingly. The AUDIO group already exists (Phase 19), so `GROUP_ORDER` does not need editing.

- [ ] **Step 9.5: Append `audio-trim` to the home grid.**

Read `src/app/page.tsx` to find the `TOOLS` array shape. Audio-convert's entry is around line 84. Add a sibling entry after audio-convert with parallel structure:

```typescript
  // Append after the audio-convert entry, in the same shape.
  {
    id: "audio-trim",
    title: "audio trim",
    description: "trim mp3 / wav / m4a / flac to a sub-range; lossless when the format is unchanged.",
    href: "/tools/audio-trim",
    category: "audio",
  },
```

The exact field set depends on the existing `TOOLS` literal — match it field-for-field. Run `pnpm test src/app/page.test.tsx` after the edit; if a count assertion fails, bump it.

- [ ] **Step 9.6: Run all the modified-test suites.**

```bash
pnpm test src/engines/_shared/registry.metadata.test.ts src/components/layout/sidebar.test.tsx src/app/page.test.tsx
```

Expected: all green.

- [ ] **Step 9.7: Commit.**

```bash
git add src/engines/_shared/registry.ts src/engines/_shared/registry.metadata.test.ts src/components/layout/sidebar.tsx src/components/layout/sidebar.test.tsx src/app/page.tsx src/app/page.test.tsx
git commit -m "Phase 20: wire audio-trim into registry, sidebar, and home grid"
```

---

## Task 10: Route page

**Why:** Static export needs `/tools/audio-trim/page.tsx`. Mirrors audio-convert's pattern: ToolFrame + harness dispose effect.

**Files:**
- Create: `src/app/tools/audio-trim/page.tsx`

- [ ] **Step 10.1: Create the route.**

Create `src/app/tools/audio-trim/page.tsx`:

```tsx
"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine, { disposeAudioTrimHarness } from "@/engines/audio-trim";
import { useEffect } from "react";

export default function AudioTrimPage() {
  useEffect(() => {
    return () => disposeAudioTrimHarness();
  }, []);

  return <ToolFrame engine={engine} />;
}
```

- [ ] **Step 10.2: Smoke-build.**

```bash
pnpm build
```

Expected:
- `next build` completes without errors.
- `postbuild` runs `scripts/check-bundle-isolation.mjs` and exits 0; `audio-trim` is auto-discovered as a new engine, and ffmpeg/trim-scrubber dependencies do not leak into the homepage chunk.

If the bundle-isolation gate fails, the cause is almost always a static import path that pulls `@ffmpeg/ffmpeg` (or `_shared/ffmpeg`) from a non-engine module. Fix the static import; do not relax the gate. Most likely culprit: an accidental top-level `import { decodePeaksInWorker } from "@/engines/_shared/trim-scrubber/decode-peaks"` from a non-engine file. The trim-scrubber index.tsx only imports the `Peaks` type, which is erased at compile time.

- [ ] **Step 10.3: Commit.**

```bash
git add src/app/tools/audio-trim/page.tsx
git commit -m "Phase 20: /tools/audio-trim route"
```

---

## Task 11: E2E tests — route, correctness, privacy regression

**Why:** Component tests prove the surface; E2E tests prove the wiring (harness, ffmpeg, route, build chain) actually works on real fixtures.

**Files:**
- Create: `tests/e2e/audio-trim.spec.ts`
- Create: `tests/e2e/audio-trim-correctness.spec.ts`
- Create: `tests/e2e/privacy-regression-audio-trim.spec.ts`

Read Phase 19's three E2E specs first so test patterns line up:

```bash
ls tests/e2e/audio-convert*.spec.ts tests/e2e/privacy-regression-audio-convert.spec.ts
```

- [ ] **Step 11.1: Write the route + UI E2E (default suite, no real conversion).**

Create `tests/e2e/audio-trim.spec.ts` modeled on `tests/e2e/audio-convert.spec.ts`. Specifically:

```typescript
import { expect, test } from "@playwright/test";

test.describe("/tools/audio-trim", () => {
  test("loads, renders the page header and the format dropdown", async ({ page }) => {
    await page.goto("/tools/audio-trim");
    await expect(page.getByRole("heading", { name: /audio trim/i })).toBeVisible();
    await expect(page.getByLabel(/output format/i)).toBeVisible();
  });

  test("upload widget accepts mp3/wav/m4a/flac extensions", async ({ page }) => {
    await page.goto("/tools/audio-trim");
    const input = page.locator('input[type="file"]').first();
    const accept = await input.getAttribute("accept");
    expect(accept ?? "").toMatch(/\.mp3/);
    expect(accept ?? "").toMatch(/\.wav/);
    expect(accept ?? "").toMatch(/\.m4a/);
    expect(accept ?? "").toMatch(/\.flac/);
  });

  test("staging a file shows the trim scrubber", async ({ page }) => {
    await page.goto("/tools/audio-trim");
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles("tests/fixtures/audio/sample.mp3");
    await expect(page.getByTestId("trim-scrubber")).toBeVisible({ timeout: 10_000 });
  });
});
```

- [ ] **Step 11.2: Run the route E2E.**

```bash
pnpm test:e2e --project=chromium tests/e2e/audio-trim.spec.ts
```

Expected: 3 PASS.

- [ ] **Step 11.3: Write the gated correctness E2E.**

Create `tests/e2e/audio-trim-correctness.spec.ts`. Reference Phase 19's `audio-convert-correctness.spec.ts` for the gating boilerplate.

```typescript
import { promises as fs } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// Gated by RUN_AUDIO_TRIM_CORRECTNESS=1. The suite drives real ffmpeg.wasm
// trims, verifies that the output container is correct and (for the WAV
// re-encode case) parses the output's WAV header to confirm the duration
// matches the requested range.
//
// Usage:
//   RUN_AUDIO_TRIM_CORRECTNESS=1 pnpm test:e2e --project=chromium \
//     tests/e2e/audio-trim-correctness.spec.ts
const SHOULD_RUN = process.env.RUN_AUDIO_TRIM_CORRECTNESS === "1";

test.skip(!SHOULD_RUN, "set RUN_AUDIO_TRIM_CORRECTNESS=1 to run");

const FIXTURE = "tests/fixtures/audio/sample.mp3";

/** Read the canonical-PCM WAV duration from a buffer by parsing the RIFF
 *  header. Assumes a single 'fmt ' (16 bytes) and a single 'data' chunk —
 *  exactly what `pcm_s16le` ffmpeg output produces. */
function wavDurationSeconds(buf: Buffer): number {
  if (buf.subarray(0, 4).toString("utf8") !== "RIFF") {
    throw new Error("not a RIFF file");
  }
  if (buf.subarray(8, 12).toString("utf8") !== "WAVE") {
    throw new Error("not a WAVE file");
  }
  const numChannels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);
  // Find the 'data' chunk (skip non-data chunks like 'LIST' if present).
  let p = 12;
  while (p + 8 <= buf.length) {
    const id = buf.subarray(p, p + 4).toString("utf8");
    const size = buf.readUInt32LE(p + 4);
    if (id === "data") {
      const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
      return size / byteRate;
    }
    p += 8 + size;
  }
  throw new Error("no 'data' chunk found");
}

/** Drive the end handle backward by Shift+ArrowLeft until aria-valuenow
 *  reaches the target (within 0.5 s of an integer step). Each Shift+Arrow
 *  moves by 10 s per the component spec. */
async function pressShiftArrowLeftUntil(page: Page, targetSec: number) {
  const handle = page.getByRole("slider", { name: /trim end/i });
  await handle.focus();
  for (let i = 0; i < 60; i++) {
    const current = Number((await handle.getAttribute("aria-valuenow")) ?? "0");
    if (Math.abs(current - targetSec) < 0.5 || current <= targetSec) return;
    await page.keyboard.press("Shift+ArrowLeft");
  }
  throw new Error(`could not drive end handle to ${targetSec} s`);
}

test.describe("audio-trim correctness", () => {
  test("same-format trim with default range (no trim) produces a non-empty output", async ({ page }) => {
    await page.goto("/tools/audio-trim");
    await page.locator('input[type="file"]').first().setInputFiles(FIXTURE);
    await expect(page.getByTestId("trim-scrubber")).toBeVisible({ timeout: 10_000 });

    // Default range covers the full fixture (0..durationSec). Convert as-is.
    await page.getByRole("button", { name: /convert/i }).click();
    const download = await page.waitForEvent("download", { timeout: 30_000 });
    const outPath = await download.path();
    expect(outPath).toBeTruthy();

    const stat = await fs.stat(outPath!);
    expect(stat.size).toBeGreaterThan(1000); // mp3 is small but non-trivial
    const inStat = await fs.stat(FIXTURE);
    // -c copy with the same range produces a file very close to the input size.
    expect(stat.size).toBeGreaterThan(inStat.size * 0.5);
    expect(stat.size).toBeLessThan(inStat.size * 1.5);
  });

  test("format change to wav with shortened end produces a RIFF/WAVE file matching the trimmed duration", async ({
    page,
  }) => {
    await page.goto("/tools/audio-trim");
    await page.locator('input[type="file"]').first().setInputFiles(FIXTURE);
    await expect(page.getByTestId("trim-scrubber")).toBeVisible({ timeout: 10_000 });

    // Read the initial endSec (= durationSec) so we know what to subtract from.
    const endHandle = page.getByRole("slider", { name: /trim end/i });
    const initialEnd = Number((await endHandle.getAttribute("aria-valuenow")) ?? "0");
    expect(initialEnd).toBeGreaterThan(0);

    // Pick a target end that's at least 1 s below the fixture's full duration
    // and is a clean multiple of 0.5 s so the keyboard driver can reach it.
    const targetEnd = Math.max(1.0, Math.floor(initialEnd - 1));
    await pressShiftArrowLeftUntil(page, targetEnd);

    // Switch output format to wav so the worker re-encodes (single ffmpeg call,
    // single-threaded core). Re-read endSec to use as the expected duration.
    await page.getByLabel(/output format/i).selectOption("wav");
    const finalEnd = Number((await endHandle.getAttribute("aria-valuenow")) ?? "0");

    await page.getByRole("button", { name: /convert/i }).click();
    const download = await page.waitForEvent("download", { timeout: 30_000 });
    const outPath = await download.path();
    expect(outPath).toBeTruthy();

    const buf = await fs.readFile(outPath!);
    expect(buf.subarray(0, 4).toString("utf8")).toBe("RIFF");
    expect(buf.subarray(8, 12).toString("utf8")).toBe("WAVE");

    const decodedDur = wavDurationSeconds(buf);
    // startSec is 0 (default), endSec ≈ finalEnd. Allow ±0.2 s of slack
    // because ffmpeg's -ss/-to with -c:a pcm_s16le cuts on sample boundaries
    // and the keyboard driver may overshoot by half a step.
    expect(decodedDur).toBeGreaterThan(finalEnd - 0.3);
    expect(decodedDur).toBeLessThan(finalEnd + 0.3);
  });
});
```

The first test exercises the `-c copy` lossless path; the second exercises the single-call re-encode path AND parses the output WAV header to verify the trim produced the requested duration. Together they cover both code paths in `worker.ts`.

- [ ] **Step 11.4: Run the gated correctness E2E.**

```bash
RUN_AUDIO_TRIM_CORRECTNESS=1 pnpm test:e2e --project=chromium tests/e2e/audio-trim-correctness.spec.ts
```

Expected: PASS. If the first test's `dur` assertion is too loose, refine it after observing actual numbers; if the wav test's RIFF assertion fails, inspect the worker output and confirm `pcm_s16le` codec is wired correctly (it is — see Task 6).

- [ ] **Step 11.5: Write the privacy-regression E2E.**

Create `tests/e2e/privacy-regression-audio-trim.spec.ts` modeled on `tests/e2e/privacy-regression-audio-convert.spec.ts`. Read that spec first; it captures all `request` events and asserts every URL is same-origin or in an allowlist of in-page resources. The audio-trim variant differs only in: (a) the route URL (`/tools/audio-trim`), and (b) the dropped fixture.

```typescript
import { expect, test } from "@playwright/test";

test("audio-trim makes zero off-origin requests during a real trim", async ({ page, baseURL }) => {
  const expectedOrigin = new URL(baseURL ?? "http://localhost:3000").origin;
  const offOrigin: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.startsWith("data:") || url.startsWith("blob:")) return;
    if (!url.startsWith(expectedOrigin)) offOrigin.push(url);
  });

  await page.goto("/tools/audio-trim");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles("tests/fixtures/audio/sample.mp3");
  await expect(page.getByTestId("trim-scrubber")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /convert/i }).click();
  await page.waitForEvent("download", { timeout: 30_000 });

  expect(offOrigin, `unexpected off-origin requests: ${offOrigin.join("\n")}`).toEqual([]);
});
```

- [ ] **Step 11.6: Run the privacy-regression E2E.**

```bash
pnpm test:e2e --project=chromium tests/e2e/privacy-regression-audio-trim.spec.ts
```

Expected: PASS.

- [ ] **Step 11.7: Commit.**

```bash
git add tests/e2e/audio-trim.spec.ts tests/e2e/audio-trim-correctness.spec.ts tests/e2e/privacy-regression-audio-trim.spec.ts
git commit -m "Phase 20: audio-trim E2E (route, correctness, privacy)"
```

---

## Task 12: Full project verification + manual smoke + PR

**Files:** none (verification only)

- [ ] **Step 12.1: Typecheck.**

```bash
pnpm typecheck
```

Expected: zero errors.

- [ ] **Step 12.2: Lint.**

```bash
pnpm lint
```

Expected: zero errors. The `no-fetch-in-engines` Biome rule should pass — neither `decode-peaks.ts`, `worker.ts`, nor any other engine file uses `fetch`/`XMLHttpRequest`.

- [ ] **Step 12.3: Full unit + integration test suite.**

```bash
pnpm test
```

Expected: all green. If memory pressure on the 8 GB box bites:

```bash
pnpm test --pool=threads --poolOptions.threads.maxThreads=2
```

- [ ] **Step 12.4: Build + bundle isolation gate.**

```bash
pnpm build
```

Expected: build succeeds; `postbuild` bundle-isolation check exits 0.

- [ ] **Step 12.5: Run the full default-suite E2E (chromium).**

```bash
pnpm test:e2e --project=chromium
```

Expected: all green, including the new `audio-trim.spec.ts`.

- [ ] **Step 12.6: Run the gated correctness suite.**

```bash
RUN_AUDIO_TRIM_CORRECTNESS=1 pnpm test:e2e --project=chromium tests/e2e/audio-trim-correctness.spec.ts
```

Expected: PASS.

- [ ] **Step 12.7: Manual smoke test in dev.**

```bash
pnpm dev
```

Navigate to `http://localhost:3000/tools/audio-trim`. Stage `tests/fixtures/audio/sample.mp3`. Verify:
- Page header reads "audio trim".
- Output format dropdown defaults to "same"; bitrate dropdown is hidden.
- Within ~1 s, two handles appear at left and right edges with `00:00.000` and `(fixture duration)` labels.
- Within a few seconds (after ffmpeg loads), the waveform bars appear.
- ArrowLeft / ArrowRight on a focused handle moves it; Shift+arrow moves by 10 s; the timestamp label updates.
- Switching format to `mp3` reveals the bitrate dropdown.
- Switching format to `wav` hides the bitrate dropdown.
- Clicking Convert produces a downloadable file named `sample-trim.<ext>`.
- The downloaded file plays back as the selected range in a media player.

- [ ] **Step 12.8: Manual privacy verification.**

With DevTools Network panel open and filter set to "Fetch/XHR":
- Reload — observe ffmpeg core + wasm load from `/ffmpeg/...`.
- Drop a file and Convert — observe **zero off-origin** new network requests.

- [ ] **Step 12.9: Verify the Phase 21 untouched-file contract.**

```bash
git diff main -- src/engines/_shared/ffmpeg/index.ts vercel.json package.json pnpm-lock.yaml scripts/copy-ffmpeg-core.mjs scripts/ffmpeg-manifest.json next.config.ts
```

Expected: empty diff. If anything changed in those files, the parallel Phase 21 instance will conflict on rebase. Revert Phase 20's edits and find a non-overlapping path.

- [ ] **Step 12.10: Push and open PR.**

This phase MUST be on the dedicated feature branch. Verify:

```bash
git rev-parse --abbrev-ref HEAD
```

Expected output: `phase-20-trim-scrubber-and-audio-trim`. If this prints `main`, halt and switch branches before proceeding.

```bash
git push -u origin phase-20-trim-scrubber-and-audio-trim
gh pr create --title "Phase 20: trim-scrubber (audio half) + audio-trim engine" --body "$(cat <<'EOF'
## Summary
- New `_shared/trim-scrubber/` UI primitive with audio render path: ffmpeg-driven peak decode, two drag handles, keyboard a11y, `mm:ss.ms` labels. Video modality is a typed stub that throws; Phase 22 will fill it in.
- New `audio-trim` engine: lossless `-c copy` when output format is unchanged (default), single-call ffmpeg re-encode when format changes. Bitrate dropdown shown only for lossy targets distinct from "same".
- `WorkerHarness` extended with `runDecodePeaks(file, bucketCount)` so peak decoding shares the same persistent ffmpeg worker as the conversion that follows. Optional on `WorkerEntry`; other engines unaffected.
- Sidebar AUDIO group gains `audio-trim`; home grid gains a card.

## Verification
- Typecheck, lint, full unit suite green.
- `pnpm build` + bundle-isolation gate green (ffmpeg / trim-scrubber not in homepage chunk).
- Default-suite E2E green.
- Gated correctness E2E green: same-format trim + format-change-to-wav both verified.
- Privacy-regression E2E green: zero off-origin requests during a real trim.
- Manual smoke + manual privacy demo on dev box.
- Phase 21 untouched-file contract verified: empty diff against `main` for ffmpeg/, vercel.json, package.json, pnpm-lock.yaml, scripts/copy-ffmpeg-core.mjs, scripts/ffmpeg-manifest.json, next.config.ts.

## Test plan
- [x] `pnpm typecheck` clean
- [x] `pnpm lint` clean
- [x] `pnpm test` all green
- [x] `pnpm test:e2e --project=chromium tests/e2e/audio-trim.spec.ts` green
- [x] `RUN_AUDIO_TRIM_CORRECTNESS=1 pnpm test:e2e --project=chromium tests/e2e/audio-trim-correctness.spec.ts` green
- [x] `pnpm test:e2e --project=chromium tests/e2e/privacy-regression-audio-trim.spec.ts` green
- [x] `pnpm build` + postbuild bundle-isolation green
- [x] Manual smoke on the route
- [x] Manual privacy demo (DevTools Network panel)
- [x] No edits to any file in the Phase 21 untouched contract
EOF
)"
```

---

## Self-review checklist (post-plan)

- [ ] **Spec §1 covered:** Phase 20 ships `_shared/trim-scrubber/` audio half + `audio-trim` engine; video modality is a stub. Tasks 2, 3, 4, 5–8.
- [ ] **Spec §2.1 (waveform decode via ffmpeg, not OfflineAudioContext):** Task 3's `decodePeaksInWorker` runs ffmpeg with mono f32le PCM extraction at 8 kHz; no OfflineAudioContext anywhere.
- [ ] **Spec §2.2 (single ffmpeg call for re-encode):** Task 6's `convertSingle` builds one `args` array combining `-ss/-to` with codec args. No two-stage pipeline.
- [ ] **Spec §2.3 (bitrate UI shown only for lossy ≠ same):** Task 7's panel uses `isLossyOutput(value.outputFormat)` for the conditional render. `isLossyOutput("same") === false`. Task 5 tests confirm.
- [ ] **Spec §2.4 (output filename = `<basename>-trim.<ext>`):** Task 6's `replaceExtension` returns `${base}-trim.${newExt}`.
- [ ] **Spec §2.5 (duration probe via main-thread `<audio>.duration`):** Task 2's `readMediaDurationSec`.
- [ ] **Spec §2.5b (single ffmpeg load):** Task 1 extends WorkerHarness with `runDecodePeaks`; Task 7's panel calls it through `getAudioTrimHarness()` — same persistent harness as Task 8's `convert`.
- [ ] **Spec §2.6 (state shape, durationSec NOT in options):** Task 5's `AudioTrimOptions` excludes `durationSec`. Task 7's panel keeps it in local state.
- [ ] **Spec §2.7 (default range = full file):** Task 7's `useEffect` sets `endSec = durationSec` on probe completion.
- [ ] **Spec §2.8 (`isReadyToConvert` gates):** Task 8's engine descriptor implements the three checks.
- [ ] **Spec §2.9 (loading states):** Task 4's component renders flat hairline before peaks resolve.
- [ ] **Spec §2.10 (test coverage):** Tasks 2, 3, 4, 5, 7, 8 cover unit; Task 11 covers E2E (route, correctness, privacy).
- [ ] **Spec §2.11 (reuse Phase 19 fixtures):** No `tests/fixtures/audio/` writes in this plan; only reads in Task 11.
- [ ] **Spec §2.12 (branch):** Preamble + Task 12.10 enforce.
- [ ] **Spec §2.13 (bundle isolation):** Task 10 + Task 12.4 verify; Task 6's worker is the only ffmpeg consumer.
- [ ] **Spec §2.14 (sidebar/home wiring):** Task 9.
- [ ] **Spec §3.1 (TrimScrubberProps):** Task 4 implements exact prop shape from spec.
- [ ] **Spec §3.2 (decodePeaks API):** Task 3 implements `peaksFromPCM` + `decodePeaksInWorker` exactly as specified.
- [ ] **Spec §3.3 (readMediaDurationSec):** Task 2 implements with the modality-parameterized signature.
- [ ] **Spec §3.4 (audio-trim descriptor):** Task 8.
- [ ] **Spec §5 (Phase 21 coordination contract):** Task 12.9 explicitly verifies empty diff against the protected file list.
- [ ] **Spec §7 (acceptance criteria):** Task 12 covers each item.
- [ ] **No placeholders:** every step has runnable commands, complete code, or an explicit instruction to read a known existing file.
- [ ] **Type consistency:** `AudioTrimOptions`, `AudioTrimFormat`, `AudioTrimBitrate`, `Peaks`, `TrimScrubberProps` are defined once and consistently named across tasks. `getAudioTrimHarness` and `disposeAudioTrimHarness` are declared in Task 8 and consumed in Task 7 (panel) and Task 10 (route).
- [ ] **TDD pattern:** Tasks 1, 2, 3, 4, 5, 7, 8 follow write-test → fail → implement → pass → commit. Tasks 6 (worker), 9 (wiring), 10 (route), 11 (E2E) are integration / config rather than unit-testable; their verification routes through E2E in Task 11 and the build gate in Task 12.4.
- [ ] **Independent of Phase 21:** Task 12.9 enforces empty diff for the Phase 21 surface. The merge order (Phase 20 first → Phase 21 rebase) is captured in both specs.
