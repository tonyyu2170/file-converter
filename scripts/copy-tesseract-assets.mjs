#!/usr/bin/env node
// Copies Tesseract.js worker + WASM core files from node_modules into
// public/tesseract/ so they load same-origin (CSP `connect-src 'self'`
// enforces this). Also downloads, gzips, and caches eng.traineddata.gz
// from tesseract-ocr/tessdata_best at a pinned commit SHA.
//
// Sources (from node_modules — see tesseract-manifest.json for full list):
//   tesseract.js/dist/worker.min.js
//   tesseract.js-core/tesseract-core{,-simd,-lstm,-simd-lstm,-relaxedsimd,-relaxedsimd-lstm}.wasm{,.js}
//
// NOTE: tesseract.js-core is resolved from tesseract.js's own dependency
// graph (via realpathSync + createRequire) to avoid using the root
// node_modules symlink, which pnpm may point at an older version.
//
// Downloaded:
//   eng.traineddata from tesseract-ocr/tessdata_best (pinned SHA)
//   → gzipped with zlib level 9 → public/tesseract/eng.traineddata.gz
//
// Each copy is hash-verified against scripts/tesseract-manifest.json so
// silent drift between the lockfile and the bytes blows up the build.
//
// Idempotent: a second run with all assets already in place exits quickly
// with "skip" log lines — no re-download, no re-copy.

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const manifest = JSON.parse(
  readFileSync(join(here, "tesseract-manifest.json"), "utf8"),
);

if (!manifest.files || typeof manifest.files !== "object") {
  console.error(
    "[copy-tesseract-assets] manifest missing `files` map; expected " +
      "{ files: { ... }, tessdata_source: { ... } }",
  );
  process.exit(1);
}

if (!manifest.tessdata_source || typeof manifest.tessdata_source !== "object") {
  console.error(
    "[copy-tesseract-assets] manifest missing `tessdata_source` object",
  );
  process.exit(1);
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function ensureDir(d) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

const destDir = join(repoRoot, "public", "tesseract");
ensureDir(destDir);

// Require resolver anchored at the real (non-symlinked) tesseract.js pnpm
// store path, so that peer packages like tesseract.js-core resolve to the
// version tesseract.js actually depends on (v7.0.0), not whatever the root
// node_modules symlink points at (pnpm may keep an older peer there).
//
// We find the real path by resolving the symlink at node_modules/tesseract.js
// and then constructing a createRequire from the resolved location.
const tesseractJsRealDir = realpathSync(
  join(repoRoot, "node_modules", "tesseract.js"),
);
const requireFromTesseractJs = createRequire(
  join(tesseractJsRealDir, "package.json"),
);

function resolveSrc(srcPath) {
  const parts = srcPath.split("/");
  const [pkg, ...rest] = parts;
  // Multi-scoped: handle @scope/name packages.
  const pkgName = pkg.startsWith("@") ? `${pkg}/${rest.shift()}` : pkg;
  const file = rest.join("/");
  const pkgMain = requireFromTesseractJs.resolve(pkgName + "/package.json");
  const pkgDir = dirname(pkgMain);
  return join(pkgDir, file);
}

// 1. Copy node_modules files, verify hash.
for (const [destName, entry] of Object.entries(manifest.files)) {
  if (
    destName.includes("/") ||
    destName.includes("\\") ||
    destName.includes("..")
  ) {
    console.error(
      `[copy-tesseract-assets] invalid filename in manifest: ${destName}`,
    );
    process.exit(1);
  }

  const src = resolveSrc(entry.src);
  const dst = join(destDir, destName);

  // Idempotency: skip if destination already has the right hash.
  if (existsSync(dst) && sha256File(dst) === entry.sha256) {
    console.log(`[copy-tesseract-assets] skip (cached) ${destName}`);
    continue;
  }

  if (!existsSync(src)) {
    console.error(`[copy-tesseract-assets] missing source: ${src}`);
    process.exit(1);
  }

  copyFileSync(src, dst);
  const actual = sha256File(dst);
  if (actual !== entry.sha256) {
    console.error(
      `[copy-tesseract-assets] sha256 mismatch for ${destName}:\n` +
        `  expected ${entry.sha256}\n` +
        `  actual   ${actual}\n` +
        `Update tesseract-manifest.json after verifying the new bytes ` +
        `are intentional.`,
    );
    process.exit(1);
  }
  console.log(`[copy-tesseract-assets] copied ${destName}`);
}

// 2. Download eng.traineddata, gzip it, write to public/tesseract/.
const ts = manifest.tessdata_source;
const gzDst = join(destDir, "eng.traineddata.gz");

// Idempotency: trust the cache if its decompressed bytes match the pinned
// uncompressed SHA. We deliberately do NOT compare the gzipped file's SHA
// against a pinned value — Node's zlib.gzipSync is not byte-deterministic
// across hosts (the gzip header's OS byte differs: macOS=11, Linux=3), so a
// hash computed on a developer's macOS won't match the CI Linux box even
// when the underlying compressed content is identical. The load-bearing
// invariant is that the bytes the BROWSER eventually decompresses match
// the pinned source from tessdata_best — that's what we verify here.
if (existsSync(gzDst)) {
  try {
    const decompressed = gunzipSync(readFileSync(gzDst));
    if (sha256(decompressed) === ts.sha256_uncompressed) {
      console.log("[copy-tesseract-assets] skip (cached) eng.traineddata.gz");
      process.exit(0);
    }
  } catch {
    // Corrupt cache; fall through to re-download.
  }
}

console.log(
  `[copy-tesseract-assets] downloading eng.traineddata from ${ts.url}`,
);
let res;
try {
  res = await fetch(ts.url, { signal: AbortSignal.timeout(60_000) });
} catch (err) {
  console.error(
    `[copy-tesseract-assets] network error downloading ${ts.url}: ${err.message}`,
  );
  process.exit(1);
}
if (!res.ok) {
  console.error(
    `[copy-tesseract-assets] http ${res.status} downloading ${ts.url}`,
  );
  process.exit(1);
}

const raw = Buffer.from(await res.arrayBuffer());

// Verify uncompressed hash.
const rawHash = sha256(raw);
if (rawHash !== ts.sha256_uncompressed) {
  console.error(
    `[copy-tesseract-assets] sha256 mismatch for downloaded eng.traineddata:\n` +
      `  url      ${ts.url}\n` +
      `  expected ${ts.sha256_uncompressed}\n` +
      `  actual   ${rawHash}\n` +
      `Manifest tessdata_source.ref may be pinned to a different blob.`,
  );
  process.exit(1);
}

// Gzip with level 9 (compression ratio is consistent across hosts; only
// the gzip header bytes vary, which is why we don't pin the gzipped SHA).
const compressed = gzipSync(raw, { level: 9 });

writeFileSync(gzDst, compressed);
console.log(
  `[copy-tesseract-assets] wrote eng.traineddata.gz (${compressed.length} bytes)`,
);
console.log("[copy-tesseract-assets] done");
