/**
 * Parses `word/numbering.xml`.
 *
 * Output: `Map<string, NumberingDef>` keyed by `numId`. Each entry's `levels`
 * map carries up to 9 entries (`ilvl` 0–8), each with a `format` and a
 * `text` template (e.g., `"%1."` or `"•"`).
 *
 * The numbering schema indirects through abstract definitions:
 *
 * ```xml
 * <w:numbering xmlns:w="...">
 *   <w:abstractNum w:abstractNumId="0">
 *     <w:lvl w:ilvl="0">
 *       <w:numFmt w:val="bullet"/>
 *       <w:lvlText w:val="•"/>
 *     </w:lvl>
 *     <w:lvl w:ilvl="1">…</w:lvl>
 *   </w:abstractNum>
 *   <w:num w:numId="1">
 *     <w:abstractNumId w:val="0"/>
 *     <!-- optional <w:lvlOverride>s here override individual levels -->
 *   </w:num>
 * </w:numbering>
 * ```
 *
 * We resolve the indirection at parse time so consumers see flat `numId →
 * level map` data without a second pass. Level overrides (`<w:lvlOverride>`)
 * are applied on top of the abstract-num levels to produce the final map.
 */

import type { NumberingDef, NumberingFormat, NumberingLevel } from "./types";
import { createXmlParser, getAttr, getPath, isWellFormedXml, toArray } from "./xml";

export type ParseNumberingResult = {
  value: Map<string, NumberingDef>;
  warnings: string[];
};

/* ------------------------------------------------------------------ */
/*   Format normalizer                                                */
/* ------------------------------------------------------------------ */

const VALID_FORMATS: ReadonlySet<NumberingFormat> = new Set<NumberingFormat>([
  "decimal",
  "lowerLetter",
  "upperLetter",
  "lowerRoman",
  "upperRoman",
  "bullet",
]);

/**
 * Normalizes `<w:numFmt w:val="...">` to one of the formats we support.
 * Anything outside the supported set falls back to `"decimal"` (the most
 * common ordered format), which the layout engine will render as `1.`,
 * `2.`, etc. — a reasonable degradation for exotic formats like
 * `chineseCounting`.
 */
function normalizeFormat(raw: string | undefined): NumberingFormat {
  if (raw !== undefined && (VALID_FORMATS as ReadonlySet<string>).has(raw)) {
    return raw as NumberingFormat;
  }
  return "decimal";
}

/* ------------------------------------------------------------------ */
/*   <w:lvl> extractor                                                */
/* ------------------------------------------------------------------ */

function extractLevel(lvlNode: unknown): NumberingLevel | undefined {
  const ilvlRaw = getAttr(lvlNode, "w:ilvl");
  if (ilvlRaw === undefined) return undefined;
  const ilvl = Number.parseInt(ilvlRaw, 10);
  if (!Number.isFinite(ilvl) || ilvl < 0 || ilvl > 8) return undefined;

  const format = normalizeFormat(getAttr(getPath(lvlNode, ["w:numFmt"]), "w:val"));
  // Bullet text per OOXML; default `"•"` if missing for bullet, `"%1."` for
  // decimal-like — we can't peek at the format here without extra branching,
  // so fall back to `""` and let the layout engine substitute.
  const text = getAttr(getPath(lvlNode, ["w:lvlText"]), "w:val") ?? "";

  return { ilvl, format, text };
}

/* ------------------------------------------------------------------ */
/*   Public parser                                                    */
/* ------------------------------------------------------------------ */

export function parseNumberingXml(xml: string): ParseNumberingResult {
  const warnings: string[] = [];
  const empty = new Map<string, NumberingDef>();

  if (!isWellFormedXml(xml)) {
    warnings.push("numbering: malformed XML, returning empty map");
    return { value: empty, warnings };
  }

  let json: unknown;
  try {
    json = createXmlParser().parse(xml);
  } catch {
    warnings.push("numbering: parser threw, returning empty map");
    return { value: empty, warnings };
  }

  const root = getPath(json, ["w:numbering"]);
  if (root === undefined) {
    warnings.push("numbering: missing <w:numbering> root, returning empty map");
    return { value: empty, warnings };
  }

  // ---- Build abstractNumId → levels map -------------------------------
  const abstractNums = toArray(getPath(root, ["w:abstractNum"]) as unknown);
  const abstractByid = new Map<string, Map<number, NumberingLevel>>();
  for (const aNum of abstractNums) {
    const aid = getAttr(aNum, "w:abstractNumId");
    if (aid === undefined) continue;
    const levels = new Map<number, NumberingLevel>();
    for (const lvlNode of toArray(getPath(aNum, ["w:lvl"]) as unknown)) {
      const lvl = extractLevel(lvlNode);
      if (lvl !== undefined) levels.set(lvl.ilvl, lvl);
    }
    abstractByid.set(aid, levels);
  }

  // ---- Resolve <w:num> instances --------------------------------------
  const out = new Map<string, NumberingDef>();
  const numEntries = toArray(getPath(root, ["w:num"]) as unknown);
  for (const numEntry of numEntries) {
    const numId = getAttr(numEntry, "w:numId");
    if (numId === undefined) continue;

    const aid = getAttr(getPath(numEntry, ["w:abstractNumId"]), "w:val");
    const baseLevels = aid !== undefined ? abstractByid.get(aid) : undefined;

    // Copy the abstract levels (so per-num overrides don't leak across instances).
    const levels = new Map<number, NumberingLevel>();
    if (baseLevels !== undefined) {
      for (const [k, v] of baseLevels) levels.set(k, v);
    }

    // Apply <w:lvlOverride w:ilvl="N"><w:lvl>...</w:lvl></w:lvlOverride>.
    // <w:lvl> is in ALWAYS_ARRAY, so even a single child arrives as an array.
    const overrides = toArray(getPath(numEntry, ["w:lvlOverride"]) as unknown);
    for (const ovr of overrides) {
      const innerLvls = toArray(getPath(ovr, ["w:lvl"]) as unknown);
      for (const lvlNode of innerLvls) {
        const lvl = extractLevel(lvlNode);
        if (lvl !== undefined) levels.set(lvl.ilvl, lvl);
      }
    }

    out.set(numId, { numId, levels });
  }

  return { value: out, warnings };
}
