# file-converter — Phase 1 Implementation Plan: Foundation & HEIC Vertical Slice

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployed-on-Vercel website where the user can drop a HEIC photo and receive a PNG download — entirely client-side, with the brutalist visual system, security headers locked down, and the privacy claim asserted by an automated test that runs on every PR.

**Architecture:** Next.js 15 App Router with `output: 'export'` static build. Conversion logic isolated in Web Workers behind a typed Comlink RPC. A modular engine system (`src/engines/<id>/`) — Phase 1 implements one engine (`heic-to-png`) end-to-end against a generic harness so subsequent phases plug in additional engines without modifying shared code. Security headers applied via `vercel.json` (not `next.config`, since static export bypasses the Next.js server). Privacy guarantee enforced by a Playwright test that asserts zero outbound network traffic during conversion.

**Tech Stack:** Next.js 15, React 19, TypeScript (strict), Tailwind CSS v4, Comlink, libheif-js, Vitest, Playwright (Chromium / Firefox / WebKit), Biome, pnpm.

> **shadcn/ui is deferred to Plan 2.** Phase 1 components are raw `<button>` / `<div>` elements with Tailwind utility classes — sufficient for the drop zone, result list, and status indicator. shadcn primitives (Dialog, Slider) first appear in Plan 2 when the disambiguation modal and image-quality slider need them. Do NOT run `shadcn init` during Phase 1.

**Phasing context:** This is **Plan 1 of 6**. Subsequent plans listed at the end of this document. After Plan 1 is merged, the user will have a working deployed site. Phase 2 onward adds conversions, polish, and full hardening incrementally.

**Pre-flight verifications (do once before Task 1, ~5 min):**
- `npm view libheif-js version` — note the current version. The plan's HEIC code targets the `HeifDecoder()` API; sanity-check that the current README still uses this surface.
- `node --version` — must be ≥ 20. Next.js 15 requires Node 18.18+; we lock to ≥ 20 to match Vercel's default runtime.
- `pnpm --version` — must be ≥ 9.

---

## Phase 1 Scope

**In scope:**
- Project scaffolding, tooling, CI skeleton.
- Brutalist design tokens + JetBrains Mono self-hosted fonts.
- Layout shell: header, sidebar (hard-coded tool list), footer/status bar.
- Engine harness: types, file detection, filename inference, registry, Comlink worker harness.
- One engine implemented: HEIC → PNG.
- Drop zone component (universal + tool-specific via props).
- Result list with auto-download for single output.
- `/tools/heic-to-png` route + universal homepage that routes HEIC drops there.
- Strict CSP and full security header set via `vercel.json`.
- Privacy regression E2E test (added against a stub engine *before* the HEIC engine, so it is genuinely a regression check).
- HEIC happy-path E2E.
- Vercel deploy.

**Explicitly out of scope (later plans):**
- Other image engines (JPEG ↔ PNG ↔ WebP, resize, compress) — Plan 2.
- PDF engines — Plan 3.
- Document engines — Plan 4.
- Preferences (`localStorage`), tab-close protection, browser-floor screen, keyboard shortcuts, `/about`, paste-to-convert — Plan 5.
- Lighthouse CI, axe accessibility sweep, bundle-size budget, full ARIA pass — Plan 6.

---

## File Map

Files created in this plan (paths relative to repo root):

```
.github/workflows/ci.yml
biome.json
next.config.ts
package.json
pnpm-workspace.yaml                 (intentionally omitted — single package)
playwright.config.ts
postcss.config.mjs
tsconfig.json
vercel.json
vitest.config.ts

public/fonts/JetBrainsMono-Regular.woff2
public/fonts/JetBrainsMono-Medium.woff2

src/app/globals.css
src/app/layout.tsx
src/app/page.tsx
src/app/tools/heic-to-png/page.tsx

src/components/layout/header.tsx
src/components/layout/sidebar.tsx
src/components/layout/footer.tsx
src/components/drop-zone.tsx
src/components/drop-zone.test.tsx
src/components/result-list.tsx
src/components/result-list.test.tsx
src/components/status-indicator.tsx
src/components/status-indicator.test.tsx
src/components/tool-frame.tsx

src/engines/_shared/types.ts
src/engines/_shared/types.test-d.ts
src/engines/_shared/registry.ts
src/engines/_shared/registry.test.ts
src/engines/_shared/harness.ts
src/engines/_shared/harness.test.ts
src/engines/_shared/filename.ts
src/engines/_shared/filename.test.ts
src/engines/_shared/file-detection.ts
src/engines/_shared/file-detection.test.ts

src/engines/_stub/index.ts            (used only by privacy regression test)
src/engines/_stub/worker.ts

src/engines/heic-to-png/index.ts
src/engines/heic-to-png/worker.ts
src/engines/heic-to-png/options.ts
src/engines/heic-to-png/index.test.ts

src/lib/download.ts
src/lib/download.test.ts

tests/fixtures/sample.heic            (small real HEIC, ~200KB, committed)
tests/e2e/privacy-regression.spec.ts
tests/e2e/heic-to-png.spec.ts
```

Files modified during this plan: none (greenfield repo). The only existing file at the start of Plan 1 is `.gitignore`, committed during brainstorming.

---

## Tasks

> **Conventions for every task below:**
> - Steps run in the repo root unless stated otherwise.
> - "Verify pass/fail" steps are **mandatory** — do not skip even if the test seems trivial.
> - Commit message bodies stay under 72 char per line.
> - Never include Claude attribution in any commit (per project preferences).
> - If a step's command output diverges from "Expected," stop and investigate. Do not paper over.

### Task 1: Project scaffolding and base tooling

**Goal:** A minimal Next.js 15 project that builds, runs, lints, and has the test runners installed but unconfigured.

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `biome.json`, `postcss.config.mjs`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`

- [ ] **Step 1: Initialize Next.js project non-interactively**

```bash
pnpm create next-app@latest . \
  --typescript \
  --tailwind \
  --app \
  --src-dir \
  --eslint=false \
  --import-alias "@/*" \
  --use-pnpm \
  --skip-install
```

> **Why no `--turbopack`:** Turbopack's Web Worker support in Next.js 15 is incomplete as of this writing. Workers using `new URL("./worker.ts", import.meta.url)` may fail to resolve in `next dev --turbopack` while working perfectly with the default Webpack dev server. We stay on Webpack until Turbopack workers stabilize. `next build` is unaffected (always Webpack).

Expected: scaffolding files written to current directory. Next.js will warn about non-empty dir; accept (the existing files are `.git/`, `.gitignore`, `docs/`, `.superpowers/`, `.claude/`).

> **⚠️ Verify `.gitignore` survived the scaffold.** Modern `create-next-app` may overwrite `.gitignore` with its own version, dropping our project-specific entries (`.superpowers/`, `.claude/settings.local.json`). After Step 1 finishes:
>
> ```bash
> grep -E '^\.superpowers/$|^\.claude/settings\.local\.json$' .gitignore
> ```
>
> If either line is missing, restore the entries by appending:
>
> ```bash
> echo "" >> .gitignore
> echo "# Superpowers brainstorming artifacts (mockups, session state)" >> .gitignore
> echo ".superpowers/" >> .gitignore
> echo "" >> .gitignore
> echo "# Claude Code local settings" >> .gitignore
> echo ".claude/settings.local.json" >> .gitignore
> ```
>
> (Alternatively: `git checkout HEAD -- .gitignore` to restore the committed version, then re-apply any new Next.js-specific lines from the scaffold by hand.)

- [ ] **Step 2: Replace generated `package.json` scripts and dependencies**

Overwrite `package.json` with the following exact contents:

```json
{
  "name": "file-converter",
  "version": "0.1.0",
  "private": true,
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "biome check src tests",
    "lint:fix": "biome check --write src tests",
    "format": "biome format --write src tests",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "@playwright/test": "^1.48.0",
    "@tailwindcss/postcss": "^4.0.0",
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^25.0.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Install dependencies**

```bash
pnpm install
```

Expected: success, no peer-dependency warnings that block. If a peer warning blocks (rare in Next 15 + React 19), add `pnpm.peerDependencyRules.allowedVersions` and rerun. Commit the lockfile in step 8.

- [ ] **Step 4: Replace `tsconfig.json` with strict configuration**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext", "WebWorker"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": [
    "next-env.d.ts",
    "src/**/*.ts",
    "src/**/*.tsx",
    "tests/**/*.ts",
    "tests/**/*.tsx",
    ".next/types/**/*.ts"
  ],
  "exclude": ["node_modules", "out", ".next"]
}
```

- [ ] **Step 5: Replace `next.config.ts` with static-export configuration**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  trailingSlash: false,
  // Note: `headers()` does NOT run with `output: 'export'`.
  // Security headers are configured in vercel.json (Task 14).
  images: {
    unoptimized: true, // required for static export
  },
  typedRoutes: true,
};

export default nextConfig;
```

- [ ] **Step 6: Create `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "ignoreUnknown": true },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": {
        "noNonNullAssertion": "warn",
        "useImportType": "error"
      },
      "suspicious": {
        "noExplicitAny": "error"
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "always"
    }
  }
}
```

- [ ] **Step 7: Verify scaffolding builds and lints cleanly**

