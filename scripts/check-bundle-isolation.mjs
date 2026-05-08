#!/usr/bin/env node
// Runs after `next build` (wired via `postbuild`). Asserts no per-engine
// code leaks into the homepage entry chunk.
//
// Strategy: cross-reference two Next.js build manifests.
//
//   app-build-manifest.json   — maps each page route to its required chunks.
//   react-loadable-manifest.json — maps each dynamic import (engine lazy
//                                  loaders in registry.ts) to the chunk files
//                                  that will be fetched when it fires.
//
// The check:
//   1. Collect the homepage (/page) chunk set from app-build-manifest.
//   2. Compute the "shared by all" set — chunks that every page needs
//      (framework, runtime). These are expected on the homepage and ignored.
//   3. Compute homepage-exclusive = homepage set − shared set. These chunks
//      are only loaded because of the homepage itself.
//   4. For each engine, look up its lazy-load files in react-loadable-manifest.
//      If any of those files appear in homepage-exclusive, the engine's code
//      is loading on the homepage — a bundle isolation violation.
//
// Note on false positives: if engine A leaks and engines B and C share a
// chunk with A (e.g., a common UI library both use), B and C will also be
// flagged. Fix the root leak (A) and the cascade disappears.
//
// This approach is robust to minification: it uses build-system metadata
// rather than grepping for source-path strings (which Webpack strips in
// production).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const NEXT_DIR = path.join(ROOT, ".next");
const OUT_DIR = path.join(ROOT, "out");
const ENGINES_DIR = path.join(ROOT, "src", "engines");

// ── Pre-flight checks ──────────────────────────────────────────────────────

if (!existsSync(NEXT_DIR)) {
  console.error(
    `bundle-isolation: ${NEXT_DIR} does not exist; run \`pnpm build\` first`,
  );
  process.exit(1);
}

