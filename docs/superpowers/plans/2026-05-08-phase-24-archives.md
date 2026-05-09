# Phase 24 — `archive-extract` + `archive-create` engines — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v2 Archives family — `archive-extract` (single archive in, multi files out) and `archive-create` (multi files in via StagingArea, single archive out) — plus the hand-rolled `_shared/tar/` module that both consume. Magic-byte format detection (ZIP / TAR / TAR.GZ / TGZ); encrypted-ZIP / zip-slip / per-entry-> 1 GB / aggregate-> 2 GB rejection on extract; `outputFormat` (zip default | tar.gz) + custom filename on create. Net new third-party deps for the phase: zero.

**Architecture:** `_shared/tar/` is a worker-only module exporting `readTar` / `writeTar` over POSIX ustar. `archive-extract` uses `fflate.unzip` (async, streaming) for ZIP and `_shared/tar` + `fflate.gunzip` for TAR / TAR.GZ; pre-flight enumerates entries from the central directory (ZIP) or header scan (TAR) before allocating any payload buffers, so the size guards run cheaply. `archive-create` uses `client-zip.downloadZip` for ZIP and `_shared/tar.writeTar` + `fflate.gzipSync` for TAR.GZ. Both engines are ephemeral `WorkerHarness` instances (no persistent state needed). `OutputItem.filename` preserves entry directory paths (e.g., `vacation/beach.jpg`) on extract; `ResultList` strips and dedupes paths only at per-item download time, while "Download all as zip" preserves them in the rebuild.

**Tech Stack:** React 19, Tailwind, `fflate` ^0.8.2 (already installed), `client-zip` ^2.5.0 (already installed), Comlink, Vitest + React Testing Library, Playwright, `@dnd-kit/core` + `@dnd-kit/sortable` (already installed; pdf-merge uses it).

**Hard constraints:**
- **No new third-party deps.** Plan deviates from v2 spec §3.3 by dropping `pako` (fflate already provides gzip). The `_shared/tar/` module is hand-rolled. If during execution it becomes apparent that hand-rolling will exceed ~250 LOC including tests, **stop and consult** before reaching for a TAR lib — the design assumed ~80–150 LOC.
- **Same-origin only.** No `fetch` from `src/engines/`. The existing privacy regression pattern enforces this; two new privacy specs land in this phase.
- **Worker-only `_shared/tar` and `fflate`.** Imports happen inside engine workers (`await import("@/engines/_shared/tar")`, `await import("fflate")`). `scripts/check-bundle-isolation.mjs` already enumerates engines under `src/engines/` and asserts none of them leak into the homepage chunk; run it after build to confirm.
- **`OutputItem.filename` preserves entry path.** Browsers cannot honor `/` in `<a download>` attrs, so `ResultList`'s per-item Download button strips and dedupes; "Download all as zip" preserves. This split is load-bearing for the design — don't shortcut it.
- **Branch discipline (per project memory `feedback_branch_discipline`).** This plan executes on the existing branch `phase-24-archives`. Implementer subagents must NOT run `git branch -m/-M` or `git checkout <branch>`. Verify before each commit: `git rev-parse --abbrev-ref HEAD` prints `phase-24-archives`.
- **No Claude attribution in commit messages** (per project memory `feedback_no_claude_in_commits`). No `Co-Authored-By: Claude`, no "Generated with Claude Code" footers. Body lines stay under 72 characters. Always `git commit` (never `--amend`, never `--no-verify`).
- **8 GB dev box discipline (per project memory `feedback_low_ram_dev_box`).** Run `pnpm test` and `pnpm test:e2e` serially. If memory pressure shows, cap vitest workers via `--pool=threads --poolOptions.threads.maxThreads=2`.

**Source spec:** `docs/superpowers/specs/2026-05-08-phase-24-archives-design.md` (approved 2026-05-08).

**Out of scope (this phase):**
- Folder-structure preservation in `archive-create` (`webkitRelativePath` flattens; document in tooltip).
- Encrypted-ZIP password input (rejected outright).
- GZIP-of-non-TAR support (a bare `.gz` file is rejected).
- PAX extended attribute preservation (xattrs, mtime nanoseconds, file modes beyond defaults).
- Standalone `gzip` / `gunzip` engines.

---

## File map

**Created:**

| Path | Responsibility |
|---|---|
| `src/engines/_shared/tar/index.ts` | `readTar` + `writeTar` + `TarEntry` type. POSIX ustar with PAX-consume-and-ignore + GNU `L` longname read support. Worker-only consumer; no DOM imports. |
| `src/engines/_shared/tar/index.test.ts` | Round-trip + real-`tar`-CLI fixture reads + sparse / bad-checksum / truncation rejections + writer 100-byte filename limit. |
| `src/engines/archive-extract/index.ts` | `SingleInputEngine`. Magic-byte validate; ephemeral `WorkerHarness`; `archiveSuffix: "-extract"`; `category: "archive"`. |
| `src/engines/archive-extract/index.test.ts` | Engine descriptor + `validate()` accepts/rejects fixtures by magic bytes (extension fallback). |
| `src/engines/archive-extract/options.ts` | `ArchiveExtractOptions = {}` (no user options) + `defaultArchiveExtractOptions`. Kept for shape symmetry with other engines. |
| `src/engines/archive-extract/options.test.ts` | Shape unit tests. |
| `src/engines/archive-extract/worker.ts` | Comlink-exposed `convertSingle`. Format detect → enumerate → guards → extract. |
| `src/engines/archive-extract/worker.test.ts` | Real conversions against committed fixtures (no mocks). All seven security + happy-path cases. |
| `src/app/tools/archive-extract/page.tsx` | `<ToolFrame engine={engine} />`. No persistent dispose effect needed (ephemeral harness). |
| `src/engines/archive-create/index.ts` | `MultiInputEngine`. Sum-cap validate; ephemeral `WorkerHarness`; `category: "archive"`. |
| `src/engines/archive-create/index.test.ts` | Engine descriptor + multi-input validate behaviour. |
| `src/engines/archive-create/options.ts` | `ArchiveCreateOptions = { outputFormat: "zip" | "tar.gz", filename: string }` + defaults + helpers. |
| `src/engines/archive-create/options.test.ts` | Shape unit tests + filename-validation helper tests. |
| `src/engines/archive-create/options-panel.tsx` | `ArchiveCreateOptionsPanel`: outputFormat radio group, filename text input, live preview, validation error styling. |
| `src/engines/archive-create/options-panel.test.tsx` | Render + interaction tests (default filename shape; format toggle updates preview; invalid filename surfaces error). |
| `src/engines/archive-create/staging-area.tsx` | `ArchiveCreateStagingArea`: thin file list (file name + size + remove + reorder via @dnd-kit) — no async per-row metadata loading. |
| `src/engines/archive-create/staging-area.test.tsx` | Render + reorder + remove tests. |
| `src/engines/archive-create/worker.ts` | Comlink-exposed `convertMulti`. Branches on `outputFormat`. |
| `src/engines/archive-create/worker.test.ts` | Real conversions: ZIP round-trip via `fflate.unzip`; TAR.GZ round-trip via `fflate.gunzip` + `readTar`; dedupe; sum-cap rejection. |
| `src/app/tools/archive-create/page.tsx` | `<ToolFrame engine={engine} />`. |
| `tests/fixtures/scripts/generate-archive-fixtures.mjs` | Deterministic fixture build (run-once locally; outputs committed). Includes its own minimal TAR-writer helper so `_shared/tar.readTar` tests verify against an independent writer. |
| `tests/fixtures/archives/sample.zip` | Happy path — `hello.txt` ("hello\n"), `data/notes.md` ("# notes\n"). |
| `tests/fixtures/archives/sample.tar` | Same payload, TAR variant. |
| `tests/fixtures/archives/sample.tar.gz` | Same payload, gzipped TAR. |
| `tests/fixtures/archives/encrypted.zip` | One file, password `test`. Built via shell-out to `zip -P` (one of the few fixtures that needs an external tool — documented in `SOURCES.md`). |
| `tests/fixtures/archives/zip-slip.zip` | One entry with path `../escape.txt`. Built by hand-writing ZIP local file header + central directory in JS. |
| `tests/fixtures/archives/huge-entry.zip` | One entry, header declares 2 GB uncompressed size. Hand-written headers with forged size field; 32-byte payload on disk. |
| `tests/fixtures/archives/bomb.zip` | 100 entries each declaring 50 MB uncompressed. Hand-written headers in a loop; small payloads on disk. |
| `tests/fixtures/archives/bare.gz` | A bare `.gz` (no TAR inside) for the GZIP-of-non-TAR rejection test. |
| `tests/fixtures/archives/SOURCES.md` | Provenance + regeneration commands + which fixtures need external tools. |
| `tests/fixtures/archives/tar-cli-sample.tar` | Real `tar` CLI output (run once; committed). Used by `_shared/tar.readTar` tests so the writer-under-test isn't validating itself. |
| `tests/fixtures/archives/tar-bad-checksum.tar` | `tar-cli-sample.tar` with one header byte flipped. Built by the fixture script. |
| `tests/fixtures/archives/tar-truncated.tar` | `tar-cli-sample.tar` cut mid-payload. Built by the fixture script. |
| `tests/fixtures/archives/tar-sparse.tar` | A sparse-file TAR (typeflag `S`). Built by the fixture script via hand-written headers. |
| `tests/e2e/archive-extract.spec.ts` | Drag-drop happy path + per-item download + "Download all as zip" + each security-rejection UI assertion. |
| `tests/e2e/archive-create.spec.ts` | Drag-drop multi-file → reorder → custom filename → Convert; format toggle → Convert. |
| `tests/e2e/privacy-regression-archive-extract.spec.ts` | Zero off-origin assertion during a real extract. |
| `tests/e2e/privacy-regression-archive-create.spec.ts` | Zero off-origin assertion during a real create. |

**Modified:**

| Path | Change |
|---|---|
| `src/engines/_shared/types.ts:35` | Add `"archive"` to `EngineCategory` union. |
| `src/engines/_shared/registry.ts` | Add `"archive-extract"` and `"archive-create"` to `EngineId` union and `REGISTRY` map. |
| `src/components/result-list.tsx` | Per-item Download button: strip `/`-prefix and dedupe basename collisions across the items list. "Download all as zip" path unchanged (entry names pass through verbatim to `client-zip`, which preserves `/`). |
| `src/components/result-list.test.tsx` | New tests covering path-strip + dedupe behaviour. |
| `src/components/layout/sidebar.tsx` | Add two `archive-*` entries under a new `ARCHIVES` group; insert `ARCHIVES` into `GROUP_ORDER` between `OCR` and `ABOUT`. |
| `src/app/page.tsx` | Append two new entries to `TOOLS`. |
| `tests/e2e/coop-coep.spec.ts` | Append `/tools/archive-extract` and `/tools/archive-create` to `TOOL_ROUTES`. |

