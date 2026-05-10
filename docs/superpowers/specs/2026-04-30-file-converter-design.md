# file-converter — Design / PRD

**Status:** Draft, pending user review
**Date:** 2026-04-30
**Owner:** Tony Yu — tonyyu2170@gmail.com (personal) / tonyyu2029@u.northwestern.edu (school)
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
- PDF → DOCX experimental — deferred to future scope (§16). Best-effort
  layout reconstruction does not meet the project quality bar; shipping
  it behind a "works when it can" label compromises the privacy-first
  identity of the rest of the catalog.
- Standalone image-compress tool. The image-convert quality slider
  covers compression as a re-encode side effect; a dedicated tool would
  be redundant UX.

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
| **PDF → Markdown** | **Best-effort, labeled "experimental" in UI** |

The "experimental" label sets honest expectations on the lossy reverse-conversion and prevents user surprise about layout fidelity loss.

The PDF → DOCX path is cut from v1 (§3); see §16 for the revisit conditions.

### 5.4 User stories (representative)

- *As the user, I want to drop a HEIC photo and immediately get a PNG download with no extra clicks.*
- *As the user, I want to drag five PDFs into the page, reorder them visually, and merge them into one file.*
- *As the user, I want to convert a DOCX résumé to PDF without losing styling.*
- *As the user, I want to know — visibly and verifiably — that no file I drop has been uploaded anywhere.*
- *As the user, I want the app to remember that I prefer 90% JPEG quality without re-asking every time.*

### 5.5 Audio

| Operation | Direction | Notes |
|---|---|---|
| MP3 / WAV / M4A / FLAC ↔ format swap | round-trip | Bitrate options on lossy outputs |
| Audio trim to sub-range | n/a | Lossless via `-c copy` when output format matches input |

### 5.6 Video

| Operation | Direction | Notes |
|---|---|---|
| MP4 / MOV / WebM transcode | round-trip | libx264 / libvpx; quality low/medium/high → CRF 28/23/18 |
| Video trim to sub-range | n/a | Lossless `-c copy`; cuts may snap to nearest keyframe |
| Extract audio track from video | one-way | MP3 / M4A / WAV; lossless when no re-encode |

WebM uses libvpx (VP8) on output: the libvpx-vp9 path in the current `@ffmpeg/core` build OOBs on real inputs, verified empirically in Phase 25.5.

### 5.7 Archives

| Operation | Direction | Notes |
|---|---|---|
| ZIP / TAR / TAR.GZ extract | one-way | Magic-byte format detection; entries downloaded as a bundle |
| Multi-file archive create | one-way | ZIP or TAR.GZ output; ordered via StagingArea |

Encrypted ZIPs and zip-slip path entries are rejected at validation time with actionable errors. Per-entry sanity check rejects single-entry archives that would expand to > 1 GB.

### 5.8 Data

| Operation | Direction | Notes |
|---|---|---|
| CSV ↔ JSON ↔ YAML | round-trip | Auto-detect input by extension + sniff |
| JSON pretty / minify | n/a | Indent 2 / 4 / tab on pretty mode |
| XML → JSON | one-way | Configurable attribute prefix (`@` / `$_` / none) |

JSON → XML reconstruction is deferred (lossy); see §16.

### 5.9 OCR

| Operation | Direction | Notes |
|---|---|---|
| Image → text (English) | one-way | Tesseract.js; TXT or JSON-with-bboxes output |

Best on scanned documents and screenshots; lower quality on photos. Multi-language packs deferred to a later release; see §16.

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

### 6.4 Project directory structure

