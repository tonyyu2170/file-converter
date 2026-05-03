/**
 * Body-content parser for `word/document.xml` and the body-style content of
 * footnotes / endnotes / headers / footers.
 *
 * The body XML mixes `<w:p>` (paragraph) and `<w:tbl>` (table) children of
 * `<w:body>` in document order. Within a paragraph, runs (`<w:r>`) and
 * hyperlinks (`<w:hyperlink>`) are interleaved; within a run, text nodes,
 * tabs, line breaks, drawings, and footnote/endnote references all appear in
 * document order. fast-xml-parser's default mode loses inter-tag ordering, so
 * this walker uses the `preserveOrder` parser variant exposed from `xml.ts`.
 *
 * Public surface:
 * - `parseBodyXml(xml, ctx)` — top-level entry; walks `<w:document><w:body>`
 *   and returns `Section[]` (multi-section docs split at each in-body
 *   `<w:p><w:pPr><w:sectPr/></w:pPr></w:p>` terminator) plus accumulated
 *   `warnings`.
 * - `parseBlocks(orderedChildren, ctx)` — body-block walker. Reused by
 *   footnotes / headers / footers parsers, which feed it the children of a
 *   `<w:footnote>` / `<w:hdr>` / `<w:ftr>` element directly. Returns the
 *   parsed `ParsedBlock[]`; the caller is responsible for accumulating
 *   warnings into its own list.
 *
 * Skip-with-warning detection (per spec §1.4):
 * - `<m:oMath>` / `<m:oMathPara>` (Word equations / OMML) → "equation skipped".
 * - Paragraph `<w:bidi/>` or any run with `<w:rtl/>` → "RTL paragraph skipped".
 * - `<w:drawing>` whose graphic content is *not* an inline image (no
 *   `<a:blip>` under `<wp:inline>`) → silently dropped from the run flow,
 *   with a single "drawing skipped" warning per paragraph. Paragraphs
 *   that consist entirely of such shapes (no text runs survive) become
 *   a "drawing" skip-with-warning block.
 * - `<w:object>` (OLE) and `<w:fldChar>` (complex field codes) → silently
 *   dropped (visible text from preceding/following runs is preserved).
 * - `<w:ins>` content kept; `<w:del>` content dropped (track changes).
 * - Comments (`<w:commentReference>`, `<w:commentRangeStart>` / End`) dropped.
 *
 * Inline images: `<w:drawing>` containing `<wp:inline>` containing
 * `<a:blip r:embed="rId..">` is parsed into `Run.inlineImage` with extents
 * converted EMU → pt (914400 EMU = 1 in = 72 pt).
 */

import { defaultSectionProperties, parseSectionProperties } from "./sections";
import { resolveStyle } from "./styles-xml";
import type {
  Paragraph,
  ParsedBlock,
  Run,
  Section,
  Style,
  StyleRunProps,
  Table,
  TableCell,
  TableRow,
} from "./types";
import {
  createOrderedXmlParser,
  findAllDescendants,
  findOrderedChild,
  findOrderedChildren,
  findOrderedDescendant,
  getOrderedAttr,
  getOrderedChildren,
  getTagName,
  isWellFormedXml,
} from "./xml";

/**
 * Walker context. The body parser threads warnings through via mutation so
 * deep call sites can record skip notices without needing to plumb a return
 * channel through every helper.
 *
 * `styles` carries the parsed `word/styles.xml` map so paragraph walks can
 * resolve a paragraph's `pStyle` chain via `resolveStyle` and merge the
 * resulting `runProps` underneath each run's explicit rPr values. Callers
 * (footnotes, headers/footers) that don't have access to the styles map
 * pass an empty map, which `resolveStyle` handles cleanly (returns empty
 * props for any styleId).
 */
export type BlockWalkContext = {
  warnings: string[];
  styles: Map<string, Style>;
};

export type ParseBodyResult = {
  sections: Section[];
  warnings: string[];
};

/* ------------------------------------------------------------------ */
/*   Public entry — parseBodyXml                                      */
/* ------------------------------------------------------------------ */

export function parseBodyXml(xml: string, styles: Map<string, Style> = new Map()): ParseBodyResult {
  const warnings: string[] = [];

  if (!isWellFormedXml(xml)) {
    warnings.push("document: malformed XML, returning single empty section");
    return {
      sections: [{ ...defaultSectionProperties(), blocks: [] }],
      warnings,
    };
  }

  let json: unknown;
  try {
    json = createOrderedXmlParser().parse(xml);
  } catch {
    warnings.push("document: parser threw, returning single empty section");
    return {
      sections: [{ ...defaultSectionProperties(), blocks: [] }],
      warnings,
    };
  }

  // preserveOrder root is an array of top-level entries (xml decl + root elt).
  // Locate <w:document> → <w:body>.
  const documentEntry = findEntry(json, "w:document");
  if (documentEntry === undefined) {
    warnings.push("document: missing <w:document> root, returning single empty section");
    return {
      sections: [{ ...defaultSectionProperties(), blocks: [] }],
      warnings,
    };
  }
  const bodyEntry = findOrderedChild(documentEntry, "w:body");
  if (bodyEntry === undefined) {
    warnings.push("document: missing <w:body>, returning single empty section");
    return {
      sections: [{ ...defaultSectionProperties(), blocks: [] }],
      warnings,
    };
  }

  const ctx: BlockWalkContext = { warnings, styles };
  const sections = walkBodySections(getOrderedChildren(bodyEntry), ctx);
  return { sections, warnings };
}