**Untouched (verify zero edits in this phase's diff):**
- `vercel.json`, `next.config.ts`, `package.json` (no new deps), `pnpm-lock.yaml`.
- `src/engines/_shared/zip.ts` (verified during Task 4 that `client-zip` preserves `/` in entry names — should be a no-op verification; if it doesn't, scope creep outside this plan).
- `src/engines/_shared/harness.ts` (existing `WorkerHarness` API is sufficient).
- `scripts/check-bundle-isolation.mjs` (already enumerates engines under `src/engines/` automatically; new engines are picked up).
- All other engines under `src/engines/<id>/`.

**Project-pattern conformance (verified against `pdf-split/index.ts`, `pdf-merge/index.ts`, `audio-convert/index.ts`):**
- `validate(file | files)` is **synchronous**. Single returns `{ ok: true } | { ok: false, reason: string }`. Multi same shape but takes `File[]`.
- Engine type: `SingleInputEngine<TOptions, OutputItem[]>` for archive-extract; `MultiInputEngine<TOptions, OutputItem>` for archive-create.
- `convert(file | files, opts, signal)` — three positional args; ephemeral `WorkerHarness`; no `runOpts`.
- Per-engine `MAX_FILE_BYTES` constant lives in `index.ts` (no shared caps map exists — verified 2026-05-08).
- Multi-output engines set `archiveSuffix`. Single-output engines do not.
- `Comlink.expose(api)` at the bottom of `worker.ts`; harness wraps via `Comlink.wrap`.

---

## Task -1 (prerequisite): Create the working branch

**Why:** Task 1 Step 1.1 verifies the branch exists and STOPs otherwise. The branch must be created before the first subagent runs.

- [ ] **Step -1.1: From a clean `main`, create the branch.**

```bash
git rev-parse --abbrev-ref HEAD          # expect: main
git status --porcelain                    # expect: empty
git fetch origin
git pull --ff-only origin main
git checkout -b phase-24-archives
git rev-parse --abbrev-ref HEAD          # expect: phase-24-archives
```

Expected: branch created, HEAD switched. **This is the only place in Phase 24 that runs `git checkout`.** All subsequent tasks operate on the existing branch only — implementer subagents must NOT run `git checkout` or `git branch -m/-M`.

If running Phase 24 in a separate worktree (per memory `feedback_parallel_session_worktrees`):

```bash
git worktree add ../file_converter-phase-24 -b phase-24-archives origin/main
cd ../file_converter-phase-24
```

---

## Task 0: Type/registry prep (`EngineCategory: "archive"`)

**Why:** Both new engines reference `category: "archive"` from their first import. Land this prep edit alone first so every subsequent task's typecheck passes immediately.

**Files:**
- Modify: `src/engines/_shared/types.ts:35`

- [ ] **Step 0.1: Verify branch.**

```bash
git rev-parse --abbrev-ref HEAD          # expect: phase-24-archives
```

Expected: `phase-24-archives`. STOP if not — see Task -1.

- [ ] **Step 0.2: Add `"archive"` to `EngineCategory`.**

Edit `src/engines/_shared/types.ts:35` from:

```ts
export type EngineCategory = "image" | "pdf" | "document" | "audio" | "video" | "ocr";
```

to:

```ts
export type EngineCategory = "image" | "pdf" | "document" | "audio" | "video" | "ocr" | "archive";
```

- [ ] **Step 0.3: Verify typecheck still passes (no consumers regress).**

Run: `pnpm typecheck`
Expected: no errors. The union extension is purely additive.

- [ ] **Step 0.4: Commit.**

```bash
git add src/engines/_shared/types.ts
git commit -m "$(cat <<'EOF'
feat(engines): extend EngineCategory union with "archive"

Prep for Phase 24's archive-extract + archive-create engines.
Purely additive; no consumers regress.
EOF
)"
```

---

## Task 1: Hand-rolled `_shared/tar/` module

**Why:** Both new engines depend on `readTar` / `writeTar`. Land it first with thorough tests so subsequent tasks consume a known-good module.

**Files:**
- Create: `src/engines/_shared/tar/index.ts`
- Create: `src/engines/_shared/tar/index.test.ts`
- (Test fixtures land in Task 2; this task uses inline-constructed bytes for round-trip tests.)

- [ ] **Step 1.1: Write the public-surface types and skeleton.**

Create `src/engines/_shared/tar/index.ts`:

```ts
export type TarEntry = {
  /** POSIX-style path; forward slashes. Trailing `/` indicates a directory. */
  path: string;
  /** Declared payload bytes. 0 for directories. */
  size: number;
  /** Unix seconds; 0 if unknown. */
  mtime: number;
  type: "file" | "directory";
  /** Empty for directories. */
  payload: Uint8Array;
};

const BLOCK_SIZE = 512;
const TEXT_DECODER = new TextDecoder("utf-8");
const TEXT_ENCODER = new TextEncoder();

const TYPEFLAG_FILE_LEGACY = 0x00; // some writers emit NUL for files
const TYPEFLAG_FILE = "0".charCodeAt(0);
const TYPEFLAG_DIRECTORY = "5".charCodeAt(0);
const TYPEFLAG_LONGLINK_GNU = "L".charCodeAt(0);
const TYPEFLAG_PAX_HEADER = "x".charCodeAt(0);
const TYPEFLAG_PAX_GLOBAL = "g".charCodeAt(0);
const TYPEFLAG_SPARSE_GNU = "S".charCodeAt(0);

/** Read POSIX ustar / GNU TAR. Throws on bad checksum / truncation / sparse. */
export function readTar(buf: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  let pendingLongName: string | undefined;

  while (offset + BLOCK_SIZE <= buf.length) {
    const header = buf.subarray(offset, offset + BLOCK_SIZE);

    // Two consecutive zero blocks => end-of-archive.
    if (isZeroBlock(header)) {
      // Don't require a second zero block strictly — some tools omit. The
      // first zero block alone is a strong "end" signal.
      break;
    }

    verifyChecksum(header, offset);

    const typeFlag = header[156] ?? 0;

    if (typeFlag === TYPEFLAG_SPARSE_GNU) {
      throw new Error(
        `_shared/tar: sparse files (typeflag "S") are not supported (at byte ${offset})`,
      );
    }

    const declaredSize = parseOctal(header, 124, 12);
    const payloadStart = offset + BLOCK_SIZE;
    const payloadEnd = payloadStart + declaredSize;
    if (payloadEnd > buf.length) {
      throw new Error(
        `_shared/tar: entry payload truncated (need ${declaredSize} bytes at ${payloadStart}, only ${buf.length - payloadStart} available)`,
      );
    }
    const payload = buf.subarray(payloadStart, payloadEnd);
    const advance = BLOCK_SIZE + roundUp(declaredSize, BLOCK_SIZE);

    if (typeFlag === TYPEFLAG_PAX_HEADER || typeFlag === TYPEFLAG_PAX_GLOBAL) {
      // Consume and ignore PAX records — the next entry takes over.
      offset += advance;
      continue;
    }

    if (typeFlag === TYPEFLAG_LONGLINK_GNU) {
      pendingLongName = trimNul(TEXT_DECODER.decode(payload));
      offset += advance;
      continue;
    }

    const path = pendingLongName ?? readUstarPath(header);
    pendingLongName = undefined;
    const mtime = parseOctal(header, 136, 12);

    const isDirectory = typeFlag === TYPEFLAG_DIRECTORY || path.endsWith("/");
    entries.push({
      path,
      size: declaredSize,
      mtime,
      type: isDirectory ? "directory" : "file",
      payload: isDirectory ? new Uint8Array() : payload,
    });

    offset += advance;
  }

  return entries;
}

/** Write POSIX ustar. Throws on path > 100 bytes (no GNU longname on write). */
export function writeTar(entries: ReadonlyArray<TarEntry>): Uint8Array {
  let totalBytes = 0;
  for (const e of entries) {
    totalBytes += BLOCK_SIZE + roundUp(e.payload.length, BLOCK_SIZE);
  }
  totalBytes += BLOCK_SIZE * 2; // EOF (two zero blocks)

  const out = new Uint8Array(totalBytes);
  let offset = 0;
  for (const e of entries) {
    writeHeader(out, offset, e);
    if (e.type === "file") {
      out.set(e.payload, offset + BLOCK_SIZE);
    }
    offset += BLOCK_SIZE + roundUp(e.payload.length, BLOCK_SIZE);
  }
  // Final two zero blocks already zero-initialised.
  return out;
}

// ─── Internals ─────────────────────────────────────────────────────────────

function isZeroBlock(b: Uint8Array): boolean {
  for (let i = 0; i < b.length; i++) if (b[i] !== 0) return false;
  return true;
}

function verifyChecksum(header: Uint8Array, offsetForError: number): void {
  const declared = parseOctal(header, 148, 8);
  // Sum: replace bytes 148..156 with ASCII spaces (0x20) when computing.
  let sum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) {
    if (i >= 148 && i < 156) {
      sum += 0x20;
    } else {
      sum += header[i] ?? 0;
    }
  }
  if (sum !== declared) {
    throw new Error(
      `_shared/tar: header checksum mismatch at byte ${offsetForError} (declared ${declared}, computed ${sum})`,
    );
  }
}

function parseOctal(buf: Uint8Array, start: number, len: number): number {
  // ustar octal numeric fields are NUL- or space-terminated.
  let s = "";
  for (let i = 0; i < len; i++) {
    const c = buf[start + i] ?? 0;
    if (c === 0 || c === 0x20) {
      if (s.length > 0) break; // leading whitespace allowed
      continue;
    }
    s += String.fromCharCode(c);
  }
  if (s.length === 0) return 0;
  const n = Number.parseInt(s, 8);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`_shared/tar: invalid octal field "${s}"`);
  }
  return n;
}

function readUstarPath(header: Uint8Array): string {
  const name = trimNul(TEXT_DECODER.decode(header.subarray(0, 100)));
  // ustar prefix field at 345..500
  const magic = TEXT_DECODER.decode(header.subarray(257, 263));
  if (magic === "ustar " || magic === "ustar ") {
    const prefix = trimNul(TEXT_DECODER.decode(header.subarray(345, 500)));
    if (prefix.length > 0) return `${prefix}/${name}`;
  }
  return name;
}

function trimNul(s: string): string {
  const i = s.indexOf(" ");
  return i === -1 ? s : s.slice(0, i);
}

function roundUp(n: number, mult: number): number {
  if (n === 0) return 0;
  const r = n % mult;
  return r === 0 ? n : n + (mult - r);
}

function writeHeader(out: Uint8Array, offset: number, e: TarEntry): void {
  const pathBytes = TEXT_ENCODER.encode(e.path);
  if (pathBytes.length > 100) {
    throw new Error(
      `_shared/tar: filename > 100 bytes not supported on write ("${e.path}", ${pathBytes.length} bytes); rename or shorten`,
    );
  }
  out.set(pathBytes, offset); // bytes 0..100 — name

  // mode (octal 0644 / 0755)
  writeOctal(out, offset + 100, 8, e.type === "directory" ? 0o755 : 0o644);
  // uid, gid: 0
  writeOctal(out, offset + 108, 8, 0);
  writeOctal(out, offset + 116, 8, 0);
  // size
  writeOctal(out, offset + 124, 12, e.payload.length);
  // mtime
  writeOctal(out, offset + 136, 12, e.mtime);
  // checksum field: filled with spaces during sum, then written.
  for (let i = 148; i < 156; i++) out[offset + i] = 0x20;
  // typeflag
  out[offset + 156] = e.type === "directory" ? TYPEFLAG_DIRECTORY : TYPEFLAG_FILE;
  // linkname (offset 157..257): zeros
  // ustar magic + version
  out.set(TEXT_ENCODER.encode("ustar "), offset + 257);
  out.set(TEXT_ENCODER.encode("00"), offset + 263);
  // uname / gname (zeros are fine for both)
  // devmajor / devminor (zeros)
  writeOctal(out, offset + 329, 8, 0);
  writeOctal(out, offset + 337, 8, 0);
  // prefix (zeros — filenames > 100 bytes already rejected)

  // Compute checksum: 8-bit unsigned sum of all 512 bytes with the checksum
  // field treated as 8 spaces (already in place).
  let sum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) sum += out[offset + i] ?? 0;
  // Write checksum: 6 octal digits, NUL, space.
  const digits = sum.toString(8).padStart(6, "0");
  for (let i = 0; i < 6; i++) out[offset + 148 + i] = digits.charCodeAt(i);
  out[offset + 154] = 0;
  out[offset + 155] = 0x20;
}

function writeOctal(out: Uint8Array, start: number, len: number, value: number): void {
  // ustar octal fields are NUL-terminated (or space-padded). Convention:
  // (len-1) digits + NUL terminator.
  const digits = value.toString(8).padStart(len - 1, "0");
  for (let i = 0; i < len - 1; i++) out[start + i] = digits.charCodeAt(i);
  out[start + len - 1] = 0;
}
```

- [ ] **Step 1.2: Write the failing tests.**

Create `src/engines/_shared/tar/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type TarEntry, readTar, writeTar } from "./index";

const enc = new TextEncoder();

describe("_shared/tar round-trip", () => {
  it("write+read returns structurally equal entries", () => {
    const entries: TarEntry[] = [
      {
        path: "hello.txt",
        size: 6,
        mtime: 1700000000,
        type: "file",
        payload: enc.encode("hello\n"),
      },
      {
        path: "data/notes.md",
        size: 8,
        mtime: 1700000001,
        type: "file",
        payload: enc.encode("# notes\n"),
      },
    ];
    const buf = writeTar(entries);
    const read = readTar(buf);
    expect(read).toHaveLength(2);
    expect(read[0]?.path).toBe("hello.txt");
    expect(read[0]?.type).toBe("file");
    expect(new TextDecoder().decode(read[0]?.payload)).toBe("hello\n");
    expect(read[1]?.path).toBe("data/notes.md");
    expect(new TextDecoder().decode(read[1]?.payload)).toBe("# notes\n");
  });

  it("round-trips a single zero-length file", () => {
    const entries: TarEntry[] = [
      { path: "empty.txt", size: 0, mtime: 0, type: "file", payload: new Uint8Array() },
    ];
    const buf = writeTar(entries);
    const read = readTar(buf);
    expect(read).toHaveLength(1);
    expect(read[0]?.size).toBe(0);
    expect(read[0]?.payload).toHaveLength(0);
  });

  it("write throws on filename > 100 bytes", () => {
    const longPath = `${"a".repeat(101)}.txt`;
    expect(() =>
      writeTar([{ path: longPath, size: 0, mtime: 0, type: "file", payload: new Uint8Array() }]),
    ).toThrow(/> 100 bytes/);
  });

  it("payload sizes that aren't multiples of 512 round-trip with correct padding", () => {
    const entries: TarEntry[] = [
      {
        path: "odd.bin",
        size: 513,
        mtime: 0,
        type: "file",
        payload: new Uint8Array(513).fill(0xab),
      },
    ];
    const buf = writeTar(entries);
    expect(buf.length).toBe(512 + 1024 + 1024); // header + 2 padded blocks + 2 EOF
    const read = readTar(buf);
    expect(read[0]?.payload.length).toBe(513);
    expect(read[0]?.payload[512]).toBe(0xab);
  });
});

describe("_shared/tar read errors", () => {
  it("throws on bit-flipped header (checksum mismatch)", () => {
    const buf = writeTar([
      { path: "a.txt", size: 1, mtime: 0, type: "file", payload: enc.encode("X") },
    ]);
    // Flip one byte in the name field.
    const corrupted = new Uint8Array(buf);
    corrupted[0] = corrupted[0] === 0x61 ? 0x62 : 0x61;
    expect(() => readTar(corrupted)).toThrow(/checksum mismatch/);
  });

  it("throws when payload is truncated", () => {
    const buf = writeTar([
      { path: "a.bin", size: 100, mtime: 0, type: "file", payload: new Uint8Array(100).fill(0xab) },
    ]);
    // Cut off mid-payload.
    const truncated = buf.slice(0, 512 + 50);
    expect(() => readTar(truncated)).toThrow(/truncated/);
  });
});
```

- [ ] **Step 1.3: Run the tests.**

Run: `pnpm test src/engines/_shared/tar/`
Expected: PASS — round-trip + zero-length + 100-byte limit + odd-size padding + checksum mismatch + truncation. (Sparse-file and PAX/longname behaviour land in Task 2 once the fixtures exist.)

- [ ] **Step 1.4: Lint + typecheck.**

Run: `pnpm lint src/engines/_shared/tar/ && pnpm typecheck`
Expected: clean.

- [ ] **Step 1.5: Commit.**

```bash
git add src/engines/_shared/tar/
git commit -m "$(cat <<'EOF'
feat(_shared/tar): hand-rolled POSIX ustar reader + writer

Worker-only module backing Phase 24's archive engines. Round-trip,
checksum, padding, and truncation cases covered. Writer rejects
filenames > 100 bytes (no GNU longname on write); reader supports
PAX consume-and-ignore + GNU longname read (exercised in Task 2).
EOF
)"
```

---

## Task 2: Fixture build script + commit fixture binaries

**Why:** Tasks 3 and beyond exercise real fixtures. Land the fixtures + build script first so subsequent tests reference real bytes from their first failing run.

**Files:**
- Create: `tests/fixtures/scripts/generate-archive-fixtures.mjs`
- Create: `tests/fixtures/archives/SOURCES.md`
- Create: 11 fixture binaries listed in the file map.

- [ ] **Step 2.1: Write `SOURCES.md` documenting provenance.**

Create `tests/fixtures/archives/SOURCES.md`:

```markdown
# Archive fixtures

Built deterministically by `tests/fixtures/scripts/generate-archive-fixtures.mjs`.

Run: `node tests/fixtures/scripts/generate-archive-fixtures.mjs`
Re-run after `_shared/tar` changes that affect byte-level format
(none expected — POSIX ustar is stable).

## Happy-path fixtures (3)

| File | Contents |
|---|---|
| `sample.zip` | `hello.txt` ("hello\n"), `data/notes.md` ("# notes\n") |
| `sample.tar` | same |
| `sample.tar.gz` | same |

## Security fixtures (4)

| File | Built via | Purpose |
|---|---|---|
| `encrypted.zip` | shell-out to `zip -P test` | Encrypted-rejection test |
| `zip-slip.zip` | hand-written ZIP local + central headers | Zip-slip rejection test |
| `huge-entry.zip` | hand-written ZIP central directory with forged 2 GB size field | Per-entry-cap rejection |
| `bomb.zip` | hand-written: 100 entries × forged 50 MB each | Aggregate-cap rejection |
| `bare.gz` | `fflate.gzipSync` of "hello\n" | GZIP-of-non-TAR rejection |

## TAR-format fixtures (4)

| File | Built via | Purpose |
|---|---|---|
| `tar-cli-sample.tar` | shell-out to `tar -cf` (the *only* fixture not built by JS) | `_shared/tar.readTar` validated against an independent writer |
| `tar-bad-checksum.tar` | `tar-cli-sample.tar` with one byte flipped | Bad-checksum rejection |
| `tar-truncated.tar` | `tar-cli-sample.tar` cut mid-payload | Truncation rejection |
| `tar-sparse.tar` | hand-written headers with typeflag `S` | Sparse-file rejection |

## External tools required to regenerate

- `zip` (Info-ZIP) for `encrypted.zip`. Available via Homebrew (`brew install zip`)
  or Linux package managers. Built once locally; the resulting file is committed.
- `tar` (BSD or GNU) for `tar-cli-sample.tar`. Universally available.

The build script reports what it skipped if these tools are absent — but the
committed fixtures are the source of truth for tests, so missing tools only
matter when regenerating.
```

- [ ] **Step 2.2: Write `generate-archive-fixtures.mjs`.**

Create `tests/fixtures/scripts/generate-archive-fixtures.mjs`:

```js
#!/usr/bin/env node
/**
 * Deterministic archive fixture generator.
 *
 * Run from repo root: node tests/fixtures/scripts/generate-archive-fixtures.mjs
 *
 * Produces all fixtures under tests/fixtures/archives/. Idempotent —
 * re-running overwrites existing files with byte-identical output (mtime is
 * pinned to FIXED_MTIME below; gzip is invoked with no timestamp).
 *
 * The TAR helpers in this script are intentionally INDEPENDENT of
 * src/engines/_shared/tar/ so the readTar tests verify against bytes that
 * weren't produced by writeTar.
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "fflate";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = path.join(ROOT, "tests/fixtures/archives");
mkdirSync(OUT, { recursive: true });

const FIXED_MTIME = 0; // pin for byte-stable output
const enc = new TextEncoder();

// ── Independent minimal TAR writer (NOT _shared/tar). ──────────────────────
// Used to build tar-sparse.tar header and the round-trip fixtures' inner tars.
function buildTarHeader({ path: p, size, mtime, typeflag }) {
  const block = new Uint8Array(512);
  const nameBytes = enc.encode(p);
  if (nameBytes.length > 100) throw new Error(`fixture name too long: ${p}`);
  block.set(nameBytes, 0);
  writeOctal(block, 100, 8, 0o644); // mode
  writeOctal(block, 108, 8, 0); // uid
  writeOctal(block, 116, 8, 0); // gid
  writeOctal(block, 124, 12, size);
  writeOctal(block, 136, 12, mtime);
  for (let i = 148; i < 156; i++) block[i] = 0x20; // checksum spaces
  block[156] = typeflag;
  block.set(enc.encode("ustar "), 257);
  block.set(enc.encode("00"), 263);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += block[i];
  const digits = sum.toString(8).padStart(6, "0");
  for (let i = 0; i < 6; i++) block[148 + i] = digits.charCodeAt(i);
  block[154] = 0;
  block[155] = 0x20;
  return block;
}
function writeOctal(buf, start, len, value) {
  const digits = value.toString(8).padStart(len - 1, "0");
  for (let i = 0; i < len - 1; i++) buf[start + i] = digits.charCodeAt(i);
  buf[start + len - 1] = 0;
}
function buildTar(entries) {
  const blocks = [];
  for (const e of entries) {
    blocks.push(buildTarHeader({
      path: e.path,
      size: e.payload.length,
      mtime: FIXED_MTIME,
      typeflag: 0x30, // "0"
    }));
    blocks.push(e.payload);
    const pad = (512 - (e.payload.length % 512)) % 512;
    if (pad) blocks.push(new Uint8Array(pad));
  }
  blocks.push(new Uint8Array(1024)); // EOF
  return concat(blocks);
}
function concat(arrs) {
  const total = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

// ── Happy-path fixtures ────────────────────────────────────────────────────

const HELLO = enc.encode("hello\n");
const NOTES = enc.encode("# notes\n");

// sample.tar — built via the independent helper.
const sampleTar = buildTar([
  { path: "hello.txt", payload: HELLO },
  { path: "data/notes.md", payload: NOTES },
]);
writeFileSync(path.join(OUT, "sample.tar"), sampleTar);

// sample.tar.gz — gzip the tar with mtime=0 to pin output.
writeFileSync(path.join(OUT, "sample.tar.gz"), gzipSync(sampleTar, { mtime: 0 }));

// sample.zip — hand-built minimal ZIP (deflate would introduce stream
// nondeterminism; we use stored / no-compression for byte stability).
writeFileSync(path.join(OUT, "sample.zip"), buildStoredZip([
  { name: "hello.txt", data: HELLO },
  { name: "data/notes.md", data: NOTES },
]));

// ── Security fixtures ──────────────────────────────────────────────────────

// zip-slip.zip — hand-written, single entry with malicious path.
writeFileSync(path.join(OUT, "zip-slip.zip"), buildStoredZip([
  { name: "../escape.txt", data: enc.encode("escaped\n") },
]));

// huge-entry.zip — central directory declares 2 GB uncompressed; on-disk
// payload is just the 32-byte sentinel.
writeFileSync(path.join(OUT, "huge-entry.zip"), buildForgedSizeZip({
  name: "huge.bin",
  declaredUncompressed: 2_000_000_000,
  realPayload: enc.encode("forged-uncompressed-size-sentinel"),
}));

// bomb.zip — 100 entries each declaring 50 MB.
const bombEntries = [];
for (let i = 0; i < 100; i++) {
  bombEntries.push({ name: `entry-${i}.bin`, declaredUncompressed: 50_000_000 });
}
writeFileSync(path.join(OUT, "bomb.zip"), buildBombZip(bombEntries));

// bare.gz — gzip of "hello\n", no TAR underneath.
writeFileSync(path.join(OUT, "bare.gz"), gzipSync(HELLO, { mtime: 0 }));

// encrypted.zip — built via shell-out to `zip -P test`.
try {
  const tmp = path.join(OUT, "_tmp-encrypted-source.txt");
  writeFileSync(tmp, "secret\n");
  const out = path.join(OUT, "encrypted.zip");
  // -j: junk path; -P: password
  execSync(`cd "${OUT}" && rm -f encrypted.zip && zip -j -q -P test encrypted.zip _tmp-encrypted-source.txt`);
  execSync(`rm "${tmp}"`);
  console.log("✓ encrypted.zip (via zip -P)");
} catch (err) {
  console.warn(`! skipped encrypted.zip — install Info-ZIP \`zip\` and re-run (${err.message})`);
}

