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
 * Order-preserving variant of `createXmlParser`. Required for body-shape
 * XML (`document.xml`, footnote bodies, header/footer bodies) where children
 * of mixed tag types are interleaved and document order is semantically
 * load-bearing — paragraphs and tables share a parent in `<w:body>`, runs
 * mix `<w:t>`, `<w:tab/>`, `<w:br/>`, `<w:drawing>`, and `<w:footnoteReference>`
 * inside a single `<w:r>` etc.
 *
 * fast-xml-parser's default mode buckets children by tag name, dropping the
 * inter-tag ordering. `preserveOrder: true` switches the output shape to an
 * ordered array of single-key objects:
 *
 * ```
 * [{ "w:p": [<children-in-order>...], ":@": {<attrs>} },
 *  { "w:tbl": [...] },
 *  { "w:p": [...] }]
 * ```
 *
 * Each entry has exactly one tag-named key (its children array) plus an
 * optional `":@"` key carrying the element's attributes. Text content is
 * a child entry of shape `{ "#text": "..." }`. Use the `getTagName`,
 * `getOrderedChildren`, and `getOrderedAttr` helpers below to traverse.
 */
export function createOrderedXmlParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    preserveOrder: true,
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

/* ------------------------------------------------------------------ */
/*   Ordered-mode (preserveOrder) traversal helpers                   */
/* ------------------------------------------------------------------ */

/**
 * In `preserveOrder` mode each child entry is a single-key object whose key
 * is the element's tag name (or `"#text"`), plus an optional `":@"` key
 * holding the attributes. This shape returns the tag name. Returns
 * `undefined` for non-object input or entries with no recognizable tag key.
 */
export function getTagName(entry: unknown): string | undefined {
  if (entry === null || entry === undefined || typeof entry !== "object") return undefined;
  const obj = entry as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key === ":@") continue;
    return key;
  }
  return undefined;
}

/**
 * Returns the ordered children array under the entry's tag key. Always
 * returns an array (empty when the entry has no children or shape doesn't
 * match). Use after `getTagName` to walk into a node.
 */
export function getOrderedChildren(entry: unknown): unknown[] {
  if (entry === null || entry === undefined || typeof entry !== "object") return [];
  const obj = entry as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key === ":@") continue;
    const v = obj[key];
    if (Array.isArray(v)) return v;
    return [];
  }
  return [];
}

/**
 * Returns the named attribute value from a `preserveOrder` entry's `":@"`
 * bucket. Pass the attribute name without the `@_` prefix.
 */
export function getOrderedAttr(entry: unknown, attrName: string): string | undefined {
  if (entry === null || entry === undefined || typeof entry !== "object") return undefined;
  const attrs = (entry as Record<string, unknown>)[":@"];
  if (attrs === null || attrs === undefined || typeof attrs !== "object") return undefined;
  const v = (attrs as Record<string, unknown>)[`@_${attrName}`];
  return typeof v === "string" ? v : undefined;
}

/**
 * Returns the first ordered child whose tag name matches `tag`, or
 * `undefined` when none is found. Useful for "find the unique <w:pPr> inside
 * this <w:p>" patterns.
 */
export function findOrderedChild(parent: unknown, tag: string): unknown {
  for (const child of getOrderedChildren(parent)) {
    if (getTagName(child) === tag) return child;
  }
  return undefined;
}

/**
 * Returns all ordered children whose tag name matches `tag`. Preserves
 * document order across same-name siblings.
 */
export function findOrderedChildren(parent: unknown, tag: string): unknown[] {
  const out: unknown[] = [];
  for (const child of getOrderedChildren(parent)) {
    if (getTagName(child) === tag) out.push(child);
  }
  return out;
}

/**
 * Recursively searches the ordered tree for the first descendant with
 * tag name `tag` (depth-first, document order). Returns `undefined` when
 * not found. Used to detect skip-with-warning constructs nested anywhere
 * inside a paragraph (e.g., `<m:oMath>` inside `<w:r>` etc.).
 */
export function findOrderedDescendant(parent: unknown, tag: string): unknown {
  for (const child of getOrderedChildren(parent)) {
    if (getTagName(child) === tag) return child;
    const inner = findOrderedDescendant(child, tag);
    if (inner !== undefined) return inner;
  }
  return undefined;
}

/**
 * Recursively collects all descendants with tag name `tag` (depth-first,
 * document order). Used to inspect every `<w:drawing>` in a paragraph to
 * decide between inline-image vs shape skip.
 */
export function findAllDescendants(parent: unknown, tag: string): unknown[] {
  const out: unknown[] = [];
  for (const child of getOrderedChildren(parent)) {
    if (getTagName(child) === tag) out.push(child);
    out.push(...findAllDescendants(child, tag));
  }
  return out;
}