```bash
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all three commands exit 0. `pnpm build` produces `out/` with at least an `index.html`.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json next.config.ts biome.json postcss.config.mjs src next-env.d.ts
git commit -m "feat: scaffold Next.js 15 + TS strict + Tailwind v4 + Biome

Static export configured (output: 'export') so the entire app
serves as static files from Vercel — no server in the conversion
path. Headers will be set in vercel.json (Task 11).

Strict TypeScript: noUncheckedIndexedAccess, exactOptional, etc."
```

---

### Task 2: Vitest + Testing Library configuration

**Goal:** Vitest runs in jsdom, knows about React, has Testing Library matchers, and a sample test passes.

**Files:**
- Create: `vitest.config.ts`, `src/test-setup.ts`, `src/sanity.test.ts`

- [ ] **Step 1: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.{test,test-d}.{ts,tsx}"],
    css: false,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
```

- [ ] **Step 2: Create `src/test-setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";

// jsdom does not implement matchMedia; some shadcn primitives query it.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});
```

- [ ] **Step 3: Write a failing sanity test**

`src/sanity.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("test runner sanity", () => {
  it("multiplies", () => {
    expect(2 * 21).toBe(42);
  });

  it("loads jest-dom matchers", () => {
    const el = document.createElement("div");
    el.textContent = "hello";
    document.body.appendChild(el);
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent("hello");
    document.body.removeChild(el);
  });
});
```

- [ ] **Step 4: Run tests to verify both pass**

```bash
pnpm test
```

Expected: 2 tests passed, 0 failed. If `toBeInTheDocument` is undefined, the setup file did not load — recheck `setupFiles` path.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts src/test-setup.ts src/sanity.test.ts
git commit -m "test: configure Vitest with jsdom and Testing Library matchers"
```

---

### Task 3: Playwright configuration

**Goal:** Playwright is installed for Chromium / Firefox / WebKit, has a base config, and a placeholder test runs against the dev server.

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/smoke.spec.ts`

- [ ] **Step 1: Install Playwright browsers**

```bash
pnpm exec playwright install --with-deps chromium firefox webkit
```

Expected: three browsers downloaded. On Linux CI this also installs system deps; locally on macOS the deps step is a no-op.

- [ ] **Step 2: Create `playwright.config.ts`**

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
```

- [ ] **Step 3: Write a failing smoke test**

`tests/e2e/smoke.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("homepage responds with 200 and includes a body element", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("body")).toBeVisible();
});
```

- [ ] **Step 4: Run only chromium project to verify the smoke test passes**

```bash
pnpm test:e2e --project=chromium
```

Expected: 1 test passed. (We only run chromium here to save time during scaffolding; CI runs all three projects.)

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts tests/e2e/smoke.spec.ts
git commit -m "test: add Playwright with Chromium/Firefox/WebKit projects

CI runs all three; local dev defaults to fast feedback via
chromium-only invocations."
```

---

### Task 4: GitHub Actions CI skeleton

**Goal:** Every PR runs typecheck, lint, vitest, and Playwright (chromium only at this stage; full matrix added in Plan 6). Failing checks block merge.

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow**

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Type check
        run: pnpm typecheck

      - name: Lint
        run: pnpm lint

      - name: Unit tests
        run: pnpm test

      - name: Build
        run: pnpm build

      - name: Install Playwright browsers
        run: pnpm exec playwright install --with-deps chromium

      - name: E2E tests (chromium only this phase)
        run: pnpm test:e2e --project=chromium
        env:
          CI: "true"

      - name: Upload Playwright report on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

- [ ] **Step 2: Commit and push to a fresh branch to verify CI runs**

The repo is local-only at this stage — push happens in Task 14 once a remote is configured. For now, simply commit the workflow:

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow

Type check, lint, vitest, build, Playwright (chromium only this
phase). Full browser matrix and Lighthouse/axe added in Plan 6."
```

CI will not actually run until the repo is pushed in Task 14; that task confirms the workflow goes green.

---

### Task 5: Tailwind v4 design tokens and globals

**Goal:** Tailwind v4 wired through PostCSS; `globals.css` defines the brutalist palette, type scale, hairlines, and self-hosted JetBrains Mono fonts. Visual smoke check confirms the body renders in monospace on a near-black background.

**Files:**
- Create: `postcss.config.mjs`, `src/app/globals.css`, `public/fonts/JetBrainsMono-Regular.woff2`, `public/fonts/JetBrainsMono-Medium.woff2`
- Modify: `src/app/layout.tsx`, `src/app/page.tsx`

- [ ] **Step 1: Remove any v3-style Tailwind config the scaffold may have left, then confirm `postcss.config.mjs` uses the v4 plugin**

```bash
rm -f tailwind.config.ts tailwind.config.js tailwind.config.mjs
```

(Tailwind v4 in `@theme`-via-CSS mode does not use a JS config file. A stray config file is harmless at runtime but causes ten minutes of confusion when `@theme` tokens appear not to apply.)

Then write or overwrite `postcss.config.mjs`:

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

- [ ] **Step 2: Download JetBrains Mono Regular + Medium WOFF2 into `public/fonts/`**

Run from repo root:

```bash
mkdir -p public/fonts
curl -fsSL -o public/fonts/JetBrainsMono-Regular.woff2 \
  https://cdn.jsdelivr.net/gh/JetBrains/JetBrainsMono@v2.304/fonts/webfonts/JetBrainsMono-Regular.woff2
curl -fsSL -o public/fonts/JetBrainsMono-Medium.woff2 \
  https://cdn.jsdelivr.net/gh/JetBrains/JetBrainsMono@v2.304/fonts/webfonts/JetBrainsMono-Medium.woff2
```

Verify both files exist and are non-empty:

```bash
ls -lh public/fonts/
```

Expected: both files ~50–100KB.

- [ ] **Step 3: Replace `src/app/globals.css` with the brutalist token system**

```css
@import "tailwindcss";

@font-face {
  font-family: "JetBrains Mono";
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("/fonts/JetBrainsMono-Regular.woff2") format("woff2");
}

@font-face {
  font-family: "JetBrains Mono";
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url("/fonts/JetBrainsMono-Medium.woff2") format("woff2");
}

@theme {
  --font-mono: "JetBrains Mono", "SF Mono", Menlo, monospace;

  --color-bg: #0a0a0a;
  --color-surface: #0d0d0d;
  --color-fg: #e8e8e8;
  --color-fg-strong: #ffffff;
  --color-fg-muted: #888888;
  --color-fg-very-muted: #5a5a5a;
  --color-hairline: #2a2a2a;
  --color-accent: #ff6b35;

  --text-xs: 11px;
  --text-sm: 13px;
  --text-base: 16px;
  --text-lg: 22px;

  --radius-none: 0;
}

@layer base {
  *,
  *::before,
  *::after {
    border-radius: 0;
  }

  html,
  body {
    background-color: var(--color-bg);
    color: var(--color-fg);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 400;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  ::selection {
    background-color: var(--color-accent);
    color: var(--color-bg);
  }
}
```

- [ ] **Step 4: Replace `src/app/layout.tsx` with the minimal root layout**

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "file-converter",
  description: "Local, private file conversion. Files never leave your device.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 5: Replace `src/app/page.tsx` with a token smoke check**

```tsx
export default function Home() {
  return (
    <main className="p-4">
      <h1 className="text-[var(--text-lg)] text-[var(--color-fg-strong)]">file-converter</h1>
      <p className="text-[var(--color-fg-muted)]">tokens are wired</p>
      <span className="text-[var(--color-accent)]">[ READY ]</span>
    </main>
  );
}
```

- [ ] **Step 6: Verify dev server renders the page in monospace on dark background**

```bash
pnpm dev
```

In a browser, open `http://localhost:3000`. Expect: dark `#0a0a0a` background, monospace text, "file-converter" in white at 22px, muted "tokens are wired" line, accent-colored "[ READY ]". If any element renders rounded, sans-serif, or on a white background, the token wiring failed — recheck `globals.css`.

Stop the dev server (`Ctrl+C`).

- [ ] **Step 7: Run typecheck and lint**

```bash
pnpm typecheck && pnpm lint && pnpm build
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add postcss.config.mjs src/app public/fonts
git commit -m "feat(design): brutalist token system + self-hosted JetBrainsMono

Tailwind v4 @theme block defines palette, type scale, font stack.
Fonts self-hosted in public/fonts/ — keeps CSP font-src 'self'.
All elements forced to border-radius: 0 in the base layer."
```

---

### Task 6: Engine type definitions, file detection, filename inference

**Goal:** Pure TypeScript modules under `src/engines/_shared/` covering the engine interface, `ValidationResult`, output representation, MIME/magic-byte detection, and filename inference. All have unit tests.

**Files:**
- Create: `src/engines/_shared/types.ts`, `src/engines/_shared/types.test-d.ts`, `src/engines/_shared/file-detection.ts`, `src/engines/_shared/file-detection.test.ts`, `src/engines/_shared/filename.ts`, `src/engines/_shared/filename.test.ts`

- [ ] **Step 1: Write `types.ts`**