// ── TAR-format fixtures ────────────────────────────────────────────────────

// tar-cli-sample.tar — built via shell-out to `tar -cf`. Independent of
// _shared/tar.writeTar so the readTar tests verify against an outside writer.
try {
  const tmpDir = path.join(OUT, "_tmp-tar-src");
  execSync(`rm -rf "${tmpDir}" && mkdir -p "${tmpDir}/data"`);
  writeFileSync(path.join(tmpDir, "hello.txt"), HELLO);
  writeFileSync(path.join(tmpDir, "data/notes.md"), NOTES);
  // -C to scope, --mtime=0 + --numeric-owner + --uid/--gid for determinism
  // (BSD tar lacks --mtime; GNU tar has it. Try GNU first; fall back.)
  const cmd = process.platform === "darwin"
    ? `cd "${tmpDir}" && COPYFILE_DISABLE=1 tar -cf "${path.join(OUT, "tar-cli-sample.tar")}" hello.txt data/notes.md`
    : `cd "${tmpDir}" && tar --mtime='1970-01-01' --owner=0 --group=0 --numeric-owner -cf "${path.join(OUT, "tar-cli-sample.tar")}" hello.txt data/notes.md`;
  execSync(cmd);
  execSync(`rm -rf "${tmpDir}"`);
  console.log("✓ tar-cli-sample.tar");
} catch (err) {
  console.warn(`! skipped tar-cli-sample.tar — install tar and re-run (${err.message})`);
}

// tar-bad-checksum.tar — flip one byte of the first header.
try {
  const buf = readBuf(path.join(OUT, "tar-cli-sample.tar"));
  const corrupted = new Uint8Array(buf);
  corrupted[0] = corrupted[0] === 0x61 ? 0x62 : 0x61;
  writeFileSync(path.join(OUT, "tar-bad-checksum.tar"), corrupted);
  console.log("✓ tar-bad-checksum.tar");
} catch {
  console.warn("! skipped tar-bad-checksum.tar (depends on tar-cli-sample.tar)");
}

// tar-truncated.tar — first header (512) + first 50 bytes of payload only.
try {
  const buf = readBuf(path.join(OUT, "tar-cli-sample.tar"));
  writeFileSync(path.join(OUT, "tar-truncated.tar"), buf.slice(0, 512 + 50));
  console.log("✓ tar-truncated.tar");
} catch {
  console.warn("! skipped tar-truncated.tar (depends on tar-cli-sample.tar)");
}

// tar-sparse.tar — hand-written single header with typeflag "S".
{
  const header = buildTarHeader({
    path: "sparse.bin",
    size: 100,
    mtime: 0,
    typeflag: 0x53, // "S"
  });
  writeFileSync(path.join(OUT, "tar-sparse.tar"), concat([header, new Uint8Array(512), new Uint8Array(1024)]));
  console.log("✓ tar-sparse.tar");
}

console.log("\nAll fixtures written to tests/fixtures/archives/");

// ── Helpers ────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
function readBuf(p) { return new Uint8Array(readFileSync(p)); }

// Minimal STORED-only ZIP writer. Stable byte output (no deflate randomness).
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function buildStoredZip(entries) {
  const localBlocks = [];
  const centralBlocks = [];
  let offset = 0;
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const c = crc32(e.data);
    const local = new Uint8Array(30 + nameBytes.length + e.data.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true); // local sig
    dv.setUint16(4, 20, true); // version
    dv.setUint16(6, 0, true); // gp flag
    dv.setUint16(8, 0, true); // method = stored
    dv.setUint16(10, 0, true); // mod time
    dv.setUint16(12, 0, true); // mod date
    dv.setUint32(14, c, true); // crc
    dv.setUint32(18, e.data.length, true); // compressed
    dv.setUint32(22, e.data.length, true); // uncompressed
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true); // extra
    local.set(nameBytes, 30);
    local.set(e.data, 30 + nameBytes.length);
    localBlocks.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(central.buffer);
    cdv.setUint32(0, 0x02014b50, true); // central sig
    cdv.setUint16(4, 20, true); // version made by
    cdv.setUint16(6, 20, true); // version needed
    cdv.setUint16(8, 0, true); // gp flag
    cdv.setUint16(10, 0, true); // method
    cdv.setUint16(12, 0, true);
    cdv.setUint16(14, 0, true);
    cdv.setUint32(16, c, true);
    cdv.setUint32(20, e.data.length, true);
    cdv.setUint32(24, e.data.length, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint16(30, 0, true); // extra
    cdv.setUint16(32, 0, true); // comment
    cdv.setUint16(34, 0, true); // disk
    cdv.setUint16(36, 0, true); // internal attrs
    cdv.setUint32(38, 0, true); // external attrs
    cdv.setUint32(42, offset, true); // local header offset
    central.set(nameBytes, 46);
    centralBlocks.push(central);
    offset += local.length;
  }
  const central = concat(centralBlocks);
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(4, 0, true); edv.setUint16(6, 0, true);
  edv.setUint16(8, entries.length, true);
  edv.setUint16(10, entries.length, true);
  edv.setUint32(12, central.length, true);
  edv.setUint32(16, offset, true);
  edv.setUint16(20, 0, true);
  return concat([...localBlocks, central, eocd]);
}
// Forge `declaredUncompressed` in the central directory for huge-entry/bomb.
function buildForgedSizeZip({ name, declaredUncompressed, realPayload }) {
  // Build a stored ZIP, then patch the central directory's uncompressed-size
  // field to the forged value. The local header keeps the real (small) size
  // so the file still parses; pre-flight should read the central directory.
  const buf = buildStoredZip([{ name, data: realPayload }]);
  const dv = new DataView(buf.buffer);
  // Find the central directory: scan back for EOCD signature.
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset < 0) throw new Error("EOCD not found");
  const cdOffset = dv.getUint32(eocdOffset + 16, true);
  // Central record's uncompressed-size field is at offset +24 from the record start.
  dv.setUint32(cdOffset + 24, declaredUncompressed >>> 0, true);
  return buf;
}
function buildBombZip(entries) {
  // Write each entry with a tiny payload, then forge each central record's
  // uncompressed size field.
  const realPayload = enc.encode("x");
  const buf = buildStoredZip(entries.map((e) => ({ name: e.name, data: realPayload })));
  const dv = new DataView(buf.buffer);
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
  }
  let cdOffset = dv.getUint32(eocdOffset + 16, true);
  for (const e of entries) {
    dv.setUint32(cdOffset + 24, e.declaredUncompressed >>> 0, true);
    // Advance to next central record: 46 + nameLen + extraLen + commentLen.
    const nameLen = dv.getUint16(cdOffset + 28, true);
    const extraLen = dv.getUint16(cdOffset + 30, true);
    const commentLen = dv.getUint16(cdOffset + 32, true);
    cdOffset += 46 + nameLen + extraLen + commentLen;
  }
  return buf;
}
```

- [ ] **Step 2.3: Run the build script.**

Run: `node tests/fixtures/scripts/generate-archive-fixtures.mjs`
Expected: ~10 lines of "✓ <fixture>" output. If `zip` or `tar` is missing, the script warns and skips those fixtures — install via `brew install zip` (macOS) and re-run; both are required.

- [ ] **Step 2.4: Verify fixture sizes are sane (each < 1 MB except bomb.zip < 10 KB).**

Run: `ls -la tests/fixtures/archives/`
Expected: each file < 1 MB. `huge-entry.zip` and `bomb.zip` are tiny on disk despite their forged headers.

- [ ] **Step 2.5: Add PAX consume-and-ignore + sparse rejection tests to `_shared/tar/index.test.ts`.**

Append to `src/engines/_shared/tar/index.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";

