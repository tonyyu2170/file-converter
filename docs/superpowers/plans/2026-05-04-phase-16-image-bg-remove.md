# Phase 16 — image-bg-remove engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `image-bg-remove`, a `SingleInputEngine` that runs an in-browser segmentation model (transformers.js + a permissively-licensed ONNX model, ~80 MB, served same-origin from `public/models/`) to produce either a transparent-background PNG or a flattened PNG/JPEG over a user-chosen solid color, per `docs/superpowers/specs/2026-05-04-image-bg-remove-engine-design.md`.

**Architecture:** Drop-in `SingleInputEngine` plus three pieces of new infrastructure that all future ML engines reuse: (1) a build-time script that copies model weights and ONNX Runtime Web `.wasm` files from `node_modules/` into `public/`, (2) two additive fields on `WorkerHarness` (`persistent` for keeping a worker alive across a batch and `onProgress` for piping multi-stage progress events from worker to UI), and (3) a progress-bar slot on `ToolFrame` rendered only when an engine emits progress events. `model-loader.ts` lives inside the engine until a second ML engine arrives — same lifting policy as `_shared/docx/`.

**Tech Stack:** TypeScript strict, React 19, Next.js 15 (static export), Vitest, Playwright, Comlink, `@huggingface/transformers` (Apache 2.0), `onnxruntime-web` (peer dep of transformers.js), one of {BiRefNet-lite (MIT), ISNet-DIS (Apache 2.0)} ONNX model — final selection in Task 1.

---

## Reference reading before starting

- Spec: `docs/superpowers/specs/2026-05-04-image-bg-remove-engine-design.md` (the source of truth — re-read before each task and when making any judgment call)
- Engine type definitions: `src/engines/_shared/types.ts`
- Engine registry: `src/engines/_shared/registry.ts`
- Worker harness: `src/engines/_shared/harness.ts` (extended in Task 2)
- ToolFrame: `src/components/tool-frame.tsx` (extended in Task 3)
- Sidebar: `src/components/layout/sidebar.tsx`
- Home page: `src/app/page.tsx`
- Closest existing engine for reference: `src/engines/image-convert/` (single-input, options panel, alpha-on-JPEG fill — bg-remove is structurally identical with extra steps)
- Existing route pattern: `src/app/tools/image-convert/page.tsx`
- Decode helper: `src/engines/_shared/decode-image.ts`
- Filename helper: `src/engines/_shared/filename.ts`
- Size limits: `src/engines/_shared/size-limits.ts` (Phase 14)
- Existing E2E patterns: `tests/e2e/image-convert.spec.ts`, `tests/e2e/privacy-regression-image-convert.spec.ts`
- Vercel config: `vercel.json` (CSP + new Cache-Control rule in Task 1)
- Transformers.js docs: <https://huggingface.co/docs/transformers.js> (canonical reference for `pipeline()`, `env`, and the `image-segmentation` task)

CLAUDE.md invariants apply:

- No `--no-verify`. No `--amend`. No Claude attribution in commit messages.
- Commit body lines ≤ 72 chars.
- Run `pnpm typecheck && pnpm lint && pnpm test` after each task before commit.
- Engines must not contain `fetch`/`XMLHttpRequest` — Biome lint enforces. The transformers.js `pipeline()` import inside `model-loader.ts` is fine because the call resolves to local URLs only (`env.allowRemoteModels = false`).
- Never run `--turbopack` — Next 15's Turbopack worker resolution is broken for our pattern.

---

## Privacy guarantee (must hold every commit)

Every task that touches conversion code must preserve the property that **zero off-origin requests fire during conversion**. Two backstops:

1. The existing `tests/e2e/privacy-regression-*.spec.ts` files. They must keep passing.
2. The new bg-remove privacy regression spec landed in Task 10. It asserts the same property *including the model download leg* — every URL must be same-origin.

If a task accidentally introduces an off-origin fetch (e.g., transformers.js falls back to its CDN because `allowRemoteModels` got toggled), Task 10's spec fails loudly. Don't disable it.

---

## Task 1: Build infrastructure (model selection + copy script + manifest + headers)

**Files:**
- Create: `scripts/copy-bg-models.mjs`
- Create: `scripts/bg-models-manifest.json`
- Create: `public/models/bg-remove/.gitkeep`
- Create: `public/onnx-wasm/.gitkeep`
- Modify: `package.json` (deps + scripts)
- Modify: `pnpm-lock.yaml` (regenerated)
- Modify: `.gitignore`
- Modify: `vercel.json` (Cache-Control rule)

This task ends with a `pnpm install` populating `public/models/bg-remove/` and `public/onnx-wasm/`, hash-verified against a manifest committed to the repo, and a Vercel header rule giving those paths year-long immutable caching.

- [ ] **Step 1: Install runtime deps**

```bash
pnpm add @huggingface/transformers
```

This pulls `onnxruntime-web` as a transitive dep. Verify by reading the new entry in `package.json` and confirming `onnxruntime-web` is present in `pnpm-lock.yaml` under `@huggingface/transformers`.

- [ ] **Step 2: Pick the model (the bake-off)**

The spec deferred this. Run a side-by-side fixture test. Two candidates:

| Model | License | Size (quantized ONNX) | HF repo |
|---|---|---|---|
| BiRefNet-lite | MIT | ~88 MB FP16, ~44 MB int8 | `ZhengPeng7/BiRefNet_lite` (and `onnx-community` mirrors) |
| ISNet-DIS | Apache 2.0 | ~170 MB FP32, ~45 MB int8 | `xenova/isnet` and `onnx-community` mirrors |

Procedure (do not skip — this decision is locked in by the manifest written in Step 4):

1. Acquire one of each model's quantized ONNX from HuggingFace (whatever distribution is currently available — `onnx-community` repos are the cleanest source). Save under `node_modules/.cache/bg-models/{birefnet,isnet}/`.
2. Run each against the three fixtures from Task 7 (`product-on-white.jpg`, `portrait-cluttered-bg.jpg`, `transparent-glass.jpg`) using a one-off `scripts/bake-off.mjs` you write inline. The script should call transformers.js `pipeline("image-segmentation", "<localPath>")` for each model, save the alpha-composited PNG output, and print elapsed inference time per fixture.
3. Open all six output PNGs side by side. Pick the model with cleaner edges on `portrait-cluttered-bg.jpg` (the load-bearing case) given comparable inference time on `product-on-white.jpg`.
4. Record the choice in the PR description with the side-by-side rationale and the chosen filenames.

If both are roughly equivalent on edge quality, prefer **BiRefNet-lite** (smaller, MIT). If BiRefNet-lite is dramatically worse on the portrait, choose **ISNet-DIS** despite its larger size.

Delete `scripts/bake-off.mjs` and the `node_modules/.cache/bg-models/<unchosen>` directory once the choice is made — they are not committed.

- [ ] **Step 3: Determine the chosen model's exact filename and SHA-256**

For the chosen model, identify the exact ONNX filename + any auxiliary JSON files (`config.json`, `preprocessor_config.json`) transformers.js expects. List them with their SHA-256:

```bash
cd node_modules/.cache/bg-models/<chosen>
shasum -a 256 *.onnx *.json
```

Record each in the manifest in Step 4. These hashes pin the bytes; any drift will fail the build.

- [ ] **Step 4: Write the manifest**

Create `scripts/bg-models-manifest.json`:

```json
{
  "model": "<birefnet|isnet>",
  "license": "<MIT|Apache-2.0>",
  "source": "<huggingface-repo-id-and-commit-sha>",
  "files": [
    { "name": "model_quantized.onnx", "sha256": "<hex>" },
    { "name": "config.json",          "sha256": "<hex>" }
  ],
  "wasm": [
    { "name": "ort-wasm-simd-threaded.wasm",     "sha256": "<hex>" },
    { "name": "ort-wasm-simd-threaded.jsep.wasm", "sha256": "<hex>" }
  ]
}
```