```
file-converter/
├── .github/
│   └── workflows/
│       └── ci.yml                       # type-check, lint, vitest, playwright,
│                                        # bundle budget, axe, lighthouse, privacy regression
├── docs/
│   └── superpowers/
│       ├── specs/
│       │   └── 2026-04-30-file-converter-design.md   # this document
│       └── plans/
│           └── (implementation plans live here)
├── public/
│   ├── favicon.ico
│   └── fonts/                           # self-hosted JetBrains Mono (CSP font-src 'self')
├── src/
│   ├── app/
│   │   ├── layout.tsx                   # root layout: header + sidebar + footer + status bar
│   │   ├── page.tsx                     # universal drop zone homepage
│   │   ├── globals.css                  # Tailwind v4 entry + @theme tokens
│   │   ├── tools/
│   │   │   └── [tool]/
│   │   │       ├── page.tsx             # focused tool surface, deep-linkable
│   │   │       └── not-found.tsx
│   │   ├── about/
│   │   │   └── page.tsx                 # privacy claim + verification instructions
│   │   └── error.tsx                    # top-level [ FATAL ] boundary
│   │
│   ├── components/
│   │   ├── ui/                          # shadcn primitives, restyled to brutalist
│   │   │   ├── button.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── slider.tsx
│   │   │   └── …
│   │   ├── layout/
│   │   │   ├── header.tsx
│   │   │   ├── sidebar.tsx              # tool list, filter input
│   │   │   └── footer.tsx               # status bar (READY / CONVERTING / DONE)
│   │   ├── drop-zone.tsx                # universal + tool-specific variants
│   │   ├── disambiguation-modal.tsx     # "you dropped 3 PDFs — Merge / Split / Image?"
│   │   ├── tool-frame.tsx               # common shell for /tools/[tool]
│   │   ├── result-list.tsx              # output thumbnails + per-row download / ZIP
│   │   ├── progress-bar.tsx             # ASCII [████░░░░] 42%
│   │   ├── status-indicator.tsx         # [ READY ] [ CONVERTING ] [ DONE ] [ ERROR ]
│   │   ├── shortcut-overlay.tsx         # `?` keyboard help
│   │   └── error-details-panel.tsx      # expandable tech detail + Report link
│   │
│   ├── engines/                         # one folder per conversion (Section 6.3)
│   │   ├── _shared/
│   │   │   ├── types.ts                 # ConversionEngine, ValidationResult, EngineMeta
│   │   │   ├── harness.ts               # batch queue, worker spawn/teardown, AbortSignal
│   │   │   ├── filename.ts              # basename + extension rewrite, page-N suffix
│   │   │   └── registry.ts              # id → dynamic-import map for routes & sidebar
│   │   ├── heic-to-png/
│   │   │   ├── index.ts                 # SingleInputEngine export
│   │   │   ├── worker.ts                # Comlink-exposed worker doing libheif decode
│   │   │   └── options.ts
│   │   ├── jpeg-png-webp/               # round-trip image format swaps
│   │   ├── image-resize/
│   │   ├── image-compress/
│   │   ├── pdf-merge/                   # MultiInputEngine
│   │   ├── pdf-split/
│   │   ├── pdf-reorder/
│   │   ├── pdf-rotate/
│   │   ├── image-to-pdf/                # MultiInputEngine
│   │   ├── pdf-to-image/                # single in, multi out (per-page)
│   │   ├── docx-to-pdf/
│   │   ├── docx-to-txt/
│   │   ├── md-to-pdf/
│   │   ├── txt-to-pdf/
│   │   ├── pdf-to-docx/                 # experimental, best-effort
│   │   └── pdf-to-md/                   # experimental, best-effort
│   │
│   ├── hooks/
│   │   ├── use-prefs.ts                 # localStorage preferences with schema migration
│   │   ├── use-conversion.ts            # engine harness React adapter
│   │   ├── use-keyboard-shortcuts.ts
│   │   ├── use-active-conversions.ts    # source of truth for tab-close protection
│   │   └── use-paste-to-convert.ts      # Cmd+V clipboard image handler
│   │
│   ├── lib/
│   │   ├── prefs.ts                     # Prefs type, schema migrations, defaults
│   │   ├── file-detection.ts            # MIME + magic-byte sniffing
│   │   ├── disambiguation.ts            # multi-operation routing logic
│   │   ├── zip.ts                       # client-zip wrapper, output naming
│   │   ├── error-reporting.ts           # GitHub issue prefill template
│   │   ├── browser-support.ts           # feature detection + below-floor screen
│   │   └── beforeunload.ts              # tab-close guard install/teardown
│   │
│   └── styles/
│       └── tokens.css                   # CSS custom properties (brutalist palette + scale)
│
├── tests/
│   ├── fixtures/                        # canonical inputs for correctness tests
│   │   ├── sample.heic
│   │   ├── sample-5pages.pdf
│   │   ├── sample.docx
│   │   ├── sample.md
│   │   └── sample.png
│   ├── e2e/                             # Playwright specs
│   │   ├── homepage.spec.ts
│   │   ├── heic-to-png.spec.ts
│   │   ├── pdf-merge.spec.ts
│   │   ├── docx-to-pdf.spec.ts
│   │   ├── privacy-regression.spec.ts   # asserts zero outbound network
│   │   ├── tab-close-protection.spec.ts
│   │   └── a11y.spec.ts                 # axe sweep across all routes
│   └── (unit tests are co-located as `<file>.test.ts` next to source)
│
├── .gitignore
├── .lighthouserc.json                   # Lighthouse CI thresholds (≥95 each)
├── biome.json                           # lint + format config
├── next.config.ts                       # static export, security headers, bundle analyzer
├── package.json
├── playwright.config.ts                 # Chromium + Firefox + WebKit projects
├── pnpm-lock.yaml
├── postcss.config.mjs                   # Tailwind v4 PostCSS plugin
├── README.md
├── tsconfig.json                        # strict, noUncheckedIndexedAccess, etc.
└── vitest.config.ts                     # jsdom env + co-located test pattern
```