describe("_shared/tar against tar(1) CLI fixture", () => {
  it("reads tar-cli-sample.tar (independent writer)", () => {
    const buf = new Uint8Array(
      readFileSync(path.resolve(__dirname, "../../../../tests/fixtures/archives/tar-cli-sample.tar")),
    );
    const entries = readTar(buf);
    const byName = new Map(entries.map((e) => [e.path, e]));
    expect(byName.get("hello.txt")?.payload).toEqual(enc.encode("hello\n"));
    expect(byName.get("data/notes.md")?.payload).toEqual(enc.encode("# notes\n"));
  });

  it("throws on tar-bad-checksum.tar", () => {
    const buf = new Uint8Array(
      readFileSync(path.resolve(__dirname, "../../../../tests/fixtures/archives/tar-bad-checksum.tar")),
    );
    expect(() => readTar(buf)).toThrow(/checksum mismatch/);
  });

  it("throws on tar-truncated.tar", () => {
    const buf = new Uint8Array(
      readFileSync(path.resolve(__dirname, "../../../../tests/fixtures/archives/tar-truncated.tar")),
    );
    expect(() => readTar(buf)).toThrow(/truncated/);
  });

  it("throws on tar-sparse.tar", () => {
    const buf = new Uint8Array(
      readFileSync(path.resolve(__dirname, "../../../../tests/fixtures/archives/tar-sparse.tar")),
    );
    expect(() => readTar(buf)).toThrow(/sparse/);
  });
});
```

- [ ] **Step 2.6: Run the tar tests against the new fixtures.**

Run: `pnpm test src/engines/_shared/tar/`
Expected: PASS — all round-trip + fixture-driven cases green.

- [ ] **Step 2.7: Commit fixtures + script.**

```bash
git add tests/fixtures/archives/ tests/fixtures/scripts/generate-archive-fixtures.mjs
git commit -m "$(cat <<'EOF'
test(fixtures): add archive fixtures + deterministic build script

11 fixtures for Phase 24 archive engines: 3 happy-path, 5 security,
4 TAR-format. Build script is idempotent; encrypted.zip and
tar-cli-sample.tar require Info-ZIP + tar(1) but the committed files
are the source of truth for tests.
EOF
)"
```

---

## Task 3: `archive-extract` engine — descriptor, options, validation

**Why:** Land the small files first so Task 4 (worker) can land alone with focused tests.

**Files:**
- Create: `src/engines/archive-extract/options.ts`
- Create: `src/engines/archive-extract/options.test.ts`
- Create: `src/engines/archive-extract/index.ts`
- Create: `src/engines/archive-extract/index.test.ts`
- Modify: `src/engines/_shared/registry.ts`

- [ ] **Step 3.1: Write `options.ts`.**

```ts
// src/engines/archive-extract/options.ts
export type ArchiveExtractOptions = Record<string, never>;

export const defaultArchiveExtractOptions: ArchiveExtractOptions = {};
```

- [ ] **Step 3.2: Write `options.test.ts`.**

```ts
// src/engines/archive-extract/options.test.ts
import { describe, expect, it } from "vitest";
import { defaultArchiveExtractOptions } from "./options";

describe("ArchiveExtractOptions", () => {
  it("default is an empty object", () => {
    expect(defaultArchiveExtractOptions).toEqual({});
  });
});
```

- [ ] **Step 3.3: Write `index.ts` (descriptor + validate).**

```ts
// src/engines/archive-extract/index.ts
import { WorkerHarness } from "@/engines/_shared/harness";
import type { OutputItem, SingleInputEngine } from "@/engines/_shared/types";
import { type ArchiveExtractOptions, defaultArchiveExtractOptions } from "./options";

const MAX_FILE_BYTES = 200 * 1_000_000;

const ACCEPT_EXT = [".zip", ".tar", ".tar.gz", ".tgz"];
const ACCEPT_MIME = [
  "application/zip",
  "application/x-zip-compressed",
  "application/x-tar",
  "application/gzip",
  "application/x-gzip",
  "application/x-compressed-tar",
];

const engine: SingleInputEngine<ArchiveExtractOptions, OutputItem[]> = {
  id: "archive-extract",
  inputAccept: ACCEPT_EXT,
  inputMime: ACCEPT_MIME,
  outputMime: "application/octet-stream",
  defaultOptions: defaultArchiveExtractOptions,
  archiveSuffix: "-extract",
  category: "archive",
  library: "fflate, in-house tar",
  license: "MIT",
  cardinality: "single",
  validate(file) {
    const lowerName = file.name.toLowerCase();
    const extOk = ACCEPT_EXT.some((ext) => lowerName.endsWith(ext));
    const mimeOk = ACCEPT_MIME.includes(file.type);
    if (!extOk && !mimeOk) {
      return { ok: false, reason: "Expected a .zip, .tar, .tar.gz, or .tgz file" };
    }
    if (file.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        reason: `File too large for archive-extract (limit 200 MB; got ${(file.size / 1_000_000).toFixed(1)} MB).`,
      };
    }
    return { ok: true };
  },
  async convert(file, opts, signal) {
    const harness = new WorkerHarness<ArchiveExtractOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    );
    const result = await harness.runSingle(file, opts, signal);
    return Array.isArray(result) ? result : [result];
  },
};

export default engine;
```

- [ ] **Step 3.4: Write `index.test.ts`.**

```ts
// src/engines/archive-extract/index.test.ts
import { describe, expect, it } from "vitest";
import engine from "./index";

describe("archive-extract engine descriptor", () => {
  it("declares cardinality, category, archiveSuffix", () => {
    expect(engine.id).toBe("archive-extract");
    expect(engine.cardinality).toBe("single");
    expect(engine.category).toBe("archive");
    expect(engine.archiveSuffix).toBe("-extract");
  });

  it("validates by extension or MIME (lenient)", () => {
    expect(
      engine.validate(new File([], "foo.zip", { type: "application/zip" }), {}).ok,
    ).toBe(true);
    expect(
      engine.validate(new File([], "foo.zip", { type: "" }), {}).ok,
    ).toBe(true); // ext alone
    expect(
      engine.validate(new File([], "foo.bin", { type: "application/zip" }), {}).ok,
    ).toBe(true); // mime alone
    expect(
      engine.validate(new File([], "foo.tar.gz", { type: "" }), {}).ok,
    ).toBe(true);
    expect(
      engine.validate(new File([], "foo.tgz", { type: "" }), {}).ok,
    ).toBe(true);
    expect(
      engine.validate(new File([], "foo.txt", { type: "text/plain" }), {}).ok,
    ).toBe(false);
  });

  it("rejects files > 200 MB", () => {
    const big = new File([new Uint8Array(1)], "big.zip", { type: "application/zip" });
    Object.defineProperty(big, "size", { value: 250 * 1_000_000 });
    const result = engine.validate(big, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/limit 200 MB/);
  });
});
```

- [ ] **Step 3.5: Add to registry.**

Edit `src/engines/_shared/registry.ts`:
- Add `"archive-extract"` to the `EngineId` union (alphabetical: between `"audio-trim"` and `"docx-to-txt"`).
- Add `"archive-extract": () => import("@/engines/archive-extract"),` to `REGISTRY`.

- [ ] **Step 3.6: Run tests + typecheck.**

Run: `pnpm test src/engines/archive-extract/ && pnpm typecheck`
Expected: PASS. Worker import in `index.ts` resolves at type level (the actual `worker.ts` is missing — TS treats `new Worker(new URL(...))` as a runtime concern; bundler resolution happens at build time).

If typecheck fails because `import("@/engines/archive-extract")` can't resolve without a `worker.ts`, create a stub `worker.ts` containing only `import * as Comlink from "comlink"; Comlink.expose({});` to unblock typecheck. Replace it for real in Task 4.

- [ ] **Step 3.7: Commit.**

```bash
git add src/engines/archive-extract/ src/engines/_shared/registry.ts
git commit -m "$(cat <<'EOF'
feat(archive-extract): engine descriptor + validate + registry entry

200 MB cap, lenient (ext OR MIME) validate, archiveSuffix "-extract"
for the multi-output download bundle. Worker lands in next commit.
EOF
)"
```

---

## Task 4: `archive-extract` worker — format detect, validation, extract

**Why:** This is the core of the engine. Implement it test-first using the fixtures from Task 2.

**Files:**
- Create (or replace stub from Task 3.6): `src/engines/archive-extract/worker.ts`
- Create: `src/engines/archive-extract/worker.test.ts`

- [ ] **Step 4.1: Write the failing tests.**

Create `src/engines/archive-extract/worker.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Test the worker's pure logic by importing it directly. We don't go through
// Comlink in unit tests — that's exercised in the E2E.
//
// To keep the worker module importable from a Node test context (it imports
// "comlink" and calls Comlink.expose at the bottom), we rely on the test runner
// not actually executing the side-effecting Comlink.expose in jsdom. Vitest +
// jsdom is fine here since `expose` only attaches a `message` listener to
// `globalThis`, which is harmless in tests.
import { extractArchive } from "./worker";

const FIX = path.resolve(__dirname, "../../../tests/fixtures/archives");
function readFix(name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIX, name)));
}

describe("archive-extract: happy paths", () => {
  it("extracts sample.zip", async () => {
    const out = await extractArchive(readFix("sample.zip").buffer, "sample.zip", "application/zip");
    expect(out.map((o) => o.filename).sort()).toEqual(["data/notes.md", "hello.txt"]);
    const hello = out.find((o) => o.filename === "hello.txt");
    expect(await hello?.blob.text()).toBe("hello\n");
  });

  it("extracts sample.tar", async () => {
    const out = await extractArchive(readFix("sample.tar").buffer, "sample.tar", "application/x-tar");
    expect(out.map((o) => o.filename).sort()).toEqual(["data/notes.md", "hello.txt"]);
  });

  it("extracts sample.tar.gz", async () => {
    const out = await extractArchive(readFix("sample.tar.gz").buffer, "sample.tar.gz", "application/gzip");
    expect(out.map((o) => o.filename).sort()).toEqual(["data/notes.md", "hello.txt"]);
  });
});

describe("archive-extract: rejections", () => {
  it("rejects encrypted ZIP", async () => {
    await expect(
      extractArchive(readFix("encrypted.zip").buffer, "encrypted.zip", "application/zip"),
    ).rejects.toThrow(/encrypted/);
  });

  it("rejects zip-slip", async () => {
    await expect(
      extractArchive(readFix("zip-slip.zip").buffer, "zip-slip.zip", "application/zip"),
    ).rejects.toThrow(/unsafe path/);
  });

  it("rejects > 1 GB single entry", async () => {
    await expect(
      extractArchive(readFix("huge-entry.zip").buffer, "huge-entry.zip", "application/zip"),
    ).rejects.toThrow(/would expand/);
  });

  it("rejects > 2 GB aggregate", async () => {
    await expect(
      extractArchive(readFix("bomb.zip").buffer, "bomb.zip", "application/zip"),
    ).rejects.toThrow(/expand/);
  });

  it("rejects bare .gz (no TAR inside)", async () => {
    await expect(
      extractArchive(readFix("bare.gz").buffer, "bare.gz", "application/gzip"),
    ).rejects.toThrow(/GZIP of non-TAR/);
  });

  it("rejects unknown format", async () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]).buffer;
    await expect(extractArchive(garbage, "x.bin", "")).rejects.toThrow(/unrecognized/);
  });
});
```

- [ ] **Step 4.2: Run the tests to verify they fail.**

Run: `pnpm test src/engines/archive-extract/worker.test.ts`
Expected: FAIL — `extractArchive` is not exported (or worker.ts is the stub from Task 3.6).

- [ ] **Step 4.3: Implement the worker.**

Replace `src/engines/archive-extract/worker.ts`:

```ts
import type { OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import { type Unzipped, gunzipSync, unzipSync } from "fflate";
import type { ArchiveExtractOptions } from "./options";

const PER_ENTRY_BYTES_CAP = 1 * 1024 * 1024 * 1024; // 1 GB
const TOTAL_BYTES_CAP = 2 * 1024 * 1024 * 1024; // 2 GB

type Format = "zip" | "tar" | "tar.gz";

function detectFormat(bytes: Uint8Array): Format {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    // PK\x03\x04 (local file header) or PK\x05\x06 (empty archive EOCD)
    if (bytes[2] === 0x03 && bytes[3] === 0x04) return "zip";
    if (bytes[2] === 0x05 && bytes[3] === 0x06) return "zip";
  }
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return "tar.gz";
  }
  // ustar magic at offset 257
  if (bytes.length >= 263) {
    const magic = String.fromCharCode(
      ...bytes.subarray(257, 263),
    );
    if (magic === "ustar " || magic === "ustar ") return "tar";
  }
  throw new Error("archive-extract: unrecognized archive format");
}

function isSafePath(p: string): boolean {
  if (p.length === 0) return false;
  if (p.includes(" ")) return false;
  if (p.startsWith("/")) return false;
  if (/^[A-Za-z]:/.test(p)) return false; // Windows drive letter
  // Disallow any segment that is exactly ".."
  for (const seg of p.split("/")) {
    if (seg === "..") return false;
  }
  return true;
}

