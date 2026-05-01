# file-converter — Design / PRD

**Status:** Draft, pending user review
**Date:** 2026-04-30
**Owner:** asm.hwang@gmail.com (single user)
**Repo:** `/Users/turdy/coding_fun/projects/file_converter`

---

## 1. Problem statement

Common file conversions (HEIC→PNG, PDF merging, DOCX→PDF, etc.) typically require uploading personal documents to ad-supported third-party websites of unknown provenance. This creates an unnecessary privacy exposure for routine tasks. The user (a single technical operator) wants a website they own, deployed publicly, that performs these conversions entirely client-side so no file ever leaves their device.

## 2. Goals

- Perform common file conversions entirely in the browser. Files never traverse the network.
- Deploy as a static site to Vercel — privacy guarantee survives even if the site is publicly reachable.
- Production-grade quality: TypeScript strict, security headers, accessibility, error handling, tests.
- Distinctive industrial / terminal aesthetic — the site should feel intentional and ownable, not generic.
- Modular conversion engine architecture so post-v1 additions (audio, video, archives, data) plug in cleanly without touching shared code.

## 3. Non-goals (v1)

- Mobile / responsive layouts. Desktop only.
- Backend file processing of any kind.
- Multi-user features: auth, sharing, accounts, quotas, sync.
- File-content history. Only user preferences are persisted.
- Audio, video, archive, and data conversions — deferred to future scope.
- PWA / offline-mode / "Add to Home Screen" — deferred.

## 4. Primary user

Single technical user, the project owner. Implications:
- No multi-tenant logic, no auth.
- No telemetry or analytics by default.
- Power-user UX (keyboard shortcuts, terminal aesthetic, dense info) is appropriate.
- "Production-grade" means typed/tested/secure, not "hardened against adversarial misuse at scale."

## 5. Functional requirements (v1 conversion catalog)

### 5.1 Images

| Operation | Direction | Notes |
|---|---|---|
| HEIC/HEIF → JPEG / PNG / WebP | one-way | Optional metadata strip |
| JPEG ↔ PNG ↔ WebP | round-trip | Configurable quality (encoder-specific) |
| Resize | n/a | Pixel or % input; aspect-ratio-lock toggle |
| Compress | n/a | Quality slider; preview file-size estimate |

### 5.2 PDFs

| Operation | Notes |
|---|---|
| Merge multiple PDFs | Reorder via drag before merge |
| Split PDF | By page range expressions (`1-3, 5, 7-`) |
| Reorder pages | Visual page tray with drag handles |
| Rotate pages | 90° / 180° / 270°; per-page or all |
| Image → PDF | Multi-image to single PDF; page size + orientation options |
| PDF → image (per page) | PNG / JPEG output; resolution selector |

### 5.3 Documents

| Operation | Quality bar |
|---|---|
| DOCX → PDF | Standard quality (mammoth → HTML → pdf-lib) |
| DOCX → TXT | Plain text extract |
| Markdown → PDF | Styled output |
| TXT → PDF | Monospace default |
| **PDF → DOCX** | **Best-effort, labeled "experimental" in UI** |
| **PDF → Markdown** | **Best-effort, labeled "experimental" in UI** |

The "experimental" label sets honest expectations on the lossy reverse-conversions and prevents user surprise about layout fidelity loss.

### 5.4 User stories (representative)

- *As the user, I want to drop a HEIC photo and immediately get a PNG download with no extra clicks.*
- *As the user, I want to drag five PDFs into the page, reorder them visually, and merge them into one file.*
- *As the user, I want to convert a DOCX résumé to PDF without losing styling.*
- *As the user, I want to know — visibly and verifiably — that no file I drop has been uploaded anywhere.*
- *As the user, I want the app to remember that I prefer 90% JPEG quality without re-asking every time.*
- *As the user, I want the experimental PDF→DOCX path to work when it can, and tell me clearly when it can't.*

## 6. Architecture

### 6.1 High-level

