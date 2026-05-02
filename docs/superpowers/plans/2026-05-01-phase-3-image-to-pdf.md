# Phase 3 — image-to-PDF engine + HEIC consolidation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task with two-stage review on substantive (architecture-touching) tasks and combined opus review on mechanical extensions. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a generic `image-to-pdf` engine (1+ HEIC/PNG/JPEG/WebP files → single combined PDF via pdf-lib) AND consolidate HEIC support into the `image-convert` engine, deleting the dedicated HEIC engine + route + sidebar entry.

**Architecture:** New shared `_shared/decode-image.ts` utility wraps libheif (lazy-loaded) and `createImageBitmap` behind one `decodeImage(file)` interface. Both image-convert and image-to-pdf consume it. Engine pattern gains `StagingArea?` field on `MultiInputEngine` (parallel to `OptionsPanel`). ToolFrame's currently-dead multi-cardinality branch activates: stagedFiles state, append-on-drop, engine-rendered staging UI, explicit Convert button. Cross-route handoff slot migrates from `File | null` to `File[]`.

**Tech Stack:** Plan 1 + 2 stack (Next.js 15 static export, React 19, Comlink workers, OffscreenCanvas, Tailwind v4, Vitest, Playwright) plus **pdf-lib** (~250 KB min+gz; reusable by Plan 4 PDF merge).

**Spec:** [`docs/superpowers/specs/2026-05-01-image-to-pdf-engine-design.md`](../specs/2026-05-01-image-to-pdf-engine-design.md) (commit `c0795a7`).

**Branch:** `phase-3-image-to-pdf` (create off `main` after Plan 3 spec PR merges).

**Substantive tasks (full two-stage sonnet+opus review):** 1, 4, 6, 10. **Mechanical tasks (combined opus review):** 2, 3, 5, 7, 8, 9, 11, 12, 13, 14.

**Critical ordering dependency:** Task 2 (image-convert HEIC support) MUST land before Task 7 (HEIC engine deletion). Otherwise HEIC capability is broken in the intermediate state. Task 4 (handoff API migration) is independent but lands before Task 6 (ToolFrame plumbing), which is before Task 7 (homepage routing rewrite). Re-runs MUST follow the numbered order.

**Branch discipline reminder for implementer subagents:**
- Run `git branch --show-current` BEFORE and AFTER every commit. Verify it reads `phase-3-image-to-pdf`.
- NEVER run: `git branch -m`, `git branch -M`, `git checkout <branch>`, `git switch <branch>`, `git reset --hard`, `git push`, `git push --force`. NEVER use `--no-verify`.
- Allowed: `git status`, `git diff`, `git log`, `git branch --show-current`, `git add <specific files>`, `git commit`, `git rm <specific files>`, `git checkout -- <file>` (only for reverting probe edits).

---

## Task 1: Shared image decoder

**Goal:** Create `_shared/decode-image.ts` with a single `decodeImage(file)` function that handles HEIC (lazy libheif) and PNG/JPEG/WebP (browser-native `createImageBitmap`). Add unit tests.

**Files:**
- Create: `src/engines/_shared/decode-image.ts`
- Create: `src/engines/_shared/decode-image.test.ts`

- [ ] **Step 1: Write `src/engines/_shared/decode-image.ts`**

```ts
import { detectMime } from "./file-detection";

let libheifModulePromise: Promise<typeof import("libheif-js/wasm-bundle")> | undefined;

async function loadLibheif() {
  if (!libheifModulePromise) {
    libheifModulePromise = import("libheif-js/wasm-bundle");
  }
  return libheifModulePromise;
}

async function decodeHeic(file: File): Promise<ImageBitmap> {
  // Dynamic import() returns a module namespace { default: LibHeif },
  // not the default export — destructure .default to reach HeifDecoder.
  const lib = (await loadLibheif()).default;
  const decoder = new lib.HeifDecoder();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const data = decoder.decode(bytes);
  if (!data || data.length === 0) {
    throw new Error("libheif: no images decoded from HEIC");
  }
  const first = data[0];
  if (!first) throw new Error("libheif: first image missing");
  const width = first.get_width();
  const height = first.get_height();
  // Uint8ClampedArray<ArrayBuffer> annotation is required under TS strict +
  // exactOptionalPropertyTypes for compatibility with DisplayTarget.data and
  // the ImageData constructor signature.
  const rgba = await new Promise<Uint8ClampedArray<ArrayBuffer>>((resolve, reject) => {
    first.display(
      {
        data: new Uint8ClampedArray(new ArrayBuffer(width * height * 4)),
        width,
        height,
      },
      (display: { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } | null) => {
        if (!display) reject(new Error("libheif: display callback received null"));
        else resolve(display.data);
      },
    );
  });
  const imageData = new ImageData(rgba, width, height);
  return await createImageBitmap(imageData);
}

export async function decodeImage(file: File): Promise<ImageBitmap> {
  const mime = await detectMime(file);
  if (mime === "image/heic" || mime === "image/heif") {
    return decodeHeic(file);
  }
  return createImageBitmap(file, { imageOrientation: "from-image" });
}
```

- [ ] **Step 2: Write `src/engines/_shared/decode-image.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("./file-detection", () => ({
  detectMime: vi.fn(),
}));

import { detectMime } from "./file-detection";
import { decodeImage } from "./decode-image";

const mockedDetectMime = detectMime as ReturnType<typeof vi.fn>;

describe("decodeImage", () => {
  it("dispatches HEIC files via the libheif path", async () => {
    mockedDetectMime.mockResolvedValueOnce("image/heic");
    const file = new File([new Uint8Array([0])], "x.heic", { type: "image/heic" });
    // libheif's parser rejects bytes too small to be a HEIF box; reaching
    // that rejection confirms the dispatcher took the HEIC branch.
    await expect(decodeImage(file)).rejects.toThrow();
  });

  it("dispatches HEIF files via the libheif path", async () => {
    mockedDetectMime.mockResolvedValueOnce("image/heif");
    const file = new File([new Uint8Array([0])], "x.heif", { type: "image/heif" });
    await expect(decodeImage(file)).rejects.toThrow();
  });

  it("dispatches PNG files via createImageBitmap", async () => {
    mockedDetectMime.mockResolvedValueOnce("image/png");
    const file = new File([new Uint8Array([0])], "x.png", { type: "image/png" });
    // test-setup.ts stubs createImageBitmap to reject; reaching that
    // rejection confirms the dispatcher took the non-HEIC branch.
    await expect(decodeImage(file)).rejects.toThrow();
  });

  it("dispatches JPEG files via createImageBitmap", async () => {
    mockedDetectMime.mockResolvedValueOnce("image/jpeg");
    const file = new File([new Uint8Array([0])], "x.jpg", { type: "image/jpeg" });
    await expect(decodeImage(file)).rejects.toThrow();
  });
});
```

The tests verify the dispatch shape. Real-bitmap correctness for HEIC and createImageBitmap is exercised by the existing engine tests + new E2E specs in Task 14 (jsdom doesn't render real bitmaps from byte arrays).

- [ ] **Step 3: Add `createImageBitmap` polyfill to test-setup if needed**

Read `src/test-setup.ts`. If `createImageBitmap` isn't already polyfilled, add a stub that rejects:

```ts
if (typeof globalThis.createImageBitmap !== "function") {
  globalThis.createImageBitmap = (() => Promise.reject(new Error("createImageBitmap stub"))) as typeof createImageBitmap;
}
```

This lets the dispatch tests pass under jsdom by ensuring the function exists but predictably rejects. Place near the existing Blob.arrayBuffer / matchMedia / URL polyfills.

If `createImageBitmap` IS already polyfilled (check existing setup file), skip this step.

- [ ] **Step 4: Run unit gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all exit 0. Test count goes from 70 → 74 (+4 from decode-image.test.ts).

- [ ] **Step 5: Commit**

```bash
git add src/engines/_shared/decode-image.ts src/engines/_shared/decode-image.test.ts src/test-setup.ts
git commit -m "feat(engines): shared decode-image utility

Wraps libheif-js (lazy) and createImageBitmap behind one
decodeImage(file) interface. Module-level promise cache ensures
libheif's WASM module loads at most once per worker session.
PNG/JPEG/WebP path adds zero new bundle weight; HEIC path lazy-
imports libheif-js/wasm-bundle on first encounter.

Both image-convert and image-to-pdf will call this. The HEIC
engine is deleted in Task 7 once image-convert switches to this
utility in Task 2."
```

(If `src/test-setup.ts` was unchanged in Step 3, omit it from `git add`.)

---

## Task 2: image-convert refactor — use shared decoder, accept HEIC

**Goal:** image-convert worker calls `decodeImage` instead of inline `createImageBitmap`. Engine descriptor extends `inputAccept` / `inputMime` / `validate` to accept HEIC.

**Files:**
- Modify: `src/engines/image-convert/worker.ts`
- Modify: `src/engines/image-convert/index.ts`
- Modify: `src/engines/image-convert/index.test.ts`

- [ ] **Step 1: Update `src/engines/image-convert/worker.ts`**

Replace the existing worker contents with:

```ts
import * as Comlink from "comlink";
import type { OutputItem } from "@/engines/_shared/types";
import { decodeImage } from "@/engines/_shared/decode-image";
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
    const file = new File([inputBlob], name, { type });
    const bitmap = await decodeImage(file);

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

The differences from Plan 2's worker:
- Imports `decodeImage` from the shared utility.
- Wraps the input bytes as a `File` (decodeImage takes File, not Blob, because it calls `detectMime` which expects File).
- Replaces the inline `createImageBitmap(inputBlob, { imageOrientation: "from-image" })` call with `decodeImage(file)`.
- Everything else (canvas, alpha-fill, encoding, output) is unchanged.

- [ ] **Step 2: Update `src/engines/image-convert/index.ts`**

Modify `SUPPORTED_INPUT_MIMES`, `inputAccept`, and `validate`:

```ts
import { detectMime } from "@/engines/_shared/file-detection";
import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type ImageConvertOptions, defaultImageConvertOptions } from "./options";
import { ImageConvertOptionsPanel } from "./options-panel";

const SUPPORTED_INPUT_MIMES = [
  "image/heic",
  "image/heif",
  "image/png",
  "image/jpeg",
  "image/webp",
];