/**
 * Top-level entries are wrapped in an array (preserveOrder mode). Find the
 * first one whose tag matches `name`.
 */
function findEntry(parsed: unknown, name: string): unknown {
  if (!Array.isArray(parsed)) return undefined;
  for (const entry of parsed) {
    if (getTagName(entry) === name) return entry;
  }
  return undefined;
}

/**
 * Walks `<w:body>` children, partitioning into sections. Each `<w:p>` is
 * inspected for an in-pPr `<w:sectPr>` that terminates the current section.
 * The trailing `<w:sectPr>` (direct child of `<w:body>`) is the final
 * section's properties.
 */
function walkBodySections(bodyChildren: unknown[], ctx: BlockWalkContext): Section[] {
  const sections: Section[] = [];
  let pendingBlocks: ParsedBlock[] = [];

  for (const child of bodyChildren) {
    const tag = getTagName(child);

    if (tag === "w:p") {
      // Detect a section-break terminator: <w:p><w:pPr><w:sectPr>.
      const pPr = findOrderedChild(child, "w:pPr");
      const sectPrInPPr = pPr !== undefined ? findOrderedChild(pPr, "w:sectPr") : undefined;

      const block = parseParagraph(child, ctx);
      if (block !== undefined) pendingBlocks.push(block);

      if (sectPrInPPr !== undefined) {
        const sectPrJson = orderedToJson(sectPrInPPr);
        const { value: props, warnings: w } = parseSectionProperties(sectPrJson);
        ctx.warnings.push(...w);
        sections.push({ ...props, blocks: pendingBlocks });
        pendingBlocks = [];
      }
      continue;
    }

    if (tag === "w:tbl") {
      const table = parseTable(child, ctx);
      pendingBlocks.push(table);
      continue;
    }

    if (tag === "w:sectPr") {
      const sectPrJson = orderedToJson(child);
      const { value: props, warnings: w } = parseSectionProperties(sectPrJson);
      ctx.warnings.push(...w);
      sections.push({ ...props, blocks: pendingBlocks });
      pendingBlocks = [];
      continue;
    }

    // <w:sdt> (structured document tag) and other top-level wrappers can
    // appear; for v1 we walk into them and treat their immediate paragraph/
    // table children at the same level. <w:sectPrChange>, <w:bookmarkStart>,
    // <w:bookmarkEnd> etc. are silently ignored.
    if (tag === "w:sdt") {
      const sdtContent = findOrderedDescendant(child, "w:sdtContent");
      if (sdtContent !== undefined) {
        // Recursively re-walk the sdtContent children using the same routine.
        const innerSections = walkBodySections(getOrderedChildren(sdtContent), ctx);
        // Inner sections normally don't appear inside sdt; flatten their
        // blocks into our pendingBlocks. If they did declare sections,
        // accept them.
        for (const inner of innerSections) {
          if (inner.blocks.length > 0) pendingBlocks.push(...inner.blocks);
        }
      }
    }
  }

  // If no <w:sectPr> terminator was seen, synthesize one final default
  // section so the document always has at least one section.
  if (sections.length === 0 || pendingBlocks.length > 0) {
    sections.push({ ...defaultSectionProperties(), blocks: pendingBlocks });
  }

  return sections;
}

/**
 * Block-level walker exposed for footnotes / headers / footers (which all
 * have `<w:p>` / `<w:tbl>` body content but no body-level `<w:sectPr>` /
 * section-break semantics). Returns the parsed blocks; the caller threads
 * the context (warnings).
 */