Replace placeholders with the exact values from Step 3 plus the ONNX Runtime Web `.wasm` filenames from `node_modules/onnxruntime-web/dist/` (run `ls node_modules/onnxruntime-web/dist/*.wasm` to see what's actually there). Commit the manifest.

- [ ] **Step 5: Write the copy script**

Create `scripts/copy-bg-models.mjs`:

```js
#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const manifest = JSON.parse(readFileSync(join(__dirname, "bg-models-manifest.json"), "utf8"));

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function ensureDir(d) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function copyAndVerify(src, dst, expectedSha) {
  if (!existsSync(src)) {
    console.error(`[copy-bg-models] missing source: ${src}`);
    process.exit(1);
  }
  copyFileSync(src, dst);
  const actual = sha256(dst);
  if (actual !== expectedSha) {
    console.error(`[copy-bg-models] sha256 mismatch for ${dst}\n  expected ${expectedSha}\n  actual   ${actual}`);
    process.exit(1);
  }
  console.log(`[copy-bg-models] ok ${dst}`);
}

// 1. Model files. Source: node_modules/.cache/bg-models/<model>/<file>
//    Destination: public/models/bg-remove/<file>
const modelSrcDir = join(repoRoot, "node_modules", ".cache", "bg-models", manifest.model);
const modelDstDir = join(repoRoot, "public", "models", "bg-remove");
ensureDir(modelDstDir);
for (const f of manifest.files) {
  copyAndVerify(join(modelSrcDir, f.name), join(modelDstDir, f.name), f.sha256);
}

// 2. ONNX Runtime Web wasm files. Source: node_modules/onnxruntime-web/dist/
//    Destination: public/onnx-wasm/
const wasmSrcDir = join(repoRoot, "node_modules", "onnxruntime-web", "dist");
const wasmDstDir = join(repoRoot, "public", "onnx-wasm");
ensureDir(wasmDstDir);
for (const f of manifest.wasm) {
  copyAndVerify(join(wasmSrcDir, f.name), join(wasmDstDir, f.name), f.sha256);
}

// 3. Write a marker file so model-loader can sanity-check at runtime.
writeFileSync(join(modelDstDir, "MANIFEST.json"), JSON.stringify(manifest, null, 2));
```

Note the script depends on `node_modules/.cache/bg-models/<model>/` being populated. Add a separate `scripts/fetch-bg-models.mjs` (Step 6) that downloads from HuggingFace by commit SHA when the cache is empty.

- [ ] **Step 6: Write the fetch script (cache populator)**

Create `scripts/fetch-bg-models.mjs`:

```js
#!/usr/bin/env node
// Populates node_modules/.cache/bg-models/<model>/ from HuggingFace.
// Skips when the cache already has all manifest files. Uses Node's fetch.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const manifest = JSON.parse(readFileSync(join(__dirname, "bg-models-manifest.json"), "utf8"));
const [hfRepo, hfCommit] = manifest.source.split("@");
if (!hfRepo || !hfCommit) {
  console.error("[fetch-bg-models] manifest.source must be 'owner/repo@commitSha'");
  process.exit(1);
}

const cacheDir = join(repoRoot, "node_modules", ".cache", "bg-models", manifest.model);
if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

const allPresent = manifest.files.every((f) => {
  const p = join(cacheDir, f.name);
  return existsSync(p) && sha256(readFileSync(p)) === f.sha256;
});
if (allPresent) {
  console.log(`[fetch-bg-models] cache hit for ${manifest.model}`);
  process.exit(0);
}

for (const f of manifest.files) {
  // Common HuggingFace ONNX path: <repo>/resolve/<commit>/onnx/<file>
  // Adjust the URL pattern to match the chosen model's repo layout.
  const url = `https://huggingface.co/${hfRepo}/resolve/${hfCommit}/onnx/${f.name}`;
  console.log(`[fetch-bg-models] downloading ${f.name} from ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[fetch-bg-models] http ${res.status} for ${url}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha256(buf) !== f.sha256) {
    console.error(`[fetch-bg-models] sha mismatch for ${f.name}; manifest may be stale`);
    process.exit(1);
  }
  writeFileSync(join(cacheDir, f.name), buf);
}
console.log(`[fetch-bg-models] done`);
```

If the chosen model's HuggingFace repo uses a different file layout (some are at root, some under `onnx/`), adjust the URL template accordingly — the manifest.source SHA pins the version regardless.

- [ ] **Step 7: Wire scripts into `package.json`**

Edit `package.json`:

```diff
   "scripts": {
     "dev": "next dev",
-    "build": "next build",
+    "build": "next build",
+    "prebuild": "node scripts/copy-bg-models.mjs",
+    "postinstall": "node scripts/fetch-bg-models.mjs && node scripts/copy-bg-models.mjs",
     "start": "next start",
     "lint": "biome check src tests",
```

`postinstall` ensures fresh checkouts populate `public/models/` after `pnpm install` so unit + correctness tests run without an explicit build. `prebuild` re-runs the copy as a defense-in-depth before `next build`.

- [ ] **Step 8: Update `.gitignore`**

Add to `.gitignore`:

```
# Build artifacts copied from node_modules
public/models/bg-remove/*
!public/models/bg-remove/.gitkeep
public/onnx-wasm/*
!public/onnx-wasm/.gitkeep
```

Create the `.gitkeep` files (touch them as committed empty files).

- [ ] **Step 9: Add Cache-Control header for model paths in `vercel.json`**

Edit `vercel.json` to add a second `headers` rule (the existing rule for `"source": "/(.*)"` stays in place). Append inside the existing `headers` array:

```diff
   "headers": [
     { "source": "/(.*)", "headers": [ ... existing ... ] },
+    {
+      "source": "/models/bg-remove/(.*)",
+      "headers": [
+        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
+      ]
+    },
+    {
+      "source": "/onnx-wasm/(.*)",
+      "headers": [
+        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
+      ]
+    }
   ]
```

- [ ] **Step 10: Verify the build pipeline end-to-end**

Run, in order:

```bash
rm -rf public/models/bg-remove/* public/onnx-wasm/*
pnpm install
ls public/models/bg-remove/   # expect manifest files + MANIFEST.json
ls public/onnx-wasm/          # expect ort-*.wasm files
pnpm build                    # should re-run prebuild copy without error
```

Expected: `public/models/bg-remove/` and `public/onnx-wasm/` are populated, build completes without errors, `out/models/bg-remove/` and `out/onnx-wasm/` exist after build (Next.js's static export copies `public/` to `out/`).

If any sha256 fails: the manifest is wrong (re-run Step 3) or the HuggingFace files moved (update `manifest.source` commit SHA).

- [ ] **Step 11: Commit**

```bash
git add scripts/copy-bg-models.mjs scripts/fetch-bg-models.mjs \
        scripts/bg-models-manifest.json \
        public/models/bg-remove/.gitkeep public/onnx-wasm/.gitkeep \
        package.json pnpm-lock.yaml \
        .gitignore vercel.json

git commit -m "build(bg-remove): copy onnx model + ort wasm into public/

Adds @huggingface/transformers, a build-time copy script, and a
hash-pinned manifest so the chosen segmentation model
(<model name>, <license>) ships from same-origin without
entering git history. postinstall populates the cache from
HuggingFace by commit SHA; prebuild copies into public/.
Vercel headers cap-cache /models/bg-remove and /onnx-wasm."
```

---

## Task 2: Extend `WorkerHarness` (additive `persistent` and `onProgress`)

**Files:**
- Modify: `src/engines/_shared/harness.ts`
- Modify: `src/engines/_shared/harness.test.ts` (or create if no existing harness test exists — check first with `ls src/engines/_shared/harness.test.*`)

The change is purely additive. Existing engines pass nothing → existing behavior unchanged.

- [ ] **Step 1: Verify the existing test file**

```bash
ls src/engines/_shared/harness.test.*
```

If a test file exists, read it to understand which behaviors are already covered. If it doesn't exist, create `src/engines/_shared/harness.test.ts` and add the existing-behavior baseline tests in Step 2 first (so backward-compatibility is measurable).

- [ ] **Step 2: Write the failing tests**

Add to `src/engines/_shared/harness.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { WorkerHarness } from "./harness";

// Existing behavior backstop — must keep passing.
describe("WorkerHarness (existing behavior)", () => {
  it("terminates the worker after each runSingle call by default", async () => {
    const terminate = vi.fn();
    const factory = () => ({ terminate, postMessage: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as Worker;
    // ... (See harness.test.ts existing patterns; if absent, write a minimal mock that
    // exposes a comlink-stub convertSingle returning a fake OutputItem.)
  });
});

describe("WorkerHarness persistent mode", () => {
  it("reuses one worker across multiple runSingle calls when persistent: true", async () => {
    let factoryCalls = 0;
    const factory = () => {
      factoryCalls += 1;
      // mock worker setup as above; convertSingle returns { filename, mime, blob }
      return /* mock */ {} as Worker;
    };
    const harness = new WorkerHarness<{}>(factory, { persistent: true });
    const ctrl = new AbortController();
    await harness.runSingle(new File([new Uint8Array(1)], "a.bin"), {}, ctrl.signal);
    await harness.runSingle(new File([new Uint8Array(1)], "b.bin"), {}, ctrl.signal);
    expect(factoryCalls).toBe(1);
  });

  it("dispose() terminates the persistent worker", async () => {
    const terminate = vi.fn();
    const factory = () => ({ terminate, /* ... */ }) as unknown as Worker;
    const harness = new WorkerHarness<{}>(factory, { persistent: true });
    // run once to spawn
    // ...
    harness.dispose();
    expect(terminate).toHaveBeenCalledOnce();
  });
});

describe("WorkerHarness onProgress callback", () => {
  it("forwards worker-emitted progress events to onProgress", async () => {
    // mock worker that, during convertSingle, posts two progress events
    // through a Comlink proxy callback.
    const onProgress = vi.fn();
    // ...
    expect(onProgress).toHaveBeenCalledWith({ kind: "model-loading", loaded: 10, total: 100 });
    expect(onProgress).toHaveBeenCalledWith({ kind: "inference", pct: 0 });
  });
});
```

The mock worker setup is intricate because Comlink wraps the worker and the test must simulate `convertSingle` calling a transferred progress callback. See `src/engines/_shared/harness.test.ts` (if present) for the existing mock pattern; if absent, the simplest route is to construct a real `Worker` from a tiny inline blob URL inside the test — but that runs into the dev-server's worker resolution. The recommended approach is to extract a thin internal seam (`spawn()` → `Comlink.Remote<WorkerEntry>`) that the test can mock directly. Add such a seam if it doesn't exist.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test src/engines/_shared/harness.test.ts`
Expected: FAIL — `persistent` and `onProgress` not implemented.

- [ ] **Step 4: Implement the harness extension**

Edit `src/engines/_shared/harness.ts`:

```ts
import * as Comlink from "comlink";
import type { OutputItem } from "./types";

export type ConversionProgress =
  | { kind: "model-loading"; loaded: number; total: number }
  | { kind: "inference"; pct: number };

export type WorkerEntry<TOptions> = {
  convertSingle?: (
    fileBytes: ArrayBuffer,
    fileName: string,
    fileType: string,
    opts: TOptions,
    // Optional Comlink-proxied progress callback. Workers that don't emit
    // progress simply never call it.
    onProgress?: (p: ConversionProgress) => void,
  ) => Promise<OutputItem | OutputItem[]>;
  convertMulti?: (
    files: Array<{ bytes: ArrayBuffer; name: string; type: string }>,
    opts: TOptions,
    onProgress?: (p: ConversionProgress) => void,
  ) => Promise<OutputItem | OutputItem[]>;
};

export type WorkerFactory = () => Worker;

export type WorkerHarnessOptions = {
  /** When true, the harness keeps the worker alive across runSingle/runMulti
   * calls. Caller is responsible for calling dispose() (typically from a
   * page-level useEffect cleanup). Off by default for backward compatibility. */
  persistent?: boolean;
};

export type RunSingleOptions = {
  onProgress?: (p: ConversionProgress) => void;
};

type SingleFn<TOptions> = (
  fileBytes: ArrayBuffer,
  fileName: string,
  fileType: string,
  opts: TOptions,
  onProgress?: (p: ConversionProgress) => void,
) => Promise<OutputItem | OutputItem[]>;

type MultiFn<TOptions> = (
  files: Array<{ bytes: ArrayBuffer; name: string; type: string }>,
  opts: TOptions,
  onProgress?: (p: ConversionProgress) => void,
) => Promise<OutputItem | OutputItem[]>;

export class WorkerHarness<TOptions> {
  private worker: Worker | null = null;
  private remote: Comlink.Remote<WorkerEntry<TOptions>> | null = null;

  constructor(
    private readonly factory: WorkerFactory,
    private readonly opts: WorkerHarnessOptions = {},
  ) {}

  async runSingle(
    file: File,
    opts: TOptions,
    signal: AbortSignal,
    runOpts: RunSingleOptions = {},
  ): Promise<OutputItem | OutputItem[]> {
    this.spawn();
    if (!this.remote?.convertSingle) {
      this.terminateIfEphemeral();
      throw new Error("worker does not implement convertSingle");
    }
    const convertSingle = this.remote.convertSingle as unknown as SingleFn<TOptions>;
    const buf = await file.arrayBuffer();
    if (signal.aborted) {
      this.terminateIfEphemeral();
      throw new DOMException("Aborted", "AbortError");
    }
    const abortPromise = new Promise<never>((_, reject) => {
      const onAbort = () => {
        this.terminateIfEphemeral();
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
    const proxiedOnProgress = runOpts.onProgress
      ? Comlink.proxy(runOpts.onProgress)
      : undefined;
    try {
      const result = await Promise.race([
        convertSingle(buf, file.name, file.type, opts, proxiedOnProgress),
        abortPromise,
      ]);
      return result;
    } finally {
      this.terminateIfEphemeral();
    }
  }

  async runMulti(
    files: File[],
    opts: TOptions,
    signal: AbortSignal,
    runOpts: RunSingleOptions = {},
  ): Promise<OutputItem | OutputItem[]> {
    this.spawn();
    if (!this.remote?.convertMulti) {
      this.terminateIfEphemeral();
      throw new Error("worker does not implement convertMulti");
    }
    const convertMulti = this.remote.convertMulti as unknown as MultiFn<TOptions>;
    const payload = await Promise.all(
      files.map(async (f) => ({ bytes: await f.arrayBuffer(), name: f.name, type: f.type })),
    );
    if (signal.aborted) {
      this.terminateIfEphemeral();
      throw new DOMException("Aborted", "AbortError");
    }
    const abortPromise = new Promise<never>((_, reject) => {
      const onAbort = () => {
        this.terminateIfEphemeral();
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
    const proxiedOnProgress = runOpts.onProgress
      ? Comlink.proxy(runOpts.onProgress)
      : undefined;
    try {
      const result = await Promise.race([
        convertMulti(payload, opts, proxiedOnProgress),
        abortPromise,
      ]);
      return result;
    } finally {
      this.terminateIfEphemeral();
    }
  }

  /** Force-terminate the persistent worker. No-op for ephemeral mode. */
  dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.remote = null;
    }
  }

  private spawn(): void {
    if (this.worker) return;
    this.worker = this.factory();
    this.remote = Comlink.wrap<WorkerEntry<TOptions>>(this.worker);
  }

  private terminateIfEphemeral(): void {
    if (this.opts.persistent) return;
    this.worker?.terminate();
    this.worker = null;
    this.remote = null;
  }
}
```

The key behavioral changes:

- Default-mode behavior unchanged: ephemeral worker terminated after each call.
- `persistent: true` → the worker is *not* terminated after each call. The `dispose()` method is the one way to terminate it.
- `runOpts.onProgress` is wrapped in `Comlink.proxy()` so the worker can call it across the boundary. Workers that ignore it run unchanged.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test src/engines/_shared/harness.test.ts`
Expected: PASS — both new behaviors and the existing-behavior backstop.

- [ ] **Step 6: Run full test suite (backward compat)**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS. Every existing engine's tests should still pass — the changes are additive.

If any existing engine test fails, the root cause is almost certainly that the new `RunSingleOptions` parameter changed an inferred type signature somewhere. Don't paper over with `as unknown as` — find the call site and explicitly pass `{}`.

- [ ] **Step 7: Commit**

```bash
git add src/engines/_shared/harness.ts src/engines/_shared/harness.test.ts

git commit -m "feat(harness): add persistent + onProgress to WorkerHarness

Both fields are additive and optional. persistent: true keeps the
worker alive across runSingle/runMulti calls so engines that pay
heavy cold-start costs (model loading, large WASM init) can amortise
across a batch; dispose() is the explicit teardown. onProgress is a
Comlink-proxied callback workers can invoke to emit
ConversionProgress events. Existing engines pass neither and keep
their existing per-call ephemeral behavior."
```

---

## Task 3: Add progress slot to `ToolFrame`

**Files:**
- Modify: `src/components/tool-frame.tsx`
- Modify: `src/components/tool-frame.test.tsx` (or create — check first)

ToolFrame renders a `<progress>` element below the existing status text *only when* the active engine has emitted at least one progress event during the current run. Engines that never emit pass no callback and the bar is never shown — backward-compatible.

- [ ] **Step 1: Write the failing test**

Add to `src/components/tool-frame.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ToolFrame } from "./tool-frame";
import type { ConversionEngine } from "@/engines/_shared/types";

function progressEngine(): ConversionEngine<{}, any> {
  let progressCb: ((p: any) => void) | undefined;
  return {
    id: "test-progress",
    cardinality: "single",
    inputAccept: [".bin"],
    inputMime: ["application/octet-stream"],
    outputMime: "application/octet-stream",
    defaultOptions: {},
    category: "image",
    validate: () => ({ ok: true }),
    convert: async (_file, _opts, _signal, runOpts: any) => {
      progressCb = runOpts?.onProgress;
      progressCb?.({ kind: "model-loading", loaded: 10, total: 100 });
      progressCb?.({ kind: "model-loading", loaded: 100, total: 100 });
      progressCb?.({ kind: "inference", pct: 0 });
      return { filename: "out.bin", mime: "application/octet-stream", blob: new Blob([new Uint8Array(1)]) };
    },
  } as unknown as ConversionEngine<{}, any>;
}

describe("ToolFrame progress slot", () => {
  it("renders a progress bar when an engine emits progress events", async () => {
    render(<ToolFrame engine={progressEngine()} />);
    // simulate a drop + click convert
    // ... (mirror the existing image-convert.test pattern for tool-frame.test.tsx)
    expect(await screen.findByTestId("conversion-progress")).toBeInTheDocument();
  });

  it("does NOT render a progress bar for an engine that never emits", () => {
    const silent = {
      ...progressEngine(),
      convert: async () => ({ filename: "out.bin", mime: "application/octet-stream", blob: new Blob([new Uint8Array(1)]) }),
    };
    render(<ToolFrame engine={silent as any} />);
    expect(screen.queryByTestId("conversion-progress")).toBeNull();
  });
});
```

The crucial bit: the engine's `convert` must accept a fourth `runOpts` parameter so it can receive `onProgress` from ToolFrame. This requires the engine signature to change too — see Step 2.

- [ ] **Step 2: Extend the engine `convert` signature**

This is the *one* shared-types deviation, called out in the spec. Edit `src/engines/_shared/types.ts`:

```diff
 export type SingleInputEngine<
   TOptions,
   TOutput extends OutputItem | OutputItem[],
 > = EngineMeta<TOptions> & {
   cardinality: "single";
   validate(file: File, opts: TOptions): ValidationResult;
-  convert(file: File, opts: TOptions, signal: AbortSignal): Promise<TOutput>;
+  convert(
+    file: File,
+    opts: TOptions,
+    signal: AbortSignal,
+    runOpts?: { onProgress?: (p: ConversionProgress) => void },
+  ): Promise<TOutput>;
   ...
 };

 export type MultiInputEngine<...> = EngineMeta<TOptions> & {
   cardinality: "multi";
   validate(files: File[], opts: TOptions): ValidationResult;
-  convert(files: File[], opts: TOptions, signal: AbortSignal): Promise<TOutput>;
+  convert(
+    files: File[],
+    opts: TOptions,
+    signal: AbortSignal,
+    runOpts?: { onProgress?: (p: ConversionProgress) => void },
+  ): Promise<TOutput>;
   ...
 };
```

Add the import at the top of `types.ts`:

```ts
import type { ConversionProgress } from "./harness";
```

`runOpts` is optional, so existing engines that ignore it compile unchanged.

- [ ] **Step 3: Modify ToolFrame to render the progress slot**

Edit `src/components/tool-frame.tsx`:

```diff
+ import type { ConversionProgress } from "@/engines/_shared/harness";
  ...

 export function ToolFrame<TOptions>({ engine }: Props<TOptions>) {
   const [status, setStatus] = useState<Status>("ready");
   const [items, setItems] = useState<OutputItem[]>([]);
   const [errorMessage, setErrorMessage] = useState<string | null>(null);
   const [options, setOptions] = useState<TOptions>(engine.defaultOptions);
   const [stagedFiles, setStagedFiles] = useState<File[]>([]);
+  const [progress, setProgress] = useState<ConversionProgress | null>(null);
   const [convertedInputBytes, setConvertedInputBytes] = useState<number | null>(null);
   ...
   const run = useCallback(
     async (files: File[], opts: TOptions) => {
       setErrorMessage(null);
       setItems([]);
+      setProgress(null);
       const inputBytesAtStart = files.reduce((sum, f) => sum + f.size, 0);
       setConvertedInputBytes(inputBytesAtStart);
       if (engine.cardinality === "single") {
         ...
         setStatus("converting");
         try {
           const ctrl = new AbortController();
-          const result = await engine.convert(f, opts, ctrl.signal);
+          const result = await engine.convert(f, opts, ctrl.signal, {
+            onProgress: setProgress,
+          });
           const out = Array.isArray(result) ? result : [result];
           setItems(out);
           setStatus("done");
+          setProgress(null);
         } catch (err) {
           setErrorMessage(err instanceof Error ? err.message : String(err));
           setStatus("error");
+          setProgress(null);
         }
         return;
       }
       ...
       try {
         const ctrl = new AbortController();
-        const result = await engine.convert(files, opts, ctrl.signal);
+        const result = await engine.convert(files, opts, ctrl.signal, {
+          onProgress: setProgress,
+        });
         setItems(Array.isArray(result) ? result : [result]);
         setStatus("done");
+        setProgress(null);
       } catch (err) {
         ...
+        setProgress(null);
       }
     },
     [engine],
   );
```

Add the rendering, inside `<main>` after the existing status header:

```tsx
{progress && (
  <div
    data-testid="conversion-progress"
    className="mb-3 flex items-center gap-3 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-muted)]"
  >
    {progress.kind === "model-loading" ? (
      <>
        <progress
          value={progress.loaded}
          max={progress.total}
          className="h-1 w-48 appearance-none [&::-webkit-progress-bar]:bg-[var(--color-bg)] [&::-webkit-progress-value]:bg-[var(--color-accent)]"
        />
        <span className="tabular-nums text-[var(--color-fg-strong)]">
          loading model — {(progress.loaded / 1_000_000).toFixed(1)} MB /{" "}
          {(progress.total / 1_000_000).toFixed(1)} MB
        </span>
      </>
    ) : (
      <span className="tabular-nums text-[var(--color-fg-strong)]">
        inferring — {progress.pct >= 100 ? "finishing" : "running"}
      </span>
    )}
  </div>
)}
```

(For the inference-elapsed-seconds counter, add a `useEffect` that increments a `secondsElapsed` state every 1 s while `progress?.kind === "inference"` and `pct < 100`, then displays it. This is straightforward but adds ~10 lines; the spec marks it as "best-effort" so a `running…` placeholder is acceptable for this pass.)

- [ ] **Step 4: Run tests**

```bash
pnpm test src/components/tool-frame.test.tsx
pnpm typecheck && pnpm lint && pnpm test
```

Expected: progress-slot tests pass; every existing engine and every ToolFrame test still passes.

- [ ] **Step 5: Commit**

```bash
git add src/components/tool-frame.tsx src/components/tool-frame.test.tsx \
        src/engines/_shared/types.ts

git commit -m "feat(tool-frame): conditional progress bar slot

Adds an optional 4th 'runOpts' parameter to ConversionEngine.convert
and threads its onProgress callback into ToolFrame, which renders a
determinate <progress> bar for model-loading events and a status
line for inference events. Engines that never emit progress
(every existing engine) pass nothing through and ToolFrame renders
no bar — backward-compatible."
```

---

## Task 4: Implement `model-loader.ts`

**Files:**
- Create: `src/engines/image-bg-remove/model-loader.ts`
- Create: `src/engines/image-bg-remove/model-loader.test.ts`

The single source of truth for transformers.js configuration and the segmentation pipeline. Lives inside the engine until a second ML engine arrives (then lifted to `_shared/transformers/`).

- [ ] **Step 1: Write the failing test**

Create `src/engines/image-bg-remove/model-loader.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@huggingface/transformers", () => {
  const env = {
    allowRemoteModels: true,
    allowLocalModels: false,
    localModelPath: "",
    backends: { onnx: { wasm: { wasmPaths: "" } } },
  };
  const pipeline = vi.fn();
  return { env, pipeline };
});

import { env, pipeline } from "@huggingface/transformers";
import { __resetForTests, getBgRemovalPipeline } from "./model-loader";

afterEach(() => {
  __resetForTests();
  vi.clearAllMocks();
});

describe("model-loader env", () => {
  it("disables remote models and points local path at /models/", async () => {
    expect(env.allowRemoteModels).toBe(false);
    expect(env.allowLocalModels).toBe(true);
    expect(env.localModelPath).toBe("/models/");
    expect(env.backends.onnx.wasm.wasmPaths).toBe("/onnx-wasm/");
  });
});

describe("getBgRemovalPipeline", () => {
  it("memoizes the pipeline across calls", async () => {
    (pipeline as ReturnType<typeof vi.fn>).mockResolvedValue("PIPE");
    const a = await getBgRemovalPipeline(() => {});
    const b = await getBgRemovalPipeline(() => {});
    expect(a).toBe(b);
    expect(pipeline).toHaveBeenCalledTimes(1);
  });

  it("resets the cached promise after a failure so the next call retries", async () => {
    (pipeline as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("net"))
      .mockResolvedValueOnce("PIPE");
    await expect(getBgRemovalPipeline(() => {})).rejects.toThrow("net");
    const second = await getBgRemovalPipeline(() => {});
    expect(second).toBe("PIPE");
    expect(pipeline).toHaveBeenCalledTimes(2);
  });

  it("translates transformers.js progress events to LoaderProgress", async () => {
    (pipeline as ReturnType<typeof vi.fn>).mockImplementation(async (_task, _model, opts) => {
      opts.progress_callback({ status: "progress", loaded: 25, total: 100 });
      opts.progress_callback({ status: "ready" });
      return "PIPE";
    });
    const events: unknown[] = [];
    await getBgRemovalPipeline((p) => events.push(p));
    expect(events).toEqual([
      { kind: "model-loading", loaded: 25, total: 100 },
      { kind: "ready" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/engines/image-bg-remove/model-loader.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `model-loader.ts`**

Create `src/engines/image-bg-remove/model-loader.ts`:

```ts
import { env, pipeline, type ImageSegmentationPipeline } from "@huggingface/transformers";

// Side-effecting at module load — runs exactly once per worker context.
// These are the privacy-load-bearing settings: any deviation makes
// transformers.js attempt off-origin fetches.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = "/models/";
env.backends.onnx.wasm.wasmPaths = "/onnx-wasm/";

const MODEL_ID = "bg-remove";   // resolves to /models/bg-remove/

export type LoaderProgress =
  | { kind: "model-loading"; loaded: number; total: number }
  | { kind: "ready" };

let pipelinePromise: Promise<ImageSegmentationPipeline> | null = null;

export function getBgRemovalPipeline(
  onProgress: (p: LoaderProgress) => void,
): Promise<ImageSegmentationPipeline> {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = pipeline("image-segmentation", MODEL_ID, {
    device: typeof navigator !== "undefined" && "gpu" in navigator ? "webgpu" : "wasm",
    progress_callback: (p: { status: string; loaded?: number; total?: number }) => {
      if (p.status === "progress" && typeof p.loaded === "number" && typeof p.total === "number") {
        onProgress({ kind: "model-loading", loaded: p.loaded, total: p.total });
      } else if (p.status === "ready") {
        onProgress({ kind: "ready" });
      }
    },
  }).catch((err) => {
    pipelinePromise = null;
    throw err;
  });
  return pipelinePromise;
}

/** Test-only: clear the memoized pipeline. Do NOT export from index.ts. */
export function __resetForTests(): void {
  pipelinePromise = null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/engines/image-bg-remove/model-loader.test.ts`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/engines/image-bg-remove/model-loader.ts \
        src/engines/image-bg-remove/model-loader.test.ts

git commit -m "feat(bg-remove): model-loader with same-origin policy

Single transformers.js pipeline factory for the bg-remove engine.
Sets env.allowRemoteModels=false at module scope (the hard
privacy guarantee — no off-origin fetch is possible from the
library) and points env.localModelPath at /models/. Memoizes
the pipeline; resets the memo on failure so the next call
retries. Translates transformers.js progress callbacks into
LoaderProgress events for downstream UI."
```

---

## Task 5: Engine module — options, panel, worker, index, tests

**Files:**
- Create: `src/engines/image-bg-remove/options.ts`
- Create: `src/engines/image-bg-remove/options-panel.tsx`
- Create: `src/engines/image-bg-remove/worker.ts`
- Create: `src/engines/image-bg-remove/index.ts`
- Create: `src/engines/image-bg-remove/index.test.ts`
- Create: `src/engines/image-bg-remove/options-panel.test.tsx`
- Modify: `src/engines/_shared/registry.ts` (+1 EngineId, +1 loader)

- [ ] **Step 1: Write `options.ts`**

```ts
export type ImageBgRemoveBgMode = "transparent" | "solid";
export type ImageBgRemoveOutputFormat = "png" | "jpeg";

export type ImageBgRemoveOptions = {
  bgMode: ImageBgRemoveBgMode;
  bgColor: string;        // #RRGGBB; ignored when bgMode === "transparent"
  outputFormat: ImageBgRemoveOutputFormat;
  jpegQuality: number;    // 0.1..1.0; ignored when outputFormat === "png"
};

export const defaultImageBgRemoveOptions: ImageBgRemoveOptions = {
  bgMode: "transparent",
  bgColor: "#ffffff",
  outputFormat: "png",
  jpegQuality: 0.92,
};

export const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Cross-rule clamping. transparent + jpeg is invalid (JPEG has no alpha);
 * jpeg + transparent-preset is invalid for the same reason. The panel
 * calls this on every onChange so callers see a valid state. */
export function clampOptions(next: ImageBgRemoveOptions): ImageBgRemoveOptions {
  if (next.bgMode === "transparent") return { ...next, outputFormat: "png" };
  return next;
}
```

- [ ] **Step 2: Write `options.test.ts` and run**

Create `src/engines/image-bg-remove/options.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clampOptions, defaultImageBgRemoveOptions, HEX_PATTERN } from "./options";

describe("clampOptions", () => {
  it("forces outputFormat to png when bgMode is transparent", () => {
    const r = clampOptions({ bgMode: "transparent", bgColor: "#ffffff", outputFormat: "jpeg", jpegQuality: 0.9 });
    expect(r.outputFormat).toBe("png");
  });
  it("leaves solid + jpeg alone", () => {
    const inp = { bgMode: "solid", bgColor: "#000000", outputFormat: "jpeg", jpegQuality: 0.8 } as const;
    expect(clampOptions(inp)).toEqual(inp);
  });
});

describe("defaults", () => {
  it("starts on transparent + png", () => {
    expect(defaultImageBgRemoveOptions.bgMode).toBe("transparent");
    expect(defaultImageBgRemoveOptions.outputFormat).toBe("png");
  });
});

describe("HEX_PATTERN", () => {
  it.each(["#ffffff", "#000000", "#A3F1c9"])("accepts %s", (s) => {
    expect(HEX_PATTERN.test(s)).toBe(true);
  });
  it.each(["fff", "#fff", "#xyzxyz", "#1234567"])("rejects %s", (s) => {
    expect(HEX_PATTERN.test(s)).toBe(false);
  });
});
```

Run: `pnpm test src/engines/image-bg-remove/options.test.ts`
Expected: PASS.

- [ ] **Step 3: Write `options-panel.tsx`**

Create `src/engines/image-bg-remove/options-panel.tsx`:

```tsx
"use client";

import type { OptionsPanelProps } from "@/engines/_shared/types";
import { useState } from "react";
import { clampOptions, HEX_PATTERN, type ImageBgRemoveOptions } from "./options";

const PRESETS: Array<{ key: "white" | "black" | "transparent"; color: string; isTransparent?: boolean }> = [
  { key: "white", color: "#ffffff" },
  { key: "black", color: "#000000" },
  { key: "transparent", color: "transparent", isTransparent: true },
];

export function ImageBgRemoveOptionsPanel({
  value,
  onChange,
}: OptionsPanelProps<ImageBgRemoveOptions>) {
  const [hexDraft, setHexDraft] = useState(value.bgColor);

  const update = (next: ImageBgRemoveOptions) => onChange(clampOptions(next));
  const showQuality = value.outputFormat === "jpeg";

  return (
    <div
      data-testid="image-bg-remove-options"
      className="mb-3 flex flex-wrap items-center gap-4 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      {/* BG mode segmented */}
      <span className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        bg:
        <span className="inline-flex border border-[var(--color-hairline)]">
          {(["transparent", "solid"] as const).map((m, i) => (
            <button
              key={m}
              type="button"
              data-testid={`bg-mode-${m}`}
              onClick={() => update({ ...value, bgMode: m })}
              className={`px-2 py-1 uppercase tracking-[0.1em] ${
                value.bgMode === m
                  ? "bg-[var(--color-fg-strong)] text-[var(--color-bg)]"
                  : "text-[var(--color-fg-muted)]"
              } ${i > 0 ? "border-l border-[var(--color-hairline)]" : ""}`}
            >
              {m}
            </button>
          ))}
        </span>
      </span>

      {/* Presets */}
      <span className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        presets:
        <span className="inline-flex gap-1">
          {PRESETS.map((p) => {
            const disabled = p.isTransparent && value.outputFormat === "jpeg";
            return (
              <button
                key={p.key}
                type="button"
                aria-label={p.key}
                data-testid={`preset-${p.key}`}
                disabled={disabled}
                onClick={() => {
                  if (p.isTransparent) update({ ...value, bgMode: "transparent" });
                  else update({ ...value, bgMode: "solid", bgColor: p.color });
                }}
                className="h-[22px] w-[22px] border border-[var(--color-hairline)] disabled:opacity-30"
                style={
                  p.isTransparent
                    ? {
                        backgroundImage:
                          "repeating-conic-gradient(#777 0 25%, #bbb 0 50%)",
                        backgroundSize: "8px 8px",
                      }
                    : { background: p.color }
                }
              />
            );
          })}
        </span>
      </span>

      {/* Custom color */}
      <span className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        custom:
        <input
          type="color"
          data-testid="custom-color"
          value={value.bgColor}
          onChange={(e) => {
            setHexDraft(e.target.value);
            update({ ...value, bgMode: "solid", bgColor: e.target.value });
          }}
        />
        <input
          type="text"
          data-testid="custom-hex"
          value={hexDraft}
          onChange={(e) => setHexDraft(e.target.value)}
          onBlur={() => {
            if (HEX_PATTERN.test(hexDraft)) {
              update({ ...value, bgMode: "solid", bgColor: hexDraft });
            } else {
              setHexDraft(value.bgColor);
            }
          }}
          className="w-20 border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase"
        />
      </span>

      {/* Output format */}
      <span className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        out:
        <span className="inline-flex border border-[var(--color-hairline)]">
          {(["png", "jpeg"] as const).map((f, i) => (
            <button
              key={f}
              type="button"
              data-testid={`output-${f}`}
              onClick={() => update({ ...value, outputFormat: f })}
              className={`px-2 py-1 uppercase tracking-[0.1em] ${
                value.outputFormat === f
                  ? "bg-[var(--color-fg-strong)] text-[var(--color-bg)]"
                  : "text-[var(--color-fg-muted)]"
              } ${i > 0 ? "border-l border-[var(--color-hairline)]" : ""}`}
            >
              {f}
            </button>
          ))}
        </span>
      </span>

      {/* Quality slider, JPEG only */}
      {showQuality && (
        <span className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
          quality:
          <input
            type="range"
            data-testid="quality-slider"
            min={0.1}
            max={1}
            step={0.05}
            value={value.jpegQuality}
            onChange={(e) =>
              update({ ...value, jpegQuality: Number.parseFloat(e.target.value) })
            }
            className="w-32"
          />
          <span data-testid="quality-value" className="tabular-nums text-[var(--color-fg-strong)]">
            {value.jpegQuality.toFixed(2)}
          </span>
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write `options-panel.test.tsx`**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultImageBgRemoveOptions } from "./options";
import { ImageBgRemoveOptionsPanel } from "./options-panel";

function renderPanel(initial = defaultImageBgRemoveOptions) {
  const onChange = vi.fn();
  let value = initial;
  const rerender = (next: typeof initial) => {
    value = next;
  };
  const utils = render(<ImageBgRemoveOptionsPanel value={value} onChange={(n) => { onChange(n); rerender(n); }} />);
  return { ...utils, onChange, getValue: () => value };
}

describe("ImageBgRemoveOptionsPanel", () => {
  it("renders with default state — quality slider hidden, transparent active", () => {
    renderPanel();
    expect(screen.queryByTestId("quality-slider")).toBeNull();
    expect(screen.getByTestId("bg-mode-transparent")).toHaveClass(/bg-/);
  });

  it("clicking 'solid' switches mode without changing color", () => {
    const { onChange } = renderPanel();
    fireEvent.click(screen.getByTestId("bg-mode-solid"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ bgMode: "solid", bgColor: "#ffffff" }));
  });

  it("white preset sets bgMode=solid + bgColor=#ffffff", () => {
    const { onChange } = renderPanel();
    fireEvent.click(screen.getByTestId("preset-white"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ bgMode: "solid", bgColor: "#ffffff" }));
  });

  it("transparent preset is disabled when outputFormat=jpeg", () => {
    renderPanel({ ...defaultImageBgRemoveOptions, bgMode: "solid", outputFormat: "jpeg" });
    expect(screen.getByTestId("preset-transparent")).toBeDisabled();
  });

  it("quality slider appears only when outputFormat=jpeg", () => {
    renderPanel({ ...defaultImageBgRemoveOptions, bgMode: "solid", outputFormat: "jpeg" });
    expect(screen.getByTestId("quality-slider")).toBeInTheDocument();
  });

  it("hex text input reverts on invalid blur", () => {
    const { onChange } = renderPanel({ ...defaultImageBgRemoveOptions, bgMode: "solid" });
    const hex = screen.getByTestId("custom-hex");
    fireEvent.change(hex, { target: { value: "garbage" } });
    fireEvent.blur(hex);
    // onChange should NOT have been called with the bad value
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ bgColor: "garbage" }));
  });

  it("clicking PNG when in solid+jpeg switches output without losing color", () => {
    const { onChange } = renderPanel({ ...defaultImageBgRemoveOptions, bgMode: "solid", bgColor: "#abcdef", outputFormat: "jpeg" });
    fireEvent.click(screen.getByTestId("output-png"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ outputFormat: "png", bgColor: "#abcdef" }));
  });
});
```

Run: `pnpm test src/engines/image-bg-remove/options-panel.test.tsx`
Expected: all tests pass.

- [ ] **Step 5: Write `worker.ts`**

Create `src/engines/image-bg-remove/worker.ts`:

```ts
import * as Comlink from "comlink";
import type { ConversionProgress } from "@/engines/_shared/harness";
import type { OutputItem } from "@/engines/_shared/types";
import { getBgRemovalPipeline } from "./model-loader";
import type { ImageBgRemoveOptions } from "./options";

function replaceExtAddSuffix(name: string, suffix: string, ext: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}${suffix}.${ext}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [255, 255, 255];
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

const api = {
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    type: string,
    opts: ImageBgRemoveOptions,
    onProgress?: (p: ConversionProgress) => void,
  ): Promise<OutputItem> {
    // Phase 1: load model (cached after first call)
    const pipe = await getBgRemovalPipeline((p) => {
      if (p.kind === "model-loading") {
        onProgress?.({ kind: "model-loading", loaded: p.loaded, total: p.total });
      }
    });

    // Phase 2: decode
    const bitmap = await createImageBitmap(new Blob([bytes], { type }), {
      imageOrientation: "from-image",
    });

    onProgress?.({ kind: "inference", pct: 0 });

    try {
      // Pixel cap (spec §11.1)
      const pixelCap = 24_000_000;
      if (bitmap.width * bitmap.height > pixelCap) {
        const mp = ((bitmap.width * bitmap.height) / 1_000_000).toFixed(1);
        throw new Error(
          `Image too large to process (${mp} MP). Resize below 24 MP first.`,
        );
      }

      // Phase 3: inference. transformers.js accepts an ImageData / canvas / URL.
      const inCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const inCtx = inCanvas.getContext("2d");
      if (!inCtx) throw new Error("OffscreenCanvas 2D context unavailable");
      inCtx.drawImage(bitmap, 0, 0);
      const inputImageData = inCtx.getImageData(0, 0, bitmap.width, bitmap.height);

      // pipeline returns Array<{ label, mask: { data: Uint8Array, width, height } }>
      const result = (await pipe(inputImageData)) as Array<{
        label: string;
        mask: { data: Uint8Array; width: number; height: number };
      }>;
      const fg = result.find((r) => r.label.toLowerCase().includes("subject")) ?? result[0];
      if (!fg) throw new Error("Model returned no segmentation result");

      // Phase 4: composite
      const outCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const outCtx = outCanvas.getContext("2d");
      if (!outCtx) throw new Error("OffscreenCanvas 2D context unavailable");

      // Upscale mask if smaller than input
      const maskCanvas = new OffscreenCanvas(fg.mask.width, fg.mask.height);
      const maskCtx = maskCanvas.getContext("2d");
      if (!maskCtx) throw new Error("OffscreenCanvas 2D context unavailable");
      const maskImageData = maskCtx.createImageData(fg.mask.width, fg.mask.height);
      for (let i = 0; i < fg.mask.data.length; i++) {
        maskImageData.data[i * 4 + 0] = 255;
        maskImageData.data[i * 4 + 1] = 255;
        maskImageData.data[i * 4 + 2] = 255;
        maskImageData.data[i * 4 + 3] = fg.mask.data[i] ?? 0;
      }
      maskCtx.putImageData(maskImageData, 0, 0);

      if (opts.bgMode === "transparent") {
        // 4-channel output: input pixels with alpha from upscaled mask.
        outCtx.imageSmoothingQuality = "high";
        outCtx.drawImage(bitmap, 0, 0);
        // Apply mask via destination-in
        outCtx.globalCompositeOperation = "destination-in";
        outCtx.drawImage(maskCanvas, 0, 0, bitmap.width, bitmap.height);
        outCtx.globalCompositeOperation = "source-over";
      } else {
        // Solid: pre-fill, then draw input multiplied by mask on top.
        const [r, g, b] = hexToRgb(opts.bgColor);
        outCtx.fillStyle = `rgb(${r},${g},${b})`;
        outCtx.fillRect(0, 0, bitmap.width, bitmap.height);
        // Subject layer on a temporary canvas, then composited over the bg.
        const subjCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const subjCtx = subjCanvas.getContext("2d");
        if (!subjCtx) throw new Error("OffscreenCanvas 2D context unavailable");
        subjCtx.imageSmoothingQuality = "high";
        subjCtx.drawImage(bitmap, 0, 0);
        subjCtx.globalCompositeOperation = "destination-in";
        subjCtx.drawImage(maskCanvas, 0, 0, bitmap.width, bitmap.height);
        outCtx.drawImage(subjCanvas, 0, 0);
      }

      onProgress?.({ kind: "inference", pct: 100 });

      // Phase 5: encode
      const isPng = opts.outputFormat === "png";
      const blob = isPng
        ? await outCanvas.convertToBlob({ type: "image/png" })
        : await outCanvas.convertToBlob({ type: "image/jpeg", quality: opts.jpegQuality });

      return {
        filename: replaceExtAddSuffix(name, "-nobg", isPng ? "png" : "jpg"),
        mime: isPng ? "image/png" : "image/jpeg",
        blob,
      };
    } finally {
      bitmap.close();
    }
  },
};

Comlink.expose(api);
```

- [ ] **Step 6: Write `index.ts`**

```ts
import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { defaultImageBgRemoveOptions, type ImageBgRemoveOptions } from "./options";
import { ImageBgRemoveOptionsPanel } from "./options-panel";

const SUPPORTED_INPUT_MIMES = ["image/png", "image/jpeg", "image/webp"];

// Spec §11.1 — bg-remove-specific 25 MB per-file cap. Tighter than the
// image-category 250 MB hard cap because inference time scales with pixel
// count and a 25 MB JPEG is already a ~25 MP image (close to the §11.1
// pixel cap of 24 MP). This is enforced at validate-time so we never spin
// up the model on a file we'd reject at inference.
const MAX_FILE_BYTES = 25 * 1_000_000;

// Spec §11 — WebAssembly SIMD is required by onnxruntime-web's threaded build.
// Probe once at module load; cache the result. Re-probing is cheap but pointless.
const SIMD_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60,
  0x00, 0x01, 0x7b, 0x03, 0x02, 0x01, 0x00, 0x0a, 0x0a, 0x01, 0x08, 0x00,
  0x41, 0x00, 0xfd, 0x0f, 0xfd, 0x62, 0x0b,
]);
const SIMD_OK =
  typeof WebAssembly !== "undefined" && WebAssembly.validate(SIMD_PROBE);

// Module-scoped persistent harness so the model loads once across a batch.
// Disposed by the route page's useEffect cleanup.
let harness: WorkerHarness<ImageBgRemoveOptions> | null = null;
function getHarness(): WorkerHarness<ImageBgRemoveOptions> {
  if (!harness) {
    harness = new WorkerHarness<ImageBgRemoveOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
      { persistent: true },
    );
  }
  return harness;
}

export function disposeBgRemoveHarness(): void {
  harness?.dispose();
  harness = null;
}

const engine: SingleInputEngine<ImageBgRemoveOptions, OutputItem> = {
  id: "image-bg-remove",
  inputAccept: [".png", ".jpg", ".jpeg", ".webp"],
  inputMime: SUPPORTED_INPUT_MIMES,
  outputMime: "image/png",
  defaultOptions: defaultImageBgRemoveOptions,
  category: "image",
  cardinality: "single",
  OptionsPanel: ImageBgRemoveOptionsPanel,
  validate(file) {
    if (!SIMD_OK) {
      return {
        ok: false,
        reason: "Browser too old — bg-remove needs WebAssembly SIMD",
      };
    }
    if (file.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        reason: `File too large for bg-remove (limit 25 MB; got ${(file.size / 1_000_000).toFixed(1)} MB).`,
      };
    }
    if (SUPPORTED_INPUT_MIMES.includes(file.type)) return { ok: true };
    if (/\.(png|jpe?g|webp)$/i.test(file.name)) return { ok: true };
    return { ok: false, reason: "Expected a PNG, JPEG, or WebP file" };
  },
  async convert(file, opts, signal, runOpts) {
    const result = await getHarness().runSingle(file, opts, signal, {
      onProgress: runOpts?.onProgress,
    });
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

- [ ] **Step 7: Write `index.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import engine from "./index";

describe("image-bg-remove engine metadata", () => {
  it("declares correct id, cardinality, category", () => {
    expect(engine.id).toBe("image-bg-remove");
    expect(engine.cardinality).toBe("single");
    expect(engine.category).toBe("image");
    expect(engine.outputMime).toBe("image/png");
  });

  it("inputAccept covers png/jpg/jpeg/webp", () => {
    expect(engine.inputAccept).toEqual([".png", ".jpg", ".jpeg", ".webp"]);
  });

  it("validate accepts supported MIMEs", () => {
    expect(engine.validate(new File([new Uint8Array(1)], "a.png", { type: "image/png" }), engine.defaultOptions))
      .toEqual({ ok: true });
    expect(engine.validate(new File([new Uint8Array(1)], "a.jpg", { type: "image/jpeg" }), engine.defaultOptions))
      .toEqual({ ok: true });
    expect(engine.validate(new File([new Uint8Array(1)], "a.webp", { type: "image/webp" }), engine.defaultOptions))
      .toEqual({ ok: true });
  });

  it("validate accepts extension-only fallback", () => {
    expect(engine.validate(new File([new Uint8Array(1)], "a.png", { type: "" }), engine.defaultOptions))
      .toEqual({ ok: true });
  });

  it("validate rejects unsupported types", () => {
    const v = engine.validate(new File([new Uint8Array(1)], "a.gif", { type: "image/gif" }), engine.defaultOptions);
    expect(v.ok).toBe(false);
  });

  it("validate rejects files larger than 25 MB", () => {
    // Construct a File whose .size is reported as 26 MB without allocating that
    // much memory: write a Blob with a known size and assert it's rejected.
    const big = new File([new Uint8Array(26_000_000)], "big.png", { type: "image/png" });
    const v = engine.validate(big, engine.defaultOptions);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/25 MB/);
  });
});
```

Run: `pnpm test src/engines/image-bg-remove/index.test.ts`
Expected: PASS.

- [ ] **Step 8: Register the engine**

Edit `src/engines/_shared/registry.ts`:

```diff
 export type EngineId =
   | "docx-to-pdf"
   | "docx-to-txt"
+  | "image-bg-remove"
   | "image-convert"
   | "image-resize"
   ...

 const REGISTRY: Record<EngineId, Loader> = {
   "docx-to-pdf": () => import("@/engines/docx-to-pdf"),
   "docx-to-txt": () => import("@/engines/docx-to-txt"),
+  "image-bg-remove": () => import("@/engines/image-bg-remove"),
   "image-convert": () => import("@/engines/image-convert"),
   ...
 };
```

- [ ] **Step 9: Run typecheck + lint + tests**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all green. The bg-remove engine module's tests run; the worker.ts is not yet exercised end-to-end (that happens in Tasks 8 and 9).

- [ ] **Step 10: Commit**

```bash
git add src/engines/image-bg-remove/ src/engines/_shared/registry.ts

git commit -m "feat(bg-remove): engine module — options, panel, worker, index

Single-input engine that runs an image-segmentation pipeline in a
persistent worker. Options: bgMode (transparent | solid), bgColor,
outputFormat (png | jpeg), jpegQuality. Cross-rule clamping: any
transparent state forces png output. Worker emits model-loading
and inference progress events through Comlink. Output filenames
gain a -nobg suffix. Engine registered."
```

---

## Task 6: Route page + sidebar entry + home grid

**Files:**
- Create: `src/app/tools/image-bg-remove/page.tsx`
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Create the route page (with first-run banner per spec §5.3)**

```tsx
"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine, { disposeBgRemoveHarness } from "@/engines/image-bg-remove";
import { useEffect, useState } from "react";

const BANNER_KEY = "bg-remove-banner-seen";

export default function ImageBgRemovePage() {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    if (typeof sessionStorage !== "undefined" && !sessionStorage.getItem(BANNER_KEY)) {
      setShowBanner(true);
    }
    return () => disposeBgRemoveHarness();
  }, []);

  function dismiss() {
    sessionStorage.setItem(BANNER_KEY, "1");
    setShowBanner(false);
  }

  return (
    <>
      {showBanner && (
        <div
          data-testid="bg-remove-first-run-banner"
          className="mx-6 mt-3 flex items-center justify-between border border-[var(--color-hairline)] px-3 py-2 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-muted)]"
        >
          <span>first conversion downloads ~80 mb. after that it&apos;s instant.</span>
          <button
            type="button"
            onClick={dismiss}
            data-testid="bg-remove-banner-dismiss"
            className="text-[var(--color-accent)] hover:text-[var(--color-fg-strong)]"
          >
            [ dismiss ]
          </button>
        </div>
      )}
      <ToolFrame engine={engine} />
    </>
  );
}
```

The `useEffect` cleanup is critical: it terminates the persistent worker on unmount so the ~200 MB resident memory is released when the user leaves the page. The banner is sessionStorage-keyed (not localStorage) so each new tab session shows the warning once — the warning is most relevant when the user hasn't yet paid the model download.

- [ ] **Step 2: Add sidebar entry**

Edit `src/components/layout/sidebar.tsx`'s `TOOLS` array, insert directly after `image-resize`:

```diff
   { id: "image-resize", href: "/tools/image-resize", label: "image resize", group: "IMAGES" },
+  { id: "image-bg-remove", href: "/tools/image-bg-remove", label: "image bg remove", group: "IMAGES" },
   { id: "image-to-pdf", href: "/tools/image-to-pdf", label: "image→pdf", group: "IMAGES" },
```

- [ ] **Step 3: Add home grid card**

Edit `src/app/page.tsx`'s `TOOLS` array, append a new entry (placement matches `image-resize`'s group):

```diff
   {
     id: "image-resize",
     title: "image resize",
     description: "png, jpg, jpeg, webp, heic · resize by px or %",
     href: "/tools/image-resize",
   },
+  {
+    id: "image-bg-remove",
+    title: "image bg remove",
+    description: "png, jpg, webp · cutout to transparent or solid color",
+    href: "/tools/image-bg-remove",
+  },
```

- [ ] **Step 4: Smoke test in dev**

```bash
pnpm dev
```

Open `http://localhost:3000/tools/image-bg-remove` in a browser. Expect: ToolFrame renders, the options panel shows the BG segmented toggle in the default state (transparent active, no quality slider, transparent preset highlighted). Drop test deferred to Task 9.

Stop the dev server (Ctrl-C).

- [ ] **Step 5: Commit**

```bash
git add src/app/tools/image-bg-remove/page.tsx \
        src/components/layout/sidebar.tsx \
        src/app/page.tsx

git commit -m "feat(bg-remove): route, sidebar entry, home grid card

Page mounts ToolFrame and disposes the persistent worker on
unmount so the ~200 MB resident model memory releases when the
user navigates away. Sidebar slots between image-resize and
image-to-pdf; home grid card sits in the IMAGES group."
```

---

## Task 7: Test fixtures

**Files:**
- Create: `tests/fixtures/bg-remove/product-on-white.jpg`
- Create: `tests/fixtures/bg-remove/portrait-cluttered-bg.jpg`
- Create: `tests/fixtures/bg-remove/transparent-glass.jpg`
- Create: `tests/fixtures/bg-remove/SOURCES.md`

- [ ] **Step 1: Acquire three fixtures from Unsplash**

Each must be:

- Unsplash CC0-licensed (i.e., from <https://unsplash.com>; their license permits commercial use without attribution but recording the photographer credit is courteous and required by `SOURCES.md`).
- < 1 MB after JPEG re-encode.
- Resized so the longest side is ≤ 1600 px (smaller fixtures = faster CI; we don't need full-res for correctness checks).

Suggested searches:

| Fixture | Unsplash search terms | Pick photo with |
|---|---|---|
| `product-on-white.jpg` | "product white background", "ceramic vase white", "shoe studio shot" | clean cutout edges, opaque object on near-white bg |
| `portrait-cluttered-bg.jpg` | "portrait outdoor", "person park", "candid portrait street" | visible hair detail, distinguishable but cluttered bg |
| `transparent-glass.jpg` | "wine glass", "perfume bottle clear", "drinking glass" | translucent object with visible bg through it |

For each: download, run through any image tool (e.g., macOS Preview's Export As → Quality 70%) to get under 1 MB, copy to `tests/fixtures/bg-remove/`.

- [ ] **Step 2: Write `SOURCES.md`**

```md
# bg-remove fixture sources

All fixtures are Unsplash CC0 photos resized to ≤ 1600 px on the long side and
re-encoded to JPEG quality ~70 to fit under 1 MB.

| File | Unsplash URL | Photographer |
|---|---|---|
| product-on-white.jpg     | <url> | <name> |
| portrait-cluttered-bg.jpg | <url> | <name> |
| transparent-glass.jpg    | <url> | <name> |
```

Fill in the URL and photographer name for each. Unsplash photo URLs look like `https://unsplash.com/photos/<slug>`.

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/bg-remove/

git commit -m "test(bg-remove): commit unsplash CC0 fixtures

Three fixtures for the bg-remove correctness suite (Task 8):
product-on-white (easy edges), portrait-cluttered-bg (hair-edge
hard case), transparent-glass (model failure-mode case). All
< 1 MB, resized ≤ 1600 px on long side, photographer credits
in SOURCES.md."
```

---

## Task 8: Correctness tests (vitest, gated on model files present)

**Files:**
- Create: `src/engines/image-bg-remove/correctness.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import engine from "./index";

const FIXTURES = [
  { file: "product-on-white.jpg", alphaRange: [0.05, 0.6] },
  { file: "portrait-cluttered-bg.jpg", alphaRange: [0.18, 0.35] },
  { file: "transparent-glass.jpg", alphaRange: [0.0, 0.95] },
] as const;

const modelDir = path.resolve(__dirname, "../../../public/models/bg-remove");
const modelsPresent = existsSync(path.join(modelDir, "MANIFEST.json"));

describe.runIf(modelsPresent)("image-bg-remove correctness", () => {
  for (const fx of FIXTURES) {
    it(`runs on ${fx.file} and produces sensible output`, async () => {
      const fixturePath = path.resolve(__dirname, "../../../tests/fixtures/bg-remove", fx.file);
      const bytes = readFileSync(fixturePath);
      const file = new File([bytes], fx.file, { type: "image/jpeg" });
      const ctrl = new AbortController();
      const result = await engine.convert(file, engine.defaultOptions, ctrl.signal);
      const out = Array.isArray(result) ? result[0] : result;
      expect(out.mime).toBe("image/png");
      expect(out.blob.size).toBeGreaterThan(1000);

      // Decode and check alpha coverage
      const decoded = await createImageBitmap(out.blob);
      const canvas = new OffscreenCanvas(decoded.width, decoded.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("ctx");
      ctx.drawImage(decoded, 0, 0);
      const data = ctx.getImageData(0, 0, decoded.width, decoded.height).data;
      let opaque = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]! > 128) opaque += 1;
      const coverage = opaque / (data.length / 4);
      expect(coverage).toBeGreaterThanOrEqual(fx.alphaRange[0]);
      expect(coverage).toBeLessThanOrEqual(fx.alphaRange[1]);
    }, 60_000);
  }

  it("solid mode produces zero non-opaque pixels", async () => {
    const fixturePath = path.resolve(__dirname, "../../../tests/fixtures/bg-remove/product-on-white.jpg");
    const bytes = readFileSync(fixturePath);
    const file = new File([bytes], "product-on-white.jpg", { type: "image/jpeg" });
    const ctrl = new AbortController();
    const result = await engine.convert(
      file,
      { bgMode: "solid", bgColor: "#ff0000", outputFormat: "png", jpegQuality: 0.92 },
      ctrl.signal,
    );
    const out = Array.isArray(result) ? result[0] : result;
    const decoded = await createImageBitmap(out.blob);
    const canvas = new OffscreenCanvas(decoded.width, decoded.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(decoded, 0, 0);
    const data = ctx.getImageData(0, 0, decoded.width, decoded.height).data;
    let translucent = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! < 255) translucent += 1;
    expect(translucent).toBe(0);
  }, 60_000);
});

if (!modelsPresent) {
  // eslint-disable-next-line no-console
  console.log("[bg-remove correctness] skipped — public/models/bg-remove is empty. Run pnpm install or pnpm prebuild.");
}
```

This suite runs the actual model. It depends on Vitest's environment supporting `OffscreenCanvas` + `createImageBitmap` — Vitest with `jsdom` does NOT, so this file requires the `happy-dom` environment or `@vitest/browser` mode. Check `vitest.config.ts` and either:

- Adjust the test to use `pageContext: "browser"` if that mode is configured, or
- Mark the suite `describe.skip` for unit-test-runs and run it as part of an explicit `pnpm test:correctness` script (add to `package.json`).

If `vitest.config.ts` already configures the browser environment for image work, no change is needed.

- [ ] **Step 2: Run the correctness suite**

```bash
pnpm test src/engines/image-bg-remove/correctness.test.ts
```

Expected: 4 tests pass (the three fixtures + solid-mode-no-translucency). Total runtime: 30–90 s on a recent Mac, longer on slower hardware.

If a fixture fails the `alphaRange` assertion: the model output is unreasonable. Either the model is wrong (re-check Task 1), or the fixture is too hard (replace with a different Unsplash photo and update the range).

- [ ] **Step 3: Commit**

```bash
git add src/engines/image-bg-remove/correctness.test.ts

git commit -m "test(bg-remove): correctness suite against fixtures

Runs real model inference against the three Unsplash fixtures and
asserts: PNG decodes, alpha coverage is in fixture-specific
expected range (regression tripwire), and solid-mode output has
zero non-opaque pixels. Skips when public/models/bg-remove is
empty so fresh checkouts pass before pnpm install completes."
```

---

## Task 9: E2E happy path

**Files:**
- Create: `tests/e2e/image-bg-remove.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import path from "node:path";
import { expect, test } from "@playwright/test";

test("transparent-bg PNG happy path", async ({ page }) => {
  await page.goto("/tools/image-bg-remove", { waitUntil: "networkidle" });
  const fixture = path.resolve(__dirname, "../fixtures/bg-remove/product-on-white.jpg");
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.getByTestId("convert-button").click();

  // Progress events appear in some run; minimally we just need DONE.
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 120_000 });

  // Capture the download via Playwright's download event
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /download/i }).click(),
  ]);
  const buf = await download.createReadStream().then(async (s) => {
    const chunks: Buffer[] = [];
    for await (const c of s!) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  });
  // PNG magic bytes
  expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  // Filename suffix
  expect(download.suggestedFilename()).toMatch(/-nobg\.png$/);
});

test("solid-bg JPEG happy path", async ({ page }) => {
  await page.goto("/tools/image-bg-remove", { waitUntil: "networkidle" });
  await page.getByTestId("bg-mode-solid").click();
  await page.getByTestId("output-jpeg").click();
  // quality slider should appear
  await expect(page.getByTestId("quality-slider")).toBeVisible();

  const fixture = path.resolve(__dirname, "../fixtures/bg-remove/product-on-white.jpg");
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 120_000 });

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /download/i }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/-nobg\.jpg$/);
});
```

Note the 120-second timeout — first conversion needs to load the model (cold path), and the dev server doesn't compress aggressively. Subsequent conversions in the same Playwright session reuse the cached model.

- [ ] **Step 2: Run**

```bash
pnpm test:e2e tests/e2e/image-bg-remove.spec.ts --project=chromium
```

Expected: both tests pass.

If they fail because the model isn't loading: inspect Network tab during a `--headed` run; URLs starting `/_next/...` are fine, anything off-origin is a regression in `model-loader.ts`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/image-bg-remove.spec.ts

git commit -m "test(e2e): bg-remove happy path

Two specs: transparent PNG default flow + solid JPEG flow with
quality slider visible. Both decode the resulting download blob
and assert filename suffix / PNG magic bytes. Chromium-only in
v1; firefox/webkit deferred per spec §10.3."
```

