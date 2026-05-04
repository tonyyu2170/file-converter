/**
 * Public surface of the shared DOCX parser.
 *
 * ## ParsedDocx shape
 *
 * `parseDocx(bytes: Uint8Array): ParsedDocx` — synchronous; unzips and
 * parses all OOXML parts. Throws with a user-displayable message when the
 * archive is encrypted or missing `word/document.xml`.
 *
 * ### Top-level structure
 *
 * ```
 * ParsedDocx
 *   .sections: Section[]          ← iterate here to walk the document body
 *   .styles, .numbering, .fontTable, .relationships, .media, …  (PDF-only metadata)
 * ```
 *
 * ### Walking content blocks
 *
 * Each `Section` has `.blocks: ParsedBlock[]`. `ParsedBlock` is a
 * discriminated union on the `kind` field:
 *
 * ```
 * ParsedBlock =
 *   | { kind: "paragraph"; styleId?: string; alignment: ...; numPr?: ...; runs: Run[] }
 *   | { kind: "table"; rows: TableRow[]; columnWidthsPt: number[] }
 *   | { kind: "skip-with-warning"; reason: string }
 * ```
 *
 * To walk the full document (used by docx-to-txt):
 *
 * ```ts
 * for (const section of doc.sections) {
 *   walkBlocks(section.blocks);
 * }
 * function walkBlocks(blocks: ParsedBlock[]) {
 *   for (const block of blocks) {
 *     if (block.kind === "paragraph") {
 *       for (const run of block.runs) { /* run.text, run.bold, … *\/ }
 *     } else if (block.kind === "table") {
 *       for (const row of block.rows) {
 *         for (const cell of row.cells) {
 *           walkBlocks(cell.blocks);  // ← recursive: cells contain ParsedBlock[]
 *         }
 *       }
 *     }
 *     // skip "skip-with-warning" blocks
 *   }
 * }
 * ```
 *
 * ### Run fields (relevant to docx-to-txt)
 *
 * ```
 * Run {
 *   kind: "run"
 *   text: string        ← joined <w:t> content; \t for tabs; \n for soft breaks
 *   bold: boolean
 *   italic: boolean
 *   underline: boolean
 *   strike: boolean
 *   fontFamily?: string
 *   fontSizePt?: number
 *   colorHex?: string   ← 6-digit uppercase hex without #; absent when "auto"
 *   hyperlinkRel?: string
 *   hyperlinkAnchor?: string
 *   inlineImage?: { rel: string; widthPt: number; heightPt: number }
 *   footnoteRef?: string
 *   endnoteRef?: string
 *   pageBreakBefore?: boolean
 *   columnBreakBefore?: boolean
 * }
 * ```
 *
 * ### Table structure (recursive — cells contain ParsedBlock[])
 *
 * ```
 * Table { kind: "table"; rows: TableRow[]; columnWidthsPt: number[] }
 * TableRow { cells: TableCell[]; heightPt?: number }
 * TableCell { blocks: ParsedBlock[]; gridSpan: number; vMerge: "start"|"continue"|"none" }
 * ```
 *
 * ### Error constants
 *
 * - `ENCRYPTED_DOCX_MESSAGE` — thrown when [Content_Types].xml signals
 *   an encrypted package.
 * - `NOT_A_DOCX_MESSAGE` — thrown when `word/document.xml` is missing.
 */

export {
  parseDocx,
  ENCRYPTED_DOCX_MESSAGE,
  NOT_A_DOCX_MESSAGE,
} from "./docx-parser";

export type {
  ParsedDocx,
  Section,
  SectionProperties,
  SectionRefs,
  ParsedBlock,
  Paragraph,
  Run,
  Table,
  TableRow,
  TableCell,
  Style,
  StyleRunProps,
  StyleParagraphProps,
  NumberingDef,
  NumberingLevel,
  NumberingFormat,
  FontInfo,
  FontFamilyKind,
  RelationshipTarget,
  RelationshipType,
  MediaAsset,
} from "./docx-parser/types";

export { DEFAULT_STYLE_KEY } from "./docx-parser/types";
