# Phase 25.5 — video-convert — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `video-convert` engine — a single-input full-transcode tool (mp4 / mov / webm output) that closes the v2 design's stated 24-engine catalog by adding the one engine that slipped Phase 21 → Phase 22 → unscheduled. With this in `main`, the v2 closeout (Phase 26) can ship the catalog-complete release.

**Architecture:** `video-convert` is a `SingleInputEngine` that plugs into the existing engine pattern, reusing `_shared/ffmpeg` (loads MT core when `crossOriginIsolated`, falls back to ST otherwise) and the standard `WorkerHarness` plumbing. Unlike `audio-convert` and `video-trim`, this engine uses **non-persistent harness mode** so an abort actually terminates ffmpeg mid-transcode — required by the v2 design's mandatory cancel UX for slow operations. Pre-conversion tooltip sets latency expectation; mandatory progress UI driven by ffmpeg's `progress` event.

**Tech Stack:** TypeScript strict, React, Next.js static export, Vitest (unit + integration), Playwright (E2E), `@ffmpeg/ffmpeg` + `@ffmpeg/core-mt` (already installed and wired by Phases 19/21), Comlink (already installed). No new runtime deps.

---

## Reference reading before starting

- v2 design: `docs/superpowers/specs/2026-05-05-v2-design.md` — esp. §3.2 (`video-convert`), §4.5 (slow-engine progress + cancel), §7 (size caps + latency expectations).
- Master spec: `docs/superpowers/specs/2026-04-30-file-converter-design.md` — §6.3 (engine interface), §10.2 (security headers).
- ffmpeg shared infra: `src/engines/_shared/ffmpeg/index.ts` — the `loadFfmpeg()` singleton + MT/ST path selection.
- `WorkerHarness`: `src/engines/_shared/harness.ts` — `persistent: false` terminates the worker on abort (ffmpeg dies with it). `persistent: true` only resolves the host promise.
- Closest engine templates:
  - `src/engines/audio-convert/` — same shape (radio format picker, output codec map, ffmpeg-driven worker).
  - `src/engines/video-trim/` — video-specific MIME / extension handling, MT-aware load, MKV-friendly accept set.
  - `src/engines/video-extract-audio/` — non-persistent abort precedent if it exists; otherwise audio-convert is the canonical "ffmpeg-driven single-input" template.
- Route pattern: `src/app/tools/video-trim/page.tsx`.
- Sidebar: `src/components/layout/sidebar.tsx` (current VIDEO entries: `video-trim`, `video-extract-audio`).
- Home grid: `src/app/page.tsx` (`TOOLS` array).
- Existing E2E patterns:
  - `tests/e2e/audio-convert.spec.ts`, `tests/e2e/audio-convert-correctness.spec.ts`
  - `tests/e2e/video-trim.spec.ts`, `tests/e2e/video-trim-correctness.spec.ts`
  - `tests/e2e/privacy-regression-audio-convert.spec.ts`
- Fixtures: `tests/fixtures/video/` already has `sample-h264-aac.mp4`, `sample-h264.mov`, `sample-vp9-opus.webm`, `sample-no-audio.mp4`, `sample-hevc-aac.mkv` (committed by Phase 22). No new fixtures required.
- Bundle isolation gate: `scripts/check-bundle-isolation.mjs` already detects per-engine code in homepage chunks generically; nothing engine-specific to extend for `video-convert`.

CLAUDE.md invariants apply:
- No `--no-verify`. No `--amend`. **No Claude attribution in commit messages** (no `Co-Authored-By: Claude`, no "Generated with" footers). Commit body lines ≤ 72 chars.
- Run `pnpm test`, `pnpm typecheck`, `pnpm lint` after each task before commit.
- Engines must not contain `fetch` / `XMLHttpRequest` — Biome lint enforces.
- Don't use `next dev --turbopack` — Webpack dev server only.
- Branch discipline for subagents: implementer subagents must never run `git branch -m/-M` or `git checkout <branch>`. Stay on the working branch you started on.

---

## Spec deviations

**Input set widened beyond v2 design §3.2.** v2 design lists `.mp4`, `.mov`, `.webm` as input. This plan accepts `.mp4`, `.mov`, `.webm`, `.mkv` — matching `video-trim`'s input set. Reason: ffmpeg decodes MKV trivially (the existing `sample-hevc-aac.mkv` fixture is decodable end-to-end), and a user landing on a "video convert" tool with an MKV file would be surprised to find it rejected when the adjacent `video-trim` accepts it. **Output formats stay strict to design** — only `mp4`, `mov`, `webm` are produced.

**Non-persistent harness mode.** Every other ffmpeg-driven engine in the catalog (`audio-convert`, `audio-trim`, `video-trim`, `video-extract-audio`) uses `persistent: true` — fast operations where the rejected host promise is enough to "feel" responsive. `video-convert` is the first ffmpeg engine where the operation is long enough that real cancellation matters, so it uses `persistent: false`: an abort terminates the worker — and therefore in-flight ffmpeg — at the OS-thread boundary instead of letting it grind to completion behind a rejected promise. Cost: each conversion spawns a fresh worker; ffmpeg's WASM is HTTP-cached after the first load but the FFmpeg instance is re-instantiated (~1–2 s cold start per conversion). Acceptable for an operation that already takes ~1 minute per minute of source. This trade is documented inline in `worker.ts` and in the engine's `index.ts` rationale comment.

Any further deviation discovered during implementation is documented inline with the task and surfaced in the final PR description.

---

## File structure

**Create:**
- `src/engines/video-convert/index.ts` — engine descriptor.
- `src/engines/video-convert/index.test.ts` — descriptor + validate + isReadyToConvert tests.
- `src/engines/video-convert/options.ts` — `VideoConvertOptions` type, defaults, format/codec/CRF maps, mime/extension helpers.
- `src/engines/video-convert/options.test.ts` — option helper unit tests.
- `src/engines/video-convert/options-panel.tsx` — format radio + quality select.
- `src/engines/video-convert/options-panel.test.tsx` — RTL test for format / quality interactions.
- `src/engines/video-convert/worker.ts` — Comlink-exposed `convertSingle` running ffmpeg full transcode.
- `src/app/tools/video-convert/page.tsx` — route.
- `tests/e2e/video-convert.spec.ts` — smoke E2E (page renders, options visible, fixture conversion completes).
- `tests/e2e/video-convert-correctness.spec.ts` — real ffmpeg roundtrip across format pairs.
- `tests/e2e/privacy-regression-video-convert.spec.ts` — zero outbound network during conversion.