---

## Task 10: E2E privacy regression

**Files:**
- Create: `tests/e2e/privacy-regression-image-bg-remove.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import path from "node:path";
import { expect, test } from "@playwright/test";

test("bg-remove conversion produces zero off-origin requests including model load", async ({ page }) => {
  const PAGE_PATH = "/tools/image-bg-remove";

  await page.goto(PAGE_PATH, { waitUntil: "networkidle" });

  page.removeAllListeners("request");
  const offOriginRequests: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.origin !== new URL(page.url()).origin) {
      offOriginRequests.push(req.url());
    }
  });
  const offOriginWebSockets: string[] = [];
  page.on("websocket", (ws) => {
    if (new URL(ws.url()).host !== new URL(page.url()).host) {
      offOriginWebSockets.push(ws.url());
    }
  });

  const input = page.locator('input[type="file"]');
  const fixture = path.resolve(__dirname, "../fixtures/bg-remove/product-on-white.jpg");
  await input.setInputFiles(fixture);
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 120_000 });
  await page.waitForLoadState("networkidle");

  expect(
    offOriginRequests,
    `bg-remove made off-origin requests: ${offOriginRequests.join(", ")}`,
  ).toEqual([]);
  expect(
    offOriginWebSockets,
    `bg-remove opened off-origin WebSockets: ${offOriginWebSockets.join(", ")}`,
  ).toEqual([]);
});
```