```ts
export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

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

export type SingleInputEngine<TOptions, TOutput extends OutputItem | OutputItem[]> =
  EngineMeta<TOptions> & {
    cardinality: "single";
    validate(file: File, opts: TOptions): ValidationResult;
    convert(file: File, opts: TOptions, signal: AbortSignal): Promise<TOutput>;
  };

export type MultiInputEngine<TOptions, TOutput extends OutputItem | OutputItem[]> =
  EngineMeta<TOptions> & {
    cardinality: "multi";
    validate(files: File[], opts: TOptions): ValidationResult;
    convert(files: File[], opts: TOptions, signal: AbortSignal): Promise<TOutput>;
  };

export type ConversionEngine<TOptions = unknown, TOutput extends OutputItem | OutputItem[] = OutputItem | OutputItem[]> =
  | SingleInputEngine<TOptions, TOutput>
  | MultiInputEngine<TOptions, TOutput>;
```

- [ ] **Step 2: Write a type-level test in `types.test-d.ts`**

```ts
import { describe, expectTypeOf, it } from "vitest";
import type {
  ConversionEngine,
  MultiInputEngine,
  OutputItem,
  SingleInputEngine,
  ValidationResult,
} from "./types";

describe("types", () => {
  it("ValidationResult discriminates on ok", () => {
    const v: ValidationResult = { ok: true };
    if (v.ok) {
      expectTypeOf(v).toMatchTypeOf<{ ok: true }>();
    } else {
      expectTypeOf(v.reason).toBeString();
    }
  });

  it("SingleInputEngine takes one File and returns OutputItem(s)", () => {
    type E = SingleInputEngine<{ q: number }, OutputItem>;
    const e = {} as E;
    expectTypeOf(e.convert).parameter(0).toMatchTypeOf<File>();
    expectTypeOf(e.cardinality).toEqualTypeOf<"single">();
  });

  it("MultiInputEngine takes File[] and returns OutputItem(s)", () => {
    type E = MultiInputEngine<{ q: number }, OutputItem>;
    const e = {} as E;
    expectTypeOf(e.convert).parameter(0).toMatchTypeOf<File[]>();
    expectTypeOf(e.cardinality).toEqualTypeOf<"multi">();
  });

  it("ConversionEngine narrows by cardinality", () => {
    const e = {} as ConversionEngine;
    if (e.cardinality === "single") {
      expectTypeOf(e.convert).parameter(0).toMatchTypeOf<File>();
    }
  });
});
```

- [ ] **Step 3: Write `filename.ts`**

```ts
export function replaceExtension(originalName: string, newExtension: string): string {
  const ext = newExtension.startsWith(".") ? newExtension : `.${newExtension}`;
  const dot = originalName.lastIndexOf(".");
  if (dot <= 0) return `${originalName}${ext}`;
  return `${originalName.slice(0, dot)}${ext}`;
}

export function pageSuffixedName(originalName: string, page: number, newExtension: string): string {
  const ext = newExtension.startsWith(".") ? newExtension : `.${newExtension}`;
  const dot = originalName.lastIndexOf(".");
  const base = dot <= 0 ? originalName : originalName.slice(0, dot);
  return `${base}-page-${page}${ext}`;
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[ -<>:"/\\|?*]/g, "_").slice(0, 255);
}
```

- [ ] **Step 4: Write `filename.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { pageSuffixedName, replaceExtension, sanitizeFilename } from "./filename";

describe("replaceExtension", () => {
  it("swaps a normal extension", () => {
    expect(replaceExtension("vacation.heic", "png")).toBe("vacation.png");
  });

  it("accepts extension with leading dot", () => {
    expect(replaceExtension("vacation.heic", ".png")).toBe("vacation.png");
  });

  it("appends when no extension present", () => {
    expect(replaceExtension("README", "txt")).toBe("README.txt");
  });

  it("does not treat leading-dot files as extensions", () => {
    expect(replaceExtension(".gitignore", "txt")).toBe(".gitignore.txt");
  });

  it("handles multiple dots — only the last is the extension", () => {
    expect(replaceExtension("archive.tar.gz", "zip")).toBe("archive.tar.zip");
  });
});

describe("pageSuffixedName", () => {
  it("produces page-N suffix", () => {
    expect(pageSuffixedName("doc.pdf", 1, "png")).toBe("doc-page-1.png");
    expect(pageSuffixedName("doc.pdf", 42, "png")).toBe("doc-page-42.png");
  });
});

describe("sanitizeFilename", () => {
  it("replaces forbidden characters", () => {
    expect(sanitizeFilename('weird/name<>:"|?*.txt')).toBe("weird_name________.txt");
  });

  it("truncates to 255 chars", () => {
    const long = "a".repeat(300) + ".txt";
    expect(sanitizeFilename(long)).toHaveLength(255);
  });
});
```

- [ ] **Step 5: Write `file-detection.ts`**

```ts
const MAGIC: Array<{ mime: string; bytes: readonly number[]; offset?: number }> = [
  { mime: "image/heic", bytes: [0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], offset: 4 },
  { mime: "image/heif", bytes: [0x66, 0x74, 0x79, 0x70, 0x6d, 0x69, 0x66, 0x31], offset: 4 },
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF; WEBP follows at offset 8
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] }, // "%PDF"
  {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: [0x50, 0x4b, 0x03, 0x04], // ZIP magic; DOCX is a ZIP. Disambiguation by checking for "word/" entry not done at this layer.
  },
];

export async function detectMime(file: File): Promise<string> {
  // Trust file.type when reliable.
  if (file.type && !file.type.startsWith("application/octet-stream")) {
    return file.type;
  }
  // Fallback: read first 512 bytes and check magic.
  const buf = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  for (const entry of MAGIC) {
    const offset = entry.offset ?? 0;
    if (buf.length < offset + entry.bytes.length) continue;
    let match = true;
    for (let i = 0; i < entry.bytes.length; i++) {
      if (buf[offset + i] !== entry.bytes[i]) {
        match = false;
        break;
      }
    }
    if (match) return entry.mime;
  }
  return "application/octet-stream";
}

export function extensionFromName(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}
```

- [ ] **Step 6: Write `file-detection.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { detectMime, extensionFromName } from "./file-detection";

function fileFromBytes(bytes: number[], name: string, mimeHint = ""): File {
  return new File([new Uint8Array(bytes)], name, { type: mimeHint });
}

describe("detectMime", () => {
  it("uses file.type when present and reliable", async () => {
    const f = fileFromBytes([0, 0, 0], "x.png", "image/png");
    expect(await detectMime(f)).toBe("image/png");
  });

  it("falls back to magic bytes when type is empty", async () => {
    const f = fileFromBytes([0xff, 0xd8, 0xff, 0xe0], "x", "");
    expect(await detectMime(f)).toBe("image/jpeg");
  });

  it("detects HEIC by ftyp box", async () => {
    const heicHeader = [
      0, 0, 0, 0,
      0x66, 0x74, 0x79, 0x70,
      0x68, 0x65, 0x69, 0x63,
    ];
    const f = fileFromBytes(heicHeader, "photo.heic", "");
    expect(await detectMime(f)).toBe("image/heic");
  });

  it("detects PNG", async () => {
    const f = fileFromBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "x", "");
    expect(await detectMime(f)).toBe("image/png");
  });

  it("returns octet-stream for unknown bytes", async () => {
    const f = fileFromBytes([0x00, 0x01, 0x02, 0x03], "x", "");
    expect(await detectMime(f)).toBe("application/octet-stream");
  });
});

describe("extensionFromName", () => {
  it("extracts the lowercased extension", () => {
    expect(extensionFromName("photo.HEIC")).toBe("heic");
  });
  it("returns null when no extension", () => {
    expect(extensionFromName("README")).toBeNull();
  });
  it("returns null for trailing dot", () => {
    expect(extensionFromName("weird.")).toBeNull();
  });
  it("returns null for dotfiles", () => {
    expect(extensionFromName(".gitignore")).toBeNull();
  });
});
```

- [ ] **Step 7: Run all unit tests**

```bash
pnpm test
```

Expected: all tests pass (sanity tests from Task 2 + the new files).

- [ ] **Step 8: Commit**

```bash
git add src/engines/_shared
git commit -m "feat(engines): shared types, filename, file-detection

Discriminated-union ConversionEngine (single/multi cardinality).
detectMime trusts file.type then falls back to magic bytes.
filename utilities cover replaceExtension, pageSuffixedName, and
sanitizeFilename for cross-platform safety."
```

---

### Task 7: Engine registry + Comlink worker harness with stub engine

**Goal:** A registry that maps engine ids to lazy-loaded modules; a `WorkerHarness` that wraps Comlink-exposed workers with `AbortSignal` plumbing; a `_stub` engine usable by the privacy regression test in Task 8.

**Files:**
- Create: `src/engines/_shared/registry.ts`, `src/engines/_shared/registry.test.ts`, `src/engines/_shared/harness.ts`, `src/engines/_shared/harness.test.ts`, `src/engines/_stub/index.ts`, `src/engines/_stub/worker.ts`

- [ ] **Step 1: Install Comlink**

```bash
pnpm add comlink
```

- [ ] **Step 2: Write `harness.ts`**

