/**
 * Pure line-wrapping helper for txt-to-pdf.
 *
 * Uses a fixed character-column width (not pdf-lib measurement) so the
 * function is testable without any PDF library and — critically — avoids
 * the JetBrains Mono ligature crash that occurs when fontkit tries to
 * measure multi-character strings like "//", "=>", "!=", "||", or "&&".
 *
 * The worker computes maxColumns as:
 *   Math.floor(contentW / (FONT_SIZE_PT * MONO_CHAR_ADVANCE_RATIO))
 *
 * A hard-wrap (no word boundary) is correct for verbatim text display.
 */

/**
 * Wrap a single pre-expanded line to at most `maxColumns` characters
 * per visual line. Returns an array of visual lines; an empty input
 * line yields `[""]` (preserving blank lines in the output).
 */
export function wrapLine(line: string, maxColumns: number): string[] {
  if (line.length === 0) return [""];
  if (line.length <= maxColumns) return [line];

  const lines: string[] = [];
  let start = 0;
  while (start < line.length) {
    lines.push(line.slice(start, start + maxColumns));
    start += maxColumns;
  }
  return lines;
}