**Modify:**
- `src/engines/_shared/registry.ts` — add `"video-convert"` to `EngineId` union and `REGISTRY` map.
- `src/engines/_shared/registry.test.ts` — extend the catalog count if it asserts a fixed number; otherwise no change.
- `src/engines/_shared/registry.metadata.test.ts` — extend if it iterates engines (it does).
- `src/components/layout/sidebar.tsx` — insert `video-convert` as the **first** entry in the VIDEO group (mirrors audio: `audio-convert` precedes `audio-trim`).
- `src/components/layout/sidebar.test.tsx` — update assertions for new tool count / order.
- `src/app/page.tsx` — append `video-convert` to `TOOLS`.
- `src/app/page.test.tsx` — update tool-count assertion if present.
- `tests/e2e/size-caps.spec.ts` — add `video-convert` row (100 MB cap, oversized fixture).

---

## Task 1: Add `video-convert` to the engine registry (failing-test first)

**Files:**
- Modify: `src/engines/_shared/registry.ts`
- Verify: `src/engines/_shared/registry.test.ts`
- Verify: `src/engines/_shared/registry.metadata.test.ts`

The registry is the single source of truth that the bundle-isolation gate, `/about` table, sidebar test, and home test all read indirectly. Wiring this first lets later tasks fail fast against a known-registered ID.

- [ ] **Step 1: Run the existing registry tests to establish a green baseline**

```bash
pnpm test src/engines/_shared/registry.test.ts src/engines/_shared/registry.metadata.test.ts
```

Expected: PASS. (Both currently green at 23 engines.)

- [ ] **Step 2: Add `"video-convert"` to the `EngineId` union and the `REGISTRY` map**

Edit `src/engines/_shared/registry.ts`. In the `EngineId` union, insert `"video-convert"` between `"video-extract-audio"` and `"video-trim"` (alphabetical):

```ts
export type EngineId =
  | "archive-create"
  | "archive-extract"
  | "audio-convert"
  | "audio-trim"
  | "data-convert"
  | "docx-to-txt"
  | "image-bg-remove"
  | "image-convert"
  | "image-resize"
  | "image-to-pdf"
  | "image-to-text"
  | "json-format"
  | "markdown-to-pdf"
  | "pdf-edit"
  | "pdf-merge"
  | "pdf-split"
  | "pdf-to-image"
  | "pdf-to-md"
  | "docx-to-pdf"
  | "txt-to-pdf"
  | "video-convert"
  | "video-extract-audio"
  | "video-trim"
  | "xml-to-json";
```

Then add the lazy loader to `REGISTRY` in the same alphabetical position:

```ts
  "video-convert": () => import("@/engines/video-convert"),
  "video-extract-audio": () => import("@/engines/video-extract-audio"),
```

- [ ] **Step 3: Run typecheck — expected to fail because `@/engines/video-convert` does not exist yet**

```bash
pnpm typecheck
```

Expected: FAIL. The error pins the missing module to `src/engines/_shared/registry.ts`. **Do not fix yet** — the missing module is created in Tasks 2–6 below. Tracking the failing typecheck through this task keeps the loop honest.

- [ ] **Step 4: Commit (intentional broken state)**

Hold off committing until the engine module exists (end of Task 6). The registry edit is included in that commit so we never push a broken `main`.

---

## Task 2: Define `VideoConvertOptions` and the format/codec/CRF maps

**Files:**
- Create: `src/engines/video-convert/options.ts`
- Create: `src/engines/video-convert/options.test.ts`

Encapsulate the format-specific knowledge (codec choice, CRF mapping, output mime, output extension) in pure helpers so the worker stays focused on the ffmpeg pipeline.

- [ ] **Step 1: Write failing tests for the option helpers**

Create `src/engines/video-convert/options.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CRF_BY_QUALITY,
  OUTPUT_EXTENSION,
  OUTPUT_MIME,
  VIDEO_CONVERT_FORMATS,
  VIDEO_CONVERT_QUALITY_LEVELS,
  audioCodec,
  defaultVideoConvertOptions,
  videoCodec,
} from "./options";

describe("video-convert options", () => {
  it("exposes the three target output formats in design order", () => {
    expect(VIDEO_CONVERT_FORMATS).toEqual(["mp4", "mov", "webm"]);
  });

  it("exposes the three quality levels in design order", () => {
    expect(VIDEO_CONVERT_QUALITY_LEVELS).toEqual(["low", "medium", "high"]);
  });

  it("maps quality levels to the spec-stated CRFs", () => {
    expect(CRF_BY_QUALITY.low).toBe(28);
    expect(CRF_BY_QUALITY.medium).toBe(23);
    expect(CRF_BY_QUALITY.high).toBe(18);
  });

  it("picks libx264 for mp4 and mov, libvpx-vp9 for webm", () => {
    expect(videoCodec("mp4")).toBe("libx264");
    expect(videoCodec("mov")).toBe("libx264");
    expect(videoCodec("webm")).toBe("libvpx-vp9");
  });

  it("picks aac for mp4/mov and libopus for webm", () => {
    expect(audioCodec("mp4")).toBe("aac");
    expect(audioCodec("mov")).toBe("aac");
    expect(audioCodec("webm")).toBe("libopus");
  });

  it("maps formats to canonical extensions and mimes", () => {
    expect(OUTPUT_EXTENSION.mp4).toBe("mp4");
    expect(OUTPUT_EXTENSION.mov).toBe("mov");
    expect(OUTPUT_EXTENSION.webm).toBe("webm");
    expect(OUTPUT_MIME.mp4).toBe("video/mp4");
    expect(OUTPUT_MIME.mov).toBe("video/quicktime");
    expect(OUTPUT_MIME.webm).toBe("video/webm");
  });

  it("defaults to outputFormat=null (force user choice) and quality=medium", () => {
    expect(defaultVideoConvertOptions.outputFormat).toBeNull();
    expect(defaultVideoConvertOptions.quality).toBe("medium");
  });
});
```

