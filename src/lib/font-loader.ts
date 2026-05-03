/**
 * Worker-compatible loader for the bundled OSS font TTFs that the
 * docx-to-pdf engine embeds into output PDFs.
 *
 * Lives outside `src/engines/` so the `no-fetch-in-engines` Biome lint
 * rule continues to scope cleanly. The fetched URLs are same-origin
 * (`/fonts/<name>.ttf`), satisfying the project's `connect-src 'self'`
 * CSP.
 *
 * Caching is module-scoped: once a buffer is fetched in the lifetime
 * of the worker, subsequent calls reuse it. Workers are torn down
 * after each conversion (see `WorkerHarness`), so the cache lifetime
 * coincides with one conversion's lifetime.
 */

import type { BundledFontFamily, FontWeight } from "@/engines/docx-to-pdf/fonts/types";

/** Module-scoped cache. Key: filename. */
const cache = new Map<string, ArrayBuffer>();

/**
 * Returns the bytes of the bundled TTF for a (family, weight, italic)
 * tuple. Fetches from `/fonts/<filename>` on first call; serves from
 * cache thereafter.
 *
 * JetBrains Mono ships only Regular + Bold (no italic variants in the
 * bundle); requesting italic for that family falls back to upright.
 *
 * @throws when the fetch fails (404, network, etc.).
 */
export async function loadFontBytes(
  family: BundledFontFamily,
  weight: FontWeight,
  italic: boolean,
): Promise<ArrayBuffer> {
  const filename = resolveFilename(family, weight, italic);
  const cached = cache.get(filename);
  if (cached) return cached;
  const url = `/fonts/${filename}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`font-loader: ${url} → ${response.status} ${response.statusText}`);
  }
  const bytes = await response.arrayBuffer();
  cache.set(filename, bytes);
  return bytes;
}

/**
 * Maps (family, weight, italic) to the committed filename pattern
 * under `public/fonts/`. Exported for test use.
 */
export function resolveFilename(
  family: BundledFontFamily,
  weight: FontWeight,
  italic: boolean,
): string {
  // JetBrains Mono ships no italic in the bundle; fall back to upright.
  const wantsItalic = italic && family !== "jetbrains-mono";
  const weightPart = weight === 700 ? "bold" : "regular";
  if (wantsItalic && weight === 700) return `${family}-bold-italic.ttf`;
  if (wantsItalic) return `${family}-italic.ttf`;
  return `${family}-${weightPart}.ttf`;
}

/** Test-only: clear the cache. */
export function _resetCache(): void {
  cache.clear();
}