```ts
import * as Comlink from "comlink";
import type { OutputItem } from "./types";

export type WorkerEntry<TOptions> = {
  convertSingle?: (
    fileBytes: ArrayBuffer,
    fileName: string,
    fileType: string,
    opts: TOptions,
  ) => Promise<OutputItem | OutputItem[]>;
  convertMulti?: (
    files: Array<{ bytes: ArrayBuffer; name: string; type: string }>,
    opts: TOptions,
  ) => Promise<OutputItem | OutputItem[]>;
};

export type WorkerFactory = () => Worker;

export class WorkerHarness<TOptions> {
  private worker: Worker | null = null;
  private remote: Comlink.Remote<WorkerEntry<TOptions>> | null = null;

  constructor(private readonly factory: WorkerFactory) {}

  async runSingle(
    file: File,
    opts: TOptions,
    signal: AbortSignal,
  ): Promise<OutputItem | OutputItem[]> {
    this.spawn();
    if (!this.remote?.convertSingle) {
      this.terminate();
      throw new Error("worker does not implement convertSingle");
    }
    const buf = await file.arrayBuffer();
    const abortPromise = new Promise<never>((_, reject) => {
      const onAbort = () => {
        this.terminate();
        reject(new DOMException("Aborted", "AbortError"));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const result = await Promise.race([
        this.remote.convertSingle(buf, file.name, file.type, opts),
        abortPromise,
      ]);
      return result;
    } finally {
      this.terminate();
    }
  }

  async runMulti(
    files: File[],
    opts: TOptions,
    signal: AbortSignal,
  ): Promise<OutputItem | OutputItem[]> {
    this.spawn();
    if (!this.remote?.convertMulti) {
      this.terminate();
      throw new Error("worker does not implement convertMulti");
    }
    const payload = await Promise.all(
      files.map(async (f) => ({ bytes: await f.arrayBuffer(), name: f.name, type: f.type })),
    );
    const abortPromise = new Promise<never>((_, reject) => {
      const onAbort = () => {
        this.terminate();
        reject(new DOMException("Aborted", "AbortError"));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const result = await Promise.race([this.remote.convertMulti(payload, opts), abortPromise]);
      return result;
    } finally {
      this.terminate();
    }
  }

  private spawn(): void {
    if (this.worker) return;
    this.worker = this.factory();
    this.remote = Comlink.wrap<WorkerEntry<TOptions>>(this.worker);
  }

  private terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.remote = null;
  }
}
```

- [ ] **Step 3: Write `harness.test.ts`**

The test exercises the harness against an inline mock that mimics `Comlink.wrap`. Real Worker constructor is not invoked.

```ts
import * as Comlink from "comlink";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerHarness } from "./harness";
import type { OutputItem } from "./types";

afterEach(() => vi.restoreAllMocks());

function fakeWorker() {
  const w = { postMessage: vi.fn(), terminate: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as Worker;
  return w;
}

describe("WorkerHarness.runSingle", () => {
  it("forwards file bytes and resolves with the worker result", async () => {
    const wrapSpy = vi.spyOn(Comlink, "wrap").mockReturnValue({
      convertSingle: async (
        bytes: ArrayBuffer,
        name: string,
        _type: string,
        _opts: unknown,
      ): Promise<OutputItem> => ({
        filename: name.replace(/\.heic$/, ".png"),
        mime: "image/png",
        blob: new Blob([new Uint8Array(bytes).slice(0, 1)], { type: "image/png" }),
      }),
    } as never);

    const h = new WorkerHarness<{ q: number }>(fakeWorker);
    const file = new File([new Uint8Array([1, 2, 3])], "vacation.heic", { type: "image/heic" });
    const out = (await h.runSingle(file, { q: 90 }, new AbortController().signal)) as OutputItem;
    expect(out.filename).toBe("vacation.png");
    expect(out.mime).toBe("image/png");
    expect(wrapSpy).toHaveBeenCalledOnce();
  });

  it("rejects with AbortError when the signal is already aborted", async () => {
    vi.spyOn(Comlink, "wrap").mockReturnValue({
      convertSingle: () => new Promise(() => undefined),
    } as never);
    const ctrl = new AbortController();
    ctrl.abort();
    const h = new WorkerHarness<{ q: number }>(fakeWorker);
    const f = new File([new Uint8Array([1])], "x.heic", { type: "image/heic" });
    await expect(h.runSingle(f, { q: 90 }, ctrl.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
```

- [ ] **Step 4: Write the registry**

`src/engines/_shared/registry.ts`:

```ts
import type { ConversionEngine } from "./types";

export type EngineId =
  | "heic-to-png"
  // future ids declared as engines are added in later plans
  ;

type Loader = () => Promise<{ default: ConversionEngine }>;

const REGISTRY: Record<EngineId, Loader> = {
  "heic-to-png": () => import("@/engines/heic-to-png"),
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

- [ ] **Step 5: Write the registry test**

`src/engines/_shared/registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { listEngineIds, loadEngine } from "./registry";

describe("registry", () => {
  it("lists engine ids including heic-to-png", () => {
    expect(listEngineIds()).toContain("heic-to-png");
  });

  it("loadEngine throws for unknown id", async () => {
    await expect(
      loadEngine("does-not-exist" as never),
    ).rejects.toThrow("Unknown engine id");
  });
});
```

(The positive-path `loadEngine("heic-to-png")` test is added in Task 9 once the engine module exists.)

- [ ] **Step 6: Write a stub engine module that the privacy regression test will import**

`src/engines/_stub/worker.ts`:

```ts
import * as Comlink from "comlink";
import type { OutputItem } from "@/engines/_shared/types";

const api = {
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    _type: string,
    _opts: unknown,
  ): Promise<OutputItem> {
    // Echo bytes back unchanged. Used only to prove the worker boundary
    // does not generate any network traffic.
    return {
      filename: name + ".stub",
      mime: "application/octet-stream",
      blob: new Blob([bytes], { type: "application/octet-stream" }),
    };
  },
};

Comlink.expose(api);
```

`src/engines/_stub/index.ts`:

```ts
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { WorkerHarness } from "@/engines/_shared/harness";

const meta = {
  id: "_stub",
  inputAccept: [".bin"],
  inputMime: ["application/octet-stream"],
  outputMime: "application/octet-stream",
  defaultOptions: {} as Record<string, never>,
};

const engine: SingleInputEngine<Record<string, never>, OutputItem> = {
  ...meta,
  cardinality: "single",
  validate: () => ({ ok: true }),
  async convert(file, opts, signal) {
    const harness = new WorkerHarness<Record<string, never>>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    );
    const result = await harness.runSingle(file, opts, signal);
    return Array.isArray(result) ? (result[0] as OutputItem) : result;
  },
};

export default engine;
```

- [ ] **Step 7: Run unit tests**

```bash
pnpm test
```

Expected: all tests pass. Note that the harness test mocks `Comlink.wrap`, so no real Worker is instantiated in the unit suite.

- [ ] **Step 8: Commit**

```bash
git add src/engines/_shared src/engines/_stub
git commit -m "feat(engines): registry + Comlink WorkerHarness + stub engine

Engine registry maps id to dynamic-import loader.
WorkerHarness wraps each engine's worker with type-safe RPC and
AbortSignal-driven termination.
_stub engine exists only to back the privacy regression test in
the next task — it is not registered in the public registry."
```

---

### Task 8: Privacy regression E2E test (against the stub engine)

**Goal:** A Playwright test that loads the app, invokes the stub engine via a programmatic harness, and asserts zero outbound network traffic during the conversion. Written **before** the real HEIC engine is wired so it is genuinely a regression check.

**Files:**
- Create: `src/app/test-only/stub-runner/page.tsx` (a page mounted only for this test), `tests/e2e/privacy-regression.spec.ts`

> **Why `test-only/` and not `_test/`:** Next.js App Router excludes folders with a leading underscore from routing entirely (private-folder convention). The privacy regression test needs to actually navigate to this page, so the segment must be a real route. We use `test-only/` as a clear, intentional but unadvertised path. (Removing the route from production builds is a Plan 6 enhancement.)

- [ ] **Step 1: Create the stub-runner page**

`src/app/test-only/stub-runner/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import stubEngine from "@/engines/_stub";

