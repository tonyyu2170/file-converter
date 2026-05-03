/**
 * Shared fast-xml-parser configuration for the OOXML parsers.
 *
 * fast-xml-parser defaults are wrong for our needs in three ways and we
 * centralize the override here so all five parsers share one source of truth:
 *
 * 1. `ignoreAttributes` defaults `true` — every `<w:val>`-style attribute
 *    would silently disappear. We need them, so it's set `false` and we
 *    prefix each attribute key with `@_`.
 * 2. `parseTagValue` / `parseAttributeValue` default `true` — they coerce
 *    numeric-looking strings to numbers. OOXML `<w:val="24"/>` is a string
 *    in semantics; we coerce numerically inside the typed extractors instead.
 * 3. fast-xml-parser collapses single occurrences into objects but wraps
 *    repeating tags into arrays. The `isArray` predicate forces always-array
 *    for a fixed list of OOXML elements that *can* appear multiple times,
 *    so callers always see arrays and don't need shape-detection branches.
 */

import { XMLParser, XMLValidator } from "fast-xml-parser";

/**
 * OOXML elements we always treat as arrays — even when there's only one in
 * the document. Centralizing the list once here keeps every parser's
 * traversal code uniform.
 */
const ALWAYS_ARRAY = new Set<string>([
  // body / paragraph / table layer (used in Task 5; harmless here)
  "w:p",
  "w:r",
  "w:tbl",
  "w:tr",
  "w:tc",
  "w:hyperlink",
  "w:drawing",
  "w:t",
  // numbering
  "w:lvl",
  "w:num",
  "w:abstractNum",
  "w:lvlOverride",
  // styles
  "w:style",
  // section / header-footer references
  "w:headerReference",
  "w:footerReference",
  // relationships
  "Relationship",
  // font table
  "w:font",
]);

export function createXmlParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    isArray: (name) => ALWAYS_ARRAY.has(name),
  });
}

/**
 * Returns `true` when the input is well-formed XML, `false` otherwise.
 *
 * fast-xml-parser's `XMLParser.parse` is very lenient — `"<unclosed>"` and
 * `""` both produce empty objects rather than throwing. To reliably detect
 * malformed input (so a parser can return its safe default + warning) we
 * call `XMLValidator.validate` first and fail fast on its error result.
 */
export function isWellFormedXml(xml: string): boolean {
  return XMLValidator.validate(xml) === true;
}

/* ------------------------------------------------------------------ */
/*   OOXML unit conversions                                           */
/* ------------------------------------------------------------------ */

/**
 * 20 twips per point. Used for page sizes, margins, column gutters, and most
 * dimensional fields in OOXML.
 */
export const TWIPS_PER_POINT = 20;

/** Convert a twip value to PostScript points. NaN-in → 0-out (safe default). */
export function twipsToPt(twips: number): number {
  if (!Number.isFinite(twips)) return 0;
  return twips / TWIPS_PER_POINT;
}

/**
 * Parse a string attribute value to a non-negative integer.
 * Returns `undefined` for missing / non-numeric / negative inputs.
 */
export function parseNonNegInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

/* ------------------------------------------------------------------ */
/*   Generic traversal helpers                                        */
/* ------------------------------------------------------------------ */

/**
 * Walks an `unknown`-typed parser output looking up a chain of property
 * names. Returns `undefined` at the first missing/non-object step.
 *
 * Pattern: `getPath(json, ["w:document", "w:body", "w:sectPr"])` rather than
 * a thicket of `if (typeof x === "object" && ...)` checks per parser.
 */
export function getPath(value: unknown, path: ReadonlyArray<string>): unknown {
  let cur: unknown = value;
  for (const key of path) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * Coerces a value to an array when it's an object/value and was meant to be
 * one. Used for fields that *can* be arrays per `ALWAYS_ARRAY` but where the
 * caller still wants a uniform iteration. Single `string`/`number` values
 * become a single-element array; `null`/`undefined` becomes `[]`.
 */
export function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Returns the named attribute value (string) on a parsed-XML object, or
 * `undefined` when the attribute is missing or the input is not an object.
 * Pass the attribute name without the `@_` prefix (e.g., `"w:val"`).
 */
export function getAttr(node: unknown, attrName: string): string | undefined {
  if (node === null || node === undefined || typeof node !== "object") return undefined;
  const v = (node as Record<string, unknown>)[`@_${attrName}`];
  return typeof v === "string" ? v : undefined;
}
