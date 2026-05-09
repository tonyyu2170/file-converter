# Phase 24 — `archive-extract` + `archive-create` engines

**Date:** 2026-05-08
**Status:** draft (pending approval)
**Source of truth:** `docs/superpowers/specs/2026-05-05-v2-design.md` §3.3 (Archives), §4.1 (sidebar grouping), §5 (phasing — Phase 24), §6 (testing strategy), §7.1 (caps). Phase 19 (`2026-05-05-phase-19-ffmpeg-infra-and-audio-convert.md`) established the "shared infra + first engine" template that this phase re-applies for `_shared/tar/`. Phase 22 (`2026-05-07-phase-22-video-trim-and-extract-audio-design.md`) established the multi-engine-per-phase pattern that this phase mirrors.

## 1. Goal

Ship the Archives family of v2 — two engines and one shared module:

1. `src/engines/_shared/tar/`: hand-rolled POSIX ustar TAR reader and writer. ~80–150 LOC. No new third-party dep. Worker-only.
2. `src/engines/archive-extract/`: single-input engine. Accepts `.zip`, `.tar`, `.tar.gz`, `.tgz`. 200 MB cap. Multi-output (one `OutputItem` per archive entry). Magic-byte format detection; encrypted ZIP / zip-slip / oversized-entry rejection.
3. `src/engines/archive-create/`: multi-input engine using the existing `StagingArea` (same UX as `pdf-merge`, `image-to-pdf`). 500 MB sum cap. Output `.zip` (default) or `.tar.gz`. Custom output filename.

**Out of scope** (deferred per v2 spec §1.3 + new deferrals listed in §6 below): standalone `gzip` / `gunzip` engines, GZIP-of-non-TAR support, encrypted-ZIP password input, folder-structure preservation in `archive-create`, PAX extended attribute preservation (mtime nanosecond precision, xattrs).

## 2. Resolved design decisions

### 2.1 Library stack — fflate + client-zip + hand-rolled TAR; no pako