```
Browser (entire app runs here)
├── Next.js 15+ App Router (static export → out/)
│   ├── /              → universal drop zone + tool sidebar
│   ├── /tools/[tool]  → focused tool pages (deep-linkable)
│   └── /about         → privacy claim + how it works (network-panel proof)
│
├── Conversion engines (lazy-loaded per tool, never eagerly bundled)
│   ├── Images:    libheif-js + Canvas/createImageBitmap encoders
│   ├── PDF:       pdf-lib (manipulation), pdf.js (preview rendering)
│   ├── Documents: mammoth.js (DOCX read), markdown-it, pdf-lib (PDF write),
│   │              docx (DOCX write), pdf.js text-extraction (PDF→DOCX/MD)
│   └── ZIP:       client-zip (streaming, low-memory)
│
├── State (in-memory only during session)
│   └── React state per tool; zustand only if a global concern emerges
│
└── Persistence (localStorage only — preferences, never file content)

Vercel (static host)
├── Static files (HTML/JS/CSS/WASM) served from edge
├── Security headers via next.config (CSP, HSTS, etc.)
└── No serverless functions in v1
```

### 6.2 Architectural commitments

1. **Static export.** Next.js builds to `out/` and Vercel serves it as a pure static site. No serverless runtime in the conversion path means it is structurally impossible to accidentally route a file through a server.
2. **Lazy-load heavy dependencies.** Conversion libraries (libheif, pdf-lib, mammoth, docx, eventually ffmpeg) are dynamic-imported inside the tool that uses them. The homepage stays light.
3. **Web Workers for conversions.** All conversion work runs in dedicated Web Workers via Comlink-typed RPC. Main thread stays responsive; large files cannot freeze the tab.
4. **Uniform engine interface.** Every conversion module exposes `convert(input: File | File[], options): Promise<Output | Output[]>`. Adding new engines is additive.

### 6.3 Engine interface (sketch)

Two engine shapes — single-input (HEIC→PNG, DOCX→PDF, etc.) and multi-input (PDF merge, image-to-PDF). The shape is encoded so the harness can adapt the UI and avoid leaking branching logic into engine code.

```typescript
type EngineMeta<TOptions> = {
  id: string;                              // "heic-to-png"
  inputAccept: string[];                   // [".heic", ".heif"]   — for <input accept>
  inputMime: string[];                     // ["image/heic", ...]  — for runtime detection
  outputMime: string;                      // "image/png"
  defaultOptions: TOptions;
};

type SingleInputEngine<TOptions, TOutput> = EngineMeta<TOptions> & {
  cardinality: 'single';
  validate(file: File, opts: TOptions): ValidationResult;
  convert(file: File, opts: TOptions, signal: AbortSignal): Promise<TOutput>;
};

type MultiInputEngine<TOptions, TOutput> = EngineMeta<TOptions> & {
  cardinality: 'multi';
  validate(files: File[], opts: TOptions): ValidationResult;
  convert(files: File[], opts: TOptions, signal: AbortSignal): Promise<TOutput>;
};

type ConversionEngine<TOptions, TOutput> =
  | SingleInputEngine<TOptions, TOutput>
  | MultiInputEngine<TOptions, TOutput>;
```

Each engine lives under `src/engines/<id>/`, exporting only this interface plus its options type. Batch operations on single-input engines (e.g., converting 10 HEICs) are handled by a shared queue harness, not by the engine itself.

## 7. UX / interaction model

### 7.1 Layout

**Viewport:** desktop only. Minimum supported viewport `1280×720`; reference design at `1440×900`. Below `1280` width, render a "desktop required" notice rather than degrade silently. No mobile breakpoints in v1.

Two-column persistent layout:

```
┌─────────────────────────────────────────────────────────────┐
│  file-converter.local                          [?] [⚙]      │
├──────────┬──────────────────────────────────────────────────┤
│ // IMG   │                                                  │
│ heic→png │                                                  │
│ jpeg→webp│      [ DROP_ZONE ]                               │
│ resize   │                                                  │
│ compress │      Drop a file or click to browse              │
│          │      Detects: HEIC, PDF, DOCX, JPG, PNG, MD…     │
│ // PDF   │                                                  │
│ merge    │                                                  │
│ split    │                                                  │
│ ...      │                                                  │
├──────────┴──────────────────────────────────────────────────┤
│ STATUS: ready · 0 conversions this session · v1.0           │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 Two entry paths

**Drop-first (primary).** Drop file(s) on the universal drop zone. App detects file type(s) and either:
- (a) routes directly into the obvious tool ("HEIC dropped → opening HEIC converter"), or
- (b) presents a disambiguation modal if multiple operations are plausible ("3 PDFs dropped — Merge, Split each, or Convert to images?").

**Sidebar-first.** Click a tool in the sidebar → main pane swaps to that tool's interface, drop zone now expects exactly the input type that tool needs. Each tool URL is deep-linkable: `/tools/heic-to-png`.

### 7.3 Per-tool flow

```
[1] Input         → drop file(s) or browse
[2] Configure     → options inline (quality slider, page range, etc.)
[3] Convert       → click "Convert" or hit Enter
[4] Result list   → thumbnails + filename + per-row download / "Download all (zip)"
```

### 7.4 Output handling (smart default)

The rule is keyed on **output count**, not input count:

- **One output file** → auto-download to OS Downloads folder.
- **2–5 output files** → stage on-screen with previews; per-row Download buttons; "Download all" downloads each individually.
- **6+ output files** → stage on-screen; default to "Download all (zip)" packaging; toggle exists for those who want individual downloads.

This handles the asymmetric cases cleanly:
- HEIC → PNG (single → single): auto-download.
- 3 PDFs → merged PDF (multi → single): auto-download.
- 50-page PDF → 50 images (single → many): staged with ZIP default.
- 10 HEICs → 10 PNGs (multi → many): staged with ZIP default.

**Batch ZIP threshold:** triggered when `outputCount > zipBatchThreshold`. Default `zipBatchThreshold = 5` (i.e., 6 or more outputs → ZIP). Configurable in preferences.
**Filename strategy:** original basename + new extension (`vacation.heic` → `vacation.png`). For multi-page → multi-image, suffix with `-page-N` (`doc.pdf` → `doc-page-1.png`).
**Previews:** thumbnails for images; first-page render for PDFs; text head for documents.

### 7.5 Keyboard shortcuts (light)

| Key | Action |
|---|---|
| `?` | Open shortcut help overlay |
| `Esc` | Clear current operation / close modal |
| `/` | Focus sidebar filter input |
| `Enter` | Confirm / start conversion when input is staged |
| `Cmd/Ctrl+V` | Paste-to-convert (clipboard image → image tool) |

## 8. Visual design

Direction: **industrial / terminal**. Pinned specifics:

| Token | Value |
|---|---|
| Background | `#0a0a0a` (page), `#0d0d0d` (elevated surfaces) |
| Foreground | `#e8e8e8` (body), `#ffffff` (emphasis), `#888` (muted), `#5a5a5a` (very muted) |
| Accent | `#ff6b35` (terminal amber) — status indicators, active states only; never decorative |
| Hairlines | `#2a2a2a` (1px borders only) |
| Type stack | `"JetBrains Mono", "SF Mono", "Menlo", monospace` |
| Type weights | 400 regular, 500 medium. No italic. |
| Type scale | `11px / 13px / 16px / 22px` (tight, no in-between values) |
| Border radius | `0` (sharp corners throughout) |
| Shadows | None |
| Gradients | None |

**Status indicators:** bracketed labels in monospace, ALL CAPS — `[ READY ]`, `[ CONVERTING ]`, `[ DONE ]`, `[ ERROR ]`. Accent-colored when active.

**Animations — minimal:**
- File appearing in result list: slide-in from below, 120ms.
- Conversion progress: monospace ASCII progress bar (`[████░░░░] 42%`). No spinner GIFs.
- Hover: 1px border color shift only. No transform / scale / glow.

**Skills to invoke during implementation:**
- `industrial-brutalist-ui` — primary aesthetic guidance
- `design-taste-frontend` — spacing/architecture rigor
- `emil-design-eng` — animation/polish details
- `high-end-visual-design` — final pass quality bar
- `ui-ux-pro-max` — component-level decisions and review

## 9. Tech stack

