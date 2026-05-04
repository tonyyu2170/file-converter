import type { ParsedBlock, ParsedDocx, Run, TableCell, TableRow } from "@/engines/_shared/docx";
import type { DocxToTxtOptions } from "./options";

function renderRun(run: Run): string {
  // Skip image runs silently
  if (run.inlineImage) return "";
  return run.text;
}

function renderRuns(runs: Run[]): string {
  return runs.map(renderRun).join("");
}

/**
 * Renders a single table cell's blocks to a string.
 *
 * vMerge "continue" cells are vertical-merge continuations — they
 * belong to the cell above. Emit empty string so the column
 * alignment is preserved without duplicating the merged cell's text.
 *
 * Cells containing multiple paragraphs are flattened with a single
 * space separator. This preserves the tab-row contract (cells joined
 * by \t, rows by \n) but loses the paragraph boundary inside the
 * cell. Plain-text tables are inherently lossy; this trade-off
 * favours readability of the row structure.
 */
function renderCell(cell: TableCell): string {
  if (cell.vMerge === "continue") return "";
  return renderBlocks(cell.blocks, " ");
}

function renderTableRow(row: TableRow): string {
  return row.cells.map(renderCell).join("\t");
}

function renderBlocks(blocks: ParsedBlock[], paragraphSep: string): string {
  // Track each block's rendered text and kind to apply correct separators.
  type RenderedBlock = { kind: "paragraph" | "table"; text: string };
  const rendered: RenderedBlock[] = [];

  for (const block of blocks) {
    if (block.kind === "paragraph") {
      const text = renderRuns(block.runs);
      // Skip empty paragraphs (DOCX blank lines used for spacing). They
      // would double-blank when combined with the paragraph separator.
      if (text.length > 0) {
        rendered.push({ kind: "paragraph", text });
      }
    } else if (block.kind === "table") {
      const rows = block.rows.map(renderTableRow).filter((r) => r.length > 0);
      if (rows.length > 0) {
        rendered.push({ kind: "table", text: rows.join("\n") });
      }
    }
    // "skip-with-warning" blocks are skipped silently
  }

  if (rendered.length === 0) return "";

  let out = rendered[0]?.text ?? "";
  for (let i = 1; i < rendered.length; i++) {
    const prev = rendered[i - 1];
    const curr = rendered[i];
    // Table adjacency always uses double-newline regardless of option.
    const sep = prev?.kind === "table" || curr?.kind === "table" ? "\n\n" : paragraphSep;
    out += sep + (curr?.text ?? "");
  }
  return out;
}

/**
 * Extracts plain text from a parsed DOCX document.
 *
 * - Paragraphs are separated by `\n\n` (default) or `\n` per options.
 * - Tables: cells joined by `\t`, rows by `\n`. Tables and surrounding
 *   paragraphs are always separated by `\n\n` regardless of join option.
 * - Headings emit text only (no `#` markers — headings are paragraphs
 *   with a styleId in this parser).
 * - Lists emit text per item, no bullet glyph.
 * - Hyperlinks emit anchor text only (from `run.text`).
 * - Image runs (`run.inlineImage` is set) are skipped silently.
 * - `kind: "skip-with-warning"` blocks are skipped silently.
 * - Empty DOCX → empty string, no error.
 * - Multiple sections are flattened as one contiguous block stream.
 *
 * **Blank-paragraph policy:** consecutive blank `<w:p/>` elements
 * (used in DOCX for visual spacing) collapse to a single separator
 * in the output. Three blank paragraphs between two non-empty
 * paragraphs produces the same output as one blank — this matches
 * what most plain-text converters do, but is intentionally lossy.
 */
export function extractText(doc: ParsedDocx, opts: DocxToTxtOptions): string {
  const paragraphSep = opts.joinParagraphs === "double-newline" ? "\n\n" : "\n";

  // Flatten all sections into a single block list
  const allBlocks: ParsedBlock[] = doc.sections.flatMap((s) => s.blocks);

  return renderBlocks(allBlocks, paragraphSep);
}
