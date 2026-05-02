export type ImageToPdfPaperSize = "letter" | "a4";

export type ImageToPdfOptions = {
  paper: ImageToPdfPaperSize;
};

export const defaultImageToPdfOptions: ImageToPdfOptions = {
  paper: "letter",
};

export const PAPER_DIMS: Record<ImageToPdfPaperSize, [number, number]> = {
  letter: [612, 792],
  a4: [595.28, 841.89],
};

export const PAGE_MARGIN = 12;