export function parseBlocks(children: unknown[], ctx: BlockWalkContext): ParsedBlock[] {
  const out: ParsedBlock[] = [];
  for (const child of children) {
    const tag = getTagName(child);
    if (tag === "w:p") {
      const block = parseParagraph(child, ctx);
      if (block !== undefined) out.push(block);
    } else if (tag === "w:tbl") {
      out.push(parseTable(child, ctx));
    } else if (tag === "w:sdt") {
      const sdtContent = findOrderedDescendant(child, "w:sdtContent");
      if (sdtContent !== undefined) {
        out.push(...parseBlocks(getOrderedChildren(sdtContent), ctx));
      }
    }
    // Other tags (bookmarks, sectPr inside footnote bodies etc.) ignored.
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*   Paragraph                                                        */
/* ------------------------------------------------------------------ */

/**
 * Parses a `<w:p>` into a `Paragraph` block, or a skip-with-warning when the
 * paragraph contains only unsupported content (RTL, equations, etc.). The
 * skip-with-warning placeholder lets the layout engine reserve space without
 * crashing on missing content.
 */
function parseParagraph(pNode: unknown, ctx: BlockWalkContext): ParsedBlock | undefined {
  const pPr = findOrderedChild(pNode, "w:pPr");

  // RTL detection: <w:bidi/> on the paragraph.
  if (pPr !== undefined && findOrderedChild(pPr, "w:bidi") !== undefined) {
    ctx.warnings.push("RTL paragraph skipped");
    return { kind: "skip-with-warning", reason: "RTL paragraph" };
  }

  // OMML equation detection: <m:oMath> or <m:oMathPara> anywhere inside the paragraph.
  if (
    findOrderedDescendant(pNode, "m:oMath") !== undefined ||
    findOrderedDescendant(pNode, "m:oMathPara") !== undefined
  ) {
    ctx.warnings.push("equation skipped");
    return { kind: "skip-with-warning", reason: "equation" };
  }

  // Non-image drawing detection: <w:drawing> whose graphic content has no
  // <a:blip>. Distinguishes inline images (kept) from DrawingML shapes /
  // SmartArt (skipped). When a paragraph mixes a shape with text runs, the
  // shape is dropped silently from the run flow (see `parseRun`) and we
  // emit a single paragraph-level warning here so layout can surface it.
  // A paragraph that contains *only* shapes (no text runs survive the walk
  // below) still collapses to a skip-with-warning block — there is nothing
  // to preserve.
  const drawings = findAllDescendants(pNode, "w:drawing");
  const hasShape = drawings.length > 0 && drawings.some((d) => extractInlineImage(d) === undefined);
  if (hasShape) {
    ctx.warnings.push("drawing skipped");
  }

  // Paragraph properties.
  const styleId =
    pPr !== undefined ? getOrderedAttr(findOrderedChild(pPr, "w:pStyle"), "w:val") : undefined;
  const alignment = readAlignment(pPr);
  const numPr = readNumPr(pPr);

  // Resolve the paragraph's style chain (pStyle → basedOn → ... → docDefaults)
  // ONCE per paragraph; the resulting `runProps` are merged underneath each
  // run's explicit rPr values inside `buildRun`. `resolveStyle` returns
  // empty props for an unknown styleId or an empty styles map, so the
  // call is safe even when the parent caller didn't supply a styles map.
  // Cycle-detection warnings are surfaced once here, not per-run.
  let styleRunProps: StyleRunProps | undefined;
  if (styleId !== undefined) {
    const resolved = resolveStyle(ctx.styles, styleId);
    ctx.warnings.push(...resolved.warnings);
    styleRunProps = resolved.runProps;
  }

  // Walk run-level children in order.
  const runs: Run[] = [];
  let rtlSeenInRun = false;

  // We walk all children of <w:p> except w:pPr, accepting both <w:r> and
  // <w:hyperlink> wrappers. Track-changes wrappers (<w:ins>, <w:del>) are
  // walked transparently — <w:ins> content is kept, <w:del> is dropped.
  walkParagraphChildren(
    getOrderedChildren(pNode),
    ctx,
    runs,
    undefined,
    undefined,
    false,
    () => {
      rtlSeenInRun = true;
    },
    styleRunProps,
  );

  // If any run flagged RTL, treat the whole paragraph as RTL skip.
  if (rtlSeenInRun) {
    ctx.warnings.push("RTL paragraph skipped");
    return { kind: "skip-with-warning", reason: "RTL paragraph" };
  }

  // Drawing-only paragraph (shape present + no text runs survived) → still
  // a skip block. The warning above is the only one we emit; do not push a
  // second.
  if (hasShape && runs.length === 0) {
    return { kind: "skip-with-warning", reason: "drawing" };
  }

  const paragraph: Paragraph = {
    kind: "paragraph",
    alignment,
    runs,
    ...(styleId !== undefined ? { styleId } : {}),
    ...(numPr !== undefined ? { numPr } : {}),
  };
  return paragraph;
}

/**
 * Walks the children of a `<w:p>` (or the children of a track-changes /
 * hyperlink wrapper inside one), pushing extracted runs into `runs`.
 *
 * - `hyperlinkRel` is set when we're recursing inside a `<w:hyperlink r:id>`.
 * - `hyperlinkAnchor` is set when we're recursing inside a
 *   `<w:hyperlink w:anchor>` with no `r:id`. Mutually exclusive with
 *   `hyperlinkRel` — an outer-walker context never carries both.
 * - `inDelete` is true when we're recursing inside a `<w:del>`; runs are
 *   dropped entirely.
 * - `onRtl` is invoked when a run carries `<w:rtl/>` — caller decides whether
 *   to mark the whole paragraph as RTL.
 */
function walkParagraphChildren(
  children: unknown[],
  ctx: BlockWalkContext,
  runs: Run[],
  hyperlinkRel: string | undefined,
  hyperlinkAnchor: string | undefined,
  inDelete: boolean,
  onRtl: () => void,
  styleRunProps: StyleRunProps | undefined,
): void {
  for (const child of children) {
    const tag = getTagName(child);
    if (tag === "w:pPr") continue;

    if (tag === "w:r") {
      if (inDelete) continue;
      parseRun(child, hyperlinkRel, hyperlinkAnchor, onRtl, runs, styleRunProps);
      continue;
    }

    if (tag === "w:hyperlink") {
      // Resolve which target this hyperlink propagates. `r:id` (external
      // relationship) wins over `w:anchor` (internal bookmark) when both
      // are present, with a warning. A hyperlink with neither attribute
      // is malformed but seen in practice; we walk through it as plain
      // text and emit one warning. Nested hyperlinks reset the target —
      // we never mix outer and inner hyperlink contexts.
      const rid = getOrderedAttr(child, "r:id");
      const anchor = getOrderedAttr(child, "w:anchor");
      let innerRel: string | undefined;
      let innerAnchor: string | undefined;
      if (rid !== undefined && anchor !== undefined) {
        ctx.warnings.push("hyperlink has both r:id and w:anchor; using r:id");
        innerRel = rid;
      } else if (rid !== undefined) {
        innerRel = rid;
      } else if (anchor !== undefined) {
        innerAnchor = anchor;
      } else {
        ctx.warnings.push("hyperlink missing r:id and w:anchor; treating as plain text");
      }
      walkParagraphChildren(
        getOrderedChildren(child),
        ctx,
        runs,
        innerRel,
        innerAnchor,
        inDelete,
        onRtl,
        styleRunProps,
      );
      continue;
    }

    if (tag === "w:ins") {
      // Track-changes insert — keep content as accepted.
      walkParagraphChildren(
        getOrderedChildren(child),
        ctx,
        runs,
        hyperlinkRel,
        hyperlinkAnchor,
        inDelete,
        onRtl,
        styleRunProps,
      );
      continue;
    }

    if (tag === "w:del") {
      // Track-changes delete — drop content (rendered with rejections applied).
      walkParagraphChildren(
        getOrderedChildren(child),
        ctx,
        runs,
        hyperlinkRel,
        hyperlinkAnchor,
        true,
        onRtl,
        styleRunProps,
      );
      continue;
    }

    if (tag === "w:moveTo") {
      walkParagraphChildren(
        getOrderedChildren(child),
        ctx,
        runs,
        hyperlinkRel,
        hyperlinkAnchor,
        inDelete,
        onRtl,
        styleRunProps,
      );
      continue;
    }
    if (tag === "w:moveFrom") {
      walkParagraphChildren(
        getOrderedChildren(child),
        ctx,
        runs,
        hyperlinkRel,
        hyperlinkAnchor,
        true,
        onRtl,
        styleRunProps,
      );
      continue;
    }

    // <w:smartTag>, <w:fldSimple>, <w:bookmarkStart>, etc. — walk into them
    // transparently so their contained <w:r>s still appear.
    if (tag === "w:smartTag" || tag === "w:fldSimple") {
      walkParagraphChildren(
        getOrderedChildren(child),
        ctx,
        runs,
        hyperlinkRel,
        hyperlinkAnchor,
        inDelete,
        onRtl,
        styleRunProps,
      );
    }

    // Everything else (bookmarks, comment refs, proofErr, etc.) is silently
    // ignored at paragraph level.
  }
}

/* ------------------------------------------------------------------ */
/*   Run                                                              */
/* ------------------------------------------------------------------ */

/**
 * In-progress accumulator for a single emitted Run. A `<w:r>` element produces
 * one or more Runs depending on whether it contains forced page/column breaks
 * (`<w:br w:type="page|column"/>`); each break flushes the current chunk and
 * starts a new one carrying `pageBreakBefore` / `columnBreakBefore`. Soft
 * line breaks (`<w:br/>` with no type or `w:type="textWrapping"`) embed
 * `\n` in `text` instead of splitting.
 */
type RunChunk = {
  text: string;
  inlineImage: Run["inlineImage"] | undefined;
  footnoteRef: string | undefined;
  endnoteRef: string | undefined;
  pageBreakBefore: boolean;
  columnBreakBefore: boolean;
};

function emptyChunk(): RunChunk {
  return {
    text: "",
    inlineImage: undefined,
    footnoteRef: undefined,
    endnoteRef: undefined,
    pageBreakBefore: false,
    columnBreakBefore: false,
  };
}

function parseRun(
  rNode: unknown,
  hyperlinkRel: string | undefined,
  hyperlinkAnchor: string | undefined,
  onRtl: () => void,
  runs: Run[],
  styleRunProps: StyleRunProps | undefined,
): void {
  const rPr = findOrderedChild(rNode, "w:rPr");

  // RTL run detection.
  if (rPr !== undefined && findOrderedChild(rPr, "w:rtl") !== undefined) {
    onRtl();
    return;
  }

  const props = extractRunProps(rPr);

  // Iterate run children in document order. We accumulate into `chunk`;
  // forced breaks (`<w:br w:type="page|column"/>`) flush the current chunk
  // as a Run and seed a fresh one with the corresponding break flag.
  let chunk = emptyChunk();
  const flush = (): void => {
    const built = buildRun(chunk, props, hyperlinkRel, hyperlinkAnchor, styleRunProps);
    if (built !== undefined) runs.push(built);
  };

  for (const child of getOrderedChildren(rNode)) {
    const tag = getTagName(child);
    if (tag === "w:rPr") continue;

    if (tag === "w:t") {
      chunk.text += extractTextNode(child);
      continue;
    }
    if (tag === "w:tab") {
      chunk.text += "\t";
      continue;
    }
    if (tag === "w:br") {
      // Discriminate by `w:type`:
      //   "page"          → forced page break; flush + start new chunk
      //                     with pageBreakBefore.
      //   "column"        → forced column break; flush + start new chunk
      //                     with columnBreakBefore.
      //   absent / "textWrapping" → soft line break, embed "\n" in text.
      const breakType = getOrderedAttr(child, "w:type");
      if (breakType === "page" || breakType === "column") {
        flush();
        chunk = emptyChunk();
        if (breakType === "page") chunk.pageBreakBefore = true;
        else chunk.columnBreakBefore = true;
      } else {
        chunk.text += "\n";
      }
      continue;
    }
    if (tag === "w:noBreakHyphen") {
      chunk.text += "‑"; // non-breaking hyphen
      continue;
    }
    if (tag === "w:softHyphen") {
      chunk.text += "­"; // soft hyphen
      continue;
    }
    if (tag === "w:sym") {
      // <w:sym w:font="..." w:char="HEX"/> — special character; convert hex
      // → glyph if possible. Defaults to silently dropped when unparseable.
      const charHex = getOrderedAttr(child, "w:char");
      if (charHex !== undefined) {
        const cp = Number.parseInt(charHex, 16);
        if (Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff) {
          chunk.text += String.fromCodePoint(cp);
        }
      }
      continue;
    }

    if (tag === "w:drawing") {
      // Non-image drawings (DrawingML shapes / SmartArt) are silently
      // dropped here; the paragraph-level pre-scan in `parseParagraph`
      // emits a single warning per paragraph and decides whether the
      // paragraph survives or collapses to a skip block.
      const img = extractInlineImage(child);
      if (img !== undefined) chunk.inlineImage = img;
      continue;
    }

    if (tag === "w:footnoteReference") {
      const id = getOrderedAttr(child, "w:id");
      if (id !== undefined) chunk.footnoteRef = id;
      continue;
    }
    if (tag === "w:endnoteReference") {
      const id = getOrderedAttr(child, "w:id");
      if (id !== undefined) chunk.endnoteRef = id;
    }

    // <w:object> (OLE), <w:fldChar> (complex fields), <w:pict> (legacy VML
    // drawing), <w:ruby>, etc. — silently dropped per spec §1.4.
  }

  flush();
}

/**
 * Materializes a `RunChunk` as a `Run` if it carries any content (text,
 * inline image, footnote/endnote ref) OR a forced-break flag. Returns
 * `undefined` for a wholly empty chunk so trailing nothing-after-flush
 * iterations don't push junk runs.
 *
 * A run carrying ONLY a `pageBreakBefore` / `columnBreakBefore` flag (no
 * text, no image, no ref) is preserved on purpose — layout consumes it
 * as a pure break trigger without drawing anything.
 */
function buildRun(
  chunk: RunChunk,
  props: ExtractedRunProps,
  hyperlinkRel: string | undefined,
  hyperlinkAnchor: string | undefined,
  styleRunProps: StyleRunProps | undefined,
): Run | undefined {
  if (
    chunk.text === "" &&
    chunk.inlineImage === undefined &&
    chunk.footnoteRef === undefined &&
    chunk.endnoteRef === undefined &&
    !chunk.pageBreakBefore &&
    !chunk.columnBreakBefore
  ) {
    return undefined;
  }

  // Merge style-resolved runProps UNDERNEATH the run's explicit rPr values.
  // Run-level explicit values win; absence inherits from the resolved style
  // chain (which already includes basedOn ancestors and docDefaults). This
  // is what makes `<w:p w:pStyle="Heading1">` with no `<w:b/>` on its run
  // come out bold via the Heading1 style's runProps.bold = true, while a
  // run carrying explicit `<w:b w:val="0"/>` stays non-bold.
  const fontFamily = props.fontFamily ?? styleRunProps?.fontFamily;
  const fontSizePt = props.fontSizePt ?? styleRunProps?.fontSizePt;
  const colorHex = props.colorHex ?? styleRunProps?.colorHex;

  return {
    kind: "run",
    text: chunk.text,
    bold: props.bold ?? styleRunProps?.bold ?? false,
    italic: props.italic ?? styleRunProps?.italic ?? false,
    underline: props.underline ?? styleRunProps?.underline ?? false,
    strike: props.strike ?? styleRunProps?.strike ?? false,
    ...(fontFamily !== undefined ? { fontFamily } : {}),
    ...(fontSizePt !== undefined ? { fontSizePt } : {}),
    ...(colorHex !== undefined ? { colorHex } : {}),
    ...(hyperlinkRel !== undefined ? { hyperlinkRel } : {}),
    ...(hyperlinkAnchor !== undefined ? { hyperlinkAnchor } : {}),
    ...(chunk.inlineImage !== undefined ? { inlineImage: chunk.inlineImage } : {}),
    ...(chunk.footnoteRef !== undefined ? { footnoteRef: chunk.footnoteRef } : {}),
    ...(chunk.endnoteRef !== undefined ? { endnoteRef: chunk.endnoteRef } : {}),
    ...(chunk.pageBreakBefore ? { pageBreakBefore: true } : {}),
    ...(chunk.columnBreakBefore ? { columnBreakBefore: true } : {}),
  };
}

/* ------------------------------------------------------------------ */
/*   Run properties                                                   */
/* ------------------------------------------------------------------ */

type ExtractedRunProps = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  fontFamily?: string;
  fontSizePt?: number;
  colorHex?: string;
};

function readBoolElement(rPr: unknown, tag: string): boolean | undefined {
  const node = findOrderedChild(rPr, tag);
  if (node === undefined) return undefined;
  const val = getOrderedAttr(node, "w:val");
  if (val === undefined) return true;
  const lc = val.toLowerCase();
  if (lc === "0" || lc === "false" || lc === "off") return false;
  return true;
}

function readUnderline(rPr: unknown): boolean | undefined {
  const u = findOrderedChild(rPr, "w:u");
  if (u === undefined) return undefined;
  const val = getOrderedAttr(u, "w:val");
  if (val === undefined) return true;
  const lower = val.toLowerCase();
  if (lower === "none" || lower === "0" || lower === "false" || lower === "off") return false;
  return true;
}

function readFontFamilyFromRPr(rPr: unknown): string | undefined {
  const rFonts = findOrderedChild(rPr, "w:rFonts");
  if (rFonts === undefined) return undefined;
  return (
    getOrderedAttr(rFonts, "w:ascii") ??
    getOrderedAttr(rFonts, "w:hAnsi") ??
    getOrderedAttr(rFonts, "w:cs") ??
    undefined
  );
}

function readFontSizePtFromRPr(rPr: unknown): number | undefined {
  const sz = findOrderedChild(rPr, "w:sz");
  const raw = sz !== undefined ? getOrderedAttr(sz, "w:val") : undefined;
  if (raw === undefined) return undefined;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n / 2;
}

function readColorHexFromRPr(rPr: unknown): string | undefined {
  const color = findOrderedChild(rPr, "w:color");
  const raw = color !== undefined ? getOrderedAttr(color, "w:val") : undefined;
  if (raw === undefined) return undefined;
  if (raw.toLowerCase() === "auto") return undefined;
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return undefined;
  return raw.toUpperCase();
}

function extractRunProps(rPr: unknown): ExtractedRunProps {
  if (rPr === undefined) return {};
  const out: ExtractedRunProps = {};
  const bold = readBoolElement(rPr, "w:b");
  const italic = readBoolElement(rPr, "w:i");
  const underline = readUnderline(rPr);
  const strike = readBoolElement(rPr, "w:strike");
  const fontFamily = readFontFamilyFromRPr(rPr);
  const fontSizePt = readFontSizePtFromRPr(rPr);
  const colorHex = readColorHexFromRPr(rPr);

  if (bold !== undefined) out.bold = bold;
  if (italic !== undefined) out.italic = italic;
  if (underline !== undefined) out.underline = underline;
  if (strike !== undefined) out.strike = strike;
  if (fontFamily !== undefined) out.fontFamily = fontFamily;
  if (fontSizePt !== undefined) out.fontSizePt = fontSizePt;
  if (colorHex !== undefined) out.colorHex = colorHex;
  return out;
}

/* ------------------------------------------------------------------ */
/*   Text node extraction                                             */
/* ------------------------------------------------------------------ */

/**
 * Extracts text from a `<w:t>` entry. preserveOrder shape:
 * `{ "w:t": [{ "#text": "Hello" }], ":@": { "@_xml:space": "preserve" } }`.
 * Empty `<w:t/>` shows up as `{ "w:t": [] }`.
 */
function extractTextNode(tNode: unknown): string {
  const children = getOrderedChildren(tNode);
  let s = "";
  for (const child of children) {
    if (typeof child !== "object" || child === null) continue;
    const obj = child as Record<string, unknown>;
    const txt = obj["#text"];
    if (typeof txt === "string") s += txt;
  }
  return s;
}

/* ------------------------------------------------------------------ */
/*   Inline image                                                     */
/* ------------------------------------------------------------------ */

/** EMUs per pt — 914400 EMU/inch ÷ 72 pt/inch = 12700 EMU/pt. */
const EMU_PER_PT = 12700;

/**
 * Extracts an inline image reference from a `<w:drawing>` node. Returns
 * `undefined` for non-image drawings (shapes, SmartArt).
 *
 * Standard inline picture shape:
 * <w:drawing>
 *   <wp:inline>
 *     <wp:extent cx="..." cy="..."/>
 *     <a:graphic>
 *       <a:graphicData uri="...picture">
 *         <pic:pic>...<a:blip r:embed="rId..."/>...</pic:pic>
 *       </a:graphicData>
 *     </a:graphic>
 *   </wp:inline>
 * </w:drawing>
 */
function extractInlineImage(drawingNode: unknown): Run["inlineImage"] | undefined {
  // Look for <wp:inline> or <wp:anchor> (we treat both as inline for v1).
  const inline =
    findOrderedDescendant(drawingNode, "wp:inline") ??
    findOrderedDescendant(drawingNode, "wp:anchor");
  if (inline === undefined) return undefined;

  // Image discriminator: presence of <a:blip r:embed="..."> anywhere under
  // the inline. Shapes don't carry a blip.
  const blip = findOrderedDescendant(inline, "a:blip");
  if (blip === undefined) return undefined;
  const rel = getOrderedAttr(blip, "r:embed");
  if (rel === undefined) return undefined;

  // Extents: <wp:extent cx="..." cy="..."> in EMU.
  const extent = findOrderedChild(inline, "wp:extent");
  let widthPt = 72;
  let heightPt = 72;
  if (extent !== undefined) {
    const cx = getOrderedAttr(extent, "cx");
    const cy = getOrderedAttr(extent, "cy");
    if (cx !== undefined) {
      const n = Number.parseFloat(cx);
      if (Number.isFinite(n) && n > 0) widthPt = n / EMU_PER_PT;
    }
    if (cy !== undefined) {
      const n = Number.parseFloat(cy);
      if (Number.isFinite(n) && n > 0) heightPt = n / EMU_PER_PT;
    }
  }

  return { rel, widthPt, heightPt };
}

/* ------------------------------------------------------------------ */
/*   Paragraph properties                                             */
/* ------------------------------------------------------------------ */

function readAlignment(pPr: unknown): Paragraph["alignment"] {
  if (pPr === undefined) return "left";
  const jc = findOrderedChild(pPr, "w:jc");
  const raw = jc !== undefined ? getOrderedAttr(jc, "w:val") : undefined;
  if (raw === undefined) return "left";
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
      return "left";
  }
}

