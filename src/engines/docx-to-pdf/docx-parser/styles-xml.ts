/**
 * Parses `word/styles.xml`.
 *
 * Output: `Map<string, Style>` keyed by `styleId`. Each entry tracks the
 * style's run-level and paragraph-level property defaults, plus the parent
 * (`basedOn`) when present. The `<w:docDefaults>` block is synthesized into
 * a special entry under `DEFAULT_STYLE_KEY` so consumers can fold defaults
 * into runs/paragraphs that have no explicit style.
 *
 * **basedOn inheritance is resolved at consumer-call time**, not at parse
 * time. Storing the chain (rather than walking it eagerly) keeps the parser
 * a single forward pass and lets the consumer avoid re-resolution when the
 * same style is referenced repeatedly. The exported `resolveStyle` helper
 * walks the chain with a visited-set cycle guard.
 *
 * Schema sketch:
 *
 * ```xml
 * <w:styles xmlns:w="...">
 *   <w:docDefaults>
 *     <w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
 *     <w:pPrDefault><w:pPr><w:jc w:val="left"/></w:pPr></w:pPrDefault>
 *   </w:docDefaults>
 *   <w:style w:type="paragraph" w:styleId="Heading1">
 *     <w:name w:val="heading 1"/>
 *     <w:basedOn w:val="Normal"/>
 *     <w:rPr><w:b/><w:sz w:val="32"/></w:rPr>
 *     <w:pPr><w:jc w:val="left"/></w:pPr>
 *   </w:style>
 *   …
 * </w:styles>
 * ```
 */

import type { Style, StyleParagraphProps, StyleRunProps } from "./types";
import { DEFAULT_STYLE_KEY } from "./types";
import { createXmlParser, getAttr, getPath, isWellFormedXml, toArray } from "./xml";

export type ParseStylesResult = {
  value: Map<string, Style>;
  warnings: string[];
};

/* ------------------------------------------------------------------ */
/*   <w:rPr> / <w:pPr> extractors                                     */
/* ------------------------------------------------------------------ */

/**
 * OOXML "boolean" elements like `<w:b/>` are also written as `<w:b w:val="0"/>`
 * (off) or `<w:b w:val="1"/>` (on, equivalent to no attribute). This helper
 * normalizes the three forms.
 */
function readBoolElement(parent: unknown, tag: string): boolean | undefined {
  const node = getPath(parent, [tag]);
  if (node === undefined) return undefined;
  // Element present without value attribute → true.
  const val = getAttr(node, "w:val");
  if (val === undefined) return true;
  // OOXML accepts 1/true/on as truthy and 0/false/off as falsy.
  const lc = val.toLowerCase();
  if (lc === "0" || lc === "false" || lc === "off") return false;
  return true;
}

function readFontFamily(rPr: unknown): string | undefined {
  // <w:rFonts w:ascii="Calibri" w:cs="..." w:hAnsi="..." .../>
  // Prefer ascii, fall back to hAnsi, then cs.
  const rFonts = getPath(rPr, ["w:rFonts"]);
  if (rFonts === undefined) return undefined;
  return (
    getAttr(rFonts, "w:ascii") ?? getAttr(rFonts, "w:hAnsi") ?? getAttr(rFonts, "w:cs") ?? undefined
  );
}

function readFontSizePt(rPr: unknown): number | undefined {
  // <w:sz w:val="24"/> = 24 half-points = 12 pt.
  const raw = getAttr(getPath(rPr, ["w:sz"]), "w:val");
  if (raw === undefined) return undefined;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n / 2;
}

function readColorHex(rPr: unknown): string | undefined {
  // <w:color w:val="FF0000"/> or w:val="auto".
  const raw = getAttr(getPath(rPr, ["w:color"]), "w:val");
  if (raw === undefined) return undefined;
  if (raw.toLowerCase() === "auto") return undefined;
  // Match a 6-digit hex; other shapes are treated as missing.
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return undefined;
  return raw.toUpperCase();
}

function extractRunProps(rPr: unknown): StyleRunProps {
  if (rPr === undefined) return {};
  const bold = readBoolElement(rPr, "w:b");
  const italic = readBoolElement(rPr, "w:i");
  const underline = getPath(rPr, ["w:u"]) !== undefined ? true : undefined;
  const strike = readBoolElement(rPr, "w:strike");
  const fontFamily = readFontFamily(rPr);
  const fontSizePt = readFontSizePt(rPr);
  const colorHex = readColorHex(rPr);

  return {
    ...(bold !== undefined ? { bold } : {}),
    ...(italic !== undefined ? { italic } : {}),
    ...(underline !== undefined ? { underline } : {}),
    ...(strike !== undefined ? { strike } : {}),
    ...(fontFamily !== undefined ? { fontFamily } : {}),
    ...(fontSizePt !== undefined ? { fontSizePt } : {}),
    ...(colorHex !== undefined ? { colorHex } : {}),
  };
}

function readAlignment(pPr: unknown): StyleParagraphProps["alignment"] {
  // <w:jc w:val="center"/>. OOXML also has "both" / "distribute" / "start" / "end";
  // we normalize: "both" / "distribute" → "justify"; "start" → "left"; "end" → "right".
  const raw = getAttr(getPath(pPr, ["w:jc"]), "w:val");
  if (raw === undefined) return undefined;
  switch (raw) {
    case "left":
    case "start":
      return "left";
    case "center":
      return "center";
    case "right":
    case "end":
      return "right";
    case "both":
    case "distribute":
    case "justify":
      return "justify";
    default:
      return undefined;
  }
}

