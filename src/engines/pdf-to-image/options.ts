export type PdfToImageOptions = {
  format: "png" | "jpeg";
  scale: 1 | 2 | 3;
  jpegQuality: number;
  rangeInput: string;
};

export const defaultPdfToImageOptions: PdfToImageOptions = {
  format: "png",
  scale: 2,
  jpegQuality: 90,
  rangeInput: "",
};
