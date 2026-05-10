#!/usr/bin/env node
// Asserts that vercel.json's global headers rule (source: "/(.*)") carries
// both Cross-Origin-Opener-Policy: same-origin and
// Cross-Origin-Embedder-Policy: require-corp.
//
// Why: tests/e2e/coop-coep.spec.ts validates the headers via Playwright's
// `pnpm dev` server, which reads next.config.ts — not vercel.json. Without
// this script, a PR that strips COOP/COEP from vercel.json (production)
// while leaving next.config.ts (dev) intact would pass CI silently.
//
// Wired via `prebuild` so the failure aborts the build before next-build
// spends real time. Vercel's deploy pipeline runs `pnpm build` per
// vercel.json's buildCommand, so this check fires on every deploy.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const vercelJsonPath = join(repoRoot, "vercel.json");

const vercelConfig = JSON.parse(readFileSync(vercelJsonPath, "utf8"));

const globalRule = (vercelConfig.headers ?? []).find((rule) => rule.source === "/(.*)");

if (!globalRule) {
  console.error(
    "[check-vercel-headers] vercel.json is missing the global headers rule " +
      '(source: "/(.*)"). COOP/COEP must live there so they apply to every route.',
  );
  process.exit(1);
}

const REQUIRED = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

const errors = [];
for (const [key, expected] of Object.entries(REQUIRED)) {
  const entry = (globalRule.headers ?? []).find((h) => h.key === key);
  if (!entry) {
    errors.push(`missing header: ${key}`);
  } else if (entry.value !== expected) {
    errors.push(`${key}: expected "${expected}", got "${entry.value}"`);
  }
}

if (errors.length > 0) {
  console.error(
    `[check-vercel-headers] vercel.json fails COOP/COEP requirements:\n  ${errors.join("\n  ")}\n\nThe Phase 21 design spec requires both headers on every production response so @ffmpeg/core-mt can load. tests/e2e/coop-coep.spec.ts covers the dev-server side; this script covers production.`,
  );
  process.exit(1);
}

console.log(
  "[check-vercel-headers] OK — vercel.json carries COOP same-origin and COEP require-corp",
);

// Expected long-cache rules. WASM / model assets are content-addressed by
// build hash and immutable; if a path moves or its rule is dropped, this
// script fails the prebuild gate so the regression is caught locally.
const REQUIRED_CACHE_RULES = [
  "/models/bg-remove/(.*)",
  "/onnx-wasm/(.*)",
  "/ffmpeg/(.*)",
  "/tesseract/(.*)",
];

const cacheErrors = [];
for (const source of REQUIRED_CACHE_RULES) {
  const rule = (vercelConfig.headers ?? []).find((r) => r.source === source);
  if (!rule) {
    cacheErrors.push(`missing rule: ${source}`);
    continue;
  }
  const cc = (rule.headers ?? []).find((h) => h.key === "Cache-Control");
  if (!cc) {
    cacheErrors.push(`${source}: missing Cache-Control header`);
    continue;
  }
  if (!/max-age=31536000/.test(cc.value) || !/immutable/.test(cc.value)) {
    cacheErrors.push(
      `${source}: Cache-Control should include max-age=31536000 and immutable, got "${cc.value}"`,
    );
  }
}

if (cacheErrors.length > 0) {
  console.error(
    `[check-vercel-headers] vercel.json fails cache-rule requirements:\n  ${cacheErrors.join("\n  ")}\n\nWASM/model assets are content-addressed; long-cache headers are required so first-use cost is paid once.`,
  );
  process.exit(1);
}

console.log(
  `[check-vercel-headers] OK — ${REQUIRED_CACHE_RULES.length} cache rules present (1y immutable)`,
);
