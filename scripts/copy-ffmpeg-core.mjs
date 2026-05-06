#!/usr/bin/env node
// Copies @ffmpeg/core (single-threaded) and @ffmpeg/core-mt (multi-threaded)
// UMD distributions from node_modules into public/ffmpeg/{st,mt}/ so both
// variants load same-origin (CSP `connect-src 'self'` enforces this).
//
// Sources:
//   node_modules/@ffmpeg/core/dist/umd/{ffmpeg-core.js, ffmpeg-core.wasm}
//   node_modules/@ffmpeg/core-mt/dist/umd/{ffmpeg-core.js, ffmpeg-core.wasm,
//                                          ffmpeg-core.worker.js}
//
// Destinations:
//   public/ffmpeg/st/{ffmpeg-core.js, ffmpeg-core.wasm}
//   public/ffmpeg/mt/{ffmpeg-core.js, ffmpeg-core.wasm, ffmpeg-core.worker.js}
//
// Each copy is hash-verified against scripts/ffmpeg-manifest.json so silent
// drift between the lockfile and the bytes blows up the build.
//
// Runtime selection (which variant is loaded by FFmpeg.load()) is decided by
// src/engines/_shared/ffmpeg/index.ts based on `crossOriginIsolated`.

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

if (!manifest.cores || typeof manifest.cores !== "object") {
  console.error(
    "[copy-ffmpeg-core] manifest missing `cores` map; expected " +
      "{ cores: { mt: {...}, st: {...} } }",
  );
  process.exit(1);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function ensureDir(d) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

for (const [variant, spec] of Object.entries(manifest.cores)) {
  if (variant.includes("/") || variant.includes("\\") || variant.includes("..")) {
    console.error(`[copy-ffmpeg-core] invalid variant key: ${variant}`);
    process.exit(1);
  }

  const srcDir = join(
    repoRoot,
    "node_modules",
    ...spec.package.split("/"),
    "dist",
    "umd",
  );
  const dstDir = join(repoRoot, "public", "ffmpeg", variant);

  if (!existsSync(srcDir)) {
    console.error(
      `[copy-ffmpeg-core] ${spec.package} UMD dir not found: ${srcDir}`,
    );
    process.exit(1);
  }

  ensureDir(dstDir);

  for (const f of spec.files) {
    if (f.name.includes("/") || f.name.includes("\\") || f.name.includes("..")) {
      console.error(
        `[copy-ffmpeg-core] invalid filename in manifest: ${f.name}`,
      );
      process.exit(1);
    }

    const src = join(srcDir, f.name);
    const dst = join(dstDir, f.name);

    if (!existsSync(src)) {
      console.error(`[copy-ffmpeg-core] missing source: ${src}`);
      process.exit(1);
    }
    copyFileSync(src, dst);
    const actual = sha256(dst);
    if (actual !== f.sha256) {
      console.error(
        `[copy-ffmpeg-core] sha256 mismatch for ${variant}/${f.name}: ` +
          `expected ${f.sha256}, got ${actual}. Update ffmpeg-manifest.json ` +
          `after verifying the new bytes are intentional.`,
      );
      process.exit(1);
    }
    console.log(`[copy-ffmpeg-core] copied ${variant}/${f.name}`);
  }
}