- [ ] **Step 2: Run**

```bash
pnpm test:e2e tests/e2e/privacy-regression-image-bg-remove.spec.ts --project=chromium
```

Expected: passes. The model fetch is to `/models/bg-remove/...` (same origin) and the wasm is to `/onnx-wasm/...` (same origin), neither of which trigger the off-origin filter.

If it fails: open the spec in headed mode and inspect the failing URLs. The most common regressions are (a) `env.allowRemoteModels` toggled to true, (b) a `tokenizer.json` file expected by transformers.js but missing from the manifest copy (transformers.js then tries the CDN fallback even with `allowRemoteModels=false` — fix by adding the file to the manifest in Task 1).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/privacy-regression-image-bg-remove.spec.ts

git commit -m "test(e2e): bg-remove privacy regression

Asserts every request and websocket during the full conversion
flow — including the ~80 MB model load — is same-origin. This
is the load-bearing privacy guarantee for the engine: a future
regression that flips env.allowRemoteModels or accepts a
tokenizer fallback URL fails this test loudly."
```

---

## Task 11: Final verification + PR

- [ ] **Step 1: Run the full check matrix**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e --project=chromium
```

All five must exit 0. If `pnpm build` fails on the bg-remove route, check that `next.config.ts` allows the route (it should — every other engine works the same way). If `pnpm test:e2e` is flaky on the model-load, check that the dev server is fully started before specs run (`webServer.timeout` in `playwright.config.ts`).