const engine: SingleInputEngine<ImageConvertOptions, OutputItem> = {
  id: "image-convert",
  inputAccept: [".heic", ".heif", ".png", ".jpg", ".jpeg", ".webp"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "image/png",
  defaultOptions: defaultImageConvertOptions,
  cardinality: "single",
  isReadyToConvert: (opts) => opts.output !== null,
  OptionsPanel: ImageConvertOptionsPanel,
  validate(file) {
    return SUPPORTED_INPUT_MIMES.includes(file.type)
      ? { ok: true }
      : { ok: false, reason: "Expected a HEIC, HEIF, PNG, JPEG, or WebP file" };
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

Changes from Plan 2:
- `SUPPORTED_INPUT_MIMES` adds `image/heic`, `image/heif`.
- `inputAccept` adds `.heic`, `.heif`.
- `validate`'s error message updates to include HEIC.

- [ ] **Step 3: Update `src/engines/image-convert/index.test.ts`**

Find the test "validates PNG / JPEG / WebP files by their type" and update to also cover HEIC:

```ts
  it("validates HEIC / HEIF / PNG / JPEG / WebP files by their type", () => {
    const heic = new File([new Uint8Array([1])], "z.heic", { type: "image/heic" });
    const heif = new File([new Uint8Array([1])], "y.heif", { type: "image/heif" });
    const png = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    const jpg = new File([new Uint8Array([1])], "b.jpg", { type: "image/jpeg" });
    const webp = new File([new Uint8Array([1])], "c.webp", { type: "image/webp" });
    const opts = { output: null, quality: 0.9 };
    expect(engine.validate(heic, opts)).toEqual({ ok: true });
    expect(engine.validate(heif, opts)).toEqual({ ok: true });
    expect(engine.validate(png, opts)).toEqual({ ok: true });
    expect(engine.validate(jpg, opts)).toEqual({ ok: true });
    expect(engine.validate(webp, opts)).toEqual({ ok: true });
  });
```

Find the test "declares correct id, accept lists, and cardinality" and update the inputAccept / inputMime expectations:

```ts
  it("declares correct id, accept lists, and cardinality", () => {
    expect(engine.id).toBe("image-convert");
    expect(engine.inputAccept).toEqual([".heic", ".heif", ".png", ".jpg", ".jpeg", ".webp"]);
    expect(engine.inputMime).toEqual([
      "image/heic", "image/heif",
      "image/png", "image/jpeg", "image/webp",
    ]);
    expect(engine.cardinality).toBe("single");
  });
```

- [ ] **Step 4: Run unit gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all exit 0. Test count: 74 (no new tests added in this task; the existing image-convert tests are updated in place).

- [ ] **Step 5: Run the existing image-convert E2E to verify no regression**

The existing `tests/e2e/image-convert.spec.ts` covers JPEG → PNG. Verify it still passes.

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null; sleep 1
pnpm test:e2e --project=chromium --workers=1 tests/e2e/image-convert.spec.ts
```

Expected: 2 tests pass (the existing JPEG→PNG happy path and EXIF rotation test). HEIC support is added in this task but covered by E2E in Task 3.

- [ ] **Step 6: Commit**

```bash
git add src/engines/image-convert/worker.ts src/engines/image-convert/index.ts src/engines/image-convert/index.test.ts
git commit -m "feat(engines): image-convert accepts HEIC via shared decoder

Worker calls decodeImage from _shared/decode-image instead of
inline createImageBitmap. Engine descriptor's inputAccept,
inputMime, and validate accept HEIC + HEIF in addition to
PNG/JPEG/WebP. Output formats unchanged: PNG/JPEG/WebP only
(OffscreenCanvas can't encode HEIC).

The dedicated heic-to-png engine is deleted in Task 7 once this
consolidation is verified end-to-end in Task 3."
```

---

## Task 3: Update Plan 2 E2E specs to cover HEIC

**Goal:** Extend `image-convert.spec.ts` and `privacy-regression-image-convert.spec.ts` with HEIC test cases. Verifies Task 2's consolidation end-to-end via real browser.

**Files:**
- Modify: `tests/e2e/image-convert.spec.ts`
- Modify: `tests/e2e/privacy-regression-image-convert.spec.ts`

- [ ] **Step 1: Add a HEIC → PNG case to `tests/e2e/image-convert.spec.ts`**

Append a third `test` block at the end of the file, AFTER the existing two tests:

```ts
test("HEIC → PNG via shared decoder produces a valid PNG download", async ({ page }) => {
  await page.goto("/tools/image-convert");
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");
  await page.getByTestId("output-format").selectOption("png");

  const input = page.locator('input[type="file"]');
  const fixture = path.resolve(__dirname, "../fixtures/sample.heic");
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
```

The existing imports (`readFile`, `path`, `expect`, `test`) cover what this test needs. No new imports.

- [ ] **Step 2: Add a HEIC → PNG case to `tests/e2e/privacy-regression-image-convert.spec.ts`**

Append a second `test` block at the end of the file:

```ts
test("HEIC → PNG conversion produces zero outbound network requests beyond initial load", async ({
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
  const fixture = path.resolve(__dirname, "../fixtures/sample.heic");
  await input.setInputFiles(fixture);
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");

  expect(
    conversionRequests,
    `Image-convert HEIC made off-origin requests: ${conversionRequests.join(", ")}`,
  ).toEqual([]);
  expect(
    conversionWebSockets,
    `Image-convert HEIC opened off-origin WebSockets: ${conversionWebSockets.join(", ")}`,
  ).toEqual([]);
});
```

- [ ] **Step 3: Run the updated specs**

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null; sleep 1
pnpm test:e2e --project=chromium --workers=1 tests/e2e/image-convert.spec.ts tests/e2e/privacy-regression-image-convert.spec.ts
```

Expected: 5 tests pass. (3 in image-convert.spec.ts: existing JPEG→PNG, existing EXIF-rotation, new HEIC→PNG. 2 in privacy-regression-image-convert.spec.ts: existing JPEG→PNG, new HEIC→PNG.) `--workers=1` because libheif's WASM bundle init can race two parallel Playwright workers on cold start.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/image-convert.spec.ts tests/e2e/privacy-regression-image-convert.spec.ts
git commit -m "test(e2e): image-convert HEIC → PNG case (uses shared decoder)

Adds HEIC → PNG happy path to image-convert.spec.ts and HEIC
privacy regression to privacy-regression-image-convert.spec.ts.
Verifies Task 2's consolidation end-to-end: real Chromium drops
sample.heic, picks PNG output, conversion runs through the shared
decoder, PNG download captured with valid signature bytes, zero
off-origin network during conversion."
```

---

## Task 4: Cross-route handoff API migration — File | null → File[]

**Goal:** Migrate `src/lib/handoff.ts` from a single `File | null` slot to a `File[]` slot. Update all callsites: page.tsx, tool-frame.tsx, handoff.test.ts.

**Files:**
- Modify: `src/lib/handoff.ts`
- Modify: `src/lib/handoff.test.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/components/tool-frame.tsx`
- Modify: `src/components/tool-frame.test.tsx`

- [ ] **Step 1: Replace `src/lib/handoff.ts`**

```ts
let staged: File[] = [];

export function stageFiles(files: File[]): void {
  // Defensive copy — caller-side mutations after stage shouldn't leak in.
  staged = [...files];
}

export function takeStagedFiles(): File[] {
  const r = staged;
  staged = [];
  return r;
}
```

The old `stageFile` / `takeStagedFile` exports are removed.

- [ ] **Step 2: Replace `src/lib/handoff.test.ts`**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { stageFiles, takeStagedFiles } from "./handoff";

afterEach(() => {
  takeStagedFiles();
});

describe("file handoff", () => {
  it("returns an empty array when no files have been staged", () => {
    expect(takeStagedFiles()).toEqual([]);
  });

  it("returns the staged files once, then empty on subsequent calls", () => {
    const a = new File(["a"], "a.png", { type: "image/png" });
    const b = new File(["b"], "b.jpg", { type: "image/jpeg" });
    stageFiles([a, b]);
    expect(takeStagedFiles()).toEqual([a, b]);
    expect(takeStagedFiles()).toEqual([]);
  });

  it("most recent stage replaces a prior staged set", () => {
    const a = new File(["a"], "a.png", { type: "image/png" });
    const b = new File(["b"], "b.jpg", { type: "image/jpeg" });
    const c = new File(["c"], "c.webp", { type: "image/webp" });
    stageFiles([a]);
    stageFiles([b, c]);
    expect(takeStagedFiles()).toEqual([b, c]);
    expect(takeStagedFiles()).toEqual([]);
  });

  it("stages a single-file array correctly (single-input pattern)", () => {
    const f = new File(["f"], "single.heic", { type: "image/heic" });
    stageFiles([f]);
    expect(takeStagedFiles()).toEqual([f]);
  });

  it("does not leak external mutations into the staged slot", () => {
    const arr = [new File(["a"], "a.png", { type: "image/png" })];
    stageFiles(arr);
    arr.push(new File(["b"], "b.png", { type: "image/png" }));
    expect(takeStagedFiles()).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Update `src/app/page.tsx`**

Replace the existing `handleFiles` function and the `stageFile` import.

```tsx
"use client";

import { DropZone } from "@/components/drop-zone";
import { detectMime } from "@/engines/_shared/file-detection";
import { stageFiles } from "@/lib/handoff";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Home() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: File[]) {
    setError(null);
    if (files.length === 0) return;
    const f = files[0];
    if (!f) return;
    const mime = await detectMime(f);
    if (mime === "image/heic" || mime === "image/heif") {
      stageFiles([f]);
      router.push("/tools/heic-to-png");
      return;
    }
    if (mime === "image/png" || mime === "image/jpeg" || mime === "image/webp") {
      stageFiles([f]);
      router.push("/tools/image-convert");
      return;
    }
    setError("No tool for this file type yet. Phase 2 supports HEIC, PNG, JPEG, WebP.");
  }

  return (
    <main className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        <DropZone
          onFiles={handleFiles}
          prompt="drop a file"
          hint="HEIC supported. More tools shipping in subsequent phases."
        />
        {error && (
          <output
            aria-live="polite"
            className="mt-3 block border border-[var(--color-accent)] p-3 text-[var(--text-sm)] text-[var(--color-fg-strong)]"
          >
            {error}
          </output>
        )}
      </div>
    </main>
  );
}
```

Note: this task only migrates the API. The HEIC routing branch still points at `/tools/heic-to-png` in this commit because the HEIC engine is still alive (deletion in Task 7). The multi-file branch (`>= 2 files → /tools/image-to-pdf`) is added in Task 13. Don't add that branch yet.

- [ ] **Step 4: Update `src/components/tool-frame.tsx`**

Replace the existing tool-frame.tsx with the migrated version. Key changes:
- Import `takeStagedFiles` (not `takeStagedFile`).
- Rename `pendingFile: File | null` → `pendingFiles: File[]`.
- Mount-effect uses `takeStagedFiles()`.
- Watcher effect runs `run([pendingFiles[0]], options)` for the single-cardinality branch when `pendingFiles.length > 0 && ready`.
- Multi-cardinality branch is NOT added in this task (it lands in Task 6).

```tsx
"use client";

import type { ConversionEngine, OutputItem } from "@/engines/_shared/types";
import { takeStagedFiles } from "@/lib/handoff";
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
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

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

  // Mount-time staged-file consumption. Single-shot: takeStagedFiles clears
  // the slot, so React Strict Mode's double-mount fires this once net.
  const consumedRef = useRef(false);
  useEffect(() => {
    if (consumedRef.current) return;
    consumedRef.current = true;
    const staged = takeStagedFiles();
    if (staged.length > 0) setPendingFiles(staged);
  }, []);

  // Fires conversion when both file and ready state materialize. If options
  // start out ready (HEIC), this runs as soon as pendingFiles is set. If not
  // (image-convert with output unselected), waits until user picks a format.
  useEffect(() => {
    if (pendingFiles.length > 0 && ready) {
      const f = pendingFiles[0];
      if (f) run([f], options);
      setPendingFiles([]);
    }
  }, [pendingFiles, ready, run, options]);

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

- [ ] **Step 5: Update `src/components/tool-frame.test.tsx`**

Find the test "holds a staged file until isReadyToConvert flips to true, then runs conversion". Update the imports and the staging call:

```tsx
import { stageFiles, takeStagedFiles } from "@/lib/handoff";
```

```tsx
afterEach(() => {
  takeStagedFiles();
  vi.restoreAllMocks();
});
```

Inside the held-then-fired test, change:
```tsx
stageFile(staged);
```
to:
```tsx
stageFiles([staged]);
```

The rest of the test is unchanged — it still asserts that `convert` is called with the staged file once `ready` flips to true.

- [ ] **Step 6: Run all unit gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all exit 0. Test count: 74 (handoff.test.ts went from 3 → 4 tests = +1).

- [ ] **Step 7: Run E2E regression to verify single-file flows still work**

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null; sleep 1
pnpm test:e2e --project=chromium --workers=1 tests/e2e/heic-to-png.spec.ts tests/e2e/image-convert.spec.ts tests/e2e/homepage-handoff.spec.ts
```

Expected: all tests pass (HEIC happy path, image-convert 3 tests, homepage-handoff 2 tests).

- [ ] **Step 8: Commit**

```bash
git add src/lib/handoff.ts src/lib/handoff.test.ts src/app/page.tsx src/components/tool-frame.tsx src/components/tool-frame.test.tsx
git commit -m "feat(handoff): migrate slot from File|null to File[]

Single export pair: stageFiles(files) / takeStagedFiles(). Single-
input engines stage [file]; multi-input engines (image-to-pdf in
Task 12) stage many. ToolFrame's pendingFile renamed to
pendingFiles; single-cardinality watcher runs against
pendingFiles[0]. Multi-cardinality branch lands in Task 6.

Homepage routing migrates to stageFiles([f]) for single-file
drops; multi-file routing branch added in Task 13."
```

---

## Task 5: Engine type system extension — StagingArea field

**Goal:** Add `StagingArea?` field on `MultiInputEngine` (multi-only). Add `StagingAreaProps<T>` helper type. Type-d test confirms the new field's optionality.

**Files:**
- Modify: `src/engines/_shared/types.ts`
- Modify: `src/engines/_shared/types.test-d.ts`

- [ ] **Step 1: Update `src/engines/_shared/types.ts`**

Replace the file with the extended types:

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
  convertButtonLabel?: string;
};

export type OptionsPanelProps<TOptions> = {
  value: TOptions;
  onChange: (next: TOptions) => void;
};

export type StagingAreaProps<TOptions> = {
  files: File[];
  onChange: (next: File[]) => void;
  options: TOptions;
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
  StagingArea?: ComponentType<StagingAreaProps<TOptions>>;
};

export type ConversionEngine<
  TOptions = unknown,
  TOutput extends OutputItem | OutputItem[] = OutputItem | OutputItem[],
> = SingleInputEngine<TOptions, TOutput> | MultiInputEngine<TOptions, TOutput>;
```

`SingleInputEngine` does NOT get `StagingArea` — multi-only by intent.

- [ ] **Step 2: Append a type-d test in `src/engines/_shared/types.test-d.ts`**

Add a new `it()` block inside the existing `describe("types", ...)`:

```ts
import type { MultiInputEngine, StagingAreaProps } from "./types";
```

(if those imports aren't already present at the top — check before adding to avoid duplicates)

```ts
  it("StagingArea is optional on MultiInputEngine and absent on SingleInputEngine", () => {
    type MOpts = { paper: "letter" | "a4" };
    type ME = MultiInputEngine<MOpts, { filename: string; mime: string; blob: Blob }>;
    expectTypeOf<ME["StagingArea"]>().toEqualTypeOf<
      | import("react").ComponentType<StagingAreaProps<MOpts>>
      | undefined
    >();
  });

  it("StagingAreaProps shape is correctly parameterized", () => {
    type Opts = { foo: string };
    expectTypeOf<StagingAreaProps<Opts>>().toEqualTypeOf<{
      files: File[];
      onChange: (next: File[]) => void;
      options: Opts;
    }>();
  });
```

- [ ] **Step 3: Run unit gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all exit 0. Test count: 76 (74 + 2 new type-d tests).

- [ ] **Step 4: Commit**

```bash
git add src/engines/_shared/types.ts src/engines/_shared/types.test-d.ts
git commit -m "feat(engines): StagingArea field on MultiInputEngine

Optional ComponentType<StagingAreaProps<TOptions>> field. Multi-
only by intent; single-input engines have no staging step.
StagingAreaProps helper type exported for engine modules to
import without redeclaring the shape (parallel to OptionsPanelProps
from Plan 2)."
```

---

## Task 6: ToolFrame multi-cardinality plumbing

**Goal:** ToolFrame renders `engine.StagingArea` for multi-cardinality engines, manages `stagedFiles: File[]` state with append-on-drop semantics, renders an explicit Convert button, and routes the cross-route handoff to populate stagedFiles (no auto-fire) for multi engines.

**Files:**
- Modify: `src/components/tool-frame.tsx`
- Modify: `src/components/tool-frame.test.tsx`

- [ ] **Step 1: Replace `src/components/tool-frame.tsx`**

```tsx
"use client";

import type { ConversionEngine, OutputItem } from "@/engines/_shared/types";
import { takeStagedFiles } from "@/lib/handoff";
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
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);

  const ready = engine.isReadyToConvert?.(options) ?? true;
  const Panel = engine.OptionsPanel;
  const Staging = engine.cardinality === "multi" ? engine.StagingArea : undefined;
  const isMulti = engine.cardinality === "multi";

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

  const consumedRef = useRef(false);
  useEffect(() => {
    if (consumedRef.current) return;
    consumedRef.current = true;
    const staged = takeStagedFiles();
    if (staged.length > 0) setPendingFiles(staged);
  }, []);

  useEffect(() => {
    if (pendingFiles.length === 0) return;
    if (isMulti) {
      // Multi: populate the staging area, no auto-fire. User reviews
      // and clicks Convert.
      setStagedFiles((prev) => [...prev, ...pendingFiles]);
      setPendingFiles([]);
      return;
    }
    if (ready) {
      const f = pendingFiles[0];
      if (f) run([f], options);
      setPendingFiles([]);
    }
  }, [pendingFiles, ready, run, options, isMulti]);

  function handleDrop(files: File[]) {
    if (isMulti) {
      // Multi: append to staging.
      setStagedFiles((prev) => [...prev, ...files]);
      return;
    }
    // Single: fire conversion immediately.
    run(files, options);
  }

  function handleConvertClick() {
    run(stagedFiles, options);
  }

  return (
    <main className="p-6">
      <div className="mb-3 flex items-center gap-3 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        <span>tool: {engine.id}</span>
        <span>·</span>
        <StatusIndicator status={status} />
      </div>
      {Panel && <Panel value={options} onChange={setOptions} />}
      {Staging && stagedFiles.length > 0 && (
        <Staging files={stagedFiles} onChange={setStagedFiles} options={options} />
      )}
      <DropZone
        accept={engine.inputAccept}
        multiple={isMulti}
        onFiles={handleDrop}
        disabled={!ready}
      />
      {isMulti && (
        <button
          type="button"
          data-testid="convert-button"
          disabled={stagedFiles.length === 0 || !ready || status === "converting"}
          onClick={handleConvertClick}
          className="mt-3 border border-[var(--color-accent)] px-3 py-2 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-strong)] disabled:border-[var(--color-fg-very-muted)] disabled:text-[var(--color-fg-very-muted)]"
        >
          {engine.convertButtonLabel ?? "[ convert ]"}
        </button>
      )}
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
- New state: `stagedFiles: File[]`. Only meaningful when `isMulti`.
- `Staging` is the engine's StagingArea component, only rendered when `isMulti && stagedFiles.length > 0`.
- The mount effect / handoff watcher branch on `isMulti`: multi engines populate staging WITHOUT auto-firing; single engines auto-fire from `pendingFiles[0]`.
- `handleDrop` distinguishes multi (append) vs single (fire). DropZone's `multiple` is true only for multi engines.
- Convert button renders only for multi engines, disabled when staging is empty OR `!ready`.
- The button label is engine-controlled via `engine.convertButtonLabel`. Image-to-pdf sets it to `"[ convert to pdf ]"` (Task 12). Plan 4's PDF merge can declare its own label without ToolFrame changes — preserves the engine-pattern's "no shared code touched" promise.

- [ ] **Step 2: Update `src/components/tool-frame.test.tsx`**

Add tests for the multi-cardinality branch. Append after the existing tests inside `describe("ToolFrame", ...)`:

```tsx
  it("renders engine.StagingArea and Convert button for multi-cardinality engines", () => {
    const Staging = ({ files }: { files: File[]; onChange: (n: File[]) => void; options: unknown }) => (
      <div data-testid="staging-files">{files.length} files</div>
    );
    const engine = {
      ...makeStubEngine(),
      cardinality: "multi" as const,
      validate: (() => ({ ok: true } as const)) as never,
      convert: vi.fn(async () => ({
        filename: "out.pdf",
        mime: "application/pdf",
        blob: new Blob(["x"]),
      })) as never,
      StagingArea: Staging,
    } as unknown as ConversionEngine<StubOpts, OutputItem>;

    render(<ToolFrame engine={engine} />);
    // No staging visible until something is dropped/staged.
    expect(screen.queryByTestId("staging-files")).toBeNull();
    // Convert button is present and disabled.
    expect(screen.getByTestId("convert-button")).toBeDisabled();
  });

  it("staged file from cross-route handoff populates a multi-cardinality engine's staging area without firing convert", async () => {
    const Staging = ({ files }: { files: File[]; onChange: (n: File[]) => void; options: unknown }) => (
      <div data-testid="staging-files">{files.length} files</div>
    );
    const convert = vi.fn(async () => ({
      filename: "out.pdf",
      mime: "application/pdf",
      blob: new Blob(["x"]),
    }));
    const engine = {
      ...makeStubEngine(),
      cardinality: "multi" as const,
      validate: (() => ({ ok: true } as const)) as never,
      convert: convert as never,
      StagingArea: Staging,
    } as unknown as ConversionEngine<StubOpts, OutputItem>;

    const f1 = new File(["a"], "a.png", { type: "image/png" });
    const f2 = new File(["b"], "b.jpg", { type: "image/jpeg" });
    stageFiles([f1, f2]);

    render(<ToolFrame engine={engine} />);

    await waitFor(() => {
      expect(screen.getByTestId("staging-files")).toHaveTextContent("2 files");
    });
    expect(convert).not.toHaveBeenCalled();
    expect(screen.getByTestId("convert-button")).not.toBeDisabled();
  });

  it("Convert button click fires run with stagedFiles", async () => {
    let stagedRef: File[] = [];
    const Staging = ({ files, onChange }: { files: File[]; onChange: (n: File[]) => void; options: unknown }) => {
      stagedRef = files;
      void onChange;
      return <div data-testid="staging-files">{files.length} files</div>;
    };
    const convert = vi.fn(async () => ({
      filename: "out.pdf",
      mime: "application/pdf",
      blob: new Blob(["x"]),
    }));
    const engine = {
      ...makeStubEngine(),
      cardinality: "multi" as const,
      validate: (() => ({ ok: true } as const)) as never,
      convert: convert as never,
      StagingArea: Staging,
    } as unknown as ConversionEngine<StubOpts, OutputItem>;

    const f1 = new File(["a"], "a.png", { type: "image/png" });
    const f2 = new File(["b"], "b.jpg", { type: "image/jpeg" });
    stageFiles([f1, f2]);

    render(<ToolFrame engine={engine} />);

    await waitFor(() => {
      expect(stagedRef.length).toBe(2);
    });

    fireEvent.click(screen.getByTestId("convert-button"));

    await waitFor(() => {
      expect(convert).toHaveBeenCalledOnce();
    });
    expect(convert).toHaveBeenCalledWith([f1, f2], expect.anything(), expect.anything());
  });
```

The casts are needed because `makeStubEngine()` returns a single-cardinality stub by default; the `as unknown as ConversionEngine<StubOpts, OutputItem>` chain coerces to the multi shape.

- [ ] **Step 3: Run all unit gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all exit 0. Test count: 79 (76 + 3 new ToolFrame tests).

- [ ] **Step 4: Run E2E regression to verify single-cardinality flows still work**

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null; sleep 1
pnpm test:e2e --project=chromium --workers=1 tests/e2e/heic-to-png.spec.ts tests/e2e/image-convert.spec.ts tests/e2e/homepage-handoff.spec.ts
```

Expected: all tests pass. Single-cardinality logic is unchanged in shape; only the variable name (pendingFile → pendingFiles) and the watcher's branching changed.

- [ ] **Step 5: Commit**

```bash
git add src/components/tool-frame.tsx src/components/tool-frame.test.tsx
git commit -m "feat(ui): ToolFrame multi-cardinality plumbing

stagedFiles state, append-on-drop for multi engines, render
engine.StagingArea above DropZone when staged, explicit Convert
button below DropZone for multi only. Cross-route handoff for
multi engines populates stagedFiles WITHOUT auto-firing — user
reviews then clicks Convert.

Single-cardinality flow unchanged in shape: drop fires run
immediately; handoff watcher fires run([pendingFiles[0]], opts)
when ready.

ToolFrame unit tests cover the StagingArea slot rendering, the
multi-cardinality handoff (file populates staging, no auto-fire),
and the Convert button click → run wiring."
```

---

## Task 7: Delete the dedicated HEIC engine + route + sidebar entry

**Goal:** Delete `src/engines/heic-to-png/` entirely. Remove the `/tools/heic-to-png` route. Remove the sidebar entry. Update registry. Update homepage routing to send HEIC drops to `/tools/image-convert`. Delete the corresponding E2E specs.

**Files:**
- Delete: `src/engines/heic-to-png/index.ts`
- Delete: `src/engines/heic-to-png/options.ts`
- Delete: `src/engines/heic-to-png/worker.ts`
- Delete: `src/engines/heic-to-png/index.test.ts`
- Delete: `src/app/tools/heic-to-png/page.tsx`
- Delete: `tests/e2e/heic-to-png.spec.ts`
- Delete: `tests/e2e/privacy-regression-heic.spec.ts`
- Modify: `src/engines/_shared/registry.ts`
- Modify: `src/engines/_shared/registry.test.ts`
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Delete the HEIC engine module + route**

```bash
git rm src/engines/heic-to-png/index.ts src/engines/heic-to-png/options.ts src/engines/heic-to-png/worker.ts src/engines/heic-to-png/index.test.ts
git rm -r src/app/tools/heic-to-png
```

- [ ] **Step 2: Delete the HEIC E2E specs**

The HEIC happy path and privacy regression are now covered by the extended `image-convert.spec.ts` and `privacy-regression-image-convert.spec.ts` (Task 3).

```bash
git rm tests/e2e/heic-to-png.spec.ts tests/e2e/privacy-regression-heic.spec.ts
```

- [ ] **Step 3: Update `src/engines/_shared/registry.ts`**

Remove `"heic-to-png"` from the `EngineId` union and the registry table. Final file:

```ts
import type { ConversionEngine, OutputItem } from "./types";

export type EngineId = "image-convert";

// biome-ignore lint/suspicious/noExplicitAny: registry erases per-engine TOptions
type AnyEngine = ConversionEngine<any, OutputItem | OutputItem[]>;

type Loader = () => Promise<{ default: AnyEngine }>;

const REGISTRY: Record<EngineId, Loader> = {
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

The image-to-pdf entry will be added in Task 12. Right now the only registered engine is image-convert.

- [ ] **Step 4: Update `src/engines/_shared/registry.test.ts`**

Drop the HEIC positive-path test. Replace the `listEngineIds` test's expected content. Final file:

```ts
import { describe, expect, it } from "vitest";
import { listEngineIds, loadEngine } from "./registry";

describe("registry", () => {
  it("lists engine ids including image-convert", () => {
    expect(listEngineIds()).toContain("image-convert");
  });

  it("loadEngine throws for unknown id", async () => {
    await expect(loadEngine("does-not-exist" as never)).rejects.toThrow("Unknown engine id");
  });

  it("loadEngine returns the image-convert engine module", async () => {
    const e = await loadEngine("image-convert");
    expect(e.id).toBe("image-convert");
    expect(e.cardinality).toBe("single");
  });
});
```

- [ ] **Step 5: Update `src/components/layout/sidebar.tsx`**

Remove the `heic→png` entry. The TOOLS array becomes:

```ts
const TOOLS: ToolEntry[] = [
  { id: "image-convert", href: "/tools/image-convert", label: "image convert", group: "IMAGES" },
];
```

(image-to-pdf is added in Task 13.)

- [ ] **Step 6: Update `src/app/page.tsx`**

The HEIC routing branch now points at `/tools/image-convert` (consolidated). Replace the existing `handleFiles` with:

```tsx
async function handleFiles(files: File[]) {
  setError(null);
  if (files.length === 0) return;
  const f = files[0];
  if (!f) return;
  const mime = await detectMime(f);
  if (
    mime === "image/heic" ||
    mime === "image/heif" ||
    mime === "image/png" ||
    mime === "image/jpeg" ||
    mime === "image/webp"
  ) {
    stageFiles([f]);
    router.push("/tools/image-convert");
    return;
  }
  setError("No tool for this file type yet. Phase 3 supports HEIC, PNG, JPEG, WebP.");
}
```

The single-file branch now sends ALL supported image MIMEs (including HEIC) to `/tools/image-convert`. The multi-file branch (image-to-pdf) lands in Task 13.

- [ ] **Step 7: Update `tests/e2e/homepage-handoff.spec.ts`**

The existing HEIC test expects navigation to `/tools/heic-to-png` and conversion to fire automatically. After this task, HEIC drops route to `/tools/image-convert` where the user must pick an output format. Update the test:

```ts
test("homepage HEIC drop hands off to image-convert; conversion fires after format selection", async ({
  page,
}) => {
  await page.goto("/");

  const input = page.locator('input[type="file"]');
  const fixture = path.resolve(__dirname, "../fixtures/sample.heic");
  await input.setInputFiles(fixture);

  await page.waitForURL("**/tools/image-convert");

  // ToolFrame holds the file in pendingFiles state because no output format
  // is selected. Conversion has NOT fired yet.
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");
  await expect(page.getByTestId("drop-zone")).toHaveAttribute("data-state", "disabled");

  // User selects PNG. The pending-files watcher fires conversion.
  await page.getByTestId("output-format").selectOption("png");

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: /^download / })).toBeVisible();
});
```

This replaces the previous HEIC test in homepage-handoff.spec.ts. The existing JPEG handoff test (added in Plan 2) stays untouched.

- [ ] **Step 8: Run all unit gates**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all exit 0. Test count: 76 (79 - 3 — heic-to-png/index.test.ts removed 3 tests). Build no longer emits the heic-to-png chunk; build output should list 4 routes (`/`, `/_not-found`, `/test-only/stub-runner`, `/tools/image-convert`).

- [ ] **Step 9: Run the full E2E suite to verify no regression**

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null; sleep 1
pnpm test:e2e --project=chromium --workers=1
```

Expected: all remaining E2E specs pass. Total spec count drops from 8 → 6 (removed: heic-to-png, privacy-regression-heic).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(engines): delete dedicated HEIC engine + route

HEIC capability consolidated into image-convert engine via the
shared decoder (Task 2). Dedicated HEIC engine, route, sidebar
entry, and E2E specs removed:
- src/engines/heic-to-png/ (engine, options, worker, tests)
- src/app/tools/heic-to-png/page.tsx
- tests/e2e/heic-to-png.spec.ts
- tests/e2e/privacy-regression-heic.spec.ts

Registry's EngineId union loses 'heic-to-png'. Sidebar IMAGES
group reduces to one entry (image-convert). Homepage routing now
sends HEIC drops to /tools/image-convert. homepage-handoff E2E
test updated to expect the new URL and the format-pick interaction
that was previously implicit on the dedicated HEIC route.

Bookmarked /tools/heic-to-png URLs now 404; documented in spec
§14 as acceptable for v1. Future redirect can be added if users
report broken bookmarks."
```

---

## Task 8: Install pdf-lib + image-to-pdf options module

**Goal:** Add pdf-lib dependency. Create `src/engines/image-to-pdf/options.ts` with TS types and constants for paper size + margin.

**Files:**
- Modify: `package.json`
- Create: `src/engines/image-to-pdf/options.ts`

- [ ] **Step 1: Install pdf-lib**

```bash
pnpm add pdf-lib@^1.17.0
```

This adds pdf-lib to dependencies. Verify with:

```bash
grep -E '"pdf-lib"' package.json
```

Expected: `"pdf-lib": "^1.17.0"` (or whatever the resolved version is).

- [ ] **Step 2: Write `src/engines/image-to-pdf/options.ts`**

```ts
export type ImageToPdfPaperSize = "letter" | "a4";

export type ImageToPdfOptions = {
  paper: ImageToPdfPaperSize;
};

export const defaultImageToPdfOptions: ImageToPdfOptions = {
  paper: "letter",
};

export const PAPER_DIMS: Record<ImageToPdfPaperSize, [number, number]> = {
  letter: [612, 792],
  a4: [595.28, 841.89],
};

export const PAGE_MARGIN = 12;
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 4: Verify the build still passes**

```bash
pnpm build
```

Expected: exit 0. pdf-lib is installed but not yet imported by any page-graph code; no new chunks expected yet.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/engines/image-to-pdf/options.ts
git commit -m "feat(engines): install pdf-lib + image-to-pdf options module

pdf-lib added at ^1.17.0 (~250 KB min+gz). Will be imported by
the image-to-pdf worker in Task 10 and reused by Plan 4's PDF
merge engine.

Options module: ImageToPdfOptions, defaults (paper=letter),
PAPER_DIMS map (Letter 612x792, A4 595.28x841.89 @ 72 DPI), and
PAGE_MARGIN=12 constants. The worker, OptionsPanel, and engine
descriptor in subsequent tasks all import from here."
```

---

## Task 9: image-to-pdf StagingArea component

**Goal:** Create `src/engines/image-to-pdf/staging-area.tsx` with text-row staging UI (page #, 32×32 thumbnail, filename, size, ↑↓× controls). Add unit tests.

**Files:**
- Create: `src/engines/image-to-pdf/staging-area.tsx`
- Create: `src/engines/image-to-pdf/staging-area.test.tsx`

- [ ] **Step 1: Write `src/engines/image-to-pdf/staging-area.tsx`**

```tsx
"use client";

import type { StagingAreaProps } from "@/engines/_shared/types";
import { decodeImage } from "@/engines/_shared/decode-image";
import { useEffect, useRef, useState } from "react";
import type { ImageToPdfOptions } from "./options";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function makeThumb(file: File): Promise<string> {
  const bitmap = await decodeImage(file);
  try {
    const canvas = new OffscreenCanvas(32, 32);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");
    // Fit-with-aspect, center on a black background.
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, 32, 32);
    const scale = Math.min(32 / bitmap.width, 32 / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    const x = (32 - w) / 2;
    const y = (32 - h) / 2;
    ctx.drawImage(bitmap, x, y, w, h);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return URL.createObjectURL(blob);
  } finally {
    bitmap.close();
  }
}

export function ImageToPdfStagingArea({
  files,
  onChange,
}: StagingAreaProps<ImageToPdfOptions>) {
  // Per-file thumbnail URLs. Keyed by File reference (Map for stability across reorder).
  const [thumbs, setThumbs] = useState<Map<File, string | "loading" | "error">>(new Map());
  const urlsToRevoke = useRef<string[]>([]);

  // Decode any new files that don't have thumbs yet.
  useEffect(() => {
    let cancelled = false;
    const newFiles = files.filter((f) => !thumbs.has(f));
    if (newFiles.length === 0) return;

    setThumbs((prev) => {
      const next = new Map(prev);
      for (const f of newFiles) next.set(f, "loading");
      return next;
    });

    Promise.all(
      newFiles.map(async (f) => {
        try {
          const url = await makeThumb(f);
          return { file: f, url };
        } catch {
          return { file: f, url: "error" as const };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setThumbs((prev) => {
        const next = new Map(prev);
        for (const r of results) {
          next.set(r.file, r.url);
          if (r.url !== "error") urlsToRevoke.current.push(r.url);
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [files, thumbs]);

  // Revoke thumb URLs when files are removed (or on unmount).
  useEffect(() => {
    return () => {
      for (const url of urlsToRevoke.current) URL.revokeObjectURL(url);
      urlsToRevoke.current = [];
    };
  }, []);

  // Also revoke thumbs of files that have been removed from the list.
  useEffect(() => {
    setThumbs((prev) => {
      const next = new Map<File, string | "loading" | "error">();
      for (const f of files) {
        const v = prev.get(f);
        if (v !== undefined) next.set(f, v);
      }
      // Revoke URLs of files no longer present.
      for (const [f, v] of prev) {
        if (!files.includes(f) && typeof v === "string" && v !== "error" && v !== "loading") {
          URL.revokeObjectURL(v);
        }
      }
      return next;
    });
  }, [files]);

  function moveUp(i: number) {
    if (i <= 0) return;
    const next = [...files];
    const tmp = next[i - 1]!;
    next[i - 1] = next[i]!;
    next[i] = tmp;
    onChange(next);
  }

  function moveDown(i: number) {
    if (i >= files.length - 1) return;
    const next = [...files];
    const tmp = next[i + 1]!;
    next[i + 1] = next[i]!;
    next[i] = tmp;
    onChange(next);
  }

  function remove(i: number) {
    onChange(files.filter((_, idx) => idx !== i));
  }

  return (
    <div
      data-testid="image-to-pdf-staging"
      className="mb-3 border border-[var(--color-hairline)] divide-y divide-[var(--color-hairline)]"
    >
      {files.map((f, i) => {
        const thumb = thumbs.get(f);
        return (
          <div
            key={`${f.name}-${i}`}
            data-testid="staging-row"
            className="flex items-center gap-3 px-3 py-2 text-[var(--text-xs)]"
          >
            <span className="w-6 text-right text-[var(--color-accent)] tabular-nums">{i + 1}</span>
            <div className="h-8 w-8 flex-shrink-0 border border-[var(--color-hairline)] bg-[var(--color-bg)]">
              {thumb && thumb !== "loading" && thumb !== "error" && (
                <img src={thumb} alt="" className="h-full w-full object-contain" />
              )}
              {thumb === "error" && (
                <span className="flex h-full w-full items-center justify-center text-[var(--color-fg-very-muted)]">
                  ?
                </span>
              )}
            </div>
            <span className="flex-1 truncate text-[var(--color-fg)]" title={f.name}>
              {f.name}
            </span>
            <span className="text-[var(--color-fg-muted)] tabular-nums">{formatSize(f.size)}</span>
            <button
              type="button"
              data-testid="move-up"
              onClick={() => moveUp(i)}
              disabled={i === 0}
              className="border border-[var(--color-hairline)] px-2 py-0.5 text-[var(--color-fg-muted)] disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              data-testid="move-down"
              onClick={() => moveDown(i)}
              disabled={i === files.length - 1}
              className="border border-[var(--color-hairline)] px-2 py-0.5 text-[var(--color-fg-muted)] disabled:opacity-30"
            >
              ↓
            </button>
            <button
              type="button"
              data-testid="remove"
              onClick={() => remove(i)}
              className="border border-[var(--color-hairline)] px-2 py-0.5 text-[var(--color-fg-muted)]"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
```

Notes:
- Per-file thumbnail decoding via `decodeImage` (the shared utility from Task 1). Lazy: only files newly added trigger decode; existing ones reuse cached URLs.
- Thumbnails are 32×32 with letterboxing (`fillRect` background + scaled `drawImage`). Fit-with-aspect; no crop.
- URL.createObjectURL → revoked on unmount AND when a file is removed from the list.
- Decode failure falls back to a `?` placeholder; row still works.
- ↑/↓ disabled at boundaries; × removes.
- The `key={`${f.name}-${i}`}` is composite to handle duplicate filenames (allowed; users may stage the same image twice intentionally).

- [ ] **Step 2: Write `src/engines/image-to-pdf/staging-area.test.tsx`**

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultImageToPdfOptions } from "./options";

vi.mock("@/engines/_shared/decode-image", () => ({
  decodeImage: vi.fn(async () => {
    // Return a minimal stub ImageBitmap-like object the staging area's
    // makeThumb path treats correctly. Since OffscreenCanvas isn't real
    // in jsdom, makeThumb will throw and the row falls back to error.
    // The reorder/remove tests don't depend on thumb success.
    throw new Error("stubbed decode failure for tests");
  }),
}));

import { ImageToPdfStagingArea } from "./staging-area";

afterEach(() => vi.clearAllMocks());

function makeFile(name: string, size: number = 100): File {
  return new File([new Uint8Array(size)], name, { type: "image/png" });
}

describe("ImageToPdfStagingArea", () => {
  it("renders one row per file with page number, name, and size", () => {
    const files = [makeFile("a.png"), makeFile("b.png"), makeFile("c.png")];
    render(
      <ImageToPdfStagingArea
        files={files}
        onChange={() => undefined}
        options={defaultImageToPdfOptions}
      />,
    );
    expect(screen.getAllByTestId("staging-row")).toHaveLength(3);
    expect(screen.getByText("a.png")).toBeInTheDocument();
    expect(screen.getByText("b.png")).toBeInTheDocument();
    expect(screen.getByText("c.png")).toBeInTheDocument();
  });

  it("disables move-up on the first row and move-down on the last row", () => {
    const files = [makeFile("a.png"), makeFile("b.png"), makeFile("c.png")];
    render(
      <ImageToPdfStagingArea
        files={files}
        onChange={() => undefined}
        options={defaultImageToPdfOptions}
      />,
    );
    const upButtons = screen.getAllByTestId("move-up");
    const downButtons = screen.getAllByTestId("move-down");
    expect(upButtons[0]).toBeDisabled();
    expect(upButtons[1]).not.toBeDisabled();
    expect(upButtons[2]).not.toBeDisabled();
    expect(downButtons[0]).not.toBeDisabled();
    expect(downButtons[1]).not.toBeDisabled();
    expect(downButtons[2]).toBeDisabled();
  });

  it("move-up swaps with the previous row", () => {
    const files = [makeFile("a.png"), makeFile("b.png"), makeFile("c.png")];
    const onChange = vi.fn();
    render(
      <ImageToPdfStagingArea
        files={files}
        onChange={onChange}
        options={defaultImageToPdfOptions}
      />,
    );
    const upButtons = screen.getAllByTestId("move-up");
    fireEvent.click(upButtons[1]!);
    expect(onChange).toHaveBeenCalledWith([files[1], files[0], files[2]]);
  });

  it("move-down swaps with the next row", () => {
    const files = [makeFile("a.png"), makeFile("b.png"), makeFile("c.png")];
    const onChange = vi.fn();
    render(
      <ImageToPdfStagingArea
        files={files}
        onChange={onChange}
        options={defaultImageToPdfOptions}
      />,
    );
    const downButtons = screen.getAllByTestId("move-down");
    fireEvent.click(downButtons[0]!);
    expect(onChange).toHaveBeenCalledWith([files[1], files[0], files[2]]);
  });

  it("remove drops the row from the list", () => {
    const files = [makeFile("a.png"), makeFile("b.png"), makeFile("c.png")];
    const onChange = vi.fn();
    render(
      <ImageToPdfStagingArea
        files={files}
        onChange={onChange}
        options={defaultImageToPdfOptions}
      />,
    );
    const removes = screen.getAllByTestId("remove");
    fireEvent.click(removes[1]!);
    expect(onChange).toHaveBeenCalledWith([files[0], files[2]]);
  });

  it("falls back to ? placeholder when thumbnail decode fails", async () => {
    const files = [makeFile("a.png")];
    render(
      <ImageToPdfStagingArea
        files={files}
        onChange={() => undefined}
        options={defaultImageToPdfOptions}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("?")).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 3: Run unit gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all exit 0. Test count: 82 (76 + 6 new staging-area tests).

- [ ] **Step 4: Commit**

```bash
git add src/engines/image-to-pdf/staging-area.tsx src/engines/image-to-pdf/staging-area.test.tsx
git commit -m "feat(engines): image-to-pdf StagingArea component

Text-row staging UI: page #, 32x32 thumbnail (decoded via shared
decoder), filename, size, ↑↓× controls. Per-file thumb URL
lifecycle: decoded lazily on first encounter, cached in a Map,
revoked on unmount and when files are removed from the list.

Decode failure falls back to a ? placeholder; row still
functional. ↑/↓ disabled at list boundaries.

6 unit tests cover: row rendering, boundary disabled states,
move-up swap, move-down swap, remove, and decode-failure
placeholder."
```

---

## Task 10: image-to-pdf worker

**Goal:** Worker decodes each input via shared decoder, embeds as PNG in a pdf-lib document, sizes pages by paper × auto-orientation, scales images fit-to-page minus 12px margin, returns a single combined PDF as `OutputItem`.

**Files:**
- Create: `src/engines/image-to-pdf/worker.ts`

- [ ] **Step 1: Write `src/engines/image-to-pdf/worker.ts`**

```ts
import * as Comlink from "comlink";
import { PDFDocument } from "pdf-lib";
import type { OutputItem } from "@/engines/_shared/types";
import { decodeImage } from "@/engines/_shared/decode-image";
import { PAGE_MARGIN, PAPER_DIMS, type ImageToPdfOptions } from "./options";

const api = {
  async convertMulti(
    filesAsBytes: ArrayBuffer[],
    names: string[],
    types: string[],
    opts: ImageToPdfOptions,
  ): Promise<OutputItem> {
    if (filesAsBytes.length === 0) {
      throw new Error("image-to-pdf: no input files");
    }

    const pdf = await PDFDocument.create();
    const [paperW, paperH] = PAPER_DIMS[opts.paper];

    for (let i = 0; i < filesAsBytes.length; i++) {
      const blob = new Blob([filesAsBytes[i]!], { type: types[i] });
      const file = new File([blob], names[i] ?? `page-${i + 1}`, { type: types[i] });

      const bitmap = await decodeImage(file);
      try {
        const isLandscape = bitmap.width > bitmap.height;
        const pageW = isLandscape ? Math.max(paperW, paperH) : Math.min(paperW, paperH);
        const pageH = isLandscape ? Math.min(paperW, paperH) : Math.max(paperW, paperH);

        // Re-encode as PNG for pdf-lib's embedPng. Lossless.
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");
        ctx.drawImage(bitmap, 0, 0);
        const pngBlob = await canvas.convertToBlob({ type: "image/png" });
        const pngBytes = await pngBlob.arrayBuffer();
        const embedded = await pdf.embedPng(pngBytes);

        const page = pdf.addPage([pageW, pageH]);
        const availW = pageW - 2 * PAGE_MARGIN;
        const availH = pageH - 2 * PAGE_MARGIN;
        const scale = Math.min(availW / bitmap.width, availH / bitmap.height);
        const drawW = bitmap.width * scale;
        const drawH = bitmap.height * scale;
        const x = (pageW - drawW) / 2;
        const y = (pageH - drawH) / 2;
        page.drawImage(embedded, { x, y, width: drawW, height: drawH });
      } finally {
        bitmap.close();
      }
    }

    const pdfBytes = await pdf.save();
    return {
      filename: "combined.pdf",
      mime: "application/pdf",
      blob: new Blob([pdfBytes as BlobPart], { type: "application/pdf" }),
    };
  },
};

Comlink.expose(api);
```

Notes:
- `pdf-lib`'s `embedPng` requires raw PNG bytes; we re-encode every input via OffscreenCanvas. Lossless for all input formats.
- Page sized by paper + auto-orientation; image scaled to fit available space (paper minus 2× margin), preserving aspect ratio, centered.
- `bitmap.close()` in `finally` releases GPU memory.
- The `as BlobPart` cast is defensive — `pdf.save()` returns `Uint8Array`, which is a `BlobPart` per modern TS lib types but may not be in older configs.

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 3: Verify the worker compiles for the browser target via the engine-module probe**

Important: do NOT add `import "@/engines/image-to-pdf/worker"` to page.tsx — that triggers Comlink.expose at SSR time and the build fails (Plan 2 documented this). The correct probe imports the engine MODULE, but the engine descriptor doesn't exist yet (lands in Task 12). For this task, defer the build probe to Task 12's verify steps.

Run a vanilla build to confirm no spurious failures from the worker file's existence:

```bash
pnpm build
```

Expected: exit 0. The build doesn't yet emit an image-to-pdf worker chunk because nothing imports the worker (the engine descriptor in Task 12 will). That's fine.

- [ ] **Step 4: Commit**

```bash
git add src/engines/image-to-pdf/worker.ts
git commit -m "feat(engines): image-to-pdf worker

Decodes each input via shared decoder, re-encodes as PNG (always
lossless), embeds in a pdf-lib PDFDocument. Page sized by paper
× auto-orientation (landscape image -> landscape page), image
scaled to fit-with-aspect inside (paper - 2*12px margin),
centered.

Strict-abort error handling: any thrown error in the loop bubbles
up; harness rejects; ToolFrame surfaces the message and aborts.
No skip-and-continue.

Worker-level build probe deferred to Task 12 (engine-module
import is the correct probe pattern; importing the worker file
directly triggers Comlink.expose at SSR time)."
```

---

## Task 11: image-to-pdf OptionsPanel

**Goal:** `src/engines/image-to-pdf/options-panel.tsx` — single `<select>` for paper size. Add unit tests.

**Files:**
- Create: `src/engines/image-to-pdf/options-panel.tsx`
- Create: `src/engines/image-to-pdf/options-panel.test.tsx`

- [ ] **Step 1: Write `src/engines/image-to-pdf/options-panel.tsx`**

```tsx
"use client";

import type { OptionsPanelProps } from "@/engines/_shared/types";
import type { ImageToPdfOptions, ImageToPdfPaperSize } from "./options";

const PAPERS: ImageToPdfPaperSize[] = ["letter", "a4"];

export function ImageToPdfOptionsPanel({
  value,
  onChange,
}: OptionsPanelProps<ImageToPdfOptions>) {
  return (
    <div
      data-testid="image-to-pdf-options"
      className="mb-3 flex flex-wrap items-center gap-4 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        paper:
        <select
          data-testid="paper-size"
          value={value.paper}
          onChange={(e) => onChange({ ...value, paper: e.target.value as ImageToPdfPaperSize })}
          className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase"
        >
          {PAPERS.map((p) => (
            <option key={p} value={p}>
              {p.toUpperCase()}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/engines/image-to-pdf/options-panel.test.tsx`**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultImageToPdfOptions } from "./options";
import { ImageToPdfOptionsPanel } from "./options-panel";

describe("ImageToPdfOptionsPanel", () => {
  it("renders the paper-size select with letter selected by default", () => {
    render(
      <ImageToPdfOptionsPanel value={defaultImageToPdfOptions} onChange={() => undefined} />,
    );
    expect(screen.getByTestId("paper-size")).toHaveValue("letter");
  });

  it("calls onChange with the new paper size when select changes", () => {
    const onChange = vi.fn();
    render(<ImageToPdfOptionsPanel value={defaultImageToPdfOptions} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("paper-size"), { target: { value: "a4" } });
    expect(onChange).toHaveBeenCalledWith({ paper: "a4" });
  });

  it("renders both letter and a4 options", () => {
    render(
      <ImageToPdfOptionsPanel value={defaultImageToPdfOptions} onChange={() => undefined} />,
    );
    const select = screen.getByTestId("paper-size") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["letter", "a4"]);
  });
});
```

- [ ] **Step 3: Run unit gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all exit 0. Test count: 85 (82 + 3).

- [ ] **Step 4: Commit**

```bash
git add src/engines/image-to-pdf/options-panel.tsx src/engines/image-to-pdf/options-panel.test.tsx
git commit -m "feat(engines): image-to-pdf OptionsPanel

Single <select> for paper size (letter | a4). 3 unit tests cover
the default render, paper-size change, and option enumeration."
```

---

## Task 12: image-to-pdf engine descriptor + registry entry

**Goal:** Wire the engine descriptor (validate, convert, OptionsPanel, StagingArea, cardinality=multi). Register in the engine registry. Add metadata + validation tests. Run the engine-module build probe (deferred from Task 10).

**Files:**
- Create: `src/engines/image-to-pdf/index.ts`
- Create: `src/engines/image-to-pdf/index.test.ts`
- Modify: `src/engines/_shared/registry.ts`
- Modify: `src/engines/_shared/registry.test.ts`

- [ ] **Step 1: Write `src/engines/image-to-pdf/index.ts`**

```ts
import { detectMime } from "@/engines/_shared/file-detection";
import { WorkerHarness } from "@/engines/_shared/harness";
import type { MultiInputEngine, OutputItem } from "@/engines/_shared/types";
import { type ImageToPdfOptions, defaultImageToPdfOptions } from "./options";
import { ImageToPdfOptionsPanel } from "./options-panel";
import { ImageToPdfStagingArea } from "./staging-area";

const SUPPORTED_INPUT_MIMES = [
  "image/heic",
  "image/heif",
  "image/png",
  "image/jpeg",
  "image/webp",
];

const engine: MultiInputEngine<ImageToPdfOptions, OutputItem> = {
  id: "image-to-pdf",
  inputAccept: [".heic", ".heif", ".png", ".jpg", ".jpeg", ".webp"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "application/pdf",
  defaultOptions: defaultImageToPdfOptions,
  convertButtonLabel: "[ convert to pdf ]",
  cardinality: "multi",
  OptionsPanel: ImageToPdfOptionsPanel,
  StagingArea: ImageToPdfStagingArea,
  async validate(files) {
    if (files.length === 0) {
      return { ok: false, reason: "Drop at least one image" };
    }
    const mimes = await Promise.all(files.map(detectMime));
    const allValid = mimes.every((m) => SUPPORTED_INPUT_MIMES.includes(m));
    if (!allValid) {
      return { ok: false, reason: "All files must be PNG, JPEG, WebP, or HEIC" };
    }
    return { ok: true };
  },
  async convert(files, opts, signal) {
    const harness = new WorkerHarness<ImageToPdfOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    );
    return await harness.runMulti(files, opts, signal);
  },
};

export default engine;
```

- [ ] **Step 2: Write `src/engines/image-to-pdf/index.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import engine from "./index";

describe("image-to-pdf engine metadata", () => {
  it("declares correct id, accept lists, and cardinality", () => {
    expect(engine.id).toBe("image-to-pdf");
    expect(engine.inputAccept).toEqual([".heic", ".heif", ".png", ".jpg", ".jpeg", ".webp"]);
    expect(engine.inputMime).toEqual([
      "image/heic", "image/heif", "image/png", "image/jpeg", "image/webp",
    ]);
    expect(engine.cardinality).toBe("multi");
    expect(engine.outputMime).toBe("application/pdf");
  });

  it("declares both OptionsPanel and StagingArea components", () => {
    expect(engine.OptionsPanel).toBeDefined();
    expect(engine.StagingArea).toBeDefined();
  });

  it("rejects an empty file list", async () => {
    const r = await engine.validate([], engine.defaultOptions);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/at least one/i);
  });

  it("accepts a single supported image", async () => {
    const f = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    const r = await engine.validate([f], engine.defaultOptions);
    expect(r.ok).toBe(true);
  });

  it("accepts a mixed-format set", async () => {
    const heic = new File([new Uint8Array([1])], "z.heic", { type: "image/heic" });
    const png = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    const jpg = new File([new Uint8Array([1])], "b.jpg", { type: "image/jpeg" });
    const webp = new File([new Uint8Array([1])], "c.webp", { type: "image/webp" });
    const r = await engine.validate([heic, png, jpg, webp], engine.defaultOptions);
    expect(r.ok).toBe(true);
  });

  it("rejects a set containing one non-image", async () => {
    const png = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    const txt = new File([new Uint8Array([1])], "b.txt", { type: "text/plain" });
    const r = await engine.validate([png, txt], engine.defaultOptions);
    expect(r.ok).toBe(false);
  });
});
```

`detectMime`'s default behavior trusts `file.type` when non-empty, so the validate tests work without polyfilling magic-byte parsing.

- [ ] **Step 3: Update `src/engines/_shared/registry.ts`**

Add `"image-to-pdf"` to the EngineId union and the registry table:

```ts
import type { ConversionEngine, OutputItem } from "./types";

export type EngineId = "image-convert" | "image-to-pdf";

// biome-ignore lint/suspicious/noExplicitAny: registry erases per-engine TOptions
type AnyEngine = ConversionEngine<any, OutputItem | OutputItem[]>;

type Loader = () => Promise<{ default: AnyEngine }>;

const REGISTRY: Record<EngineId, Loader> = {
  "image-convert": () => import("@/engines/image-convert"),
  "image-to-pdf": () => import("@/engines/image-to-pdf"),
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

```ts
  it("loadEngine returns the image-to-pdf engine module", async () => {
    const e = await loadEngine("image-to-pdf");
    expect(e.id).toBe("image-to-pdf");
    expect(e.cardinality).toBe("multi");
  });
```

- [ ] **Step 5: Run all unit gates**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all exit 0. Test count: 92 (85 + 6 image-to-pdf engine tests + 1 registry positive-path).

- [ ] **Step 5b: Engine-module build probe**

Force the build to pull `@/engines/image-to-pdf` into the page graph so Webpack resolves the worker URL and emits the worker chunk.

Add a temporary import to `src/app/page.tsx` (line 1, BEFORE any other imports):

```ts
import "@/engines/image-to-pdf";
```

Run `pnpm build`. Expected: exit 0; build emits a new `image-to-pdf` worker chunk alongside the existing image-convert chunk.

If the build fails on `Module not found: Can't resolve 'fs'` or similar, the worker has pulled in a Node-only path through pdf-lib — investigate. (pdf-lib is browser-friendly; this should not happen.)

After the build succeeds:

```bash
git checkout -- src/app/page.tsx
```

Confirm `git status` shows the four expected files staged: `src/engines/image-to-pdf/index.ts`, `src/engines/image-to-pdf/index.test.ts`, `src/engines/_shared/registry.ts`, `src/engines/_shared/registry.test.ts`. Tree is otherwise clean.

- [ ] **Step 6: Commit**

```bash
git add src/engines/image-to-pdf/index.ts src/engines/image-to-pdf/index.test.ts src/engines/_shared/registry.ts src/engines/_shared/registry.test.ts
git commit -m "feat(engines): image-to-pdf descriptor + registry entry

MultiInputEngine wired with OptionsPanel + StagingArea + validate
+ convert. validate cases: empty rejects, single image accepts,
mixed-format set accepts, set with one non-image rejects.

Registry's EngineId union gains 'image-to-pdf'; loadEngine
positive-path test covers the dynamic import.

Engine-module build probe (Task 10's deferred verification)
confirmed: Webpack emits the new worker chunk alongside the
existing image-convert chunk."
```

---

## Task 13: image-to-pdf route + sidebar entry + multi-file homepage routing

**Goal:** New page at `/tools/image-to-pdf`. Sidebar gains a second IMAGES entry. Homepage routes 2+ image drops to the new tool via `stageFiles(files)`.

**Files:**
- Create: `src/app/tools/image-to-pdf/page.tsx`
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Write `src/app/tools/image-to-pdf/page.tsx`**

```tsx
"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/image-to-pdf";

export default function ImageToPdfPage() {
  return <ToolFrame engine={engine} />;
}
```

`"use client"` is required because the engine descriptor contains function values (`validate`, `convert`, etc.) that can't cross the RSC boundary — same constraint as `/tools/image-convert`.

- [ ] **Step 2: Update `src/components/layout/sidebar.tsx`**

Append the image-to-pdf entry:

```ts
const TOOLS: ToolEntry[] = [
  { id: "image-convert", href: "/tools/image-convert", label: "image convert", group: "IMAGES" },
  { id: "image-to-pdf", href: "/tools/image-to-pdf", label: "image→pdf", group: "IMAGES" },
];
```

- [ ] **Step 3: Update `src/app/page.tsx`**

Extend `handleFiles` to route multi-file drops to image-to-pdf:

```tsx
async function handleFiles(files: File[]) {
  setError(null);
  if (files.length === 0) return;

  const mimes = await Promise.all(files.map(detectMime));
  const SUPPORTED = new Set([
    "image/heic",
    "image/heif",
    "image/png",
    "image/jpeg",
    "image/webp",
  ]);
  const allImages = mimes.every((m) => SUPPORTED.has(m));

  if (!allImages) {
    setError("No tool for this file type yet. Phase 3 supports HEIC, PNG, JPEG, WebP.");
    return;
  }

  if (files.length >= 2) {
    stageFiles(files);
    router.push("/tools/image-to-pdf");
    return;
  }

  // Single file: HEIC + PNG/JPEG/WebP all → image-convert (post-consolidation)
  stageFiles(files);
  router.push("/tools/image-convert");
}
```

- [ ] **Step 4: Run unit + build gates**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all exit 0. Build should emit 5 routes: `/`, `/_not-found`, `/test-only/stub-runner`, `/tools/image-convert`, `/tools/image-to-pdf`.

- [ ] **Step 5: Visual sanity check via curl**

Start `pnpm dev` in the background, then:

```bash
curl -sS http://localhost:3000/tools/image-to-pdf | grep -o "image-to-pdf"
curl -sS http://localhost:3000/ | grep -o "image→pdf"
```

Expected: first curl returns `image-to-pdf` (tool ID rendered in the ToolFrame header); second returns `image→pdf` (sidebar label visible on the homepage via the layout shell). Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/app/tools/image-to-pdf src/components/layout/sidebar.tsx src/app/page.tsx
git commit -m "feat(ui): image-to-pdf route + sidebar + multi-file routing

Mounts ToolFrame with the image-to-pdf engine at
/tools/image-to-pdf. Sidebar IMAGES group regains a second entry
(image→pdf). Homepage MIME-detect routes 2+ supported image files
to /tools/image-to-pdf via stageFiles(files); single-file drops
continue to image-convert."
```

---

## Task 14: New E2E specs — image-to-pdf happy path + privacy + multi-file handoff

**Goal:** Three new Playwright specs covering the multi-input flow end-to-end, the privacy regression for image-to-pdf, and the homepage multi-file handoff.

**Files:**
- Create: `tests/e2e/image-to-pdf.spec.ts`
- Create: `tests/e2e/privacy-regression-image-to-pdf.spec.ts`
- Create: `tests/e2e/multi-file-handoff.spec.ts`

- [ ] **Step 1: Write `tests/e2e/image-to-pdf.spec.ts`**

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("multi-image drop produces a downloadable PDF (happy path)", async ({ page }) => {
  await page.goto("/tools/image-to-pdf");

  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");
  await expect(page.getByTestId("convert-button")).toBeDisabled();

  const input = page.locator('input[type="file"]');
  await input.setInputFiles([
    path.resolve(__dirname, "../fixtures/sample.png"),
    path.resolve(__dirname, "../fixtures/sample.jpg"),
    path.resolve(__dirname, "../fixtures/sample.webp"),
  ]);

  await expect(page.getByTestId("image-to-pdf-staging")).toBeVisible();
  await expect(page.getByTestId("staging-row")).toHaveCount(3);
  await expect(page.getByTestId("convert-button")).not.toBeDisabled();

  // Reorder: move the second row up.
  const upButtons = page.getByTestId("move-up");
  await upButtons.nth(1).click();

  // Click Convert.
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByTestId("convert-button").click();

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });

  const downloadButton = page.getByRole("button", { name: /^download / });
  await expect(downloadButton).toBeVisible();
  await downloadButton.click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  const dlPath = await download.path();
  const bytes = await readFile(dlPath);
  // %PDF- magic bytes.
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(1000);
});

test("HEIC + PNG mix produces a downloadable PDF (shared decoder)", async ({ page }) => {
  await page.goto("/tools/image-to-pdf");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles([
    path.resolve(__dirname, "../fixtures/sample.heic"),
    path.resolve(__dirname, "../fixtures/sample.png"),
  ]);

  await expect(page.getByTestId("staging-row")).toHaveCount(2);

  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });
  await page.getByRole("button", { name: /^download / }).click();
  const download = await downloadPromise;
  const dlPath = await download.path();
  const bytes = await readFile(dlPath);
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
});
```

Notes:
- The first test exercises drop → staging → reorder → convert → download → PDF magic bytes.
- The second test specifically covers the shared decoder's HEIC path within image-to-pdf.

- [ ] **Step 2: Write `tests/e2e/privacy-regression-image-to-pdf.spec.ts`**

```ts
import path from "node:path";
import { expect, test } from "@playwright/test";

test("multi-image PDF conversion produces zero outbound network requests beyond initial load", async ({
  page,
}) => {
  const PAGE_PATH = "/tools/image-to-pdf";

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

  // Use a HEIC + PNG mix to exercise the lazy libheif load path.
  const input = page.locator('input[type="file"]');
  await input.setInputFiles([
    path.resolve(__dirname, "../fixtures/sample.heic"),
    path.resolve(__dirname, "../fixtures/sample.png"),
  ]);

  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });
  await page.waitForLoadState("networkidle");

  expect(
    conversionRequests,
    `image-to-pdf made off-origin requests: ${conversionRequests.join(", ")}`,
  ).toEqual([]);
  expect(
    conversionWebSockets,
    `image-to-pdf opened off-origin WebSockets: ${conversionWebSockets.join(", ")}`,
  ).toEqual([]);
});
```

WebSocket comparison uses `host` (PR #2 fix) to avoid the dev-server HMR socket flagging as off-origin.

- [ ] **Step 3: Write `tests/e2e/multi-file-handoff.spec.ts`**

```ts
import path from "node:path";
import { expect, test } from "@playwright/test";

test("homepage multi-file drop hands off to image-to-pdf with files staged", async ({ page }) => {
  await page.goto("/");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles([
    path.resolve(__dirname, "../fixtures/sample.png"),
    path.resolve(__dirname, "../fixtures/sample.jpg"),
    path.resolve(__dirname, "../fixtures/sample.webp"),
  ]);

  // Cross-route handoff to image-to-pdf with files populated in staging.
  await page.waitForURL("**/tools/image-to-pdf");

  await expect(page.getByTestId("image-to-pdf-staging")).toBeVisible();
  await expect(page.getByTestId("staging-row")).toHaveCount(3);

  // Convert button is enabled (paper has a default value, ready=true).
  const convertButton = page.getByTestId("convert-button");
  await expect(convertButton).not.toBeDisabled();

  await convertButton.click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: /^download / })).toBeVisible();
});
```

- [ ] **Step 4: Run the new specs**

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null; sleep 1
pnpm test:e2e --project=chromium --workers=1 \
  tests/e2e/image-to-pdf.spec.ts \
  tests/e2e/privacy-regression-image-to-pdf.spec.ts \
  tests/e2e/multi-file-handoff.spec.ts
```

Expected: 4 tests pass (2 image-to-pdf + 1 privacy + 1 multi-handoff). `--workers=1` to avoid the libheif cold-start race when HEIC fixtures are involved.

- [ ] **Step 5: Run the full E2E suite to verify no regression**

```bash
pnpm test:e2e --project=chromium --workers=1
```

Expected: all specs pass. Total spec count: 9 (was 6 after Task 7 deletions; +3 from this task).

- [ ] **Step 6: Run the full unit suite as the final regression check**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all exit 0; total 92 unit tests.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/image-to-pdf.spec.ts tests/e2e/privacy-regression-image-to-pdf.spec.ts tests/e2e/multi-file-handoff.spec.ts
git commit -m "test(e2e): image-to-pdf happy path + privacy + handoff

Three new browser-driven specs.

image-to-pdf.spec.ts: drop 3 mixed-format images, reorder via ↑,
click Convert, assert PDF download with %PDF- signature. Second
test: HEIC + PNG mix to verify the shared decoder's HEIC path
inside image-to-pdf's worker.

privacy-regression-image-to-pdf.spec.ts: HEIC + PNG conversion
produces zero off-origin requests/WebSockets. Same listener
pattern as Plan 1+2 privacy specs; host-comparison on WebSockets
per PR #2.

multi-file-handoff.spec.ts: drop 3 PNGs on /, expect navigation
to /tools/image-to-pdf with files staged in the StagingArea,
click Convert, assert PDF download. Exercises the multi-
cardinality cross-route handoff that Task 6 wired."
```

---

## Phase 3 close-out

After Task 14 commits clean and CI is green:

- Open PR `phase-3-image-to-pdf → main` with a structured Summary + Test plan + Deferred-items section.
- After merge, deploy auto-builds. Sanity-click the live URL: drop 3 images on `/`, expect handoff to image-to-pdf, pick a paper size if you want, click Convert, download the PDF.
- Phase 6 hardening backlog (carried from Plan 1+2, plus new):
  - libheif `Critical dependency` webpack warning still present (now triggered by both image-convert worker AND image-to-pdf worker)
  - `script-src 'unsafe-inline'` still in CSP
  - ToolFrame in-flight-conversion race (drops while converting)
  - bundle-size budget — pdf-lib adds ~250 KB; libheif baseline 1.46 MB still dominant
  - Phase 6 candidate: build-time hash injection for inline scripts; engine-chaining infrastructure (C2/C3 from spec brainstorm); image-dimension validate guard

---

## Self-review — spec coverage check

- ✓ Spec §1.1 image-to-pdf engine — Tasks 8, 10, 11, 12, 13, 14
- ✓ Spec §1.2 HEIC consolidation — Tasks 2, 3, 7
- ✓ Spec §3.1 shared decoder — Task 1
- ✓ Spec §3.2 StagingArea engine-pattern extension — Task 5
- ✓ Spec §3.3 image-to-pdf engine descriptor — Task 12
- ✓ Spec §3.4 image-convert refactor — Task 2
- ✓ Spec §3.5 HEIC engine removal — Task 7
- ✓ Spec §4 image-to-pdf options — Task 8
- ✓ Spec §5.1 StagingArea component — Task 9
- ✓ Spec §5.2 ToolFrame multi-cardinality plumbing — Task 6
- ✓ Spec §5.3 Convert button visual — Task 6 (rendered in tool-frame.tsx)
- ✓ Spec §5.4 DropZone behavior — already supported (Plan 2's DropZone has `multiple` prop; multi-handling lives in ToolFrame's `handleDrop`)
- ✓ Spec §6 worker — Task 10
- ✓ Spec §7 cross-route handoff API change — Task 4
- ✓ Spec §8 homepage routing rules — Task 7 (HEIC consolidation routing) + Task 13 (multi-file routing)
- ✓ Spec §9 sidebar — Task 7 (HEIC removal) + Task 13 (image-to-pdf addition)
- ✓ Spec §10 validation — Task 12 (image-to-pdf), Task 2 (image-convert HEIC)
- ✓ Spec §11 output — Task 10 (worker returns combined.pdf)
- ✓ Spec §12 privacy — Tasks 3, 14 (specs); enforced by existing Biome rule
- ✓ Spec §13 testing strategy — Tasks 1, 5, 6, 9, 11, 12, 14 (unit); Tasks 3, 7, 14 (E2E updates + new)
- ✓ Spec §14 edge cases — documented; behavior consistent with task implementations
- ✓ Spec §15 plan structure preview — matches the 14 tasks in this plan
- ✓ Spec §16 future scope — captured in Phase 6 close-out backlog above
- ✓ Spec §17 success criteria — verified by Tasks 12, 13, 14 (criteria 1-4) and final regression sweep (criteria 5-8)
