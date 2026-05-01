# Phase 2 — Image-convert engine implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task with two-stage review on substantive (architecture-touching) tasks and combined opus review on mechanical extensions. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a generic `image-convert` engine handling all combinations of PNG / JPEG / WebP via `createImageBitmap` + `OffscreenCanvas`. Introduce the `OptionsPanel` + `isReadyToConvert` engine-pattern extensions.

**Architecture:** Single engine, one route (`/tools/image-convert`), engine module owns its options UI as a React component on the descriptor. ToolFrame mounts the engine's `<OptionsPanel>` above the DropZone, holds options state, gates the DropZone via `isReadyToConvert`. Cross-route handoff (from `/`) holds the staged file until options are ready, then fires conversion automatically.

**Tech Stack:** Same as Plan 1 — Next.js 15 static export, React 19, Comlink-typed Web Workers, OffscreenCanvas, Tailwind v4, Vitest, Playwright. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-05-01-image-convert-engine-design.md` (commit `83c58cb`).

**Branch:** `phase-2-image-convert` (create off `main` after Plan 2 spec PR merges; if executing inline, the current `plan-2-image-convert-spec` branch is acceptable).

**Substantive tasks (full two-stage sonnet+opus review):** 1, 2, 4, 7. Mechanical/cosmetic tasks (combined opus review): 3, 5, 6, 8, 9, 10.

**Branch discipline reminder for implementer subagents:**
- Run `git branch --show-current` before AND after every commit. Verify the expected branch.
- Never run `git branch -m`, `git branch -M`, `git checkout <branch>`, `git switch <branch>`, `git reset --hard`, `git push`, `git push --force`. No `--no-verify`.
- Allowed: `git status`, `git diff`, `git log`, `git branch --show-current`, `git add <specific files>`, `git commit`.

---

## Task 1: Extend engine type system with options-panel + ready-gate fields

**Goal:** Add `OptionsPanel` and `isReadyToConvert` as optional fields on `SingleInputEngine` and `MultiInputEngine`. Add type-d tests proving HEIC engine still typechecks (backward compat).

**Files:**
- Modify: `src/engines/_shared/types.ts`
- Modify: `src/engines/_shared/types.test-d.ts`
- Modify: `src/engines/_shared/registry.ts` — the new `isReadyToConvert?: (opts: TOptions) => boolean` field puts a function in input-contravariant position. With `exactOptionalPropertyTypes`, the existing `Loader` type's `ConversionEngine<unknown, ...>` default no longer accepts concrete engine types (e.g., `(opts: HeicToPngOptions) => boolean` is not assignable to `(opts: unknown) => boolean`). Widen `Loader` to use `ConversionEngine<any, OutputItem | OutputItem[]>` (factored as `type AnyEngine = ...` for a labeled `any` boundary), with a `biome-ignore lint/suspicious/noExplicitAny` annotation. The registry is the canonical type-erasure boundary; `loadEngine`'s public return type stays `ConversionEngine` (unparameterized) so callers are unaffected.

- [ ] **Step 1: Add the new optional fields to both engine types**

In `src/engines/_shared/types.ts`, replace the `SingleInputEngine` and `MultiInputEngine` definitions with:

```ts
import type { ComponentType } from "react";

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export type OutputItem = {
  filename: string;
  mime: string;
  blob: Blob;
};

export type EngineMeta<TOptions> = {
  id: string;
  inputAccept: string[];
  inputMime: string[];
  outputMime: string;
  defaultOptions: TOptions;
};

export type OptionsPanelProps<TOptions> = {
  value: TOptions;
  onChange: (next: TOptions) => void;
};

export type SingleInputEngine<
  TOptions,
  TOutput extends OutputItem | OutputItem[],
> = EngineMeta<TOptions> & {
  cardinality: "single";
  validate(file: File, opts: TOptions): ValidationResult;
  convert(file: File, opts: TOptions, signal: AbortSignal): Promise<TOutput>;
  isReadyToConvert?: (opts: TOptions) => boolean;
  OptionsPanel?: ComponentType<OptionsPanelProps<TOptions>>;
};

export type MultiInputEngine<
  TOptions,
  TOutput extends OutputItem | OutputItem[],
> = EngineMeta<TOptions> & {
  cardinality: "multi";
  validate(files: File[], opts: TOptions): ValidationResult;
  convert(files: File[], opts: TOptions, signal: AbortSignal): Promise<TOutput>;
  isReadyToConvert?: (opts: TOptions) => boolean;
  OptionsPanel?: ComponentType<OptionsPanelProps<TOptions>>;
};

export type ConversionEngine<
  TOptions = unknown,
  TOutput extends OutputItem | OutputItem[] = OutputItem | OutputItem[],
> = SingleInputEngine<TOptions, TOutput> | MultiInputEngine<TOptions, TOutput>;
```

The two new optional fields apply to both cardinalities. Engines without options omit both. The `OptionsPanelProps<T>` helper is exported so engine modules can type their components without redeclaring the shape.

- [ ] **Step 2: Update the type-d test to assert new fields are optional**

Append to `src/engines/_shared/types.test-d.ts`:

```ts
import { expectTypeOf } from "vitest";
import type {
  ConversionEngine,
  OptionsPanelProps,
  SingleInputEngine,
} from "./types";

// New optional fields are present and optional.
type OptsType = { foo: string };
type SE = SingleInputEngine<OptsType, { filename: string; mime: string; blob: Blob }>;

expectTypeOf<SE["isReadyToConvert"]>().toEqualTypeOf<((opts: OptsType) => boolean) | undefined>();

// OptionsPanelProps shape.
expectTypeOf<OptionsPanelProps<OptsType>>().toEqualTypeOf<{
  value: OptsType;
  onChange: (next: OptsType) => void;
}>();
```

This test exists at compile time only (`.test-d.ts` files are run via Vitest's type-test runner if configured, otherwise just TypeScript-checked). The existing types.test-d.ts file uses `expectTypeOf` from Vitest already.

- [ ] **Step 3: Verify HEIC engine still typechecks**

```bash
pnpm typecheck
```

Expected: exit 0, no errors. HEIC engine doesn't declare the new fields and that's fine — they're optional.

- [ ] **Step 4: Run all gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all exit 0; test count unchanged from main (45 unit tests).

- [ ] **Step 5: Commit**

```bash
git add src/engines/_shared/types.ts src/engines/_shared/types.test-d.ts
git commit -m "feat(engines): OptionsPanel + isReadyToConvert on engine descriptor

Optional fields on SingleInputEngine + MultiInputEngine for engines
that need options UI and a ready-to-convert gate. HEIC engine
omits both (still works via optional-property defaults). The
image-convert engine in Plan 2 will be the first user."
```

---

## Task 2: DropZone `disabled` prop

**Goal:** Add an optional `disabled?: boolean` prop. When true, all interaction events no-op and styling is muted.

**Files:**
- Modify: `src/components/drop-zone.tsx`
- Modify: `src/components/drop-zone.test.tsx`

- [ ] **Step 1: Update DropZone component to accept and respect `disabled`**

Replace the entire body of `src/components/drop-zone.tsx` with:

```tsx
"use client";

