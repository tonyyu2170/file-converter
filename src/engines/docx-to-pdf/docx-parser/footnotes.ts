/**
 * Parses `word/footnotes.xml` and `word/endnotes.xml`.
 *
 * Both files share the same shape:
 *
 * ```xml
 * <w:footnotes xmlns:w="...">
 *   <w:footnote w:id="-1" w:type="separator">…</w:footnote>
 *   <w:footnote w:id="0" w:type="continuationSeparator">…</w:footnote>
 *   <w:footnote w:id="1">
 *     <w:p>…body content…</w:p>
 *   </w:footnote>
 * </w:footnotes>
 * ```
 *
 * Word reserves `w:id="-1"` for the visual separator and `w:id="0"` for the
 * continuation separator (both `w:type="separator"` / `"continuationSeparator"`).
 * Real referenceable footnotes have positive integer ids matching the
 * `<w:footnoteReference w:id="N"/>` markers extracted in `document-xml.ts`.
 *
 * Endnotes use the same parser; the wrapper element is `<w:endnotes>` and
 * children are `<w:endnote w:id="...">`.
 *
 * Output: `Map<string, ParsedBlock[]>` keyed by id (string form, since
 * `Run.footnoteRef`/`endnoteRef` are strings). Separator entries are
 * filtered out — they're not user-content and the layout engine renders the
 * separator itself as a hairline rule.
 */

import { type BlockWalkContext, parseBlocks } from "./document-xml";
import type { ParsedBlock, Style } from "./types";
import {
  createOrderedXmlParser,
  findOrderedChildren,
  getOrderedAttr,
  getOrderedChildren,
  getTagName,
  isWellFormedXml,
} from "./xml";

export type ParseFootnotesResult = {
  value: Map<string, ParsedBlock[]>;
  warnings: string[];
};

/**
 * Parses a footnote-style XML document. Pass `"footnote"` for
 * `word/footnotes.xml` (root `<w:footnotes>`, item `<w:footnote>`) or
 * `"endnote"` for `word/endnotes.xml` (root `<w:endnotes>`, item
 * `<w:endnote>`). Defaults to `"footnote"`.
 *
 * `styles` is the parsed `word/styles.xml` map; threaded down so paragraph
 * runs inside footnotes inherit run-level props from their `pStyle` chain.
 * Defaults to an empty map for callers that don't have style data
 * available — `resolveStyle` handles an empty map cleanly.
 */
export function parseFootnotesXml(
  xml: string,
  kind: "footnote" | "endnote" = "footnote",
  styles: Map<string, Style> = new Map(),
): ParseFootnotesResult {
  const warnings: string[] = [];
  const empty = new Map<string, ParsedBlock[]>();
  const rootTag = kind === "footnote" ? "w:footnotes" : "w:endnotes";
  const itemTag = kind === "footnote" ? "w:footnote" : "w:endnote";

  if (!isWellFormedXml(xml)) {
    warnings.push(`${kind}s: malformed XML, returning empty map`);
    return { value: empty, warnings };
  }

  let json: unknown;
  try {
    json = createOrderedXmlParser().parse(xml);
  } catch {
    warnings.push(`${kind}s: parser threw, returning empty map`);
    return { value: empty, warnings };
  }

  // preserveOrder root is an array. Find the wrapper element.
  if (!Array.isArray(json)) {
    warnings.push(`${kind}s: unexpected parser output shape, returning empty map`);
    return { value: empty, warnings };
  }
  const rootEntry = json.find((e) => getTagName(e) === rootTag);
  if (rootEntry === undefined) {
    warnings.push(`${kind}s: missing <${rootTag}> root, returning empty map`);
    return { value: empty, warnings };
  }

  const out = new Map<string, ParsedBlock[]>();
  const ctx: BlockWalkContext = { warnings, styles };

  for (const item of findOrderedChildren(rootEntry, itemTag)) {
    const id = getOrderedAttr(item, "w:id");
    if (id === undefined) continue;

    // Skip the separator / continuation-separator / continuation-notice
    // pseudo-entries — they're rendering hints, not user content.
    const itemType = getOrderedAttr(item, "w:type");
    if (
      itemType === "separator" ||
      itemType === "continuationSeparator" ||
      itemType === "continuationNotice"
    ) {
      continue;
    }

    const blocks = parseBlocks(getOrderedChildren(item), ctx);
    out.set(id, blocks);
  }

  return { value: out, warnings };
}