function readNumPr(pPr: unknown): Paragraph["numPr"] | undefined {
  if (pPr === undefined) return undefined;
  const numPrNode = findOrderedChild(pPr, "w:numPr");
  if (numPrNode === undefined) return undefined;
  const numIdNode = findOrderedChild(numPrNode, "w:numId");
  const ilvlNode = findOrderedChild(numPrNode, "w:ilvl");
  const numId = numIdNode !== undefined ? getOrderedAttr(numIdNode, "w:val") : undefined;
  const ilvlRaw = ilvlNode !== undefined ? getOrderedAttr(ilvlNode, "w:val") : undefined;
  if (numId === undefined) return undefined;
  const ilvl = ilvlRaw !== undefined ? Number.parseInt(ilvlRaw, 10) : 0;
  const safeIlvl = Number.isFinite(ilvl) && ilvl >= 0 && ilvl <= 8 ? ilvl : 0;
  return { numId, ilvl: safeIlvl };
}

/* ------------------------------------------------------------------ */
/*   Table                                                            */
/* ------------------------------------------------------------------ */

function parseTable(tblNode: unknown, ctx: BlockWalkContext): Table {
  // Column widths from <w:tblGrid><w:gridCol w:w="..."/>.
  const tblGrid = findOrderedChild(tblNode, "w:tblGrid");
  const columnWidthsPt: number[] = [];
  if (tblGrid !== undefined) {
    for (const gridCol of findOrderedChildren(tblGrid, "w:gridCol")) {
      const wRaw = getOrderedAttr(gridCol, "w:w");
      const n = wRaw !== undefined ? Number.parseFloat(wRaw) : Number.NaN;
      // Twips → pt.
      columnWidthsPt.push(Number.isFinite(n) && n > 0 ? n / 20 : 0);
    }
  }

  const rows: TableRow[] = [];
  for (const trNode of findOrderedChildren(tblNode, "w:tr")) {
    rows.push(parseTableRow(trNode, ctx));
  }

  return { kind: "table", rows, columnWidthsPt };
}