function extractParagraphProps(pPr: unknown): StyleParagraphProps {
  if (pPr === undefined) return {};
  const alignment = readAlignment(pPr);
  return {
    ...(alignment !== undefined ? { alignment } : {}),
  };
}

/* ------------------------------------------------------------------ */
/*   Style type normalizer                                            */
/* ------------------------------------------------------------------ */

function normalizeStyleType(raw: string | undefined): Style["type"] {
  switch (raw) {
    case "paragraph":
    case "character":
    case "table":
    case "numbering":
      return raw;
    default:
      // Unknown / missing → default to "paragraph". OOXML guarantees the
      // attribute is present in well-formed docs; fall back conservatively
      // rather than throwing.
      return "paragraph";
  }
}

/* ------------------------------------------------------------------ */
/*   Public parser                                                    */
/* ------------------------------------------------------------------ */

export function parseStylesXml(xml: string): ParseStylesResult {
  const warnings: string[] = [];
  const empty = new Map<string, Style>();

  if (!isWellFormedXml(xml)) {
    warnings.push("styles: malformed XML, returning empty map");
    return { value: empty, warnings };
  }

  let json: unknown;
  try {
    json = createXmlParser().parse(xml);
  } catch {
    warnings.push("styles: parser threw, returning empty map");
    return { value: empty, warnings };
  }

  const root = getPath(json, ["w:styles"]);
  if (root === undefined) {
    warnings.push("styles: missing <w:styles> root, returning empty map");
    return { value: empty, warnings };
  }

  const out = new Map<string, Style>();

  // ---- <w:docDefaults> → DEFAULT_STYLE_KEY entry -----------------------
  const docDefaults = getPath(root, ["w:docDefaults"]);
  if (docDefaults !== undefined) {
    const defaultRPr = getPath(docDefaults, ["w:rPrDefault", "w:rPr"]);
    const defaultPPr = getPath(docDefaults, ["w:pPrDefault", "w:pPr"]);
    out.set(DEFAULT_STYLE_KEY, {
      styleId: DEFAULT_STYLE_KEY,
      type: "paragraph",
      runProps: extractRunProps(defaultRPr),
      paragraphProps: extractParagraphProps(defaultPPr),
    });
  }

  // ---- <w:style> entries ----------------------------------------------
  const styleEntries = toArray(getPath(root, ["w:style"]) as unknown);
  for (const entry of styleEntries) {
    const styleId = getAttr(entry, "w:styleId");
    if (styleId === undefined || styleId.length === 0) continue;
    if (styleId === DEFAULT_STYLE_KEY) {
      // Defensive: don't let a real style clobber our synthesized default key.
      continue;
    }

    const type = normalizeStyleType(getAttr(entry, "w:type"));
    const name = getAttr(getPath(entry, ["w:name"]), "w:val");
    const basedOn = getAttr(getPath(entry, ["w:basedOn"]), "w:val");
    const runProps = extractRunProps(getPath(entry, ["w:rPr"]));
    const paragraphProps = extractParagraphProps(getPath(entry, ["w:pPr"]));

    out.set(styleId, {
      styleId,
      type,
      ...(name !== undefined ? { name } : {}),
      ...(basedOn !== undefined ? { basedOn } : {}),
      runProps,
      paragraphProps,
    });
  }

  return { value: out, warnings };
}

/* ------------------------------------------------------------------ */
/*   basedOn resolution helper                                        */
/* ------------------------------------------------------------------ */

/**
 * Resolves a style's effective run + paragraph properties by walking the
 * `basedOn` chain root-down and merging children over parents (later wins).
 *
 * The `__default` entry from `<w:docDefaults>` is folded in first when
 * present, giving the conventional precedence:
 *   docDefaults → root ancestor → ... → direct parent → the style itself.
 *
 * Cycle guard: if `A → B → A` is observed (malformed DOCX), traversal halts
 * at the second visit, the partial chain is returned, and the cycle is
 * reported via the returned `warnings` array (callers concat into the doc-
 * level warnings list).
 */
export function resolveStyle(
  styles: ReadonlyMap<string, Style>,
  styleId: string,
): {
  runProps: StyleRunProps;
  paragraphProps: StyleParagraphProps;
  warnings: string[];
} {
  const warnings: string[] = [];
  const start = styles.get(styleId);
  if (start === undefined) {
    return { runProps: {}, paragraphProps: {}, warnings };
  }

  // Walk basedOn chain forward from `styleId` collecting ancestors.
  const chain: Style[] = [];
  const visited = new Set<string>();
  let cur: Style | undefined = start;
  while (cur !== undefined) {
    if (visited.has(cur.styleId)) {
      warnings.push(`styles: basedOn cycle detected at "${cur.styleId}"`);
      break;
    }
    visited.add(cur.styleId);
    chain.push(cur);
    if (cur.basedOn === undefined) break;
    cur = styles.get(cur.basedOn);
  }

  // Merge order: docDefaults → ancestors (root first) → leaf.
  // chain is leaf-to-root, so iterate reversed.
  const docDefaults = styles.get(DEFAULT_STYLE_KEY);
  const merged: { runProps: StyleRunProps; paragraphProps: StyleParagraphProps } = {
    runProps: {},
    paragraphProps: {},
  };
  if (docDefaults !== undefined) {
    Object.assign(merged.runProps, docDefaults.runProps);
    Object.assign(merged.paragraphProps, docDefaults.paragraphProps);
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    const s = chain[i];
    if (s === undefined) continue;
    Object.assign(merged.runProps, s.runProps);
    Object.assign(merged.paragraphProps, s.paragraphProps);
  }

  return { ...merged, warnings };
}