- [ ] **Step 2: Smoke test in dev one more time**

```bash
pnpm dev
```

Manual checks:

1. Drop a JPEG on `/tools/image-bg-remove`. Expect: progress bar appears (model-loading), then status flips to DONE, download button enabled.
2. Click download. Expect: `<name>-nobg.png` file with transparent background.
3. Switch BG to SOLID, pick the white preset, drop again. Expect: cutout on white background.
4. Switch OUTPUT to JPEG. Expect: quality slider appears, transparent preset is disabled.
5. Drop again. Expect: `<name>-nobg.jpg` with the chosen color.
6. Drop 3 files in succession. Expect: only the FIRST conversion shows a model-loading bar (persistent worker reuses the loaded model).
7. Navigate to a different tool page. Open DevTools → Performance → Memory: the bg-remove worker should be terminated (via `disposeBgRemoveHarness` on unmount).

Stop dev (Ctrl-C).

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin <branch>

gh pr create --title "Phase 16: image-bg-remove engine" --body "$(cat <<'EOF'
## Summary

- Adds image-bg-remove engine: transparent PNG or solid PNG/JPEG over a chosen color.
- Lays the model-loading infrastructure (build-time copy, same-origin fetch, multi-stage progress events, persistent worker) for all future ML engines.
- Ships chosen segmentation model (<recorded in Task 1: BiRefNet-lite or ISNet-DIS>, ~<size> MB) under public/models/bg-remove/, hash-pinned in scripts/bg-models-manifest.json.