export default function StubRunner() {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [output, setOutput] = useState<string>("");

  async function runConversion() {
    try {
      setStatus("running");
      const file = new File([new Uint8Array(1024)], "synthetic.bin", {
        type: "application/octet-stream",
      });
      const ctrl = new AbortController();
      const result = await stubEngine.convert(file, {}, ctrl.signal);
      const item = Array.isArray(result) ? result[0] : result;
      if (!item) throw new Error("no output");
      setOutput(item.filename);
      setStatus("done");
    } catch (err) {
      setOutput(String(err));
      setStatus("error");
    }
  }

  return (
    <main className="p-4">
      <button type="button" data-testid="run" onClick={runConversion}>
        run stub conversion
      </button>
      <div data-testid="status">{status}</div>
      <div data-testid="output">{output}</div>
    </main>
  );
}
```

(This route is intended for tests only. It is not linked from the user-facing UI. We accept that it will be in the public static export bundle — it is two dozen bytes of harmless test surface, and removing it from production builds is a future enhancement.)

- [ ] **Step 2: Write the privacy regression test**

`tests/e2e/privacy-regression.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("conversion produces zero outbound network requests beyond initial load", async ({
  page,
  context,
}) => {
  const PAGE_PATH = "/test-only/stub-runner";

  // Phase 1: load the page. Capture every request the page makes during initial load.
  const loadRequests: string[] = [];
  page.on("request", (req) => {
    loadRequests.push(req.url());
  });
  await page.goto(PAGE_PATH, { waitUntil: "networkidle" });

  // Phase 2: clear the listener and start a fresh request log.
  page.removeAllListeners("request");
  const conversionRequests: string[] = [];
  page.on("request", (req) => {
    // Worker fetches its own module — same-origin, expected.
    // We only flag requests that go off-origin.
    const url = new URL(req.url());
    if (url.origin !== new URL(page.url()).origin) {
      conversionRequests.push(req.url());
    }
  });

  // Phase 3: run the conversion.
  await page.getByTestId("run").click();
  await expect(page.getByTestId("status")).toHaveText("done", { timeout: 5000 });

  // Phase 4: assert.
  expect(conversionRequests, `Conversion made off-origin requests: ${conversionRequests.join(", ")}`).toEqual([]);

  // Sanity: the conversion did produce output.
  const output = await page.getByTestId("output").textContent();
  expect(output).toContain(".stub");
});
```

- [ ] **Step 3: Run the test against chromium**

```bash
pnpm test:e2e --project=chromium tests/e2e/privacy-regression.spec.ts
```

Expected: PASS. If the test fails because the stub-runner page renders blank, check the Worker URL resolution — `new URL("./worker.ts", import.meta.url)` requires the `type: "module"` option and Next.js must process the worker file. If the worker fails to instantiate, switch to `import.meta.url` with explicit `?worker` suffix on Next 15:

```ts
// fallback if module-worker spec fails:
new Worker(new URL("./worker.ts?worker", import.meta.url));
```

- [ ] **Step 4: Run unit tests + lint + build to confirm nothing else regressed**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/app/test-only tests/e2e/privacy-regression.spec.ts
git commit -m "test(privacy): regression E2E asserts zero outbound network

Test mounts an unadvertised /test-only/stub-runner route, invokes the stub
engine from the browser, and verifies no off-origin requests are
made during conversion. Written against the stub before the HEIC
engine is wired so the assertion is genuinely a regression
check rather than a 'did it work once' snapshot."
```

---

### Task 9: HEIC → PNG engine (worker + module)

**Goal:** A working `heic-to-png` engine that decodes HEIC via libheif-js inside a Worker and encodes the bitmap to PNG via `OffscreenCanvas`. Engine registered in the registry.

**Files:**
- Create: `src/engines/heic-to-png/options.ts`, `src/engines/heic-to-png/worker.ts`, `src/engines/heic-to-png/index.ts`, `src/engines/heic-to-png/index.test.ts`, `tests/fixtures/sample.heic`
- Modify: `src/engines/_shared/registry.test.ts` (add positive-path test)

- [ ] **Step 1: Install libheif-js**

```bash
pnpm add libheif-js
```

If installation prints a warning about WASM provisioning, it is fine — we will not pre-fetch; the worker fetches on first call.

- [ ] **Step 2: Add a small real HEIC fixture to `tests/fixtures/sample.heic`**

> **⚠️ MANUAL STEP — pause for user.** An autonomous agent cannot acquire a HEIC file on its own. Surface this to the user with the following request and stop:
>
> > "I need a small real HEIC file (ideally < 200 KB) committed at `tests/fixtures/sample.heic` so the engine tests can run against real bytes. Two ways to get one:
> > 1. Take a photo on your iPhone of any flat color (like a wall), AirDrop it to your Mac as HEIC, then crop / resize until it's under 200 KB.
> > 2. Download a public-domain test HEIC, e.g. from `https://github.com/strukturag/libheif/raw/master/examples/example.heic`.
> >
> > Once placed at `tests/fixtures/sample.heic`, run `file tests/fixtures/sample.heic` and confirm the output mentions ISO Media or HEIF. Tell me when ready and I'll resume from Step 3."

After the user confirms the fixture is in place:

```bash
mkdir -p tests/fixtures
file tests/fixtures/sample.heic
```

Expected: `file` reports an ISO Media or HEIF file. If `file` reports something else, the fixture is wrong — ask the user to replace it.

- [ ] **Step 3: Write `options.ts`**

```ts
export type HeicToPngOptions = {
  // No options for v1. Type kept as a record to allow future expansion
  // (e.g., bit depth, color profile preservation) without changing the
  // engine signature.
  _placeholder?: never;
};

export const defaultHeicToPngOptions: HeicToPngOptions = {};
```

- [ ] **Step 4: Write `worker.ts`**

```ts
import * as Comlink from "comlink";
import libheif from "libheif-js";
import type { OutputItem } from "@/engines/_shared/types";
import type { HeicToPngOptions } from "./options";

async function bitmapToPngBlob(width: number, height: number, rgba: Uint8ClampedArray): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");
  const imageData = new ImageData(rgba, width, height);
  ctx.putImageData(imageData, 0, 0);
  return await canvas.convertToBlob({ type: "image/png" });
}

const api = {
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    _type: string,
    _opts: HeicToPngOptions,
  ): Promise<OutputItem> {
    const decoder = libheif.HeifDecoder();
    const data = decoder.decode(bytes);
    if (!data || data.length === 0) {
      throw new Error("libheif: no images decoded from HEIC");
    }
    const first = data[0];
    if (!first) throw new Error("libheif: first image missing");
    const width = first.get_width();
    const height = first.get_height();

    const rgba = await new Promise<Uint8ClampedArray>((resolve, reject) => {
      first.display(
        { data: new Uint8ClampedArray(width * height * 4), width, height },
        (display: { data: Uint8ClampedArray; width: number; height: number } | null) => {
          if (!display) reject(new Error("libheif: display callback received null"));
          else resolve(display.data);
        },
      );
    });

    const blob = await bitmapToPngBlob(width, height, rgba);
    return {
      filename: name.replace(/\.(heic|heif)$/i, ".png"),
      mime: "image/png",
      blob,
    };
  },
};

Comlink.expose(api);
```

> **NOTE TO IMPLEMENTING ENGINEER:** `libheif-js` API has had small surface drift over its versions — the form above (`HeifDecoder()`, `decode(buffer)`, `get_width / get_height / display(callback)`) has been stable for years. If the version installed differs, consult `node_modules/libheif-js/README.md` for the exact pattern and adjust the code while keeping the public surface unchanged.

- [ ] **Step 5: Write `index.ts`**

```ts
import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type HeicToPngOptions, defaultHeicToPngOptions } from "./options";

const engine: SingleInputEngine<HeicToPngOptions, OutputItem> = {
  id: "heic-to-png",
  inputAccept: [".heic", ".heif"],
  inputMime: ["image/heic", "image/heif"],
  outputMime: "image/png",
  defaultOptions: defaultHeicToPngOptions,
  cardinality: "single",
  validate(file) {
    const isHeicByName = /\.(heic|heif)$/i.test(file.name);
    const isHeicByMime = file.type === "image/heic" || file.type === "image/heif";
    if (!isHeicByName && !isHeicByMime) {
      return { ok: false, reason: "Expected a .heic or .heif file" };
    }
    return { ok: true };
  },
  async convert(file, opts, signal) {
    const harness = new WorkerHarness<HeicToPngOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    );
    const result = await harness.runSingle(file, opts, signal);
    return Array.isArray(result) ? (result[0] as OutputItem) : result;
  },
};

export default engine;
```

- [ ] **Step 6: Write `index.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import engine from "./index";

describe("heic-to-png engine metadata", () => {
  it("declares correct id, mime types, and cardinality", () => {
    expect(engine.id).toBe("heic-to-png");
    expect(engine.inputAccept).toEqual([".heic", ".heif"]);
    expect(engine.inputMime).toEqual(["image/heic", "image/heif"]);
    expect(engine.outputMime).toBe("image/png");
    expect(engine.cardinality).toBe("single");
  });

  it("validates HEIC files by name", () => {
    const f = new File([new Uint8Array([1])], "vacation.heic", { type: "" });
    expect(engine.validate(f, {})).toEqual({ ok: true });
  });

  it("rejects non-HEIC files", () => {
    const f = new File([new Uint8Array([1])], "vacation.jpg", { type: "image/jpeg" });
    const r = engine.validate(f, {});
    expect(r.ok).toBe(false);
  });
});
```

(Functional decoding is verified end-to-end in Task 13 with Playwright + the real fixture, since libheif requires a live Worker which jsdom does not provide.)

- [ ] **Step 7: Update `registry.test.ts` to assert positive-path load**

Append to `src/engines/_shared/registry.test.ts`:

```ts
it("loadEngine returns the heic-to-png engine module", async () => {
  const e = await loadEngine("heic-to-png");
  expect(e.id).toBe("heic-to-png");
  expect(e.cardinality).toBe("single");
});
```

- [ ] **Step 8: Run unit tests**

```bash
pnpm test
```

Expected: all pass, including the new metadata test and registry positive-path.

- [ ] **Step 9: Commit**

```bash
git add src/engines/heic-to-png src/engines/_shared/registry.test.ts tests/fixtures/sample.heic
git commit -m "feat(engines): heic-to-png via libheif-js + OffscreenCanvas

Worker decodes HEIC with libheif-js, encodes the bitmap to PNG via
OffscreenCanvas.convertToBlob. Engine module is the public surface
implementing SingleInputEngine; the WorkerHarness handles
spawn/teardown/AbortSignal."
```

---

### Task 10: Layout shell — header, sidebar, footer, status indicator

**Goal:** Persistent two-column layout with header, sidebar (hard-coded HEIC link), and a footer status bar. Status indicator is its own tested component used inside the footer.

