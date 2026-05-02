export type PdfMergeRow = {
  id: string;
  fileName: string;
  pageCount: number | undefined;
  encrypted: boolean;
  rangeInput: string;
  parsedRange: number[];
  rangeError: string | undefined;
};

export type PdfMergeOptions = {
  rows: PdfMergeRow[];
};

export const defaultPdfMergeOptions: PdfMergeOptions = { rows: [] };
