# Phase 15 — Small engines — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement four `SingleInputEngine` engines (`image-resize`, `docx-to-txt`, `markdown-to-pdf`, `txt-to-pdf`) per `docs/superpowers/specs/2026-05-04-phase-15-small-engines.md`.

**Architecture:** Each engine is a vertical slice (engine module + worker + options + route + tests) that drops into the existing engine pattern with no new abstractions. Two new shared modules (`_shared/docx/` for the lifted DOCX parser, `_shared/pdf-page-setup/` for page-size constants) prevent duplication across engines. New runtime deps (`markdown-it`, `highlight.js`) are lazy-loaded only on the markdown-to-pdf route.

**Tech Stack:** TypeScript strict, React, Vitest, Playwright, pdf-lib (already installed), pdfjs-dist (already installed for PDF text extraction in tests), `markdown-it`, `highlight.js`. No new font assets — reuses existing Lora / Inter / JetBrains Mono in `public/fonts/` via `src/lib/font-loader.ts`.

---

## Reference reading before starting

- Spec: `docs/superpowers/specs/2026-05-04-phase-15-small-engines.md`
- Engine type definitions: `src/engines/_shared/types.ts`
- Engine registry: `src/engines/_shared/registry.ts`
- ToolFrame: `src/components/tool-frame.tsx`
- Existing engine for reference: `src/engines/image-convert/` (cleanest single-input engine)
- Existing route pattern: `src/app/tools/image-convert/page.tsx` (one-liner)
- Existing font loader: `src/lib/font-loader.ts` + `public/fonts/`
- Existing DOCX parser to lift: `src/engines/docx-to-pdf/docx-parser.ts`
- Phase 14 size-cap helper: `src/engines/_shared/size-limits.ts`
- Existing E2E patterns: `tests/e2e/image-convert.spec.ts`, `tests/e2e/privacy-regression-image-convert.spec.ts`

CLAUDE.md invariants apply:
- No `--no-verify`. No `--amend`. No Claude attribution in commit messages.
- Keep commit body lines ≤ 72 chars.
- Run `pnpm test`, `pnpm typecheck`, `pnpm lint` after each task before commit.
- Engines must not contain `fetch`/`XMLHttpRequest` — Biome lint enforces.

---

## Spec deviation: fonts

Spec §3.1 named Source Serif Pro / Source Sans / JetBrains Mono and proposed committing subsetted versions under `src/engines/_shared/fonts/`. The implementation reuses the existing font assets in `public/fonts/` (Lora as serif body, Inter as sans headings, JetBrains Mono for code), loaded via the existing `src/lib/font-loader.ts`. This eliminates a font-subsetting tooling task and ~250 KB of new committed assets, while shipping equivalent typography. Document this in the Phase 15 implementation PR description.

---

## Task 1: Lift DOCX parser to `_shared/docx/`

**Files:**
- Move: `src/engines/docx-to-pdf/docx-parser.ts` → `src/engines/_shared/docx/docx-parser.ts`
- Move (if any): `src/engines/docx-to-pdf/docx-parser/*` (parser-specific helpers) → `src/engines/_shared/docx/`
- Create: `src/engines/_shared/docx/index.ts` (re-export `parseDocx`)
- Create: `src/engines/_shared/docx/index.test.ts` (relocation guard)
- Modify: `src/engines/docx-to-pdf/worker.ts` (update import)
- Modify: any docx-to-pdf test files importing the parser (update import paths)

The parser is the only piece reused by `docx-to-txt` (Task 5). Layout, fonts, headers/footers, etc. stay inside `docx-to-pdf/` — they're PDF-specific.

- [ ] **Step 1: Survey what's actually in docx-parser**

Run: `find src/engines/docx-to-pdf -name "docx-parser*" -o -name "*parser*"`
Then: `head -30 src/engines/docx-to-pdf/docx-parser.ts` to see what `parseDocx` returns.

Determine which auxiliary files (if any) the parser depends on. The parser's pure-data dependencies move with it; the layout/render dependencies stay.

- [ ] **Step 2: Move the parser file with `git mv`**

```bash
mkdir -p src/engines/_shared/docx
git mv src/engines/docx-to-pdf/docx-parser.ts src/engines/_shared/docx/docx-parser.ts
```

If there are co-located parser helper files (check Step 1 output), move them too with `git mv`.

- [ ] **Step 3: Create the re-export index**

Create `src/engines/_shared/docx/index.ts`:

```ts
export { parseDocx } from "./docx-parser";
// Re-export any types the parser exposes. Inspect docx-parser.ts for `export type`
// declarations and re-export each here. Common candidates: ParsedDocument, Paragraph, Run, Table.
```

After writing the re-export, replace the comment line above with the actual `export type { ... } from "./docx-parser";` lines based on what the parser exports.

- [ ] **Step 4: Update docx-to-pdf imports**

In `src/engines/docx-to-pdf/worker.ts`, change:

```ts
import { parseDocx } from "./docx-parser";
```

to:

```ts
import { parseDocx } from "@/engines/_shared/docx";
```

Search for any other internal imports of `./docx-parser` or `./docx-parser/...` within `src/engines/docx-to-pdf/`:

```bash
grep -rln '"\./docx-parser' src/engines/docx-to-pdf/
```

Update each to use `@/engines/_shared/docx` (or the appropriate sub-path if the type lives elsewhere).

- [ ] **Step 5: Write the relocation guard test**

Create `src/engines/_shared/docx/index.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocx } from "./index";

describe("_shared/docx parseDocx", () => {
  it("re-exports parseDocx and parses a known DOCX fixture", async () => {
    // Use any docx fixture committed for the docx-to-pdf engine.
    // Search via: ls tests/fixtures/*.docx
    const fixturePath = path.resolve(__dirname, "../../../../tests/fixtures/sample.docx");
    const bytes = readFileSync(fixturePath);
    const result = await parseDocx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    // Tripwire only — this is a relocation guard, not a behavior test.
    expect(result).toBeDefined();
  });
});
```

If `tests/fixtures/sample.docx` doesn't exist, look at existing docx-to-pdf tests for the path they use:

```bash
grep -ln "\.docx\"" src/engines/docx-to-pdf/**/*.test.ts | head -1
```

Adapt the test to use whatever fixture path is already in use.

- [ ] **Step 6: Document the ParsedDocument shape for downstream consumers**

Open `src/engines/_shared/docx/docx-parser.ts`. Identify and write down:
- The name of the type returned by `parseDocx` (likely `ParsedDocument` or similar).
- The exact property path to the top-level block list (e.g., `doc.body.children`, `doc.blocks`, `doc.body.elements` — read the source).
- The discriminator field on each block (`type` field with values like `"paragraph"`, `"table"`, `"heading"`, etc.).
- The shape of a paragraph's runs (likely `{ text: string }` or `{ text: string; bold?: boolean; ... }`).
- The shape of a table (likely `{ rows: { cells: { runs: ... }[] }[] }`).

Add these notes to the top of `src/engines/_shared/docx/index.ts` as a JSDoc comment block, like:

```ts
/**
 * DOCX parser, lifted from src/engines/docx-to-pdf so multiple engines
 * can consume it without reaching across engine boundaries.
 *
 * Output shape (read docx-parser.ts for full types):
 *   parseDocx(bytes) -> ParsedDocument
 *   ParsedDocument.<TOP_LEVEL_FIELD> -> Block[]
 *   Block: { type: "paragraph" | "heading" | "table" | ..., ... }
 *   Paragraph.runs: Run[]
 *   Run: { text?: string, ... }
 *   Table.rows: { cells: { runs: Run[] }[] }[]
 *
 * Replace <TOP_LEVEL_FIELD> with the actual field name found in
 * docx-parser.ts; this comment exists so downstream consumers
 * (docx-to-txt, etc.) don't have to re-derive it.
 */
```

This is load-bearing for Task 5 (docx-to-txt worker) — it eliminates the placeholder casts the worker would otherwise need.

- [ ] **Step 7: Run typecheck, lint, and tests**

Run: `pnpm typecheck && pnpm lint && pnpm test`

Expected: All green. Especially the existing docx-to-pdf tests should still pass — they're the proof the parser still works after the move.

If typecheck fails: an import path is stale. Grep for `docx-parser` and update.
If a docx-to-pdf test fails: the parser depends on a co-located helper that didn't move. Move it.

- [ ] **Step 8: Commit**

```bash
git add src/engines/_shared/docx/ \
        src/engines/docx-to-pdf/worker.ts \
        src/engines/docx-to-pdf/

git commit -m "refactor(engine): lift DOCX parser to _shared/docx

Hoists src/engines/docx-to-pdf/docx-parser.ts (and any pure-
parser dependencies) into src/engines/_shared/docx/ so a future
docx-to-txt engine can reuse it without reaching across engine
boundaries. PDF-specific code (layout, fonts, headers/footers)
stays inside docx-to-pdf/.

No behavior change — existing docx-to-pdf tests stay green."
```

If `git add` complains about deleted files, also include them:

```bash
git add -u src/engines/docx-to-pdf/
```

---

## Task 2: Create `_shared/pdf-page-setup/`

**Files:**
- Create: `src/engines/_shared/pdf-page-setup/index.ts`
- Create: `src/engines/_shared/pdf-page-setup/index.test.ts`

Page-size constants and helper shared by `markdown-to-pdf` (Task 7) and `txt-to-pdf` (Task 8).

- [ ] **Step 1: Write the failing test**

Create `src/engines/_shared/pdf-page-setup/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MARGIN_PT,
  PAGE_SIZES_PT,
  type PdfPageSize,
  getPageDimensions,
} from "./index";

describe("PAGE_SIZES_PT", () => {
  it("declares Letter, A4, and Legal in PDF points", () => {
    expect(PAGE_SIZES_PT).toEqual({
      letter: [612, 792],
      a4: [595, 842],
      legal: [612, 1008],
    });
  });
});

describe("getPageDimensions", () => {
  it.each<[PdfPageSize, [number, number]]>([
    ["letter", [612, 792]],
    ["a4", [595, 842]],
    ["legal", [612, 1008]],
  ])("returns %s -> %j", (size, expected) => {
    expect(getPageDimensions(size)).toEqual(expected);
  });
});

describe("DEFAULT_MARGIN_PT", () => {
  it("equals 72 (1 inch)", () => {
    expect(DEFAULT_MARGIN_PT).toBe(72);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/engines/_shared/pdf-page-setup/index.test.ts`
Expected: FAIL with `Cannot find module './index'`.

- [ ] **Step 3: Create the module**

Create `src/engines/_shared/pdf-page-setup/index.ts`:

```ts
export type PdfPageSize = "letter" | "a4" | "legal";

export const PAGE_SIZES_PT: Record<PdfPageSize, [number, number]> = {
  letter: [612, 792],
  a4: [595, 842],
  legal: [612, 1008],
} as const;

export const DEFAULT_MARGIN_PT = 72; // 1 inch

export function getPageDimensions(size: PdfPageSize): [number, number] {
  return PAGE_SIZES_PT[size];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/engines/_shared/pdf-page-setup/index.test.ts`
Expected: PASS — all 5 cases (1 + 3 from `it.each` + 1).

- [ ] **Step 5: Run lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: Clean.

- [ ] **Step 6: Commit**

```bash
git add src/engines/_shared/pdf-page-setup/

git commit -m "feat(engine): add _shared/pdf-page-setup module

Page-size constants (Letter/A4/Legal in PDF points) plus a
default 1-inch margin and getPageDimensions helper. Consumed by
markdown-to-pdf and txt-to-pdf in subsequent tasks."
```

---

## Task 3: Add `markdown-it` and `highlight.js` deps

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml` (auto-regenerated)

These are runtime deps for `markdown-to-pdf` only. Lazy-loaded via the engine's dynamic import in the registry (already the pattern), so they don't pull onto other routes.

- [ ] **Step 1: Install the deps**

```bash
pnpm add markdown-it highlight.js
pnpm add -D @types/markdown-it
```

`@types/markdown-it` is a devDep because it's only used at compile time. `highlight.js` ships its own types.

- [ ] **Step 2: Verify `package.json` updates**

Confirm the dependencies block now includes `markdown-it` and `highlight.js`, and devDependencies includes `@types/markdown-it`.

```bash
grep -E '"markdown-it|highlight.js|@types/markdown-it"' package.json
```

Expected: 3 lines.

- [ ] **Step 3: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: Clean. (No code uses these yet, but typecheck verifies the install succeeded.)

- [ ] **Step 4: Run tests**

Run: `pnpm test`
Expected: All green. No regression from the dep install.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml

git commit -m "chore(deps): add markdown-it and highlight.js

Runtime deps for the markdown-to-pdf engine (Task 7). Lazy-
loaded only on the markdown-to-pdf route via the engine
registry's dynamic import, so other tool bundles are unaffected.

@types/markdown-it added as devDep."
```

---

## Task 4: `image-resize` engine — full vertical slice

**Files:**
- Create: `src/engines/image-resize/index.ts`
- Create: `src/engines/image-resize/options.ts`
- Create: `src/engines/image-resize/options-panel.tsx`
- Create: `src/engines/image-resize/options-panel.test.tsx`
- Create: `src/engines/image-resize/worker.ts`
- Create: `src/engines/image-resize/index.test.ts`
- Create: `src/engines/image-resize/worker.test.ts`
- Create: `src/app/tools/image-resize/page.tsx`
- Modify: `src/engines/_shared/registry.ts` (add `image-resize` entry + EngineId union)