## Test plan

- [ ] pnpm typecheck && pnpm lint && pnpm test exit 0
- [ ] pnpm build exits 0 (out/models/bg-remove + out/onnx-wasm populated)
- [ ] pnpm test:e2e --project=chromium passes (happy path + privacy regression)
- [ ] Manual: 3-file batch loads the model exactly once
- [ ] Manual: navigating away disposes the worker (DevTools memory check)

## Privacy

- env.allowRemoteModels = false (model-loader.ts module scope)
- Model + ort-wasm files copied from node_modules at build time and served from same origin only
- New privacy regression spec asserts zero off-origin requests during the full flow including model load
EOF
)"
```

Fill in the model name and size in the PR body before pushing.

- [ ] **Step 4: Wait for CI green; merge.**

If CI fails on a flaky e2e timeout (model load on the GH runner can be slower), bump the 120 s timeout in `image-bg-remove.spec.ts` to 180 s in a follow-up commit — don't widen unconditionally.

---

## Verification gates (recap)

| Stage | Command | Pass = |
|---|---|---|
| Build infra | `pnpm install && pnpm build` | `out/models/bg-remove/*` populated, hash-verified |
| Harness backward compat | `pnpm test src/engines/_shared/harness.test.ts` | new + existing tests green |
| Engine unit tests | `pnpm test src/engines/image-bg-remove/` | all green |
| Correctness | `pnpm test src/engines/image-bg-remove/correctness.test.ts` | 4 tests green (or skipped with clear message on a fresh checkout) |
| E2E happy path | `pnpm test:e2e --project=chromium tests/e2e/image-bg-remove.spec.ts` | both specs green |
| E2E privacy | `pnpm test:e2e --project=chromium tests/e2e/privacy-regression-image-bg-remove.spec.ts` | zero off-origin |
| Whole project | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` | green |

If any gate fails, fix the underlying issue. Don't widen the regex / increase the timeout / disable the assertion to make a test pass — they exist to catch the failure modes the spec documents.