Run the test:

```bash
pnpm test src/engines/video-convert/options.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 2: Implement `options.ts`**

Create `src/engines/video-convert/options.ts`:

```ts
// Engine-specific options + format helpers for video-convert.
//
// Output format set is strict per v2 design §3.2: mp4, mov, webm.
// Input set (handled in index.ts validate) is broader to match video-trim.

export type VideoConvertFormat = "mp4" | "mov" | "webm";
export type VideoConvertQuality = "low" | "medium" | "high";

export const VIDEO_CONVERT_FORMATS: ReadonlyArray<VideoConvertFormat> = [
  "mp4",
  "mov",
  "webm",
];

export const VIDEO_CONVERT_QUALITY_LEVELS: ReadonlyArray<VideoConvertQuality> = [
  "low",
  "medium",
  "high",
];

// CRF (constant-rate-factor) values per v2 design §3.2.
// Lower CRF = higher quality + larger file. The same scale is meaningful
// for both libx264 and libvpx-vp9 in the 18–28 band, so a single map works.
export const CRF_BY_QUALITY: Record<VideoConvertQuality, number> = {
  low: 28,
  medium: 23,
  high: 18,
};

export const OUTPUT_EXTENSION: Record<VideoConvertFormat, string> = {
  mp4: "mp4",
  mov: "mov",
  webm: "webm",
};

export const OUTPUT_MIME: Record<VideoConvertFormat, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

export function videoCodec(fmt: VideoConvertFormat): string {
  return fmt === "webm" ? "libvpx-vp9" : "libx264";
}

export function audioCodec(fmt: VideoConvertFormat): string {
  return fmt === "webm" ? "libopus" : "aac";
}

export type VideoConvertOptions = {
  outputFormat: VideoConvertFormat | null;
  quality: VideoConvertQuality;
};

export const defaultVideoConvertOptions: VideoConvertOptions = {
  outputFormat: null,
  quality: "medium",
};
```

- [ ] **Step 3: Re-run the test**

```bash
pnpm test src/engines/video-convert/options.test.ts
```

Expected: PASS — all helpers behave as asserted.

---

## Task 3: Build the OptionsPanel (format radio + quality select)

**Files:**
- Create: `src/engines/video-convert/options-panel.tsx`
- Create: `src/engines/video-convert/options-panel.test.tsx`

Mirror `audio-convert/options-panel.tsx` for visual consistency: radio group for format, dropdown for quality. No conditional fields — quality is always relevant.

- [ ] **Step 1: Write failing RTL tests**

Create `src/engines/video-convert/options-panel.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoConvertOptionsPanel } from "./options-panel";
import { defaultVideoConvertOptions } from "./options";