async function extractZip(bytes: Uint8Array): Promise<OutputItem[]> {
  // Pre-flight: parse the central directory ourselves to enumerate entries
  // with declared sizes + encryption bit + path safety, BEFORE allocating
  // uncompressed buffers via fflate.
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Locate EOCD by scanning back from the end.
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("archive-extract: ZIP end-of-central-directory not found");
  const cdSize = dv.getUint32(eocdOffset + 12, true);
  const cdStart = dv.getUint32(eocdOffset + 16, true);
  if (cdStart + cdSize > bytes.length) {
    throw new Error("archive-extract: ZIP central directory truncated");
  }

  let cursor = cdStart;
  const cdEnd = cdStart + cdSize;
  const entries: Array<{ path: string; uncompressed: number }> = [];
  let total = 0;
  while (cursor + 46 <= cdEnd) {
    if (dv.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error("archive-extract: malformed ZIP central directory");
    }
    const gpFlag = dv.getUint16(cursor + 8, true);
    if (gpFlag & 0x0001) {
      throw new Error(
        "archive-extract: this archive is encrypted; password-protected ZIPs aren't supported",
      );
    }
    const uncompressed = dv.getUint32(cursor + 24, true);
    const nameLen = dv.getUint16(cursor + 28, true);
    const extraLen = dv.getUint16(cursor + 30, true);
    const commentLen = dv.getUint16(cursor + 32, true);
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLen);
    const path = new TextDecoder("utf-8").decode(nameBytes);

    if (!isSafePath(path)) {
      throw new Error(
        `archive-extract: archive contains entry with unsafe path: \`${path}\`; refusing to extract`,
      );
    }
    if (uncompressed > PER_ENTRY_BYTES_CAP) {
      throw new Error(
        `archive-extract: entry \`${path}\` would expand to ${(uncompressed / 1_000_000_000).toFixed(2)} GB; refusing to extract`,
      );
    }
    total += uncompressed;
    if (total > TOTAL_BYTES_CAP) {
      throw new Error(
        `archive-extract: archive would expand to ${(total / 1_000_000_000).toFixed(2)} GB total; refusing to extract`,
      );
    }
    entries.push({ path, uncompressed });
    cursor += 46 + nameLen + extraLen + commentLen;
  }

  // Pre-flight passed → decompress.
  const unzipped: Unzipped = unzipSync(bytes);
  const outputs: OutputItem[] = [];
  for (const e of entries) {
    if (e.path.endsWith("/") && e.uncompressed === 0) continue; // directory entry
    const data = unzipped[e.path];
    if (!data) continue; // shouldn't happen — central dir said it's there
    outputs.push({
      filename: e.path,
      mime: "application/octet-stream",
      blob: new Blob([data], { type: "application/octet-stream" }),
    });
  }
  return outputs;
}

async function extractTar(bytes: Uint8Array): Promise<OutputItem[]> {
  const { readTar } = await import("@/engines/_shared/tar");
  const entries = readTar(bytes);
  let total = 0;
  for (const e of entries) {
    if (e.type !== "file") continue;
    if (!isSafePath(e.path)) {
      throw new Error(
        `archive-extract: archive contains entry with unsafe path: \`${e.path}\`; refusing to extract`,
      );
    }
    if (e.size > PER_ENTRY_BYTES_CAP) {
      throw new Error(
        `archive-extract: entry \`${e.path}\` would expand to ${(e.size / 1_000_000_000).toFixed(2)} GB; refusing to extract`,
      );
    }
    total += e.size;
    if (total > TOTAL_BYTES_CAP) {
      throw new Error(
        `archive-extract: archive would expand to ${(total / 1_000_000_000).toFixed(2)} GB total; refusing to extract`,
      );
    }
  }
  return entries
    .filter((e) => e.type === "file")
    .map((e) => ({
      filename: e.path,
      mime: "application/octet-stream",
      blob: new Blob([e.payload], { type: "application/octet-stream" }),
    }));
}

async function extractTarGz(bytes: Uint8Array): Promise<OutputItem[]> {
  // Bounded gunzip: read the gzip footer's uncompressed-size field BEFORE
  // calling gunzipSync (which allocates output up-front based on that size).
  // RFC 1952: last 4 bytes of a gzip stream are ISIZE, the uncompressed size
  // mod 2^32, little-endian. For files > 4 GB the field wraps; the inner TAR
  // scan's TOTAL_BYTES_CAP is the ultimate guard for that pathological case.
  if (bytes.length < 8) {
    throw new Error("archive-extract: gzip stream too short");
  }
  const isizeView = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 4, 4);
  const declaredSize = isizeView.getUint32(0, true);
  if (declaredSize > TOTAL_BYTES_CAP) {
    throw new Error(
      `archive-extract: archive would expand to ${(declaredSize / 1_000_000_000).toFixed(2)} GB total; refusing to extract`,
    );
  }
  let inner: Uint8Array;
  try {
    inner = gunzipSync(bytes);
  } catch (err) {
    throw new Error(`archive-extract: gunzip failed (${err instanceof Error ? err.message : err})`);
  }
  if (inner.length > TOTAL_BYTES_CAP) {
    throw new Error(
      `archive-extract: archive would expand to ${(inner.length / 1_000_000_000).toFixed(2)} GB total; refusing to extract`,
    );
  }
  // Verify the inner stream is actually TAR — magic at offset 257.
  if (inner.length < 263) {
    throw new Error(
      "archive-extract: GZIP of non-TAR not supported in v2; standalone gunzip is on the roadmap",
    );
  }
  const magic = String.fromCharCode(...inner.subarray(257, 263));
  if (magic !== "ustar " && magic !== "ustar ") {
    throw new Error(
      "archive-extract: GZIP of non-TAR not supported in v2; standalone gunzip is on the roadmap",
    );
  }
  return extractTar(inner);
}

/** Pure entry point used by tests. The Comlink-exposed `convertSingle` below
 *  is just an adapter to this function. */
export async function extractArchive(
  fileBytes: ArrayBuffer,
  _fileName: string,
  _fileType: string,
): Promise<OutputItem[]> {
  const bytes = new Uint8Array(fileBytes);
  const fmt = detectFormat(bytes);
  switch (fmt) {
    case "zip":
      return extractZip(bytes);
    case "tar":
      return extractTar(bytes);
    case "tar.gz":
      return extractTarGz(bytes);
  }
}

const api = {
  async convertSingle(
    fileBytes: ArrayBuffer,
    fileName: string,
    fileType: string,
    _opts: ArchiveExtractOptions,
  ): Promise<OutputItem[]> {
    return extractArchive(fileBytes, fileName, fileType);
  },
};

Comlink.expose(api);
```

- [ ] **Step 4.4: Run the tests.**

Run: `pnpm test src/engines/archive-extract/`
Expected: PASS — all 9 cases (3 happy + 6 rejections).

If a fixture-related case unexpectedly passes the wrong rejection (e.g., bomb.zip throws `huge-entry` error), check that bomb.zip's per-entry forged size is < 1 GB (50 MB × 100 entries triggers aggregate, not per-entry).

- [ ] **Step 4.5: Lint + typecheck.**

Run: `pnpm lint src/engines/archive-extract/ && pnpm typecheck`
Expected: clean.

- [ ] **Step 4.6: Commit.**

```bash
git add src/engines/archive-extract/worker.ts src/engines/archive-extract/worker.test.ts
git commit -m "$(cat <<'EOF'
feat(archive-extract): worker — detect, validate, extract

Magic-byte format detect (ZIP / TAR / TAR.GZ); pre-flight reads
central directory / TAR headers to enforce encrypted / zip-slip /
1 GB per-entry / 2 GB aggregate guards before any payload buffer
is allocated. GZIP of non-TAR rejected with actionable error.
EOF
)"
```

---

## Task 5: ResultList path-strip + dedupe extension

**Why:** `archive-extract` outputs `OutputItem.filename` like `vacation/beach.jpg`. Browsers cannot honor `/` in `<a download>` attrs, so per-item Download must strip + dedupe. "Download all as zip" path is unchanged (verify `client-zip` preserves `/` in entry names).

**Files:**
- Modify: `src/components/result-list.tsx`
- Modify: `src/components/result-list.test.tsx`
- (Untouched but verified) `src/engines/_shared/zip.ts`

- [ ] **Step 5.1: Verify `client-zip` preserves `/` in entry names.**

Open a node REPL or write a one-shot script:

```bash
node -e "
import('client-zip').then(async ({ downloadZip }) => {
  const r = downloadZip([{ name: 'a/b.txt', input: new Blob(['x']) }]);
  const buf = new Uint8Array(await (await r.blob()).arrayBuffer());
  // Find the local file header name field at byte 30.
  console.log('name in zip:', new TextDecoder().decode(buf.subarray(30, 30 + 5)));
})
"
```

Expected output: `name in zip: a/b.t` (truncated to 5 bytes — confirms slash present). If output is anything else (e.g. `a_b.tx`), `client-zip` is mangling — STOP and revisit (the design assumed verbatim pass-through).

- [ ] **Step 5.2: Write the failing tests.**

Add to `src/components/result-list.test.tsx` (preserve all existing tests; add these to the existing top-level `describe` block):

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResultList } from "./result-list";
import * as downloadModule from "@/lib/download";

// existing tests …

describe("ResultList per-item download for path-bearing entries", () => {
  it("strips directory prefix when downloading individually", () => {
    const downloadSpy = vi.spyOn(downloadModule, "download").mockImplementation(() => {});
    const items = [
      { filename: "vacation/beach.jpg", mime: "image/jpeg", blob: new Blob(["a"]) },
    ];
    render(<ResultList items={items} />);
    fireEvent.click(screen.getByLabelText(/download vacation\/beach\.jpg/i));
    expect(downloadSpy).toHaveBeenCalledWith(items[0].blob, "beach.jpg");
  });

  it("dedupes basename collisions across items", () => {
    const downloadSpy = vi.spyOn(downloadModule, "download").mockImplementation(() => {});
    const items = [
      { filename: "vacation/foo.jpg", mime: "image/jpeg", blob: new Blob(["a"]) },
      { filename: "archive/foo.jpg", mime: "image/jpeg", blob: new Blob(["b"]) },
      { filename: "foo.jpg", mime: "image/jpeg", blob: new Blob(["c"]) },
    ];
    render(<ResultList items={items} />);
    // Buttons are aria-labelled by the ORIGINAL filename to remain unique
    // and accessible. The downloaded name is what the dedupe produces.
    fireEvent.click(screen.getByLabelText("download vacation/foo.jpg"));
    fireEvent.click(screen.getByLabelText("download archive/foo.jpg"));
    fireEvent.click(screen.getByLabelText("download foo.jpg"));
    expect(downloadSpy).toHaveBeenNthCalledWith(1, items[0].blob, "foo.jpg");
    expect(downloadSpy).toHaveBeenNthCalledWith(2, items[1].blob, "foo-1.jpg");
    expect(downloadSpy).toHaveBeenNthCalledWith(3, items[2].blob, "foo-2.jpg");
  });

  it("download-all-as-zip preserves entry paths verbatim", async () => {
    const items = [
      { filename: "vacation/beach.jpg", mime: "image/jpeg", blob: new Blob(["a"]) },
      { filename: "vacation/sunset.jpg", mime: "image/jpeg", blob: new Blob(["b"]) },
    ];
    render(<ResultList items={items} archiveBasename="trip" archiveSuffix="-extract" />);
    // Just smoke-check that the button renders + the click handler is wired.
    expect(screen.getByTestId("download-all-zip")).toBeInTheDocument();
  });
});
```

- [ ] **Step 5.3: Run tests to verify failure.**

Run: `pnpm test src/components/result-list.test.tsx`
Expected: FAIL on the first new case — current per-item button passes `item.filename` verbatim.

- [ ] **Step 5.4: Implement strip + dedupe in `result-list.tsx`.**

Modify `src/components/result-list.tsx`. Above the JSX return, add a helper that builds a per-item-download-name map keyed by index:

```tsx
function basenameOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

function buildDedupeMap(items: ReadonlyArray<OutputItem>): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (const item of items) {
    const base = basenameOf(item.filename);
    const count = seen.get(base) ?? 0;
    if (count === 0) {
      out.push(base);
    } else {
      const dot = base.lastIndexOf(".");
      const stem = dot === -1 ? base : base.slice(0, dot);
      const ext = dot === -1 ? "" : base.slice(dot);
      out.push(`${stem}-${count}${ext}`);
    }
    seen.set(base, count + 1);
  }
  return out;
}
```

Then inside the component, compute the map once:

```tsx
const downloadNames = buildDedupeMap(items);
```

And in the `items.map((item) => ...)` JSX, change the existing per-item Download `onClick` from:

```tsx
onClick={() => download(item.blob, item.filename)}
```

to (using the map index — refactor the map to expose `i`):

```tsx
{items.map((item, i) => (
  ...
  onClick={() => download(item.blob, downloadNames[i] ?? basenameOf(item.filename))}
  ...
))}
```

The `aria-label` stays as `download ${item.filename}` (full path), matching the test expectation.

- [ ] **Step 5.5: Run tests.**

Run: `pnpm test src/components/result-list.test.tsx`
Expected: PASS — all existing + 3 new cases.

- [ ] **Step 5.6: Lint + typecheck.**

Run: `pnpm lint src/components/result-list.tsx && pnpm typecheck`
Expected: clean.

- [ ] **Step 5.7: Commit.**

```bash
git add src/components/result-list.tsx src/components/result-list.test.tsx
git commit -m "$(cat <<'EOF'
feat(result-list): strip + dedupe paths on per-item download

archive-extract emits OutputItem.filename like "vacation/beach.jpg"
to preserve directory structure for the "download all as zip" path,
which client-zip honours verbatim. Browsers can't honour `/` in
<a download> attrs, so per-item download flattens to basename and
dedupes collisions ("foo.jpg" / "foo-1.jpg" / ...).
EOF
)"
```

---

## Task 6: `archive-extract` route + sidebar/home/COOP wiring + privacy E2E

**Why:** Round out archive-extract end-to-end before moving to archive-create.

