export type PdfPageSize = "letter" | "a4" | "legal";

export const PAGE_SIZES_PT: Record<PdfPageSize, [number, number]> = {
  letter: [612, 792],
  a4: [595, 842],
  legal: [612, 1008],
} as const;

export const DEFAULT_MARGIN_PT = 72; // 1 inch

export function getPageDimensions(size: PdfPageSize): [number, number] {
  return PAGE_SIZES_PT[size];
}
