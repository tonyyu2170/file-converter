import { parseRangeTokens } from "@/engines/_shared/range";

export type PageNumbersResult = { ok: true; pages: number[] } | { ok: false; reason: string };

/**
 * Resolve a range-input string (or empty for "all pages") into a sorted,
 * unique, 1-indexed list of page numbers ready to hand to pdfjs-dist's
 * doc.getPage(n) API.
 */
export function computePageNumbers(rangeInput: string, pageCount: number): PageNumbersResult {
  if (!rangeInput.trim()) {
    return { ok: true, pages: Array.from({ length: pageCount }, (_, i) => i + 1) };
  }
  const parsed = parseRangeTokens(rangeInput, pageCount);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const set = new Set<number>();
  for (const token of parsed.tokens) {
    for (const idx of token.indices) set.add(idx + 1);
  }
  return { ok: true, pages: Array.from(set).sort((a, b) => a - b) };
}