describe("VideoConvertOptionsPanel", () => {
  it("renders three format radios in design order", () => {
    render(
      <VideoConvertOptionsPanel
        value={defaultVideoConvertOptions}
        onChange={() => undefined}
      />,
    );
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(["mp4", "mov", "webm"]);
  });

  it("emits onChange with the chosen format", () => {
    const onChange = vi.fn();
    render(
      <VideoConvertOptionsPanel
        value={defaultVideoConvertOptions}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("mp4"));
    expect(onChange).toHaveBeenCalledWith({
      ...defaultVideoConvertOptions,
      outputFormat: "mp4",
    });
  });

  it("renders a quality select with low/medium/high options", () => {
    render(
      <VideoConvertOptionsPanel
        value={{ outputFormat: "mp4", quality: "medium" }}
        onChange={() => undefined}
      />,
    );
    const select = screen.getByLabelText("quality") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(select.value).toBe("medium");
  });

  it("emits onChange with the chosen quality", () => {
    const onChange = vi.fn();
    render(
      <VideoConvertOptionsPanel
        value={{ outputFormat: "mp4", quality: "medium" }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("quality"), { target: { value: "high" } });
    expect(onChange).toHaveBeenCalledWith({
      outputFormat: "mp4",
      quality: "high",
    });
  });

  it("renders a tooltip-style hint about expected latency", () => {
    render(
      <VideoConvertOptionsPanel
        value={defaultVideoConvertOptions}
        onChange={() => undefined}
      />,
    );
    expect(
      screen.getByText(/typically takes ~1 minute per minute of video/i),
    ).toBeInTheDocument();
  });
});
```

```bash
pnpm test src/engines/video-convert/options-panel.test.tsx
```

Expected: FAIL — module does not exist.

- [ ] **Step 2: Implement `options-panel.tsx`**

Create `src/engines/video-convert/options-panel.tsx`:

```tsx
"use client";

import type { OptionsPanelProps } from "@/engines/_shared/types";
import {
  type VideoConvertOptions,
  type VideoConvertQuality,
  VIDEO_CONVERT_FORMATS,
  VIDEO_CONVERT_QUALITY_LEVELS,
} from "./options";

export function VideoConvertOptionsPanel({
  value,
  onChange,
}: OptionsPanelProps<VideoConvertOptions>) {
  return (
    <div
      data-testid="video-convert-options"
      className="mb-3 flex flex-wrap items-center gap-4 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      <fieldset className="flex items-center gap-2 border-0 p-0 m-0">
        <legend className="float-left mr-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
          format:
        </legend>
        <span className="inline-flex gap-3">
          {VIDEO_CONVERT_FORMATS.map((fmt) => (
            <label
              key={fmt}
              className="flex cursor-pointer items-center gap-1 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]"
            >
              <input
                type="radio"
                name="video-output-format"
                value={fmt}
                checked={value.outputFormat === fmt}
                onChange={() => onChange({ ...value, outputFormat: fmt })}
                className="accent-[var(--color-fg-strong)]"
              />
              {fmt}
            </label>
          ))}
        </span>
      </fieldset>

      <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        quality:
        <select
          aria-label="quality"
          data-testid="quality-select"
          value={value.quality}
          onChange={(e) =>
            onChange({
              ...value,
              quality: e.target.value as VideoConvertQuality,
            })
          }
          className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase"
        >
          {VIDEO_CONVERT_QUALITY_LEVELS.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </select>
      </label>

      <p className="basis-full text-[var(--color-fg-very-muted)]">
        // this typically takes ~1 minute per minute of video.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Re-run RTL tests**

```bash
pnpm test src/engines/video-convert/options-panel.test.tsx
```

Expected: PASS.

---

## Task 4: Implement the worker (ffmpeg full transcode)

**Files:**
- Create: `src/engines/video-convert/worker.ts`

The worker is intentionally close to `audio-convert/worker.ts` so reviewers can diff the two. Differences: `-vn` is removed (video pass-through), video codec + CRF + preset args are added, audio codec stays.

- [ ] **Step 1: Implement `worker.ts`**

Create `src/engines/video-convert/worker.ts`:

```ts
import { loadFfmpeg } from "@/engines/_shared/ffmpeg";
import type { ConversionProgress, OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import {
  CRF_BY_QUALITY,
  OUTPUT_EXTENSION,
  OUTPUT_MIME,
  type VideoConvertOptions,
  audioCodec,
  videoCodec,
} from "./options";

// Cancellation note: this worker runs under WorkerHarness in `persistent: false`
// mode, which means signal.abort() at the host terminates this worker — and
// therefore the in-flight ffmpeg pass — at the OS-thread boundary. This is the
// behavior the v2 design §4.5 prescribes for slow engines: cancel must take
// effect, not just unblock the UI.
//
// The cost: each conversion spawns a fresh worker; loadFfmpeg() re-instantiates
// FFmpeg() and re-calls .load(). The WASM bytes are HTTP-cached so this is
// ~1–2 s of cold start, dwarfed by transcode time on any realistic input.

function suffixedFilename(name: string, suffix: string, newExt: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}${suffix}.${newExt}`;
}

function preset(fmt: VideoConvertOptions["outputFormat"]): string[] {
  if (fmt === "webm") {
    // libvpx-vp9: `-deadline good -cpu-used 2` is a sane "real users will
    // wait this long" point. Lower cpu-used = slower + better quality.
    return ["-deadline", "good", "-cpu-used", "2"];
  }
  // libx264: medium preset is the standard quality/speed balance.
  return ["-preset", "medium"];
}

const api = {
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    _type: string,
    opts: VideoConvertOptions,
    onProgress?: (p: ConversionProgress) => void,
  ): Promise<OutputItem> {
    if (!opts.outputFormat) {
      throw new Error("video-convert: outputFormat must be set before conversion");
    }
    const fmt = opts.outputFormat;

    onProgress?.({ kind: "model-loading", loaded: 0, total: 1 });
    const ff = await loadFfmpeg();
    onProgress?.({ kind: "model-loading", loaded: 1, total: 1 });

    const progressHandler = ({ progress }: { progress: number; time: number }) => {
      onProgress?.({ kind: "inference", pct: Math.max(0, Math.min(100, progress * 100)) });
    };
    ff.on("progress", progressHandler);

    const inExt = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "bin").toLowerCase();
    const outExt = OUTPUT_EXTENSION[fmt];
    const id = crypto.randomUUID();
    const inName = `in_${id}.${inExt}`;
    const outName = `out_${id}.${outExt}`;

    try {
      await ff.writeFile(inName, new Uint8Array(bytes));
      onProgress?.({ kind: "inference", pct: 0 });

      const args: string[] = [
        "-i",
        inName,
        "-c:v",
        videoCodec(fmt),
        "-crf",
        String(CRF_BY_QUALITY[opts.quality]),
        ...preset(fmt),
        "-c:a",
        audioCodec(fmt),
        // -movflags +faststart only meaningful for mp4/mov; harmless for webm
        // (ffmpeg ignores unknown flags for the matroska/webm muxer).
        ...(fmt === "webm" ? [] : ["-movflags", "+faststart"]),
        outName,
      ];

      const exitCode = await ff.exec(args);
      if (exitCode !== 0) {
        throw new Error(`video-convert: ffmpeg exited with code ${exitCode}`);
      }

      onProgress?.({ kind: "inference", pct: 100 });

      const out = await ff.readFile(outName);
      if (typeof out === "string") {
        throw new Error("video-convert: ffmpeg returned text output unexpectedly");
      }

      const blob = new Blob([out as Uint8Array<ArrayBuffer>], { type: OUTPUT_MIME[fmt] });
      return {
        filename: suffixedFilename(name, "-converted", outExt),
        mime: OUTPUT_MIME[fmt],
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
};

Comlink.expose(api);
```

(No standalone unit test for the worker — the codec/preset logic is exercised end-to-end via the correctness E2E in Task 11. The pure helpers it uses are already covered by Task 2's options test.)

---

## Task 5: Implement the engine descriptor

**Files:**
- Create: `src/engines/video-convert/index.ts`
- Create: `src/engines/video-convert/index.test.ts`

The descriptor wires options + worker + validation + metadata into the `SingleInputEngine` shape. Uses **non-persistent harness** — the harness comment in the file pins this choice with rationale.

- [ ] **Step 1: Write failing index tests**

Create `src/engines/video-convert/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import engine from "./index";
import { defaultVideoConvertOptions } from "./options";

function fakeFile(name: string, sizeBytes: number, type = ""): File {
  return new File([new Uint8Array(Math.min(sizeBytes, 16))], name, { type });
}

describe("video-convert engine descriptor", () => {
  it("declares id, category, license, and library", () => {
    expect(engine.id).toBe("video-convert");
    expect(engine.category).toBe("video");
    expect(engine.cardinality).toBe("single");
    expect(engine.license).toBe("GPL-2.0-or-later");
    expect(engine.library).toMatch(/ffmpeg/i);
  });

  it("accepts mp4, mov, webm, mkv inputs", () => {
    expect(engine.inputAccept).toEqual([".mp4", ".mov", ".webm", ".mkv"]);
  });

  it("isReadyToConvert is false until outputFormat is chosen", () => {
    expect(engine.isReadyToConvert?.(defaultVideoConvertOptions)).toBe(false);
    expect(
      engine.isReadyToConvert?.({ outputFormat: "mp4", quality: "medium" }),
    ).toBe(true);
  });

  it("validates a known mp4 file by extension", () => {
    const file = fakeFile("clip.mp4", 1024, "video/mp4");
    const result = engine.validate(file, defaultVideoConvertOptions);
    expect(result).toEqual({ ok: true });
  });

  it("validates a known mkv file even with empty mime", () => {
    const file = fakeFile("clip.mkv", 1024, "");
    const result = engine.validate(file, defaultVideoConvertOptions);
    expect(result).toEqual({ ok: true });
  });

  it("rejects unsupported extensions", () => {
    const file = fakeFile("song.mp3", 1024, "audio/mpeg");
    const result = engine.validate(file, defaultVideoConvertOptions);
    expect(result.ok).toBe(false);
  });

  it("rejects files above the 100 MB cap", () => {
    const file = fakeFile("big.mp4", 100_000_001, "video/mp4");
    // The fakeFile helper caps the actual byte payload at 16 to keep the
    // test cheap — we override `.size` to match the assertion target.
    Object.defineProperty(file, "size", { value: 100_000_001 });
    const result = engine.validate(file, defaultVideoConvertOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/100\s*MB/i);
    }
  });
});
```

```bash
pnpm test src/engines/video-convert/index.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 2: Implement `index.ts`**

Create `src/engines/video-convert/index.ts`:

```ts
import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type VideoConvertOptions, defaultVideoConvertOptions } from "./options";
import { VideoConvertOptionsPanel } from "./options-panel";

const SUPPORTED_INPUT_MIMES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
];

// v2 design §7.1: 100 MB cap. Constrained by ffmpeg.wasm memory and the
// "users will wait" tolerance for browser-side full transcode.
const MAX_FILE_BYTES = 100 * 1024 * 1024;

// Non-persistent harness: each conversion gets a fresh worker so signal.abort()
// terminates the worker — and therefore in-flight ffmpeg — at the OS boundary.
// Audio-convert uses persistent because audio passes finish quickly. Video
// transcodes can run for minutes, so honest cancellation matters more than
// the ~1–2 s WASM cold-start cost on each conversion.
const engine: SingleInputEngine<VideoConvertOptions, OutputItem> = {
  id: "video-convert",
  inputAccept: [".mp4", ".mov", ".webm", ".mkv"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "video/mp4",
  defaultOptions: defaultVideoConvertOptions,
  category: "video",
  library: "ffmpeg.wasm",
  license: "GPL-2.0-or-later",
  cardinality: "single",
  isReadyToConvert: (opts) => opts.outputFormat !== null,
  OptionsPanel: VideoConvertOptionsPanel,
  validate(file) {
    const mimeOk = SUPPORTED_INPUT_MIMES.includes(file.type);
    const extOk = /\.(mp4|mov|webm|mkv)$/i.test(file.name);
    if (!mimeOk && !extOk) {
      return { ok: false, reason: "Expected an MP4, MOV, WebM, or MKV file" };
    }
    if (file.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        reason: `File too large for video-convert (limit 100 MB; got ${(file.size / 1_000_000).toFixed(1)} MB).`,
      };
    }
    return { ok: true };
  },
  async convert(file, opts, signal, runOpts) {
    // Per-call ephemeral harness — fresh worker each time, terminates on abort.
    const harness = new WorkerHarness<VideoConvertOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
      { persistent: false },
    );
    try {
      const result = await harness.runSingle(file, opts, signal, runOpts);
      if (Array.isArray(result)) {
        const first = result[0];
        if (!first) throw new Error("video-convert: engine returned empty array");
        return first;
      }
      return result;
    } finally {
      harness.dispose();
    }
  },
};

export default engine;
```

- [ ] **Step 3: Re-run index tests + typecheck**

```bash
pnpm test src/engines/video-convert/index.test.ts
pnpm typecheck
```

Expected: PASS, PASS. The registry import from Task 1 should now resolve.

- [ ] **Step 4: Run the registry metadata test**

```bash
pnpm test src/engines/_shared/registry.metadata.test.ts
```

Expected: PASS — iterates engines and asserts `library` / `license` / `category` are set on each. `video-convert` provides all three.

- [ ] **Step 5: Commit Tasks 1–5 as one atomic engine-module commit**

```bash
git add src/engines/_shared/registry.ts src/engines/video-convert
git commit -m "$(cat <<'EOF'
feat(video-convert): add ffmpeg full-transcode engine module

mp4/mov/webm output (libx264+aac, libvpx-vp9+libopus); low/medium/high
quality maps to CRF 28/23/18. Non-persistent harness so signal.abort()
terminates ffmpeg mid-transcode per v2 design §4.5 cancel UX.

Closes the v2 catalog gap left when Phase 21 deferred video-convert.

Refs v2 design §3.2.
EOF
)"
```

---

## Task 6: Add the route page

**Files:**
- Create: `src/app/tools/video-convert/page.tsx`

Trivial; mirrors `src/app/tools/video-trim/page.tsx`. The non-persistent harness is created per-conversion inside the engine, so no `disposeXxxHarness` plumbing is needed here.

- [ ] **Step 1: Create the route**

Create `src/app/tools/video-convert/page.tsx`:

```tsx
"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/video-convert";

export default function VideoConvertPage() {
  return <ToolFrame engine={engine} />;
}
```

- [ ] **Step 2: Verify the route builds**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Smoke-load the route in dev**

```bash
pnpm dev &
DEV_PID=$!
sleep 5
curl -sf http://localhost:3000/tools/video-convert > /dev/null && echo OK || echo FAIL
kill $DEV_PID
```

Expected: `OK` printed. (If `pnpm dev` is already running in another shell, skip the lifecycle and just `curl`.)

---

## Task 7: Add `video-convert` to the sidebar

**Files:**
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/components/layout/sidebar.test.tsx`

Insert as the first VIDEO entry, mirroring audio (`audio-convert` precedes `audio-trim`).

- [ ] **Step 1: Update the sidebar test**

Edit `src/components/layout/sidebar.test.tsx`. Find the assertion that counts tools or lists the VIDEO group and update it. If the file uses a snapshot, run `pnpm test src/components/layout/sidebar.test.tsx -u` after the source edit in Step 2.

If the file asserts the VIDEO group's order, change the expected to:

```ts
expect(videoLabels).toEqual(["video convert", "video trim", "video → audio"]);
```

If the file asserts a tool count, bump it by 1.

Run before editing source:

```bash
pnpm test src/components/layout/sidebar.test.tsx
```

Expected: FAIL (or pass if no order/count assertion exists). Note the failure shape so Step 2's edit clearly fixes it.

- [ ] **Step 2: Insert `video-convert` into the sidebar `TOOLS` array**

Edit `src/components/layout/sidebar.tsx`. Insert before the existing `video-trim` entry:

```ts
  { id: "video-convert", href: "/tools/video-convert", label: "video convert", group: "VIDEO" },
```

Final VIDEO block becomes:

```ts
  { id: "video-convert", href: "/tools/video-convert", label: "video convert", group: "VIDEO" },
  { id: "video-trim", href: "/tools/video-trim", label: "video trim", group: "VIDEO" },
  {
    id: "video-extract-audio",
    href: "/tools/video-extract-audio",
    label: "video → audio",
    group: "VIDEO",
  },
```

- [ ] **Step 3: Re-run the sidebar test**

```bash
pnpm test src/components/layout/sidebar.test.tsx
```

Expected: PASS.

---

## Task 8: Add `video-convert` to the home grid

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/page.test.tsx`

The home grid is currently a flat list. Phase 26 will introduce category sections; this task just appends an entry so the count + ordering match the new sidebar.

- [ ] **Step 1: Update the home test**

`src/app/page.test.tsx` has two hard-coded counts that will break:

- Line ~10: `expect(bar).toHaveTextContent("23 TOOLS ONLINE");` → bump to `"24 TOOLS ONLINE"`.
- Line ~138–141: `it("renders exactly 23 tool cards", ...)` and `expect(cards).toHaveLength(23);` → bump both to 24 (the `it()` description string and the `toHaveLength` value).

Run before editing source to see them fail:

```bash
pnpm test src/app/page.test.tsx
```

Expected: FAIL on both assertions after Step 2's source edit. (Without the Step 2 edit, the test still passes today at 23.)

Note: `tests/e2e/about.spec.ts`, `src/app/about/engines-table.test.tsx`, and `tests/e2e/home-page.spec.ts` were verified during plan-write — none hard-code an engine count, so they don't need touching.

- [ ] **Step 2: Insert the entry into `TOOLS` immediately before `video-trim`**

Edit `src/app/page.tsx`. Insert:

```ts
  {
    id: "video-convert",
    title: "video convert",
    description: "mp4, mov, webm, mkv · transcode between formats with quality control",
    href: "/tools/video-convert",
  },
```

immediately before the existing `video-trim` entry.

- [ ] **Step 3: Re-run the home test**

```bash
pnpm test src/app/page.test.tsx
```

Expected: PASS. The "// 23 TOOLS ONLINE" status bar will now read "// 24 TOOLS ONLINE" automatically (driven by `${TOOLS.length}`).

- [ ] **Step 4: Commit Tasks 6–8 (route + UI surfaces)**

```bash
git add src/app/tools/video-convert src/components/layout/sidebar.tsx src/components/layout/sidebar.test.tsx src/app/page.tsx src/app/page.test.tsx
git commit -m "$(cat <<'EOF'
feat(video-convert): wire route, sidebar, and home grid

Adds /tools/video-convert and surfaces the engine in the VIDEO sidebar
group (first entry, mirroring audio-convert/audio-trim ordering) and on
the home grid. Tool count updates from 23 to 24.
EOF
)"
```

---

## Task 9: Smoke E2E — page renders, options visible, fixture conversion completes

**Files:**
- Create: `tests/e2e/video-convert.spec.ts`

Mirrors `tests/e2e/audio-convert.spec.ts`'s shape. Uses the smallest committed video fixture so the test stays fast.

- [ ] **Step 1: Write the smoke test**

Create `tests/e2e/video-convert.spec.ts`:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, "../fixtures/video/sample-h264-aac.mp4");

test.describe("video-convert smoke", () => {
  test("renders the route and the options panel", async ({ page }) => {
    await page.goto("/tools/video-convert");
    await expect(page.getByTestId("video-convert-options")).toBeVisible();
    await expect(page.getByLabel("quality")).toBeVisible();
  });

  test("transcodes a fixture to webm end-to-end", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/tools/video-convert");

    await page.setInputFiles('input[type="file"]', FIXTURE);

    // Pick webm output + low quality (CRF 28) for the fastest possible pass.
    await page.getByLabel("webm").click();
    await page.getByLabel("quality").selectOption("low");

    await page.getByRole("button", { name: /convert/i }).click();

    await expect(page.getByRole("link", { name: /download/i })).toBeVisible({
      timeout: 150_000,
    });

    const downloadLink = page.getByRole("link", { name: /download/i });
    const href = await downloadLink.getAttribute("href");
    expect(href).toMatch(/^blob:/);

    // Filename suffix sanity-check.
    const linkText = await downloadLink.textContent();
    expect(linkText).toMatch(/sample-h264-aac-converted\.webm/);
  });
});
```

- [ ] **Step 2: Run the test (Chromium only for speed)**

```bash
pnpm test:e2e tests/e2e/video-convert.spec.ts --project=chromium
```

Expected: PASS. Timeout is 3 min — the fixture is small (~1 MB) so realistic runs land well under that.

---

## Task 10: Correctness E2E — verify each output format produces a decodable file

**Files:**
- Create: `tests/e2e/video-convert-correctness.spec.ts`

Drives one transcode per output format and asserts the resulting blob's magic bytes match the expected container. No need to round-trip through ffmpeg client-side — magic-byte verification is enough to catch codec/container mismatches that would corrupt output.

- [ ] **Step 1: Write the correctness test**

Create `tests/e2e/video-convert-correctness.spec.ts`:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, "../fixtures/video/sample-h264-aac.mp4");

type Format = "mp4" | "mov" | "webm";

// Magic-byte signatures for the three output containers.
//   mp4 + mov: ISO BMFF — bytes 4..8 are "ftyp" (0x66 0x74 0x79 0x70).
//   webm: EBML header — first 4 bytes are 0x1A 0x45 0xDF 0xA3.
function detectContainer(bytes: Uint8Array): Format | null {
  if (
    bytes.length >= 8 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    // ftyp brand at bytes 8..12 distinguishes mp4 vs mov. Common brands:
    //   "isom", "mp42", "mp41", "iso2", "avc1" → mp4
    //   "qt  " → mov
    const brand = String.fromCharCode(bytes[8] ?? 0, bytes[9] ?? 0, bytes[10] ?? 0, bytes[11] ?? 0);
    return brand.startsWith("qt") ? "mov" : "mp4";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return "webm";
  }
  return null;
}

for (const format of ["mp4", "mov", "webm"] as const) {
  test(`video-convert produces a valid ${format} file`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/tools/video-convert");
    await page.setInputFiles('input[type="file"]', FIXTURE);

    await page.getByLabel(format).click();
    await page.getByLabel("quality").selectOption("low");

    await page.getByRole("button", { name: /convert/i }).click();
    const link = page.getByRole("link", { name: /download/i });
    await expect(link).toBeVisible({ timeout: 150_000 });

    const href = await link.getAttribute("href");
    expect(href).toMatch(/^blob:/);

    const bytes = await page.evaluate(async (blobUrl: string) => {
      const r = await fetch(blobUrl);
      const buf = await r.arrayBuffer();
      return Array.from(new Uint8Array(buf.slice(0, 32)));
    }, href!);

    const detected = detectContainer(new Uint8Array(bytes));
    expect(detected).toBe(format);
  });
}
```

- [ ] **Step 2: Run the correctness test**

```bash
pnpm test:e2e tests/e2e/video-convert-correctness.spec.ts --project=chromium
```

Expected: 3 PASS. If a format fails magic-byte verification, the codec args in `worker.ts` are likely mis-paired with the container — fix at the source, not the test.

---

## Task 11: Privacy regression — zero outbound network during conversion

**Files:**
- Create: `tests/e2e/privacy-regression-video-convert.spec.ts`

The privacy gate is the load-bearing project promise. Mirror the existing `privacy-regression-audio-convert.spec.ts` pattern.

- [ ] **Step 1: Read the audio-convert privacy spec and copy its structure**

```bash
cat tests/e2e/privacy-regression-audio-convert.spec.ts
```

Note: it captures all network requests after page load, runs a conversion, asserts none of them target a non-self origin.

- [ ] **Step 2: Write the video-convert privacy spec**

Create `tests/e2e/privacy-regression-video-convert.spec.ts`:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, "../fixtures/video/sample-h264-aac.mp4");