import { useCallback, useRef, useState } from "react";

type Props = {
  accept?: string[];
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  prompt?: string;
  hint?: string;
  disabled?: boolean;
};

export function DropZone({
  accept,
  multiple = false,
  onFiles,
  prompt = "drop a file",
  hint = "or click to browse",
  disabled = false,
}: Props) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (disabled) return;
      if (!files || files.length === 0) return;
      const arr = Array.from(files);
      onFiles(arr);
    },
    [onFiles, disabled],
  );

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept?.join(",")}
        multiple={multiple}
        onChange={(e) => handleFiles(e.target.files)}
        className="sr-only"
        disabled={disabled}
      />
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (disabled) return;
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          handleFiles(e.dataTransfer?.files ?? null);
        }}
        data-testid="drop-zone"
        data-state={disabled ? "disabled" : over ? "over" : "idle"}
        disabled={disabled}
        className={`flex w-full flex-col items-center justify-center border p-12 text-center transition-colors ${
          disabled
            ? "border-[var(--color-hairline)] bg-[var(--color-bg)] opacity-50"
            : over
              ? "border-[var(--color-accent)] bg-[var(--color-surface)]"
              : "border-[var(--color-hairline)] bg-[var(--color-surface)]"
        }`}
        style={{
          backgroundImage:
            !disabled && over
              ? "repeating-linear-gradient(45deg, #0d0d0d 0 6px, #0a0a0a 6px 12px)"
              : undefined,
        }}
      >
        <span className="mb-1 text-[var(--text-base)] text-[var(--color-fg-strong)]">{prompt}</span>
        <span className="text-[var(--text-xs)] text-[var(--color-fg-muted)]">{hint}</span>
      </button>
    </>
  );
}
```

Notes:
- `data-state="disabled"` is the new state value when disabled. Existing tests assert `"idle"` and `"over"`; those continue to work because disabled defaults to false.
- The `<button disabled>` attribute prevents click + keyboard activation natively.
- `<input disabled>` prevents change events.
- `onDragOver` still calls `preventDefault()` even when disabled — this prevents the browser opening dropped content in the tab. We just don't toggle `over` state.
- `onDrop` always calls `preventDefault()`; `handleFiles` is the gate — it returns early when disabled.

- [ ] **Step 2: Add tests for the disabled state**

In `src/components/drop-zone.test.tsx`, append after the existing `describe("DropZone")` block contents (inside the same `describe`):

```tsx
  it("renders muted state when disabled", () => {
    render(<DropZone onFiles={() => undefined} disabled />);
    expect(screen.getByTestId("drop-zone")).toHaveAttribute("data-state", "disabled");
  });

  it("does not call onFiles when a drop occurs while disabled", () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} disabled />);
    const file = new File(["x"], "a.heic", { type: "image/heic" });
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [file] },
    });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("does not toggle data-state to 'over' on dragover while disabled", () => {
    render(<DropZone onFiles={() => undefined} disabled />);
    const zone = screen.getByTestId("drop-zone");
    fireEvent.dragOver(zone);
    expect(zone).toHaveAttribute("data-state", "disabled");
  });
```

- [ ] **Step 3: Run all gates**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all exit 0; test count rises from 45 → 48 (3 new DropZone tests).

- [ ] **Step 4: Commit**

```bash
git add src/components/drop-zone.tsx src/components/drop-zone.test.tsx
git commit -m "feat(ui): DropZone disabled prop

When disabled, the button + hidden input both render with
disabled attribute, the data-state is 'disabled', styling is
muted (50% opacity), and onFiles is never called. onDragOver
still calls preventDefault to suppress the browser default."
```

---

## Task 3: image-convert engine — options module

**Goal:** Define the TS option types and defaults. No runtime logic yet.

**Files:**
- Create: `src/engines/image-convert/options.ts`

- [ ] **Step 1: Write `src/engines/image-convert/options.ts`**

```ts
export type ImageConvertOutputFormat = "png" | "jpeg" | "webp";

export type ImageConvertOptions = {
  output: ImageConvertOutputFormat | null;
  quality: number;
};

export const defaultImageConvertOptions: ImageConvertOptions = {
  output: null,
  quality: 0.9,
};

export const OUTPUT_MIME: Record<ImageConvertOutputFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const OUTPUT_EXTENSION: Record<ImageConvertOutputFormat, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
};
```

The constants live next to the option type for cohesion — the worker, engine descriptor, and OptionsPanel all import from here.

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/engines/image-convert/options.ts
git commit -m "feat(engines): image-convert options module

ImageConvertOptions, defaults, and the format → mime + extension
maps. The mime map matches OffscreenCanvas.convertToBlob's type
strings; the extension map maps JPEG → 'jpg' (more common in
practice than '.jpeg')."
```

---

## Task 4: image-convert engine — worker

**Goal:** Worker decodes input via `createImageBitmap` (with EXIF auto-rotate), encodes to chosen format via `OffscreenCanvas.convertToBlob`. Alpha-on-JPEG fills with white.

**Files:**
- Create: `src/engines/image-convert/worker.ts`

- [ ] **Step 1: Write `src/engines/image-convert/worker.ts`**

```ts
import * as Comlink from "comlink";
import type { OutputItem } from "@/engines/_shared/types";
import { OUTPUT_EXTENSION, OUTPUT_MIME } from "./options";
import type { ImageConvertOptions } from "./options";

function replaceExt(name: string, newExt: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}.${newExt}`;
  return `${name.slice(0, dot)}.${newExt}`;
}

const api = {
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    type: string,
    opts: ImageConvertOptions,
  ): Promise<OutputItem> {
    if (!opts.output) {
      throw new Error("image-convert: output format not specified");
    }

    const inputBlob = new Blob([bytes], { type });
    const bitmap = await createImageBitmap(inputBlob, {
      imageOrientation: "from-image",
    });

    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");

      // Alpha-on-JPEG: fill opaque white background before drawing.
      if (opts.output === "jpeg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, bitmap.width, bitmap.height);
      }
      ctx.drawImage(bitmap, 0, 0);

      const outputType = OUTPUT_MIME[opts.output];
      const blob =
        opts.output === "png"
          ? await canvas.convertToBlob({ type: outputType })
          : await canvas.convertToBlob({ type: outputType, quality: opts.quality });

      return {
        filename: replaceExt(name, OUTPUT_EXTENSION[opts.output]),
        mime: outputType,
        blob,
      };
    } finally {
      bitmap.close();
    }
  },
};

