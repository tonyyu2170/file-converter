#!/usr/bin/env node
// Subsets the three OSS font families used by the docx-to-pdf engine
// (Inter, Lora, JetBrains Mono) to a Latin Extended A glyph range and
// writes the outputs to public/fonts/.
//
// Source TTFs: fetched from github.com/google/fonts (canonical OSS host).
// google/fonts ships these as variable-axis fonts; this script
// pins weight (and opsz where present) to produce static instances.
//
// Subsetter: subset-font (Harfbuzz/Brotli WASM-backed). It both
// instances the variable axes and clips the glyph table.
//
// Run:   node tools/subset-fonts.mjs
//
// Outputs: ~50 KB per file. Total ~500 KB across 10 files. Outputs
// are committed; this script is not run in CI.
//
// See tools/subset-fonts.README.md for the upstream license details.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import subsetFont from "subset-font";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const PUBLIC_FONTS = join(REPO_ROOT, "public", "fonts");
const CACHE_DIR = join(tmpdir(), "docx-to-pdf-font-sources");

// Five source variable fonts; ten output static instances.
// `wght` instances per spec: 400 (Regular) and 700 (Bold).
// `opsz` (Inter only) pinned to 14 — the optical size for body text.
const SOURCES = [
  // Inter upright variable: produces Regular + Bold
  { srcPath: "ofl/inter/Inter[opsz,wght].ttf",          axes: { wght: 400, opsz: 14 }, out: "inter-regular.ttf" },
  { srcPath: "ofl/inter/Inter[opsz,wght].ttf",          axes: { wght: 700, opsz: 14 }, out: "inter-bold.ttf" },
  // Inter italic variable: produces Italic + Bold-Italic
  { srcPath: "ofl/inter/Inter-Italic[opsz,wght].ttf",   axes: { wght: 400, opsz: 14 }, out: "inter-italic.ttf" },
  { srcPath: "ofl/inter/Inter-Italic[opsz,wght].ttf",   axes: { wght: 700, opsz: 14 }, out: "inter-bold-italic.ttf" },
  // Lora upright + italic variables
  { srcPath: "ofl/lora/Lora[wght].ttf",                 axes: { wght: 400 },           out: "lora-regular.ttf" },
  { srcPath: "ofl/lora/Lora[wght].ttf",                 axes: { wght: 700 },           out: "lora-bold.ttf" },
  { srcPath: "ofl/lora/Lora-Italic[wght].ttf",          axes: { wght: 400 },           out: "lora-italic.ttf" },
  { srcPath: "ofl/lora/Lora-Italic[wght].ttf",          axes: { wght: 700 },           out: "lora-bold-italic.ttf" },
  // JetBrains Mono upright variable: Regular + Bold (no italic in spec scope)
  { srcPath: "ofl/jetbrainsmono/JetBrainsMono[wght].ttf", axes: { wght: 400 },         out: "jetbrains-mono-regular.ttf" },
  { srcPath: "ofl/jetbrainsmono/JetBrainsMono[wght].ttf", axes: { wght: 700 },         out: "jetbrains-mono-bold.ttf" },
];

// Latin Extended A coverage: U+0020-024F covers basic ASCII + Latin-1
// Supplement + Latin Extended-A. Plus standard Western punctuation,
// currency, and a handful of typographic glyphs commonly found in
// Word documents.
function buildSubsetGlyphString() {
  const ranges = [
    [0x0020, 0x007e], // Basic Latin (printable ASCII)
    [0x00a0, 0x00ff], // Latin-1 Supplement
    [0x0100, 0x017f], // Latin Extended-A
    [0x2000, 0x206f], // General Punctuation (en/em dash, smart quotes, etc.)
    [0x20a0, 0x20cf], // Currency symbols
    [0x2122, 0x2122], // Trademark
    [0x2192, 0x2192], // Right arrow (→)
    [0x00d7, 0x00d7], // Multiplication sign
    [0xfeff, 0xfeff], // BOM (rendered as nothing)
    [0xfffd, 0xfffd], // Replacement character
  ];
  const chars = [];
  for (const [start, end] of ranges) {
    for (let cp = start; cp <= end; cp++) chars.push(String.fromCodePoint(cp));
  }
  return chars.join("");
}

async function fetchSourceTtf(srcPath) {
  // Use the source path as the cache key (encoded for filesystem safety).
  const cachedName = srcPath.replace(/[/[\],]/g, "_");
  const cachedPath = join(CACHE_DIR, cachedName);
  try {
    return await readFile(cachedPath);
  } catch {
    // not cached, fall through to fetch
  }
  // GitHub raw URL with [ and ] URL-encoded.
  const encodedPath = srcPath.replace(/\[/g, "%5B").replace(/\]/g, "%5D");
  const url = `https://github.com/google/fonts/raw/main/${encodedPath}`;
  process.stdout.write(`fetching ${url}\n  → `);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetch ${url} → ${response.status} ${response.statusText}`);
  }
  const buf = Buffer.from(await response.arrayBuffer());
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachedPath, buf);
  process.stdout.write(`${(buf.length / 1024).toFixed(1)} KB cached\n`);
  return buf;
}

async function main() {
  const subsetText = buildSubsetGlyphString();
  await mkdir(PUBLIC_FONTS, { recursive: true });
  let totalOut = 0;
  for (const entry of SOURCES) {
    const sourceBuf = await fetchSourceTtf(entry.srcPath);
    process.stdout.write(`subsetting ${entry.out} (${JSON.stringify(entry.axes)})... `);
    const subset = await subsetFont(sourceBuf, subsetText, {
      targetFormat: "truetype",
      variationAxes: entry.axes,
    });
    const outPath = join(PUBLIC_FONTS, entry.out);
    await writeFile(outPath, subset);
    process.stdout.write(`${(subset.length / 1024).toFixed(1)} KB\n`);
    totalOut += subset.length;
  }
  process.stdout.write(`\nDone. Total ${(totalOut / 1024).toFixed(1)} KB across ${SOURCES.length} files.\n`);
}

main().catch((err) => {
  process.stderr.write(`subset-fonts: ${err.message}\n`);
  process.exit(1);
});
