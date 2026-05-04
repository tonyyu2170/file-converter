/**
 * Extracts `SectionProperties` from a single `<w:sectPr>` element.
 *
 * Section properties live in `word/document.xml` in two places:
 *
 * 1. At the end of `<w:body>` — the final section.
 * 2. Inside `<w:p><w:pPr><w:sectPr>` — section break terminators.
 *
 * Because the body parser (Task 5) is the one that knows where each `sectPr`
 * is encountered, this leaf parser takes a *single* parsed `sectPr` node
 * (what fast-xml-parser produces) and returns its `SectionProperties`.
 * Task 5 walks the document, calls `parseSectionProperties` per `sectPr`,
 * and combines properties + body blocks into full `Section[]` entries.
 *
 * For unit tests we still want to drive the parser from XML; the helper
 * `parseSectionPropertiesFromXml(xml)` accepts a small XML fragment of the
 * form `<w:sectPr ...>...</w:sectPr>` (or any wrapping element containing a
 * single `w:sectPr` child) and re-uses the same extractor.
 *
 * Default: spec §9 — Letter portrait, 1-inch margins, 1 column, no header/footer
 * references. Returned by `defaultSectionProperties()`.
 */

import type { SectionProperties, SectionRefs } from "./types";
import { createXmlParser, getAttr, getPath, isWellFormedXml, toArray, twipsToPt } from "./xml";

export type ParseSectionPropertiesResult = {
  value: SectionProperties;
  warnings: string[];
};

/* ------------------------------------------------------------------ */
/*   Defaults                                                         */
/* ------------------------------------------------------------------ */

/** Letter (8.5×11 in × 72 pt/in) = 612 × 792 pt. */
const DEFAULT_PAGE_SIZE = { widthPt: 612, heightPt: 792 } as const;
/** 1 inch = 72 pt all sides. */
const DEFAULT_MARGINS = { top: 72, right: 72, bottom: 72, left: 72 } as const;
/** Single-column, zero gutter. */
const DEFAULT_COLUMNS = { count: 1, spaceBetween: 0 } as const;

export function defaultSectionProperties(): SectionProperties {
  return {
    pageSize: { ...DEFAULT_PAGE_SIZE },
    pageMargins: { ...DEFAULT_MARGINS },
    columns: { ...DEFAULT_COLUMNS },
    headerRefs: {},
    footerRefs: {},
  };
}

/* ------------------------------------------------------------------ */
/*   Per-element extractors                                           */
/* ------------------------------------------------------------------ */

function extractPageSize(sectPr: unknown): SectionProperties["pageSize"] {
  const pgSz = getPath(sectPr, ["w:pgSz"]);
  if (pgSz === undefined) return { ...DEFAULT_PAGE_SIZE };
  const wRaw = getAttr(pgSz, "w:w");
  const hRaw = getAttr(pgSz, "w:h");
  const w = wRaw !== undefined ? Number.parseFloat(wRaw) : Number.NaN;
  const h = hRaw !== undefined ? Number.parseFloat(hRaw) : Number.NaN;
  return {
    widthPt: Number.isFinite(w) && w > 0 ? twipsToPt(w) : DEFAULT_PAGE_SIZE.widthPt,
    heightPt: Number.isFinite(h) && h > 0 ? twipsToPt(h) : DEFAULT_PAGE_SIZE.heightPt,
  };
}

function extractMargins(sectPr: unknown): SectionProperties["pageMargins"] {
  const pgMar = getPath(sectPr, ["w:pgMar"]);
  if (pgMar === undefined) return { ...DEFAULT_MARGINS };

  function readMargin(attr: string, fallback: number): number {
    const raw = getAttr(pgMar, attr);
    if (raw === undefined) return fallback;
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return fallback;
    // Margins can be negative in OOXML (rare); we clamp at 0 for layout sanity.
    return Math.max(0, twipsToPt(n));
  }

  return {
    top: readMargin("w:top", DEFAULT_MARGINS.top),
    right: readMargin("w:right", DEFAULT_MARGINS.right),
    bottom: readMargin("w:bottom", DEFAULT_MARGINS.bottom),
    left: readMargin("w:left", DEFAULT_MARGINS.left),
  };
}

