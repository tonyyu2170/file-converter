/**
 * Parses `word/fontTable.xml`.
 *
 * Output: `Map<string, FontInfo>` keyed by font name. Each entry tracks the
 * font's family classification per OOXML's `<w:family>` element (roman /
 * swiss / modern / script / decorative / auto).
 *
 * The actual substitution decision (which bundled OSS font is used in place
 * of the document's font) lives in Task 6's `fonts/substitution-map.ts`. The
 * font-table values here are informational; the layout engine reads them to
 * decide whether `<w:family>` agrees with the substitution it would otherwise
 * pick by name alone, and to log "no name match" warnings only once per
 * conversion.
 *
 * Schema sketch:
 *
 * ```xml
 * <w:fonts xmlns:w="...">
 *   <w:font w:name="Calibri">
 *     <w:family w:val="swiss"/>
 *     <w:pitch w:val="variable"/>
 *   </w:font>
 *   …
 * </w:fonts>
 * ```
 */

import type { FontFamilyKind, FontInfo } from "./types";
import { createXmlParser, getAttr, getPath, isWellFormedXml, toArray } from "./xml";

export type ParseFontTableResult = {
  value: Map<string, FontInfo>;
  warnings: string[];
};

const VALID_FAMILY_KINDS: ReadonlySet<FontFamilyKind> = new Set([
  "roman",
  "swiss",
  "modern",
  "script",
  "decorative",
  "auto",
]);

function normalizeFamily(raw: string | undefined): FontFamilyKind | undefined {
  if (raw === undefined) return undefined;
  const lc = raw.toLowerCase();
  return (VALID_FAMILY_KINDS as ReadonlySet<string>).has(lc) ? (lc as FontFamilyKind) : undefined;
}

export function parseFontTableXml(xml: string): ParseFontTableResult {
  const warnings: string[] = [];
  const empty = new Map<string, FontInfo>();

  if (!isWellFormedXml(xml)) {
    warnings.push("fontTable: malformed XML, returning empty map");
    return { value: empty, warnings };
  }

  let json: unknown;
  try {
    json = createXmlParser().parse(xml);
  } catch {
    warnings.push("fontTable: parser threw, returning empty map");
    return { value: empty, warnings };
  }

  const root = getPath(json, ["w:fonts"]);
  if (root === undefined) {
    warnings.push("fontTable: missing <w:fonts> root, returning empty map");
    return { value: empty, warnings };
  }

  const fonts = toArray(getPath(root, ["w:font"]) as unknown);
  const out = new Map<string, FontInfo>();

  for (const font of fonts) {
    const name = getAttr(font, "w:name");
    if (name === undefined || name.length === 0) continue;

    const familyRaw = getAttr(getPath(font, ["w:family"]), "w:val");
    const family = normalizeFamily(familyRaw);

    out.set(name, {
      name,
      ...(family !== undefined ? { family } : {}),
    });
  }

  return { value: out, warnings };
}
