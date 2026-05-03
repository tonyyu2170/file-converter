/**
 * Parses `word/_rels/document.xml.rels`.
 *
 * Output: `Map<string, RelationshipTarget>` keyed by relationship `Id`
 * (e.g., `rId1`). Hyperlink targets, image paths, header/footer references,
 * and footnote/endnote part links all flow through this map.
 *
 * The `.rels` schema uses unprefixed element/attribute names:
 *
 * ```xml
 * <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 *   <Relationship Id="rId4" Type="http://.../image" Target="media/image1.png"/>
 *   <Relationship Id="rId7" Type="http://.../hyperlink" Target="https://…" TargetMode="External"/>
 * </Relationships>
 * ```
 */

import type { RelationshipTarget, RelationshipType } from "./types";
import { createXmlParser, getAttr, getPath, isWellFormedXml, toArray } from "./xml";

export type ParseRelationshipsResult = {
  value: Map<string, RelationshipTarget>;
  warnings: string[];
};

/**
 * Maps a relationship `Type` URL fragment to one of our coarse categories.
 * Unknown URLs become `"other"` so consumers can still see them in the map.
 */
function classifyType(typeUrl: string | undefined): RelationshipType {
  if (typeUrl === undefined) return "other";
  // Type URLs end in /image, /hyperlink, /header, /footer, etc.
  // We match by the last path segment, lowercased, for robustness across
  // 2006 and 2010 namespace variations.
  const lastSlash = typeUrl.lastIndexOf("/");
  const tail = (lastSlash === -1 ? typeUrl : typeUrl.slice(lastSlash + 1)).toLowerCase();
  switch (tail) {
    case "image":
      return "image";
    case "hyperlink":
      return "hyperlink";
    case "header":
      return "header";
    case "footer":
      return "footer";
    case "footnotes":
      return "footnotes";
    case "endnotes":
      return "endnotes";
    case "styles":
      return "styles";
    case "numbering":
      return "numbering";
    case "fonttable":
      return "fontTable";
    default:
      return "other";
  }
}

export function parseRelationshipsXml(xml: string): ParseRelationshipsResult {
  const warnings: string[] = [];
  const empty = new Map<string, RelationshipTarget>();

  if (!isWellFormedXml(xml)) {
    warnings.push("relationships: malformed XML, returning empty map");
    return { value: empty, warnings };
  }

  let json: unknown;
  try {
    json = createXmlParser().parse(xml);
  } catch {
    warnings.push("relationships: parser threw, returning empty map");
    return { value: empty, warnings };
  }

  // Root must be <Relationships>; anything else is treated as malformed-shape.
  const relsRoot = getPath(json, ["Relationships"]);
  if (relsRoot === undefined) {
    warnings.push("relationships: missing <Relationships> root, returning empty map");
    return { value: empty, warnings };
  }

  const entries = toArray(getPath(relsRoot, ["Relationship"]) as unknown);
  const out = new Map<string, RelationshipTarget>();

  for (const entry of entries) {
    const id = getAttr(entry, "Id");
    const target = getAttr(entry, "Target");
    if (id === undefined || target === undefined) {
      // Invalid <Relationship> — skip, but don't warn at top-level since
      // these are noisy in real docs and we want output to stay clean.
      continue;
    }
    const typeUrl = getAttr(entry, "Type");
    const targetMode = getAttr(entry, "TargetMode");

    const rel: RelationshipTarget = {
      id,
      type: classifyType(typeUrl),
      target,
      ...(targetMode === "Internal" || targetMode === "External" ? { targetMode } : {}),
    };
    out.set(id, rel);
  }

  return { value: out, warnings };
}