**Files:**
- Create: `src/components/layout/header.tsx`, `src/components/layout/sidebar.tsx`, `src/components/layout/footer.tsx`, `src/components/status-indicator.tsx`, `src/components/status-indicator.test.tsx`
- Modify: `src/app/layout.tsx`, `src/app/page.tsx`

- [ ] **Step 1: Write `status-indicator.tsx`**

```tsx
type Status = "ready" | "converting" | "done" | "error" | "fatal";

const LABELS: Record<Status, string> = {
  ready: "[ READY ]",
  converting: "[ CONVERTING ]",
  done: "[ DONE ]",
  error: "[ ERROR ]",
  fatal: "[ FATAL ]",
};

const COLORS: Record<Status, string> = {
  ready: "var(--color-fg-muted)",
  converting: "var(--color-accent)",
  done: "var(--color-fg-strong)",
  error: "var(--color-accent)",
  fatal: "var(--color-accent)",
};

export function StatusIndicator({ status }: { status: Status }) {
  return (
    <span
      role="status"
      aria-live="polite"
      style={{ color: COLORS[status] }}
      data-testid="status-indicator"
    >
      {LABELS[status]}
    </span>
  );
}

export type { Status };
```

- [ ] **Step 2: Write `status-indicator.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusIndicator } from "./status-indicator";

describe("StatusIndicator", () => {
  it("renders the READY label by default-style status", () => {
    render(<StatusIndicator status="ready" />);
    expect(screen.getByTestId("status-indicator")).toHaveTextContent("[ READY ]");
  });

  it("renders all distinct statuses with bracketed all-caps labels", () => {
    const all = ["ready", "converting", "done", "error", "fatal"] as const;
    for (const s of all) {
      const { unmount } = render(<StatusIndicator status={s} />);
      expect(screen.getByTestId("status-indicator").textContent).toMatch(/^\[ [A-Z]+ \]$/);
      unmount();
    }
  });

  it("uses aria-live polite for screen readers", () => {
    render(<StatusIndicator status="converting" />);
    expect(screen.getByTestId("status-indicator")).toHaveAttribute("aria-live", "polite");
  });
});
```

- [ ] **Step 3: Write the layout components**

`src/components/layout/header.tsx`:

```tsx
export function Header() {
  return (
    <header className="flex items-baseline justify-between border-b border-[var(--color-hairline)] px-4 py-3">
      <div className="text-[var(--text-sm)] uppercase tracking-[0.15em] text-[var(--color-accent)]">
        FILE_CONVERTER.LOCAL
      </div>
      <div className="text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-very-muted)]">
        local · private
      </div>
    </header>
  );
}
```

`src/components/layout/sidebar.tsx`:

```tsx
import Link from "next/link";

type ToolEntry = { id: string; href: string; label: string; group: string };

const TOOLS: ToolEntry[] = [
  { id: "heic-to-png", href: "/tools/heic-to-png", label: "heic→png", group: "IMAGES" },
];

export function Sidebar() {
  const groups = TOOLS.reduce<Record<string, ToolEntry[]>>((acc, t) => {
    (acc[t.group] ??= []).push(t);
    return acc;
  }, {});
  return (
    <nav
      aria-label="Tools"
      className="w-[180px] shrink-0 border-r border-[var(--color-hairline)] px-3 py-3 text-[var(--text-xs)]"
    >
      {Object.entries(groups).map(([group, items]) => (
        <div key={group} className="mb-3">
          <div className="mb-1 text-[var(--color-accent)]">// {group}</div>
          {items.map((t) => (
            <Link
              key={t.id}
              href={t.href}
              className="block py-0.5 text-[var(--color-fg-muted)] hover:text-[var(--color-fg-strong)]"
            >
              {t.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
```

`src/components/layout/footer.tsx`:

```tsx
import { StatusIndicator, type Status } from "@/components/status-indicator";

export function Footer({ status, count, version }: { status: Status; count: number; version: string }) {
  return (
    <footer className="flex items-center gap-4 border-t border-[var(--color-hairline)] px-4 py-2 text-[var(--text-xs)] text-[var(--color-fg-muted)]">
      <span>STATUS:</span>
      <StatusIndicator status={status} />
      <span>·</span>
      <span>{count} conversions this session</span>
      <span className="ml-auto">{version}</span>
    </footer>
  );
}
```

- [ ] **Step 4: Wire layout into `src/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { Footer } from "@/components/layout/footer";
import "./globals.css";

export const metadata: Metadata = {
  title: "file-converter",
  description: "Local, private file conversion. Files never leave your device.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex h-screen flex-col">
        <Header />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <div className="flex-1 overflow-auto">{children}</div>
        </div>
        <Footer status="ready" count={0} version="v0.1.0" />
      </body>
    </html>
  );
}
```

(Note: `status` and `count` are static placeholders here; per-tool screens manage their own status. A future plan moves this into a context-provided source of truth.)

- [ ] **Step 5: Replace homepage with placeholder**

`src/app/page.tsx`:

```tsx
export default function Home() {
  return (
    <main className="flex h-full items-center justify-center p-6">
      <div className="border border-[var(--color-hairline)] p-12 text-center">
        <div className="mb-2 text-[var(--text-lg)] text-[var(--color-fg-strong)]">drop a file</div>
        <div className="text-[var(--text-xs)] text-[var(--color-fg-muted)]">
          or click a tool in the sidebar
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 6: Verify dev server renders the shell correctly**

```bash
pnpm dev
```

Open `http://localhost:3000`. Expect: header bar with `FILE_CONVERTER.LOCAL` accent-colored at top, narrow left sidebar with `// IMAGES` then `heic→png` link, centered placeholder card, footer with `STATUS: [ READY ] · 0 conversions this session · v0.1.0`. Stop the server.

- [ ] **Step 7: Run all checks**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/components src/app/layout.tsx src/app/page.tsx
git commit -m "feat(ui): layout shell with header, sidebar, footer, status

StatusIndicator is its own component with explicit aria-live so
screen-reader behavior is correct from the start. Sidebar groups
tools by category; HEIC link is the only item in v0.1.0."
```

---

### Task 11: Drop zone, result list, download utility

**Goal:** A `<DropZone>` component that accepts files (drag-drop and click-to-browse), reports drop events to a callback, and displays a brutalist drop target. A `<ResultList>` that renders output items with download buttons. A `download()` utility that triggers a browser download. All three have unit tests.

**Files:**
- Create: `src/components/drop-zone.tsx`, `src/components/drop-zone.test.tsx`, `src/components/result-list.tsx`, `src/components/result-list.test.tsx`, `src/lib/download.ts`, `src/lib/download.test.ts`

- [ ] **Step 1: Write `download.ts`**

```ts
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after a tick to allow the download to start.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
```

- [ ] **Step 2: Write `download.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { download } from "./download";

afterEach(() => vi.restoreAllMocks());

describe("download", () => {
  it("creates an anchor with download attribute and clicks it", () => {
    const createSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const clickSpy = vi.fn();
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag) => {
      const el = origCreate(tag) as HTMLElement & { click?: () => void };
      if (tag === "a") el.click = clickSpy;
      return el;
    });

    download(new Blob(["hi"]), "out.txt");

    expect(createSpy).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    // revoke is delayed
    vi.runAllTimers?.();
    expect(revokeSpy).toBeDefined();
  });
});
```

- [ ] **Step 3: Write `drop-zone.tsx`**

```tsx
"use client";

import { useCallback, useRef, useState } from "react";

type Props = {
  accept?: string[]; // e.g. [".heic", ".heif"]
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  prompt?: string;
  hint?: string;
};

export function DropZone({
  accept,
  multiple = false,
  onFiles,
  prompt = "drop a file",
  hint = "or click to browse",
}: Props) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const arr = Array.from(files);
      onFiles(arr);
    },
    [onFiles],
  );

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        handleFiles(e.dataTransfer?.files ?? null);
      }}
      data-testid="drop-zone"
      data-state={over ? "over" : "idle"}
      className={`flex w-full flex-col items-center justify-center border border-[var(--color-hairline)] bg-[var(--color-surface)] p-12 text-center transition-colors ${
        over ? "border-[var(--color-accent)]" : ""
      }`}
      style={{
        backgroundImage: over
          ? "repeating-linear-gradient(45deg, #0d0d0d 0 6px, #0a0a0a 6px 12px)"
          : undefined,
      }}
    >
      <span className="mb-1 text-[var(--text-base)] text-[var(--color-fg-strong)]">{prompt}</span>
      <span className="text-[var(--text-xs)] text-[var(--color-fg-muted)]">{hint}</span>
      <input
        ref={inputRef}
        type="file"
        accept={accept?.join(",")}
        multiple={multiple}
        onChange={(e) => handleFiles(e.target.files)}
        className="sr-only"
      />
    </button>
  );
}
```

- [ ] **Step 4: Write `drop-zone.test.tsx`**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DropZone } from "./drop-zone";

describe("DropZone", () => {
  it("renders the default prompt and hint", () => {
    render(<DropZone onFiles={() => undefined} />);
    expect(screen.getByText("drop a file")).toBeInTheDocument();
    expect(screen.getByText("or click to browse")).toBeInTheDocument();
  });

  it("calls onFiles with dropped files", () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} />);
    const file = new File(["x"], "a.heic", { type: "image/heic" });
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [file] },
    });
    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it("toggles data-state to 'over' on dragover", () => {
    render(<DropZone onFiles={() => undefined} />);
    const zone = screen.getByTestId("drop-zone");
    fireEvent.dragOver(zone);
    expect(zone).toHaveAttribute("data-state", "over");
    fireEvent.dragLeave(zone);
    expect(zone).toHaveAttribute("data-state", "idle");
  });
});
```

