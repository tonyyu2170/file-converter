/**
 * Entry point for the docx-to-pdf engine's parser.
 *
 * `parseDocx(bytes)` orchestrates the full parser stack:
 *
 *   1. Unzip the DOCX with `fflate.unzipSync`.
 *   2. Validate `[Content_Types].xml` — throw "password-protected" when an
 *      `application/vnd.ms-office.encryptedPackage` override is present.
 *   3. Verify `word/document.xml` exists; throw "Not a valid Word document"
 *      otherwise (this catches both renamed-extension non-DOCX files and
 *      truncated archives).
 *   4. Parse each leaf XML in dependency order:
 *      - `word/_rels/document.xml.rels` → relationships map.
 *      - `word/fontTable.xml` → font table (optional).
 *      - `word/styles.xml` → styles (optional, defaults if missing).
 *      - `word/numbering.xml` → numbering (optional).
 *   5. Parse footnotes / endnotes (optional).
 *   6. Parse every `word/header*.xml` and `word/footer*.xml` keyed by part
 *      name. Note that the relationship `target` is `header1.xml` (relative
 *      to `word/`) — the layout engine resolves a section's `headerRefs.X`
 *      → relationship-id → target → entry in `headers` map.
 *   7. Walk `word/media/*` into `MediaAsset`s with sniffed mime type. PNG
 *      and JPEG only; other formats emit a warning and are skipped.
 *   8. Parse `word/document.xml` body via `parseBodyXml` → `Section[]`.
 *   9. Aggregate all warnings.
 *  10. Return the assembled `ParsedDocx`.
 *
 * The function is synchronous — `unzipSync` is sync and every inner parser
 * is sync. Async work (font fetch, PDF embedding) lives in the layout
 * pipeline.
 */

import { unzipSync } from "fflate";

import { parseBodyXml } from "./document-xml";
import { parseFontTableXml } from "./font-table-xml";
import { parseFootnotesXml } from "./footnotes";
import { parseFooterXml, parseHeaderXml } from "./headers-footers";
import { parseNumberingXml } from "./numbering-xml";
import { parseRelationshipsXml } from "./relationships";
import { parseStylesXml } from "./styles-xml";
import type {
  FontInfo,
  MediaAsset,
  NumberingDef,
  ParsedBlock,
  ParsedDocx,
  RelationshipTarget,
  Style,
} from "./types";

/* ------------------------------------------------------------------ */
/*   Errors                                                           */
/* ------------------------------------------------------------------ */

/** Thrown when [Content_Types].xml signals an encrypted package. */
export const ENCRYPTED_DOCX_MESSAGE = "Word document is password-protected";

/** Thrown when `word/document.xml` is missing from the archive. */
export const NOT_A_DOCX_MESSAGE = "Not a valid Word document — missing word/document.xml";

/* ------------------------------------------------------------------ */
/*   parseDocx                                                        */
/* ------------------------------------------------------------------ */