**Files:**
- Create: `src/app/tools/archive-extract/page.tsx`
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/app/page.tsx`
- Modify: `tests/e2e/coop-coep.spec.ts`
- Create: `tests/e2e/archive-extract.spec.ts`
- Create: `tests/e2e/privacy-regression-archive-extract.spec.ts`

- [ ] **Step 6.1: Add the route page.**

Create `src/app/tools/archive-extract/page.tsx`:

```tsx
"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/archive-extract";

export default function ArchiveExtractPage() {
  return <ToolFrame engine={engine} />;
}
```

- [ ] **Step 6.2: Add sidebar entry + ARCHIVES group.**

Edit `src/components/layout/sidebar.tsx`:
- Insert `{ id: "archive-extract", href: "/tools/archive-extract", label: "archive extract", group: "ARCHIVES" },` into `TOOLS` after the `image-to-text` line and before the `about` line.
- Update `GROUP_ORDER` from:

```ts
const GROUP_ORDER = ["HOME", "IMAGES", "PDFS", "DOCS", "AUDIO", "VIDEO", "OCR", "ABOUT"] as const;
```

to:

```ts
const GROUP_ORDER = ["HOME", "IMAGES", "PDFS", "DOCS", "AUDIO", "VIDEO", "OCR", "ARCHIVES", "ABOUT"] as const;
```

- [ ] **Step 6.3: Add home page card.**

Edit `src/app/page.tsx` — insert into `TOOLS` after the `image-to-text` entry:

```ts
{
  id: "archive-extract",
  title: "archive extract",
  description: "zip, tar, tar.gz · extract entries; safe paths only",
  href: "/tools/archive-extract",
},
```

- [ ] **Step 6.4: Add route to COOP/COEP enumeration.**

Edit `tests/e2e/coop-coep.spec.ts`. Add `"/tools/archive-extract",` to `TOOL_ROUTES` (alphabetical position — between `audio-trim` and `docx-to-pdf`).

- [ ] **Step 6.5: Write the E2E spec.**

Create `tests/e2e/archive-extract.spec.ts`:

```ts
import path from "node:path";
import { expect, test } from "@playwright/test";

const FIX = path.resolve(__dirname, "../fixtures/archives");

test("archive-extract: happy path drops sample.zip and lists 2 entries", async ({ page }) => {
  await page.goto("/tools/archive-extract");
  await page.locator('input[type="file"]').setInputFiles(path.join(FIX, "sample.zip"));
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
  await expect(page.getByText("hello.txt")).toBeVisible();
  await expect(page.getByText("data/notes.md")).toBeVisible();
});

test("archive-extract: encrypted zip shows actionable error", async ({ page }) => {
  await page.goto("/tools/archive-extract");
  await page.locator('input[type="file"]').setInputFiles(path.join(FIX, "encrypted.zip"));
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ ERROR ]", { timeout: 30_000 });
  await expect(page.getByText(/password-protected ZIPs/i)).toBeVisible();
});

test("archive-extract: zip-slip shows actionable error with offending path", async ({ page }) => {
  await page.goto("/tools/archive-extract");
  await page.locator('input[type="file"]').setInputFiles(path.join(FIX, "zip-slip.zip"));
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ ERROR ]", { timeout: 30_000 });
  await expect(page.getByText(/unsafe path.*\.\.\/escape\.txt/)).toBeVisible();
});

test("archive-extract: download-all-as-zip uses archiveSuffix", async ({ page }) => {
  await page.goto("/tools/archive-extract");
  await page.locator('input[type="file"]').setInputFiles(path.join(FIX, "sample.zip"));
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByTestId("download-all-zip").click();
  const dl = await downloadPromise;
  expect(dl.suggestedFilename()).toBe("sample-extract.zip");
});
```

- [ ] **Step 6.6: Write the privacy regression spec.**

Create `tests/e2e/privacy-regression-archive-extract.spec.ts` mirroring `privacy-regression-pdf-split.spec.ts`:

```ts
import path from "node:path";
import { expect, test } from "@playwright/test";

test("archive-extract produces zero off-origin requests during conversion", async ({ page }) => {
  page.on("request", () => undefined);
  await page.goto("/tools/archive-extract", { waitUntil: "networkidle" });
  page.removeAllListeners("request");

  const off: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.origin !== new URL(page.url()).origin) off.push(req.url());
  });
  const ws: string[] = [];
  page.on("websocket", (w) => {
    if (new URL(w.url()).host !== new URL(page.url()).host) ws.push(w.url());
  });

  await page.locator('input[type="file"]').setInputFiles(
    path.resolve(__dirname, "../fixtures/archives/sample.zip"),
  );
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");

  expect(off, `archive-extract made off-origin requests: ${off.join(", ")}`).toEqual([]);
  expect(ws, `archive-extract opened off-origin WebSockets: ${ws.join(", ")}`).toEqual([]);
});
```

- [ ] **Step 6.7: Run E2E + COOP/COEP serially.**

Run: `pnpm test:e2e tests/e2e/archive-extract.spec.ts tests/e2e/privacy-regression-archive-extract.spec.ts tests/e2e/coop-coep.spec.ts`
Expected: PASS. If `[ DONE ]` is slow on first run, the dev server may still be starting — retry; do not bump timeouts past 30 s.

- [ ] **Step 6.8: Commit.**

```bash
git add src/app/tools/archive-extract/ src/components/layout/sidebar.tsx src/app/page.tsx tests/e2e/archive-extract.spec.ts tests/e2e/privacy-regression-archive-extract.spec.ts tests/e2e/coop-coep.spec.ts
git commit -m "$(cat <<'EOF'
feat(archive-extract): route, sidebar group, home card, E2E

Adds /tools/archive-extract, the new ARCHIVES sidebar group
(between OCR and ABOUT), home grid entry, and full E2E coverage
including privacy regression and COOP/COEP enumeration.
EOF
)"
```

---

## Task 7: `archive-create` engine — descriptor, options, options panel

**Why:** Smaller files first; worker + StagingArea + tests land in subsequent tasks.

**Files:**
- Create: `src/engines/archive-create/options.ts`
- Create: `src/engines/archive-create/options.test.ts`
- Create: `src/engines/archive-create/options-panel.tsx`
- Create: `src/engines/archive-create/options-panel.test.tsx`
- Create: `src/engines/archive-create/index.ts`
- Create: `src/engines/archive-create/index.test.ts`
- Modify: `src/engines/_shared/registry.ts`

- [ ] **Step 7.1: Write `options.ts`.**

```ts
// src/engines/archive-create/options.ts
export type ArchiveCreateFormat = "zip" | "tar.gz";

export type ArchiveCreateOptions = {
  outputFormat: ArchiveCreateFormat;
  /** User-edited base name (no extension). */
  filename: string;
};

export const FILENAME_REGEX = /^[A-Za-z0-9._-]+$/;
export const FILENAME_MAX_LEN = 100;

export function defaultArchiveBasename(now: Date = new Date()): string {
  const yyyy = now.getFullYear().toString().padStart(4, "0");
  const mm = (now.getMonth() + 1).toString().padStart(2, "0");
  const dd = now.getDate().toString().padStart(2, "0");
  const HH = now.getHours().toString().padStart(2, "0");
  const MM = now.getMinutes().toString().padStart(2, "0");
  return `archive-${yyyy}${mm}${dd}-${HH}${MM}`;
}

export function defaultOptions(): ArchiveCreateOptions {
  return { outputFormat: "zip", filename: defaultArchiveBasename() };
}

// Re-export for engine.defaultOptions; assigned at module load so the
// timestamp pins to "page-open time", not "every render".
export const defaultArchiveCreateOptions: ArchiveCreateOptions = defaultOptions();

export function extensionFor(fmt: ArchiveCreateFormat): string {
  return fmt === "zip" ? "zip" : "tar.gz";
}

export function validateFilename(name: string): { ok: true } | { ok: false; reason: string } {
  if (name.length === 0) return { ok: false, reason: "filename required" };
  if (name.length > FILENAME_MAX_LEN) {
    return { ok: false, reason: `filename too long (max ${FILENAME_MAX_LEN})` };
  }
  if (!FILENAME_REGEX.test(name)) {
    return { ok: false, reason: "letters, digits, dots, dashes, underscores only" };
  }
  return { ok: true };
}
```

- [ ] **Step 7.2: Write `options.test.ts`.**

```ts
// src/engines/archive-create/options.test.ts
import { describe, expect, it } from "vitest";
import {
  defaultArchiveBasename,
  defaultArchiveCreateOptions,
  extensionFor,
  validateFilename,
} from "./options";

describe("ArchiveCreateOptions", () => {
  it("default basename matches archive-YYYYMMDD-HHmm shape", () => {
    expect(defaultArchiveBasename(new Date(2026, 4, 8, 19, 34))).toBe("archive-20260508-1934");
  });
  it("default options preset zip + a basename", () => {
    expect(defaultArchiveCreateOptions.outputFormat).toBe("zip");
    expect(defaultArchiveCreateOptions.filename).toMatch(/^archive-\d{8}-\d{4}$/);
  });
  it("extensionFor maps formats", () => {
    expect(extensionFor("zip")).toBe("zip");
    expect(extensionFor("tar.gz")).toBe("tar.gz");
  });
  it("validateFilename accepts valid names", () => {
    expect(validateFilename("foo")).toEqual({ ok: true });
    expect(validateFilename("foo.bar-baz_1")).toEqual({ ok: true });
  });
  it("validateFilename rejects invalid", () => {
    expect(validateFilename("").ok).toBe(false);
    expect(validateFilename("foo bar").ok).toBe(false); // space
    expect(validateFilename("foo/bar").ok).toBe(false); // slash
    expect(validateFilename("a".repeat(101)).ok).toBe(false); // too long
  });
});
```

- [ ] **Step 7.3: Write `options-panel.tsx`.**

```tsx
// src/engines/archive-create/options-panel.tsx
"use client";

import type { OptionsPanelProps } from "@/engines/_shared/types";
import {
  type ArchiveCreateFormat,
  type ArchiveCreateOptions,
  extensionFor,
  validateFilename,
} from "./options";

const FORMATS: ArchiveCreateFormat[] = ["zip", "tar.gz"];