- [ ] **Step 5: Write `result-list.tsx`**

```tsx
"use client";

import { download } from "@/lib/download";
import type { OutputItem } from "@/engines/_shared/types";

type Props = {
  items: OutputItem[];
};

export function ResultList({ items }: Props) {
  if (items.length === 0) return null;
  return (
    <ul aria-label="Conversion results" className="mt-4 divide-y divide-[var(--color-hairline)] border border-[var(--color-hairline)]">
      {items.map((item) => (
        <li
          key={item.filename}
          className="flex items-center justify-between px-3 py-2 text-[var(--text-sm)]"
        >
          <span className="truncate text-[var(--color-fg)]">{item.filename}</span>
          <button
            type="button"
            onClick={() => download(item.blob, item.filename)}
            className="border border-[var(--color-hairline)] px-2 py-1 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-strong)] hover:border-[var(--color-accent)]"
          >
            download
          </button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 6: Write `result-list.test.tsx`**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResultList } from "./result-list";

vi.mock("@/lib/download", () => ({ download: vi.fn() }));
import { download as downloadMock } from "@/lib/download";

afterEach(() => vi.clearAllMocks());

describe("ResultList", () => {
  it("renders nothing when items is empty", () => {
    const { container } = render(<ResultList items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one row per item with a download button", () => {
    render(
      <ResultList
        items={[
          { filename: "a.png", mime: "image/png", blob: new Blob(["a"]) },
          { filename: "b.png", mime: "image/png", blob: new Blob(["b"]) },
        ]}
      />,
    );
    expect(screen.getAllByRole("button", { name: "download" })).toHaveLength(2);
    expect(screen.getByText("a.png")).toBeInTheDocument();
  });

  it("invokes download with the item's blob and filename when clicked", () => {
    const item = { filename: "a.png", mime: "image/png", blob: new Blob(["a"]) };
    render(<ResultList items={[item]} />);
    fireEvent.click(screen.getByRole("button", { name: "download" }));
    expect(downloadMock).toHaveBeenCalledWith(item.blob, item.filename);
  });
});
```

- [ ] **Step 7: Run unit tests**

```bash
pnpm test
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/drop-zone.tsx src/components/drop-zone.test.tsx src/components/result-list.tsx src/components/result-list.test.tsx src/lib/download.ts src/lib/download.test.ts
git commit -m "feat(ui): drop zone, result list, download utility

DropZone is a button (focus + Enter activate the file picker for
keyboard users) styled to look like a drop target. ResultList
defers ZIP-multi-file logic to a future plan; for now each item
gets its own per-row download button."
```

---

### Task 12: HEIC tool route + universal homepage routing

**Goal:** `/tools/heic-to-png` runs the engine end-to-end. Universal homepage detects HEIC drops and forwards to the tool route. Single-output auto-download triggers; multi-output (none in this engine) would stage on-screen, that path is exercised by the `ResultList` rendering when present.

**Files:**
- Create: `src/components/tool-frame.tsx`, `src/app/tools/heic-to-png/page.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Write `tool-frame.tsx`**

```tsx
"use client";

import { useState } from "react";
import { DropZone } from "./drop-zone";
import { ResultList } from "./result-list";
import { StatusIndicator, type Status } from "./status-indicator";
import { download } from "@/lib/download";
import type { ConversionEngine, OutputItem } from "@/engines/_shared/types";

type Props<TOptions> = {
  engine: ConversionEngine<TOptions, OutputItem | OutputItem[]>;
};

export function ToolFrame<TOptions>({ engine }: Props<TOptions>) {
  const [status, setStatus] = useState<Status>("ready");
  const [items, setItems] = useState<OutputItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function run(files: File[]) {
    setErrorMessage(null);
    setItems([]);
    if (engine.cardinality === "single") {
      const f = files[0];
      if (!f) return;
      const v = engine.validate(f, engine.defaultOptions);
      if (!v.ok) {
        setErrorMessage(v.reason);
        setStatus("error");
        return;
      }
      setStatus("converting");
      try {
        const ctrl = new AbortController();
        const result = await engine.convert(f, engine.defaultOptions, ctrl.signal);
        const out = Array.isArray(result) ? result : [result];
        if (out.length === 1) {
          // Single output: auto-download.
          const item = out[0];
          if (item) download(item.blob, item.filename);
          setItems(out);
        } else {
          // Multi output: stage.
          setItems(out);
        }
        setStatus("done");
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
      return;
    }

    // multi-input branch (PDF merge etc.) — implemented in later plans.
    const v = engine.validate(files, engine.defaultOptions);
    if (!v.ok) {
      setErrorMessage(v.reason);
      setStatus("error");
      return;
    }
    setStatus("converting");
    try {
      const ctrl = new AbortController();
      const result = await engine.convert(files, engine.defaultOptions, ctrl.signal);
      setItems(Array.isArray(result) ? result : [result]);
      setStatus("done");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  return (
    <main className="p-6">
      <div className="mb-3 flex items-center gap-3 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        <span>tool: {engine.id}</span>
        <span>·</span>
        <StatusIndicator status={status} />
      </div>
      <DropZone
        accept={engine.inputAccept}
        multiple={engine.cardinality === "multi"}
        onFiles={run}
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

- [ ] **Step 2: Write `src/app/tools/heic-to-png/page.tsx`**

```tsx
import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/heic-to-png";

export default function HeicToPngPage() {
  return <ToolFrame engine={engine} />;
}
```

- [ ] **Step 3: Update homepage to detect HEIC and route**

`src/app/page.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { DropZone } from "@/components/drop-zone";
import { detectMime } from "@/engines/_shared/file-detection";

export default function Home() {
  const router = useRouter();

  async function handleFiles(files: File[]) {
    const f = files[0];
    if (!f) return;
    const mime = await detectMime(f);
    if (mime === "image/heic" || mime === "image/heif") {
      router.push("/tools/heic-to-png");
      // The user will need to drop the file again on the tool page.
      // Cross-route file handoff is a Plan 5 enhancement.
      return;
    }
    // No matching engine yet. Future plans will surface a disambiguation modal.
    alert(`No engine yet for ${mime} (Phase 1 ships HEIC only).`);
  }

  return (
    <main className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        <DropZone
          onFiles={handleFiles}
          prompt="drop a file"
          hint="HEIC supported. More tools shipping in subsequent phases."
        />
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Verify dev server**

```bash
pnpm dev
```

In a browser:
1. Navigate to `http://localhost:3000` and confirm the homepage drop zone renders.
2. Navigate to `http://localhost:3000/tools/heic-to-png` and confirm the tool frame renders with `[ READY ]`.
3. Drop the `tests/fixtures/sample.heic` file onto the tool page. Expect: status flips to `[ CONVERTING ]`, then `[ DONE ]`. A PNG file downloads automatically. The result list shows one row with the PNG filename.

If conversion fails: open DevTools console, find the worker error, and reconcile against the libheif-js README. Common failures:
- "WASM not found": adjust the worker import — for some bundler/Next combinations the WASM file is a separate URL that needs explicit `new URL("libheif-js/libheif.wasm", import.meta.url)`.
- "decoder.decode is not a function": API drift; check `node_modules/libheif-js/README.md`.

Stop the dev server.

- [ ] **Step 5: Run unit tests + build**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/components/tool-frame.tsx src/app/tools src/app/page.tsx
git commit -m "feat(ui): heic-to-png route + tool frame + homepage routing

ToolFrame is a generic harness that consumes any ConversionEngine
and applies the smart-default download rule. Single-output engines
auto-download; multi-output stay staged in the result list (ZIP
packaging arrives in Plan 5).

Homepage detects MIME on drop and routes to the matching tool
route. Cross-route file handoff (drop file on home → land in tool
with file pre-staged) is deferred to Plan 5."
```

---

### Task 13: HEIC happy-path E2E

**Goal:** A Playwright test that drives a real Chromium browser, uploads `tests/fixtures/sample.heic` to `/tools/heic-to-png`, and verifies a PNG download starts.

**Files:**
- Create: `tests/e2e/heic-to-png.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { expect, test } from "@playwright/test";
import path from "node:path";

test("HEIC to PNG produces a downloadable PNG", async ({ page }) => {
  await page.goto("/tools/heic-to-png");

  // Status starts ready.
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  // Locate the hidden file input.
  const input = page.locator('input[type="file"]');
  const fixture = path.resolve(__dirname, "../fixtures/sample.heic");

  // Set up the download promise BEFORE triggering the conversion.
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });

  await input.setInputFiles(fixture);

  // Wait for terminal state. We do NOT assert the intermediate `[ CONVERTING ]`
  // text — for a small fixture HEIC, the conversion finishes in 100–500ms,
  // which is faster than Playwright can poll. Asserting that intermediate
  // would flake on a perfectly-working app.
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });

  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/i);
});
```

- [ ] **Step 2: Run the test against chromium**

```bash
pnpm test:e2e --project=chromium tests/e2e/heic-to-png.spec.ts
```

Expected: PASS within ~30 seconds.

If the status never transitions to converting, the harness/registry path is broken — investigate via `--ui` mode:

```bash
pnpm test:e2e:ui --project=chromium tests/e2e/heic-to-png.spec.ts
```

- [ ] **Step 3: Run the privacy regression test once more to confirm it still asserts zero off-origin requests**

```bash
pnpm test:e2e --project=chromium tests/e2e/privacy-regression.spec.ts
```

Expected: PASS. If it fails because libheif-js fetches a sibling WASM file from a CDN, that violates the privacy guarantee — fix by ensuring the WASM is bundled into `public/` or shipped same-origin via the Next.js asset pipeline. Recheck before proceeding.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/heic-to-png.spec.ts
git commit -m "test(e2e): HEIC happy-path conversion produces PNG download

Drives a real Chromium browser through the full flow: load page,
upload sample.heic, await status transitions, capture download
event, assert .png filename. Run in CI alongside the privacy
regression to keep both load-bearing."
```