**Conventions:**

- **Engines are self-contained.** A new conversion is a single folder under `src/engines/` plus one entry in `_shared/registry.ts`. No edits to UI components, hooks, or routes — the harness handles them generically based on engine metadata.
- **Workers co-located with their engine.** Each engine's `worker.ts` is the Comlink-exposed module. The harness spawns it via `new Worker(new URL('./worker.ts', import.meta.url))`.
- **Unit tests co-located** (`foo.ts` + `foo.test.ts`) — easier discovery, easier deletion alongside the code.
- **E2E tests centralized** under `tests/e2e/` with one spec per tool plus cross-cutting specs (privacy regression, tab-close, accessibility).
- **Fixtures committed.** All test fixtures live in `tests/fixtures/` and are committed to the repo. They're small (< 1 MB each); deterministic tests > deterministic-CI > "fetch from somewhere."
- **No `src/types/` god-folder.** Types live next to the code that owns them; only truly cross-cutting types (e.g., `ConversionEngine`) live in `_shared/types.ts`.

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

**`script-src 'unsafe-inline'` retention.** `'unsafe-inline'` is retained in `script-src` (only) for Next.js static export's hydration shim, which emits a small inline `<script>` block per page (the `self.__next_f.push(...)` React Server Components flight protocol). Eliminating it requires either server-side nonce generation (which static export precludes) or per-build hash injection (brittle). `style-src` remains `'self'` only — the directive *"do not relax the style-src header; fix the build instead"* applies to `style-src`, not `script-src`. The risk surface added by `script-src 'unsafe-inline'` is bounded by `connect-src 'self'` (an injected script cannot exfiltrate data) and `worker-src 'self' blob:` (cannot spawn off-origin workers).

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
| Audio | 100 MB | 500 MB |
| Video | 50 MB | 100 MB |
| Archives | 200 MB | 500 MB |
| Data | 25 MB | 50 MB |
| OCR | 25 MB | 25 MB |

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

## 16. Future scope (post-v2)

In rough priority order:

