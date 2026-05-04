#!/usr/bin/env node
// Copies the chosen background-removal ONNX model + ONNX Runtime Web wasm
// glue from node_modules into the public/ tree so they ship same-origin.
//
// Source layout (populated by scripts/fetch-bg-models.mjs):
//   node_modules/.cache/bg-models/<model>/
//     config.json
//     preprocessor_config.json
//     onnx/<weights>.onnx
//
// Destination layout (consumed by transformers.js at runtime via
// env.localModelPath = "/models/" + modelId = "bg-remove"):
//   public/models/bg-remove/
//     config.json
//     preprocessor_config.json
//     onnx/<weights>.onnx
//     MANIFEST.json   (marker so model-loader can sanity-check)
//   public/onnx-wasm/
//     ort-wasm-simd-threaded.{wasm,mjs}
//     ort-wasm-simd-threaded.asyncify.{wasm,mjs}
//     ort-wasm-simd-threaded.jsep.{wasm,mjs}
//
// Each copy is hash-verified against scripts/bg-models-manifest.json so silent
// drift between the lockfile and the bytes blows up the build.

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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const manifest = JSON.parse(
  readFileSync(join(here, "bg-models-manifest.json"), "utf8"),
);

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
  ensureDir(dirname(dst));
  copyFileSync(src, dst);
  const actual = sha256(dst);
  if (actual !== expectedSha) {
    console.error(
      `[copy-bg-models] sha256 mismatch for ${dst}\n  expected ${expectedSha}\n  actual   ${actual}`,
    );
    process.exit(1);
  }
  console.log(`[copy-bg-models] ok ${dst}`);
}

// 1. Model files. Source: node_modules/.cache/bg-models/<model>/<relpath>
//    Destination: public/models/bg-remove/<relpath>
const modelSrcDir = join(
  repoRoot,
  "node_modules",
  ".cache",
  "bg-models",
  manifest.model,
);
const modelDstDir = join(repoRoot, "public", "models", "bg-remove");
ensureDir(modelDstDir);
for (const f of manifest.files) {
  copyAndVerify(
    join(modelSrcDir, f.name),
    join(modelDstDir, f.name),
    f.sha256,
  );
}

// 2. ONNX Runtime Web wasm files. Resolved by anchoring createRequire at the
//    @huggingface/transformers package — that's the public dep that lists
//    onnxruntime-web as a runtime dependency, so resolution works under both
//    pnpm's strict layout (where onnxruntime-web is nested) and flat npm/yarn.
const transformersPkgJsonPath = join(
  repoRoot,
  "node_modules",
  "@huggingface",
  "transformers",
  "package.json",
);
if (!existsSync(transformersPkgJsonPath)) {
  console.error(
    `[copy-bg-models] @huggingface/transformers not installed at ${transformersPkgJsonPath}`,
  );
  process.exit(1);
}
// realpathSync resolves the symlink so createRequire sees the real
// package directory (under .pnpm/), where node_modules/onnxruntime-web
// is reachable for resolution. onnxruntime-web's package.json doesn't
// export `./package.json`, so resolve the main entry and walk up to the
// package root from there.
const transformersRealPkgJson = realpathSync(transformersPkgJsonPath);
const requireFromTransformers = createRequire(transformersRealPkgJson);
const ortMainPath = requireFromTransformers.resolve("onnxruntime-web");
// ortMainPath looks like .../onnxruntime-web/dist/ort.node.min.js — the
// dist/ directory is the parent.
const wasmSrcDir = dirname(ortMainPath);
if (!existsSync(join(wasmSrcDir, "ort-wasm-simd-threaded.wasm"))) {
  console.error(
    `[copy-bg-models] expected ORT dist/ at ${wasmSrcDir} but ort-wasm-simd-threaded.wasm not found there`,
  );
  process.exit(1);
}
const wasmDstDir = join(repoRoot, "public", "onnx-wasm");
ensureDir(wasmDstDir);
for (const f of manifest.wasm) {
  copyAndVerify(
    join(wasmSrcDir, f.name),
    join(wasmDstDir, f.name),
    f.sha256,
  );
}

// 3. Marker file so the runtime can sanity-check that the build copied a
//    matching model. Strip the verbose _notes block to keep the marker terse;
//    requiredDtype, source, license, model, files, wasm all carry through so
//    the runtime model-loader can read them.
const markerManifest = { ...manifest };
delete markerManifest._notes;
writeFileSync(
  join(modelDstDir, "MANIFEST.json"),
  `${JSON.stringify(markerManifest, null, 2)}\n`,
);
console.log(`[copy-bg-models] wrote ${join(modelDstDir, "MANIFEST.json")}`);
console.log("[copy-bg-models] done");