| Concern | Choice | Rationale |
|---|---|---|
| Framework | **Next.js 15+ (App Router, static export)** | Vercel-native; route-level code splitting |
| Language | **TypeScript, strict** | `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true` |
| Styling | **Tailwind CSS v4** | Design tokens; no per-component CSS |
| Components | **shadcn/ui** | Copy-paste, fully ownable, restylable to brutalist aesthetic |
| State | **React state**, escalate to **zustand** only if a cross-cutting concern emerges | YAGNI |
| Workers | **Comlink** wrapping native Web Workers | Type-safe RPC across worker boundary |
| HEIC decode | **libheif-js** | Only viable client-side HEIC decoder |
| PDF read/write | **pdf-lib** (manipulation), **pdf.js** (preview rendering) | Industry standard, well-maintained |
| DOCX read | **mammoth.js** | Best-in-class DOCX → HTML |
| DOCX write | **docx** (npm) | Pairs with mammoth direction |
| Markdown | **markdown-it** + **highlight.js** | Standard, extensible |
| ZIP | **client-zip** | Streaming ZIP, lower memory than JSZip for large batches |
| Test runner | **Vitest** | Fast, ESM-native |
| E2E | **Playwright** | Real-browser drag-drop testing |
| Lint/format | **Biome** | Single tool, fast |
| Package manager | **pnpm** | Strict, fast, lockfile-friendly |
| Hosting | **Vercel** (static export) | Per requirement |

**Bundle policy:** dynamic import per conversion engine; CI verifies via `next bundle-analyzer` that opening one tool doesn't pull another tool's bytes onto the homepage.

### 9.1 Browser support matrix

Floor versions, set by required APIs (WASM, Web Workers + Comlink, dynamic `import()`, `OffscreenCanvas`, `File.stream()`, `structuredClone`):

| Browser | Minimum |
|---|---|
| Chrome / Edge | **110+** (Feb 2023) |
| Firefox | **110+** (Feb 2023) |
| Safari | **16.4+** (Mar 2023) |

Below the floor, the page renders an inline notice naming the missing capability ("Your browser doesn't support `OffscreenCanvas`, please update or use Chrome/Firefox/Safari ≥ recent version"). Detection is feature-based, not user-agent-based.

Playwright tests cover Chromium, Firefox, and WebKit at their current stable versions in CI.

## 10. Security model

### 10.1 Threat model (scoped to context)

| Threat | Defense |
|---|---|
| Malicious JS via compromised CDN dependency | Strict CSP; SRI for any rare CDN-loaded asset; dependencies bundled, not CDN'd; Dependabot + `pnpm audit` in CI; lockfile committed |
| XSS from rendering filenames or extracted document content | All user-supplied strings rendered via React (escaped by default); no `dangerouslySetInnerHTML`; filename sanitization before display |
| Malicious file (PDF with embedded JS, polyglot HEIC) | Conversions run in Web Workers (no DOM access); PDF.js JS execution kept disabled; no `eval` anywhere |
| Edge tampering / MitM | HSTS preload; force HTTPS (Vercel default); SRI on third-party assets |
| Self-DoS from huge files | Per-tool size caps (Section 11), confirm modal above soft-warn threshold |
| Privacy regression — accidental network upload of file content | Lint rule blocking `fetch` / `XMLHttpRequest` in `src/engines/`; CSP `connect-src 'self'` only; CI integration test asserts zero outbound network during a representative conversion |