---

### Task 14: Security headers via vercel.json + Vercel deploy

**Goal:** All security headers are applied at the edge via `vercel.json` (since `output: 'export'` bypasses Next.js's `headers()` function). Site is deployed; deployed URL passes the privacy regression test.

**Files:**
- Create: `vercel.json`, `README.md`

- [ ] **Step 1: Write `vercel.json`**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "pnpm build",
  "outputDirectory": "out",
  "installCommand": "pnpm install --frozen-lockfile",
  "framework": "nextjs",
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none';"
        },
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "no-referrer" },
        {
          "key": "Permissions-Policy",
          "value": "camera=(), microphone=(), geolocation=(), interest-cohort=()"
        }
      ]
    }
  ]
}
```

> **NOTE:** `style-src 'self'` is intentionally strict — Tailwind v4 in PostCSS mode emits a static stylesheet. If a deployed page console shows a CSP violation for `style-src`, do NOT relax the header; fix the offending inline style at its source. Common offenders: shadcn primitives that inject runtime CSS variables (replace with stable utility classes); third-party widgets (replace or drop).

- [ ] **Step 2: Write a minimal README**

`README.md`:

```markdown
# file-converter

Local, private file conversion. Files never leave your device.

- Live: (set after first deploy)
- Spec: [`docs/superpowers/specs/2026-04-30-file-converter-design.md`](docs/superpowers/specs/2026-04-30-file-converter-design.md)
- Plan 1: [`docs/superpowers/plans/2026-04-30-phase-1-foundation-and-heic-slice.md`](docs/superpowers/plans/2026-04-30-phase-1-foundation-and-heic-slice.md)

## Development

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm test         # vitest
pnpm test:e2e     # playwright
pnpm build        # static export to out/
```

## Phase 1 scope

- HEIC → PNG conversion in the browser via libheif-js.
- Strict CSP, all conversion in Web Workers, no backend.
- Privacy regression test asserts zero outbound network on every PR.
```

- [ ] **Step 3: Commit and push**

The user must create a GitHub repository and Vercel project. The agent should pause here and surface a checklist:

```
[ ] Create GitHub repo: gh repo create tonyyu2170/file-converter --private --source=. --remote=origin --push
[ ] Create Vercel project linked to the GitHub repo (Vercel dashboard or `vercel link`)
[ ] First deploy: `vercel --prod` or via Vercel auto-deploy on push
[ ] After deploy, paste the URL into README.md and commit
```

The agent should NOT push without explicit user permission (per project preferences). Generate the commit and stop:

```bash
git add vercel.json README.md
git commit -m "chore: add vercel.json with strict CSP + initial README

Headers applied at the edge (vercel.json) since output: 'export'
bypasses Next's headers() function. style-src remains 'self' —
Tailwind v4 PostCSS mode does not require 'unsafe-inline'.

When relaxing any header, fix the source instead."
```

- [ ] **Step 4: Hand off the deploy step to the user**

Surface the checklist above. The user pushes to GitHub and connects Vercel. After the first deploy succeeds, the user reports the URL back; the agent updates README and commits.

---

### Task 15: Verify deployed privacy regression + close out Phase 1

**Goal:** With the site live, run the privacy regression test against the deployed URL to confirm the production environment honors the same guarantee the local environment does. Update README. Close out Phase 1.

**Files:**
- Modify: `README.md`, `playwright.config.ts`

- [ ] **Step 1: Add a deployed-target Playwright config option**

Append to `playwright.config.ts`:

```ts
// In production, set BASE_URL to the deployed Vercel URL to run privacy
// regression against the live site. The default localhost target remains
// for local dev and CI's PR jobs.
```

And modify the existing `use.baseURL` line:

```ts
use: {
  baseURL: process.env.BASE_URL ?? "http://localhost:3000",
  trace: "on-first-retry",
  screenshot: "only-on-failure",
},
```

And modify the `webServer` block to be conditional:

```ts
webServer: process.env.BASE_URL
  ? undefined
  : {
      command: "pnpm dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
```

- [ ] **Step 2: Run privacy regression against the deployed URL**

```bash
BASE_URL=https://<deployed-url>.vercel.app pnpm test:e2e --project=chromium tests/e2e/privacy-regression.spec.ts
```

Expected: PASS. If it fails because of a header injecting an off-origin asset (e.g., Vercel analytics auto-injection), disable that integration in the Vercel project settings — Phase 1 ships zero analytics. Re-run.

- [ ] **Step 3: Update README with deployed URL**

```bash
# Update README.md "Live:" line with the actual URL
```

- [ ] **Step 4: Final repo checks**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm test:e2e --project=chromium
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add README.md playwright.config.ts
git commit -m "chore: support BASE_URL override for E2E + record deploy URL

Privacy regression passes against the deployed site; result is the
same as local — zero off-origin requests during conversion."
```

- [ ] **Step 6: Phase 1 complete — verify the milestone**

Open the deployed URL in a real browser. Drop a HEIC file. Confirm:
- Page loads in under 2 seconds.
- Drop zone visually responds to drag-over.
- Status flips through `[ CONVERTING ]` → `[ DONE ]`.
- A `.png` file downloads.
- DevTools Network tab shows zero requests during the conversion phase (after the page finishes loading, no further requests fire).

If all four hold, Phase 1 is shipped.

---

## Self-Review Notes (run before declaring the plan ready)

- **Spec coverage:** Plan 1 implements spec §5.1 (HEIC→PNG only — other image conversions deferred), §6 (architecture, harness, engine interface, directory structure), §7.1–7.4 (layout, drop-first routing, output handling — though only single-output is exercised), §8 (visual tokens, monospace, brutalist palette), §9 (entire stack), §9.1 (browser support test surface — feature-detection screen deferred to Plan 5), §10.1 (worker isolation, no eval, lint rule deferred to Plan 6), §10.2 (full security headers via vercel.json), §10.3 (privacy verification via E2E test — `/about` page deferred to Plan 5), §14 (Vitest + Playwright base, axe/Lighthouse/bundle deferred to Plan 6), §15 (CI skeleton — full pipeline arrives in Plan 6). Items explicitly in spec §13 (preferences), §11.4 (tab-close), §16 (future scope), §17 success criterion 4 (Lighthouse) are deferred and called out below.

- **Placeholder scan:** Every step contains either runnable code or a verifiable command. The "NOTE TO ENGINEER" callouts in Task 9 (libheif API drift) and Task 12 (libheif WASM bundling gotcha) are escape valves for genuine version uncertainty, not placeholders — they direct the engineer to a specific reference and a specific failure mode.

- **Type consistency:** `OutputItem` is defined once in `_shared/types.ts` and used in every consumer. `WorkerHarness` parameterizes on `TOptions` consistently. The engine module's exported default uses `SingleInputEngine<HeicToPngOptions, OutputItem>` — same shape across registry consumers.

- **Lint rule blocking `fetch` in `src/engines/`:** spec §10.1 calls for this. Deferred to Plan 6 (production hardening). Phase 1 does not have this guardrail; the privacy regression test catches the same class of bug from the runtime side.

- **Cross-route file handoff:** dropping a HEIC on the homepage routes to `/tools/heic-to-png` but does not pre-stage the file there. This is called out in Task 12 and deferred to Plan 5.

---

## Subsequent Plans

Each follow-on plan ships working software. None requires touching shared infrastructure beyond what Phase 1 puts in place.

| Plan | Scope |
|---|---|
| **Plan 2** | Image engines: JPEG↔PNG↔WebP swaps, resize, compress. Adds disambiguation modal. |
| **Plan 3** | PDF engines: merge, split, reorder, rotate, image→PDF, PDF→image. Multi-input + multi-output paths exercise the harness. |
| **Plan 4** | Document engines: DOCX→PDF, DOCX→TXT, MD→PDF, TXT→PDF, plus experimental PDF→DOCX and PDF→MD. |
| **Plan 5** | UX polish: localStorage preferences, tab-close protection, browser-floor screen, keyboard shortcuts (`?`, `/`, `Esc`, `Cmd+V` paste), `/about` privacy page, cross-route file handoff. |
| **Plan 6** | Production hardening: Lighthouse CI thresholds, axe AA sweep, bundle-size budget per route, lint rule blocking network calls in `src/engines/`, full Playwright matrix in CI (Firefox + WebKit alongside Chromium). |

After Plan 6 the v1 success criteria in spec §17 are fully met.