Comlink.expose(api);
```

Notes:
- `imageOrientation: "from-image"` makes `createImageBitmap` apply EXIF orientation to pixels. Bitmap then has no metadata.
- `bitmap.close()` releases the underlying memory in `finally` — important for large images.
- PNG branch omits `quality` from `convertToBlob` (PNG is lossless; some browsers warn or error if quality is passed).
- The `replaceExt` helper is local rather than importing `_shared/filename.ts`'s `replaceExtension` because the worker bundle should be lean — the shared filename utility will get pulled into the worker bundle via dynamic import otherwise. Local 4-line helper is the same logic.

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 3: Worker build coverage deferred to Task 6**

Do **NOT** add `import "@/engines/image-convert/worker"` to `page.tsx` to probe the worker. Importing the worker file directly into the page module graph forces `Comlink.expose(api)` to run during Next.js SSR prerender, where `self.addEventListener` is unavailable, and the build fails spuriously with `TypeError: b.addEventListener is not a function`. Task 6 lands the engine descriptor (`src/engines/image-convert/index.ts`) which spawns the worker lazily via `new Worker(new URL("./worker.ts", import.meta.url))`. Task 6's verify step probes the engine module — same pattern as Plan 1 Task 9 Step 8b — which is the correct integration test under static export.

- [ ] **Step 4: Commit**

```bash
git add src/engines/image-convert/worker.ts
git commit -m "feat(engines): image-convert worker

createImageBitmap with imageOrientation: 'from-image' for EXIF
auto-rotate, OffscreenCanvas.convertToBlob for encode. Alpha-
on-JPEG handled by filling the canvas with #fff before drawImage.
PNG branch omits quality (lossless format). Bitmap.close() in
finally to release memory on large images."
```

---

## Task 5: image-convert engine — OptionsPanel

**Goal:** Small client component renders format `<select>` and (conditionally) quality `<input type="range">`.

**Files:**
- Create: `src/engines/image-convert/options-panel.tsx`
- Create: `src/engines/image-convert/options-panel.test.tsx`

- [ ] **Step 1: Write `src/engines/image-convert/options-panel.tsx`**

```tsx
"use client";

import type { OptionsPanelProps } from "@/engines/_shared/types";
import type { ImageConvertOptions, ImageConvertOutputFormat } from "./options";

const FORMATS: ImageConvertOutputFormat[] = ["png", "jpeg", "webp"];

export function ImageConvertOptionsPanel({
  value,
  onChange,
}: OptionsPanelProps<ImageConvertOptions>) {
  const showQuality = value.output !== null && value.output !== "png";

  return (
    <div
      data-testid="image-convert-options"
      className="mb-3 flex flex-wrap items-center gap-4 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        output:
        <select
          data-testid="output-format"
          value={value.output ?? ""}
          onChange={(e) => {
            const next = e.target.value as ImageConvertOutputFormat | "";
            onChange({ ...value, output: next === "" ? null : next });
          }}
          className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase"
        >
          <option value="">— select format —</option>
          {FORMATS.map((f) => (
            <option key={f} value={f}>
              {f.toUpperCase()}
            </option>
          ))}
        </select>
      </label>

      {showQuality && (
        <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
          quality:
          <input
            data-testid="quality-slider"
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={value.quality}
            onChange={(e) => onChange({ ...value, quality: Number.parseFloat(e.target.value) })}
            className="w-32"
          />
          <span data-testid="quality-value" className="tabular-nums text-[var(--color-fg-strong)]">
            {value.quality.toFixed(2)}
          </span>
        </label>
      )}
    </div>
  );
}
```

Notes:
- The `<select>` placeholder option (value `""`) maps to `output: null`. Once user picks a real format, `output` becomes the format string.
- `showQuality` hides the slider when format is unselected OR PNG.
- `Number.parseFloat` on the range value (range inputs return strings).
- `tabular-nums` on the quality readout prevents the digits jittering as the user drags the slider.

- [ ] **Step 2: Write `src/engines/image-convert/options-panel.test.tsx`**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultImageConvertOptions } from "./options";
import { ImageConvertOptionsPanel } from "./options-panel";

describe("ImageConvertOptionsPanel", () => {
  it("renders the placeholder option in the select", () => {
    render(
      <ImageConvertOptionsPanel value={defaultImageConvertOptions} onChange={() => undefined} />,
    );
    expect(screen.getByTestId("output-format")).toHaveValue("");
  });

  it("hides the quality slider when no output format is selected", () => {
    render(
      <ImageConvertOptionsPanel value={defaultImageConvertOptions} onChange={() => undefined} />,
    );
    expect(screen.queryByTestId("quality-slider")).toBeNull();
  });

  it("hides the quality slider when output format is PNG", () => {
    render(
      <ImageConvertOptionsPanel
        value={{ output: "png", quality: 0.9 }}
        onChange={() => undefined}
      />,
    );
    expect(screen.queryByTestId("quality-slider")).toBeNull();
  });

  it("shows the quality slider when output format is JPEG", () => {
    render(
      <ImageConvertOptionsPanel
        value={{ output: "jpeg", quality: 0.9 }}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByTestId("quality-slider")).toBeInTheDocument();
    expect(screen.getByTestId("quality-value")).toHaveTextContent("0.90");
  });

  it("calls onChange with the new output format when select changes", () => {
    const onChange = vi.fn();
    render(
      <ImageConvertOptionsPanel value={defaultImageConvertOptions} onChange={onChange} />,
    );
    fireEvent.change(screen.getByTestId("output-format"), { target: { value: "jpeg" } });
    expect(onChange).toHaveBeenCalledWith({ output: "jpeg", quality: 0.9 });
  });

  it("calls onChange with the new quality when slider changes", () => {
    const onChange = vi.fn();
    render(
      <ImageConvertOptionsPanel
        value={{ output: "jpeg", quality: 0.9 }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("quality-slider"), { target: { value: "0.5" } });
    expect(onChange).toHaveBeenCalledWith({ output: "jpeg", quality: 0.5 });
  });

  it("clears output format back to null when the placeholder is re-selected", () => {
    const onChange = vi.fn();
    render(
      <ImageConvertOptionsPanel
        value={{ output: "jpeg", quality: 0.9 }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("output-format"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({ output: null, quality: 0.9 });
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm test src/engines/image-convert/options-panel.test.tsx
```

Expected: 7 tests pass.

- [ ] **Step 4: Run all gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all exit 0; total now 55 unit tests (48 + 7).

- [ ] **Step 5: Commit**

```bash
git add src/engines/image-convert/options-panel.tsx src/engines/image-convert/options-panel.test.tsx
git commit -m "feat(engines): image-convert OptionsPanel

Format select + quality slider. Placeholder option maps to
output:null (the unset state). Quality slider hides when output
is null or PNG (lossless). Tests cover the seven branches:
placeholder default, slider hidden on null/PNG, slider visible
on JPEG, format change, quality change, format-clear-to-null."
```

---

## Task 6: image-convert engine — descriptor + registry