function parseTableRow(trNode: unknown, ctx: BlockWalkContext): TableRow {
  // <w:trPr><w:trHeight w:val="..."/></w:trPr>
  const trPr = findOrderedChild(trNode, "w:trPr");
  let heightPt: number | undefined;
  if (trPr !== undefined) {
    const trHeight = findOrderedChild(trPr, "w:trHeight");
    if (trHeight !== undefined) {
      const valRaw = getOrderedAttr(trHeight, "w:val");
      if (valRaw !== undefined) {
        const n = Number.parseFloat(valRaw);
        if (Number.isFinite(n) && n > 0) heightPt = n / 20;
      }
    }
  }

  const cells: TableCell[] = [];
  for (const tcNode of findOrderedChildren(trNode, "w:tc")) {
    cells.push(parseTableCell(tcNode, ctx));
  }
  return {
    cells,
    ...(heightPt !== undefined ? { heightPt } : {}),
  };
}

function parseTableCell(tcNode: unknown, ctx: BlockWalkContext): TableCell {
  // <w:tcPr><w:gridSpan w:val="2"/><w:vMerge w:val="restart"/></w:tcPr>
  const tcPr = findOrderedChild(tcNode, "w:tcPr");
  let gridSpan = 1;
  let vMerge: TableCell["vMerge"] = "none";

  if (tcPr !== undefined) {
    const gridSpanNode = findOrderedChild(tcPr, "w:gridSpan");
    if (gridSpanNode !== undefined) {
      const valRaw = getOrderedAttr(gridSpanNode, "w:val");
      if (valRaw !== undefined) {
        const n = Number.parseInt(valRaw, 10);
        if (Number.isFinite(n) && n >= 1) gridSpan = n;
      }
    }

    const vMergeNode = findOrderedChild(tcPr, "w:vMerge");
    if (vMergeNode !== undefined) {
      const valRaw = getOrderedAttr(vMergeNode, "w:val");
      // Per OOXML: <w:vMerge w:val="restart"/> = top of merge; element
      // present without val (or with "continue") = continuation cell.
      if (valRaw === "restart") vMerge = "start";
      else vMerge = "continue";
    }
  }

  // Cell content: walk paragraphs and (nested) tables.
  const blocks = parseBlocks(getOrderedChildren(tcNode), ctx);
  return { blocks, gridSpan, vMerge };
}