| Concern | Library | Notes |
|---|---|---|
| ZIP read | `fflate.unzip` (async streaming) | Already installed (used by `_shared/docx/docx-parser`). Async API needed so we can pre-read the central directory before allocating uncompressed buffers (size guard runs *before* extraction). |
| ZIP write | `client-zip` | Already installed (powers `_shared/zip/buildZipBlob`'s "download all as zip"). Streaming, ~5 KB. |
| GZIP read/write | `fflate.gunzipSync` / `fflate.gzipSync` | **Drops the v2 spec's `pako` line.** fflate already provides gzip — shipping `pako` would be a redundant dep. v2 spec to be amended in Phase 26. |
| TAR read/write | `src/engines/_shared/tar/` (hand-rolled) | No maintained pure-browser TAR lib exists. Hand-rolled gives full control over zip-slip checks and per-entry size validation; ~80–150 LOC + thorough tests. POSIX TAR is a 35-year-stable spec, low risk. |

**Net new third-party deps for Phase 24: zero.**

### 2.2 `_shared/tar/` module — public surface

```ts
// src/engines/_shared/tar/index.ts
export type TarEntry = {
  path: string;        // POSIX-style; forward slashes
  size: number;        // declared bytes (uncompressed payload)
  mtime: number;       // unix seconds; 0 if unknown
  type: "file" | "directory";
  payload: Uint8Array; // empty for directories
};

export function readTar(buf: Uint8Array): TarEntry[];
export function writeTar(entries: TarEntry[]): Uint8Array;
```

**Format support:**

- **Read:** POSIX ustar (`ustar\0` magic at offset 257) and old GNU TAR (`ustar  \0`). PAX extended headers (typeflag `x` / `g`) consumed and ignored — the parser advances past them and takes the next regular entry. GNU long-name extension (typeflag `L`) honored. Sparse files (`S`) rejected with actionable error.
- **Write:** ustar only. Filenames > 100 bytes (the ustar `name` field cap, after the optional `prefix` field) rejected pre-write; we don't emit GNU long-name records on write.
- **Numeric fields:** parsed as octal strings (TAR's native encoding); writer emits octal.
- **Checksums:** verified on read (8-bit unsigned-byte sum of header with checksum field bytes treated as spaces). Bad checksum → reject entry with actionable error (catches malformed/truncated archives early).
- **End-of-archive:** two consecutive 512-byte zero blocks (POSIX requirement); writer always appends both.

**Worker-only:** TAR module imports nothing from the DOM and is dynamically imported (`await import("@/engines/_shared/tar")`) inside the engine workers, so the home chunk stays clean.

### 2.3 `archive-extract` — pipeline and validation

**Format detection** (magic bytes; extension is *not* trusted):

| Bytes / position | Format |
|---|---|
| `50 4B 03 04` or `50 4B 05 06` (empty archive) at bytes 0–3 | ZIP |
| `1F 8B` at bytes 0–1, with TAR magic at offset 257 of decompressed stream | TAR.GZ / TGZ |
| `1F 8B` at bytes 0–1, no TAR magic in decompressed stream | **Reject** — `"GZIP of non-TAR not supported in v2; standalone gunzip is on the roadmap"` |
| `ustar\0` or `ustar  \0` at bytes 257–264 | TAR |
| anything else | **Reject** — `"unrecognized archive format"` |

The validation layer reports the detected format string to the harness so the OptionsPanel preview can show it (consistent with how `image-convert` surfaces the detected input format).

**Pipeline:**

1. **Pre-flight — no extraction yet:**
   - Detect format.
   - Enumerate entries with declared uncompressed sizes:
     - ZIP: read the central directory directly (no decompression needed).
     - TAR: scan 512-byte headers, validating checksums.
     - TAR.GZ: gunzip the full input first (bounded; see §2.4 below), then scan TAR headers.
   - **Reject if any entry has the encrypted bit set** (ZIP general-purpose-bit-flag bit 0). Error: `"this archive is encrypted; password-protected ZIPs aren't supported"`. If *any* entry is encrypted, the whole archive is rejected — partial extraction is not offered.
   - **Reject zip-slip:** any entry path that contains `..` segments, starts with `/`, has a Windows drive letter (`C:`), or contains an embedded `\0` aborts the entire extraction. Error: `` "archive contains entry with unsafe path: `<path>`; refusing to extract" ``.
   - **Reject if any single entry's declared uncompressed size > 1 GB.** Error: `` "entry `<path>` would expand to <Xgb>; refusing to extract" ``.
   - **Reject if sum of declared uncompressed sizes > 2 GB.** Error: `` "archive would expand to <Xgb> total; refusing to extract" ``.
2. **Extract** every (file) entry to a `Blob`:
   - `OutputItem.filename = entry.path` — preserves directory structure (e.g. `vacation/beach.jpg`).
   - `Blob` MIME type set to `application/octet-stream` for all extracted entries. (Browser downloads honor the file extension regardless; per-format MIME sniffing would add complexity for no user-visible benefit. If a future engine genuinely needs typed blobs from archives, a shared mime-sniff helper can be added then.)
3. **Skip directory entries** (paths ending in `/` with size 0) — they don't contribute files.

**Engine descriptor:**
- `category: "archive"`.
- `archiveSuffix: "-extract"` so the multi-output bundle (when user clicks "download all as zip") is named `<basename>-extract.zip`.

### 2.4 Bounded `tar.gz` decompression

`fflate.gunzip` (async) is used in streaming mode with a running-bytes counter. If the decompressed stream exceeds 2 GB at any point, the stream is aborted and the file is rejected with the aggregate-cap error from §2.3. This guards against gzip-bombs that would crash the tab before we ever see TAR headers. Maximum allocation during tar.gz extract is therefore bounded at 2 GB regardless of input.

### 2.5 ResultList path-handling extensions

Two small downstream changes are required to honor preserved paths in `OutputItem.filename`:

1. **`_shared/zip/buildZipBlob`** — verify `client-zip` preserves `/` in entry names (likely a no-op since it accepts entry names verbatim; will be verified during plan execution). If not, pass the path through explicitly.
2. **`ResultList`'s per-item Download button** — strip directory prefix and dedupe basename collisions when downloading individually. Browsers cannot honor `/` in `<a download>` attributes, so `vacation/beach.jpg` becomes `beach.jpg`. If two extracted items share a basename (`vacation/foo.jpg` + `archive/foo.jpg`), dedupe in display order: `foo.jpg`, `foo-1.jpg`, `foo-2.jpg`. The "download all as zip" path keeps original entry names so users get folder structure back.

The dedupe happens in `ResultList` at render time (deterministic, based on items array order), not in the engine — keeps the engine's contract simple (`filename` is the *original entry path*) while still producing usable per-item downloads.

### 2.6 `archive-create` — entry naming, options, pipeline

**Cardinality:** `MultiInputEngine` using the existing `StagingArea` (same drop-and-reorder UX as `pdf-merge` and `image-to-pdf`).

**OptionsPanel:**

```
[ Output format ]    ( ● zip   ○ tar.gz )

[ Filename ]         [ archive-20260508-1934              ]
                     → archive-20260508-1934.zip
                     ─────────────────────────
                     letters, digits, dots, dashes, underscores
```

- `outputFormat: "zip" | "tar.gz"` — segmented control, default `"zip"`.
- `filename: string` — text input prefilled with `archive-YYYYMMDD-HHmm` (computed at first render of the OptionsPanel; not re-computed per-keystroke). Live preview below shows final name with extension. Validation: matches `/^[A-Za-z0-9._-]+$/` (no spaces, no slashes, no special chars), max 100 chars. On invalid input, the input gets a red border and the Convert button disables.
- Tooltip below: `"folder structure is flattened — all files become top-level entries"`.

**Entry naming:**
- Each StagingArea input becomes a top-level entry. `entry.path = input.file.name`.
- Folder structure from `webkitRelativePath` is **not** preserved in v2 — flat archives only. This is a deliberate v2.x deferral so the StagingArea contract doesn't need to grow.
- Duplicate basenames are deduped: in StagingArea order, repeats become `foo.png`, `foo-1.png`, `foo-2.png`, etc. Same dedupe rule as `ResultList`'s per-item-download to keep behavior consistent across both engines.

**Pipeline:**
1. Validate sum of input sizes ≤ 500 MB via the existing caps map (`src/lib/size-caps.ts`).
2. Worker:
   - **ZIP:** stream inputs into `client-zip`'s `downloadZip()` async generator, accumulating chunks into a `Uint8Array[]`, then `new Blob(chunks, { type: "application/zip" })`. Sum-of-chunks ≤ 500 MB by construction.
   - **TAR.GZ:** build `TarEntry[]` from inputs, call `writeTar()`, then `fflate.gzipSync()` over the result, then `new Blob([gz], { type: "application/gzip" })`.
3. Output: single `OutputItem` with `filename = ${userFilename}.${ext}` and `blob` set.

**Engine descriptor:**
- `category: "archive"`.
- `archiveSuffix` not set (single output, no rebundle needed).

### 2.7 Sidebar — `ARCHIVES` group lands in Phase 24

Per v2 spec §4.1, v2 adds five new sidebar group headings. The convention to date has been to ship each group as the first engine in that family lands. The current `GROUP_ORDER` in `src/components/layout/sidebar.tsx` is `HOME → IMAGES → PDFS → DOCS → AUDIO → VIDEO → OCR → ABOUT`. Phase 24 inserts `ARCHIVES` between `OCR` and `ABOUT`, with `archive-extract` and `archive-create` listed under it.

After Phase 24: `HOME → IMAGES → PDFS → DOCS → AUDIO → VIDEO → OCR → ARCHIVES → ABOUT`. Per-phase ordering is tactical and accumulates in arrival order; Phase 26 closeout reorders to the canonical v2 order (`AUDIO → VIDEO → ARCHIVES → DATA → OCR`).

**`EngineCategory` extension:** `category: "archive"` is added to the union in `src/engines/_shared/types.ts`. Phase 25 will add `"data"`; Phase 26 verifies the union matches v2 spec §2.3.

### 2.8 Home grid — flat in Phase 24, sectioned in Phase 26

Two new engine cards added to the existing flat grid in `src/app/page.tsx`. Sectioning by category is Phase 26 closeout work and is not duplicated here. Matches the convention every engine phase has used.

## 3. UX commitments

- **Latency:** archives are fast (instant for typical extract; seconds for create). Existing spinner is sufficient — no progress UI required (consistent with v2 spec §7.2).
- **Per-engine routes:** `src/app/tools/archive-extract/page.tsx` and `src/app/tools/archive-create/page.tsx`, standard `ToolFrame` pattern.
- **Error messages** are actionable verbatim per §2.3 above (encrypted-ZIP, zip-slip, oversized-entry, oversized-aggregate, unrecognized-format, GZIP-of-non-TAR).
- **`/about` engines table** auto-populates from the registry — Phase 24 just needs `library` and `license` fields populated on each engine's `EngineMeta` (`fflate` MIT, `client-zip` MIT, `_shared/tar` "in-house").

## 4. Testing strategy

### 4.1 Co-located unit + integration tests (per project convention)

**`_shared/tar/tar.test.ts`:**
- Round-trip: `writeTar(entries)` → `readTar(...)` returns structurally-equal entries.
- Read fixtures from real `tar` CLI output (committed binaries, ≤ 1 KB each):
  - Single regular file.
  - Two files with nested path (`a/b.txt`).
  - PAX-extended header followed by regular file → PAX consumed-and-ignored, regular file returned.
- Reject sparse-file fixture with actionable error.
- Reject bad-checksum fixture (bit-flipped header) with actionable error.
- Reject truncated fixture (mid-payload EOF) with actionable error.
- `writeTar` throws on filename > 100 bytes.

**`archive-extract/index.test.ts`** (engine descriptor):
- Registered with `category: "archive"` and `archiveSuffix: "-extract"`.
- Validates input by magic bytes (extension fallback for ambiguous cases per §2.3).

**`archive-extract/worker.test.ts`** (real conversions, no mocks per project convention):
- Each happy-path fixture (`sample.zip`, `sample.tar`, `sample.tar.gz`) round-trips: extract entries, assert filenames + payloads match build-script's known input.
- Each security fixture rejected with the documented error message:
  - `encrypted.zip` → encrypted-ZIP error.
  - `zip-slip.zip` → zip-slip error with offending path quoted.
  - `huge-entry.zip` → per-entry-cap error.
  - `bomb.zip` → aggregate-cap error.
- Bare `.gz` (e.g., `text.txt.gz`) → GZIP-of-non-TAR error.

**`archive-create/index.test.ts`** (engine descriptor + options validation).

**`archive-create/worker.test.ts`:**
- ZIP output: build from 3 files, then re-extract with `fflate.unzip` and assert names + payloads.
- TAR.GZ output: build from 3 files, then `fflate.gunzip` + `readTar` and assert.
- Filename dedupe: two inputs named `foo.png` produce entries `foo.png`, `foo-1.png` in StagingArea order.
- Sum-cap rejection: 6 × 100 MB input → caps error.

**`archive-create/options-panel.test.tsx`:**
- Default filename matches `archive-YYYYMMDD-HHmm` shape.
- Invalid filename (with space, with slash, > 100 chars) disables Convert.
- Live preview shows correct extension when format toggles.

**`result-list.test.tsx`** extension:
- Per-item Download for `vacation/beach.jpg` triggers download with name `beach.jpg`.
- Two items with colliding basenames produce `foo.jpg`, `foo-1.jpg` per-item names; "download all as zip" preserves original `/`-bearing names in the bundle.

### 4.2 E2E (`tests/e2e/`)

**`archive-extract.spec.ts`:**
- Drag-drop `sample.zip`; assert N output rows shown; assert per-item download triggers; assert "download all as zip" triggers `<basename>-extract.zip`.
- Drag-drop `encrypted.zip`; assert error UI shows the documented message; no outputs rendered.
- Drag-drop `zip-slip.zip`; assert error UI; no outputs.

**`archive-create.spec.ts`:**
- Drag-drop 3 files into StagingArea; reorder via drag; type custom filename; click Convert; assert downloaded `.zip` contains files in user-set order.
- Toggle format to `tar.gz`; assert filename preview updates extension; click Convert; assert downloaded `.tar.gz`.

**Privacy E2E:** `tests/e2e/privacy.spec.ts` extends to cover both routes (already enforces zero outbound network during conversion across all engines).

### 4.3 Fixtures — `tests/fixtures/archives/`

Per v2 spec §6.2: deterministic `tests/fixtures/archives/build.mjs` produces all fixtures; the script is run once locally and the outputs are committed (≤ 1 KB each).

| Fixture | Contents | Build path |
|---|---|---|
| `sample.zip` | `hello.txt` ("hello\n"), `data/notes.md` ("# notes\n") | `client-zip` from JS |
| `sample.tar` | same | hand-rolled (uses our own `writeTar` — but written *manually as a build helper* to avoid circular dependency on the code under test for round-trip integrity) |
| `sample.tar.gz` | same | `writeTar` then `fflate.gzipSync` |
| `encrypted.zip` | `secret.txt`, password `test` | shell out to `zip -P test`; documented in script comment as the one external-tool dependency |
| `zip-slip.zip` | entry path `../escape.txt` | hand-written ZIP central directory + local file header (avoids needing a tool that produces malformed zips) |
| `huge-entry.zip` | header declares 2 GB uncompressed; payload is 32-byte sentinel | hand-written headers with forged size field |
| `bomb.zip` | 100 entries, each declaring 50 MB uncompressed; payloads ~32 bytes each | hand-written, generated in a loop |

**Build-script integrity note:** the `sample.*` fixtures *should not* round-trip through `_shared/tar`'s `writeTar` if we want `_shared/tar`'s `readTar` test to be meaningful. The build script therefore includes a **separate, minimal TAR-writer helper** (~20 LOC, inline in the build script) that the `_shared/tar/tar.test.ts` `readTar` tests run against. The `_shared/tar/tar.test.ts` round-trip test exercises `writeTar` → `readTar` separately. This keeps the `readTar` tests honest (they validate against a TAR writer that isn't the one under test).

The build script is run locally with `node tests/fixtures/archives/build.mjs`. Fixtures are committed to git; CI does not re-run the build script (matches `tests/fixtures/` convention).

### 4.4 Bundle isolation

`scripts/check-bundle-isolation.mjs` already enforces per-engine — picks up new engines automatically. Phase 24 verifies that:
- `_shared/tar` is not in the homepage chunk.
- `fflate` is dynamically imported only from engine workers (existing rule; the docx parser already exercises it).
- `client-zip` was already lazy-loaded by `_shared/zip/buildZipBlob`; new uses in `archive-create/worker.ts` follow the same pattern.

### 4.5 Verification gates (must be green before merge)

- `pnpm lint` `pnpm typecheck` `pnpm test` `pnpm test:e2e` all green.
- All seven fixtures behave as documented.
- Privacy E2E: zero outbound network during both engines' conversions.
- Bundle-isolation: `_shared/tar` and `fflate` not in homepage chunk.

## 5. Risks

1. **Hand-rolled TAR parser has an undiscovered edge case.** Mitigation: round-trip tests against real `tar` CLI fixtures; reject sparse files / bad checksums / truncation explicitly rather than silently misparsing. Risk is bounded by TAR's small surface and stable spec.
2. **`buildZipBlob` may currently flatten paths in entry names.** Need to verify during plan execution. If `client-zip` does flatten (it shouldn't — its API takes entry names verbatim), fall back to flat-path bundles for `archive-extract` output (worse UX but no spec amendment needed).
3. **Forged-size security fixtures (`huge-entry.zip`, `bomb.zip`) require careful binary construction.** If the build script gets brittle, alternative is to commit pre-built fixtures and stop regenerating them — but committed binary fixtures are harder to audit. Mitigation: build script is heavily commented and the resulting files are small enough to inspect with `xxd`.
4. **`fflate.unzip` async API ergonomics.** The streaming API is callback-based; wrapping it in a Promise that pre-reads the central directory before allocating uncompressed buffers is non-trivial. Fallback: parse the ZIP central directory by hand (~30 LOC; ZIP central-directory format is well-documented in the PKZIP APPNOTE) and keep `fflate` only for the per-entry decompression call.

## 6. Deviations from v2 spec §3.3

To be folded into the v2 spec amendment in Phase 26.

1. **`pako` removed from the library list.** `fflate` already provides gzip; shipping `pako` would be a redundant dep. v2 spec §3.3 currently reads "fflate (zip) + pako (gzip) + tar parser" — Phase 24 implements with fflate + hand-rolled tar (no pako).
2. **Aggregate-size cap added (2 GB total uncompressed).** v2 spec §3.3 only mandates per-entry > 1 GB rejection. Phase 24 adds a stricter aggregate guard to defend against many-files zip bombs. Stricter than spec → no spec change required, but the closeout amendment should document the actual implemented policy.
3. **GZIP-of-non-TAR rejected** (a bare `.gz` file is not extracted). Spec doesn't address this case; Phase 24 chooses to reject explicitly with an error pointing to standalone gunzip on the roadmap, rather than silently doing nothing.

## 7. Out of scope (deferred from Phase 24)

Beyond the v2-wide deferrals in the master spec §1.3:

- **Folder-structure preservation in `archive-create`.** Drag-drop folders flatten in v2 (matches the `pdf-merge` / `image-to-pdf` precedent). Nested-input archives are a v2.x candidate.
- **Encrypted-ZIP password input.** Encrypted ZIPs are rejected, full stop. No password UI in v2.
- **GZIP-of-non-TAR support** (a bare `log.txt.gz` file). Standalone gunzip is the future home for this case.
- **PAX extended attribute preservation.** Read path consumes-and-ignores PAX headers; we don't preserve extended attributes (mtime nanosecond precision, xattrs, file permissions beyond mode).
- **Standalone `gzip` / `gunzip` engines.** Already deferred per v2 spec §1.3.

## 8. Plan structure preview

The Phase 24 plan (generated next via `superpowers:writing-plans`) will follow the per-task verify-pass/fail pattern from Phases 22 and 23 and is expected to look approximately:

1. **Task 1** — `_shared/tar/` module: types, `readTar`, `writeTar`, co-located tests.
2. **Task 2** — fixtures: `tests/fixtures/archives/build.mjs`, run once, commit outputs.
3. **Task 3** — `archive-extract/` engine: descriptor, options, worker (format detect, validation, extract).
4. **Task 4** — `_shared/zip/buildZipBlob` + `ResultList` path-preservation extensions.
5. **Task 5** — `archive-create/` engine: descriptor, options, OptionsPanel, worker.
6. **Task 6** — Routes (`src/app/tools/archive-extract/page.tsx`, `archive-create/page.tsx`); sidebar `ARCHIVES` group; home-grid card additions.
7. **Task 7** — Privacy E2E + bundle-isolation extensions; full pre-merge verification gate.