**Goal:** Wire the engine descriptor (validate, convert, isReadyToConvert, OptionsPanel). Register in the engine registry. Add metadata + validation tests.

**Files:**
- Create: `src/engines/image-convert/index.ts`
- Create: `src/engines/image-convert/index.test.ts`
- Modify: `src/engines/_shared/registry.ts`
- Modify: `src/engines/_shared/registry.test.ts`

- [ ] **Step 1: Write `src/engines/image-convert/index.ts`**

```ts
import { detectMime } from "@/engines/_shared/file-detection";
import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { defaultImageConvertOptions, type ImageConvertOptions } from "./options";
import { ImageConvertOptionsPanel } from "./options-panel";

const SUPPORTED_INPUT_MIMES = ["image/png", "image/jpeg", "image/webp"];

const engine: SingleInputEngine<ImageConvertOptions, OutputItem> = {
  id: "image-convert",
  inputAccept: [".png", ".jpg", ".jpeg", ".webp"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "image/png",
  defaultOptions: defaultImageConvertOptions,
  cardinality: "single",
  isReadyToConvert: (opts) => opts.output !== null,
  OptionsPanel: ImageConvertOptionsPanel,
  validate(file) {
    return SUPPORTED_INPUT_MIMES.includes(file.type)
      ? { ok: true }
      : { ok: false, reason: "Expected a PNG, JPEG, or WebP file" };
  },
  async convert(file, opts, signal) {
    const detected = await detectMime(file);
    if (!SUPPORTED_INPUT_MIMES.includes(detected)) {
      throw new Error(`Unsupported input MIME: ${detected}`);
    }
    if (!opts.output) {
      throw new Error("image-convert: output format not specified");
    }
    const harness = new WorkerHarness<ImageConvertOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    );
    const result = await harness.runSingle(file, opts, signal);
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

Notes:
- `outputMime` defaults to `image/png` for the metadata field, but the actual output mime is dynamic based on `opts.output`. The metadata is informational; the OutputItem.mime is what's authoritative.
- `validate` uses `file.type` for fast synchronous checks; `convert` runs the deeper magic-byte detection via `detectMime` before spawning the worker. This catches user-renamed files.
- The worker spawn pattern mirrors `heic-to-png/index.ts` exactly.

- [ ] **Step 2: Write `src/engines/image-convert/index.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import engine from "./index";

describe("image-convert engine metadata", () => {
  it("declares correct id, accept lists, and cardinality", () => {
    expect(engine.id).toBe("image-convert");
    expect(engine.inputAccept).toEqual([".png", ".jpg", ".jpeg", ".webp"]);
    expect(engine.inputMime).toEqual(["image/png", "image/jpeg", "image/webp"]);
    expect(engine.cardinality).toBe("single");
  });

  it("declares an OptionsPanel component", () => {
    expect(engine.OptionsPanel).toBeDefined();
  });

  it("isReadyToConvert returns false when output is null", () => {
    expect(engine.isReadyToConvert?.({ output: null, quality: 0.9 })).toBe(false);
  });

  it("isReadyToConvert returns true when output is set", () => {
    expect(engine.isReadyToConvert?.({ output: "jpeg", quality: 0.9 })).toBe(true);
  });

  it("validates PNG / JPEG / WebP files by their type", () => {
    const png = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    const jpg = new File([new Uint8Array([1])], "b.jpg", { type: "image/jpeg" });
    const webp = new File([new Uint8Array([1])], "c.webp", { type: "image/webp" });
    const opts = { output: null, quality: 0.9 };
    expect(engine.validate(png, opts)).toEqual({ ok: true });
    expect(engine.validate(jpg, opts)).toEqual({ ok: true });
    expect(engine.validate(webp, opts)).toEqual({ ok: true });
  });

  it("rejects non-image files", () => {
    const f = new File([new Uint8Array([1])], "x.txt", { type: "text/plain" });
    const r = engine.validate(f, { output: null, quality: 0.9 });
    expect(r.ok).toBe(false);
  });
});
```

(Functional pixel-level conversion is verified end-to-end in Task 10's Playwright spec, since `createImageBitmap` requires a real worker which jsdom does not provide.)

- [ ] **Step 3: Update `src/engines/_shared/registry.ts`**

```ts
import type { ConversionEngine } from "./types";

export type EngineId = "heic-to-png" | "image-convert";

type Loader = () => Promise<{ default: ConversionEngine }>;

const REGISTRY: Record<EngineId, Loader> = {
  "heic-to-png": () => import("@/engines/heic-to-png"),
  "image-convert": () => import("@/engines/image-convert"),
};

export async function loadEngine(id: EngineId): Promise<ConversionEngine> {
  const loader = REGISTRY[id];
  if (!loader) throw new Error(`Unknown engine id: ${id}`);
  const mod = await loader();
  return mod.default;
}

export function listEngineIds(): EngineId[] {
  return Object.keys(REGISTRY) as EngineId[];
}
```

- [ ] **Step 4: Append a positive-path test in `src/engines/_shared/registry.test.ts`**

After the existing `loadEngine` test for HEIC, append:

```ts
it("loadEngine returns the image-convert engine module", async () => {
  const e = await loadEngine("image-convert");
  expect(e.id).toBe("image-convert");
  expect(e.cardinality).toBe("single");
});
```

Also update the existing test that asserts `listEngineIds` length / contents — verify both engines are listed.

If the existing test reads `expect(listEngineIds()).toEqual(["heic-to-png"])`, change to:

```ts
expect(listEngineIds()).toEqual(["heic-to-png", "image-convert"]);
```

(Read the current registry test file to see what's actually there before editing.)

- [ ] **Step 5: Run all gates**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all exit 0; total 61 unit tests (55 + 6 from index.test.ts).

- [ ] **Step 5b: Engine-module build probe (was deferred from Task 4 Step 3)**

Until Task 7 wires the engine into ToolFrame and Task 8 adds the route, nothing imports `@/engines/image-convert` into a page bundle, so the worker chunk isn't emitted by the regular build. Force a build that pulls the engine module into the page graph to verify Webpack resolves the worker via `new Worker(new URL("./worker.ts", import.meta.url))` correctly.

Add a temporary import to `src/app/page.tsx` (line 1, BEFORE any other imports):

```ts
import "@/engines/image-convert";
```

Run `pnpm build`. Expected: exit 0; build emits a new `image-convert` worker chunk alongside the existing HEIC chunk. (Importing the engine module — not the worker file — is the correct probe pattern; it mirrors Plan 1 Task 9 Step 8b. Importing `worker.ts` directly triggers SSR-time Comlink.expose failure.)

If the build fails on `Module not found: Can't resolve 'fs'` or similar, the worker has pulled in a Node-only path — investigate.

After the build succeeds:

```bash
git checkout -- src/app/page.tsx
```

Confirm `git status` is clean.

- [ ] **Step 6: Commit**