test("video-convert performs no off-origin network requests during conversion", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(180_000);

  await page.goto("/tools/video-convert");
  await page.waitForLoadState("networkidle");

  const offOriginRequests: string[] = [];
  const sameOriginRoot = new URL(baseURL ?? page.url()).origin;

  page.on("request", (req) => {
    const url = req.url();
    // Permit data: / blob: URIs (no network) and same-origin requests.
    if (url.startsWith("data:") || url.startsWith("blob:")) return;
    try {
      const reqOrigin = new URL(url).origin;
      if (reqOrigin !== sameOriginRoot) {
        offOriginRequests.push(`${req.method()} ${url}`);
      }
    } catch {
      offOriginRequests.push(`unparseable: ${url}`);
    }
  });

  await page.setInputFiles('input[type="file"]', FIXTURE);
  await page.getByLabel("webm").click();
  await page.getByLabel("quality").selectOption("low");
  await page.getByRole("button", { name: /convert/i }).click();

  await expect(page.getByRole("link", { name: /download/i })).toBeVisible({
    timeout: 150_000,
  });

  expect(offOriginRequests, offOriginRequests.join("\n")).toEqual([]);
});
```

- [ ] **Step 3: Run the privacy spec**

```bash
pnpm test:e2e tests/e2e/privacy-regression-video-convert.spec.ts --project=chromium
```

Expected: PASS — empty `offOriginRequests` array.

---

## Task 12: Extend `tests/e2e/size-caps.spec.ts` with the 100 MB cap

**Files:**
- Modify: `tests/e2e/size-caps.spec.ts`

Centralized size-cap test that asserts oversized files are rejected with the engine's actionable error.

- [ ] **Step 1: Read the existing test to understand the table-driven shape**

```bash
cat tests/e2e/size-caps.spec.ts | head -120
```

The file likely iterates a `[engineId, capMB, fixturePath]`-style table. If `video-convert` is missing, append a row.

- [ ] **Step 2: Add the row**

If the table follows the pattern shown in audio engines, add a `video-convert` entry pointing to a fake-large fixture (most existing entries use a generated-on-the-fly oversized blob via `page.evaluate`, not a committed fixture, to avoid bloating the repo). Match whatever pattern the existing `audio-convert` entry uses.

If unsure, mirror `audio-convert`'s row exactly, swapping:
- engine id → `video-convert`
- route → `/tools/video-convert`
- cap → 100 MB (vs audio-convert's 500 MB)
- expected error substring → `100 MB` (the engine returns `"limit 100 MB; got X.X MB"`)

- [ ] **Step 3: Run the test**

```bash
pnpm test:e2e tests/e2e/size-caps.spec.ts --project=chromium
```

Expected: PASS — including the new `video-convert` row.

- [ ] **Step 4: Commit Tasks 9–12 (all E2E coverage)**

```bash
git add tests/e2e/video-convert.spec.ts tests/e2e/video-convert-correctness.spec.ts tests/e2e/privacy-regression-video-convert.spec.ts tests/e2e/size-caps.spec.ts
git commit -m "$(cat <<'EOF'
test(video-convert): smoke + correctness + privacy + size-cap E2E