/* ------------------------------------------------------------------ */
/*   Ordered → flat conversion (for sectPr → parseSectionProperties)  */
/* ------------------------------------------------------------------ */

/**
 * `parseSectionProperties` from `sections.ts` accepts the *flat* (non-
 * preserveOrder) JSON shape produced by `createXmlParser`. The body parser,
 * which reads in preserveOrder mode, needs to convert a single ordered
 * `<w:sectPr>` entry to that flat shape so the leaf parser can be reused.
 *
 * Conversion rules (sufficient for the section-properties subset we read):
 * - An ordered entry `{ tag: [children], ":@": attrs }` becomes
 *   `{ "@_attr1": v1, ..., childTagN: <flatChildren> }` keyed by tag.
 * - When the same tag appears multiple times among children, we keep the
 *   first occurrence (sectPr children like `<w:headerReference>` are
 *   handled via `findOrderedChildren` upstream — but parseSectionProperties
 *   uses `toArray` and expects `headerReference` to be an array. To support
 *   that, we collect repeats into arrays.)
 */
function orderedToJson(entry: unknown): unknown {
  if (entry === null || entry === undefined || typeof entry !== "object") return entry;
  const obj = entry as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  // Attributes from ":@" become top-level @_-prefixed keys.
  const attrs = obj[":@"];
  if (attrs !== null && attrs !== undefined && typeof attrs === "object") {
    Object.assign(out, attrs);
  }

  // Walk the children array under the tag key and re-bucket by tag, with
  // multiple-occurrence collected into arrays so callers can use toArray.
  for (const child of getOrderedChildren(entry)) {
    const tag = getTagName(child);
    if (tag === undefined || tag === "#text") continue;
    const flat = orderedToJson(child);
    if (Object.hasOwn(out, tag)) {
      const existing = out[tag];
      if (Array.isArray(existing)) {
        existing.push(flat);
      } else {
        out[tag] = [existing, flat];
      }
    } else {
      out[tag] = flat;
    }
  }
  return out;
}