### 10.2 Security headers (set in `next.config.js`)

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval';
  style-src 'self';
  img-src 'self' data: blob:;
  font-src 'self';
  connect-src 'self';
  worker-src 'self' blob:;
  object-src 'none';
  base-uri 'self';
  frame-ancestors 'none';
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
```

`'wasm-unsafe-eval'` required for libheif (and future ffmpeg). No `'unsafe-eval'` for JS. **No `'unsafe-inline'` for styles** — Tailwind v4 in build-time PostCSS mode (which static export uses) emits a static stylesheet, not runtime `<style>` injections, so the strict policy holds. If a build artifact is ever caught requiring inline styles, fix the build, do not relax the header. (Verify this assumption during initial deploy — see Section 18.)

### 10.3 Privacy verification

- The `/about` page documents the privacy claim and includes a "verify it yourself" section explaining how to inspect the network panel during conversion.
- The CI test suite includes one E2E test that performs a representative conversion and asserts zero outbound network requests beyond the initial page load.

### 10.4 Rate limiting

Not applicable to the conversion path (no backend exists). If any backend endpoint is added in future scope (analytics opt-in, etc.), it is rate-limited via Vercel middleware before merge.

## 11. Performance and limits

### 11.1 File size caps

| Tool | Soft warn | Hard block |
|---|---|---|
| Image conversion | 50 MB | 250 MB |
| PDF operations | 100 MB | 500 MB |
| Document conversion | 25 MB | 100 MB |

Soft warn = "this may take a while or hit memory limits, continue?" modal. Hard block = friendly "this exceeds the supported size" message with the cap stated.

### 11.2 Latency targets (verified during testing, not external commitments)

| Conversion | Target |
|---|---|
| HEIC → PNG (single 12 MP photo) | < 2s |
| PDF merge (5 files × 10 MB) | < 3s |
| DOCX → PDF (10-page document) | < 4s |

### 11.3 Memory strategy

- Streaming/chunked APIs where the underlying library supports them (pdf-lib supports incremental, mammoth does not).
- Batch operations process files **sequentially by default**; the `batchConcurrency` preference (1–4, default 1) can enable parallelism with explicit acknowledgment of memory cost.
- Web Worker per active conversion; workers are torn down after their result is delivered.

### 11.4 Tab-close protection

While any conversion is in flight, the app installs a `beforeunload` listener that prompts the standard browser "leave site? changes will be lost" dialog. The listener is removed the moment the active-conversion count drops to zero, so users never see the prompt during normal navigation. Closing or refreshing during a conversion aborts the in-flight work cleanly via the `AbortSignal` passed to engines (Section 6.3).

## 12. Error handling

Three error classes, three UI treatments:

1. **User error** (wrong file type, file too large, invalid options) — inline message at the source. Non-blocking, friendly tone.
   *Example:* "This tool expects PDF files, you dropped a `.docx`."

2. **Conversion error** (library failed mid-conversion) — toast notification + `[ ERROR ]` status indicator + expandable "Show details" panel with the technical message. Always offers a "Report" link that opens a GitHub issue prefilled with error and (anonymized) file metadata. Never crashes the page.

3. **App error** (unexpected crash, render error) — top-level error boundary swaps to `[ FATAL ]` screen with "Reload" button and the same details panel.

**Telemetry: off by default.** No Sentry, no analytics ping. User can opt in via preferences if they ever want it.

**Logging:** console-only in production. No server destination. Log records contain enough debug context (tool ID, library, file size) but never file content or filename.

## 13. Persistence

`localStorage` only, preferences only. Schema:

```typescript
type Prefs = {
  schemaVersion: 1;
  defaultImageFormat: 'png' | 'jpeg' | 'webp';
  defaultImageQuality: number;            // 0-100
  defaultPdfMergeOrder: 'as-dropped' | 'alphabetical';
  sidebarCollapsed: boolean;
  zipBatchThreshold: number;              // default 5; trigger when count > threshold
  batchConcurrency: number;               // default 1 (sequential); 1-4
  warnedAboutLargeFiles: boolean;
};
```

Migrations: keyed by `schemaVersion`. On version mismatch, stale keys are nuked and prefs reset to defaults. No file content, no history, no analytics IDs.

## 14. Testing strategy

| Layer | Tool | Coverage |
|---|---|---|
| Unit | Vitest | Pure logic: filename inference, option validation, ZIP packaging, queue state machine |
| Integration | Vitest + jsdom | React components against mocked engine modules; preference store; routing |
| Conversion correctness | Vitest + real fixtures | Each engine fed canonical fixtures (a 5-page PDF, a HEIC photo, a DOCX); output validated structurally (page counts, valid PNG bytes, etc.) |
| End-to-end | Playwright (Chromium + Firefox + WebKit) | Real-browser drag-drop, real file inputs, full happy-path conversion flows |
| **Visual / interaction QA** | **Claude Code with `--chrome` flag** | **Drives a real Chrome session during development to verify aesthetic consistency, drag-drop UX, animation timing, error-state appearance, and visual regressions across the brutalist design system. Used iteratively while implementing each tool, before opening a PR.** |
| Performance | Playwright + custom metric | Wall-clock for representative conversions; warning (not failing) above 2× target |
| Accessibility | axe via Playwright | Zero AA violations on every route |
| Bundle size | `next bundle-analyzer` in CI | Per-route budget; fails if HEIC tool route bloats the homepage bundle |
| Lighthouse | `@lhci/cli` (Lighthouse CI) on the deployed preview | Performance, Accessibility, Best Practices, SEO — fails PR if any category drops below 95 |
| Privacy regression | Playwright | One E2E test asserts zero outbound network during a representative conversion |

**Mocking policy:** **no mocks for conversion libraries** in correctness tests. We test the real libheif, the real pdf-lib. Mocking those would invalidate the test value.

**Chrome-driven QA workflow.** Implementation sessions will run with Claude's `--chrome` flag enabled, which gives Claude direct browser-automation capabilities (DOM inspection, screenshots, click/drag/keyboard events). The intended use:

- After implementing a tool, drive the running dev server in Chrome and screenshot the rendered state for visual review against the brutalist design tokens.
- Verify drag-drop interactions actually work end-to-end (these are notoriously fragile and hard to unit-test).
- Capture screenshots of error states, conversion progress, result lists for design QA.
- Check responsive details (even though desktop-only, viewport-edge bugs still exist).
- Use as a fast feedback loop during the design-implementation phase before formal Playwright tests are written.

This is not a substitute for Playwright E2E tests; it is a faster, exploratory complement during development.

## 15. CI / deployment pipeline

```
PR opened/updated:
  ├── Type check (tsc --noEmit)
  ├── Lint (biome)
  ├── Unit + integration tests (Vitest)
  ├── Conversion correctness tests (Vitest with real fixtures)
  ├── E2E (Playwright, headless Chromium + Firefox + WebKit)
  ├── Bundle-size budget check
  ├── axe accessibility audit
  ├── Privacy regression test (no outbound network)
  └── Lighthouse CI on Vercel preview (≥95 each category)

