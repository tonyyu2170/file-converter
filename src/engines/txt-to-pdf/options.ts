import type { PdfPageSize } from "@/engines/_shared/pdf-page-setup";

export type TxtToPdfOptions = {
  pageSize: PdfPageSize;
};

export const defaultTxtToPdfOptions: TxtToPdfOptions = {
  pageSize: "letter",
};