```bash
git add src/engines/image-convert/index.ts src/engines/image-convert/index.test.ts src/engines/_shared/registry.ts src/engines/_shared/registry.test.ts
git commit -m "feat(engines): image-convert descriptor + registry entry

Engine descriptor wires options, OptionsPanel, isReadyToConvert,
validate (file.type fast path), convert (detectMime deep check
+ worker spawn). Registry accepts the new id; loadEngine
positive-path test covers the dynamic import."
```

---

## Task 7: ToolFrame extension + unit test

**Goal:** ToolFrame mounts engine.OptionsPanel, manages options state, gates DropZone via `isReadyToConvert`, holds the cross-route handoff file in `pendingFile` until ready. Add a `tool-frame.test.tsx` covering the validation-error and ready-gate branches that E2E doesn't reach cleanly.

**Files:**
- Modify: `src/components/tool-frame.tsx`
- Create: `src/components/tool-frame.test.tsx`

- [ ] **Step 1: Replace `src/components/tool-frame.tsx`**

```tsx
"use client";

import type { ConversionEngine, OutputItem } from "@/engines/_shared/types";
import { takeStagedFile } from "@/lib/handoff";
import { useCallback, useEffect, useRef, useState } from "react";
import { DropZone } from "./drop-zone";
import { ResultList } from "./result-list";
import { type Status, StatusIndicator } from "./status-indicator";

type Props<TOptions> = {
  engine: ConversionEngine<TOptions, OutputItem | OutputItem[]>;
};

export function ToolFrame<TOptions>({ engine }: Props<TOptions>) {
  const [status, setStatus] = useState<Status>("ready");
  const [items, setItems] = useState<OutputItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [options, setOptions] = useState<TOptions>(engine.defaultOptions);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const ready = engine.isReadyToConvert?.(options) ?? true;
  const Panel = engine.OptionsPanel;

  const run = useCallback(
    async (files: File[], opts: TOptions) => {
      setErrorMessage(null);
      setItems([]);
      if (engine.cardinality === "single") {
        const f = files[0];
        if (!f) return;
        const v = engine.validate(f, opts);
        if (!v.ok) {
          setErrorMessage(v.reason);
          setStatus("error");
          return;
        }
        setStatus("converting");
        try {
          const ctrl = new AbortController();
          const result = await engine.convert(f, opts, ctrl.signal);
          const out = Array.isArray(result) ? result : [result];
          setItems(out);
          setStatus("done");
        } catch (err) {
          setErrorMessage(err instanceof Error ? err.message : String(err));
          setStatus("error");
        }
        return;
      }

      const v = engine.validate(files, opts);
      if (!v.ok) {
        setErrorMessage(v.reason);
        setStatus("error");
        return;
      }
      setStatus("converting");
      try {
        const ctrl = new AbortController();
        const result = await engine.convert(files, opts, ctrl.signal);
        setItems(Array.isArray(result) ? result : [result]);
        setStatus("done");
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    },
    [engine],
  );

  // Mount-time staged-file consumption. Single-shot: takeStagedFile clears
  // the slot, so React Strict Mode's double-mount fires this once net.
  const consumedRef = useRef(false);
  useEffect(() => {
    if (consumedRef.current) return;
    consumedRef.current = true;
    const staged = takeStagedFile();
    if (staged) setPendingFile(staged);
  }, []);

  // Fires conversion when both file and ready state materialize. If options
  // start out ready (HEIC), this runs as soon as pendingFile is set. If not
  // (image-convert with output unselected), waits until user picks a format.
  useEffect(() => {
    if (pendingFile && ready) {
      run([pendingFile], options);
      setPendingFile(null);
    }
  }, [pendingFile, ready, run, options]);

  return (
    <main className="p-6">
      <div className="mb-3 flex items-center gap-3 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        <span>tool: {engine.id}</span>
        <span>·</span>
        <StatusIndicator status={status} />
      </div>
      {Panel && <Panel value={options} onChange={setOptions} />}
      <DropZone
        accept={engine.inputAccept}
        multiple={engine.cardinality === "multi"}
        onFiles={(files) => run(files, options)}
        disabled={!ready}
      />
      {errorMessage && (
        <div className="mt-3 border border-[var(--color-accent)] p-3 text-[var(--text-sm)] text-[var(--color-fg-strong)]">
          {errorMessage}
        </div>
      )}
      <ResultList items={items} />
    </main>
  );
}
```

Notes:
- `consumedRef` guards against React Strict Mode double-mount: even though `takeStagedFile()` is idempotent, the ref ensures the effect body runs exactly once per real mount. (`takeStagedFile()` would return null on a second call anyway, but the ref makes intent explicit.)
- The `[pendingFile, ready, run, options]` dep array on the second effect is correct: when options changes, `ready` may flip from false → true (e.g., user picks a format), triggering the effect to fire conversion against the held file.
- `run` is wrapped in `useCallback([engine])` for dep-array stability.

- [ ] **Step 2: Write `src/components/tool-frame.test.tsx`**

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversionEngine, OutputItem, ValidationResult } from "@/engines/_shared/types";
import { ToolFrame } from "./tool-frame";
import { stageFile, takeStagedFile } from "@/lib/handoff";

afterEach(() => {
  takeStagedFile();
  vi.restoreAllMocks();
});

type StubOpts = { ready: boolean };

function makeStubEngine(overrides: Partial<ConversionEngine<StubOpts, OutputItem>> = {}): ConversionEngine<StubOpts, OutputItem> {
  return {
    id: "stub",
    inputAccept: [".bin"],
    inputMime: ["application/octet-stream"],
    outputMime: "application/octet-stream",
    defaultOptions: { ready: true },
    cardinality: "single",
    validate: (): ValidationResult => ({ ok: true }),
    convert: vi.fn(async () => ({
      filename: "out.bin",
      mime: "application/octet-stream",
      blob: new Blob(["x"]),
    })),
    ...overrides,
  } as ConversionEngine<StubOpts, OutputItem>;
}