Smoke validates the route, options panel, and end-to-end transcode.
Correctness asserts each output format's magic bytes match its
container. Privacy regression confirms zero off-origin requests during
a conversion. Size-cap row enforces the 100 MB limit.
EOF
)"
```

---

## Task 13: Full-suite verification before opening the PR

**Files:** none modified — verification only.

- [ ] **Step 1: Lint**

```bash
pnpm lint
```

Expected: PASS. If Biome flags anything in the new files, fix at the source.

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Unit + integration test suite**

```bash
pnpm test
```

Expected: PASS. Pay attention to `registry.metadata.test.ts`, `sidebar.test.tsx`, `page.test.tsx` — these were touched.

- [ ] **Step 4: Build + bundle isolation gate**

```bash
pnpm build
```

The `prebuild` hook runs `scripts/check-vercel-headers.mjs` and the `postbuild` hook runs `scripts/check-bundle-isolation.mjs`. Both must pass.

Expected output ends with:
- `[check-vercel-headers] OK — vercel.json carries COOP same-origin and COEP require-corp`
- `bundle-isolation: OK — homepage chunks are clean of 24 engines`
- `bundle-isolation: OK — no forbidden CDN strings in N chunks`

If bundle isolation flags `video-convert`'s chunk in the homepage set, the leak isn't coming from `src/app/tools/video-convert/page.tsx` — Next.js per-route code-splitting isolates per-route static imports automatically (the same pattern works for `video-trim`, `audio-convert`, etc., without any dynamic-import gymnastics). Look instead for an unintended import of `@/engines/video-convert` from a homepage-reachable module: the home page itself, `src/components/layout/sidebar.tsx`, `src/components/layout/footer.tsx`, or any layout component. The fix is to remove that import (sidebar/home should reference the engine by `id` string only, not import the module).

- [ ] **Step 5: Targeted E2E re-run**

```bash
pnpm test:e2e tests/e2e/video-convert.spec.ts tests/e2e/video-convert-correctness.spec.ts tests/e2e/privacy-regression-video-convert.spec.ts tests/e2e/size-caps.spec.ts --project=chromium
```

Expected: all green.

- [ ] **Step 6: Spot-check Firefox + WebKit on the smoke spec only**

WebKit and Firefox runs are slower and more brittle for video work; re-run only the smoke spec on each:

```bash
pnpm test:e2e tests/e2e/video-convert.spec.ts --project=firefox
pnpm test:e2e tests/e2e/video-convert.spec.ts --project=webkit
```

Expected: PASS on both. If WebKit fails on `crossOriginIsolated` (single-threaded ffmpeg core), the engine should still complete the transcode using the ST core — slower but functional. Long timeout (3 min) accommodates this.

If a cross-browser failure surfaces a real defect, fix at the source. If it surfaces a flake (e.g., timeout on a slow runner), bump the per-test timeout once and document inline.

---

## Task 14: Open the PR

**Files:** none modified — workflow only.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin <branch-name>
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "Phase 25.5: video-convert engine (closes v2 catalog gap)" --body "$(cat <<'EOF'
## Summary
- Adds `video-convert` — full-transcode video engine (mp4 / mov / webm output).
- Output codecs: libx264 + aac (mp4/mov), libvpx-vp9 + libopus (webm).
- Quality levels low/medium/high → CRF 28/23/18 with format-appropriate preset.
- Non-persistent worker harness so cancellation actually terminates ffmpeg
  mid-transcode (per v2 design §4.5).
- 100 MB input cap; mp4/mov/webm/mkv accepted on input (matches video-trim).
- Wires the engine into the registry, sidebar (first VIDEO entry), and
  home grid; tool count moves 23 → 24, completing the v2 catalog.

## Why
v2 design §1.1 specified 24 engines including `video-convert`. Phase 21
deferred the engine to "Phase 22+", but Phases 22–25 went on to other
families. This phase closes that gap before Phase 26 (v2 closeout).

## Test plan
- [ ] Lint, typecheck, full unit suite (`pnpm lint`, `pnpm typecheck`, `pnpm test`)
- [ ] `pnpm build` — including prebuild header gate + postbuild bundle-isolation gate
- [ ] E2E (Chromium): smoke, correctness (mp4/mov/webm magic-byte check),
      privacy regression, size-cap
- [ ] E2E smoke on Firefox + WebKit
- [ ] Manual: drop a small mp4 in `/tools/video-convert`, transcode to webm,
      verify the downloaded file plays in VLC
- [ ] Manual: start a long transcode, click Cancel, confirm the operation
      stops within ~1 s and no further progress events fire

Refs `docs/superpowers/specs/2026-05-05-v2-design.md` §3.2.
EOF
)"
```