function extractColumns(sectPr: unknown): SectionProperties["columns"] {
  const cols = getPath(sectPr, ["w:cols"]);
  if (cols === undefined) return { ...DEFAULT_COLUMNS };

  // <w:cols w:num="2" w:space="720"/>. Default to 1 if num is missing/invalid.
  const numRaw = getAttr(cols, "w:num");
  const spaceRaw = getAttr(cols, "w:space");
  let count = numRaw !== undefined ? Number.parseInt(numRaw, 10) : 1;
  if (!Number.isFinite(count) || count < 1) count = 1;
  // Cap at a sane upper bound (Word allows up to 45 in theory; layout caps at
  // 4 per spec §1.3 but we keep parsing honest and let layout do the clamp).
  if (count > 45) count = 45;

  let spaceBetween = spaceRaw !== undefined ? Number.parseFloat(spaceRaw) : 0;
  if (!Number.isFinite(spaceBetween) || spaceBetween < 0) spaceBetween = 0;
  return { count, spaceBetween: twipsToPt(spaceBetween) };
}

function extractRefs(
  sectPr: unknown,
  tagName: "w:headerReference" | "w:footerReference",
): SectionRefs {
  const entries = toArray(getPath(sectPr, [tagName]) as unknown);
  const refs: SectionRefs = {};
  for (const entry of entries) {
    // r:id (relationship-namespace qualified) — fast-xml-parser preserves
    // the namespace prefix in the attribute name.
    const rid = getAttr(entry, "r:id");
    if (rid === undefined) continue;
    const type = getAttr(entry, "w:type") ?? "default";
    if (type === "first") refs.first = rid;
    else if (type === "even") refs.even = rid;
    else refs.default = rid;
  }
  return refs;
}

/* ------------------------------------------------------------------ */
/*   Public extractors                                                */
/* ------------------------------------------------------------------ */

/**
 * Extracts `SectionProperties` from a single parsed `<w:sectPr>` JSON node
 * (what fast-xml-parser emits). Pass `undefined` to get the default
 * properties (the typical "no sectPr present" case).
 */
export function parseSectionProperties(sectPrNode: unknown): ParseSectionPropertiesResult {
  if (sectPrNode === undefined || sectPrNode === null) {
    return { value: defaultSectionProperties(), warnings: [] };
  }

  // Fast-xml-parser may emit a string for an empty self-closing element; in
  // that case there are no children to extract and we fall back to defaults.
  if (typeof sectPrNode !== "object") {
    return { value: defaultSectionProperties(), warnings: [] };
  }

  const value: SectionProperties = {
    pageSize: extractPageSize(sectPrNode),
    pageMargins: extractMargins(sectPrNode),
    columns: extractColumns(sectPrNode),
    headerRefs: extractRefs(sectPrNode, "w:headerReference"),
    footerRefs: extractRefs(sectPrNode, "w:footerReference"),
  };
  return { value, warnings: [] };
}

/**
 * Convenience: parses an XML fragment and pulls out the first `<w:sectPr>`
 * it finds. Used by tests; Task 5 will call `parseSectionProperties` directly
 * with the JSON nodes it walks.
 */
export function parseSectionPropertiesFromXml(xml: string): ParseSectionPropertiesResult {
  const warnings: string[] = [];
  if (!isWellFormedXml(xml)) {
    warnings.push("sections: malformed XML, returning default section properties");
    return { value: defaultSectionProperties(), warnings };
  }

  let json: unknown;
  try {
    json = createXmlParser().parse(xml);
  } catch {
    warnings.push("sections: parser threw, returning default section properties");
    return { value: defaultSectionProperties(), warnings };
  }

  const sectPrNode = findFirstSectPr(json);
  if (sectPrNode === undefined) {
    warnings.push("sections: no <w:sectPr> element found, returning default section properties");
    return { value: defaultSectionProperties(), warnings };
  }
  const result = parseSectionProperties(sectPrNode);
  return { value: result.value, warnings: [...warnings, ...result.warnings] };
}

/** Recursively searches for the first `w:sectPr` key in the parsed JSON. */
function findFirstSectPr(node: unknown): unknown {
  if (node === null || node === undefined || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findFirstSectPr(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const obj = node as Record<string, unknown>;
  if ("w:sectPr" in obj) return obj["w:sectPr"];
  for (const key of Object.keys(obj)) {
    if (key.startsWith("@_")) continue;
    const found = findFirstSectPr(obj[key]);
    if (found !== undefined) return found;
  }
  return undefined;
}