export function ArchiveCreateOptionsPanel({
  value,
  onChange,
}: OptionsPanelProps<ArchiveCreateOptions>) {
  const fnameResult = validateFilename(value.filename);
  const previewName = `${value.filename}.${extensionFor(value.outputFormat)}`;
  return (
    <div
      data-testid="archive-create-options"
      className="mb-3 flex flex-wrap items-center gap-4 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      <fieldset className="flex items-center gap-2 border-0 p-0 m-0">
        <legend className="float-left mr-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
          format:
        </legend>
        <span className="inline-flex gap-3">
          {FORMATS.map((fmt) => (
            <label
              key={fmt}
              className="flex cursor-pointer items-center gap-1 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]"
            >
              <input
                type="radio"
                name="archive-output-format"
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
        filename:
        <input
          type="text"
          data-testid="filename-input"
          value={value.filename}
          onChange={(e) => onChange({ ...value, filename: e.target.value })}
          aria-invalid={!fnameResult.ok}
          className={`border bg-[var(--color-bg)] px-2 py-1 font-mono text-[var(--color-fg)] ${
            fnameResult.ok ? "border-[var(--color-hairline)]" : "border-[var(--color-accent)]"
          }`}
        />
      </label>

      {fnameResult.ok ? (
        <span data-testid="filename-preview" className="text-[var(--color-fg-muted)]">
          → {previewName}
        </span>
      ) : (
        <span data-testid="filename-error" className="text-[var(--color-accent)]">
          {fnameResult.reason}
        </span>
      )}

      <span className="basis-full text-[var(--color-fg-very-muted)]">
        folder structure is flattened — all files become top-level entries.
      </span>
    </div>
  );
}
```

- [ ] **Step 7.4: Write `options-panel.test.tsx`.**

```tsx
// src/engines/archive-create/options-panel.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArchiveCreateOptionsPanel } from "./options-panel";
import { defaultArchiveCreateOptions } from "./options";

describe("ArchiveCreateOptionsPanel", () => {
  it("shows preview with current extension", () => {
    const onChange = vi.fn();
    render(
      <ArchiveCreateOptionsPanel
        value={{ outputFormat: "zip", filename: "myarc" }}
        onChange={onChange}
      />,
    );
    expect(screen.getByTestId("filename-preview").textContent).toContain("myarc.zip");
  });

  it("toggling to tar.gz updates preview extension", () => {
    const onChange = vi.fn();
    render(
      <ArchiveCreateOptionsPanel
        value={{ outputFormat: "zip", filename: "myarc" }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("tar.gz"));
    expect(onChange).toHaveBeenCalledWith({ outputFormat: "tar.gz", filename: "myarc" });
  });

  it("invalid filename surfaces error and aria-invalid", () => {
    const onChange = vi.fn();
    render(
      <ArchiveCreateOptionsPanel
        value={{ outputFormat: "zip", filename: "bad name" }}
        onChange={onChange}
      />,
    );
    expect(screen.getByTestId("filename-input")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("filename-error")).toBeInTheDocument();
  });

  it("smoke: renders defaults", () => {
    render(<ArchiveCreateOptionsPanel value={defaultArchiveCreateOptions} onChange={() => {}} />);
    expect(screen.getByTestId("archive-create-options")).toBeInTheDocument();
  });
});
```

- [ ] **Step 7.5: Write `index.ts` (descriptor + validate).**

```ts
// src/engines/archive-create/index.ts
import { WorkerHarness } from "@/engines/_shared/harness";
import type { MultiInputEngine, OutputItem } from "@/engines/_shared/types";
import {
  type ArchiveCreateOptions,
  defaultArchiveCreateOptions,
  validateFilename,
} from "./options";
import { ArchiveCreateOptionsPanel } from "./options-panel";
import { ArchiveCreateStagingArea } from "./staging-area";

const MAX_SUM_BYTES = 500 * 1_000_000;

const engine: MultiInputEngine<ArchiveCreateOptions, OutputItem> = {
  id: "archive-create",
  inputAccept: ["*/*"],
  inputMime: ["*/*"],
  outputMime: "application/zip",
  defaultOptions: defaultArchiveCreateOptions,
  convertButtonLabel: "[ create archive ]",
  category: "archive",
  library: "client-zip, fflate, in-house tar",
  license: "MIT",
  cardinality: "multi",
  StagingArea: ArchiveCreateStagingArea,
  OptionsPanel: ArchiveCreateOptionsPanel,
  isReadyToConvert(opts) {
    return validateFilename(opts.filename).ok;
  },
  validate(files) {
    if (files.length === 0) return { ok: false, reason: "Drop at least one file" };
    const sum = files.reduce((s, f) => s + f.size, 0);
    if (sum > MAX_SUM_BYTES) {
      return {
        ok: false,
        reason: `Inputs total too large for archive-create (limit 500 MB; got ${(sum / 1_000_000).toFixed(1)} MB).`,
      };
    }
    return { ok: true };
  },
  async convert(files, opts, signal) {
    const harness = new WorkerHarness<ArchiveCreateOptions>(
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    );
    const result = await harness.runMulti(files, opts, signal);
    if (Array.isArray(result)) {
      const first = result[0];
      if (!first) throw new Error("archive-create: engine returned empty array");
      return first;
    }
    return result;
  },
};

export default engine;
```

- [ ] **Step 7.6: Write `index.test.ts`.**

```ts
// src/engines/archive-create/index.test.ts
import { describe, expect, it } from "vitest";
import engine from "./index";

describe("archive-create engine descriptor", () => {
  it("declares cardinality, category", () => {
    expect(engine.id).toBe("archive-create");
    expect(engine.cardinality).toBe("multi");
    expect(engine.category).toBe("archive");
    expect(engine.archiveSuffix).toBeUndefined();
  });

  it("rejects empty file list", () => {
    expect(engine.validate([], engine.defaultOptions).ok).toBe(false);
  });

  it("accepts a single file", () => {
    const result = engine.validate([new File(["x"], "a.txt")], engine.defaultOptions);
    expect(result.ok).toBe(true);
  });

  it("rejects 600 MB sum", () => {
    const big = new File([new Uint8Array(1)], "big.bin");
    Object.defineProperty(big, "size", { value: 600 * 1_000_000 });
    const result = engine.validate([big], engine.defaultOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/limit 500 MB/);
  });

  it("isReadyToConvert mirrors filename validation", () => {
    expect(engine.isReadyToConvert?.({ outputFormat: "zip", filename: "ok" })).toBe(true);
    expect(engine.isReadyToConvert?.({ outputFormat: "zip", filename: "" })).toBe(false);
  });
});
```

- [ ] **Step 7.7: Add to registry.**

Edit `src/engines/_shared/registry.ts`:
- Add `"archive-create"` to the `EngineId` union (alphabetical, before `"archive-extract"`).
- Add `"archive-create": () => import("@/engines/archive-create"),` to `REGISTRY`.

- [ ] **Step 7.8: Run unit tests + typecheck.**

Run: `pnpm test src/engines/archive-create/options.test.ts src/engines/archive-create/options-panel.test.tsx src/engines/archive-create/index.test.ts && pnpm typecheck`
Expected: PASS. (StagingArea tests + worker tests fail because those files don't exist yet — Tasks 8 + 9.)

If typecheck blocks on `staging-area` / `worker` imports, create stub files containing only:
- `staging-area.tsx`: `export function ArchiveCreateStagingArea() { return null; }` (typed minimally with the right props).
- `worker.ts`: `import * as Comlink from "comlink"; Comlink.expose({});`

These get replaced in Tasks 8 + 9.

- [ ] **Step 7.9: Commit.**

```bash
git add src/engines/archive-create/options.ts src/engines/archive-create/options.test.ts src/engines/archive-create/options-panel.tsx src/engines/archive-create/options-panel.test.tsx src/engines/archive-create/index.ts src/engines/archive-create/index.test.ts src/engines/_shared/registry.ts
git commit -m "$(cat <<'EOF'
feat(archive-create): descriptor, options, OptionsPanel + registry

Filename validation + live extension preview; default basename
uses page-open time. Multi-input engine with 500 MB sum cap.
Worker + StagingArea stubs land in next two commits.
EOF
)"
```

---

## Task 8: `archive-create` StagingArea

**Why:** A minimal sortable file list — much simpler than `pdf-merge`'s (no per-row metadata loading, no thumbnails). Land it before the worker so the route smoke-tests cleanly in Task 10.

**Files:**
- Create (or replace stub from Task 7.8): `src/engines/archive-create/staging-area.tsx`
- Create: `src/engines/archive-create/staging-area.test.tsx`

- [ ] **Step 8.1: Write the failing tests.**

Create `src/engines/archive-create/staging-area.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultArchiveCreateOptions } from "./options";
import { ArchiveCreateStagingArea } from "./staging-area";

function makeFile(name: string): File {
  return new File(["x"], name, { type: "text/plain" });
}

describe("ArchiveCreateStagingArea", () => {
  it("renders one row per file in order", () => {
    render(
      <ArchiveCreateStagingArea
        files={[makeFile("a.txt"), makeFile("b.txt")]}
        onChange={() => {}}
        options={defaultArchiveCreateOptions}
        setOptions={() => {}}
      />,
    );
    const rows = screen.getAllByTestId("staging-row");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("a.txt"),
      expect.stringContaining("b.txt"),
    ]);
  });

  it("× removes a file", () => {
    const onChange = vi.fn();
    const files = [makeFile("a.txt"), makeFile("b.txt")];
    render(
      <ArchiveCreateStagingArea
        files={files}
        onChange={onChange}
        options={defaultArchiveCreateOptions}
        setOptions={() => {}}
      />,
    );
    const removeButtons = screen.getAllByTestId("remove");
    fireEvent.click(removeButtons[0]!);
    expect(onChange).toHaveBeenCalledWith([files[1]]);
  });

  it("↑ moves a row up", () => {
    const onChange = vi.fn();
    const files = [makeFile("a.txt"), makeFile("b.txt")];
    render(
      <ArchiveCreateStagingArea
        files={files}
        onChange={onChange}
        options={defaultArchiveCreateOptions}
        setOptions={() => {}}
      />,
    );
    const ups = screen.getAllByTestId("move-up");
    expect(ups[0]).toBeDisabled();
    fireEvent.click(ups[1]!);
    expect(onChange).toHaveBeenCalledWith([files[1], files[0]]);
  });
});
```

- [ ] **Step 8.2: Run tests to verify failure.**

Run: `pnpm test src/engines/archive-create/staging-area.test.tsx`
Expected: FAIL (stub component renders nothing).

- [ ] **Step 8.3: Implement the StagingArea.**

Replace `src/engines/archive-create/staging-area.tsx`:

```tsx
"use client";

import { formatBytes } from "@/lib/format-bytes";
import type { StagingAreaProps } from "@/engines/_shared/types";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useCallback } from "react";
import type { ArchiveCreateOptions } from "./options";

type RowProps = {
  id: string;
  index: number;
  total: number;
  file: File;
  onMoveUp: (i: number) => void;
  onMoveDown: (i: number) => void;
  onRemove: (i: number) => void;
};

function Row({ id, index, total, file, onMoveUp, onMoveDown, onRemove }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid="staging-row"
      className="flex items-center gap-3 px-3 py-2 text-[var(--text-xs)]"
    >
      <button
        type="button"
        data-testid="drag-handle"
        aria-label={`Drag to reorder ${file.name}`}
        {...attributes}
        {...listeners}
        className="cursor-grab text-[var(--color-fg-very-muted)] hover:text-[var(--color-fg-strong)]"
      >
        ≡
      </button>
      <span className="w-6 text-right text-[var(--color-accent)] tabular-nums">{index + 1}</span>
      <span className="flex-1 truncate text-[var(--color-fg)]" title={file.name}>
        {file.name}
      </span>
      <span className="text-[var(--color-fg-muted)] tabular-nums">{formatBytes(file.size)}</span>
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          data-testid="move-up"
          onClick={() => onMoveUp(index)}
          disabled={index === 0}
          className="border border-[var(--color-hairline)] px-2 py-0.5 text-[var(--color-fg-muted)] disabled:opacity-30"
        >
          ↑
        </button>
        <button
          type="button"
          data-testid="move-down"
          onClick={() => onMoveDown(index)}
          disabled={index === total - 1}
          className="border border-[var(--color-hairline)] px-2 py-0.5 text-[var(--color-fg-muted)] disabled:opacity-30"
        >
          ↓
        </button>
      </div>
      <button
        type="button"
        data-testid="remove"
        onClick={() => onRemove(index)}
        className="border border-[var(--color-hairline)] px-2 py-0.5 text-[var(--color-fg-muted)]"
      >
        ×
      </button>
    </div>
  );
}

