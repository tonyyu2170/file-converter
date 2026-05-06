#!/usr/bin/env node
// Copies @ffmpeg/core's UMD distribution from node_modules into public/ffmpeg/
// so the WASM loads same-origin (CSP `connect-src 'self'` enforces this).
//
// Sources: node_modules/@ffmpeg/core/dist/umd/{ffmpeg-core.js, ffmpeg-core.wasm}
// Destination: public/ffmpeg/{ffmpeg-core.js, ffmpeg-core.wasm}
//
// Each copy is hash-verified against scripts/ffmpeg-manifest.json so silent
// drift between the lockfile and the bytes blows up the build.

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const manifest = JSON.parse(
  readFileSync(join(here, "ffmpeg-manifest.json"), "utf8"),
);

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function ensureDir(d) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

const srcDir = join(repoRoot, "node_modules", "@ffmpeg", "core", "dist", "umd");
const dstDir = join(repoRoot, "public", "ffmpeg");
ensureDir(dstDir);

for (const f of manifest.files) {
  const src = join(srcDir, f.name);
  const dst = join(dstDir, f.name);
  if (!existsSync(src)) {
    console.error(`[copy-ffmpeg-core] missing source: ${src}`);
    process.exit(1);
  }
  const actual = sha256(src);
  if (actual !== f.sha256) {
    console.error(
      `[copy-ffmpeg-core] sha256 mismatch for ${f.name}: ` +
        `expected ${f.sha256}, got ${actual}. Update ffmpeg-manifest.json after verifying the new bytes are intentional.`,
    );
    process.exit(1);
  }
  copyFileSync(src, dst);
  console.log(`[copy-ffmpeg-core] copied ${f.name}`);
}