describe("ToolFrame", () => {
  it("renders the engine id and READY status on mount with no staged file", () => {
    const engine = makeStubEngine();
    render(<ToolFrame engine={engine} />);
    expect(screen.getByText(/tool: stub/)).toBeInTheDocument();
    expect(screen.getByTestId("status-indicator")).toHaveTextContent("[ READY ]");
  });

  it("disables the DropZone when isReadyToConvert returns false", () => {
    const engine = makeStubEngine({
      isReadyToConvert: () => false,
    });
    render(<ToolFrame engine={engine} />);
    expect(screen.getByTestId("drop-zone")).toHaveAttribute("data-state", "disabled");
  });

  it("enables the DropZone when isReadyToConvert returns true (or is undefined)", () => {
    const engine = makeStubEngine();
    render(<ToolFrame engine={engine} />);
    expect(screen.getByTestId("drop-zone")).not.toHaveAttribute("data-state", "disabled");
  });

  it("surfaces validate failure as an error message and ERROR status", async () => {
    const engine = makeStubEngine({
      validate: () => ({ ok: false, reason: "no good" }),
    });
    render(<ToolFrame engine={engine} />);
    const file = new File(["x"], "x.bin", { type: "application/octet-stream" });
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [file] },
    });
    await waitFor(() => {
      expect(screen.getByText("no good")).toBeInTheDocument();
    });
    expect(screen.getByTestId("status-indicator")).toHaveTextContent("[ ERROR ]");
  });

  it("renders the OptionsPanel when the engine declares one", () => {
    const Panel = ({ value }: { value: StubOpts; onChange: (n: StubOpts) => void }) => (
      <div data-testid="stub-panel">ready={String(value.ready)}</div>
    );
    const engine = makeStubEngine({ OptionsPanel: Panel });
    render(<ToolFrame engine={engine} />);
    expect(screen.getByTestId("stub-panel")).toBeInTheDocument();
  });

  it("holds a staged file until isReadyToConvert flips to true, then runs conversion", async () => {
    const Panel = ({ value, onChange }: { value: StubOpts; onChange: (n: StubOpts) => void }) => (
      <button
        type="button"
        data-testid="ready-button"
        onClick={() => onChange({ ready: true })}
      >
        ready={String(value.ready)}
      </button>
    );
    const convert = vi.fn(async () => ({
      filename: "out.bin",
      mime: "application/octet-stream",
      blob: new Blob(["x"]),
    }));
    const engine = makeStubEngine({
      defaultOptions: { ready: false },
      isReadyToConvert: (opts) => opts.ready === true,
      OptionsPanel: Panel,
      convert,
    });

    const staged = new File(["x"], "in.bin", { type: "application/octet-stream" });
    stageFile(staged);

    render(<ToolFrame engine={engine} />);

    expect(convert).not.toHaveBeenCalled();
    expect(screen.getByTestId("drop-zone")).toHaveAttribute("data-state", "disabled");

    fireEvent.click(screen.getByTestId("ready-button"));

    await waitFor(() => {
      expect(convert).toHaveBeenCalledOnce();
    });
    expect(convert).toHaveBeenCalledWith(staged, expect.anything(), expect.anything());
  });
});
```

- [ ] **Step 3: Verify the existing HEIC E2E still passes (regression check)**

```bash
pnpm test:e2e --project=chromium --workers=1 tests/e2e/heic-to-png.spec.ts tests/e2e/homepage-handoff.spec.ts
```

`--workers=1` is required: with the default parallel workers, libheif-js's WASM-bundle compile in the dev server can race two simultaneous Playwright workers and produce a `Cannot read properties of undefined (reading 'split')` error in libheif's environment-detection on cold start. The race is unrelated to ToolFrame's logic — confirmed by stash-revert showing the error pre-dates this task. Sequential workers eliminate the race.

Expected: both pass. ToolFrame's signature change (`run` now takes options) is a generic type — HEIC's options are `{}`, no behavior change.

- [ ] **Step 4: Run all unit gates**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all exit 0; total 67 unit tests (61 + 6 from tool-frame.test.tsx).

- [ ] **Step 5: Commit**

```bash
git add src/components/tool-frame.tsx src/components/tool-frame.test.tsx
git commit -m "feat(ui): ToolFrame options panel slot + ready gate

Mounts engine.OptionsPanel above the DropZone (no slot for engines
without options). Holds options state via useState, passes to
run() as second arg (signature change). Computes ready via
engine.isReadyToConvert; gates DropZone disabled accordingly.

Cross-route handoff extension: pendingFile state holds the staged
file across mount until ready becomes true, then fires conversion
once. Single-shot via consumedRef + takeStagedFile clearing.

ToolFrame unit tests cover the validate-error path, the ready
gate, and the held-then-fired handoff branch — paths Playwright
doesn't exercise cleanly."
```

---

## Task 8: Sidebar + homepage routing

**Goal:** Sidebar gains an `image convert` entry. Homepage's MIME-detect routing recognizes PNG/JPEG/WebP and routes to `/tools/image-convert`.

**Files:**
- Create: `src/app/tools/image-convert/page.tsx`
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Write `src/app/tools/image-convert/page.tsx`**

```tsx
"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/image-convert";

export default function ImageConvertPage() {
  return <ToolFrame engine={engine} />;
}
```

The `"use client"` directive is necessary because the engine descriptor contains function values (`validate`, `convert`) that can't cross the RSC boundary — same constraint as `/tools/heic-to-png` (Plan 1 documented this).

- [ ] **Step 2: Add the sidebar entry in `src/components/layout/sidebar.tsx`**

In the existing `TOOLS` array, append the new entry:

```ts
const TOOLS: ToolEntry[] = [
  { id: "heic-to-png", href: "/tools/heic-to-png", label: "heic→png", group: "IMAGES" },
  { id: "image-convert", href: "/tools/image-convert", label: "image convert", group: "IMAGES" },
];
```

No other changes — the sidebar grouping logic already handles multiple entries per group.

- [ ] **Step 3: Extend homepage MIME routing in `src/app/page.tsx`**

Inside `handleFiles`, after the existing HEIC branch, add:

```ts
if (mime === "image/png" || mime === "image/jpeg" || mime === "image/webp") {
  stageFile(f);
  router.push("/tools/image-convert");
  return;
}
```

Update the error-banner copy to reflect expanded support:

```ts
setError("No tool for this file type yet. Phase 2 supports HEIC, PNG, JPEG, WebP.");
```

The full updated `handleFiles`:

```ts
async function handleFiles(files: File[]) {
  setError(null);
  const f = files[0];
  if (!f) return;
  const mime = await detectMime(f);
  if (mime === "image/heic" || mime === "image/heif") {
    stageFile(f);
    router.push("/tools/heic-to-png");
    return;
  }
  if (mime === "image/png" || mime === "image/jpeg" || mime === "image/webp") {
    stageFile(f);
    router.push("/tools/image-convert");
    return;
  }
  setError("No tool for this file type yet. Phase 2 supports HEIC, PNG, JPEG, WebP.");
}
```

- [ ] **Step 4: Run all unit gates + build**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all exit 0; build emits `/tools/image-convert` as a new static route alongside the existing `/tools/heic-to-png`. Build output should list 5 routes total: `/`, `/_not-found`, `/test-only/stub-runner`, `/tools/heic-to-png`, `/tools/image-convert`.

- [ ] **Step 5: Visual sanity check via curl**

Start `pnpm dev` in the background. Then:

```bash
curl -sS http://localhost:3000/tools/image-convert | grep -o "tool:.\{0,40\}"
curl -sS http://localhost:3000/ | grep -o "image convert"
```

Expected: first curl returns text including `tool:` and `image-convert`; second returns `image convert` (the sidebar label visible on the homepage too via the layout shell). Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/app/tools/image-convert src/components/layout/sidebar.tsx src/app/page.tsx
git commit -m "feat(ui): image-convert route + sidebar + homepage routing

Mounts ToolFrame with the image-convert engine at
/tools/image-convert. Sidebar gains the image-convert entry under
IMAGES. Homepage MIME-detect routes PNG/JPEG/WebP drops to the
new route via the existing stageFile/router.push handoff."
```