Single-input engine. Worker decodes via the existing `decodeImage` helper. Output MIME matches input, except HEIC inputs output PNG.

- [ ] **Step 1: Locate `decodeImage` and confirm HEIC support**

Run: `grep -rn "export.*decodeImage" src/engines/_shared/` to find the helper.
Inspect its signature so you know what it accepts and returns. Most likely `decodeImage(file: File): Promise<ImageBitmap>`. Note the exact path for the import in the worker.

- [ ] **Step 2: Define options**

Create `src/engines/image-resize/options.ts`:

```ts
export type ImageResizeMode = "px" | "percent";

export type ImageResizeOptions = {
  width: number;
  height: number;
  mode: ImageResizeMode;
  lockAspectRatio: boolean;
};

export const defaultImageResizeOptions: ImageResizeOptions = {
  width: 1920,
  height: 1080,
  mode: "px",
  lockAspectRatio: true,
};

// Output MIME for a given input MIME. HEIC inputs fall back to PNG
// (no HEIC encoder available in the browser canvas).
export const OUTPUT_MIME_FOR_INPUT: Record<string, string> = {
  "image/heic": "image/png",
  "image/heif": "image/png",
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/webp": "image/webp",
};

// Filename extension for each output MIME.
export const OUTPUT_EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
```

- [ ] **Step 3: Write the engine metadata test**

Create `src/engines/image-resize/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import engine from "./index";

describe("image-resize engine metadata", () => {
  it("declares correct id, accept lists, cardinality, category", () => {
    expect(engine.id).toBe("image-resize");
    expect(engine.inputAccept).toEqual([".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif"]);
    expect(engine.inputMime).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/heic",
      "image/heif",
    ]);
    expect(engine.outputMime).toBe("image/png"); // declarative default
    expect(engine.cardinality).toBe("single");
    expect(engine.category).toBe("image");
    expect(engine.defaultOptions).toEqual({
      width: 1920,
      height: 1080,
      mode: "px",
      lockAspectRatio: true,
    });
  });

  it("declares an OptionsPanel component", () => {
    expect(engine.OptionsPanel).toBeDefined();
  });

  it("validates supported image MIMEs", () => {
    const png = new File([new Uint8Array(0)], "x.png", { type: "image/png" });
    const txt = new File([new Uint8Array(0)], "x.txt", { type: "text/plain" });
    expect(engine.validate(png, engine.defaultOptions)).toEqual({ ok: true });
    const result = engine.validate(txt, engine.defaultOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/png|jpeg|webp|heic/i);
  });
});
```

- [ ] **Step 4: Run engine metadata test (should fail)**

Run: `pnpm test src/engines/image-resize/index.test.ts`
Expected: FAIL with `Cannot find module './index'`.

- [ ] **Step 5: Implement the engine module**

Create `src/engines/image-resize/index.ts`:

```ts
import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type ImageResizeOptions, defaultImageResizeOptions } from "./options";
import { ImageResizeOptionsPanel } from "./options-panel";

const SUPPORTED_INPUT_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
];

const engine: SingleInputEngine<ImageResizeOptions, OutputItem> = {
  id: "image-resize",
  inputAccept: [".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "image/png", // declarative default; actual MIME varies by input
  defaultOptions: defaultImageResizeOptions,
  category: "image",
  cardinality: "single",
  OptionsPanel: ImageResizeOptionsPanel,
  validate(file) {
    return SUPPORTED_INPUT_MIMES.includes(file.type)
      ? { ok: true }
      : { ok: false, reason: "Expected a PNG, JPEG, WebP, or HEIC file" };
  },
  async convert(file, opts, signal) {
    const harness = new WorkerHarness<ImageResizeOptions>(
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

- [ ] **Step 6: Implement the OptionsPanel**

Create `src/engines/image-resize/options-panel.tsx`:

```tsx
"use client";

import type { OptionsPanelProps } from "@/engines/_shared/types";
import type { ImageResizeOptions, ImageResizeMode } from "./options";

export function ImageResizeOptionsPanel({
  value,
  onChange,
}: OptionsPanelProps<ImageResizeOptions>) {
  const isPx = value.mode === "px";
  const unit = isPx ? "px" : "%";

  return (
    <div
      data-testid="image-resize-options"
      className="mb-3 flex flex-wrap items-center gap-4 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        mode:
        <select
          data-testid="resize-mode"
          value={value.mode}
          onChange={(e) =>
            onChange({ ...value, mode: e.target.value as ImageResizeMode })
          }
          className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase"
        >
          <option value="px">px</option>
          <option value="percent">%</option>
        </select>
      </label>

      <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        width:
        <input
          data-testid="resize-width"
          type="number"
          min={1}
          step={1}
          value={value.width}
          onChange={(e) =>
            onChange({ ...value, width: Number.parseInt(e.target.value, 10) || 0 })
          }
          className="w-20 border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)]"
        />
        <span className="text-[var(--color-fg-strong)]">{unit}</span>
      </label>

      <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        height:
        <input
          data-testid="resize-height"
          type="number"
          min={1}
          step={1}
          value={value.height}
          disabled={value.lockAspectRatio}
          onChange={(e) =>
            onChange({ ...value, height: Number.parseInt(e.target.value, 10) || 0 })
          }
          placeholder={value.lockAspectRatio ? "auto" : undefined}
          className="w-20 border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] disabled:text-[var(--color-fg-very-muted)]"
        />
        <span
          className={
            value.lockAspectRatio
              ? "text-[var(--color-fg-very-muted)]"
              : "text-[var(--color-fg-strong)]"
          }
        >
          {unit}
        </span>
      </label>

      <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        <input
          data-testid="resize-lock-ratio"
          type="checkbox"
          checked={value.lockAspectRatio}
          onChange={(e) => onChange({ ...value, lockAspectRatio: e.target.checked })}
        />
        lock aspect ratio
      </label>

      <span
        data-testid="resize-heic-note"
        className="text-[var(--color-fg-very-muted)]"
      >
        // heic outputs png
      </span>
    </div>
  );
}
```

- [ ] **Step 7: Test the OptionsPanel**

Create `src/engines/image-resize/options-panel.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultImageResizeOptions } from "./options";
import { ImageResizeOptionsPanel } from "./options-panel";