- [ ] **Step 3: Wait for CI green; merge when reviewed**

After merge, **Phase 26 plan-writing can proceed** with the catalog at 24 engines.

---

## Self-review checklist

After implementing, before declaring the phase done:

1. **Spec coverage** — every clause of v2 design §3.2 is implemented:
   - ✅ Input formats: mp4, mov, webm (+ mkv via deviation)
   - ✅ Size cap 100 MB
   - ✅ Output formats: mp4, mov, webm
   - ✅ `outputFormat` + `quality: low|medium|high` mapping to CRF 28/23/18
   - ✅ ffmpeg full transcode worker
   - ✅ Mandatory progress UI (driven by `ConversionProgress` events that ToolFrame already renders)
   - ✅ Cancel works (non-persistent harness terminates ffmpeg)
   - ✅ Pre-conversion tooltip about latency
2. **Privacy invariant** — `tests/e2e/privacy-regression-video-convert.spec.ts` is green.
3. **Bundle isolation** — `scripts/check-bundle-isolation.mjs` reports the homepage chunk free of `video-convert` code.
4. **Catalog count** — home grid + sidebar both show `video-convert`; status bar reads 24 tools.
5. **/about engines table** — auto-derived; `video-convert` row appears with `library: "ffmpeg.wasm"`, `license: "GPL-2.0-or-later"`.

If any item fails, fix at the source — don't relax the test or the gate.
