/**
 * Maps DOCX font-family references to the three bundled OSS families
 * (Inter / Lora / JetBrains Mono).
 *
 * The map is intentionally narrow: we cover the ~20 fonts that show up
 * in real-world personal-use documents (Calibri/Cambria/Arial/Times NR
 * by far the most common). Unknown names fall back to `DEFAULT_SUB`
 * (Inter) — a serviceable sans-serif default for any text we can't
 * categorize.
 *
 * Lookups are case-insensitive: DOCX writers vary on capitalization and
 * we don't want `"calibri"` vs `"Calibri"` to miss.
 */

import type { BundledFontFamily } from "./types";

/** Default substitution when a name isn't in the map. */
export const DEFAULT_SUB: BundledFontFamily = "inter";

const SUBSTITUTIONS: ReadonlyMap<string, BundledFontFamily> = new Map([
  // Sans-serif → Inter
  ["calibri", "inter"],
  ["calibri light", "inter"],
  ["arial", "inter"],
  ["helvetica", "inter"],
  ["helvetica neue", "inter"],
  ["verdana", "inter"],
  ["tahoma", "inter"],
  ["open sans", "inter"],
  ["roboto", "inter"],
  ["segoe ui", "inter"],
  // Serif → Lora
  ["cambria", "lora"],
  ["cambria math", "lora"],
  ["times new roman", "lora"],
  ["times", "lora"],
  ["georgia", "lora"],
  ["garamond", "lora"],
  ["palatino", "lora"],
  ["palatino linotype", "lora"],
  // Monospace → JetBrains Mono
  ["courier new", "jetbrains-mono"],
  ["courier", "jetbrains-mono"],
  ["consolas", "jetbrains-mono"],
  ["monaco", "jetbrains-mono"],
  ["menlo", "jetbrains-mono"],
] satisfies Array<[string, BundledFontFamily]>);

/**
 * Resolves a DOCX font family name to one of the bundled families.
 * Returns `DEFAULT_SUB` when the name isn't recognized or is undefined.
 *
 * @param name — raw font name from DOCX (`<w:rFonts w:ascii="..." />`).
 * @returns the bundled family to load + embed.
 */
export function pickFont(name: string | undefined): BundledFontFamily {
  if (name === undefined) return DEFAULT_SUB;
  const lower = name.trim().toLowerCase();
  if (lower === "") return DEFAULT_SUB;
  return SUBSTITUTIONS.get(lower) ?? DEFAULT_SUB;
}

/**
 * Returns true iff the name has an explicit substitution entry.
 * Used by the engine to decide whether a "font substituted" warning
 * is worth emitting (don't warn on the default fall-through; do warn
 * when the name was real but unrecognized so the user knows).
 */
export function isKnownFont(name: string | undefined): boolean {
  if (name === undefined) return false;
  const lower = name.trim().toLowerCase();
  return SUBSTITUTIONS.has(lower);
}