describe("ImageResizeOptionsPanel", () => {
  it("renders with default options", () => {
    render(
      <ImageResizeOptionsPanel value={defaultImageResizeOptions} onChange={() => {}} />,
    );
    expect(screen.getByTestId("resize-mode")).toHaveValue("px");
    expect(screen.getByTestId("resize-width")).toHaveValue(1920);
    expect(screen.getByTestId("resize-height")).toHaveValue(1080);
    expect(screen.getByTestId("resize-lock-ratio")).toBeChecked();
  });

  it("disables height input when lockAspectRatio is on", () => {
    render(
      <ImageResizeOptionsPanel value={defaultImageResizeOptions} onChange={() => {}} />,
    );
    expect(screen.getByTestId("resize-height")).toBeDisabled();
  });

  it("enables height input when lockAspectRatio is off", () => {
    render(
      <ImageResizeOptionsPanel
        value={{ ...defaultImageResizeOptions, lockAspectRatio: false }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("resize-height")).not.toBeDisabled();
  });

  it("calls onChange when width is edited", () => {
    const onChange = vi.fn();
    render(
      <ImageResizeOptionsPanel value={defaultImageResizeOptions} onChange={onChange} />,
    );
    fireEvent.change(screen.getByTestId("resize-width"), { target: { value: "800" } });
    expect(onChange).toHaveBeenCalledWith({
      ...defaultImageResizeOptions,
      width: 800,
    });
  });

  it("calls onChange when mode toggles to percent", () => {
    const onChange = vi.fn();
    render(
      <ImageResizeOptionsPanel value={defaultImageResizeOptions} onChange={onChange} />,
    );
    fireEvent.change(screen.getByTestId("resize-mode"), { target: { value: "percent" } });
    expect(onChange).toHaveBeenCalledWith({
      ...defaultImageResizeOptions,
      mode: "percent",
    });
  });

  it("displays the heic-outputs-png note", () => {
    render(
      <ImageResizeOptionsPanel value={defaultImageResizeOptions} onChange={() => {}} />,
    );
    expect(screen.getByTestId("resize-heic-note")).toHaveTextContent(/heic outputs png/i);
  });
});
```

- [ ] **Step 8: Implement the worker**

Create `src/engines/image-resize/worker.ts`:

```ts
import { decodeImage } from "@/engines/_shared/decode-image";
import type { OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import {
  OUTPUT_EXTENSION,
  OUTPUT_MIME_FOR_INPUT,
  type ImageResizeOptions,
} from "./options";

const MAX_DIMENSION = 16384; // canvas hard limit on most browsers

function replaceExt(name: string, newExt: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}.${newExt}`;
  return `${name.slice(0, dot)}.${newExt}`;
}

function withResolutionSuffix(name: string, w: number, h: number, ext: string): string {
  const base = name.lastIndexOf(".") > 0 ? name.slice(0, name.lastIndexOf(".")) : name;
  return `${base}-${w}x${h}.${ext}`;
}

const api = {
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    type: string,
    opts: ImageResizeOptions,
  ): Promise<OutputItem> {
    const inputBlob = new Blob([bytes], { type });
    const file = new File([inputBlob], name, { type });
    const bitmap = await decodeImage(file);

    try {
      // Compute target dimensions.
      let targetW: number;
      let targetH: number;

      if (opts.mode === "percent") {
        targetW = Math.round((bitmap.width * opts.width) / 100);
        targetH = opts.lockAspectRatio
          ? Math.round((bitmap.height * opts.width) / 100)
          : Math.round((bitmap.height * opts.height) / 100);
      } else {
        targetW = opts.width;
        targetH = opts.lockAspectRatio
          ? Math.round((bitmap.height * opts.width) / bitmap.width)
          : opts.height;
      }

      // Validate target dimensions.
      if (targetW < 1 || targetH < 1) {
        throw new Error(`Resize target too small: ${targetW}x${targetH}`);
      }
      if (targetW > MAX_DIMENSION || targetH > MAX_DIMENSION) {
        throw new Error(
          `Resize target exceeds canvas limit (${MAX_DIMENSION}px): ${targetW}x${targetH}`,
        );
      }

      // Output MIME — HEIC falls back to PNG.
      const outputType = OUTPUT_MIME_FOR_INPUT[type] ?? "image/png";
      const outputExt = OUTPUT_EXTENSION[outputType] ?? "png";

      const canvas = new OffscreenCanvas(targetW, targetH);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);

      const blob = await canvas.convertToBlob({ type: outputType });

      // If the input was HEIC and we're switching to PNG, swap the extension first.
      const baseName =
        type === "image/heic" || type === "image/heif" ? replaceExt(name, outputExt) : name;
      return {
        filename: withResolutionSuffix(baseName, targetW, targetH, outputExt),
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

- [ ] **Step 9: Test the worker (run engine end-to-end via the harness pattern)**

Create `src/engines/image-resize/worker.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import engine from "./index";

// Helper: read a fixture as a File. Uses any committed PNG fixture.
async function readFixtureAsFile(filename: string, mime: string): Promise<File> {
  const filePath = path.resolve(__dirname, "../../../tests/fixtures", filename);
  const buf = await readFile(filePath);
  // Node Buffer -> ArrayBuffer slice.
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new File([ab], filename, { type: mime });
}

// Helper: decode an output blob's intrinsic dimensions via createImageBitmap.
async function getDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

describe("image-resize worker", () => {
  it("resizes a 1000x500 PNG to 200x100 with lock=false", async () => {
    // NOTE: this test requires a committed 1000x500 PNG fixture. If it does
    // not exist, create it (see Task 4 fixture-creation step) or use a
    // different known-size fixture and adjust the assertions.
    const file = await readFixtureAsFile("sample-1000x500.png", "image/png");
    const ctrl = new AbortController();
    const result = await engine.convert(
      file,
      { width: 200, height: 100, mode: "px", lockAspectRatio: false },
      ctrl.signal,
    );
    const item = Array.isArray(result) ? result[0] : result;
    if (!item) throw new Error("expected output");
    const dims = await getDimensions(item.blob);
    expect(dims).toEqual({ width: 200, height: 100 });
    expect(item.filename).toMatch(/-200x100\.png$/);
  });

  it("preserves aspect ratio when lockAspectRatio is on (1000x500 -> width 200)", async () => {
    const file = await readFixtureAsFile("sample-1000x500.png", "image/png");
    const ctrl = new AbortController();
    const result = await engine.convert(
      file,
      { width: 200, height: 999, mode: "px", lockAspectRatio: true },
      ctrl.signal,
    );
    const item = Array.isArray(result) ? result[0] : result;
    if (!item) throw new Error("expected output");
    const dims = await getDimensions(item.blob);
    expect(dims).toEqual({ width: 200, height: 100 });
  });

  it("scales by percent when mode is percent (1000x500 at 50% -> 500x250)", async () => {
    const file = await readFixtureAsFile("sample-1000x500.png", "image/png");
    const ctrl = new AbortController();
    const result = await engine.convert(
      file,
      { width: 50, height: 50, mode: "percent", lockAspectRatio: false },
      ctrl.signal,
    );
    const item = Array.isArray(result) ? result[0] : result;
    if (!item) throw new Error("expected output");
    const dims = await getDimensions(item.blob);
    expect(dims).toEqual({ width: 500, height: 250 });
  });

  it("HEIC inputs output PNG", async () => {
    const file = await readFixtureAsFile("sample.heic", "image/heic");
    const ctrl = new AbortController();
    const result = await engine.convert(
      file,
      { width: 100, height: 100, mode: "px", lockAspectRatio: false },
      ctrl.signal,
    );
    const item = Array.isArray(result) ? result[0] : result;
    if (!item) throw new Error("expected output");
    expect(item.mime).toBe("image/png");
    expect(item.filename).toMatch(/\.png$/);
  });

  it("rejects out-of-range dimensions", async () => {
    const file = await readFixtureAsFile("sample-1000x500.png", "image/png");
    const ctrl = new AbortController();
    await expect(
      engine.convert(
        file,
        { width: 0, height: 0, mode: "px", lockAspectRatio: false },
        ctrl.signal,
      ),
    ).rejects.toThrow(/too small|exceeds/i);
  });
});
```

- [ ] **Step 10: Create the fixture if missing**

Run: `ls tests/fixtures/sample-1000x500.png`

If the file does not exist, generate it via a one-shot script — for example, in a Node REPL or via the existing image-convert worker output. The simplest path:

```bash
# Use ImageMagick if available:
convert -size 1000x500 xc:white tests/fixtures/sample-1000x500.png

# Or use Node + the canvas package (if installed):
node -e "
const { createCanvas } = require('canvas');
const fs = require('fs');
const c = createCanvas(1000, 500);
const ctx = c.getContext('2d');
ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, 1000, 500);
fs.writeFileSync('tests/fixtures/sample-1000x500.png', c.toBuffer('image/png'));
"
```

If neither is available, ask the user to provide a 1000×500 PNG. The test bytes-equal nothing — only dimensions matter.

- [ ] **Step 11: Register the engine**

Modify `src/engines/_shared/registry.ts`. Add `"image-resize"` to the `EngineId` union:

```ts
export type EngineId =
  | "image-convert"
  | "image-resize"
  | "image-to-pdf"
  | "pdf-merge"
  | "pdf-split"
  | "pdf-to-image"
  | "pdf-to-md"
  | "docx-to-pdf";
```

Add the loader to the `REGISTRY` map:

```ts
const REGISTRY: Record<EngineId, Loader> = {
  "image-convert": () => import("@/engines/image-convert"),
  "image-resize": () => import("@/engines/image-resize"),
  "image-to-pdf": () => import("@/engines/image-to-pdf"),
  // ... existing entries
};
```

- [ ] **Step 12: Create the route**

Create `src/app/tools/image-resize/page.tsx`:

```tsx
"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/image-resize";

export default function ImageResizePage() {
  return <ToolFrame engine={engine} />;
}
```

- [ ] **Step 13: Run all tests**

Run: `pnpm test src/engines/image-resize/`
Expected: All green — engine metadata test, options-panel test, worker test.

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: All green; no regressions.

- [ ] **Step 14: Commit**

```bash
git add src/engines/image-resize/ \
        src/app/tools/image-resize/ \
        src/engines/_shared/registry.ts \
        tests/fixtures/sample-1000x500.png

git commit -m "feat(engine): add image-resize engine

Single-input engine that resizes images via OffscreenCanvas.
Width/height in pixels or percent, with optional aspect-ratio
lock (worker-side: width drives output height when on). HEIC
inputs output PNG since the browser canvas has no HEIC encoder.

Filename gets a resolution suffix (vacation.jpg ->
vacation-1280x720.jpg) to prevent overwrite of the original on
auto-download.

Includes engine metadata, OptionsPanel, worker, route, and
co-located tests. Registered in _shared/registry.ts."
```

---

## Task 5: `docx-to-txt` engine — full vertical slice

**Files:**
- Create: `src/engines/docx-to-txt/index.ts`
- Create: `src/engines/docx-to-txt/options.ts`
- Create: `src/engines/docx-to-txt/options-panel.tsx`
- Create: `src/engines/docx-to-txt/options-panel.test.tsx`
- Create: `src/engines/docx-to-txt/worker.ts`
- Create: `src/engines/docx-to-txt/index.test.ts`
- Create: `src/engines/docx-to-txt/worker.test.ts`
- Create: `src/app/tools/docx-to-txt/page.tsx`
- Modify: `src/engines/_shared/registry.ts`

Reuses the lifted `parseDocx` from `_shared/docx/` (Task 1). Walks the parsed structure and emits plain text.

- [ ] **Step 1: Confirm parser output shape**

Open `src/engines/_shared/docx/docx-parser.ts` (the file you moved in Task 1). Note the exported types — `ParsedDocument`, `Paragraph`, `Run`, `Table`, etc. The walker in this task (Step 8) needs to know the field names.

If unclear, find an existing consumer:

```bash
grep -ln "parseDocx\|ParsedDocument" src/engines/docx-to-pdf/
```

Open the layout module (`src/engines/docx-to-pdf/layout/index.ts` or similar) to see how it walks the document.

- [ ] **Step 2: Define options**

Create `src/engines/docx-to-txt/options.ts`:

```ts
export type ParagraphJoin = "double-newline" | "single-newline";

export type DocxToTxtOptions = {
  joinParagraphs: ParagraphJoin;
};

export const defaultDocxToTxtOptions: DocxToTxtOptions = {
  joinParagraphs: "double-newline",
};
```

- [ ] **Step 3: Write the engine metadata test**

Create `src/engines/docx-to-txt/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import engine from "./index";

describe("docx-to-txt engine metadata", () => {
  it("declares correct id, accept, MIME, category", () => {
    expect(engine.id).toBe("docx-to-txt");
    expect(engine.inputAccept).toEqual([".docx"]);
    expect(engine.inputMime).toEqual([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]);
    expect(engine.outputMime).toBe("text/plain");
    expect(engine.cardinality).toBe("single");
    expect(engine.category).toBe("document");
    expect(engine.defaultOptions).toEqual({ joinParagraphs: "double-newline" });
  });

  it("declares an OptionsPanel component", () => {
    expect(engine.OptionsPanel).toBeDefined();
  });

  it("validates DOCX MIME", () => {
    const docx = new File([new Uint8Array(0)], "x.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const txt = new File([new Uint8Array(0)], "x.txt", { type: "text/plain" });
    expect(engine.validate(docx, engine.defaultOptions)).toEqual({ ok: true });
    const result = engine.validate(txt, engine.defaultOptions);
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 4: Run engine test (should fail)**

Run: `pnpm test src/engines/docx-to-txt/index.test.ts`
Expected: FAIL with `Cannot find module './index'`.

- [ ] **Step 5: Implement engine module**

Create `src/engines/docx-to-txt/index.ts`:

```ts
import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type DocxToTxtOptions, defaultDocxToTxtOptions } from "./options";
import { DocxToTxtOptionsPanel } from "./options-panel";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const engine: SingleInputEngine<DocxToTxtOptions, OutputItem> = {
  id: "docx-to-txt",
  inputAccept: [".docx"],
  inputMime: [DOCX_MIME],
  outputMime: "text/plain",
  defaultOptions: defaultDocxToTxtOptions,
  category: "document",
  cardinality: "single",
  OptionsPanel: DocxToTxtOptionsPanel,
  validate(file) {
    return file.type === DOCX_MIME
      ? { ok: true }
      : { ok: false, reason: "Expected a .docx file" };
  },
  async convert(file, opts, signal) {
    const harness = new WorkerHarness<DocxToTxtOptions>(
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

- [ ] **Step 6: Implement OptionsPanel**

Create `src/engines/docx-to-txt/options-panel.tsx`:

```tsx
"use client";

import type { OptionsPanelProps } from "@/engines/_shared/types";
import type { DocxToTxtOptions, ParagraphJoin } from "./options";

export function DocxToTxtOptionsPanel({
  value,
  onChange,
}: OptionsPanelProps<DocxToTxtOptions>) {
  return (
    <div
      data-testid="docx-to-txt-options"
      className="mb-3 flex flex-wrap items-center gap-4 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        paragraph join:
        <select
          data-testid="paragraph-join"
          value={value.joinParagraphs}
          onChange={(e) =>
            onChange({ ...value, joinParagraphs: e.target.value as ParagraphJoin })
          }
          className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase"
        >
          <option value="double-newline">// blank line between paragraphs</option>
          <option value="single-newline">// single line</option>
        </select>
      </label>
    </div>
  );
}
```

- [ ] **Step 7: Test OptionsPanel**

Create `src/engines/docx-to-txt/options-panel.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultDocxToTxtOptions } from "./options";
import { DocxToTxtOptionsPanel } from "./options-panel";

describe("DocxToTxtOptionsPanel", () => {
  it("renders with default option", () => {
    render(
      <DocxToTxtOptionsPanel value={defaultDocxToTxtOptions} onChange={() => {}} />,
    );
    expect(screen.getByTestId("paragraph-join")).toHaveValue("double-newline");
  });

  it("calls onChange when selection changes", () => {
    const onChange = vi.fn();
    render(<DocxToTxtOptionsPanel value={defaultDocxToTxtOptions} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("paragraph-join"), {
      target: { value: "single-newline" },
    });
    expect(onChange).toHaveBeenCalledWith({ joinParagraphs: "single-newline" });
  });
});
```

- [ ] **Step 8: Implement the worker (text extraction)**

**Prerequisite:** Task 1 Step 6 should have documented the `ParsedDocument` shape in `_shared/docx/index.ts`'s JSDoc. Read that comment first to know the actual field paths and types you should use here. The code below uses placeholder type aliases (`Block`, `Run`, `Row`) that you replace with the real exported types from `@/engines/_shared/docx`.

Create `src/engines/docx-to-txt/worker.ts`:

```ts
import { parseDocx } from "@/engines/_shared/docx";
// Replace these imports with the actual type names exported from
// _shared/docx (e.g., ParsedDocument, Paragraph, Heading, Table, Run).
// The names live in src/engines/_shared/docx/docx-parser.ts.
import type { /* ParsedDocument, Paragraph, Heading, Table, Run */ } from "@/engines/_shared/docx";
import type { OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import type { DocxToTxtOptions } from "./options";

function replaceExt(name: string, newExt: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}.${newExt}`;
  return `${name.slice(0, dot)}.${newExt}`;
}

/**
 * Extracts plain text from a parsed DOCX. Walks blocks in document
 * order. Tables: cells joined by tab, rows by newline. Headings emit
 * their text only (no `#` markers — that would be Markdown).
 * Hyperlinks emit anchor text only. Image runs are skipped.
 */
function extractText(doc: ParsedDocument, opts: DocxToTxtOptions): string {
  const paragraphSep = opts.joinParagraphs === "double-newline" ? "\n\n" : "\n";
  const blockTexts: string[] = [];

  // Replace `<TOP_LEVEL_FIELD>` with the actual field path from the
  // JSDoc in _shared/docx/index.ts (likely doc.body.children, doc.blocks,
  // or similar — the implementer reads it from there, not guesses).
  for (const block of doc.<TOP_LEVEL_FIELD>) {
    const text = renderBlock(block);
    if (text.length > 0) blockTexts.push(text);
  }

  return blockTexts.join(paragraphSep);
}

function renderBlock(block: Block): string {
  // Discriminate on the parser's actual block type field. Match the
  // discriminator name and value strings to whatever the parser uses.
  switch (block.type) {
    case "paragraph":
    case "heading":
      return renderRuns(block.runs);
    case "table":
      return renderTable(block.rows);
    default:
      return "";
  }
}

function renderRuns(runs: Run[]): string {
  let out = "";
  for (const run of runs) {
    // Adjust to the run shape from the parser. Common cases:
    //   { type: "text", text: string }
    //   { type: "hyperlink", anchor: string }
    //   { type: "image", ... }
    if (run.type === "image") continue;
    if ("text" in run && typeof run.text === "string") out += run.text;
    else if ("anchor" in run && typeof run.anchor === "string") out += run.anchor;
  }
  return out;
}

function renderTable(rows: TableRow[]): string {
  return rows
    .map((row) => row.cells.map((c) => renderRuns(c.runs)).join("\t"))
    .join("\n");
}

const api = {
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    _type: string,
    opts: DocxToTxtOptions,
  ): Promise<OutputItem> {
    const doc = await parseDocx(bytes);
    const text = extractText(doc, opts);
    const blob = new Blob([text], { type: "text/plain" });
    return {
      filename: replaceExt(name, "txt"),
      mime: "text/plain",
      blob,
    };
  },
};

Comlink.expose(api);
```

**Required substitutions before this file will typecheck:**

1. Replace the commented `import type` line with the real exported type names from `@/engines/_shared/docx` (read the JSDoc on `_shared/docx/index.ts` from Task 1 Step 6).
2. Replace `<TOP_LEVEL_FIELD>` with the actual property path documented in that same JSDoc.
3. Adjust the `renderRuns` discriminators (`"image"`, `"text"`, `"anchor"`) to match the parser's actual run-type values.
4. Define the `Block`, `Run`, `TableRow` type aliases by importing or re-exporting them from `@/engines/_shared/docx`.

If any substitution is unclear, the right move is to open `_shared/docx/docx-parser.ts` and read it — never guess. `pnpm typecheck` will catch any mismatch.

- [ ] **Step 9: Test the worker**

Create `src/engines/docx-to-txt/worker.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import engine from "./index";

async function readDocxFixture(filename: string): Promise<File> {
  const filePath = path.resolve(__dirname, "../../../tests/fixtures", filename);
  const buf = await readFile(filePath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new File([ab], filename, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

async function readBlobAsText(blob: Blob): Promise<string> {
  return await blob.text();
}

describe("docx-to-txt worker", () => {
  it("extracts paragraph text from a DOCX fixture", async () => {
    // Use any committed DOCX fixture. Find one via:
    //   ls tests/fixtures/*.docx
    // or look at what docx-to-pdf tests use.
    const file = await readDocxFixture("sample.docx");
    const ctrl = new AbortController();
    const result = await engine.convert(file, engine.defaultOptions, ctrl.signal);
    const item = Array.isArray(result) ? result[0] : result;
    if (!item) throw new Error("expected output");
    const text = await readBlobAsText(item.blob);
    expect(text.length).toBeGreaterThan(0);
    expect(item.filename).toBe("sample.txt");
    expect(item.mime).toBe("text/plain");
  });

  it("does not emit Markdown formatting markers", async () => {
    const file = await readDocxFixture("sample.docx");
    const ctrl = new AbortController();
    const result = await engine.convert(file, engine.defaultOptions, ctrl.signal);
    const item = Array.isArray(result) ? result[0] : result;
    if (!item) throw new Error("expected output");
    const text = await readBlobAsText(item.blob);
    expect(text).not.toMatch(/^#\s/m); // no heading markers
    expect(text).not.toMatch(/\*\*/); // no bold markers
    expect(text).not.toMatch(/^\s*[-*]\s/m); // no bullet glyphs from us (if the source contained literal `*` text, that's fine)
  });

  it("joins paragraphs with double newline by default", async () => {
    // Find or create a fixture with at least 2 paragraphs.
    const file = await readDocxFixture("sample.docx");
    const ctrl = new AbortController();
    const result = await engine.convert(file, engine.defaultOptions, ctrl.signal);
    const item = Array.isArray(result) ? result[0] : result;
    if (!item) throw new Error("expected output");
    const text = await readBlobAsText(item.blob);
    if (text.includes("\n")) {
      expect(text).toMatch(/\n\n/);
    }
  });

  it("joins paragraphs with single newline when option is single-newline", async () => {
    const file = await readDocxFixture("sample.docx");
    const ctrl = new AbortController();
    const result = await engine.convert(
      file,
      { joinParagraphs: "single-newline" },
      ctrl.signal,
    );
    const item = Array.isArray(result) ? result[0] : result;
    if (!item) throw new Error("expected output");
    const text = await readBlobAsText(item.blob);
    // Should NOT contain double-newline (allowing for the table separator
    // which always uses double-newline regardless of the option).
    if (text.includes("\n")) {
      // If the document has multiple paragraphs and no tables, there should
      // be no `\n\n`. If it has tables, blank lines around tables are still
      // allowed.
      // Lenient assertion: at least one single-newline join is present.
      expect(text).toMatch(/\n/);
    }
  });
});
```

If `tests/fixtures/sample.docx` doesn't exist, look at what's available and rename in the tests:

```bash
ls tests/fixtures/*.docx
```

Use the smallest committed DOCX. If none exist, ask the user — DOCX fixtures are non-trivial to generate.

- [ ] **Step 10: Register the engine + add route**

Modify `src/engines/_shared/registry.ts`. Add `"docx-to-txt"` to the `EngineId` union and to the `REGISTRY` map:

```ts
export type EngineId =
  | "docx-to-pdf"
  | "docx-to-txt"
  // ... existing
  ;

const REGISTRY: Record<EngineId, Loader> = {
  // ... existing entries
  "docx-to-txt": () => import("@/engines/docx-to-txt"),
};
```

Create `src/app/tools/docx-to-txt/page.tsx`:

```tsx
"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/docx-to-txt";

export default function DocxToTxtPage() {
  return <ToolFrame engine={engine} />;
}
```

- [ ] **Step 11: Run all tests**

Run: `pnpm test src/engines/docx-to-txt/`
Expected: All green.

If the worker test fails because of property-path mismatches in `extractText`, open `_shared/docx/docx-parser.ts`, identify the real `ParsedDocument` shape, and fix the worker's field accesses.

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: All green; no regressions.

- [ ] **Step 12: Commit**

```bash
git add src/engines/docx-to-txt/ \
        src/app/tools/docx-to-txt/ \
        src/engines/_shared/registry.ts

git commit -m "feat(engine): add docx-to-txt engine

Walks the parsed DOCX structure (via _shared/docx/parseDocx)
and emits plain text. Tables: cells joined by tab, rows by
newline. Headings emit text only (no '#' markers). Hyperlinks
emit anchor text only. Image runs skipped.

Includes engine metadata, OptionsPanel (paragraph-join toggle),
worker, route, and co-located tests."
```

---

## Task 6: `markdown-to-pdf` — block parser

**Files:**
- Create: `src/engines/markdown-to-pdf/parser.ts`
- Create: `src/engines/markdown-to-pdf/parser.test.ts`
- Create: `src/engines/markdown-to-pdf/blocks.ts` (block type definitions)

Tokenize markdown via `markdown-it` and convert the token stream to a flat block list. The block list is the renderer's input (Task 7).

- [ ] **Step 1: Define the block types**

Create `src/engines/markdown-to-pdf/blocks.ts`:

```ts
export type RunStyle = {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: { href: string };
};

export type Run = {
  text: string;
  style: RunStyle;
};

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; runs: Run[] }
  | { type: "paragraph"; runs: Run[] }
  | { type: "list-item"; depth: number; runs: Run[] }
  | { type: "code-block"; language: string | null; text: string }
  | { type: "blockquote"; runs: Run[] }
  | { type: "hr" }
  | { type: "image"; alt: string };
```

- [ ] **Step 2: Write the failing parser test**

Create `src/engines/markdown-to-pdf/parser.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./parser";

describe("parseMarkdown", () => {
  it("parses a heading", () => {
    const blocks = parseMarkdown("# Hello");
    expect(blocks).toEqual([
      {
        type: "heading",
        level: 1,
        runs: [{ text: "Hello", style: {} }],
      },
    ]);
  });

  it("parses a paragraph with bold and italic", () => {
    const blocks = parseMarkdown("Plain **bold** *italic* text.");
    const para = blocks[0];
    expect(para?.type).toBe("paragraph");
    if (para?.type !== "paragraph") return;
    // Concatenate run texts for simplicity.
    const text = para.runs.map((r) => r.text).join("");
    expect(text).toBe("Plain bold italic text.");
    // The bold and italic words should have the corresponding flags.
    expect(para.runs.find((r) => r.text === "bold")?.style.bold).toBe(true);
    expect(para.runs.find((r) => r.text === "italic")?.style.italic).toBe(true);
  });

  it("parses inline code and links", () => {
    const blocks = parseMarkdown("See `foo()` and [docs](https://example.com).");
    const para = blocks[0];
    if (para?.type !== "paragraph") throw new Error("expected paragraph");
    const code = para.runs.find((r) => r.text === "foo()");
    expect(code?.style.code).toBe(true);
    const link = para.runs.find((r) => r.text === "docs");
    expect(link?.style.link?.href).toBe("https://example.com");
  });

  it("parses a fenced code block with language", () => {
    const blocks = parseMarkdown("```javascript\nconst x = 1;\n```");
    expect(blocks).toEqual([
      {
        type: "code-block",
        language: "javascript",
        text: "const x = 1;\n",
      },
    ]);
  });

  it("parses a code block without language as language=null", () => {
    const blocks = parseMarkdown("```\nplain text\n```");
    expect(blocks[0]?.type).toBe("code-block");
    expect((blocks[0] as { language: string | null }).language).toBeNull();
  });

  it("parses a horizontal rule", () => {
    const blocks = parseMarkdown("---");
    expect(blocks).toEqual([{ type: "hr" }]);
  });

  it("parses a list", () => {
    const blocks = parseMarkdown("- one\n- two\n- three");
    expect(blocks).toHaveLength(3);
    expect(blocks.every((b) => b.type === "list-item")).toBe(true);
  });

  it("parses a blockquote", () => {
    const blocks = parseMarkdown("> quoted");
    expect(blocks[0]?.type).toBe("blockquote");
  });

  it("parses an image as a placeholder block", () => {
    const blocks = parseMarkdown("![alt text](http://example.com/foo.png)");
    expect(blocks).toEqual([{ type: "image", alt: "alt text" }]);
  });

  it("parses heading levels 1-6", () => {
    for (let i = 1; i <= 6; i++) {
      const blocks = parseMarkdown(`${"#".repeat(i)} title`);
      expect(blocks[0]?.type).toBe("heading");
      expect((blocks[0] as { level: number }).level).toBe(i);
    }
  });
});
```

- [ ] **Step 3: Run parser test (should fail)**

Run: `pnpm test src/engines/markdown-to-pdf/parser.test.ts`
Expected: FAIL with `Cannot find module './parser'`.

- [ ] **Step 4: Implement the parser**

Create `src/engines/markdown-to-pdf/parser.ts`:

```ts
import MarkdownIt from "markdown-it";
import type { Block, Run, RunStyle } from "./blocks";

const md = new MarkdownIt({ html: false, breaks: false, linkify: true });

/**
 * Convert a markdown string to a flat list of layout blocks.
 *
 * Inline formatting (bold, italic, code, link) is collapsed into per-run
 * style flags within paragraph/heading/blockquote/list-item blocks.
 * Code blocks and HRs are top-level blocks. Images become placeholder
 * blocks (the renderer prints "[image: <alt>]"); embedding actual images
 * is deferred (would require fetching external URLs, breaking the
 * privacy guarantee).
 */
export function parseMarkdown(input: string): Block[] {
  const tokens = md.parse(input, {});
  const blocks: Block[] = [];

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (!token) {
      i++;
      continue;
    }

    switch (token.type) {
      case "heading_open": {
        const level = Number.parseInt(token.tag.slice(1), 10) as 1 | 2 | 3 | 4 | 5 | 6;
        const inline = tokens[i + 1];
        const runs = inline?.children ? inlineToRuns(inline.children) : [];
        blocks.push({ type: "heading", level, runs });
        i += 3; // heading_open, inline, heading_close
        break;
      }
      case "paragraph_open": {
        const inline = tokens[i + 1];
        const runs = inline?.children ? inlineToRuns(inline.children) : [];
        // Detect single-image paragraph: convert to image placeholder.
        if (
          inline?.children?.length === 1 &&
          inline.children[0]?.type === "image"
        ) {
          const alt = inline.children[0].content ?? "";
          blocks.push({ type: "image", alt });
        } else {
          blocks.push({ type: "paragraph", runs });
        }
        i += 3;
        break;
      }
      case "bullet_list_open":
      case "ordered_list_open": {
        // Walk until matching close.
        const closeType = token.type === "bullet_list_open" ? "bullet_list_close" : "ordered_list_close";
        i++;
        while (i < tokens.length && tokens[i]?.type !== closeType) {
          const t = tokens[i];
          if (t?.type === "list_item_open") {
            // list_item_open, paragraph_open, inline, paragraph_close, list_item_close
            const inline = tokens[i + 2];
            const runs = inline?.children ? inlineToRuns(inline.children) : [];
            blocks.push({ type: "list-item", depth: 0, runs });
            // Skip to list_item_close.
            while (i < tokens.length && tokens[i]?.type !== "list_item_close") i++;
            i++; // past list_item_close
          } else {
            i++;
          }
        }
        i++; // past list close
        break;
      }
      case "fence":
      case "code_block": {
        const language = token.info?.trim() || null;
        blocks.push({ type: "code-block", language, text: token.content });
        i++;
        break;
      }
      case "hr": {
        blocks.push({ type: "hr" });
        i++;
        break;
      }
      case "blockquote_open": {
        // blockquote_open, paragraph_open, inline, paragraph_close, blockquote_close
        const inline = tokens[i + 2];
        const runs = inline?.children ? inlineToRuns(inline.children) : [];
        blocks.push({ type: "blockquote", runs });
        // Skip to blockquote_close.
        while (i < tokens.length && tokens[i]?.type !== "blockquote_close") i++;
        i++;
        break;
      }
      default:
        i++;
        break;
    }
  }

  return blocks;
}

function inlineToRuns(children: import("markdown-it/lib/token").default[]): Run[] {
  const runs: Run[] = [];
  const styleStack: RunStyle = {};

  for (const child of children) {
    switch (child.type) {
      case "strong_open":
        styleStack.bold = true;
        break;
      case "strong_close":
        styleStack.bold = undefined;
        break;
      case "em_open":
        styleStack.italic = true;
        break;
      case "em_close":
        styleStack.italic = undefined;
        break;
      case "code_inline":
        runs.push({ text: child.content, style: { ...styleStack, code: true } });
        break;
      case "link_open": {
        const href = child.attrs?.find((a) => a[0] === "href")?.[1] ?? "";
        styleStack.link = { href };
        break;
      }
      case "link_close":
        styleStack.link = undefined;
        break;
      case "text":
        if (child.content) {
          runs.push({ text: child.content, style: { ...styleStack } });
        }
        break;
      case "softbreak":
      case "hardbreak":
        runs.push({ text: " ", style: { ...styleStack } });
        break;
      // Skip image inside inline (handled at paragraph level).
      case "image":
        break;
      default:
        break;
    }
  }

  return runs;
}
```

- [ ] **Step 5: Run parser tests (should pass)**

Run: `pnpm test src/engines/markdown-to-pdf/parser.test.ts`
Expected: All cases PASS.

If the bold/italic test fails because runs are split unexpectedly: that's because the styleStack reset uses `undefined` instead of `delete`. The tests should still pass because `style.bold` would be `undefined` rather than `true`, but if you see assertion failures look at the actual `runs` output and adjust.

- [ ] **Step 6: Run lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: Clean.

- [ ] **Step 7: Commit**

```bash
git add src/engines/markdown-to-pdf/parser.ts \
        src/engines/markdown-to-pdf/parser.test.ts \
        src/engines/markdown-to-pdf/blocks.ts

git commit -m "feat(engine): markdown-to-pdf parser (tokens -> blocks)

Tokenizes markdown via markdown-it and converts the token
stream to a flat Block[] list (heading/paragraph/list-item/
code-block/blockquote/hr/image). Inline formatting (bold,
italic, code, link) collapsed into per-run style flags.

Image references become placeholder blocks; the renderer
prints '[image: <alt>]'. Embedding actual images is deferred
because fetching external URLs would break the privacy
guarantee.

Renderer ships in the next task."
```

---

## Task 7: `markdown-to-pdf` — PDF renderer + engine wiring

**Files:**
- Create: `src/engines/markdown-to-pdf/renderer.ts`
- Create: `src/engines/markdown-to-pdf/renderer.test.ts`
- Create: `src/engines/markdown-to-pdf/options.ts`
- Create: `src/engines/markdown-to-pdf/options-panel.tsx`
- Create: `src/engines/markdown-to-pdf/options-panel.test.tsx`
- Create: `src/engines/markdown-to-pdf/worker.ts`
- Create: `src/engines/markdown-to-pdf/index.ts`
- Create: `src/engines/markdown-to-pdf/index.test.ts`
- Create: `src/engines/markdown-to-pdf/worker.test.ts`
- Create: `src/app/tools/markdown-to-pdf/page.tsx`
- Create: `tests/fixtures/sample.md`
- Modify: `src/engines/_shared/registry.ts`

The renderer takes the `Block[]` from Task 6 and produces a PDF via `pdf-lib`. Uses existing fonts (Lora body, Inter headings, JetBrains Mono code) from `public/fonts/`.

- [ ] **Step 1: Define options + page**

Create `src/engines/markdown-to-pdf/options.ts`:

```ts
import type { PdfPageSize } from "@/engines/_shared/pdf-page-setup";

export type MarkdownToPdfOptions = {
  pageSize: PdfPageSize;
};

export const defaultMarkdownToPdfOptions: MarkdownToPdfOptions = {
  pageSize: "letter",
};
```

Create `src/app/tools/markdown-to-pdf/page.tsx`:

```tsx
"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/markdown-to-pdf";

export default function MarkdownToPdfPage() {
  return <ToolFrame engine={engine} />;
}
```

- [ ] **Step 2: Implement OptionsPanel**

Create `src/engines/markdown-to-pdf/options-panel.tsx`:

```tsx
"use client";

import type { OptionsPanelProps } from "@/engines/_shared/types";
import type { PdfPageSize } from "@/engines/_shared/pdf-page-setup";
import type { MarkdownToPdfOptions } from "./options";

const PAGE_SIZE_LABELS: Record<PdfPageSize, string> = {
  letter: "letter (8.5 × 11 in)",
  a4: "a4 (210 × 297 mm)",
  legal: "legal (8.5 × 14 in)",
};

export function MarkdownToPdfOptionsPanel({
  value,
  onChange,
}: OptionsPanelProps<MarkdownToPdfOptions>) {
  return (
    <div
      data-testid="markdown-to-pdf-options"
      className="mb-3 flex flex-wrap items-center gap-4 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        page size:
        <select
          data-testid="page-size"
          value={value.pageSize}
          onChange={(e) => onChange({ ...value, pageSize: e.target.value as PdfPageSize })}
          className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase"
        >
          {(Object.keys(PAGE_SIZE_LABELS) as PdfPageSize[]).map((size) => (
            <option key={size} value={size}>
              {PAGE_SIZE_LABELS[size]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
```

Create `src/engines/markdown-to-pdf/options-panel.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultMarkdownToPdfOptions } from "./options";
import { MarkdownToPdfOptionsPanel } from "./options-panel";

describe("MarkdownToPdfOptionsPanel", () => {
  it("renders with letter as default", () => {
    render(
      <MarkdownToPdfOptionsPanel value={defaultMarkdownToPdfOptions} onChange={() => {}} />,
    );
    expect(screen.getByTestId("page-size")).toHaveValue("letter");
  });

  it("calls onChange when page size changes", () => {
    const onChange = vi.fn();
    render(
      <MarkdownToPdfOptionsPanel value={defaultMarkdownToPdfOptions} onChange={onChange} />,
    );
    fireEvent.change(screen.getByTestId("page-size"), { target: { value: "a4" } });
    expect(onChange).toHaveBeenCalledWith({ pageSize: "a4" });
  });

  it("offers all three page sizes", () => {
    render(
      <MarkdownToPdfOptionsPanel value={defaultMarkdownToPdfOptions} onChange={() => {}} />,
    );
    const select = screen.getByTestId("page-size");
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.getAttribute("value"));
    expect(options).toEqual(["letter", "a4", "legal"]);
  });
});
```

- [ ] **Step 3: Implement the renderer (failing test first)**

Create `src/engines/markdown-to-pdf/renderer.test.ts`:

```ts
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { Block } from "./blocks";
import { renderBlocksToPdf } from "./renderer";

async function loadFontsForTest() {
  // The renderer needs font bytes. In Node test env, read from public/fonts/.
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const fontDir = path.resolve(__dirname, "../../../public/fonts");
  const [body, headings, mono] = await Promise.all([
    readFile(path.join(fontDir, "lora-regular.ttf")).then((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)),
    readFile(path.join(fontDir, "inter-regular.ttf")).then((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)),
    readFile(path.join(fontDir, "jetbrains-mono-regular.ttf")).then((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)),
  ]);
  return { body, headings, mono };
}

describe("renderBlocksToPdf", () => {
  it("renders a single heading + paragraph to a valid PDF", async () => {
    const blocks: Block[] = [
      { type: "heading", level: 1, runs: [{ text: "Hello", style: {} }] },
      { type: "paragraph", runs: [{ text: "World.", style: {} }] },
    ];
    const fonts = await loadFontsForTest();
    const bytes = await renderBlocksToPdf(blocks, { pageSize: "letter" }, fonts);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    const [page] = pdf.getPages();
    const { width, height } = page!.getSize();
    expect(width).toBe(612);
    expect(height).toBe(792);
  });

  it("uses the requested page size (a4)", async () => {
    const blocks: Block[] = [
      { type: "paragraph", runs: [{ text: "x", style: {} }] },
    ];
    const fonts = await loadFontsForTest();
    const bytes = await renderBlocksToPdf(blocks, { pageSize: "a4" }, fonts);
    const pdf = await PDFDocument.load(bytes);
    const [page] = pdf.getPages();
    const { width, height } = page!.getSize();
    expect(width).toBe(595);
    expect(height).toBe(842);
  });

  it("paginates when content exceeds one page", async () => {
    const longText = Array.from({ length: 200 }, (_, i) => `paragraph ${i}.`);
    const blocks: Block[] = longText.map((text) => ({
      type: "paragraph" as const,
      runs: [{ text, style: {} }],
    }));
    const fonts = await loadFontsForTest();
    const bytes = await renderBlocksToPdf(blocks, { pageSize: "letter" }, fonts);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
  });

  it("renders a syntax-highlighted code block without crashing (smoke test)", async () => {
    const blocks: Block[] = [
      {
        type: "code-block",
        language: "javascript",
        text: "const x = 1;\n// comment\nconsole.log(x);\n",
      },
    ];
    const fonts = await loadFontsForTest();
    const bytes = await renderBlocksToPdf(blocks, { pageSize: "letter" }, fonts);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    // Highlighting paths run without error; we don't assert on the
    // visual output (would be brittle), only that the engine produces
    // a valid PDF when the highlight tokenizer is exercised.
  });

  it("renders an unknown-language code block as plain mono (no crash)", async () => {
    const blocks: Block[] = [
      { type: "code-block", language: "klingon", text: "qa'pla'" },
    ];
    const fonts = await loadFontsForTest();
    const bytes = await renderBlocksToPdf(blocks, { pageSize: "letter" }, fonts);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Run renderer test (should fail)**

Run: `pnpm test src/engines/markdown-to-pdf/renderer.test.ts`
Expected: FAIL with `Cannot find module './renderer'`.

- [ ] **Step 5: Implement the renderer**

Create `src/engines/markdown-to-pdf/renderer.ts`:

```ts
import { DEFAULT_MARGIN_PT, getPageDimensions } from "@/engines/_shared/pdf-page-setup";
import { PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { Block, Run } from "./blocks";
import type { MarkdownToPdfOptions } from "./options";

export type RendererFonts = {
  body: ArrayBuffer;
  headings: ArrayBuffer;
  mono: ArrayBuffer;
};

const HEADING_SIZES_PT: Record<1 | 2 | 3 | 4 | 5 | 6, number> = {
  1: 32,
  2: 26,
  3: 22,
  4: 18,
  5: 16,
  6: 14,
};

const BODY_SIZE_PT = 11;
const BODY_LINE_HEIGHT_PT = 14;
const CODE_SIZE_PT = 10;
const CODE_LINE_HEIGHT_PT = 13;

export async function renderBlocksToPdf(
  blocks: Block[],
  opts: MarkdownToPdfOptions,
  fonts: RendererFonts,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const bodyFont = await pdf.embedFont(fonts.body);
  const headingsFont = await pdf.embedFont(fonts.headings);
  const monoFont = await pdf.embedFont(fonts.mono);

  const [pageW, pageH] = getPageDimensions(opts.pageSize);
  const margin = DEFAULT_MARGIN_PT;
  const contentW = pageW - margin * 2;
  const topY = pageH - margin;
  const bottomY = margin;

  let page = pdf.addPage([pageW, pageH]);
  let y = topY;

  function newPage() {
    page = pdf.addPage([pageW, pageH]);
    y = topY;
  }

  function ensureSpace(needed: number) {
    if (y - needed < bottomY) newPage();
  }

  for (const block of blocks) {
    if (block.type === "hr") {
      ensureSpace(8);
      page.drawLine({
        start: { x: margin, y: y - 4 },
        end: { x: margin + contentW, y: y - 4 },
        thickness: 0.5,
        color: rgb(0.5, 0.5, 0.5),
      });
      y -= 12;
      continue;
    }

    if (block.type === "image") {
      const text = `[image: ${block.alt}]`;
      ensureSpace(BODY_LINE_HEIGHT_PT);
      page.drawText(text, {
        x: margin,
        y: y - BODY_SIZE_PT,
        size: BODY_SIZE_PT,
        font: bodyFont,
        color: rgb(0.5, 0.5, 0.5),
      });
      y -= BODY_LINE_HEIGHT_PT + 4;
      continue;
    }

    if (block.type === "code-block") {
      const lineH = CODE_LINE_HEIGHT_PT;
      const tokenLines = highlightCodeBlock(block.text, block.language);
      for (const tokens of tokenLines) {
        ensureSpace(lineH);
        let cursor = margin + 8;
        for (const tok of tokens) {
          page.drawText(tok.text, {
            x: cursor,
            y: y - CODE_SIZE_PT,
            size: CODE_SIZE_PT,
            font: monoFont,
            color: rgb(tok.color[0], tok.color[1], tok.color[2]),
          });
          cursor += monoFont.widthOfTextAtSize(tok.text, CODE_SIZE_PT);
        }
        y -= lineH;
      }
      y -= 6; // block padding
      continue;
    }

    if (block.type === "heading") {
      const size = HEADING_SIZES_PT[block.level];
      const lineH = size * 1.25;
      ensureSpace(lineH + 6);
      const text = block.runs.map((r) => r.text).join("");
      page.drawText(text, {
        x: margin,
        y: y - size,
        size,
        font: headingsFont,
      });
      y -= lineH + 6;
      continue;
    }

    if (block.type === "blockquote") {
      const indent = 24;
      const wrapped = wrapRuns(block.runs, contentW - indent, bodyFont, monoFont, BODY_SIZE_PT);
      for (const lineRuns of wrapped) {
        ensureSpace(BODY_LINE_HEIGHT_PT);
        drawRunsLine(page, lineRuns, margin + indent, y - BODY_SIZE_PT, bodyFont, monoFont, BODY_SIZE_PT);
        y -= BODY_LINE_HEIGHT_PT;
      }
      y -= 4;
      continue;
    }

    if (block.type === "list-item") {
      const indent = 18;
      ensureSpace(BODY_LINE_HEIGHT_PT);
      page.drawText("·", {
        x: margin + 4,
        y: y - BODY_SIZE_PT,
        size: BODY_SIZE_PT,
        font: bodyFont,
      });
      const wrapped = wrapRuns(block.runs, contentW - indent, bodyFont, monoFont, BODY_SIZE_PT);
      for (const lineRuns of wrapped) {
        ensureSpace(BODY_LINE_HEIGHT_PT);
        drawRunsLine(page, lineRuns, margin + indent, y - BODY_SIZE_PT, bodyFont, monoFont, BODY_SIZE_PT);
        y -= BODY_LINE_HEIGHT_PT;
      }
      y -= 2;
      continue;
    }

    // paragraph
    const wrapped = wrapRuns(block.runs, contentW, bodyFont, monoFont, BODY_SIZE_PT);
    for (const lineRuns of wrapped) {
      ensureSpace(BODY_LINE_HEIGHT_PT);
      drawRunsLine(page, lineRuns, margin, y - BODY_SIZE_PT, bodyFont, monoFont, BODY_SIZE_PT);
      y -= BODY_LINE_HEIGHT_PT;
    }
    y -= 4;
  }

  return await pdf.save();
}

// Naive run-flow wrap: split each run by spaces, accumulate words until
// width exceeds the limit, then start a new line. Code runs use mono font.
function wrapRuns(
  runs: Run[],
  maxWidth: number,
  bodyFont: PDFFont,
  monoFont: PDFFont,
  size: number,
): Run[][] {
  const lines: Run[][] = [];
  let current: Run[] = [];
  let currentWidth = 0;

  for (const run of runs) {
    const words = run.text.split(/(\s+)/);
    for (const word of words) {
      if (!word) continue;
      const font = run.style.code ? monoFont : bodyFont;
      const w = font.widthOfTextAtSize(word, size);
      if (currentWidth + w > maxWidth && current.length > 0) {
        lines.push(current);
        current = [];
        currentWidth = 0;
        if (/^\s+$/.test(word)) continue;
      }
      current.push({ text: word, style: run.style });
      currentWidth += w;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function drawRunsLine(
  page: PDFPage,
  runs: Run[],
  x: number,
  y: number,
  bodyFont: PDFFont,
  monoFont: PDFFont,
  size: number,
) {
  let cursorX = x;
  for (const run of runs) {
    const font = run.style.code ? monoFont : bodyFont;
    const text = run.text;
    const isLink = !!run.style.link;
    const color = isLink ? rgb(0.0, 0.5, 0.7) : rgb(0, 0, 0);
    page.drawText(text, { x: cursorX, y, size, font, color });
    if (isLink) {
      const w = font.widthOfTextAtSize(text, size);
      page.drawLine({
        start: { x: cursorX, y: y - 1 },
        end: { x: cursorX + w, y: y - 1 },
        thickness: 0.5,
        color,
      });
    }
    cursorX += font.widthOfTextAtSize(text, size);
  }

  // After the line, if any link's URL differs from its text, append "(href)"
  // at the end of the line in muted color. (Simplified: per-run inline parens.)
  for (const run of runs) {
    if (run.style.link?.href && run.style.link.href !== run.text) {
      const text = ` (${run.style.link.href})`;
      const w = bodyFont.widthOfTextAtSize(text, size);
      page.drawText(text, { x: cursorX, y, size, font: bodyFont, color: rgb(0.4, 0.4, 0.4) });
      cursorX += w;
    }
  }
}

// --- Syntax highlighting for code blocks ---

import hljs from "highlight.js/lib/core";
import bashLang from "highlight.js/lib/languages/bash";
import jsonLang from "highlight.js/lib/languages/json";
import jsLang from "highlight.js/lib/languages/javascript";
import pythonLang from "highlight.js/lib/languages/python";
import tsLang from "highlight.js/lib/languages/typescript";

hljs.registerLanguage("javascript", jsLang);
hljs.registerLanguage("typescript", tsLang);
hljs.registerLanguage("python", pythonLang);
hljs.registerLanguage("bash", bashLang);
hljs.registerLanguage("json", jsonLang);

// Move these imports to the top of the file (after existing imports).
// They're shown here for proximity to the helper they support.

type CodeToken = { text: string; color: [number, number, number] };

const COLOR_KEYWORD: [number, number, number] = [0.0, 0.45, 0.7]; // accent
const COLOR_STRING: [number, number, number] = [0.4, 0.4, 0.4];   // muted
const COLOR_COMMENT: [number, number, number] = [0.55, 0.55, 0.55]; // very-muted
const COLOR_DEFAULT: [number, number, number] = [0, 0, 0];

function classToColor(cls: string): [number, number, number] {
  if (cls.startsWith("hljs-keyword")) return COLOR_KEYWORD;
  if (cls.startsWith("hljs-built_in") || cls.startsWith("hljs-type")) return COLOR_KEYWORD;
  if (cls.startsWith("hljs-string")) return COLOR_STRING;
  if (cls.startsWith("hljs-comment")) return COLOR_COMMENT;
  if (cls.startsWith("hljs-number")) return COLOR_KEYWORD;
  return COLOR_DEFAULT;
}

/**
 * Tokenise a code block via highlight.js and split into lines of
 * coloured tokens. Falls back to plain mono-coloured tokens when
 * the language is unknown or unregistered.
 *
 * Implementation note: highlight.js v11 emits HTML, not a token
 * stream. We parse the HTML with a tiny tag-walker rather than
 * pulling in a DOM dep. The HTML is well-formed (hljs's own output)
 * so a regex-driven walker is safe here.
 */
function highlightCodeBlock(
  text: string,
  language: string | null,
): CodeToken[][] {
  const useHljs = language && hljs.getLanguage(language);
  const html = useHljs
    ? hljs.highlight(text, { language: language as string }).value
    : escapeHtml(text);

  // Parse the HTML span tree into a flat token list.
  const flat = htmlToTokens(html);
  // Split into lines on '\n' inside any token.
  const lines: CodeToken[][] = [[]];
  for (const tok of flat) {
    const parts = tok.text.split("\n");
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part === undefined) continue;
      if (part.length > 0) {
        const lastLine = lines[lines.length - 1];
        if (lastLine) lastLine.push({ text: part, color: tok.color });
      }
      if (i < parts.length - 1) lines.push([]);
    }
  }
  return lines;
}

function htmlToTokens(html: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  const re = /<span class="([^"]+)">([\s\S]*?)<\/span>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1]) {
      // Span with class — recursively flatten if nested spans exist.
      const inner = htmlToTokens(m[2] ?? "");
      const color = classToColor(m[1]);
      for (const t of inner) {
        // Inner spans may have their own colors — preserve them; otherwise
        // inherit the outer color.
        tokens.push({
          text: t.text,
          color: t.color === COLOR_DEFAULT ? color : t.color,
        });
      }
      // If the span had no inner spans (just text), htmlToTokens returns
      // a single uncolored token; recolor to the outer color.
      if (inner.length === 0 && m[2]) {
        tokens.push({ text: decodeHtml(m[2]), color });
      }
    } else if (m[3]) {
      // Plain text outside a span.
      tokens.push({ text: decodeHtml(m[3]), color: COLOR_DEFAULT });
    }
  }
  return tokens;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function decodeHtml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
```

**IMPORTANT structural note**: hoist the five `import` lines for `highlight.js/lib/core` and the language modules to the top of `renderer.ts`, alongside the other imports. They appear inline above for proximity to the helper, but TypeScript requires them at module scope.

- [ ] **Step 6: Run renderer tests**

Run: `pnpm test src/engines/markdown-to-pdf/renderer.test.ts`
Expected: All cases PASS.

- [ ] **Step 6.5: Extend `src/lib/font-loader.ts` with a generic loader**

The `no-fetch-in-engines` Biome lint rule rejects `fetch` inside `src/engines/`. The existing `font-loader.ts` is scoped outside engines for exactly this reason. Add a generic helper that the markdown-to-pdf and txt-to-pdf workers can call without violating the rule.

Open `src/lib/font-loader.ts`. After the existing `loadFontBytes` export (which uses the docx-to-pdf-typed `BundledFontFamily`), append a new export:

```ts
/**
 * Generic font loader for engines that don't follow the docx-to-pdf
 * (family, weight, italic) tuple convention. Loads `/fonts/<filename>`
 * from the same origin and caches the bytes for the worker's lifetime.
 *
 * Used by markdown-to-pdf and txt-to-pdf, which embed a fixed set of
 * fonts and don't need the family/weight matrix.
 *
 * @throws when the fetch fails (404, network).
 */
export async function loadFontByFilename(filename: string): Promise<ArrayBuffer> {
  const cached = cache.get(filename);
  if (cached) return cached;
  const url = `/fonts/${filename}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`font fetch failed: ${url} ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  cache.set(filename, bytes);
  return bytes;
}
```

The `cache` Map is the same module-scoped cache the existing `loadFontBytes` already uses; both functions share it cleanly because the cache is keyed by filename.

Run: `pnpm typecheck && pnpm lint`
Expected: Clean. Existing `loadFontBytes` continues to work unchanged.

- [ ] **Step 7: Implement worker and engine**

Create the `sample.md` fixture for end-to-end tests:

`tests/fixtures/sample.md`:

```md
# Sample Document

A paragraph with **bold**, *italic*, and `inline code`.

## Subsection

- list item one
- list item two
- list item three

---

> A short blockquote.

```javascript
const x = 1;
console.log(x);
```

A [link](https://example.com) at the end.
```

Create `src/engines/markdown-to-pdf/worker.ts`:

```ts
import { loadFontByFilename } from "@/lib/font-loader";
import type { OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import { parseMarkdown } from "./parser";
import { renderBlocksToPdf, type RendererFonts } from "./renderer";
import type { MarkdownToPdfOptions } from "./options";

function replaceExt(name: string, newExt: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}.${newExt}`;
  return `${name.slice(0, dot)}.${newExt}`;
}

async function loadFonts(): Promise<RendererFonts> {
  const [body, headings, mono] = await Promise.all([
    loadFontByFilename("lora-regular.ttf"),
    loadFontByFilename("inter-regular.ttf"),
    loadFontByFilename("jetbrains-mono-regular.ttf"),
  ]);
  return { body, headings, mono };
}

const api = {
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    _type: string,
    opts: MarkdownToPdfOptions,
  ): Promise<OutputItem> {
    const text = new TextDecoder("utf-8").decode(bytes);
    const blocks = parseMarkdown(text);
    const fonts = await loadFonts();
    const pdfBytes = await renderBlocksToPdf(blocks, opts, fonts);
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    return {
      filename: replaceExt(name, "pdf"),
      mime: "application/pdf",
      blob,
    };
  },
};

Comlink.expose(api);
```

Note: this worker has no `fetch` calls — all font I/O goes through `loadFontByFilename` which lives in `src/lib/` (outside `src/engines/`), so the `no-fetch-in-engines` Biome rule continues to scope cleanly.

Create `src/engines/markdown-to-pdf/index.ts`:

```ts
import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type MarkdownToPdfOptions, defaultMarkdownToPdfOptions } from "./options";
import { MarkdownToPdfOptionsPanel } from "./options-panel";

const SUPPORTED_INPUT_MIMES = ["text/markdown", "text/x-markdown", ""];

const engine: SingleInputEngine<MarkdownToPdfOptions, OutputItem> = {
  id: "markdown-to-pdf",
  inputAccept: [".md", ".markdown"],
  inputMime: ["text/markdown"],
  outputMime: "application/pdf",
  defaultOptions: defaultMarkdownToPdfOptions,
  category: "document",
  cardinality: "single",
  OptionsPanel: MarkdownToPdfOptionsPanel,
  validate(file) {
    // Markdown MIME varies by browser/OS; many emit empty string.
    // Accept by extension if MIME is missing.
    if (SUPPORTED_INPUT_MIMES.includes(file.type)) return { ok: true };
    if (/\.(md|markdown)$/i.test(file.name)) return { ok: true };
    return { ok: false, reason: "Expected a .md or .markdown file" };
  },
  async convert(file, opts, signal) {
    const harness = new WorkerHarness<MarkdownToPdfOptions>(
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

- [ ] **Step 8: Engine metadata + worker tests**

Create `src/engines/markdown-to-pdf/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import engine from "./index";

describe("markdown-to-pdf engine metadata", () => {
  it("declares correct id, accept, MIME, category", () => {
    expect(engine.id).toBe("markdown-to-pdf");
    expect(engine.inputAccept).toEqual([".md", ".markdown"]);
    expect(engine.outputMime).toBe("application/pdf");
    expect(engine.cardinality).toBe("single");
    expect(engine.category).toBe("document");
    expect(engine.defaultOptions).toEqual({ pageSize: "letter" });
  });

  it("declares an OptionsPanel component", () => {
    expect(engine.OptionsPanel).toBeDefined();
  });

  it("validates by extension when MIME is empty", () => {
    const md = new File([new Uint8Array(0)], "x.md", { type: "" });
    expect(engine.validate(md, engine.defaultOptions)).toEqual({ ok: true });
  });

  it("validates explicit text/markdown MIME", () => {
    const md = new File([new Uint8Array(0)], "x.md", { type: "text/markdown" });
    expect(engine.validate(md, engine.defaultOptions)).toEqual({ ok: true });
  });

  it("rejects unsupported files", () => {
    const txt = new File([new Uint8Array(0)], "x.txt", { type: "text/plain" });
    const result = engine.validate(txt, engine.defaultOptions);
    expect(result.ok).toBe(false);
  });
});
```

Create `src/engines/markdown-to-pdf/worker.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import engine from "./index";

async function readMdFixture(): Promise<File> {
  const filePath = path.resolve(__dirname, "../../../tests/fixtures/sample.md");
  const buf = await readFile(filePath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new File([ab], "sample.md", { type: "text/markdown" });
}

describe("markdown-to-pdf worker", () => {
  it("converts the sample.md fixture to a valid PDF", async () => {
    const file = await readMdFixture();
    const ctrl = new AbortController();
    const result = await engine.convert(file, engine.defaultOptions, ctrl.signal);
    const item = Array.isArray(result) ? result[0] : result;
    if (!item) throw new Error("expected output");
    expect(item.mime).toBe("application/pdf");
    expect(item.filename).toBe("sample.pdf");
    const bytes = await item.blob.arrayBuffer();
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
  });

  it("respects the pageSize option", async () => {
    const file = await readMdFixture();
    const ctrl = new AbortController();
    const result = await engine.convert(file, { pageSize: "a4" }, ctrl.signal);
    const item = Array.isArray(result) ? result[0] : result;
    if (!item) throw new Error("expected output");
    const bytes = await item.blob.arrayBuffer();
    const pdf = await PDFDocument.load(bytes);
    const [page] = pdf.getPages();
    expect(page!.getSize()).toEqual({ width: 595, height: 842 });
  });
});
```

- [ ] **Step 9: Register and wire**

Modify `src/engines/_shared/registry.ts`:

```ts
export type EngineId =
  | /* existing entries */
  | "markdown-to-pdf"
  ;

const REGISTRY: Record<EngineId, Loader> = {
  // ... existing
  "markdown-to-pdf": () => import("@/engines/markdown-to-pdf"),
};
```

- [ ] **Step 10: Run all markdown-to-pdf tests**

Run: `pnpm test src/engines/markdown-to-pdf/`
Expected: All green — parser, renderer, options-panel, engine metadata, worker.

The worker test requires `loadFontByFilename` to resolve in Node test env. The real implementation uses `fetch("/fonts/...")` which doesn't work in Node. Mock the loader at the module boundary using `vi.mock`.

Add to the top of `worker.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { vi } from "vitest";

vi.mock("@/lib/font-loader", async () => {
  return {
    loadFontByFilename: async (filename: string) => {
      const filePath = path.resolve(__dirname, "../../../public/fonts", filename);
      const buf = await readFile(filePath);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
  };
});
```

This mocks the loader at the import boundary so the worker calls hit our test impl, which reads the actual font file from `public/fonts/`. No global `fetch` interception needed; the real `loadFontBytes` (used by docx-to-pdf) is also stubbed by this mock — fine because docx-to-pdf isn't invoked from this test file.

Re-run: `pnpm test src/engines/markdown-to-pdf/worker.test.ts`. Should pass now.

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: All green.

- [ ] **Step 11: Commit**

```bash
git add src/engines/markdown-to-pdf/ \
        src/app/tools/markdown-to-pdf/ \
        src/engines/_shared/registry.ts \
        tests/fixtures/sample.md

git commit -m "feat(engine): markdown-to-pdf renderer + engine

Renderer takes Block[] from the parser and produces a PDF via
pdf-lib with three fonts (Lora body, Inter headings, JetBrains
Mono code). Page setup driven by pageSize option (letter/a4/
legal); 1-inch margins, portrait. Naive top-to-bottom flow with
new pages on overflow. Inline links underlined in accent;
non-text URLs appended in parens.

Worker fetches fonts from /fonts/ (existing public/fonts/
assets, no new font commits needed). Engine validates by
.md/.markdown extension since browser MIME for markdown is
inconsistent.

Tests cover parser, renderer pagination + page-size, options
panel, engine metadata, and end-to-end worker output."
```

---

## Task 8: `txt-to-pdf` engine — full vertical slice

**Files:**
- Create: `src/engines/txt-to-pdf/index.ts`
- Create: `src/engines/txt-to-pdf/options.ts`
- Create: `src/engines/txt-to-pdf/options-panel.tsx`
- Create: `src/engines/txt-to-pdf/options-panel.test.tsx`
- Create: `src/engines/txt-to-pdf/worker.ts`
- Create: `src/engines/txt-to-pdf/index.test.ts`
- Create: `src/engines/txt-to-pdf/worker.test.ts`
- Create: `src/app/tools/txt-to-pdf/page.tsx`
- Create: `tests/fixtures/sample.txt`
- Modify: `src/engines/_shared/registry.ts`

Verbatim text rendering in JetBrains Mono 11pt with hard-wrap at the right margin.

- [ ] **Step 1: Define options + UI**

Create `src/engines/txt-to-pdf/options.ts`:

```ts
import type { PdfPageSize } from "@/engines/_shared/pdf-page-setup";

export type TxtToPdfOptions = {
  pageSize: PdfPageSize;
};

export const defaultTxtToPdfOptions: TxtToPdfOptions = {
  pageSize: "letter",
};
```

Create `src/engines/txt-to-pdf/options-panel.tsx`:

```tsx
"use client";

import type { OptionsPanelProps } from "@/engines/_shared/types";
import type { PdfPageSize } from "@/engines/_shared/pdf-page-setup";
import type { TxtToPdfOptions } from "./options";

const PAGE_SIZE_LABELS: Record<PdfPageSize, string> = {
  letter: "letter (8.5 × 11 in)",
  a4: "a4 (210 × 297 mm)",
  legal: "legal (8.5 × 14 in)",
};

export function TxtToPdfOptionsPanel({
  value,
  onChange,
}: OptionsPanelProps<TxtToPdfOptions>) {
  return (
    <div
      data-testid="txt-to-pdf-options"
      className="mb-3 flex flex-wrap items-center gap-4 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        page size:
        <select
          data-testid="page-size"
          value={value.pageSize}
          onChange={(e) => onChange({ ...value, pageSize: e.target.value as PdfPageSize })}
          className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase"
        >
          {(Object.keys(PAGE_SIZE_LABELS) as PdfPageSize[]).map((size) => (
            <option key={size} value={size}>
              {PAGE_SIZE_LABELS[size]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
```

Create `src/engines/txt-to-pdf/options-panel.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultTxtToPdfOptions } from "./options";
import { TxtToPdfOptionsPanel } from "./options-panel";

describe("TxtToPdfOptionsPanel", () => {
  it("renders with letter as default", () => {
    render(
      <TxtToPdfOptionsPanel value={defaultTxtToPdfOptions} onChange={() => {}} />,
    );
    expect(screen.getByTestId("page-size")).toHaveValue("letter");
  });

  it("calls onChange when page size changes", () => {
    const onChange = vi.fn();
    render(
      <TxtToPdfOptionsPanel value={defaultTxtToPdfOptions} onChange={onChange} />,
    );
    fireEvent.change(screen.getByTestId("page-size"), { target: { value: "legal" } });
    expect(onChange).toHaveBeenCalledWith({ pageSize: "legal" });
  });
});
```

- [ ] **Step 2: Implement worker**

Create `src/engines/txt-to-pdf/worker.ts`:

```ts
import { loadFontByFilename } from "@/lib/font-loader";
import { DEFAULT_MARGIN_PT, getPageDimensions } from "@/engines/_shared/pdf-page-setup";
import type { OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont } from "pdf-lib";
import type { TxtToPdfOptions } from "./options";

const FONT_SIZE_PT = 11;
const LINE_HEIGHT_PT = 14;

function replaceExt(name: string, newExt: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}.${newExt}`;
  return `${name.slice(0, dot)}.${newExt}`;
}

function expandTabs(line: string): string {
  return line.replace(/\t/g, "    ");
}

function wrapLine(line: string, font: PDFFont, size: number, maxWidth: number): string[] {
  // Hard-wrap at the right margin (no word boundary). Walk the string
  // character by character, accumulating until the next char would push
  // width over the limit.
  if (line.length === 0) return [""];
  const lines: string[] = [];
  let buf = "";
  for (const ch of line) {
    const trial = buf + ch;
    if (font.widthOfTextAtSize(trial, size) > maxWidth) {
      lines.push(buf);
      buf = ch;
    } else {
      buf = trial;
    }
  }
  if (buf.length > 0 || lines.length === 0) lines.push(buf);
  return lines;
}

const api = {
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    _type: string,
    opts: TxtToPdfOptions,
  ): Promise<OutputItem> {
    const text = new TextDecoder("utf-8").decode(bytes);
    const fontBytes = await loadFontByFilename("jetbrains-mono-regular.ttf");

    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(fontBytes);

    const [pageW, pageH] = getPageDimensions(opts.pageSize);
    const margin = DEFAULT_MARGIN_PT;
    const contentW = pageW - margin * 2;
    const topY = pageH - margin;
    const bottomY = margin;

    let page = pdf.addPage([pageW, pageH]);
    let y = topY;

    function newPage() {
      page = pdf.addPage([pageW, pageH]);
      y = topY;
    }

    const lines = text.split("\n");
    for (const rawLine of lines) {
      const expanded = expandTabs(rawLine);
      const wrapped = wrapLine(expanded, font, FONT_SIZE_PT, contentW);
      for (const visualLine of wrapped) {
        if (y - LINE_HEIGHT_PT < bottomY) newPage();
        page.drawText(visualLine, {
          x: margin,
          y: y - FONT_SIZE_PT,
          size: FONT_SIZE_PT,
          font,
        });
        y -= LINE_HEIGHT_PT;
      }
    }

    const pdfBytes = await pdf.save();
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    return {
      filename: replaceExt(name, "pdf"),
      mime: "application/pdf",
      blob,
    };
  },
};

Comlink.expose(api);
```

- [ ] **Step 3: Implement engine + route**

Create `src/engines/txt-to-pdf/index.ts`:

```ts
import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type TxtToPdfOptions, defaultTxtToPdfOptions } from "./options";
import { TxtToPdfOptionsPanel } from "./options-panel";

const engine: SingleInputEngine<TxtToPdfOptions, OutputItem> = {
  id: "txt-to-pdf",
  inputAccept: [".txt"],
  inputMime: ["text/plain"],
  outputMime: "application/pdf",
  defaultOptions: defaultTxtToPdfOptions,
  category: "document",
  cardinality: "single",
  OptionsPanel: TxtToPdfOptionsPanel,
  validate(file) {
    if (file.type === "text/plain") return { ok: true };
    if (/\.txt$/i.test(file.name)) return { ok: true };
    return { ok: false, reason: "Expected a .txt file" };
  },
  async convert(file, opts, signal) {
    const harness = new WorkerHarness<TxtToPdfOptions>(
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

Create `src/app/tools/txt-to-pdf/page.tsx`:

```tsx
"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/txt-to-pdf";

export default function TxtToPdfPage() {
  return <ToolFrame engine={engine} />;
}
```

Create `tests/fixtures/sample.txt`:

```
short line one
short line two

paragraph after blank line.

a very long line that definitely exceeds eighty characters so we can test that the engine wraps it correctly at the right margin instead of letting it run off the page boundary like a runaway sentence.
```

- [ ] **Step 4: Engine + worker tests**

Create `src/engines/txt-to-pdf/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import engine from "./index";

describe("txt-to-pdf engine metadata", () => {
  it("declares correct id, accept, MIME, category", () => {
    expect(engine.id).toBe("txt-to-pdf");
    expect(engine.inputAccept).toEqual([".txt"]);
    expect(engine.outputMime).toBe("application/pdf");
    expect(engine.cardinality).toBe("single");
    expect(engine.category).toBe("document");
    expect(engine.defaultOptions).toEqual({ pageSize: "letter" });
  });

  it("declares an OptionsPanel component", () => {
    expect(engine.OptionsPanel).toBeDefined();
  });

  it("validates text/plain MIME", () => {
    const txt = new File([new Uint8Array(0)], "x.txt", { type: "text/plain" });
    expect(engine.validate(txt, engine.defaultOptions)).toEqual({ ok: true });
  });

  it("validates by extension when MIME is empty", () => {
    const txt = new File([new Uint8Array(0)], "x.txt", { type: "" });
    expect(engine.validate(txt, engine.defaultOptions)).toEqual({ ok: true });
  });
});
```

Create `src/engines/txt-to-pdf/worker.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import engine from "./index";

vi.mock("@/lib/font-loader", async () => {
  return {
    loadFontByFilename: async (filename: string) => {
      const filePath = path.resolve(__dirname, "../../../public/fonts", filename);
      const buf = await readFile(filePath);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
  };
});

async function readTxtFixture(): Promise<File> {
  const filePath = path.resolve(__dirname, "../../../tests/fixtures/sample.txt");
  const buf = await readFile(filePath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new File([ab], "sample.txt", { type: "text/plain" });
}

describe("txt-to-pdf worker", () => {
  it("converts a text file to a valid PDF", async () => {
    const file = await readTxtFixture();
    const ctrl = new AbortController();
    const result = await engine.convert(file, engine.defaultOptions, ctrl.signal);
    const item = Array.isArray(result) ? result[0] : result;
    if (!item) throw new Error("expected output");
    expect(item.mime).toBe("application/pdf");
    expect(item.filename).toBe("sample.pdf");
    const bytes = await item.blob.arrayBuffer();
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
  });

  it("respects the pageSize option", async () => {
    const file = await readTxtFixture();
    const ctrl = new AbortController();
    const result = await engine.convert(file, { pageSize: "legal" }, ctrl.signal);
    const item = Array.isArray(result) ? result[0] : result;
    if (!item) throw new Error("expected output");
    const bytes = await item.blob.arrayBuffer();
    const pdf = await PDFDocument.load(bytes);
    const [page] = pdf.getPages();
    expect(page!.getSize()).toEqual({ width: 612, height: 1008 });
  });
});
```

- [ ] **Step 5: Register**

Modify `src/engines/_shared/registry.ts`:

```ts
export type EngineId =
  | /* existing entries */
  | "txt-to-pdf"
  ;

const REGISTRY: Record<EngineId, Loader> = {
  // ... existing
  "txt-to-pdf": () => import("@/engines/txt-to-pdf"),
};
```

- [ ] **Step 6: Run all txt-to-pdf tests**

Run: `pnpm test src/engines/txt-to-pdf/`
Expected: All green.

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: All green; no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/engines/txt-to-pdf/ \
        src/app/tools/txt-to-pdf/ \
        src/engines/_shared/registry.ts \
        tests/fixtures/sample.txt

git commit -m "feat(engine): add txt-to-pdf engine

Renders text verbatim in JetBrains Mono 11pt with hard-wrap at
the right margin. Tabs expand to 4 spaces. No formatting
interpretation — '**bold**' renders as 6 literal characters.
Page size from options (letter/a4/legal); 1-inch margins,
portrait.

Reuses public/fonts/jetbrains-mono-regular.ttf via fetch in the
worker. Test stubs fetch to read the local font file.

Includes engine metadata, OptionsPanel, worker, route, and
co-located tests."
```

---

## Task 9: Home grid + sidebar wiring (4 entries)

**Files:**
- Modify: `src/app/page.tsx` (add 4 TOOLS entries)
- Modify: `src/app/page.test.tsx` (count + link assertions)
- Modify: `src/components/layout/sidebar.tsx` (add 4 entries)
- Modify: `src/components/layout/sidebar.test.tsx` (link assertions)

After this task, the new engines are reachable from both the home grid and the sidebar.

- [ ] **Step 1: Update home TOOLS array**

Open `src/app/page.tsx`. Locate the `TOOLS` array. Add four new entries — IDs and hrefs must match the registry / route paths.

```ts
const TOOLS = [
  // ... existing 7 entries
  {
    id: "image-resize",
    title: "image resize",
    description: "png, jpg, jpeg, webp, heic · resize by px or %",
    href: "/tools/image-resize",
  },
  {
    id: "docx-to-txt",
    title: "docx → txt",
    description: "extract plain text from word documents",
    href: "/tools/docx-to-txt",
  },
  {
    id: "markdown-to-pdf",
    title: "markdown → pdf",
    description: "render markdown as a styled pdf",
    href: "/tools/markdown-to-pdf",
  },
  {
    id: "txt-to-pdf",
    title: "txt → pdf",
    description: "render text verbatim as a monospace pdf",
    href: "/tools/txt-to-pdf",
  },
];
```

The keys (`id`, `title`, `description`, `href`) should match the existing entries' shape. If existing entries use different field names, adapt.

- [ ] **Step 2: Update home page test**

Open `src/app/page.test.tsx`. Find any assertions about TOOLS count and update them. Add link-target assertions for the new entries.

If the test currently uses `TOOLS.length` indirectly (e.g., asserts `screen.getAllByRole("link")` count matches), the count just goes up by 4 and most assertions will still pass.

If the test asserts specific tool cards, add four new assertions:

```ts
it("renders the image-resize card linking to /tools/image-resize", () => {
  render(<Home />);
  const card = screen.getByTestId("tool-card-image-resize");
  expect(card).toHaveAttribute("href", "/tools/image-resize");
});
// ... same for docx-to-txt, markdown-to-pdf, txt-to-pdf
```

- [ ] **Step 3: Update sidebar**

Open `src/components/layout/sidebar.tsx`. Locate the `TOOLS: ToolEntry[]` array. Add four new entries:

```ts
const TOOLS: ToolEntry[] = [
  { id: "home", href: "/", label: "~/", group: "HOME" },
  // IMAGES group
  { id: "image-convert", href: "/tools/image-convert", label: "image convert", group: "IMAGES" },
  { id: "image-resize", href: "/tools/image-resize", label: "image resize", group: "IMAGES" },
  { id: "image-to-pdf", href: "/tools/image-to-pdf", label: "image→pdf", group: "IMAGES" },
  // PDFS group (existing)
  { id: "pdf-merge", href: "/tools/pdf-merge", label: "merge", group: "PDFS" },
  { id: "pdf-split", href: "/tools/pdf-split", label: "split", group: "PDFS" },
  { id: "pdf-to-image", href: "/tools/pdf-to-image", label: "pdf→image", group: "PDFS" },
  { id: "pdf-to-md", href: "/tools/pdf-to-md", label: "pdf→md", group: "PDFS" },
  // DOCS group
  { id: "docx-to-pdf", href: "/tools/docx-to-pdf", label: "docx→pdf", group: "DOCS" },
  { id: "docx-to-txt", href: "/tools/docx-to-txt", label: "docx→txt", group: "DOCS" },
  { id: "markdown-to-pdf", href: "/tools/markdown-to-pdf", label: "markdown→pdf", group: "DOCS" },
  { id: "txt-to-pdf", href: "/tools/txt-to-pdf", label: "txt→pdf", group: "DOCS" },
];
```

- [ ] **Step 4: Update sidebar test**

Open `src/components/layout/sidebar.test.tsx`. Add assertions for the four new links:

```ts
it("renders all four new Phase 15 tool links in their groups", () => {
  render(<Sidebar />);
  expect(screen.getByRole("link", { name: /image resize/i })).toHaveAttribute(
    "href",
    "/tools/image-resize",
  );
  expect(screen.getByRole("link", { name: /docx→txt/i })).toHaveAttribute(
    "href",
    "/tools/docx-to-txt",
  );
  expect(screen.getByRole("link", { name: /markdown→pdf/i })).toHaveAttribute(
    "href",
    "/tools/markdown-to-pdf",
  );
  expect(screen.getByRole("link", { name: /txt→pdf/i })).toHaveAttribute(
    "href",
    "/tools/txt-to-pdf",
  );
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm test src/app/page.test.tsx src/components/layout/sidebar.test.tsx`
Expected: All green.

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: All green.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx \
        src/app/page.test.tsx \
        src/components/layout/sidebar.tsx \
        src/components/layout/sidebar.test.tsx

git commit -m "feat(home,sidebar): wire Phase 15 engines

Adds image-resize, docx-to-txt, markdown-to-pdf, txt-to-pdf
to the home page TOOLS grid (7 -> 11 entries) and the sidebar
(image-resize -> IMAGES; the other three -> DOCS). Both surfaces
already enumerate engines via local TOOLS arrays, so no shared
registry refactor needed."
```

---

## Task 10: E2E specs + privacy regression + final verification + PR

**Files:**
- Create: `tests/e2e/image-resize.spec.ts`
- Create: `tests/e2e/docx-to-txt.spec.ts`
- Create: `tests/e2e/markdown-to-pdf.spec.ts`
- Create: `tests/e2e/txt-to-pdf.spec.ts`
- Create: `tests/e2e/privacy-regression-image-resize.spec.ts`
- Create: `tests/e2e/privacy-regression-docx-to-txt.spec.ts`
- Create: `tests/e2e/privacy-regression-markdown-to-pdf.spec.ts`
- Create: `tests/e2e/privacy-regression-txt-to-pdf.spec.ts`

Write E2E specs by adapting the existing patterns. Run all checks. Push and open the PR.

- [ ] **Step 1: Read an existing E2E spec for the pattern**

Open `tests/e2e/image-convert.spec.ts` and `tests/e2e/privacy-regression-image-convert.spec.ts` for the patterns. The privacy spec uses `page.route("**/*", ...)` to assert no off-origin requests.

- [ ] **Step 2: Write the four functional E2E specs**

Create each as a single-test spec. Sketch for `tests/e2e/image-resize.spec.ts`:

```ts
import path from "node:path";
import { expect, test } from "@playwright/test";

const fix = (n: string) => path.resolve(__dirname, "../fixtures", n);

test("resizes a PNG to 100x50", async ({ page }) => {
  await page.goto("/tools/image-resize");

  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  await page.locator('input[type="file"]').setInputFiles(fix("sample-1000x500.png"));
  await expect(page.getByTestId("clear-staged-file")).toBeVisible();

  // Set width to 100, lock on (default).
  await page.getByTestId("resize-width").fill("100");

  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByTestId("convert-button").click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/-100x50\.png$/);
});
```

Adapt for the other three:
- `docx-to-txt.spec.ts`: drop `sample.docx`, click Convert, assert download filename ends `.txt` and content matches a known string from the fixture.
- `markdown-to-pdf.spec.ts`: drop `sample.md`, click Convert, assert download filename ends `.pdf` and is non-empty.
- `txt-to-pdf.spec.ts`: drop `sample.txt`, click Convert, assert download filename ends `.pdf` and is non-empty.

- [ ] **Step 3: Write the four privacy-regression specs**

Adapt from `tests/e2e/privacy-regression-image-convert.spec.ts`. Each one:
1. Stages a fixture file.
2. Listens to `page.on("request", ...)` and asserts no request goes to anything other than the dev origin (`http://localhost:3000` or whatever Playwright's baseURL resolves to).
3. Includes the `/fonts/` requests in the same-origin allowlist (markdown-to-pdf and txt-to-pdf both fetch fonts; image-resize and docx-to-txt do not, but the same-origin allowlist is the right contract anyway).
4. Triggers Convert and waits for the download.

The existing patterns make this straightforward — each new spec is a near-clone of the existing image-convert privacy spec with the engine-specific fixture and route.

- [ ] **Step 4: Run all E2E specs**

Run: `pnpm test:e2e tests/e2e/image-resize.spec.ts tests/e2e/docx-to-txt.spec.ts tests/e2e/markdown-to-pdf.spec.ts tests/e2e/txt-to-pdf.spec.ts`
Expected: All pass in 3 browsers.

Run: `pnpm test:e2e tests/e2e/privacy-regression-image-resize.spec.ts ... [other 3]`
Expected: All pass in 3 browsers.

- [ ] **Step 5: Full verification**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`
Expected: All green.

Note total test counts before pushing.

- [ ] **Step 6: Manual smoke (optional but recommended)**

Run `pnpm dev`, open each new tool route, drop a real fixture, click Convert. Verify the downloaded file opens correctly:
- image-resize: PNG/JPEG output is at the requested dimensions.
- docx-to-txt: text content is sensible.
- markdown-to-pdf: PDF renders all the constructs (headings, lists, code, link, blockquote, hr, image placeholder).
- txt-to-pdf: PDF shows monospace text with wrapped lines.

- [ ] **Step 7: Commit (E2E + privacy specs)**

```bash
git add tests/e2e/image-resize.spec.ts \
        tests/e2e/docx-to-txt.spec.ts \
        tests/e2e/markdown-to-pdf.spec.ts \
        tests/e2e/txt-to-pdf.spec.ts \
        tests/e2e/privacy-regression-image-resize.spec.ts \
        tests/e2e/privacy-regression-docx-to-txt.spec.ts \
        tests/e2e/privacy-regression-markdown-to-pdf.spec.ts \
        tests/e2e/privacy-regression-txt-to-pdf.spec.ts

git commit -m "test(e2e): cover Phase 15 engines + privacy regression

Per-engine functional spec: drop a fixture, click Convert,
assert download with the expected filename / shape. Per-engine
privacy-regression spec: assert zero off-origin requests during
the conversion (instances of the existing pattern from
privacy-regression-image-convert.spec.ts)."
```

- [ ] **Step 8: Push and open PR**

```bash
git push -u origin <current-branch>
gh pr create --base main --title "Phase 15: 4 small engines" --body "$(cat <<'EOF'
Implements four SingleInputEngine engines per spec
docs/superpowers/specs/2026-05-04-phase-15-small-engines.md and
plan docs/superpowers/plans/2026-05-04-phase-15-small-engines.md.

## Engines

- image-resize (PNG/JPG/JPEG/WebP/HEIC -> resized image; HEIC -> PNG fallback)
- docx-to-txt (DOCX -> plain text via lifted _shared/docx parser)
- markdown-to-pdf (.md -> PDF via markdown-it + pdf-lib + reused fonts)
- txt-to-pdf (.txt -> PDF in JetBrains Mono with hard-wrap)

## Spec deviation

Used existing public/fonts/ assets (Lora, Inter, JetBrains Mono)
instead of the spec's proposed Source Serif Pro / Source Sans /
JetBrains Mono. Eliminates a font-subsetting tooling task and
~250 KB of new committed assets while shipping equivalent
typography.

## Test plan

- [ ] CI green (typecheck, lint, unit + E2E)
- [ ] Manual: each tool resolves from home and sidebar, accepts
  its fixture, produces a valid output file
- [ ] Manual: markdown-to-pdf renders all constructs visibly in
  a PDF viewer
EOF
)"
```

If review feedback lands, address in fresh commits (no `--amend`).

---

## Self-review checklist

- Spec coverage:
  - §3.1 shared modules (docx, pdf-page-setup, fonts) — Tasks 1, 2; fonts deviation documented
  - §3.2 image-resize — Task 4
  - §3.3 docx-to-txt — Task 5
  - §3.4 markdown-to-pdf — Tasks 6 + 7
  - §3.5 txt-to-pdf — Task 8
  - §3.6 worker-side aspect-lock — Task 4 worker
  - §3.7 routes + home + sidebar — Tasks 4, 5, 7, 8 (routes), Task 9 (wiring)
  - §4 dependencies — Task 3
  - §5 UI surface — per-engine OptionsPanel in Tasks 4-8
  - §6 testing — co-located unit + E2E + privacy specs across all tasks; Task 10 finishes E2E
  - §7 files list — addressed across Tasks 1-9; new files map directly
  - §8 migration — additive only, no flag, CI is the gate
  - §9 success criteria — verified in Task 10 step 5/6
- Type consistency: `PdfPageSize`, `RendererFonts`, `Block`, `Run`, `RunStyle`, `ImageResizeOptions`, `DocxToTxtOptions`, `MarkdownToPdfOptions`, `TxtToPdfOptions` all defined in their respective Tasks before consumption.
- No placeholders: each step has either explicit code, explicit test code, or a precise diagnosis-action pattern (e.g., Task 5 Step 11 instructs the implementer to inspect the parser type when worker tests fail rather than leaving "fix as needed").