Merge to main:
  └── Vercel auto-deploys static export
```

All checks must pass before merge. No `--no-verify`, no skipped hooks.

## 16. Future scope (post-v1)

In rough priority order:

1. **Audio** — MP3/WAV/M4A/FLAC via ffmpeg.wasm. Heaviest add (~30MB WASM); lazy-load mandatory.
2. **Video** — MP4/MOV/WebM transcoding, trimming. Same ffmpeg.wasm; likely needs OffscreenCanvas + SharedArrayBuffer (requires COOP/COEP headers — additional Vercel config).
3. **Archives** — ZIP/TAR creation/extraction. Lightweight, easy add.
4. **Data** — CSV ↔ JSON, JSON ↔ YAML, JSON pretty/minify. Trivial; could even be v1.1.
5. **OCR** — Tesseract.js for "PDF → searchable PDF" or "image → text". Heavy WASM, niche use.
6. **PWA / offline mode** — once feature surface stabilizes.
7. **Mobile responsive layout** — when desktop is mature.
8. **Custom domain + branding refresh** — when ready.

Each future engine plugs into the `convert()` interface (Section 6.3) as a lazy-loaded module. v1's modular structure is what makes future scope cheap.

## 17. Success criteria

This is a personal project; success is measured against the stated problem, not market metrics.

1. **The privacy guarantee is real and verifiable.** A network panel inspection during any conversion shows zero requests beyond the initial page load. CSP enforced. Documented and demonstrated on `/about`.
2. **At least one conversion the user actually does today** (HEIC→PNG, PDF merge) is faster and more pleasant than the third-party site they currently use.
3. **The site looks intentionally designed** — the brutalist aesthetic is consistent and confident across every screen, not generic SaaS.
4. **Production quality bar met** — TypeScript strict; Lighthouse ≥ 95 across all categories; securityheaders.com grade A; axe AA clean; CI green on every PR.
5. **Adding a new conversion** (audio, archive, etc.) post-v1 takes a single PR that adds one engine module + one route, without touching shared code.

## 18. Open questions / risks

- **Vercel static export + WASM caching headers.** WASM modules need long cache lives but careful cache-busting on releases. Will validate during initial deploy.
- **PDF → DOCX experimental quality.** The "best-effort" label sets expectations, but if results are unusable in practice, this feature may be cut from v1 rather than ship broken.
- **shadcn/ui restyling effort.** shadcn defaults are rounded/soft — restyling them to brutalist sharp-corner monospace is real work, not a token swap. Budget time for this in implementation planning.
- **Tailwind v4 + CSP `style-src`.** Default plan: build-time PostCSS emits a static stylesheet; CSP holds at `style-src 'self'` (no `'unsafe-inline'`). Resolution path: verify on the first deploy that no inline styles slip in via shadcn primitives, design-token runtime, or third-party widgets. If any do, fix the build (precompile, restyle, or drop the offender) — do **not** relax the header.