export function ArchiveCreateStagingArea({
  files,
  onChange,
}: StagingAreaProps<ArchiveCreateOptions>) {
  // Use file index as DnD id (stable across renders for the duration of the
  // session, since reorder operations apply to the underlying files array).
  // For DnD identity stability across moves, generate a session id per file
  // by combining name + size + index — collisions only matter for DnD intent.
  const ids = files.map((f, i) => `${i}__${f.name}__${f.size}`);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = ids.indexOf(String(active.id));
      const newIndex = ids.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return;
      onChange(arrayMove(files, oldIndex, newIndex));
    },
    [ids, files, onChange],
  );

  const onMoveUp = useCallback(
    (i: number) => {
      if (i <= 0) return;
      onChange(arrayMove(files, i, i - 1));
    },
    [files, onChange],
  );
  const onMoveDown = useCallback(
    (i: number) => {
      if (i >= files.length - 1) return;
      onChange(arrayMove(files, i, i + 1));
    },
    [files, onChange],
  );
  const onRemove = useCallback(
    (i: number) => onChange(files.filter((_, idx) => idx !== i)),
    [files, onChange],
  );

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div
          data-testid="archive-create-staging"
          className="mb-3 border border-[var(--color-hairline)] divide-y divide-[var(--color-hairline)]"
        >
          {files.map((f, i) => (
            <Row
              key={ids[i]}
              id={ids[i]!}
              index={i}
              total={files.length}
              file={f}
              onMoveUp={onMoveUp}
              onMoveDown={onMoveDown}
              onRemove={onRemove}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
```

- [ ] **Step 8.4: Run tests.**

Run: `pnpm test src/engines/archive-create/staging-area.test.tsx`
Expected: PASS.

- [ ] **Step 8.5: Lint + typecheck.**

Run: `pnpm lint src/engines/archive-create/ && pnpm typecheck`
Expected: clean.

- [ ] **Step 8.6: Commit.**

```bash
git add src/engines/archive-create/staging-area.tsx src/engines/archive-create/staging-area.test.tsx
git commit -m "$(cat <<'EOF'
feat(archive-create): StagingArea — sortable file list

Thin DnD list mirroring pdf-merge's reorder/remove UX without
per-row metadata loading. Files keyed by name+size+index for DnD
identity stability.
EOF
)"
```

---

## Task 9: `archive-create` worker

**Files:**
- Create (or replace stub from Task 7.8): `src/engines/archive-create/worker.ts`
- Create: `src/engines/archive-create/worker.test.ts`

- [ ] **Step 9.1: Write the failing tests.**

```ts
// src/engines/archive-create/worker.test.ts
import { describe, expect, it } from "vitest";
import { gunzipSync, unzipSync } from "fflate";
import { readTar } from "@/engines/_shared/tar";
import { createArchive } from "./worker";

const enc = new TextEncoder();
const dec = new TextDecoder();

function toPayload(name: string, body: string): { bytes: ArrayBuffer; name: string; type: string } {
  const buf = enc.encode(body);
  // Wrap in a fresh ArrayBuffer to isolate from underlying Uint8Array buffer.
  const ab = buf.slice().buffer;
  return { bytes: ab, name, type: "text/plain" };
}

describe("archive-create: ZIP", () => {
  it("round-trips three files in StagingArea order", async () => {
    const out = await createArchive(
      [toPayload("a.txt", "AA"), toPayload("b.txt", "BB"), toPayload("c.txt", "CC")],
      { outputFormat: "zip", filename: "test" },
    );
    expect(out.filename).toBe("test.zip");
    const buf = new Uint8Array(await out.blob.arrayBuffer());
    const unzipped = unzipSync(buf);
    expect(Object.keys(unzipped).sort()).toEqual(["a.txt", "b.txt", "c.txt"]);
    expect(dec.decode(unzipped["a.txt"])).toBe("AA");
  });

  it("dedupes duplicate basenames", async () => {
    const out = await createArchive(
      [toPayload("foo.png", "X"), toPayload("foo.png", "Y")],
      { outputFormat: "zip", filename: "dup" },
    );
    const unzipped = unzipSync(new Uint8Array(await out.blob.arrayBuffer()));
    expect(Object.keys(unzipped).sort()).toEqual(["foo-1.png", "foo.png"]);
    expect(dec.decode(unzipped["foo.png"])).toBe("X");
    expect(dec.decode(unzipped["foo-1.png"])).toBe("Y");
  });
});

describe("archive-create: TAR.GZ", () => {
  it("round-trips three files", async () => {
    const out = await createArchive(
      [toPayload("a.txt", "AA"), toPayload("b.txt", "BB"), toPayload("c.txt", "CC")],
      { outputFormat: "tar.gz", filename: "test" },
    );
    expect(out.filename).toBe("test.tar.gz");
    const ungz = gunzipSync(new Uint8Array(await out.blob.arrayBuffer()));
    const entries = readTar(ungz);
    expect(entries.map((e) => e.path)).toEqual(["a.txt", "b.txt", "c.txt"]);
    expect(dec.decode(entries[0]!.payload)).toBe("AA");
  });
});
```

- [ ] **Step 9.2: Run to verify failure.**

Run: `pnpm test src/engines/archive-create/worker.test.ts`
Expected: FAIL — `createArchive` not exported (stub worker).

- [ ] **Step 9.3: Implement the worker.**

Replace `src/engines/archive-create/worker.ts`:

```ts
import type { OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import { type ArchiveCreateOptions, extensionFor } from "./options";

function basenameOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

function dedupe(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((raw) => {
    const base = basenameOf(raw);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    if (count === 0) return base;
    const dot = base.lastIndexOf(".");
    const stem = dot === -1 ? base : base.slice(0, dot);
    const ext = dot === -1 ? "" : base.slice(dot);
    return `${stem}-${count}${ext}`;
  });
}

type WorkerInput = { bytes: ArrayBuffer; name: string; type: string };

export async function createArchive(
  files: WorkerInput[],
  opts: ArchiveCreateOptions,
): Promise<OutputItem> {
  const entryNames = dedupe(files.map((f) => f.name));
  const ext = extensionFor(opts.outputFormat);
  const filename = `${opts.filename}.${ext}`;

  if (opts.outputFormat === "zip") {
    const { downloadZip } = await import("client-zip");
    const blobs = files.map(
      (f, i) =>
        ({
          name: entryNames[i] ?? f.name,
          input: new Blob([f.bytes]),
        }) as { name: string; input: Blob },
    );
    const response = downloadZip(blobs);
    const blob = await response.blob();
    return { filename, mime: "application/zip", blob };
  }

  // tar.gz
  const { writeTar } = await import("@/engines/_shared/tar");
  const { gzipSync } = await import("fflate");
  const tarBytes = writeTar(
    files.map((f, i) => ({
      path: entryNames[i] ?? f.name,
      size: f.bytes.byteLength,
      mtime: 0,
      type: "file" as const,
      payload: new Uint8Array(f.bytes),
    })),
  );
  const gz = gzipSync(tarBytes, { mtime: 0 });
  return {
    filename,
    mime: "application/gzip",
    blob: new Blob([gz], { type: "application/gzip" }),
  };
}

const api = {
  async convertMulti(
    files: WorkerInput[],
    opts: ArchiveCreateOptions,
  ): Promise<OutputItem> {
    return createArchive(files, opts);
  },
};

Comlink.expose(api);
```

- [ ] **Step 9.4: Run tests.**

Run: `pnpm test src/engines/archive-create/worker.test.ts`
Expected: PASS — round-trip + dedupe + tar.gz.

- [ ] **Step 9.5: Lint + typecheck.**

Run: `pnpm lint src/engines/archive-create/ && pnpm typecheck`
Expected: clean.

- [ ] **Step 9.6: Commit.**

```bash
git add src/engines/archive-create/worker.ts src/engines/archive-create/worker.test.ts
git commit -m "$(cat <<'EOF'
feat(archive-create): worker — ZIP + TAR.GZ output paths

ZIP via client-zip (streaming); TAR.GZ via _shared/tar.writeTar +
fflate.gzipSync. Duplicate basenames deduped to "foo.ext" /
"foo-1.ext" / ... in StagingArea order.
EOF
)"
```

---

## Task 10: `archive-create` route + sidebar/home/COOP wiring + E2E

**Files:**
- Create: `src/app/tools/archive-create/page.tsx`
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/app/page.tsx`
- Modify: `tests/e2e/coop-coep.spec.ts`
- Create: `tests/e2e/archive-create.spec.ts`
- Create: `tests/e2e/privacy-regression-archive-create.spec.ts`

- [ ] **Step 10.1: Add the route page.**

Create `src/app/tools/archive-create/page.tsx`:

```tsx
"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/archive-create";

export default function ArchiveCreatePage() {
  return <ToolFrame engine={engine} />;
}
```

- [ ] **Step 10.2: Add sidebar entry.**

Edit `src/components/layout/sidebar.tsx`. Insert into `TOOLS` after the `archive-extract` entry from Task 6:

```ts
{ id: "archive-create", href: "/tools/archive-create", label: "archive create", group: "ARCHIVES" },
```

- [ ] **Step 10.3: Add home page card.**

Edit `src/app/page.tsx`. Insert into `TOOLS` after the `archive-extract` entry from Task 6:

```ts
{
  id: "archive-create",
  title: "archive create",
  description: "any files in · zip or tar.gz out · custom filename",
  href: "/tools/archive-create",
},
```

- [ ] **Step 10.4: Add route to COOP/COEP enumeration.**

Edit `tests/e2e/coop-coep.spec.ts`. Add `"/tools/archive-create",` to `TOOL_ROUTES` immediately before `"/tools/archive-extract"`.

- [ ] **Step 10.5: Write the E2E spec.**

Create `tests/e2e/archive-create.spec.ts`:

```ts
import path from "node:path";
import { expect, test } from "@playwright/test";

const FIX = path.resolve(__dirname, "../fixtures/archives");

test("archive-create: drop two files, custom filename, ZIP output", async ({ page }) => {
  await page.goto("/tools/archive-create");
  // Use sample.tar and sample.zip as arbitrary inputs.
  await page.locator('input[type="file"]').setInputFiles([
    path.join(FIX, "sample.tar"),
    path.join(FIX, "sample.zip"),
  ]);
  await page.getByTestId("filename-input").fill("mybundle");
  await expect(page.getByTestId("filename-preview")).toContainText("mybundle.zip");
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
  // The single-output path triggers per-item download in ResultList.
  await page.getByLabel(/download mybundle\.zip/).click();
  const dl = await downloadPromise;
  expect(dl.suggestedFilename()).toBe("mybundle.zip");
});

test("archive-create: tar.gz format updates extension preview", async ({ page }) => {
  await page.goto("/tools/archive-create");
  await page.getByLabel("tar.gz").click();
  await expect(page.getByTestId("filename-preview")).toContainText(".tar.gz");
});

test("archive-create: invalid filename disables convert", async ({ page }) => {
  await page.goto("/tools/archive-create");
  await page.locator('input[type="file"]').setInputFiles(path.join(FIX, "sample.tar"));
  await page.getByTestId("filename-input").fill("bad name with spaces");
  await expect(page.getByTestId("filename-error")).toBeVisible();
  await expect(page.getByTestId("convert-button")).toBeDisabled();
});
```

- [ ] **Step 10.6: Write the privacy regression spec.**

Create `tests/e2e/privacy-regression-archive-create.spec.ts`:

```ts
import path from "node:path";
import { expect, test } from "@playwright/test";

test("archive-create produces zero off-origin requests during conversion", async ({ page }) => {
  page.on("request", () => undefined);
  await page.goto("/tools/archive-create", { waitUntil: "networkidle" });
  page.removeAllListeners("request");

  const off: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.origin !== new URL(page.url()).origin) off.push(req.url());
  });
  const ws: string[] = [];
  page.on("websocket", (w) => {
    if (new URL(w.url()).host !== new URL(page.url()).host) ws.push(w.url());
  });

  await page.locator('input[type="file"]').setInputFiles([
    path.resolve(__dirname, "../fixtures/archives/sample.tar"),
    path.resolve(__dirname, "../fixtures/archives/sample.zip"),
  ]);
  await page.getByTestId("filename-input").fill("priv-bundle");
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");

  expect(off, `archive-create made off-origin requests: ${off.join(", ")}`).toEqual([]);
  expect(ws, `archive-create opened off-origin WebSockets: ${ws.join(", ")}`).toEqual([]);
});
```

- [ ] **Step 10.7: Run E2E.**

Run: `pnpm test:e2e tests/e2e/archive-create.spec.ts tests/e2e/privacy-regression-archive-create.spec.ts tests/e2e/coop-coep.spec.ts`
Expected: PASS.

- [ ] **Step 10.8: Commit.**

```bash
git add src/app/tools/archive-create/ src/components/layout/sidebar.tsx src/app/page.tsx tests/e2e/archive-create.spec.ts tests/e2e/privacy-regression-archive-create.spec.ts tests/e2e/coop-coep.spec.ts
git commit -m "$(cat <<'EOF'
feat(archive-create): route, sidebar entry, home card, E2E

Adds /tools/archive-create, sidebar entry under ARCHIVES, home
grid card, and full E2E coverage including privacy regression
and COOP/COEP enumeration.
EOF
)"
```

---

## Task 11: Final verification gate

**Why:** Cross-cutting verification before declaring Phase 24 complete. All gates must pass before merge.

- [ ] **Step 11.1: Verify branch + clean tree.**

```bash
git rev-parse --abbrev-ref HEAD          # expect: phase-24-archives
git status --porcelain                    # expect: empty
```

- [ ] **Step 11.2: Run full lint + typecheck.**

```bash
pnpm lint
pnpm typecheck
```

Expected: both clean.

- [ ] **Step 11.3: Run full unit + integration test suite serially.**

```bash
pnpm test
```

Expected: PASS. If memory pressure shows up on the 8 GB dev box, retry with:

```bash
pnpm test -- --pool=threads --poolOptions.threads.maxThreads=2
```

- [ ] **Step 11.4: Run full E2E suite serially.**

```bash
pnpm test:e2e
```

Expected: PASS across Chromium / Firefox / WebKit (per `playwright.config.ts`). Two new privacy specs (`archive-extract`, `archive-create`) and two new feature specs land here. COOP/COEP suite picks up both new routes.

- [ ] **Step 11.5: Run the production build + bundle isolation gate.**

```bash
pnpm build
node scripts/check-bundle-isolation.mjs
```

Expected: `bundle-isolation: OK` (or whatever the script's pass message is). The script enumerates engines automatically and asserts neither `archive-extract` nor `archive-create` chunks bleed into the homepage entry. Verify the output explicitly mentions both new engines as checked-and-clean — if either is missing from the report, the registry edit in Task 3 / Task 7 is incomplete.

- [ ] **Step 11.6: Manual smoke in `pnpm dev`.**

```bash
pnpm dev
# Open http://localhost:3000/tools/archive-extract — drop sample.zip; confirm
# 2 entries listed; per-item download produces "hello.txt" + "notes.md"
# (the data/ prefix stripped); "Download all as zip" produces
# "sample-extract.zip" containing "hello.txt" + "data/notes.md".
#
# Open http://localhost:3000/tools/archive-create — drop a couple of files;
# enter "smoke-test" as filename; switch format to tar.gz; click Convert;
# confirm the downloaded archive opens cleanly with `tar -tzf`.
```

Expected: both flows work; confirm visually that the ARCHIVES sidebar group renders between OCR and ABOUT; confirm the home grid shows both new cards.

- [ ] **Step 11.7: Sanity-check committed files vs file map.**

```bash
git diff main --stat
```

Expected: changes only under the paths listed in the file map at the top. No edits to `vercel.json`, `next.config.ts`, `package.json`, `pnpm-lock.yaml`, `_shared/zip.ts`, `_shared/harness.ts`, or `scripts/check-bundle-isolation.mjs`.

- [ ] **Step 11.8: If everything green, push the branch and open the PR.**

```bash
git push -u origin phase-24-archives
gh pr create --title "Phase 24: archive-extract + archive-create + _shared/tar" --body "$(cat <<'EOF'
## Summary

- Adds `archive-extract` (ZIP/TAR/TAR.GZ → multi-file output) with magic-byte
  format detection and pre-flight rejection of encrypted ZIPs, zip-slip,
  > 1 GB single entries, and > 2 GB aggregate expansion.
- Adds `archive-create` (multi-file input → ZIP or TAR.GZ output) with
  StagingArea reorder UX and custom filename + live extension preview.
- Adds hand-rolled `src/engines/_shared/tar/` (POSIX ustar read+write,
  ~150 LOC) — no new third-party deps.
- Extends `ResultList` so per-item download strips entry-path prefixes and
  dedupes basename collisions; "Download all as zip" preserves entry paths
  via `client-zip`'s verbatim entry-name handling.
- Adds the `ARCHIVES` sidebar group; canonical reordering follows in Phase 26.

## Deviations from v2 spec §3.3

- `pako` dropped — `fflate` already provides gzip.
- Aggregate-size cap added (2 GB total uncompressed) on top of the spec's
  per-entry > 1 GB rejection, defending against many-files zip bombs.
- GZIP-of-non-TAR rejected explicitly with an actionable error pointing at
  standalone gunzip on the roadmap.

Both deviations are recorded in `docs/superpowers/specs/2026-05-08-phase-24-archives-design.md` §6 for the Phase 26 v2-spec amendment.

## Test plan

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` all green.
- [ ] `pnpm build && node scripts/check-bundle-isolation.mjs` reports
      both archive engines as clean (no homepage chunk leak).
- [ ] Manual smoke: drop `sample.zip` on archive-extract; drop two files on
      archive-create with a custom filename; both round-trip.
- [ ] Visually verify ARCHIVES sidebar group appears between OCR and ABOUT.
EOF
)"
```

Expected: PR opens cleanly. CI runs all gates. Reviewer reviews; merge happens after approval.

---

## Self-review summary

This plan covers every section of `docs/superpowers/specs/2026-05-08-phase-24-archives-design.md`:

- §1 Library stack → Tasks 1, 4, 9 (fflate + client-zip + hand-rolled tar; no pako).
- §2.2 `_shared/tar/` public surface → Task 1.
- §2.3 `archive-extract` pipeline + validation → Tasks 3, 4.
- §2.4 Bounded `tar.gz` decompression → Task 4 Step 4.3 `extractTarGz`.
- §2.5 ResultList path-handling → Task 5.
- §2.6 `archive-create` entry naming, options, pipeline → Tasks 7, 8, 9.
- §2.7 Sidebar `ARCHIVES` group → Tasks 6, 10.
- §2.8 Home grid additions → Tasks 6, 10.
- §3 UX commitments → Tasks 6, 10.
- §4.1 Co-located unit + integration tests → Tasks 1, 2, 3, 4, 5, 7, 8, 9.
- §4.2 E2E specs → Tasks 6, 10.
- §4.3 Fixture build script + binaries → Task 2.
- §4.4 Bundle isolation → Task 11.
- §4.5 Verification gates → Task 11.
- §5 Risks (TAR edge cases, `buildZipBlob` path preservation, fixture binary construction, fflate ergonomics) → mitigated by Tasks 1, 2, 5.1.
- §6 Deviations from v2 spec → recorded in PR body (Task 11 Step 11.8) for Phase 26 amendment.
- §7 Out-of-scope items → not built; documented in design doc.

Type consistency check: `extractArchive` (Task 4) returns `Promise<OutputItem[]>`, matched by `convertSingle` and consumed by `engine.convert` (Task 3). `createArchive` (Task 9) returns `Promise<OutputItem>`, matched by `convertMulti` and consumed by `engine.convert` (Task 7). `dedupe()` logic in Task 9 worker mirrors `buildDedupeMap()` in Task 5 ResultList — same algorithm, different consumers, intentionally duplicated to keep the worker free of any UI dependency.

Branch + commit-message + branch-discipline constraints from project memory are baked into Tasks -1, 0–11 explicitly.
