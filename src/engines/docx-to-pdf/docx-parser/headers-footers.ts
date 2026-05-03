/**
 * Parses individual `word/header*.xml` and `word/footer*.xml` files.
 *
 * Each file is a body-content fragment wrapped in `<w:hdr>` (header) or
 * `<w:ftr>` (footer):
 *
 * ```xml
 * <w:hdr xmlns:w="...">
 *   <w:p>…paragraph content…</w:p>
 *   <w:tbl>…</w:tbl>
 * </w:hdr>
 * ```
 *
 * The block-level walker from `document-xml.ts` (`parseBlocks`) handles the
 * inner content directly — header / footer XML uses the same paragraph /
 * table / run constructs as body content.
 *
 * Output: `ParsedBlock[]` plus warnings. The orchestrator in `index.ts`
 * keys each parse result by the part name (e.g., `header1.xml`) and stores
 * it in `ParsedDocx.headers` / `ParsedDocx.footers` for the layout engine
 * to fetch via the relationship-id pointers in each section's `headerRefs`
 * / `footerRefs`.
 */

import { type BlockWalkContext, parseBlocks } from "./document-xml";
import type { ParsedBlock, Style } from "./types";
import { createOrderedXmlParser, getOrderedChildren, getTagName, isWellFormedXml } from "./xml";

export type ParseHeaderFooterResult = {
  value: ParsedBlock[];
  warnings: string[];
};

/**
 * Parses a header XML document (`word/header*.xml`). Returns the parsed
 * block list and any warnings accumulated during the walk.
 *
 * `styles` is the parsed `word/styles.xml` map; threaded into the block
 * walker so header paragraph runs inherit run-level props from their
 * `pStyle` chain. Defaults to an empty map.
 */
export function parseHeaderXml(
  xml: string,
  styles: Map<string, Style> = new Map(),
): ParseHeaderFooterResult {
  return parseHeaderOrFooter(xml, "w:hdr", "header", styles);
}

/**
 * Parses a footer XML document (`word/footer*.xml`).
 */
export function parseFooterXml(
  xml: string,
  styles: Map<string, Style> = new Map(),
): ParseHeaderFooterResult {
  return parseHeaderOrFooter(xml, "w:ftr", "footer", styles);
}

function parseHeaderOrFooter(
  xml: string,
  rootTag: "w:hdr" | "w:ftr",
  label: "header" | "footer",
  styles: Map<string, Style>,
): ParseHeaderFooterResult {
  const warnings: string[] = [];

  if (!isWellFormedXml(xml)) {
    warnings.push(`${label}: malformed XML, returning empty block list`);
    return { value: [], warnings };
  }

  let json: unknown;
  try {
    json = createOrderedXmlParser().parse(xml);
  } catch {
    warnings.push(`${label}: parser threw, returning empty block list`);
    return { value: [], warnings };
  }

  if (!Array.isArray(json)) {
    warnings.push(`${label}: unexpected parser output shape, returning empty block list`);
    return { value: [], warnings };
  }

  const rootEntry = json.find((e) => getTagName(e) === rootTag);
  if (rootEntry === undefined) {
    warnings.push(`${label}: missing <${rootTag}> root, returning empty block list`);
    return { value: [], warnings };
  }

  const ctx: BlockWalkContext = { warnings, styles };
  const blocks = parseBlocks(getOrderedChildren(rootEntry), ctx);
  return { value: blocks, warnings };
}
