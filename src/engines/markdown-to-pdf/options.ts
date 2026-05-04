import type { PdfPageSize } from "@/engines/_shared/pdf-page-setup";

export type MarkdownToPdfOptions = {
  pageSize: PdfPageSize;
};

export const defaultMarkdownToPdfOptions: MarkdownToPdfOptions = {
  pageSize: "letter",
};
