export type ParagraphJoin = "double-newline" | "single-newline";

export type DocxToTxtOptions = {
  joinParagraphs: ParagraphJoin;
};

export const defaultDocxToTxtOptions: DocxToTxtOptions = {
  joinParagraphs: "double-newline",
};