export function parseDocx(bytes: Uint8Array): ParsedDocx {
  // 1. Unzip.
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (err) {
    // A failed unzip on bytes claiming to be a .docx is most likely a
    // truncated / non-DOCX file. Surface it with the same UX as the
    // missing-document.xml case.
    const reason = err instanceof Error ? err.message : "unzip failed";
    throw new Error(`${NOT_A_DOCX_MESSAGE} (${reason})`);
  }

  const decoder = new TextDecoder("utf-8");
  const decodeEntry = (path: string): string | undefined => {
    const buf = entries[path];
    if (buf === undefined) return undefined;
    return decoder.decode(buf);
  };

  // 2. Encryption check via [Content_Types].xml.
  const contentTypes = decodeEntry("[Content_Types].xml");
  if (contentTypes !== undefined && isEncrypted(contentTypes)) {
    throw new Error(ENCRYPTED_DOCX_MESSAGE);
  }

  // 3. Document.xml presence check.
  const documentXml = decodeEntry("word/document.xml");
  if (documentXml === undefined) {
    throw new Error(NOT_A_DOCX_MESSAGE);
  }

  const warnings: string[] = [];

  // 4. Leaf parsers.
  const relsXml = decodeEntry("word/_rels/document.xml.rels");
  let relationships: Map<string, RelationshipTarget> = new Map();
  if (relsXml !== undefined) {
    const r = parseRelationshipsXml(relsXml);
    relationships = r.value;
    warnings.push(...r.warnings);
  }

  const fontTableXml = decodeEntry("word/fontTable.xml");
  let fontTable: Map<string, FontInfo> = new Map();
  if (fontTableXml !== undefined) {
    const r = parseFontTableXml(fontTableXml);
    fontTable = r.value;
    warnings.push(...r.warnings);
  }

  const stylesXml = decodeEntry("word/styles.xml");
  let styles: Map<string, Style> = new Map();
  if (stylesXml !== undefined) {
    const r = parseStylesXml(stylesXml);
    styles = r.value;
    warnings.push(...r.warnings);
  }

  const numberingXml = decodeEntry("word/numbering.xml");
  let numbering: Map<string, NumberingDef> = new Map();
  if (numberingXml !== undefined) {
    const r = parseNumberingXml(numberingXml);
    numbering = r.value;
    warnings.push(...r.warnings);
  }

  // 5. Footnotes / endnotes. Pass `styles` so paragraph runs inside
  // footnote/endnote bodies inherit run-level props from their `pStyle`
  // chain (matches body behavior).
  let footnotes: Map<string, ParsedBlock[]> = new Map();
  const footnotesXml = decodeEntry("word/footnotes.xml");
  if (footnotesXml !== undefined) {
    const r = parseFootnotesXml(footnotesXml, "footnote", styles);
    footnotes = r.value;
    warnings.push(...r.warnings);
  }

  let endnotes: Map<string, ParsedBlock[]> = new Map();
  const endnotesXml = decodeEntry("word/endnotes.xml");
  if (endnotesXml !== undefined) {
    const r = parseFootnotesXml(endnotesXml, "endnote", styles);
    endnotes = r.value;
    warnings.push(...r.warnings);
  }

  // 6. Headers / footers — one per file. Key by the relationship-target-style
  // path (e.g., "header1.xml") so the layout engine can resolve via
  // section.headerRefs[X] → relationships → target. `styles` is threaded so
  // header/footer paragraphs honor `pStyle` inheritance.
  const headers: ParsedDocx["headers"] = new Map();
  const footers: ParsedDocx["footers"] = new Map();
  for (const path of Object.keys(entries)) {
    const headerMatch = path.match(/^word\/(header\d+)\.xml$/);
    if (headerMatch !== null && headerMatch[1] !== undefined) {
      const xml = decodeEntry(path);
      if (xml === undefined) continue;
      const r = parseHeaderXml(xml, styles);
      headers.set(`${headerMatch[1]}.xml`, r.value);
      warnings.push(...r.warnings);
      continue;
    }
    const footerMatch = path.match(/^word\/(footer\d+)\.xml$/);
    if (footerMatch !== null && footerMatch[1] !== undefined) {
      const xml = decodeEntry(path);
      if (xml === undefined) continue;
      const r = parseFooterXml(xml, styles);
      footers.set(`${footerMatch[1]}.xml`, r.value);
      warnings.push(...r.warnings);
    }
  }

  // 7. Media. Sniff PNG / JPEG by signature; warn-and-skip other formats.
  const media: Map<string, MediaAsset> = new Map();
  for (const path of Object.keys(entries)) {
    if (!path.startsWith("word/media/")) continue;
    const buf = entries[path];
    if (buf === undefined) continue;
    const mime = sniffMime(buf);
    if (mime === undefined) {
      warnings.push(`media: unsupported format at ${path}, skipped`);
      continue;
    }
    media.set(path, { path, mime, bytes: buf });
  }

  // 8. Body parse. Pass `styles` so paragraph runs merge their pStyle's
  // resolved runProps underneath their explicit rPr (Heading1 → bold via
  // inheritance; explicit `<w:b w:val="0"/>` still wins).
  const bodyResult = parseBodyXml(documentXml, styles);
  warnings.push(...bodyResult.warnings);

  // 9. Assemble.
  return {
    sections: bodyResult.sections,
    styles,
    numbering,
    fontTable,
    relationships,
    footnotes,
    endnotes,
    headers,
    footers,
    media,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/*   Helpers                                                          */
/* ------------------------------------------------------------------ */

/**
 * Detects the encrypted-package signature in `[Content_Types].xml`. A real
 * encrypted DOCX has an Override entry like:
 *
 * ```xml
 * <Override PartName="/EncryptedPackage"
 *           ContentType="application/vnd.ms-office.encryptedPackage"/>
 * ```
 *
 * We do a string-match (cheaper and more robust than re-parsing the XML
 * just for this check) — the content type string itself is unique enough
 * to be a reliable signal.
 */
function isEncrypted(contentTypesXml: string): boolean {
  return contentTypesXml.includes("application/vnd.ms-office.encryptedPackage");
}

/**
 * Sniffs the MIME type of an image file by its magic bytes. Returns
 * `undefined` for formats the engine doesn't support.
 *
 * - PNG: `89 50 4E 47 0D 0A 1A 0A`
 * - JPEG: `FF D8 FF`
 */
function sniffMime(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8) {
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    ) {
      return "image/png";
    }
  }
  if (bytes.length >= 3) {
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return "image/jpeg";
    }
  }
  return undefined;
}
