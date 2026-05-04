#!/usr/bin/env node
// Populates node_modules/.cache/bg-models/<model>/ from HuggingFace by
// pinned commit SHA. Idempotent: if every manifest file is already present
// with a matching sha256, exits 0 immediately.
//
// Layout mirrors HuggingFace's tree exactly (the canonical onnx-community
// layout has model weights in an `onnx/` subfolder and config files at root),
// so manifest entries that include `onnx/` in their `name` are treated as
// relative paths under the model's cache directory.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const manifest = JSON.parse(
  readFileSync(join(here, "bg-models-manifest.json"), "utf8"),
);

const [hfRepo, hfCommit] = manifest.source.split("@");
if (!hfRepo || !hfCommit) {
  console.error(
    "[fetch-bg-models] manifest.source must be 'owner/repo@commitSha'",
  );
  process.exit(1);
}

const cacheDir = join(
  repoRoot,
  "node_modules",
  ".cache",
  "bg-models",
  manifest.model,
);
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
  const dst = join(cacheDir, f.name);
  if (existsSync(dst) && sha256(readFileSync(dst)) === f.sha256) {
    console.log(`[fetch-bg-models] cached ${f.name}`);
    continue;
  }
  const url = `https://huggingface.co/${hfRepo}/resolve/${hfCommit}/${f.name}`;
  console.log(`[fetch-bg-models] downloading ${f.name} from ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[fetch-bg-models] http ${res.status} for ${url}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const actual = sha256(buf);
  if (actual !== f.sha256) {
    console.error(
      `[fetch-bg-models] sha256 mismatch for ${f.name}\n  url      ${url}\n  expected ${f.sha256}\n  actual   ${actual}\n  manifest may be stale or HF commit pinned to a different blob`,
    );
    process.exit(1);
  }
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, buf);
  console.log(`[fetch-bg-models] wrote ${dst} (${buf.length} bytes)`);
}
console.log("[fetch-bg-models] done");