const ENGINE_IDS = readdirSync(ENGINES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
  .map((d) => d.name);

if (ENGINE_IDS.length === 0) {
  console.error(
    "bundle-isolation: no engine directories found under src/engines/",
  );
  process.exit(1);
}

const buildManifestPath = path.join(NEXT_DIR, "app-build-manifest.json");
if (!existsSync(buildManifestPath)) {
  console.error(
    `bundle-isolation: ${buildManifestPath} not found; is this a Next.js App Router project?`,
  );
  process.exit(1);
}

const loadableManifestPath = path.join(
  NEXT_DIR,
  "react-loadable-manifest.json",
);
if (!existsSync(loadableManifestPath)) {
  console.error(
    `bundle-isolation: ${loadableManifestPath} not found; is this a Next.js App Router project?`,
  );
  process.exit(1);
}

// ── Load manifests ─────────────────────────────────────────────────────────

const buildManifest = JSON.parse(readFileSync(buildManifestPath, "utf-8"));
const loadableManifest = JSON.parse(
  readFileSync(loadableManifestPath, "utf-8"),
);

const pages = buildManifest.pages;
if (!pages) {
  console.error(
    "bundle-isolation: app-build-manifest.json has no 'pages' key; " +
      "unexpected format",
  );
  process.exit(1);
}

const homepageChunks = pages["/page"];
if (!homepageChunks) {
  console.error(
    "bundle-isolation: app-build-manifest.json has no '/page' entry; " +
      "homepage not found in build output",
  );
  process.exit(1);
}

// ── Compute shared-by-all and homepage-exclusive sets ──────────────────────

const allPageChunkSets = Object.values(pages).map((chunks) => new Set(chunks));
const sharedByAll = allPageChunkSets.reduce(
  (acc, set) => new Set([...acc].filter((c) => set.has(c))),
);

const homepageExclusive = new Set(
  homepageChunks.filter((c) => !sharedByAll.has(c)),
);

// ── Cross-reference per-engine lazy bundles ────────────────────────────────

// react-loadable-manifest keys look like:
//   "engines/_shared/registry.ts -> @/engines/pdf-merge"
// We only care about registry -> engine entries.
const REGISTRY_PREFIX = "engines/_shared/registry.ts -> @/engines/";

const offenders = [];

for (const id of ENGINE_IDS) {
  const manifestKey = `${REGISTRY_PREFIX}${id}`;
  const entry = loadableManifest[manifestKey];
  if (!entry) {
    // Engine exists on disk but has no loadable-manifest entry. This is a
    // real problem — it means the engine is not lazy-loaded via registry.ts
    // at all, which is itself an isolation violation. Report it separately.
    offenders.push({
      engineId: id,
      reason: "not found in react-loadable-manifest (not lazy-loaded via registry.ts?)",
      chunks: [],
    });
    continue;
  }

  const engineFiles = entry.files ?? [];
  const leaked = engineFiles.filter((f) => homepageExclusive.has(f));
  if (leaked.length > 0) {
    offenders.push({ engineId: id, reason: "chunk(s) in homepage-exclusive set", chunks: leaked });
  }
}

// ── Report ─────────────────────────────────────────────────────────────────

if (offenders.length > 0) {
  console.error("bundle-isolation: per-engine code found in homepage chunks:");
  for (const o of offenders) {
    console.error(`  [${o.engineId}]  ${o.reason}`);
    for (const c of o.chunks) {
      console.error(`    chunk: ${c}`);
    }
  }
  console.error(
    "\nFix: ensure all engines are imported only via the lazy loader in",
  );
  console.error(
    "src/engines/_shared/registry.ts, not directly from the homepage",
  );
  console.error("or any of its eager imports.");
  console.error(
    "\nNote: if multiple engines are flagged due to a shared chunk, fix the",
  );
  console.error("root engine leak first — the cascade will resolve.");
  process.exit(1);
}

console.log(
  `bundle-isolation: OK — homepage chunks are clean of ${ENGINE_IDS.length} engines`,
);

// ── Pass B: forbidden CDN strings in any built chunk ──────────────────────
//
// Ensures that langPath / corePath / workerPath overrides are in place for
// Tesseract. If any built JS chunk contains these CDN hostnames, the engine
// would fetch assets from a third-party server at runtime, breaking the
// privacy guarantee.
//
// NOTE on cdn.jsdelivr.net: tesseract.js and onnxruntime-web both embed
// their own CDN default strings as dead-code library internals that are
// bundled regardless of whether caller code overrides the paths. A static
// grep cannot distinguish a live CDN leak from an overridden-but-still-
// bundled default. cdn.jsdelivr.net is therefore NOT in this list — the
// Playwright privacy regression spec asserts zero off-origin requests at
// runtime, which is the load-bearing gate for that concern.
//
// tessdata.projectnaptha.com is Tesseract-specific and empirically absent
// from the current build; it is safe to gate statically because it only
// appears if langPath is not overridden to a same-origin path.

const FORBIDDEN_STRINGS = [
  "tessdata.projectnaptha.com",
];

const CHUNKS_DIR = path.join(OUT_DIR, "_next", "static", "chunks");

if (!existsSync(CHUNKS_DIR)) {
  console.error(
    `bundle-isolation: ${CHUNKS_DIR} does not exist; run \`pnpm build\` first`,
  );
  process.exit(1);
}

/** Recursively collect all .js files under a directory. */
function collectJsFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      results.push(fullPath);
    }
  }
  return results;
}

const jsFiles = collectJsFiles(CHUNKS_DIR);
const cdnOffenders = [];

for (const filePath of jsFiles) {
  const content = readFileSync(filePath, "utf-8");
  for (const pattern of FORBIDDEN_STRINGS) {
    if (content.includes(pattern)) {
      cdnOffenders.push({ filePath, pattern });
    }
  }
}

if (cdnOffenders.length > 0) {
  console.error(
    "bundle-isolation: forbidden CDN strings found in built chunks:",
  );
  for (const { filePath, pattern } of cdnOffenders) {
    const rel = path.relative(ROOT, filePath);
    console.error(`  pattern: "${pattern}"`);
    console.error(`  file:    ${rel}`);
  }
  console.error(
    "\nFix: ensure langPath is overridden to a same-origin path",
  );
  console.error(
    "in the engine's Tesseract loader (src/engines/_shared/tesseract/index.ts).",
  );
  process.exit(1);
}

console.log(
  `bundle-isolation: OK — no forbidden CDN strings in ${jsFiles.length} chunks`,
);
