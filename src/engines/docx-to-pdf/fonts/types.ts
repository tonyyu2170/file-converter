/**
 * Font model for the docx-to-pdf engine.
 *
 * The engine ships three OSS font families (Inter, Lora, JetBrains Mono)
 * subset to Latin Extended-A and committed under `public/fonts/`. The
 * worker fetches them on demand via `src/lib/font-loader.ts` and embeds
 * them in the output PDF via `@pdf-lib/fontkit` at conversion time.
 *
 * `BundledFontFamily` is the closed set of families we ship. DOCX font
 * references arrive as arbitrary strings (e.g., `"Calibri"`,
 * `"Times New Roman"`) — `substitution-map.ts` maps each to one of the
 * three bundled families. Unknown names fall back to a default family.
 */

export type BundledFontFamily = "inter" | "lora" | "jetbrains-mono";

/** PDF weight axes we ship from each family. 400 = regular, 700 = bold. */
export type FontWeight = 400 | 700;