---

## Task 9: Test fixtures

**Goal:** Commit small (~50 KB each) PNG / JPEG / WebP fixtures to `tests/fixtures/`. Includes one transparent-PNG fixture (alpha-on-JPEG path) and one EXIF-rotated JPEG fixture (auto-rotate path).

**Files:**
- Create: `tests/fixtures/sample.png`
- Create: `tests/fixtures/sample-alpha.png`
- Create: `tests/fixtures/sample.jpg`
- Create: `tests/fixtures/sample-rotated.jpg`
- Create: `tests/fixtures/sample.webp`

- [ ] **Step 1: Manual fixture acquisition**

> **⚠️ MANUAL STEP — pause for user.** An autonomous agent cannot generate or capture image fixtures reliably. Surface the following to the user and stop:
>
> > Phase 2 needs five fixture files in `tests/fixtures/`:
> >
> > 1. **`sample.png`** — opaque, ≤ 50 KB, mid-complexity (some color variation; not a flat block). 200×200 px is fine.
> > 2. **`sample-alpha.png`** — has a transparent region, ≤ 50 KB. Used to verify alpha-on-JPEG fill works (transparent area should land on white in the JPEG output).
> > 3. **`sample.jpg`** — opaque, ≤ 50 KB. Any photographic content.
> > 4. **`sample-rotated.jpg`** — JPEG with EXIF orientation tag set to a non-1 value (typically 6, "rotate 90 CW"). The actual stored pixels are e.g. 300×200 (landscape) but should display as 200×300 (portrait) after auto-rotate. ≤ 50 KB. Used to verify `imageOrientation: "from-image"` works.
> > 5. **`sample.webp`** — opaque, ≤ 50 KB. Any photographic content.
> >
> > Acquisition options:
> > - macOS Preview can resize/export PNG/JPEG; ImageMagick (`convert -resize 200x200 input.jpg out.jpg`) handles size.
> > - For the EXIF-rotated fixture: `exiftool -Orientation=6 -n sample-rotated.jpg` (after copying a portrait-shaped JPEG that's been physically rotated to landscape).
> > - For WebP: `cwebp -q 80 input.png -o sample.webp`.
> >
> > After placing files, verify with:
> > ```bash
> > file tests/fixtures/sample.png
> > file tests/fixtures/sample-alpha.png
> > file tests/fixtures/sample.jpg
> > file tests/fixtures/sample-rotated.jpg
> > file tests/fixtures/sample.webp
> > exiftool -Orientation tests/fixtures/sample-rotated.jpg
> > ```
> > Expected: `file` reports correct format for each. `exiftool` shows `Orientation: Rotate 90 CW` (or similar non-`Horizontal (normal)`).
> >
> > Tell me when ready and I'll resume from Step 2.

After the user confirms fixtures are in place:

- [ ] **Step 2: Confirm fixture sanity**

```bash
ls -la tests/fixtures/sample*.{png,jpg,webp}
file tests/fixtures/sample.png
file tests/fixtures/sample-alpha.png
file tests/fixtures/sample.jpg
file tests/fixtures/sample-rotated.jpg
file tests/fixtures/sample.webp
```

Expected: all five files exist, `file` reports the right format for each, all under 50 KB.

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/sample.png tests/fixtures/sample-alpha.png tests/fixtures/sample.jpg tests/fixtures/sample-rotated.jpg tests/fixtures/sample.webp
git commit -m "test: add PNG/JPEG/WebP fixtures for image-convert E2E

Five fixtures under tests/fixtures/: opaque sample of each format,
plus a transparent PNG (covers alpha-on-JPEG fill) and an EXIF-
rotated JPEG (covers imageOrientation auto-rotate). All under
50 KB each."
```

---

## Task 10: E2E suite — happy path + privacy regression + handoff extension

**Goal:** Three Playwright specs cover the happy path, privacy regression, and the cross-route handoff with the held-file branch.

**Files:**
- Create: `tests/e2e/image-convert.spec.ts`
- Create: `tests/e2e/privacy-regression-image-convert.spec.ts`
- Modify: `tests/e2e/homepage-handoff.spec.ts`

- [ ] **Step 1: Write `tests/e2e/image-convert.spec.ts`**

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("JPEG → PNG produces a valid PNG download", async ({ page }) => {
  await page.goto("/tools/image-convert");

  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  // DropZone is disabled until output format is picked.
  await expect(page.getByTestId("drop-zone")).toHaveAttribute("data-state", "disabled");

  // Pick PNG output.
  await page.getByTestId("output-format").selectOption("png");

  await expect(page.getByTestId("drop-zone")).not.toHaveAttribute("data-state", "disabled");

  const input = page.locator('input[type="file"]');
  const fixture = path.resolve(__dirname, "../fixtures/sample.jpg");
  await input.setInputFiles(fixture);

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });

  const downloadButton = page.getByRole("button", { name: /^download / });
  await expect(downloadButton).toBeVisible();

  const downloadPromise = page.waitForEvent("download", { timeout: 5_000 });
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/i);
  const dlPath = await download.path();
  const bytes = await readFile(dlPath);
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  expect(bytes.length).toBeGreaterThan(100);
});

test("EXIF-rotated JPEG output preserves visual orientation", async ({ page }) => {
  await page.goto("/tools/image-convert");
  await page.getByTestId("output-format").selectOption("jpeg");

  const input = page.locator('input[type="file"]');
  const fixture = path.resolve(__dirname, "../fixtures/sample-rotated.jpg");
  await input.setInputFiles(fixture);

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });

  const downloadPromise = page.waitForEvent("download", { timeout: 5_000 });
  await page.getByRole("button", { name: /^download / }).click();
  const download = await downloadPromise;
  const dlPath = await download.path();
  const bytes = await readFile(dlPath);

  // Decode the output in-browser via createImageBitmap and check dimensions
  // match the visual orientation (post-rotation), not the stored bytes.
  const dims = await page.evaluate(async (b64: string) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: "image/jpeg" });
    const bmp = await createImageBitmap(blob);
    const dims = { width: bmp.width, height: bmp.height };
    bmp.close();
    return dims;
  }, bytes.toString("base64"));

  // Expected: portrait orientation (width < height) since the source had
  // EXIF orientation=6 indicating rotate-90-CW. Adjust expected if the
  // fixture's actual storage orientation differs.
  expect(dims.width).toBeLessThan(dims.height);
});
```

Notes on the rotation test:
- The dimension assertion (`width < height`) assumes the fixture is a portrait image stored as landscape with orientation=6. If the fixture is shaped differently, swap the inequality. Document the expected post-rotation aspect ratio when committing the fixture.

- [ ] **Step 2: Write `tests/e2e/privacy-regression-image-convert.spec.ts`**

```ts
import path from "node:path";
import { expect, test } from "@playwright/test";

test("JPEG → PNG conversion produces zero outbound network requests beyond initial load", async ({
  page,
}) => {
  const PAGE_PATH = "/tools/image-convert";

  const loadRequests: string[] = [];
  page.on("request", (req) => {
    loadRequests.push(req.url());
  });
  await page.goto(PAGE_PATH, { waitUntil: "networkidle" });

  page.removeAllListeners("request");
  const conversionRequests: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.origin !== new URL(page.url()).origin) {
      conversionRequests.push(req.url());
    }
  });
  const conversionWebSockets: string[] = [];
  page.on("websocket", (ws) => {
    if (new URL(ws.url()).host !== new URL(page.url()).host) {
      conversionWebSockets.push(ws.url());
    }
  });

  await page.getByTestId("output-format").selectOption("png");
  const input = page.locator('input[type="file"]');
  const fixture = path.resolve(__dirname, "../fixtures/sample.jpg");
  await input.setInputFiles(fixture);
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");

  expect(
    conversionRequests,
    `Image-convert made off-origin requests: ${conversionRequests.join(", ")}`,
  ).toEqual([]);
  expect(
    conversionWebSockets,
    `Image-convert opened off-origin WebSockets: ${conversionWebSockets.join(", ")}`,
  ).toEqual([]);
});
```

The host-comparison fix from PR #2 is preserved.

- [ ] **Step 3: Extend `tests/e2e/homepage-handoff.spec.ts`**

Append a second `test` block to the existing file, after the HEIC test:

```ts
test("homepage JPEG drop hands off to image-convert; conversion fires after format selection", async ({
  page,
}) => {
  await page.goto("/");

  const input = page.locator('input[type="file"]');
  const fixture = path.resolve(__dirname, "../fixtures/sample.jpg");
  await input.setInputFiles(fixture);

  // Cross-route handoff to image-convert.
  await page.waitForURL("**/tools/image-convert");

  // ToolFrame holds the file in pendingFile state because no output format
  // is selected. Conversion has NOT fired yet.
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");
  await expect(page.getByTestId("drop-zone")).toHaveAttribute("data-state", "disabled");

  // User selects PNG. The pending-file effect re-runs and fires conversion.
  await page.getByTestId("output-format").selectOption("png");

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: /^download / })).toBeVisible();
});
```

This test exercises the most subtle code path in this plan: the `useEffect([pendingFile, ready, run, options])` watcher.

- [ ] **Step 4: Run the new E2E specs**

```bash
pnpm test:e2e --project=chromium tests/e2e/image-convert.spec.ts tests/e2e/privacy-regression-image-convert.spec.ts tests/e2e/homepage-handoff.spec.ts
```

Expected: all four tests pass (1 from image-convert.spec.ts excluding the rotated test counted yet — actually 2; 1 from privacy-regression-image-convert; 2 from homepage-handoff including the existing HEIC test). Total 5 tests, all green.

If the rotated-orientation test fails because the expected aspect ratio doesn't match the fixture: read the fixture's `exiftool -Orientation` output and adjust the test's expected inequality. The fixture documentation in Task 9 should match.

- [ ] **Step 5: Run the full E2E suite to verify no regression**

```bash
pnpm test:e2e --project=chromium
```

Expected: all specs pass. Total spec count rises from 4 → 6 (adding image-convert.spec.ts and privacy-regression-image-convert.spec.ts; homepage-handoff.spec.ts contains one new test but is the same file).

- [ ] **Step 6: Run the full unit suite for final regression check**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all exit 0; total 67 unit tests.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/image-convert.spec.ts tests/e2e/privacy-regression-image-convert.spec.ts tests/e2e/homepage-handoff.spec.ts
git commit -m "test(e2e): image-convert happy path + privacy + handoff

Three new browser-driven specs.

image-convert.spec.ts: JPEG→PNG happy path (drop, pick format,
download, assert PNG signature); EXIF-rotation correctness
(asserts post-rotate output dimensions match visual orientation).

privacy-regression-image-convert.spec.ts: real JPEG→PNG
conversion produces zero off-origin requests/WebSockets. Same
listener pattern as the HEIC privacy spec; host-comparison
applied to WebSockets per PR #2.

homepage-handoff.spec.ts gains a JPEG-on-/ test that exercises
the pendingFile + ready-gate cross-route handoff: drop on home,
land on image-convert with file held, pick PNG, conversion
fires automatically."
```

---

## Phase 2 close-out

After Task 10 commits clean and CI is green:

- Open PR `phase-2-image-convert → main` with a structured Summary + Test plan + Deferred-items section.
- After merge, deploy auto-builds. Sanity-click the live URL: drop a JPEG on `/`, expect navigation + format prompt + conversion.
- Phase 6 hardening backlog (carried from Plan 1, now extended):
  - libheif `Critical dependency` webpack warning still present
  - `script-src 'unsafe-inline'` still in CSP
  - ToolFrame in-flight-conversion race (drops while converting)
  - bundle-size budget — image-convert worker chunk is small (~5 KB) but the libheif baseline remains 1.46 MB

---

## Self-review — spec coverage check

- ✓ Spec §3.1 engine type extension — Task 1
- ✓ Spec §3.2 createImageBitmap + OffscreenCanvas pipeline — Task 4
- ✓ Spec §3.3 alpha-on-JPEG white fill — Task 4
- ✓ Spec §4 ImageConvertOptions types + defaults — Task 3
- ✓ Spec §5.1 OptionsPanel — Task 5
- ✓ Spec §5.2 ToolFrame extensions (run signature, panel slot, ready gate, pendingFile handoff) — Task 7
- ✓ Spec §5.3 DropZone disabled prop — Task 2
- ✓ Spec §6 magic-byte validation via detectMime — Task 6 convert path
- ✓ Spec §7 filename + mime maps — Task 3 (constants), Task 4 (worker uses them)
- ✓ Spec §8.1 registry extension — Task 6
- ✓ Spec §8.2 homepage routing — Task 8
- ✓ Spec §8.3 sidebar entry — Task 8
- ✓ Spec §9 privacy posture + spec — Task 10
- ✓ Spec §10.1 unit tests — Tasks 2, 5, 6, 7
- ✓ Spec §10.2 E2E — Task 10
- ✓ Spec §10.3 fixtures — Task 9
- ✓ Spec §10.4 pixel-correctness for EXIF auto-rotate — Task 10 second test
- ✓ Spec §11 known limitations — documented in spec; behavior is implicit (no runtime warnings)
- ✓ Spec §12 future scope — captured in master spec §16 (commit `83c58cb`)