1. **PWA / offline mode** — once feature surface stabilizes.
2. **Mobile responsive layout** — when desktop is mature.
3. **Custom domain + branding refresh** — when ready.
4. **AI image transforms** — watermark removal, possibly upscaling/inpainting. Browser-side only to honor `connect-src 'self'` (server-side ML breaks the privacy guarantee). General-purpose background removal shipped in v2 as `image-bg-remove`. Watermark removal and inpainting remain aspirational and gated on the bundle-size strategy.
5. **PDF → DOCX.** Cut from v1 because best-effort layout reconstruction does not meet the project quality bar. Revisit when a permissively-licensed in-browser solution exists with materially better fidelity than mammoth-style structural mapping.
6. **Standalone image-compress tool.** Cut from v1; revisit only if user feedback indicates the image-convert quality slider doesn't cover the use case.
7. **Watermark removal.** Brainstormed and tossed 2026-05-05. State-of-the-art "one-button magic" watermark removal is a server-GPU problem; permissively-licensed open-vocabulary detection that runs in a browser at quality does not exist. Revisit when that changes.
8. **Audio extras** — `audio-concat`, `audio-normalize`. Concat shape is awkward without a multi-input UX precedent in the audio family; normalize is small but waiting on the catalog hitting a stable shape post-v2.
9. **OGG / Opus formats in `audio-convert`.** Trivial codec add; deferred only because v2 already shipped four formats and the marginal user-facing value didn't justify the small additional bundle weight.
10. **`video-to-gif`.** Browser-side ffmpeg can do this, but quality vs file size is poor at GIF's bit-depth limits and users expecting "shareable GIFs" tend to want the WebP/MP4 path that already exists.
11. **Standalone `gzip` / `gunzip`.** Useful but covered partially by `archive-extract` (which handles `.tar.gz`). Standalone single-file gzip add waits on demand signal.
12. **TOML in `data-convert`.** Adds a parser dependency; deferred until a user use-case surfaces.
13. **Multi-language OCR.** v2 ships English only. Adding Spanish/French/German/simplified-Chinese language packs is a bundle-weight conversation — each pack is ~10 MB. The pattern is in place via `_shared/tesseract`; selection UX is the open design question.
14. **`pdf-ocr`** (PDF → searchable PDF). Reuses pdf-rasterize from `pdf-to-image` and PDF reassembly from `pdf-edit` plus the v2 Tesseract pipeline. Deferred because the multi-page progress + per-page error handling is non-trivial to design well.
15. **JSON → XML reconstruction.** v2 ships `xml-to-json` one-way only. Reconstruction is lossy without a documented type-mapping convention; deferred until that convention is settled on.

Each future engine plugs into the `convert()` interface (Section 6.3) as a lazy-loaded module. The catalog's modular structure is what makes future scope cheap.

## 17. Success criteria

This is a personal project; success is measured against the stated problem, not market metrics.

1. **The privacy guarantee is real and verifiable.** A network panel inspection during any conversion shows zero requests beyond the initial page load. CSP enforced. Documented and demonstrated on `/about`.
2. **At least one conversion the user actually does today** (HEIC→PNG, PDF merge) is faster and more pleasant than the third-party site they currently use.
3. **The site looks intentionally designed** — the brutalist aesthetic is consistent and confident across every screen, not generic SaaS.
4. **Production quality bar met** — TypeScript strict; Lighthouse ≥ 95 across Performance / Accessibility / Best Practices (SEO exempt while hosted on `*.vercel.app`, see below); securityheaders.com grade A; axe AA clean; CI green on every PR.

   **Deviation — Lighthouse SEO on `*.vercel.app`:** Vercel auto-injects `x-robots-tag: noindex` on all team-prefix and deploy-hash subdomains under `*.vercel.app` to prevent SEO duplication with the project's canonical URL. This single header trips the `is-crawlable` audit and forces the SEO category to ~60. Resolution path: assign a custom domain (post-v1); the `noindex` header is not present on custom domains. SEO ≥ 95 will be re-verified at that point.
5. **Adding a new conversion** (audio, archive, etc.) post-v1 takes a single PR that adds one engine module + one route, without touching shared code.

> **v2 footnote (2026-05-09).** Catalog of 24 engines verified against this bar.

## 18. Open questions / risks

- **Vercel static export + WASM caching headers.** WASM modules need long cache lives but careful cache-busting on releases. Will validate during initial deploy.
- **PDF → DOCX experimental quality.** Cut from v1 per §3; see §16 for revisit conditions.
- **shadcn/ui restyling effort.** shadcn defaults are rounded/soft — restyling them to brutalist sharp-corner monospace is real work, not a token swap. Budget time for this in implementation planning.
- **Tailwind v4 + CSP `style-src`.** Validated via the v1 closeout deploy checklist (§2.5 of `2026-05-05-v1-closeout.md`); CSP holds at `style-src 'self'`. If a regression slips in, fix the build, not the header.
- **`image-bg-remove` model quality.** Resolved in v2 Phase 18 — model swapped from MODNet (portrait-only, Apache-2.0, 6.6 MB) to **ormbg int8** (general-purpose, Apache-2.0, ~38 MB). The portrait-only limitation is removed. Verification log: `docs/superpowers/plans/phase-18-verification-log.md`.
